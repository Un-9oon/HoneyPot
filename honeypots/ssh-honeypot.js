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

const pcapEngine = require("../monitoring/backend/pcap-engine");

let ssh2;
try { ssh2 = require("ssh2"); } catch { ssh2 = null; }

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

    if (!ssh2) {
      console.log("  [SSH] ssh2 not available, falling back to TCP banner mode");
      return this._startTcpFallback();
    }

    const hostKey = fs.readFileSync(KEY_PATH);

    this.server = new ssh2.Server({ hostKeys: [hostKey], banner: this.banner }, (client, info) => {
      const srcIP = info.ip || "unknown";
      const srcPort = info.port || 0;
      const sessionId = crypto.randomUUID();
      const startTime = Date.now();
      const pcapId = pcapEngine.createStream("ssh", srcIP, srcPort, this.port);
      const commands = [];
      let authedUser = null;

      this.sessions.set(sessionId, { srcIP, srcPort, startTime, client, pcapId });

      this.bus.emit("connection", {
        service: "ssh", srcIP, srcPort, sessionId,
        timestamp: new Date().toISOString(),
        clientSoftware: info.header?.versions?.software || "",
      });

      pcapEngine.recordPacket(pcapId, "C_TO_S", info.header?.versions?.software || "unknown", "[SSH] Client Identification");

      client.on("authentication", (ctx) => {
        const username = ctx.username;

        if (ctx.method === "password") {
          const password = ctx.password;
          pcapEngine.recordPacket(pcapId, "C_TO_S", `${username}:${password}`, "[AUTH] Password Authentication");

          this.bus.emit("attack", {
            service: "ssh", type: "credential_capture",
            srcIP, srcPort, sessionId,
            details: `user=${username} pass=${password}`,
            username, password,
            clientSoftware: info.header?.versions?.software || "",
            timestamp: new Date().toISOString(),
          });

          // Accept after a few attempts to lure attacker deeper
          const attempts = (this._authAttempts.get(sessionId) || 0) + 1;
          this._authAttempts.set(sessionId, attempts);

          if (attempts >= 3) {
            authedUser = username;
            pcapEngine.markStatus(pcapId, "SUCCESSFUL", username);
            ctx.accept();
          } else {
            pcapEngine.markStatus(pcapId, "FAILED", username);
            ctx.reject(["password"]);
          }
        } else if (ctx.method === "publickey") {
          this.bus.emit("attack", {
            service: "ssh", type: "login_attempt",
            srcIP, srcPort, sessionId,
            details: `pubkey_auth user=${username} algo=${ctx.key?.algo}`,
            username,
            timestamp: new Date().toISOString(),
          });
          ctx.reject(["password"]);
        } else if (ctx.method === "none") {
          ctx.reject(["password"]);
        } else {
          ctx.reject(["password"]);
        }
      });

      client.on("ready", () => {
        client.on("session", (accept) => {
          const session = accept();

          session.on("pty", (accept) => { if (accept) accept(); });
          session.on("window-change", () => {});

          session.on("shell", (accept) => {
            const stream = accept();
            const prompt = `${authedUser || "root"}@prod-web-01:~$ `;
            stream.write(`Last login: ${new Date(Date.now() - 3600000).toUTCString()} from 10.0.2.1\r\n`);
            stream.write(prompt);

            let lineBuf = "";
            stream.on("data", (data) => {
              const str = data.toString();
              for (const ch of str) {
                if (ch === "\r" || ch === "\n") {
                  const cmd = lineBuf.trim();
                  lineBuf = "";
                  if (!cmd) { stream.write("\r\n" + prompt); continue; }

                  commands.push(cmd);
                  pcapEngine.recordPacket(pcapId, "C_TO_S", cmd, `[CMD] ${cmd}`);

                  this.bus.emit("attack", {
                    service: "ssh", type: "command_execution",
                    srcIP, srcPort, sessionId,
                    details: `cmd: ${cmd}`,
                    command: cmd,
                    timestamp: new Date().toISOString(),
                  });

                  if (cmd === "exit" || cmd === "logout" || cmd === "quit") {
                    stream.write("\r\nlogout\r\n");
                    stream.close();
                    client.end();
                    return;
                  }

                  const resp = this._fakeResponse(cmd);
                  const output = resp ? resp.replace(/\n/g, "\r\n") + "\r\n" : "";
                  stream.write("\r\n" + output + prompt);
                  pcapEngine.recordPacket(pcapId, "S_TO_C", output, `[RESP] ${cmd}`);
                } else if (ch === "\x7f" || ch === "\b") {
                  if (lineBuf.length > 0) {
                    lineBuf = lineBuf.slice(0, -1);
                    stream.write("\b \b");
                  }
                } else if (ch === "\x03") {
                  lineBuf = "";
                  stream.write("^C\r\n" + prompt);
                } else {
                  lineBuf += ch;
                  stream.write(ch);
                }
              }
            });
          });

          session.on("exec", (accept, reject, info) => {
            const cmd = info.command;
            commands.push(cmd);
            this.bus.emit("attack", {
              service: "ssh", type: "command_execution",
              srcIP, srcPort, sessionId,
              details: `exec: ${cmd}`,
              command: cmd,
              timestamp: new Date().toISOString(),
            });
            const stream = accept();
            const resp = this._fakeResponse(cmd);
            if (resp) stream.write(resp + "\n");
            stream.exit(0);
            stream.close();
          });
        });
      });

      client.on("error", () => {
        pcapEngine.markStatus(pcapId, "FAILED");
      });

      client.on("close", () => {
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        this._authAttempts.delete(sessionId);
        this.bus.emit("session_end", {
          service: "ssh", srcIP, srcPort, sessionId,
          duration: parseFloat(duration),
          commandCount: commands.length,
          commands: commands.slice(0, 100),
        });
        this.sessions.delete(sessionId);
      });

      setTimeout(() => {
        try { client.end(); } catch {}
      }, 120000);
    });

    this._authAttempts = new Map();

    return new Promise((resolve, reject) => {
      this.server.on("error", reject);
      this.server.listen(this.port, this.bind, () => resolve());
    });
  }

  _startTcpFallback() {
    const net = require("net");
    this.server = net.createServer((socket) => {
      const srcIP = socket.remoteAddress?.replace("::ffff:", "") || "unknown";
      const srcPort = socket.remotePort || 0;
      const sessionId = crypto.randomUUID();
      const pcapId = pcapEngine.createStream("ssh", srcIP, srcPort, this.port);

      socket.write(this.banner + "\r\n");
      pcapEngine.recordPacket(pcapId, "S_TO_C", this.banner, "[BANNER] SSH Version Exchange");

      this.bus.emit("connection", {
        service: "ssh", srcIP, srcPort, sessionId,
        timestamp: new Date().toISOString(),
      });

      socket.on("data", (data) => {
        pcapEngine.recordPacket(pcapId, "C_TO_S", data);
        const raw = data.toString("utf8", 0, 512);
        if (!raw.startsWith("SSH-")) {
          this.bus.emit("attack", {
            service: "ssh", type: "data_received",
            srcIP, srcPort, sessionId,
            details: `${raw.length} bytes received`,
            timestamp: new Date().toISOString(),
          });
        }
      });

      socket.on("error", () => pcapEngine.markStatus(pcapId, "FAILED"));
      socket.on("close", () => {
        pcapEngine.markStatus(pcapId, "FAILED");
        this.bus.emit("session_end", { service: "ssh", srcIP, srcPort, sessionId });
        this.sessions.delete(sessionId);
      });

      setTimeout(() => { if (!socket.destroyed) socket.destroy(); }, 30000);
    });

    return new Promise((resolve, reject) => {
      this.server.on("error", reject);
      this.server.listen(this.port, this.bind, () => resolve());
    });
  }

  _fakeResponse(cmd) {
    const c = cmd.toLowerCase().trim();
    const parts = c.split(/\s+/);
    const base = parts[0];

    if (c === "whoami") return "root";
    if (c === "id") return "uid=0(root) gid=0(root) groups=0(root)";
    if (c === "uname -a") return "Linux prod-web-01 5.15.0-91-generic #101-Ubuntu SMP Tue Nov 14 13:30:08 UTC 2023 x86_64 GNU/Linux";
    if (c === "uname") return "Linux";
    if (c === "hostname") return "prod-web-01";
    if (c === "uptime") return " 14:23:01 up 127 days, 3:42, 1 user, load average: 0.12, 0.08, 0.04";
    if (c === "pwd") return "/root";
    if (c === "ls" || c === "dir") return "Desktop  Documents  Downloads  .bashrc  .ssh  .bash_history  backup.tar.gz";
    if (c === "ls -la" || c === "ls -al" || c === "ll") return "total 48\ndrwx------ 6 root root 4096 Jan 15 10:23 .\ndrwxr-xr-x 20 root root 4096 Jan 15 10:23 ..\n-rw------- 1 root root 3214 Jan 15 14:22 .bash_history\n-rw-r--r-- 1 root root 3106 Jan 15 10:23 .bashrc\ndrwx------ 2 root root 4096 Jan 15 10:23 .ssh\n-rw-r--r-- 1 root root 8523 Jan 10 08:15 backup.tar.gz";
    if (c === "cat /etc/passwd") return "root:x:0:0:root:/root:/bin/bash\ndaemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin\nwww-data:x:33:33:www-data:/var/www:/usr/sbin/nologin\nsshd:x:74:74:SSH:/var/empty/sshd:/sbin/nologin\nubuntu:x:1000:1000:Ubuntu:/home/ubuntu:/bin/bash";
    if (c === "cat /etc/shadow") return "cat: /etc/shadow: Permission denied";
    if (c === "ifconfig" || c === "ip a") return "eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST> mtu 1500\n    inet 10.0.2.15 netmask 255.255.255.0 broadcast 10.0.2.255\n    ether 08:00:27:8d:c0:4d txqueuelen 1000\nlo: flags=73<UP,LOOPBACK,RUNNING> mtu 65536\n    inet 127.0.0.1 netmask 255.0.0.0";
    if (c === "netstat -tlnp" || c === "ss -tlnp") return "Proto Recv-Q Send-Q Local Address  Foreign Address  State   PID/Program\ntcp   0      0      0.0.0.0:22     0.0.0.0:*        LISTEN  1234/sshd\ntcp   0      0      0.0.0.0:80     0.0.0.0:*        LISTEN  5678/nginx\ntcp   0      0      0.0.0.0:3306   0.0.0.0:*        LISTEN  9012/mysqld";
    if (c === "ps aux") return "USER  PID %CPU %MEM   VSZ   RSS TTY STAT START TIME COMMAND\nroot    1  0.0  0.1  2456  1520 ?   Ss   Jan08 0:12 /sbin/init\nroot  432  0.0  0.2  8236  4120 ?   Ss   Jan08 0:05 /usr/sbin/sshd\nwww   567  0.1  1.5 28456 15320 ?   S    Jan08 2:34 nginx: worker\nmysql 890  0.5  5.2 85432 53240 ?   Sl   Jan08 12:45 /usr/sbin/mysqld";
    if (c === "env" || c === "printenv") return "SHELL=/bin/bash\nPATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin\nHOME=/root\nUSER=root\nDB_HOST=db.internal\nDB_PASSWORD=Pr0d_Db_2024!";
    if (c === "w" || c === "who") return "root     pts/0    127.0.0.1    14:23   0.00s  0.00s -bash";
    if (c === "history") return "    1  ls -la\n    2  cat /etc/passwd\n    3  netstat -tlnp\n    4  mysql -u root -p\n    5  scp backup.tar.gz user@10.0.1.5:/backups/";

    if (base === "cd") return "";
    if (base === "echo") return parts.slice(1).join(" ");
    if (base === "date") return new Date().toString();
    if (c.startsWith("wget ") || c.startsWith("curl ")) return `Connecting... 200 OK\nSaving to: 'index.html'`;
    if (c.startsWith("cat ")) return `cat: ${parts.slice(1).join(" ")}: No such file or directory`;

    return `-bash: ${base}: command not found`;
  }

  stop() {
    this.server?.close();
    for (const [, s] of this.sessions) {
      try { (s.client || s.socket)?.destroy?.(); s.client?.end?.(); } catch {}
    }
  }
}

module.exports = SSHHoneypot;
