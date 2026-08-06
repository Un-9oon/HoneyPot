const net = require("net");
const crypto = require("crypto");

class TelnetHoneypot {
  constructor(bus, cfg, bind) {
    this.bus = bus;
    this.port = cfg.port || 2323;
    this.bind = bind;
    this.server = null;
  }

  async start() {
    this.server = net.createServer((socket) => {
      const srcIP = socket.remoteAddress?.replace("::ffff:", "") || "unknown";
      const srcPort = socket.remotePort || 0;
      const sessionId = crypto.randomUUID();
      let state = "login";
      let username = "";
      let loginAttempts = 0;
      const commands = [];
      const sessionLog = [];

      socket.write("\r\nUbuntu 22.04.4 LTS\r\nlogin: ");

      this.bus.emit("connection", {
        service: "telnet", srcIP, srcPort, sessionId,
        timestamp: new Date().toISOString(),
      });

      socket.on("data", (data) => {
        const input = data.toString().replace(/[\r\n]+$/, "").replace(/\xff[\xfb-\xfe]./g, "");
        if (!input) return;
        sessionLog.push(input);

        if (state === "login") {
          username = input;
          socket.write("Password: ");
          state = "password";
        } else if (state === "password") {
          loginAttempts++;
          this.bus.emit("attack", {
            service: "telnet", type: "credential_capture",
            srcIP, srcPort, sessionId,
            details: `user=${username} pass=${input}`,
            username, password: input,
            timestamp: new Date().toISOString(),
          });

          if (loginAttempts >= 3) {
            socket.write(`\r\nLast login: ${new Date(Date.now() - 3600000).toString()}\r\n$ `);
            state = "shell";
          } else {
            socket.write("\r\nLogin incorrect\r\nlogin: ");
            state = "login";
            username = "";
          }
        } else if (state === "shell") {
          commands.push(input);
          this.bus.emit("attack", {
            service: "telnet", type: "command_execution",
            srcIP, srcPort, sessionId,
            details: `cmd: ${input}`,
            command: input,
            timestamp: new Date().toISOString(),
          });

          if (input === "exit" || input === "quit" || input === "logout") {
            socket.write("logout\r\n");
            socket.end();
            return;
          }

          const resp = this._fakeResponse(input);
          socket.write(resp + "\r\n$ ");
        }
      });

      socket.on("error", () => {});
      socket.on("close", () => {
        this.bus.emit("session_end", {
          service: "telnet", srcIP, srcPort, sessionId,
          commandCount: commands.length,
          commands: commands.slice(0, 100),
          sessionLog: sessionLog.slice(0, 100),
          loginAttempts,
        });
      });

      setTimeout(() => {
        if (!socket.destroyed) socket.destroy();
      }, 120000);
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
    if (c === "uname -a") return "Linux server 5.15.0-91-generic #101-Ubuntu SMP Tue Nov 14 13:30:08 UTC 2023 x86_64 x86_64 x86_64 GNU/Linux";
    if (c === "uname") return "Linux";
    if (c === "hostname") return "prod-web-01";
    if (c === "uptime") return " 14:23:01 up 127 days, 3:42, 1 user, load average: 0.12, 0.08, 0.04";
    if (c === "pwd") return "/root";
    if (c === "ls" || c === "dir") return "Desktop  Documents  Downloads  .bashrc  .ssh  .bash_history  backup.tar.gz";
    if (c === "ls -la" || c === "ls -al" || c === "ll") return "total 48\ndrwx------ 6 root root 4096 Jan 15 10:23 .\ndrwxr-xr-x 20 root root 4096 Jan 15 10:23 ..\n-rw------- 1 root root 3214 Jan 15 14:22 .bash_history\n-rw-r--r-- 1 root root 3106 Jan 15 10:23 .bashrc\ndrwx------ 2 root root 4096 Jan 15 10:23 .ssh\n-rw-r--r-- 1 root root 8523 Jan 10 08:15 backup.tar.gz\ndrwxr-xr-x 2 root root 4096 Jan 12 16:30 Desktop\ndrwxr-xr-x 3 root root 4096 Jan 14 09:45 Documents\ndrwxr-xr-x 2 root root 4096 Jan 13 11:20 Downloads";
    if (c === "ls .ssh" || c === "ls -la .ssh") return "total 16\ndrwx------ 2 root root 4096 Jan 15 10:23 .\ndrwx------ 6 root root 4096 Jan 15 10:23 ..\n-rw------- 1 root root 2602 Jan 15 10:23 id_rsa\n-rw-r--r-- 1 root root 571 Jan 15 10:23 id_rsa.pub\n-rw-r--r-- 1 root root 222 Jan 15 10:23 known_hosts\n-rw------- 1 root root 405 Jan 15 10:23 authorized_keys";

    if (c === "cat /etc/passwd") return "root:x:0:0:root:/root:/bin/bash\ndaemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin\nbin:x:2:2:bin:/bin:/usr/sbin/nologin\nsys:x:3:3:sys:/dev:/usr/sbin/nologin\nwww-data:x:33:33:www-data:/var/www:/usr/sbin/nologin\nmysql:x:27:27:MySQL Server:/var/lib/mysql:/bin/false\nsshd:x:74:74:Privilege-separated SSH:/var/empty/sshd:/sbin/nologin\nubuntu:x:1000:1000:Ubuntu:/home/ubuntu:/bin/bash";
    if (c === "cat /etc/shadow") return "cat: /etc/shadow: Permission denied";
    if (c.startsWith("cat .ssh/id_rsa") || c.startsWith("cat /root/.ssh/id_rsa")) return "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtz\nc2gtZWQyNTUxOQAAACBGRkFLRUtFWUZBS0VLRVlGQUtFS0VZRkFLRUtFWQ==\n-----END OPENSSH PRIVATE KEY-----";
    if (c.startsWith("cat ")) return `${cmd.split(" ").slice(1).join(" ")}: No such file or directory`;

    if (c === "ifconfig" || c === "ip a" || c === "ip addr") return "eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST> mtu 1500\n    inet 10.0.2.15 netmask 255.255.255.0 broadcast 10.0.2.255\n    inet6 fe80::a00:27ff:fe8d:c04d prefixlen 64 scopeid 0x20<link>\n    ether 08:00:27:8d:c0:4d txqueuelen 1000\n\nlo: flags=73<UP,LOOPBACK,RUNNING> mtu 65536\n    inet 127.0.0.1 netmask 255.0.0.0";
    if (c === "netstat -tlnp" || c === "ss -tlnp") return "Proto Recv-Q Send-Q Local Address  Foreign Address  State   PID/Program\ntcp   0      0      0.0.0.0:22     0.0.0.0:*        LISTEN  1234/sshd\ntcp   0      0      0.0.0.0:80     0.0.0.0:*        LISTEN  5678/nginx\ntcp   0      0      0.0.0.0:3306   0.0.0.0:*        LISTEN  9012/mysqld\ntcp   0      0      0.0.0.0:443    0.0.0.0:*        LISTEN  5678/nginx";
    if (c === "ps aux" || c === "ps -ef") return "USER  PID %CPU %MEM   VSZ   RSS TTY STAT START TIME COMMAND\nroot    1  0.0  0.1  2456  1520 ?   Ss   Jan08 0:12 /sbin/init\nroot  432  0.0  0.2  8236  4120 ?   Ss   Jan08 0:05 /usr/sbin/sshd\nwww   567  0.1  1.5 28456 15320 ?   S    Jan08 2:34 nginx: worker\nmysql 890  0.5  5.2 85432 53240 ?   Sl   Jan08 12:45 /usr/sbin/mysqld\nroot 1234  0.0  0.0  2236  1024 pts/0 S  14:23 0:00 -bash";
    if (c === "w" || c === "who") return "root     pts/0    127.0.0.1    14:23   0.00s  0.00s -bash";

    if (c.startsWith("wget ") || c.startsWith("curl ")) return `--2024-01-15 14:23:45--  ${parts.slice(1).join(" ")}\nResolving... connecting... HTTP request sent.\n200 OK\nLength: 0 [text/html]\nSaving to: 'index.html'\nindex.html          100%[==================>]       0  --.-KB/s    in 0s`;

    if (c === "env" || c === "printenv") return "SHELL=/bin/bash\nPATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\nHOME=/root\nLOGNAME=root\nUSER=root\nLANG=en_US.UTF-8\nTERM=xterm-256color\nDB_HOST=db.internal\nDB_PASSWORD=Pr0d_Db_2024!";
    if (c === "history") return "    1  ls -la\n    2  cat /etc/passwd\n    3  netstat -tlnp\n    4  cd /var/www/html\n    5  vim config.php\n    6  mysql -u root -p\n    7  scp backup.tar.gz user@10.0.1.5:/backups/\n    8  crontab -l";
    if (c === "crontab -l") return "# m h dom mon dow command\n0 2 * * * /root/backup.sh\n*/5 * * * * /usr/bin/python3 /opt/monitor/check.py\n0 0 1 * * /usr/sbin/logrotate /etc/logrotate.conf";

    if (base === "cd") return "";
    if (base === "echo") return parts.slice(1).join(" ");
    if (base === "date") return new Date().toString();
    if (base === "free") return "              total    used    free   shared  buff/cache  available\nMem:        8154820  2345612  3210456   123456   2598752   5432108\nSwap:       2097148        0  2097148";
    if (base === "df") return "Filesystem     1K-blocks    Used Available Use% Mounted on\n/dev/sda1       41284928 8234512  31000416  21% /\ntmpfs            4077408       0   4077408   0% /dev/shm";
    if (c === "help") return "GNU bash, version 5.1.16(1)-release (x86_64-pc-linux-gnu)\nType 'help name' for information about the builtin 'name'.";

    return `-bash: ${base}: command not found`;
  }

  stop() { this.server?.close(); }
}

module.exports = TelnetHoneypot;
