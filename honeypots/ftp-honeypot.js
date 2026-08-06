const net = require("net");
const crypto = require("crypto");

class FTPHoneypot {
  constructor(bus, cfg, bind) {
    this.bus = bus;
    this.port = cfg.port || 2121;
    this.banner = cfg.banner || "220 ProFTPD 1.3.8 Server ready.";
    this.bind = bind;
    this.server = null;
  }

  async start() {
    this.server = net.createServer((socket) => {
      const srcIP = socket.remoteAddress?.replace("::ffff:", "") || "unknown";
      const srcPort = socket.remotePort || 0;
      const sessionId = crypto.randomUUID();
      let currentUser = "";
      let loginAttempts = 0;
      let loggedIn = false;
      const commands = [];

      socket.write(this.banner + "\r\n");

      this.bus.emit("connection", {
        service: "ftp", srcIP, srcPort, sessionId,
        timestamp: new Date().toISOString(),
      });

      socket.on("data", (data) => {
        const lines = data.toString().trim().split("\r\n");
        for (const line of lines) {
          const [cmd, ...args] = line.split(" ");
          const arg = args.join(" ");
          commands.push(line);

          switch (cmd.toUpperCase()) {
            case "USER":
              currentUser = arg;
              socket.write("331 Password required for " + arg + "\r\n");
              break;

            case "PASS":
              loginAttempts++;
              this.bus.emit("attack", {
                service: "ftp", type: "credential_capture",
                srcIP, srcPort, sessionId,
                details: `user=${currentUser} pass=${arg}`,
                username: currentUser, password: arg,
                timestamp: new Date().toISOString(),
              });
              if (loginAttempts >= 3) {
                loggedIn = true;
                socket.write("230 User " + currentUser + " logged in.\r\n");
              } else {
                socket.write("530 Login incorrect.\r\n");
              }
              break;

            case "LIST": case "NLST":
              if (!loggedIn) { socket.write("530 Not logged in.\r\n"); break; }
              socket.write("150 Opening data connection.\r\n");
              setTimeout(() => socket.write("226 Transfer complete.\r\n"), 200);
              break;

            case "PWD":
              socket.write('257 "/" is current directory.\r\n');
              break;

            case "CWD":
              this.bus.emit("attack", {
                service: "ftp", type: "directory_traversal",
                srcIP, srcPort, sessionId,
                details: `CWD ${arg}`,
                timestamp: new Date().toISOString(),
              });
              socket.write("250 Directory changed to " + arg + ".\r\n");
              break;

            case "RETR": case "STOR":
              this.bus.emit("attack", {
                service: "ftp",
                type: cmd.toUpperCase() === "RETR" ? "file_download" : "file_upload",
                srcIP, srcPort, sessionId,
                details: `${cmd.toUpperCase()} ${arg}`,
                timestamp: new Date().toISOString(),
              });
              socket.write("550 Permission denied.\r\n");
              break;

            case "SIZE":
              socket.write("213 4096\r\n");
              break;

            case "PASV":
              socket.write("227 Entering Passive Mode (127,0,0,1,100,20).\r\n");
              break;

            case "PORT":
              socket.write("200 PORT command successful.\r\n");
              break;

            case "SYST":
              socket.write("215 UNIX Type: L8\r\n");
              break;

            case "TYPE":
              socket.write("200 Type set to " + arg + ".\r\n");
              break;

            case "FEAT":
              socket.write("211-Features:\r\n PASV\r\n UTF8\r\n SIZE\r\n211 End\r\n");
              break;

            case "QUIT":
              socket.write("221 Goodbye.\r\n");
              socket.end();
              break;

            default:
              socket.write("502 Command not implemented.\r\n");
          }
        }
      });

      socket.on("error", () => {});
      socket.on("close", () => {
        if (commands.length > 0) {
          this.bus.emit("session_end", {
            service: "ftp", srcIP, srcPort, sessionId,
            commandCount: commands.length,
            commands: commands.slice(0, 100),
            loginAttempts,
          });
        }
      });

      setTimeout(() => {
        if (!socket.destroyed) {
          socket.write("421 Timeout.\r\n");
          socket.destroy();
        }
      }, 60000);
    });

    return new Promise((resolve, reject) => {
      this.server.on("error", reject);
      this.server.listen(this.port, this.bind, () => resolve());
    });
  }

  stop() { this.server?.close(); }
}

module.exports = FTPHoneypot;
