#include "core/run_generic_block.h"
#include <cstring>
#include <cstdint>
#include <cmath>
#include <cstdio>
#include <complex>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

// ============================================================
// IEEE 802.11a Pilot-based Channel Equalizer (Frequency Domain)
//
// Sits between batch_fft and qam_demapper.
//
// Algorithm (per OFDM symbol):
//   1. Rebuild expected pilot values using the same 127-bit LFSR
//      as qam_mapper (pilots are ±1 real-valued).
//   2. Read the 4 received pilot subcarriers (indices 11,25,39,53).
//   3. Estimate H at each pilot: H_p = received / expected.
//   4. Linearly interpolate H across all 64 subcarrier bins
//      (nearest-pilot extrapolation beyond the edge pilots).
//   5. Equalize every data subcarrier: Y_eq = Y_rx / H_interp.
//
// Inputs:
//   in[0]: Stacked freq-domain IQ blocks from batch_fft
//             (129024 bytes/pkt = 504 blocks × 256 bytes)
//             Block 0   = SIGNAL  (pilot symIdx 0)
//             Blocks 1+ = DATA    (pilot symIdx = block index)
//
// Outputs:
//   out[0]: Equalized freq-domain IQ blocks  (129024 bytes/pkt)
//   out[1]: Scatter plot data                (200 MB pipe)
// ============================================================

// ---- Scatter configuration ------------------------------------
static const bool SCATTER_ENABLED = true;
static const int  SCATTER_PACKETS = 1;       // how many input pkts to scatter-plot
static const bool PLOT_SIGNAL     = true;    // include SIGNAL block in scatter
static const bool PLOT_DATA       = true;    // include DATA blocks in scatter
static const bool PLOT_PILOTS     = false;   // include pilot subcarriers
static const bool PLOT_NULLS      = false;   // include null/guard subcarriers

// ---- Packet geometry ------------------------------------------
static const int SYMBOLS_PER_PKT   = 504;
static const int SUBCARRIERS       = 64;
static const int BYTES_PER_BLOCK   = SUBCARRIERS * 4;                     // 256
static const int IN_PKT_SIZE       = SYMBOLS_PER_PKT * BYTES_PER_BLOCK;   // 129024
static const int SCATTER_PIPE_BYTES = 209715200;

// ---- Pilot subcarrier indices (after fftshift, 0-based) -------
//   frequency  -21 → index 11
//   frequency   -7 → index 25
//   frequency   +7 → index 39
//   frequency  +21 → index 53
static const int PILOT_SC[4] = {11, 25, 39, 53};
static const int NUM_PILOTS  = 4;

// ---- Global lookup tables -------------------------------------
static bool   g_isDataSC [64];
static bool   g_isPilotSC[64];
static int8_t g_pilotSeq [127];  // ±1 values matching qam_mapper's LFSR

// ---------------------------------------------------------------
// Rebuild the exact same 127-chip pilot LFSR used in qam_mapper
// ---------------------------------------------------------------
static void buildPilotSeq() {
    uint8_t state[7] = {1, 1, 1, 1, 1, 1, 1};
    for (int n = 0; n < 127; n++) {
        uint8_t bit = state[6] ^ state[3];
        for (int s = 6; s > 0; s--) state[s] = state[s - 1];
        state[0] = bit;
        g_pilotSeq[n] = (bit == 0) ? 1 : -1;
    }
}

static void buildSubcarrierMaps() {
    memset(g_isDataSC,  false, sizeof(g_isDataSC));
    memset(g_isPilotSC, false, sizeof(g_isPilotSC));

    const int dataFreqs[] = {
        -26,-25,-24,-23,-22,
        -20,-19,-18,-17,-16,-15,-14,-13,-12,-11,-10,-9,-8,
        -6,-5,-4,-3,-2,-1,
        1,2,3,4,5,6,
        8,9,10,11,12,13,14,15,16,17,18,19,20,
        22,23,24,25,26
    };
    for (int f : dataFreqs) g_isDataSC[f + 32] = true;

    const int pilotFreqs[] = {-21, -7, 7, 21};
    for (int f : pilotFreqs) g_isPilotSC[f + 32] = true;
}

