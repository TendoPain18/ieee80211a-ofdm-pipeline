#include "core/run_generic_block.h"
#include <cstring>
#include <cstdint>
#include <cstdio>
#include <string>

// ============================================================
// Scatter Plot Sink — Channel Equalizer output
//
// Identical in structure to scatter_plot_fft / scatter_plot_qam.
// Reads the 200 MB scatter pipe written by channel_equalizer
// and streams IQ points to the Electron UI as JSON.
//
// Wire format (written by channel_equalizer):
//   Bytes [0..3] : uint32_t LE = actual IQ data bytes that follow
//   Bytes [4..]  : IQ samples  [I_lo, I_hi, Q_lo, Q_hi]
//                  int8 convention: pipe byte = int8_t(uint8_t(B) − 128)
//
// JSON sent per batch (newline-terminated):
//   {"protocol":"CPP_V1","type":"BLOCK_GRAPH_BATCH",
//    "blockId":<N>,"blockName":"<name>","points":[[I,Q],...]}
//
// Set ENABLED = false to silently drain the pipe without any
// socket/JSON overhead (useful for performance runs).
//
// Inputs  : 1  (200 MB scatter pipe, batchSize = 1)
// Outputs : 0  (sink)
// ============================================================

static const bool ENABLED = true;   // false → drain silently

static const int SCATTER_PIPE_BYTES = 209715200;
static const int BYTES_PER_SAMPLE   = 4;
static const int HEADER_BYTES       = 4;   // uint32 LE size prefix

// -----------------------------------------------------------------------
// Unpack one IQ pair from 4 pipe bytes → double [-1, +1]
// -----------------------------------------------------------------------
static void unpackIQ(const int8_t* src, double& I, double& Q) {
    uint8_t iLo = (uint8_t)((int32_t)src[0] + 128);
    uint8_t iHi = (uint8_t)((int32_t)src[1] + 128);
    uint8_t qLo = (uint8_t)((int32_t)src[2] + 128);
    uint8_t qHi = (uint8_t)((int32_t)src[3] + 128);
    I = (double)(int16_t)((uint16_t)iLo | ((uint16_t)iHi << 8)) / 32767.0;
    Q = (double)(int16_t)((uint16_t)qLo | ((uint16_t)qHi << 8)) / 32767.0;
}

// -----------------------------------------------------------------------
// Blocking TCP send (handles partial sends)
// -----------------------------------------------------------------------
static bool tcpSend(SOCKET sock, const char* data, int len) {
    while (len > 0) {
        int sent = ::send(sock, data, len, 0);
        if (sent == SOCKET_ERROR || sent <= 0) return false;
        data += sent;
        len  -= sent;
    }
    return true;
}

// -----------------------------------------------------------------------
// Open a plain TCP connection to 127.0.0.1:port (with retries)
// -----------------------------------------------------------------------
static SOCKET connectRawSocket(int port, int maxRetries) {
    WSADATA wsaData;
    WSAStartup(MAKEWORD(2, 2), &wsaData);

    for (int attempt = 0; attempt < maxRetries; attempt++) {
        SOCKET s = ::socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        if (s == INVALID_SOCKET) { Sleep(300); continue; }

        sockaddr_in addr;
        addr.sin_family = AF_INET;
        addr.sin_port   = htons((u_short)port);
        inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);

        if (::connect(s, (sockaddr*)&addr, sizeof(addr)) == 0) {
            printf("[ScatterPlotEq] Connected to CPP_PORT=%d\n", port);
            return s;
        }
        closesocket(s);
        Sleep(300);
    }
    fprintf(stderr, "[ScatterPlotEq] WARNING: Could not connect to CPP_PORT=%d\n", port);
    return INVALID_SOCKET;
}

// -----------------------------------------------------------------------
// Block state
// -----------------------------------------------------------------------
struct ScatterPlotEqData {
    int    frameCount;
    int    blockId;
    int    cppPort;
    SOCKET rawSock;
    bool   socketReady;
    char   blockName[64];
};

ScatterPlotEqData init_scatter_plot_eq(const BlockConfig& config) {
    ScatterPlotEqData data;
    data.frameCount  = 0;
    data.blockId     = getEnvInt("BLOCK_ID", 0);
    data.cppPort     = getEnvInt("CPP_PORT", 9002);
    data.socketReady = false;
    data.rawSock     = INVALID_SOCKET;
    strncpy(data.blockName, config.name, sizeof(data.blockName) - 1);
    data.blockName[sizeof(data.blockName) - 1] = '\0';

    if (ENABLED) {
        data.rawSock     = connectRawSocket(data.cppPort, 20);
        data.socketReady = (data.rawSock != INVALID_SOCKET);
    }
    return data;
}

