const http = require("http");
const crypto = require("crypto");

const LOGIN_PAGE = `<!DOCTYPE html>
<html><head><title>Admin Panel - Login</title>
<style>
body{font-family:Arial,sans-serif;background:#1a1a2e;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}
.login{background:#16213e;padding:40px;border-radius:10px;box-shadow:0 0 30px rgba(0,0,0,0.5);width:360px}
h2{color:#e94560;margin:0 0 24px;text-align:center}
input{width:100%;padding:12px;margin:8px 0;border:1px solid #0f3460;background:#1a1a2e;color:#eee;border-radius:6px;box-sizing:border-box}
button{width:100%;padding:12px;background:#e94560;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:15px;margin-top:12px}
.footer{color:#555;font-size:11px;text-align:center;margin-top:16px}
</style></head>
<body><div class="login">
<h2>Admin Panel</h2>
<form method="POST" action="/login">
<input name="username" placeholder="Username" required>
<input name="password" type="password" placeholder="Password" required>
<button type="submit">Sign In</button>
</div>
<div class="footer">Powered by Apache/2.4.56 - Internal Use Only</div>
</div></body></html>`;

const WORDPRESS_PAGE = `<!DOCTYPE html>
<html><head><title>Log In - WordPress</title>
<style>
body{font-family:-apple-system,sans-serif;background:#f0f0f1;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}
.login{background:#fff;padding:26px 24px;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,.13);width:320px}
h1{text-align:center;margin:0 0 16px}h1 a{color:#2271b1;text-decoration:none;font-size:20px}
label{font-size:14px;color:#1d2327;font-weight:600}
input{width:100%;padding:6px 8px;margin:4px 0 16px;border:1px solid #8c8f94;border-radius:4px;box-sizing:border-box;font-size:14px}
button{background:#2271b1;color:#fff;border:none;padding:6px 30px;border-radius:4px;cursor:pointer;font-size:13px}
.links{text-align:center;margin-top:16px;font-size:13px}
.links a{color:#2271b1;text-decoration:none}
</style></head>
<body><div class="login">
<h1><a href="#">WordPress</a></h1>
<form method="POST" action="/wp-login.php">
<label>Username or Email</label>
<input name="log" required>
<label>Password</label>
<input name="pwd" type="password" required>
<button type="submit">Log In</button>
</form>
<div class="links"><a href="#">Lost your password?</a></div>
</div></body></html>`;

const PHPMYADMIN_PAGE = `<!DOCTYPE html>
<html><head><title>phpMyAdmin</title>
<style>
body{font-family:sans-serif;background:#e7e9ed;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}
.pma{background:#fff;padding:30px;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.12);width:340px}
h2{color:#336791;margin:0 0 20px}
label{font-size:13px;color:#333;display:block;margin:12px 0 4px}
input{width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box}
select{width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;margin-top:4px}
button{width:100%;padding:10px;background:#336791;color:#fff;border:none;border-radius:4px;cursor:pointer;margin-top:16px;font-size:14px}
</style></head>
<body><div class="pma">
<h2>phpMyAdmin</h2>
<form method="POST" action="/phpmyadmin">
<label>Username</label><input name="pma_username" required>
<label>Password</label><input name="pma_password" type="password" required>
<label>Server Choice</label><select name="server"><option>localhost</option></select>
<button type="submit">Go</button>
</form></div></body></html>`;

const FAKE_ENV = `APP_NAME=ProductionApp
APP_ENV=production
APP_KEY=base64:k8Jm3nP9qR2sT5vW7xY1zA4bC6dE8fG0hI2jK4lM6n=
APP_DEBUG=false
APP_URL=https://app.internal.corp

DB_CONNECTION=mysql
DB_HOST=db-primary.internal
DB_PORT=3306
DB_DATABASE=production_app
DB_USERNAME=app_user
DB_PASSWORD=Pr0d_Db_P@ss2024!

REDIS_HOST=redis.internal
REDIS_PASSWORD=R3d1s_S3cur3_K3y!
REDIS_PORT=6379

MAIL_MAILER=smtp
MAIL_HOST=smtp.internal.corp
MAIL_PORT=587
MAIL_USERNAME=noreply@corp.internal
MAIL_PASSWORD=M@1l_P@ss_2024

AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_DEFAULT_REGION=us-east-1
AWS_BUCKET=production-assets`;

const FAKE_ROBOTS = `User-agent: *
Disallow: /admin/
Disallow: /api/v1/internal/
Disallow: /backup/
Disallow: /config/
Disallow: /database/
Disallow: /logs/
Disallow: /private/
Disallow: /staging/
Disallow: /uploads/private/
Disallow: /.git/
Sitemap: https://www.example.com/sitemap.xml`;

const FAKE_WPCONFIG = `<?php
define( 'DB_NAME', 'wordpress_prod' );
define( 'DB_USER', 'wp_admin' );
define( 'DB_PASSWORD', 'Wp_Pr0d_2024!' );
define( 'DB_HOST', 'db.internal:3306' );
define( 'DB_CHARSET', 'utf8mb4' );
$table_prefix = 'wp_';
define( 'AUTH_KEY', 'xK9#mP2$nQ5&rT8*vW1!yA4^bC7@dE0%fG3' );
define( 'WP_DEBUG', false );
if ( ! defined( 'ABSPATH' ) ) { define( 'ABSPATH', __DIR__ . '/' ); }
require_once ABSPATH . 'wp-settings.php';`;