// ---------------------------------------------------------------
// IQ pack / unpack  (standard int8 convention)
// ---------------------------------------------------------------
static void unpackIQ(const int8_t* src, double& I, double& Q) {
    uint8_t iLo = (uint8_t)((int32_t)src[0] + 128);
    uint8_t iHi = (uint8_t)((int32_t)src[1] + 128);
    uint8_t qLo = (uint8_t)((int32_t)src[2] + 128);
    uint8_t qHi = (uint8_t)((int32_t)src[3] + 128);
    I = (double)(int16_t)((uint16_t)iLo | ((uint16_t)iHi << 8)) / 32767.0;
    Q = (double)(int16_t)((uint16_t)qLo | ((uint16_t)qHi << 8)) / 32767.0;
}

static void packIQ(int8_t* dst, double I, double Q) {
    if (I >  1.0) I =  1.0;
    if (I < -1.0) I = -1.0;
    if (Q >  1.0) Q =  1.0;
    if (Q < -1.0) Q = -1.0;
    int16_t  iVal = (int16_t)round(I * 32767.0);
    int16_t  qVal = (int16_t)round(Q * 32767.0);
    uint16_t iu   = (uint16_t)iVal;
    uint16_t qu   = (uint16_t)qVal;
    dst[0] = (int8_t)((int32_t)(uint8_t)( iu        & 0xFF) - 128);
    dst[1] = (int8_t)((int32_t)(uint8_t)((iu >> 8)  & 0xFF) - 128);
    dst[2] = (int8_t)((int32_t)(uint8_t)( qu        & 0xFF) - 128);
    dst[3] = (int8_t)((int32_t)(uint8_t)((qu >> 8)  & 0xFF) - 128);
}

// ---------------------------------------------------------------
// Core equalization for one OFDM block
//
// symIdx = index used by qam_mapper when writing pilots:
//   Block 0  (SIGNAL) was sent with mapper symIdx = 0
//   Block k  (DATA)   was sent with mapper symIdx = k
//   → pass symIdx = sym (the block index in the FFT output)
// ---------------------------------------------------------------
static void equalizeBlock(const int8_t* inBlock,
                           int8_t*       outBlock,
                           int           symIdx)
{
    using cx = std::complex<double>;

    // --- Step 1: read all 64 received subcarriers ---
    cx sc[64];
    for (int k = 0; k < 64; k++) {
        double I, Q;
        unpackIQ(inBlock + k * 4, I, Q);
        sc[k] = cx(I, Q);
    }

    // --- Step 2: expected pilot value for this symbol (±1, real) ---
    double pilotVal = (double)g_pilotSeq[symIdx % 127];

    // --- Step 3: H estimate at each of the 4 pilot subcarriers ---
    //   H_p = Y_received / X_expected
    cx H_pilots[4];
    for (int p = 0; p < NUM_PILOTS; p++) {
        cx Yrx = sc[PILOT_SC[p]];
        H_pilots[p] = Yrx / cx(pilotVal, 0.0);
    }

    // --- Step 4: linearly interpolate H across all 64 bins ---
    //   Outside the first/last pilot: hold nearest estimate (flat extrapolation)
    cx H_interp[64];

    for (int k = 0; k < 64; k++) {
        if (k <= PILOT_SC[0]) {
            // Left of first pilot → hold
            H_interp[k] = H_pilots[0];

        } else if (k >= PILOT_SC[NUM_PILOTS - 1]) {
            // Right of last pilot → hold
            H_interp[k] = H_pilots[NUM_PILOTS - 1];

        } else {
            // Find the two pilots that bracket bin k
            int lo = 0, hi = 1;
            for (int p = 0; p < NUM_PILOTS - 1; p++) {
                if (k >= PILOT_SC[p] && k <= PILOT_SC[p + 1]) {
                    lo = p;
                    hi = p + 1;
                    break;
                }
            }
            double span = (double)(PILOT_SC[hi] - PILOT_SC[lo]);
            double t    = (double)(k - PILOT_SC[lo]) / span;   // 0 … 1
            H_interp[k] = H_pilots[lo] * (1.0 - t) + H_pilots[hi] * t;
        }
    }

    // --- Step 5: apply equalization and write output ---
    for (int k = 0; k < 64; k++) {
        if (g_isDataSC[k]) {
            // Equalize data subcarrier: divide by channel estimate
            double hMag2 = std::norm(H_interp[k]);
            if (hMag2 > 1e-12) {
                cx corrected = sc[k] / H_interp[k];
                packIQ(outBlock + k * 4, corrected.real(), corrected.imag());
            } else {
                // Degenerate channel: pass through unchanged
                memcpy(outBlock + k * 4, inBlock + k * 4, 4);
            }
        } else {
            // Pilot / null subcarrier: copy unchanged
            memcpy(outBlock + k * 4, inBlock + k * 4, 4);
        }
    }
}