void process_scatter_plot_eq(
    const char**        pipeIn,
    const char**        /*pipeOut*/,
    ScatterPlotEqData&  customData,
    const BlockConfig&  config)
{
    const int inPktSize   = config.inputPacketSizes[0];
    const int inBatch     = config.inputBatchSizes[0];
    const int lengthBytes = calculateLengthBytes(inBatch);
    const int totalBuf    = lengthBytes + inPktSize * inBatch;

    int8_t* rawBuf = new int8_t[totalBuf];
    memset(rawBuf, 0x80, totalBuf);

    int actualCount = readBatch(pipeIn[0], rawBuf, lengthBytes, totalBuf);

    if (actualCount <= 0) {
        delete[] rawBuf;
        return;
    }

    customData.frameCount++;

    const uint8_t* pkt = (const uint8_t*)(rawBuf + lengthBytes);

    // Extract uint32 LE actual IQ data size
    uint32_t iqDataBytes = 0;
    iqDataBytes |= (uint32_t)pkt[0];
    iqDataBytes |= (uint32_t)pkt[1] << 8;
    iqDataBytes |= (uint32_t)pkt[2] << 16;
    iqDataBytes |= (uint32_t)pkt[3] << 24;

    if (!ENABLED) {
        delete[] rawBuf;
        return;
    }

    if (!customData.socketReady || iqDataBytes == 0) {
        delete[] rawBuf;
        return;
    }

    // Clamp to what was actually written
    uint32_t maxIq = (uint32_t)(inPktSize - HEADER_BYTES);
    if (iqDataBytes > maxIq) {
        fprintf(stderr, "[ScatterPlotEq] clamping iqDataBytes %u -> %u\n",
                iqDataBytes, maxIq);
        iqDataBytes = maxIq;
    }

    const int8_t* iqPtr     = (const int8_t*)(pkt + HEADER_BYTES);
    int           numSamples = (int)(iqDataBytes / BYTES_PER_SAMPLE);

    if (numSamples == 0) {
        delete[] rawBuf;
        return;
    }

    // Build JSON
    std::string json;
    json.reserve((size_t)numSamples * 28 + 200);

    {
        char hdr[256];
        snprintf(hdr, sizeof(hdr),
            "{\"protocol\":\"CPP_V1\","
            "\"type\":\"BLOCK_GRAPH_BATCH\","
            "\"blockId\":%d,"
            "\"blockName\":\"%s\","
            "\"points\":[",
            customData.blockId,
            customData.blockName);
        json += hdr;
    }

    char pointBuf[48];
    for (int i = 0; i < numSamples; i++) {
        double I, Q;
        unpackIQ(iqPtr + i * BYTES_PER_SAMPLE, I, Q);
        int n = snprintf(pointBuf, sizeof(pointBuf), "[%.5f,%.5f]", I, Q);
        json.append(pointBuf, n);
        if (i < numSamples - 1) json += ',';
    }

    json += "]}\n";

    // Send; reconnect once on failure
    if (!tcpSend(customData.rawSock, json.c_str(), (int)json.size())) {
        fprintf(stderr, "[ScatterPlotEq] Send failed — reconnecting...\n");
        closesocket(customData.rawSock);
        customData.rawSock     = connectRawSocket(customData.cppPort, 5);
        customData.socketReady = (customData.rawSock != INVALID_SOCKET);
        if (customData.socketReady)
            tcpSend(customData.rawSock, json.c_str(), (int)json.size());
    }

    delete[] rawBuf;
}

int main(int argc, char* argv[]) {
    if (argc < 2) {
        fprintf(stderr, "Usage: scatter_plot_eq <pipeInScatter>\n");
        return 1;
    }

    const char* pipeIns[]  = {argv[1]};
    const char* pipeOuts[] = {};

    BlockConfig config = {
        "ScatterPlotEq",
        1,             // inputs
        0,             // outputs (sink)
        {209715200},   // inputPacketSizes  [200 MB scatter pipe]
        {1},           // inputBatchSizes
        {},            // outputPacketSizes
        {},            // outputBatchSizes
        true,          // ltr
        true,          // startWithAll
        "Scatter plot sink for channel equalizer output"
    };

    run_manual_block(pipeIns, pipeOuts, config,
                     process_scatter_plot_eq,
                     init_scatter_plot_eq);
    return 0;
}
