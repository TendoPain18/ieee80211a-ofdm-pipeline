#include "core/run_generic_block.h"
#include <cstring>
#include <cstdint>
#include <cmath>
#include <cstdio>
#include <random>
#include <complex>
#include <vector>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

// ============================================================
// IEEE 802.11a Channel Simulator — Configuration
//
// Edit these defines to change channel behaviour.
// Recompile after making changes.
//
// CHANNEL_TYPE:        PASSTHROUGH | AWGN | RAYLEIGH | RICIAN | MULTIPATH
// CHANNEL_SNR_DB:      SNR in dB  (0 = very noisy, 40 = near-ideal)
// CHANNEL_K_FACTOR:    Rician K   (1 = balanced, 10 = strong LOS)
// CHANNEL_NUM_PATHS:   Number of multipath taps (1–8)
// CHANNEL_PATH_DELAYS: Sample delays, comma-separated (up to 8 values)
// CHANNEL_PATH_GAINS:  Tap gains in dB, comma-separated (up to 8 values)
// CHANNEL_DOPPLER_HZ:  Max Doppler shift Hz (currently unused)
// ============================================================

#define CHANNEL_TYPE        AWGN
#define CHANNEL_SNR_DB      100.0
#define CHANNEL_K_FACTOR    1.0
#define CHANNEL_NUM_PATHS   3
#define CHANNEL_PATH_DELAYS { 0, 3, 7, 0, 0, 0, 0, 0 }
#define CHANNEL_PATH_GAINS  { 0, -6, -12, 0, 0, 0, 0, 0 }
#define CHANNEL_DOPPLER_HZ  0.0

// ============================================================
// IEEE 802.11a Channel Simulator
//
// Sits between batch_ifft and preamble_stripper.
// Applies configurable channel impairments to time-domain IQ.
//
// Inputs:
//   in[0]: Time-domain samples from batch_ifft  (162560 bytes/pkt)
//             508 symbols x 320 bytes (80 samples x 4 bytes each)
//
// Outputs:
//   out[0]: Channel-impaired time-domain samples (162560 bytes/pkt)
//             Same layout — drop-in replacement wire
// ============================================================

static const int SYMBOLS_PER_PKT  = 508;
static const int SAMPLES_PER_SYM  = 80;
static const int BYTES_PER_SAMPLE = 4;
static const int BYTES_PER_SYM    = SAMPLES_PER_SYM * BYTES_PER_SAMPLE;  // 320
static const int PKT_SIZE         = SYMBOLS_PER_PKT * BYTES_PER_SYM;      // 162560

enum ChannelType { CH_PASSTHROUGH = 0, CH_AWGN, CH_RAYLEIGH, CH_RICIAN, CH_MULTIPATH };

// Map the CHANNEL_TYPE define to the enum
#define PASSTHROUGH CH_PASSTHROUGH
#define AWGN        CH_AWGN
#define RAYLEIGH    CH_RAYLEIGH
#define RICIAN      CH_RICIAN
#define MULTIPATH   CH_MULTIPATH

struct ChannelParams {
    ChannelType type;
    double snr_db;
    double K_factor;
    int    num_paths;
    double path_delays  [8];
    double path_gains_db[8];
    double doppler_hz;
};

static ChannelParams g_params = {
    CHANNEL_TYPE,
    CHANNEL_SNR_DB,
    CHANNEL_K_FACTOR,
    CHANNEL_NUM_PATHS,
    CHANNEL_PATH_DELAYS,
    CHANNEL_PATH_GAINS,
    CHANNEL_DOPPLER_HZ
};

// -----------------------------------------------------------------------
// IQ pack / unpack (same convention as every other block)
// -----------------------------------------------------------------------
static void unpackIQ(const int8_t* src, double& I, double& Q) {
    uint8_t iLo = (uint8_t)((int32_t)src[0] + 128);
    uint8_t iHi = (uint8_t)((int32_t)src[1] + 128);
    uint8_t qLo = (uint8_t)((int32_t)src[2] + 128);
    uint8_t qHi = (uint8_t)((int32_t)src[3] + 128);
    I = (double)(int16_t)((uint16_t)iLo | ((uint16_t)iHi << 8)) / 32767.0;
    Q = (double)(int16_t)((uint16_t)qLo | ((uint16_t)qHi << 8)) / 32767.0;
}