// ---------------------------------------------------------------
// Scatter helper  (same convention as batch_fft)
// ---------------------------------------------------------------
static int appendToScatter(
    const int8_t* freqBlock,
    int8_t*       scatterDst,
    int           bytesWritten,
    int           maxBytes,
    int           symIdx)
{
    bool includeBlock = (symIdx == 0) ? PLOT_SIGNAL : PLOT_DATA;
    if (!includeBlock) return 0;

    int added = 0;
    for (int sc = 0; sc < SUBCARRIERS; sc++) {
        bool isData  = g_isDataSC [sc];
        bool isPilot = g_isPilotSC[sc];
        bool isNull  = !isData && !isPilot;

        bool include = false;
        if (isData)  include = true;
        if (isPilot) include = PLOT_PILOTS;
        if (isNull)  include = PLOT_NULLS;

        if (include) {
            if (bytesWritten + added + 4 > maxBytes) break;
            memcpy(scatterDst + bytesWritten + added, freqBlock + sc * 4, 4);
            added += 4;
        }
    }
    return added;
}

// ---------------------------------------------------------------
// Block state
// ---------------------------------------------------------------
struct ChannelEqualizerData { int frameCount; };

ChannelEqualizerData init_channel_equalizer(const BlockConfig& config) {
    ChannelEqualizerData data;
    data.frameCount = 0;
    buildPilotSeq();
    buildSubcarrierMaps();
    printf("[ChannelEqualizer] Pilot indices (after fftshift): 11 25 39 53\n");
    printf("[ChannelEqualizer] Method: per-symbol pilot H estimate + linear interpolation\n");
    fflush(stdout);
    return data;
}

