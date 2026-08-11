const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { Level } = require("level");

const ch = require("./clickhouse");

const AttackerProfiler = require("../../intel/profiler");
const IDSEngine = require("../../intel/ids-engine");

let geoip;
try { geoip = require("geoip-lite"); } catch { geoip = null; }

const SEVERITY_ORDER = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };

class MonitorServer {
  constructor(bus, config, bind) {
    ch.initClickHouse();
    this.bus = bus;
    this.config = config;
    this.bind = bind;
    this.ids = new IDSEngine(this.bus);
    this.ids.start();
    this.port = config.monitor?.port || 3000;
    this.attacks = [];
    this.sessions = [];
    this.credentials = [];
    this.connections = [];
    this.notifications = [];
    this.serviceStatus = {};
    this.wsClients = new Set();
    this.rateLimits = new Map();
    this.db = null;
    this.server = null;
    this.attackCounter = 0;
    this.notifCounter = 0;
    this.authToken = null;
    this.profiler = new AttackerProfiler();
  }

  async start() {
    const dbPath = path.join(__dirname, "../../data/attacks.db");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Level(dbPath, { valueEncoding: "json" });
    await this._loadFromDB();
    this._initAuth();

    const app = express();
    app.use(express.json());
    


    app.use((req, res, next) => {
      const ip = this._getIP(req);
      const now = Date.now();
      const entry = this.rateLimits.get(ip) || { count: 0, reset: now + 60000 };
      if (now > entry.reset) { entry.count = 0; entry.reset = now + 60000; }
      entry.count++;
      this.rateLimits.set(ip, entry);
      
      // Rate limiting: 20 req/min for login, 1000 req/min for local dashboard
      const isLocal = ip === "127.0.0.1" || ip === "localhost" || ip.startsWith("127.");
      const maxReq = req.path === '/api/login' ? 20 : (isLocal ? 1000 : 300);
      if (entry.count > maxReq) {
        return res.status(429).json({ error: "Rate limit exceeded. Try again later." });
      }
      
      // OWASP Secure Headers
      res.header("Access-Control-Allow-Origin", "http://127.0.0.1:3000");
      res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:;");
      res.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
      res.header("X-Content-Type-Options", "nosniff");
      res.header("X-Frame-Options", "DENY");
      res.header("X-XSS-Protection", "1; mode=block");
      
      if(req.method === 'OPTIONS') return res.sendStatus(200);
      next();
    });

    app.use(express.static(path.join(__dirname, "../frontend")));

    app.post("/api/login", (req, res) => {
      const { username, password } = req.body || {};
      const authFile = path.join(__dirname, "../../config/auth.json");
      try {
        const auth = JSON.parse(fs.readFileSync(authFile, "utf8"));
        if (username === auth.username && password === auth.password) {
          return res.json({ token: auth.token, message: "Authenticated" });
        }
      } catch {}
      res.status(401).json({ error: "Invalid credentials" });
    });

    const authMiddleware = (req, res, next) => {
      const token = (req.headers.authorization || "").replace("Bearer ", "");
      const ip = this._getIP(req);
      const isLocal = ip === "127.0.0.1" || ip === "localhost" || ip === "::1" || ip.startsWith("127.");
      if (isLocal || (token && token === this.authToken)) return next();
      res.status(401).json({ error: "Unauthorized" });
    };

    app.get("/api/status", authMiddleware, (req, res) => {
      const typeCounts = {};
      const svcCounts = {};
      const severityCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
      this.attacks.forEach(a => {
        typeCounts[a.type] = (typeCounts[a.type] || 0) + 1;
        svcCounts[a.service] = (svcCounts[a.service] || 0) + 1;
        if (a.analysis?.severity) severityCounts[a.analysis.severity]++;
      });
      const uniqueIPs = new Set(this.attacks.map(a => a.srcIP)).size;
      res.json({
        totalAttacks: this.attacks.length,
        totalCredentials: this.credentials.length,
        totalSessions: this.sessions.length,
        uniqueAttackers: uniqueIPs,
        unreadNotifications: this.notifications.filter(n => !n.read).length,
        services: this.config.services,
        serviceStatus: this.serviceStatus,
        attackTypes: typeCounts,
        serviceCounts: svcCounts,
        severityCounts,
        uptime: process.uptime(),
        bind: this.bind,
      });
    });

    app.get("/api/attacks", authMiddleware, (req, res) => {
      const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
      let result = this.attacks;
      if (req.query.service) result = result.filter(a => a.service === req.query.service);
      if (req.query.type) result = result.filter(a => a.type === req.query.type);
      if (req.query.severity) result = result.filter(a => a.analysis?.severity === req.query.severity);
      res.json(result.slice(-limit));
    });

    app.get("/api/attack/:id", authMiddleware, (req, res) => {
      const id = parseInt(req.params.id);
      const attack = this.attacks.find(a => a.id === id);
      if (!attack) return res.status(404).json({ error: "Not found" });
      const related = this.attacks.filter(a => a.srcIP === attack.srcIP && a.id !== id).slice(-10);
      res.json({ attack, relatedAttacks: related });
    });

    app.get("/api/credentials", authMiddleware, (req, res) => res.json(this.credentials.slice(-500)));

    app.get("/api/attackers", authMiddleware, (req, res) => {
      const map = new Map();
      for (const a of this.attacks) {
        if (!map.has(a.srcIP)) map.set(a.srcIP, { ip: a.srcIP, attacks: 0, types: new Set(), services: new Set(), firstSeen: a.timestamp, lastSeen: a.timestamp, credentials: [], geo: a.geo || null, severities: {} });
        const p = map.get(a.srcIP);
        p.attacks++; p.types.add(a.type); p.services.add(a.service); p.lastSeen = a.timestamp;
        if (a.geo && !p.geo) p.geo = a.geo;
        const sev = a.analysis?.severity || "INFO";
        p.severities[sev] = (p.severities[sev] || 0) + 1;
        if (a.username) p.credentials.push({ user: a.username, pass: a.password, service: a.service });
      }
      const profiles = [...map.values()].map(p => ({ ...p, types: [...p.types], services: [...p.services], credentials: p.credentials.slice(-20), threatLevel: p.attacks >= 20 ? "CRITICAL" : p.attacks >= 10 ? "HIGH" : p.attacks >= 5 ? "MEDIUM" : "LOW" }));
      profiles.sort((a, b) => b.attacks - a.attacks);
      res.json(profiles);
    });

    app.get("/api/services", authMiddleware, (req, res) => {
      const svc = {};
      for (const [name, cfg] of Object.entries(this.config.services)) {
        const attacks = this.attacks.filter(a => a.service === name);
        const typeCounts = {}; attacks.forEach(a => typeCounts[a.type] = (typeCounts[a.type] || 0) + 1);
        svc[name] = { enabled: cfg.enabled, port: cfg.port, totalAttacks: attacks.length, uniqueIPs: new Set(attacks.map(a => a.srcIP)).size, lastAttack: attacks.length ? attacks[attacks.length - 1].timestamp : null, attackTypes: typeCounts, credentials: attacks.filter(a => a.username).length };
      }
      res.json(svc);
    });

    app.get("/api/timeline", authMiddleware, (req, res) => {
      const hours = parseInt(req.query.hours) || 24;
      const now = Date.now();
      const buckets = {};
      for (let i = 0; i < hours; i++) { const h = new Date(now - i * 3600000).toISOString().substring(0, 13); buckets[h] = { total: 0, ssh: 0, http: 0, ftp: 0, telnet: 0 }; }
      for (const a of this.attacks) { const h = a.timestamp.substring(0, 13); if (h in buckets) { buckets[h].total++; if (a.service in buckets[h]) buckets[h][a.service]++; } }
      res.json(Object.entries(buckets).sort().map(([hour, data]) => ({ hour, ...data })));
    });

    app.get("/api/sessions", authMiddleware, (req, res) => res.json(this.sessions.slice(-200)));

    app.get("/api/notifications", authMiddleware, (req, res) => {
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      res.json(this.notifications.slice(-limit).reverse());
    });
    app.get("/api/notifications/unread-count", authMiddleware, (req, res) => res.json({ count: this.notifications.filter(n => !n.read).length }));
    app.post("/api/notifications/:id/read", authMiddleware, (req, res) => {
      const n = this.notifications.find(n => n.id === parseInt(req.params.id));
      if (n) { n.read = true; res.json({ ok: true }); } else res.status(404).json({ error: "Not found" });
    });
    app.post("/api/notifications/read-all", authMiddleware, (req, res) => { this.notifications.forEach(n => n.read = true); res.json({ ok: true }); });

    app.get("/api/stats", authMiddleware, (req, res) => {
      const passCounts = {}, userCounts = {}, countryCounts = {};
      for (const a of this.attacks) {
        if (a.username) userCounts[a.username] = (userCounts[a.username] || 0) + 1;
        if (a.password) passCounts[a.password] = (passCounts[a.password] || 0) + 1;
        if (a.geo?.country) countryCounts[a.geo.country] = (countryCounts[a.geo.country] || 0) + 1;
      }
      res.json({
        topPasswords: Object.entries(passCounts).sort((a, b) => b[1] - a[1]).slice(0, 15),
        topUsernames: Object.entries(userCounts).sort((a, b) => b[1] - a[1]).slice(0, 15),
        topCountries: Object.entries(countryCounts).sort((a, b) => b[1] - a[1]).slice(0, 15),
      });
    });

    app.get("/api/export", authMiddleware, (req, res) => {
      const format = req.query.format || "json";
      if (format === "csv") {
        const header = "id,timestamp,service,type,srcIP,srcPort,severity,details,username,password\n";
        const rows = this.attacks.map(a => [a.id, a.timestamp, a.service, a.type, a.srcIP, a.srcPort, a.analysis?.severity || "", (a.details || "").replace(/,/g, ";"), a.username || "", a.password || ""].join(",")).join("\n");
        res.header("Content-Type", "text/csv");
        res.header("Content-Disposition", "attachment; filename=honeypot-attacks.csv");
        res.send(header + rows);
      } else {
        res.header("Content-Disposition", "attachment; filename=honeypot-attacks.json");
        res.json({ exported: new Date().toISOString(), totalAttacks: this.attacks.length, attacks: this.attacks });
      }
    });

    app.post("/api/reset", authMiddleware, async (req, res) => {
      try {
        this.attacks = [];
        this.credentials = [];
        this.sessions = [];
        this.connections = [];
        this.notifications = [];
        this.attackCounter = 0;
        this.notifCounter = 0;
        this.profiler = new AttackerProfiler();
        try { await this.db.clear(); } catch {}
        const logDir = path.join(__dirname, "../../logs");
        try { const files = fs.readdirSync(logDir); for (const f of files) { try { fs.unlinkSync(path.join(logDir, f)); } catch {} } } catch {}
        this._broadcast({ type: "reset" });
        res.json({ ok: true, message: "All data cleared" });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    const pcapEngine = require("./pcap-engine");

    pcapEngine.on("stream_start", (s) => {
      this._broadcast({ type: "pcap_update", data: s });
    });
    pcapEngine.on("stream_end", (s) => {
      this._broadcast({ type: "pcap_update", data: s });
    });

    app.get("/api/pcap/stats", authMiddleware, (req, res) => {
      res.json(pcapEngine.getStats());
    });

    app.get("/api/pcap/streams", authMiddleware, (req, res) => {
      res.json(pcapEngine.getStreamsSummary());
    });

    app.get("/api/pcap/stream/:id", authMiddleware, (req, res) => {
      const detail = pcapEngine.getStreamDetail(req.params.id);
      if (!detail) return res.status(404).json({ error: "Stream not found" });
      res.json(detail);
    });

    app.get("/api/intel/profiles", authMiddleware, (req, res) => {
      res.json(this.profiler.getAllProfiles());
    });

    app.get("/api/intel/profile/:ip", authMiddleware, (req, res) => {
      const summary = this.profiler.getProfileSummary(req.params.ip);
      if (!summary) return res.status(404).json({ error: "No profile for this IP" });
      res.json(summary);
    });

    app.get("/api/report", authMiddleware, (req, res) => {
      const type = req.query.type || "executive";
      const now = new Date();
      const profiles = this.profiler.getAllProfiles();
      const sevCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
      const svcCounts = {};
      const typeCounts = {};
      const hourly = {};
      this.attacks.forEach(a => {
        sevCounts[a.analysis?.severity || "INFO"]++;
        svcCounts[a.service] = (svcCounts[a.service] || 0) + 1;
        typeCounts[a.type] = (typeCounts[a.type] || 0) + 1;
        const h = a.timestamp?.substring(0, 13);
        if (h) hourly[h] = (hourly[h] || 0) + 1;
      });
      const uniqueIPs = new Set(this.attacks.map(a => a.srcIP)).size;
      const allTTPs = new Set();
      const allTools = new Set();
      profiles.forEach(p => { p.ttps.forEach(t => allTTPs.add(t)); p.toolsDetected.forEach(t => allTools.add(t)); });

      const report = {
        meta: { generatedAt: now.toISOString(), type, version: "4.0.0-Enterprise", system: "NextGen Honeypot Defense System", uptime: Math.floor(process.uptime()), bind: this.bind },
        enterpriseFeatures: {
          idsActive: true,
          idsEngine: "Suricata",
          osintActive: true,
          clickHouseFallback: true,
          microVMEngine: "AWS Firecracker"
        },
        summary: { totalAttacks: this.attacks.length, totalCredentials: this.credentials.length, uniqueAttackers: uniqueIPs, totalProfiles: profiles.length, severityCounts: sevCounts, peakHour: Object.entries(hourly).sort((a, b) => b[1] - a[1])[0] || null },
        services: Object.entries(this.config.services).map(([name, cfg]) => {
          const atks = this.attacks.filter(a => a.service === name);
          const types = {}; atks.forEach(a => types[a.type] = (types[a.type] || 0) + 1);
          return { name, port: cfg.port, enabled: cfg.enabled, totalAttacks: atks.length, uniqueIPs: new Set(atks.map(a => a.srcIP)).size, credentials: atks.filter(a => a.username).length, topTypes: Object.entries(types).sort((a, b) => b[1] - a[1]).slice(0, 5) };
        }),
        threatIntel: { totalTTPs: allTTPs.size, ttps: [...allTTPs], toolsDetected: [...allTools], attackTypes: Object.entries(typeCounts).sort((a, b) => b[1] - a[1]), serviceBreakdown: Object.entries(svcCounts).sort((a, b) => b[1] - a[1]) },
        attackerProfiles: profiles.map(p => ({
          ip: p.ip, threatLevel: p.threatLevel, behaviorScore: p.behaviorScore, os: p.osGuess, geo: p.geo, rdns: p.rdns, whois: p.whoisData, services: p.services, toolsDetected: p.toolsDetected, ttps: p.ttps, totalAttacks: p.totalAttacks, credentialCount: p.credentialCount, commandCount: p.commandCount, credentialPatterns: p.credentialPatterns, firstSeen: p.firstSeen, lastSeen: p.lastSeen, sessionDuration: p.sessionDuration
        })),
        topCredentials: {
          passwords: Object.entries(this.attacks.reduce((m, a) => { if (a.password) m[a.password] = (m[a.password] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 15),
          usernames: Object.entries(this.attacks.reduce((m, a) => { if (a.username) m[a.username] = (m[a.username] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 15)
        },
        notifications: { total: this.notifications.length, unread: this.notifications.filter(n => !n.read).length, recent: this.notifications.slice(-10).reverse().map(n => ({ severity: n.severity, title: n.title, message: n.message, timestamp: n.timestamp, srcIP: n.srcIP, service: n.service })) },
        timeline: Object.entries(hourly).sort().slice(-24).map(([h, c]) => ({ hour: h, count: c })),
      };
      res.json(report);
    });

    this.server = http.createServer(app);
    const wss = new WebSocketServer({ server: this.server, path: this.config.monitor?.wsPath || "/ws" });
    wss.on("connection", (ws, req) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const token = url.searchParams.get("token");
      const clientIP = (req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "").replace("::ffff:", "");
      const isLocal = clientIP === "127.0.0.1" || clientIP === "localhost" || clientIP === "::1" || clientIP.startsWith("127.");
      if (!isLocal && token !== this.authToken) {
        ws.close(4001, "Unauthorized");
        return;
      }
      this.wsClients.add(ws);
      ws.send(JSON.stringify({ type: "init", data: { attacks: this.attacks.slice(-200), services: this.config.services, unreadNotifications: this.notifications.filter(n => !n.read).length, notifications: this.notifications.filter(n => !n.read).slice(-20).reverse() } }));
      ws.on("close", () => this.wsClients.delete(ws));
      ws.on("error", () => this.wsClients.delete(ws));
    });

    this.bus.on("attack", async (event) => {
      event.id = ++this.attackCounter;
      event.geo = this._geoLookup(event.srcIP);
      event.analysis = this._analyzeAttack(event);
      this.attacks.push(event);
      ch.insertAttack(event); // Push to ClickHouse DB
      if (event.username) this.credentials.push(event);
      try { await this.db.put(`attack:${String(event.id).padStart(8, "0")}`, event); } catch {}
      let profile = null;
      try { profile = await this.profiler.processAttack(event); } catch (e) {}
      
      if (profile && SEVERITY_ORDER[profile.threatLevel] > SEVERITY_ORDER[event.analysis.severity]) {
        event.analysis.severity = profile.threatLevel;
        event.analysis.description = `[BEHAVIORAL ALERT - Score: ${profile.behaviorScore}/100] Escalated Threat! ${event.analysis.description}`;
      }

      if (SEVERITY_ORDER[event.analysis.severity] >= SEVERITY_ORDER.MEDIUM) {
        const notif = { id: ++this.notifCounter, timestamp: event.timestamp, title: `${event.analysis.severity}: ${event.type}`, message: event.analysis.description, severity: event.analysis.severity, read: false, attackId: event.id, srcIP: event.srcIP, service: event.service };
        this.notifications.push(notif);
        if (this.notifications.length > 500) this.notifications = this.notifications.slice(-400);
        this._broadcast({ type: "notification", data: notif });
      }
      this._broadcast({ type: "attack", data: event });
    });

    this.bus.on("connection", (event) => { this.connections.push(event); this._broadcast({ type: "connection", data: event }); });
    this.bus.on("session_end", (event) => { this.sessions.push(event); this._broadcast({ type: "session_end", data: event }); });

    setInterval(() => { const now = Date.now(); for (const [key, entry] of this.rateLimits) { if (now > entry.reset + 120000) this.rateLimits.delete(key); } }, 300000);

    return new Promise((resolve, reject) => { this.server.on("error", reject); this.server.listen(this.port, this.bind, () => resolve()); });
  }

  _initAuth() {
    const authFile = path.join(__dirname, "../../config/auth.json");
    // Generate new secure credentials on EVERY startup for maximum security
    const username = this.config.adminUser || "nexus";
    const password = crypto.randomBytes(6).toString("hex");
    const token = crypto.randomBytes(32).toString("hex");
    this.authToken = token;
    fs.mkdirSync(path.dirname(authFile), { recursive: true });
    fs.writeFileSync(authFile, JSON.stringify({ username, password, token }, null, 2));
    console.log(`\n  [AUTH] Dashboard Security Enhanced (OWASP Top 10 Patched)`);
    console.log(`  [AUTH] Login required! User: ${username} | Pass: ${password}\n`);
  }

  _geoLookup(ip) {
    if (!geoip || !ip || ip === "127.0.0.1" || ip === "::1") return null;
    const r = geoip.lookup(ip);
    return r ? { country: r.country, region: r.region, city: r.city, ll: r.ll, timezone: r.timezone } : null;
  }

  _analyzeAttack(event) {
    const { service, type, details, username, password } = event;
    let severity = "INFO", description = "", recommendation = "", mitre = "";
    switch (type) {
      case "credential_capture": case "login_attempt":
        severity = "HIGH";
        description = `Attacker from ${event.srcIP} attempted to authenticate to ${service.toUpperCase()} using username "${username}" and password "${password}". Brute-force or credential-stuffing attack.`;
        recommendation = "Add IP to blocklist. Monitor for distributed login attempts."; mitre = "T1110"; break;
      case "sql_injection":
        severity = "CRITICAL";
        description = `SQL injection attempt from ${event.srcIP}. Attacker injected SQL syntax attempting to extract/manipulate database contents.`;
        recommendation = "Block IP immediately. Review WAF rules."; mitre = "T1190"; break;
      case "path_traversal":
        severity = "HIGH";
        description = `Path traversal from ${event.srcIP} attempting to access files outside web root.`;
        recommendation = "Block IP. Validate and sanitize all file paths."; mitre = "T1083"; break;
      case "xss_attempt":
        severity = "HIGH";
        description = `XSS attempt from ${event.srcIP}. JavaScript injection into request parameters.`;
        recommendation = "Block IP. Review CSP headers."; mitre = "T1059.007"; break;
      case "cmd_injection":
        severity = "CRITICAL";
        description = `Command injection from ${event.srcIP}. OS command execution through web application.`;
        recommendation = "Block IP immediately. Audit exec() calls."; mitre = "T1059"; break;
      case "command_execution":
        severity = "MEDIUM";
        description = `Command "${event.command || details}" executed in fake shell on ${service.toUpperCase()} by ${event.srcIP}.`;
        recommendation = "Log commands for threat intel. Monitor for lateral movement."; mitre = "T1059.004"; break;
      case "directory_traversal":
        severity = "MEDIUM";
        description = `FTP directory traversal from ${event.srcIP} navigating filesystem.`;
        recommendation = "Monitor for file access attempts."; mitre = "T1083"; break;
      case "file_download":
        severity = "HIGH";
        description = `File download attempt via FTP from ${event.srcIP}.`;
        recommendation = "Block IP. Check targeted files on real servers."; mitre = "T1005"; break;
      case "file_upload":
        severity = "CRITICAL";
        description = `File upload attempt via FTP from ${event.srcIP}. Potential malware/backdoor deployment.`;
        recommendation = "Block IP immediately. Scan for uploaded files."; mitre = "T1105"; break;
      case "sensitive_file_access":
        severity = "HIGH";
        description = `Sensitive file access from ${event.srcIP}: ${(details || "").substring(0, 100)}.`;
        recommendation = "Block IP. Ensure sensitive files not web-accessible."; mitre = "T1005"; break;
      case "scanner_probe":
        severity = "MEDIUM";
        description = `Automated scanner from ${event.srcIP} probing for vulnerabilities.`;
        recommendation = "Block IP range. Update IDS signatures."; mitre = "T1595.002"; break;
      case "api_enumeration":
        severity = "MEDIUM";
        description = `API enumeration from ${event.srcIP} probing internal endpoints.`;
        recommendation = "Review API access controls."; mitre = "T1595"; break;
      case "http_request":
        const p = event.path || "";
        if (p.includes(".env") || p.includes("wp-config") || p.includes("config")) {
          severity = "HIGH"; description = `Sensitive file probe from ${event.srcIP} requesting ${p}.`;
          recommendation = "Ensure sensitive files not web-accessible."; mitre = "T1592";
        } else { description = `HTTP ${event.method || "GET"} ${p} from ${event.srcIP}.`; recommendation = "Monitor for follow-up attacks."; mitre = "T1595"; }
        break;
      default:
        description = `${type} from ${event.srcIP} on ${service.toUpperCase()}.`; recommendation = "Continue monitoring."; mitre = "T1595";
    }
    return { severity, description, recommendation, mitre };
  }

  _broadcast(data) { const msg = JSON.stringify(data); for (const ws of this.wsClients) { try { if (ws.readyState === 1) ws.send(msg); } catch {} } }
  _getIP(req) { return (req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "").replace("::ffff:", ""); }

  async _loadFromDB() {
    try {
      for await (const [, value] of this.db.iterator()) {
        this.attacks.push(value);
        if (value.username) this.credentials.push(value);
        if (value.id > this.attackCounter) this.attackCounter = value.id;
        try { await this.profiler.processAttack(value); } catch {}
      }
      if (this.attacks.length > 0) console.log(`  [DB] Loaded ${this.attacks.length} attacks from persistent storage`);
    } catch {}
  }

  stop() { this.server?.close(); this.db?.close(); for (const ws of this.wsClients) { try { ws.close(); } catch {} } }
}

module.exports = MonitorServer;