static void packIQ(int8_t* dst, double I, double Q) {
    if (I >  1.0) I =  1.0; if (I < -1.0) I = -1.0;
    if (Q >  1.0) Q =  1.0; if (Q < -1.0) Q = -1.0;
    int16_t iVal = (int16_t)round(I * 32767.0);
    int16_t qVal = (int16_t)round(Q * 32767.0);
    uint16_t iu = (uint16_t)iVal, qu = (uint16_t)qVal;
    dst[0] = (int8_t)((int32_t)(uint8_t)(iu & 0xFF)        - 128);
    dst[1] = (int8_t)((int32_t)(uint8_t)((iu >> 8) & 0xFF) - 128);
    dst[2] = (int8_t)((int32_t)(uint8_t)(qu & 0xFF)        - 128);
    dst[3] = (int8_t)((int32_t)(uint8_t)((qu >> 8) & 0xFF) - 128);
}

// -----------------------------------------------------------------------
// Channel models
// -----------------------------------------------------------------------
using cx = std::complex<double>;

// AWGN: adds Gaussian noise scaled to achieve the requested SNR.
// Signal power is estimated from the actual samples so the noise level
// tracks the true signal energy rather than a fixed reference.
static void applyAWGN(cx* s, int n, double snr_db, std::mt19937_64& rng) {
    double sigPow = 0.0;
    for (int i = 0; i < n; i++) sigPow += std::norm(s[i]);
    sigPow /= n;
    if (sigPow < 1e-12) return;

    double noisePow = sigPow / pow(10.0, snr_db / 10.0);
    double sigma    = sqrt(noisePow / 2.0);
    std::normal_distribution<double> nd(0.0, sigma);
    for (int i = 0; i < n; i++) s[i] += cx(nd(rng), nd(rng));
}

// Rayleigh flat fading: one random complex coefficient per OFDM symbol.
static void applyRayleigh(cx* sym, int nSamples, std::mt19937_64& rng) {
    std::normal_distribution<double> nd(0.0, 1.0 / sqrt(2.0));
    cx h(nd(rng), nd(rng));
    for (int i = 0; i < nSamples; i++) sym[i] *= h;
}

// Rician fading: LOS component + scattered component per OFDM symbol.
static void applyRician(cx* sym, int nSamples, double K, std::mt19937_64& rng) {
    double los = sqrt(K / (K + 1.0));
    double sc  = sqrt(1.0 / (2.0 * (K + 1.0)));
    std::normal_distribution<double> nd(0.0, sc);
    cx h(los + nd(rng), nd(rng));
    for (int i = 0; i < nSamples; i++) sym[i] *= h;
}

// Multipath: tapped-delay-line convolution across the full packet.
static void applyMultipath(cx* pkt, int n, const ChannelParams& p) {
    std::vector<cx> out(n, cx(0.0, 0.0));
    for (int path = 0; path < p.num_paths; path++) {
        int    delay = (int)round(p.path_delays[path]);
        double gain  = pow(10.0, p.path_gains_db[path] / 20.0);
        int    start = (delay < n) ? delay : n;
        for (int i = start; i < n; i++) out[i] += gain * pkt[i - delay];
    }
    for (int i = 0; i < n; i++) pkt[i] = out[i];
}

// -----------------------------------------------------------------------
// Block state
// -----------------------------------------------------------------------
struct ChannelData {
    int frameCount;
    std::mt19937_64 rng;
};

ChannelData init_channel(const BlockConfig& config) {
    ChannelData data;
    data.frameCount = 0;
    data.rng = std::mt19937_64(std::random_device{}());

    const char* names[] = { "PASSTHROUGH", "AWGN", "RAYLEIGH", "RICIAN", "MULTIPATH" };
    printf("[Channel] Config: type=%s  snr_db=%.1f  K=%.2f  paths=%d\n",
           names[g_params.type], g_params.snr_db, g_params.K_factor, g_params.num_paths);
    fflush(stdout);
    return data;
}

