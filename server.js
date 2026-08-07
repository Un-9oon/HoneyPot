const EventEmitter = require("events");
const fs = require("fs");
const path = require("path");
const chalk = require("chalk");

const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config/honeypot.json"), "utf8"));
const bus = new EventEmitter();
bus.setMaxListeners(50);

const SSHHoneypot = require("./honeypots/ssh-honeypot");
const HTTPHoneypot = require("./honeypots/http-honeypot");
const FTPHoneypot = require("./honeypots/ftp-honeypot");
const TelnetHoneypot = require("./honeypots/telnet-honeypot");
const MonitorServer = require("./monitoring/backend/server");

const services = [];
const BIND = config.bind || "127.0.0.1";

function logBanner() {
  console.log(chalk.red(`
  ╔═══════════════════════════════════════════════════════╗
  ║          HONEYPOT DEFENSE SYSTEM  v3.0                ║
  ║          Production-Grade Network Trap                ║
  ╚═══════════════════════════════════════════════════════╝
  `));
  console.log(chalk.gray(`  Bind Address:  ${BIND}`));
  console.log(chalk.gray(`  Config:        config/honeypot.json`));
  console.log();
}

async function startServices() {
  logBanner();

  if (config.services.ssh?.enabled) {
    const ssh = new SSHHoneypot(bus, config.services.ssh, BIND);
    await ssh.start();
    services.push(ssh);
    console.log(chalk.green(`  ✓ SSH Honeypot     → ${BIND}:${config.services.ssh.port}`));
  }

  if (config.services.http?.enabled) {
    const http = new HTTPHoneypot(bus, config.services.http, BIND);
    await http.start();
    services.push(http);
    console.log(chalk.green(`  ✓ HTTP Honeypot    → ${BIND}:${config.services.http.port}`));
  }

  if (config.services.ftp?.enabled) {
    const ftp = new FTPHoneypot(bus, config.services.ftp, BIND);
    await ftp.start();
    services.push(ftp);
    console.log(chalk.green(`  ✓ FTP Honeypot     → ${BIND}:${config.services.ftp.port}`));
  }

  if (config.services.telnet?.enabled) {
    const telnet = new TelnetHoneypot(bus, config.services.telnet, BIND);
    await telnet.start();
    services.push(telnet);
    console.log(chalk.green(`  ✓ Telnet Honeypot  → ${BIND}:${config.services.telnet.port}`));
  }

  console.log();

  const monitor = new MonitorServer(bus, config, "127.0.0.1");
  await monitor.start();
  services.push(monitor);
  console.log(chalk.green(`  ✓ Dashboard        → http://127.0.0.1:${config.monitor.port}`));
  console.log();
  console.log(chalk.yellow(`  Honeypot system active. Waiting for connections...\n`));

  bus.on("attack", (event) => {
    const ts = new Date().toISOString();
    const sev = event.analysis?.severity || "";
    const line = `[${ts}] ${sev ? sev + " " : ""}${event.service.toUpperCase()} | ${event.type} | ${event.srcIP}:${event.srcPort} | ${event.details || ""}`;
    console.log(chalk.red(`  ⚡ ${line}`));

    const logDir = path.join(__dirname, "logs");
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, "attacks.log"), line + "\n");

    if (config.alerts?.desktop) {
      try {
        require("child_process").execSync(
          `notify-send -u critical "Honeypot Alert" "${event.service.toUpperCase()}: ${event.type} from ${event.srcIP}" 2>/dev/null`,
          { stdio: "ignore" }
        );
      } catch {}
    }

    if (config.alerts?.webhooks?.length) {
      const payload = JSON.stringify({ text: line, event });
      for (const url of config.alerts.webhooks) {
        const mod = url.startsWith("https") ? require("https") : require("http");
        const req = mod.request(url, { method: "POST", headers: { "Content-Type": "application/json" } });
        req.on("error", () => {});
        req.end(payload);
      }
    }
  });

  fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "data/server.pid"), String(process.pid));
}

function shutdown() {
  console.log(chalk.yellow("\n  Shutting down honeypot services..."));
  for (const svc of services) {
    try { svc.stop?.(); } catch {}
  }
  try { fs.unlinkSync(path.join(__dirname, "data/server.pid")); } catch {}
  console.log(chalk.green("  All services stopped.\n"));
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("uncaughtException", (err) => {
  console.error(chalk.red(`  [ERROR] ${err.message}`));
  fs.appendFileSync(path.join(__dirname, "logs/error.log"), `[${new Date().toISOString()}] ${err.stack}\n`);
});

startServices().catch((err) => {
  console.error(chalk.red(`  [FATAL] ${err.message}`));
  process.exit(1);
});
