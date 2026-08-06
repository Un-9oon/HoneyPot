const net = require("net");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const KEY_PATH = path.join(__dirname, "../config/ssh_host_key");

function ensureHostKey() {
  if (!fs.existsSync(KEY_PATH)) {
    fs.mkdirSync(path.dirname(KEY_PATH), { recursive: true });
    const { privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "pkcs1", format: "pem" },
      privateKeyEncoding: { type: "pkcs1", format: "pem" },
    });
    fs.writeFileSync(KEY_PATH, privateKey);
  }
}

class SSHHoneypot {
  constructor(bus, cfg, bind) {
    this.bus = bus;
    this.port = cfg.port || 2222;
    this.banner = cfg.banner || "SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.6";
    this.bind = bind;
    this.server = null;
    this.sessions = new Map();
  }

  async start() {
    ensureHostKey();

    this.server = net.createServer((socket) => {
      const srcIP = socket.remoteAddress?.replace("::ffff:", "") || "unknown";
      const srcPort = socket.remotePort || 0;
      const sessionId = crypto.randomUUID();
      const startTime = Date.now();
      const buffer = [];

      this.sessions.set(sessionId, { srcIP, srcPort, startTime, data: buffer, socket });

      socket.write(this.banner + "\r\n");

      this.bus.emit("connection", {
        service: "ssh", srcIP, srcPort, sessionId,
        timestamp: new Date().toISOString(),
      });

      socket.on("data", (data) => {
        const raw = data.toString("utf8", 0, 512);
        buffer.push(raw);

        if (raw.startsWith("SSH-")) return;

        const creds = this._extractCredentials(raw);
        if (creds) {
          this.bus.emit("attack", {
            service: "ssh", type: "login_attempt",
            srcIP, srcPort, sessionId,
            details: `user=${creds.username} pass=${creds.password}`,
            username: creds.username, password: creds.password,
            timestamp: new Date().toISOString(),
            raw: raw.substring(0, 200),
          });
        } else if (raw.length > 0) {
          this.bus.emit("attack", {
            service: "ssh", type: "data_received",
            srcIP, srcPort, sessionId,
            details: `${raw.length} bytes: ${raw.substring(0, 80).replace(/[^\x20-\x7e]/g, ".")}`,
            timestamp: new Date().toISOString(),
          });
        }
      });

      socket.on("error", () => {});
      socket.on("close", () => {
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        this.bus.emit("session_end", {
          service: "ssh", srcIP, srcPort, sessionId,
          duration: parseFloat(duration),
          dataSize: buffer.join("").length,
        });
        this.sessions.delete(sessionId);
      });

      setTimeout(() => {
        if (!socket.destroyed) {
          socket.write("Connection timed out.\r\n");
          socket.destroy();
        }
      }, 30000);
    });

    return new Promise((resolve, reject) => {
      this.server.on("error", reject);
      this.server.listen(this.port, this.bind, () => resolve());
    });
  }

  _extractCredentials(raw) {
    const patterns = [
      /(\w+):(\S+)/,
      /user(?:name)?[=:\s]+(\S+).*?pass(?:word)?[=:\s]+(\S+)/i,
    ];
    for (const p of patterns) {
      const m = raw.match(p);
      if (m) return { username: m[1], password: m[2] };
    }
    if (raw.includes("\x00")) {
      const parts = raw.split("\x00").filter(Boolean);
      if (parts.length >= 2) return { username: parts[0], password: parts[1] };
    }
    return null;
  }

  stop() {
    this.server?.close();
    for (const [, s] of this.sessions) {
      try { s.socket?.destroy(); } catch {}
    }
  }
}

module.exports = SSHHoneypot;
