const fs = require("fs");
const path = require("path");
const EventEmitter = require("events");

class PCAPEngine extends EventEmitter {
  constructor() {
    super();
    this.streams = new Map();
    this.streamCounter = 0;
    this.stats = {
      totalConnections: 0,
      successfulConnections: 0,
      unsuccessfulConnections: 0,
      activeConnections: 0
    };
    this.logDir = path.join(__dirname, "../../logs/pcap");
    fs.mkdirSync(this.logDir, { recursive: true });
  }

  formatHexDump(buffer) {
    let result = "";
    const len = buffer.length;
    for (let i = 0; i < len; i += 16) {
      const offset = i.toString(16).padStart(8, "0");
      const hexChunk = [];
      const asciiChunk = [];
      for (let j = 0; j < 16; j++) {
        if (i + j < len) {
          const b = buffer[i + j];
          hexChunk.push(b.toString(16).padStart(2, "0"));
          asciiChunk.push(b >= 32 && b <= 126 ? String.fromCharCode(b) : ".");
        } else {
          hexChunk.push("  ");
        }
      }
      result += `${offset}  ${hexChunk.slice(0, 8).join(" ")}  ${hexChunk.slice(8).join(" ")}  |${asciiChunk.join("")}|\n`;
    }
    return result.trim();
  }

  formatAscii(buffer) {
    let result = "";
    for (let i = 0; i < buffer.length; i++) {
      const b = buffer[i];
      result += b >= 32 && b <= 126 ? String.fromCharCode(b) : (b === 10 || b === 13 ? String.fromCharCode(b) : ".");
    }
    return result;
  }

  createStream(service, srcIP, srcPort, dstPort) {
    this.streamCounter++;
    const streamId = `pcap_${Date.now()}_${this.streamCounter}`;
    const now = new Date().toISOString();

    const stream = {
      id: streamId,
      service: service.toUpperCase(),
      srcIP: (srcIP || "127.0.0.1").replace(/^::ffff:/, ""),
      srcPort: srcPort || 0,
      dstPort: dstPort || 0,
      startTime: now,
      endTime: null,
      status: "ACTIVE", // ACTIVE, SUCCESSFUL, FAILED
      packetCount: 0,
      bytesClient: 0,
      bytesServer: 0,
      packets: [],
      authCaptured: false,
      username: null
    };

    // Synthesize Handshake Packets (Syn -> Syn-Ack -> Ack)
    const synPacket = {
      index: 1,
      timestamp: now,
      direction: "C_TO_S",
      type: "HANDSHAKE",
      info: `[SYN] Seq=0 Win=64240 Len=0 MSS=1460`,
      len: 0,
      hex: "00000000  53 59 4e 20 48 41 4e 44 53 48 41 4b 45          |SYN HANDSHAKE|",
      ascii: "[TCP SYN HANDSHAKE]"
    };

    const synAckPacket = {
      index: 2,
      timestamp: new Date().toISOString(),
      direction: "S_TO_C",
      type: "HANDSHAKE",
      info: `[SYN, ACK] Seq=0 Ack=1 Win=65535 Len=0`,
      len: 0,
      hex: "00000000  53 59 4e 2d 41 43 4b 20 48 41 4e 44 53 48 41 4b  |SYN-ACK HANDSHAKE|",
      ascii: "[TCP SYN-ACK HANDSHAKE]"
    };

    stream.packets.push(synPacket, synAckPacket);
    stream.packetCount = 2;

    this.streams.set(streamId, stream);
    this.stats.totalConnections++;
    this.stats.activeConnections++;

    this.emit("stream_start", stream);
    return streamId;
  }

  recordPacket(streamId, direction, data, infoLabel = null) {
    const stream = this.streams.get(streamId);
    if (!stream) return;

    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (buffer.length === 0) return;

    stream.packetCount++;
    const now = new Date().toISOString();

    if (direction === "C_TO_S") {
      stream.bytesClient += buffer.length;
    } else {
      stream.bytesServer += buffer.length;
    }

    const packet = {
      index: stream.packetCount,
      timestamp: now,
      direction: direction, // C_TO_S (Client to Server) or S_TO_C (Server to Client)
      type: "DATA",
      info: infoLabel || (direction === "C_TO_S" ? `[CLIENT DATA] ${buffer.length} bytes` : `[SERVER DATA] ${buffer.length} bytes`),
      len: buffer.length,
      hex: this.formatHexDump(buffer),
      ascii: this.formatAscii(buffer)
    };

    stream.packets.push(packet);
    this.emit("packet", { streamId, packet, stream });
  }

  markStatus(streamId, status, username = null) {
    const stream = this.streams.get(streamId);
    if (!stream) return;

    if (username) {
      stream.username = username;
      stream.authCaptured = true;
    }

    if (stream.status === "ACTIVE") {
      this.stats.activeConnections = Math.max(0, this.stats.activeConnections - 1);
      if (status === "SUCCESSFUL") {
        this.stats.successfulConnections++;
      } else if (status === "FAILED") {
        this.stats.unsuccessfulConnections++;
      }
    }

    stream.status = status;
    stream.endTime = new Date().toISOString();

    // Synthesize Fin Packet
    stream.packetCount++;
    const finPacket = {
      index: stream.packetCount,
      timestamp: stream.endTime,
      direction: "C_TO_S",
      type: "FINISH",
      info: `[FIN, ACK] Connection closed by client`,
      len: 0,
      hex: "00000000  46 49 4e 20 41 43 4b 20 43 4c 4f 53 45          |FIN ACK CLOSE|",
      ascii: "[TCP FIN CLOSE]"
    };
    stream.packets.push(finPacket);

    // Save stream file to logs
    try {
      const filePath = path.join(this.logDir, `${stream.id}.json`);
      fs.writeFileSync(filePath, JSON.stringify(stream, null, 2));
    } catch {}

    this.emit("stream_end", stream);
  }

  getStats() {
    return {
      ...this.stats,
      activeCount: Array.from(this.streams.values()).filter(s => s.status === "ACTIVE").length,
      totalStreams: this.streams.size
    };
  }

  getStreamsSummary() {
    return Array.from(this.streams.values()).map(s => ({
      id: s.id,
      service: s.service,
      srcIP: s.srcIP,
      srcPort: s.srcPort,
      dstPort: s.dstPort,
      startTime: s.startTime,
      endTime: s.endTime,
      status: s.status,
      packetCount: s.packetCount,
      totalBytes: s.bytesClient + s.bytesServer,
      username: s.username
    })).reverse();
  }

  getStreamDetail(streamId) {
    return this.streams.get(streamId) || null;
  }
}

const pcapEngine = new PCAPEngine();
module.exports = pcapEngine;