const FAKE_API_RESPONSE = JSON.stringify({
  users: [
    { id: 1, username: "admin", email: "admin@corp.internal", role: "superadmin", last_login: "2024-01-15T10:23:00Z" },
    { id: 2, username: "jsmith", email: "j.smith@corp.internal", role: "manager", last_login: "2024-01-14T16:45:00Z" },
    { id: 3, username: "devops", email: "devops@corp.internal", role: "admin", last_login: "2024-01-15T08:12:00Z" },
  ],
  total: 3, page: 1
}, null, 2);

const SENSITIVE_PATHS = {
  "/.env": { content: FAKE_ENV, type: "text/plain", attackType: "sensitive_file_access" },
  "/.env.backup": { content: FAKE_ENV, type: "text/plain", attackType: "sensitive_file_access" },
  "/wp-config.php.bak": { content: FAKE_WPCONFIG, type: "text/plain", attackType: "sensitive_file_access" },
  "/wp-config.php~": { content: FAKE_WPCONFIG, type: "text/plain", attackType: "sensitive_file_access" },
  "/config.php": { content: FAKE_WPCONFIG, type: "text/plain", attackType: "sensitive_file_access" },
  "/backup.sql": { content: "-- MySQL dump\n-- Server version 8.0.35\nCREATE DATABASE IF NOT EXISTS `production`;\nUSE `production`;\nCREATE TABLE `users` (`id` int, `email` varchar(255), `password_hash` varchar(255));\nINSERT INTO `users` VALUES (1,'admin@corp.internal','$2b$12$fakehashhere');", type: "text/plain", attackType: "sensitive_file_access" },
  "/.git/config": { content: "[core]\n\trepositoryformatversion = 0\n[remote \"origin\"]\n\turl = git@github.com:corp-internal/production-app.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*", type: "text/plain", attackType: "sensitive_file_access" },
  "/robots.txt": { content: FAKE_ROBOTS, type: "text/plain", attackType: "scanner_probe" },
  "/api/v1/users": { content: FAKE_API_RESPONSE, type: "application/json", attackType: "api_enumeration" },
  "/api/v1/internal/health": { content: JSON.stringify({ status: "ok", version: "3.2.1", database: "connected", redis: "connected", uptime: 864000 }), type: "application/json", attackType: "api_enumeration" },
  "/server-status": { content: "<h1>Apache Server Status</h1><p>Server uptime: 10 days</p><p>Total accesses: 45231</p>", type: "text/html", attackType: "scanner_probe" },
  "/admin/config": { content: LOGIN_PAGE, type: "text/html", attackType: "scanner_probe" },
};

const PAGES = {
  "/": LOGIN_PAGE,
  "/admin": LOGIN_PAGE,
  "/login": LOGIN_PAGE,
  "/wp-login.php": WORDPRESS_PAGE,
  "/wp-admin": WORDPRESS_PAGE,
  "/phpmyadmin": PHPMYADMIN_PAGE,
  "/pma": PHPMYADMIN_PAGE,
};

const pcapEngine = require("../monitoring/backend/pcap-engine");

class HTTPHoneypot {
  constructor(bus, cfg, bind) {
    this.bus = bus;
    this.port = cfg.port || 8080;
    this.serverHeader = cfg.serverHeader || "Apache/2.4.56 (Ubuntu)";
    this.bind = bind;
    this.server = null;
  }