// ---------------------------------------------------------------
// Process function
// ---------------------------------------------------------------
void process_channel_equalizer(
    const char**           pipeIn,
    const char**           pipeOut,
    ChannelEqualizerData&  customData,
    const BlockConfig&     config)
{
    PipeIO inFreq    (pipeIn[0],  config.inputPacketSizes[0],  config.inputBatchSizes[0]);
    PipeIO outFreq   (pipeOut[0], config.outputPacketSizes[0], config.outputBatchSizes[0]);
    PipeIO outScatter(pipeOut[1], config.outputPacketSizes[1], config.outputBatchSizes[1]);

    int8_t* inBuf  = new int8_t[inFreq.getBufferSize()];
    int8_t* outBuf = new int8_t[outFreq.getBufferSize()];

    const int inPkt      = config.inputPacketSizes[0];   // 129024
    const int outPkt     = config.outputPacketSizes[0];  // 129024
    const int scatterPkt = config.outputPacketSizes[1];

    const bool isFirstBatch = (customData.frameCount == 0);

    int actualCount = inFreq.read(inBuf);

    memset(outBuf, 0x80, outFreq.getBufferSize());

    // Scatter buffers (allocated only when SCATTER_ENABLED)
    int8_t* scatterBuf       = nullptr;
    int8_t* scatterPkt0      = nullptr;
    int8_t* scatterDataStart = nullptr;
    int     scatterDataBytes = 0;
    int     scatterMaxBytes  = 0;

    if (SCATTER_ENABLED) {
        scatterBuf       = new int8_t[outScatter.getBufferSize()];
        memset(scatterBuf, 0x80, outScatter.getBufferSize());
        scatterPkt0      = scatterBuf + calculateLengthBytes(1);
        scatterDataStart = scatterPkt0 + 4;
        scatterMaxBytes  = scatterPkt - 4;
    }

    for (int i = 0; i < actualCount; i++) {
        const int8_t* pktIn  = inBuf  + i * inPkt;
        int8_t*       pktOut = outBuf + i * outPkt;

        // Read actual symbol count from last 4 bytes (set by batch_fft)
        uint32_t actualSyms = 0;
        for (int j = 0; j < 4; j++)
            actualSyms |= ((uint32_t)(uint8_t)((int32_t)pktIn[inPkt - 4 + j] + 128)) << (j * 8);
        if (actualSyms == 0 || actualSyms > (uint32_t)SYMBOLS_PER_PKT)
            actualSyms = SYMBOLS_PER_PKT;

        // Process each block
        for (int sym = 0; sym < (int)actualSyms; sym++) {
            const int8_t* blkIn  = pktIn  + sym * BYTES_PER_BLOCK;
            int8_t*       blkOut = pktOut + sym * BYTES_PER_BLOCK;

            // sym == 0  → SIGNAL block (qam_mapper used pilot symIdx = 0)
            // sym == k  → kth block     (qam_mapper used pilot symIdx = k)
            equalizeBlock(blkIn, blkOut, sym);

            if (SCATTER_ENABLED && i < SCATTER_PACKETS) {
                scatterDataBytes += appendToScatter(
                    blkOut, scatterDataStart,
                    scatterDataBytes, scatterMaxBytes, sym);
                if (scatterDataBytes >= scatterMaxBytes) break;
            }
        }

        // Forward the actual symbol count in the last 4 bytes of output
        for (int j = 0; j < 4; j++) {
            uint8_t b = (uint8_t)((actualSyms >> (j * 8)) & 0xFF);
            pktOut[outPkt - 4 + j] = (int8_t)((int32_t)b - 128);
        }

        if (isFirstBatch && i == 0) {
            printf("[ChannelEqualizer] pkt[0] INPUT : %u blocks x 256 bytes\n", actualSyms);
            printf("[ChannelEqualizer] pkt[0] OUTPUT: %u equalized blocks x 256 bytes\n", actualSyms);
            fflush(stdout);
        }
    }

    outFreq.write(outBuf, actualCount);

    // Write scatter packet
    if (SCATTER_ENABLED) {
        uint32_t sz = (uint32_t)scatterDataBytes;
        uint8_t* hdr = (uint8_t*)scatterPkt0;
        hdr[0] = (uint8_t)( sz        & 0xFF);
        hdr[1] = (uint8_t)((sz >>  8) & 0xFF);
        hdr[2] = (uint8_t)((sz >> 16) & 0xFF);
        hdr[3] = (uint8_t)((sz >> 24) & 0xFF);
        scatterBuf[0] = (int8_t)((int32_t)(uint8_t)1 - 128);  // batch count = 1
        outScatter.write(scatterBuf, 1);
        delete[] scatterBuf;
    }

    customData.frameCount += actualCount;

    delete[] inBuf;
    delete[] outBuf;
}

// ---------------------------------------------------------------
// main
// ---------------------------------------------------------------
int main(int argc, char* argv[]) {
    if (argc < 4) {
        fprintf(stderr,
            "Usage: channel_equalizer <pipeInFreq> <pipeOutFreq> <pipeOutScatter>\n");
        return 1;
    }

    const char* pipeIns[]  = {argv[1]};
    const char* pipeOuts[] = {argv[2], argv[3]};

    BlockConfig config = {
        "ChannelEqualizer",
        1,                            // inputs
        2,                            // outputs
        {129024},                     // inputPacketSizes  [504 freq blocks × 256 bytes]
        {64},                         // inputBatchSizes
        {129024, 209715200},          // outputPacketSizes [equalized freq, scatter 200MB]
        {64, 1},                      // outputBatchSizes
        true,                         // ltr
        true,                         // startWithAll
        "IEEE 802.11a pilot-based channel equalizer: linear interpolation between pilots"
    };

    run_manual_block(pipeIns, pipeOuts, config,
                     process_channel_equalizer,
                     init_channel_equalizer);
    return 0;
}