void process_channel(
    const char**  pipeIn,
    const char**  pipeOut,
    ChannelData&  customData,
    const BlockConfig& config
) {
    PipeIO inTime (pipeIn[0],  config.inputPacketSizes[0],  config.inputBatchSizes[0]);
    PipeIO outTime(pipeOut[0], config.outputPacketSizes[0], config.outputBatchSizes[0]);

    int8_t* inBuf  = new int8_t[inTime.getBufferSize()];
    int8_t* outBuf = new int8_t[outTime.getBufferSize()];

    const int inPkt  = config.inputPacketSizes[0];
    const int outPkt = config.outputPacketSizes[0];
    const bool firstBatch = (customData.frameCount == 0);

    int actualCount = inTime.read(inBuf);

    // Start with a full copy (handles passthrough and preserves trailing metadata)
    memcpy(outBuf, inBuf, (size_t)inTime.getBufferSize());

    for (int pkt = 0; pkt < actualCount; pkt++) {
        const int8_t* src = inBuf  + pkt * inPkt;
        int8_t*       dst = outBuf + pkt * outPkt;

        // Read actual symbol count stored in last 4 bytes by batch_ifft
        uint32_t actualSyms = 0;
        for (int j = 0; j < 4; j++)
            actualSyms |= ((uint32_t)(uint8_t)((int32_t)src[inPkt - 4 + j] + 128)) << (j * 8);
        if (actualSyms == 0 || actualSyms > (uint32_t)SYMBOLS_PER_PKT)
            actualSyms = SYMBOLS_PER_PKT;

        int totalSamples = (int)actualSyms * SAMPLES_PER_SYM;

        if (g_params.type != CH_PASSTHROUGH) {
            // Unpack all IQ samples
            std::vector<cx> s(totalSamples);
            for (int i = 0; i < totalSamples; i++) {
                double I, Q;
                unpackIQ(src + i * BYTES_PER_SAMPLE, I, Q);
                s[i] = cx(I, Q);
            }

            // Apply channel model
            switch (g_params.type) {
            case CH_AWGN:
                applyAWGN(s.data(), totalSamples, g_params.snr_db, customData.rng);
                break;

            case CH_RAYLEIGH:
                for (uint32_t sym = 0; sym < actualSyms; sym++)
                    applyRayleigh(s.data() + sym * SAMPLES_PER_SYM, SAMPLES_PER_SYM, customData.rng);
                applyAWGN(s.data(), totalSamples, g_params.snr_db, customData.rng);
                break;

            case CH_RICIAN:
                for (uint32_t sym = 0; sym < actualSyms; sym++)
                    applyRician(s.data() + sym * SAMPLES_PER_SYM, SAMPLES_PER_SYM,
                                g_params.K_factor, customData.rng);
                applyAWGN(s.data(), totalSamples, g_params.snr_db, customData.rng);
                break;

            case CH_MULTIPATH:
                applyMultipath(s.data(), totalSamples, g_params);
                applyAWGN(s.data(), totalSamples, g_params.snr_db, customData.rng);
                break;

            default: break;
            }

            // Pack back (do NOT touch the last 4 metadata bytes — memcpy already set them)
            for (int i = 0; i < totalSamples; i++)
                packIQ(dst + i * BYTES_PER_SAMPLE, s[i].real(), s[i].imag());
        }

        if (firstBatch && pkt == 0) {
            const char* names[] = { "PASSTHROUGH", "AWGN", "RAYLEIGH", "RICIAN", "MULTIPATH" };
            printf("[Channel] pkt[0] INPUT : %u syms x %d bytes\n", actualSyms, BYTES_PER_SYM);
            printf("[Channel] pkt[0] OUTPUT: %u syms  type=%s  snr=%.1f dB\n",
                   actualSyms, names[g_params.type], g_params.snr_db);
            fflush(stdout);
        }
    }

    outTime.write(outBuf, actualCount);
    customData.frameCount += actualCount;

    delete[] inBuf;
    delete[] outBuf;
}

// -----------------------------------------------------------------------
// main
// -----------------------------------------------------------------------
int main(int argc, char* argv[]) {
    if (argc < 3) {
        fprintf(stderr, "Usage: channel <pipeInTime> <pipeOutTime>\n");
        return 1;
    }

    const char* pipeIns[]  = { argv[1] };
    const char* pipeOuts[] = { argv[2] };

    BlockConfig config = {
        "Channel",
        1,                  // inputs
        1,                  // outputs
        {162560},           // inputPacketSizes  [508 syms * 320 bytes]
        {64},               // inputBatchSizes
        {162560},           // outputPacketSizes [508 syms * 320 bytes]
        {64},               // outputBatchSizes
        false,              // ltr
        true,               // startWithAll
        "IEEE 802.11a channel simulator: AWGN | Rayleigh | Rician | Multipath"
    };

    run_manual_block(pipeIns, pipeOuts, config, process_channel, init_channel);
    return 0;
}