  async start() {
    this.server = http.createServer((req, res) => {
      const srcIP = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").replace("::ffff:", "");
      const srcPort = req.socket.remotePort || 0;
      const sessionId = crypto.randomUUID();
      const urlPath = req.url.split("?")[0];
      const pcapId = pcapEngine.createStream("http", srcIP, srcPort, this.port);

      res.setHeader("Server", this.serverHeader);
      res.setHeader("X-Powered-By", "PHP/8.1.2");

      const reqStr = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\nHost: ${req.headers.host || "127.0.0.1"}\r\nUser-Agent: ${req.headers["user-agent"] || ""}\r\n\r\n`;
      pcapEngine.recordPacket(pcapId, "C_TO_S", reqStr, `[HTTP REQ] ${req.method} ${req.url}`);

      const headersCopy = { ...req.headers };
      delete headersCopy.cookie;

      this.bus.emit("attack", {
        service: "http",
        type: "http_request",
        srcIP, srcPort, sessionId,
        details: `${req.method} ${req.url}`,
        method: req.method,
        path: req.url,
        headers: JSON.stringify(headersCopy),
        userAgent: req.headers["user-agent"] || "",
        timestamp: new Date().toISOString(),
      });

      const attacks = [];
      if (this._detectSQLi(req.url)) attacks.push("sql_injection");
      if (this._detectPathTraversal(req.url)) attacks.push("path_traversal");
      if (this._detectXSS(req.url)) attacks.push("xss_attempt");
      if (this._detectCmdInjection(req.url)) attacks.push("cmd_injection");
      if (this._detectScanner(req.headers["user-agent"])) attacks.push("scanner_probe");

      for (const attackType of attacks) {
        this.bus.emit("attack", {
          service: "http", type: attackType,
          srcIP, srcPort, sessionId,
          details: `${attackType} in ${req.method} ${req.url.substring(0, 200)}`,
          userAgent: req.headers["user-agent"] || "",
          timestamp: new Date().toISOString(),
        });
      }

      if (req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => { body += chunk.toString().substring(0, 8192); });
        req.on("end", () => {
          const creds = this._parseCredentials(body);
          if (creds.username) {
            this.bus.emit("attack", {
              service: "http", type: "credential_capture",
              srcIP, srcPort, sessionId,
              details: `user=${creds.username} pass=${creds.password} page=${req.url}`,
              username: creds.username, password: creds.password,
              page: req.url,
              postBody: body.substring(0, 1024),
              timestamp: new Date().toISOString(),
            });
          }
          if (this._detectSQLi(body)) {
            this.bus.emit("attack", {
              service: "http", type: "sql_injection",
              srcIP, srcPort, sessionId,
              details: `SQL injection in POST body: ${body.substring(0, 200)}`,
              timestamp: new Date().toISOString(),
            });
          }
          res.writeHead(302, { Location: req.url + "?error=1" });
          res.end();
        });
        return;
      }

      const origEnd = res.end.bind(res);
      res.end = (chunk, encoding, callback) => {
        if (chunk) {
          const respStr = `HTTP/1.1 ${res.statusCode} ${res.statusMessage || "OK"}\r\nServer: ${this.serverHeader}\r\nContent-Type: ${res.getHeader("Content-Type") || "text/html"}\r\n\r\n` + chunk.toString().substring(0, 1024);
          pcapEngine.recordPacket(pcapId, "S_TO_C", respStr, `[HTTP RESP] ${res.statusCode}`);
        }
        pcapEngine.markStatus(pcapId, (res.statusCode >= 200 && res.statusCode < 400) ? "SUCCESSFUL" : "FAILED");
        return origEnd(chunk, encoding, callback);
      };

      const sensitive = SENSITIVE_PATHS[urlPath];
      if (sensitive) {
        if (sensitive.attackType !== "scanner_probe") {
          this.bus.emit("attack", {
            service: "http", type: sensitive.attackType,
            srcIP, srcPort, sessionId,
            details: `Accessed ${urlPath}`,
            path: urlPath,
            timestamp: new Date().toISOString(),
          });
        }
        res.writeHead(200, { "Content-Type": sensitive.type });
        res.end(sensitive.content);
        return;
      }

      const page = PAGES[urlPath];
      if (page) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(page);
      } else {
        res.writeHead(404, { "Content-Type": "text/html" });
        res.end("<h1>404 Not Found</h1><hr><address>Apache/2.4.56 (Ubuntu) Server</address>");
      }
    });

    return new Promise((resolve, reject) => {
      this.server.on("error", reject);
      this.server.listen(this.port, this.bind, () => resolve());
    });
  }

  _parseCredentials(body) {
    const params = new URLSearchParams(body);
    const userKeys = ["username", "user", "log", "pma_username", "email", "login"];
    const passKeys = ["password", "pass", "pwd", "pma_password", "passwd"];
    let username = "", password = "";
    for (const k of userKeys) { if (params.get(k)) { username = params.get(k); break; } }
    for (const k of passKeys) { if (params.get(k)) { password = params.get(k); break; } }
    return { username, password };
  }

  _detectSQLi(s) {
    return /('|"|;|--|\bOR\b\s+\b\d+\b\s*=\s*\b\d+\b|\bUNION\b|\bSELECT\b|\bDROP\b|\bINSERT\b|\bDELETE\b|\bUPDATE\b.*\bSET\b|\bEXEC\b|\bDECLARE\b|0x[0-9a-f]{6,})/i.test(s);
  }

  _detectPathTraversal(url) {
    return /(\.\.[\/\\]|\/etc\/|\/proc\/|\/windows\/|%2e%2e|%252e)/i.test(url);
  }

  _detectXSS(url) {
    return /(<script|javascript:|onerror|onload|onclick|onfocus|%3cscript|<img\s|<svg\s|<iframe)/i.test(url);
  }

  _detectCmdInjection(url) {
    return /(;|\||`|\$\(|%7c|&&|%26%26|\bcat\b\s+\/|\bwhoami\b|\bcurl\b|\bwget\b|\bnc\b\s+-|\bpython\b|\bperl\b|\bruby\b.*-e)/i.test(url);
  }

  _detectScanner(ua) {
    if (!ua) return false;
    return /(nikto|sqlmap|nmap|masscan|dirbuster|gobuster|ffuf|wfuzz|burp|zap|acunetix|nessus|nuclei|httpx|subfinder)/i.test(ua);
  }

  stop() { this.server?.close(); }
}

module.exports = HTTPHoneypot;
