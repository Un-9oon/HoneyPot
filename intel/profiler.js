const dns = require("dns");
const os = require("os");
const https = require("https");
const http = require("http");
const osint = require("./osint-engine");

class AttackerProfiler {
  constructor() {
    this.profiles = new Map();
  }

  getProfile(ip) {
    if (!this.profiles.has(ip)) {
      this.profiles.set(ip, {
        ip,
        firstSeen: null,
        lastSeen: null,
        totalAttacks: 0,
        sessions: [],
        credentials: [],
        commands: [],
        services: new Set(),
        attackTypes: new Set(),
        paths: [],
        userAgents: new Set(),
        sshClients: new Set(),
        geo: null,
        rdns: null,
        rdnsLookedUp: false,
        osGuess: null,
        toolsDetected: new Set(),
        behaviorScore: 0,
        threatLevel: "LOW",
        ttps: new Set(),
        tcpFingerprint: null,
        httpFingerprints: [],
        commandSequences: [],
        credentialPatterns: null,
        whoisData: null,
        whoisLookedUp: false,
        timeline: [],
      });
    }
    return this.profiles.get(ip);
  }

  async processAttack(event) {
    const p = this.getProfile(event.srcIP);
    const now = new Date().toISOString();

    if (!p.firstSeen) p.firstSeen = event.timestamp || now;
    p.lastSeen = event.timestamp || now;
    p.totalAttacks++;
    p.services.add(event.service);
    p.attackTypes.add(event.type);
    if (event.geo) p.geo = event.geo;

    p.timeline.push({
      timestamp: event.timestamp || now,
      service: event.service,
      type: event.type,
      details: (event.details || "").substring(0, 200),
      severity: event.analysis?.severity || "INFO",
    });
    if (p.timeline.length > 500) p.timeline = p.timeline.slice(-500);

    if (event.username) {
      p.credentials.push({
        username: event.username,
        password: event.password || "",
        service: event.service,
        timestamp: event.timestamp || now,
      });
    }

    if (event.command) {
      p.commands.push(event.command);
      p.commandSequences.push({
        cmd: event.command,
        service: event.service,
        timestamp: event.timestamp || now,
      });
    }

    if (event.path) p.paths.push(event.path);
    if (event.userAgent) {
      p.userAgents.add(event.userAgent);
      this._detectToolsFromUA(p, event.userAgent);
      this._detectOSFromUA(p, event.userAgent);
    }

    if (event.raw) this._analyzeRawData(p, event.raw, event.service);
    if (event.headers) this._analyzeHeaders(p, event.headers);

    this._detectTTPs(p, event);
    this._updateBehaviorScore(p);
    this._classifyThreat(p);
    this._analyzeCredentialPatterns(p);

    if (!p.rdnsLookedUp) {
      p.rdnsLookedUp = true;
      this._reverseDNS(p);
    }

    if (!p.whoisLookedUp && !this._isPrivateIP(p.ip)) {
      p.whoisLookedUp = true;
      this._whoisLookup(p);
    }

    return this.getProfileSummary(p.ip);
  }

  _detectToolsFromUA(p, ua) {
    const tools = [
      [/nmap/i, "Nmap Scanner"],
      [/nikto/i, "Nikto Vulnerability Scanner"],
      [/sqlmap/i, "SQLMap Injection Tool"],
      [/masscan/i, "Masscan Port Scanner"],
      [/dirbuster/i, "DirBuster Directory Scanner"],
      [/gobuster/i, "Gobuster Directory Scanner"],
      [/ffuf/i, "FFUF Fuzzer"],
      [/nuclei/i, "Nuclei Vulnerability Scanner"],
      [/wpscan/i, "WPScan WordPress Scanner"],
      [/hydra/i, "Hydra Brute Forcer"],
      [/medusa/i, "Medusa Brute Forcer"],
      [/burp/i, "Burp Suite"],
      [/zap/i, "OWASP ZAP"],
      [/metasploit/i, "Metasploit Framework"],
      [/python-requests/i, "Python Requests (Scripted)"],
      [/python-urllib/i, "Python urllib (Scripted)"],
      [/curl/i, "cURL"],
      [/wget/i, "Wget"],
      [/go-http-client/i, "Go HTTP Client (Scripted)"],
      [/scrapy/i, "Scrapy Web Crawler"],
      [/axios/i, "Axios (Node.js Scripted)"],
      [/libwww-perl/i, "Perl LWP (Scripted)"],
      [/zgrab/i, "ZGrab Scanner"],
      [/censys/i, "Censys Scanner"],
      [/shodan/i, "Shodan Scanner"],
    ];
    for (const [rx, name] of tools) {
      if (rx.test(ua)) p.toolsDetected.add(name);
    }
  }

  _detectOSFromUA(p, ua) {
    const osPatterns = [
      [/Windows NT 10\.0/i, "Windows 10/11"],
      [/Windows NT 6\.3/i, "Windows 8.1"],
      [/Windows NT 6\.2/i, "Windows 8"],
      [/Windows NT 6\.1/i, "Windows 7"],
      [/Windows/i, "Windows (Unknown Version)"],
      [/Mac OS X (\d+[._]\d+[._]?\d*)/i, "macOS $1"],
      [/Macintosh/i, "macOS"],
      [/Ubuntu/i, "Ubuntu Linux"],
      [/Debian/i, "Debian Linux"],
      [/Fedora/i, "Fedora Linux"],
      [/CentOS/i, "CentOS Linux"],
      [/Red Hat/i, "Red Hat Linux"],
      [/Arch/i, "Arch Linux"],
      [/Kali/i, "Kali Linux"],
      [/Parrot/i, "Parrot Security OS"],
      [/Android (\d+)/i, "Android $1"],
      [/Android/i, "Android"],
      [/iPhone|iPad/i, "iOS"],
      [/Linux x86_64/i, "Linux x86_64"],
      [/Linux i686/i, "Linux x86"],
      [/Linux aarch64/i, "Linux ARM64"],
      [/Linux/i, "Linux"],
      [/FreeBSD/i, "FreeBSD"],
      [/OpenBSD/i, "OpenBSD"],
    ];
    for (const [rx, name] of osPatterns) {
      const m = ua.match(rx);
      if (m) {
        p.osGuess = name.replace("$1", (m[1] || "").replace(/_/g, "."));
        return;
      }
    }
  }

  _analyzeRawData(p, raw, service) {
    if (service === "ssh") {
      const sshMatch = raw.match(/SSH-[\d.]+-(\S+)/);
      if (sshMatch) {
        p.sshClients.add(sshMatch[1]);
        this._detectOSFromSSH(p, sshMatch[1]);
      }
    }
  }

  _detectOSFromSSH(p, client) {
    const sshOS = [
      [/OpenSSH_\d+\.\d+p\d+\s+Ubuntu/i, "Ubuntu Linux"],
      [/OpenSSH_\d+\.\d+p\d+\s+Debian/i, "Debian Linux"],
      [/OpenSSH.*FreeBSD/i, "FreeBSD"],
      [/libssh/i, "Linux (libssh client)"],
      [/PuTTY/i, "Windows (PuTTY)"],
      [/WinSCP/i, "Windows (WinSCP)"],
      [/paramiko/i, "Python (Paramiko)"],
      [/Bitvise/i, "Windows (Bitvise)"],
      [/JSCH/i, "Java (JSch)"],
      [/dropbear/i, "Embedded Linux (Dropbear)"],
      [/OpenSSH_for_Windows/i, "Windows (OpenSSH)"],
      [/OpenSSH_\d+\.\d+/i, "Linux/Unix (OpenSSH)"],
    ];
    if (!p.osGuess) {
      for (const [rx, name] of sshOS) {
        if (rx.test(client)) { p.osGuess = name; return; }
      }
    }
  }

  _analyzeHeaders(p, headers) {
    if (!headers) return;
    const fp = {};
    const interesting = ["accept", "accept-language", "accept-encoding", "connection", "cache-control", "x-forwarded-for", "x-real-ip", "origin", "referer"];
    for (const h of interesting) {
      if (headers[h]) fp[h] = headers[h];
    }
    if (headers["accept-language"]) {
      const lang = headers["accept-language"].split(",")[0].trim();
      fp.primaryLanguage = lang;
    }
    if (Object.keys(fp).length > 0) {
      p.httpFingerprints.push(fp);
      if (p.httpFingerprints.length > 20) p.httpFingerprints = p.httpFingerprints.slice(-20);
    }
  }

  _detectTTPs(p, event) {
    const ttpMap = {
      credential_capture: ["T1110 - Brute Force", "T1078 - Valid Accounts"],
      login_attempt: ["T1110 - Brute Force"],
      sql_injection: ["T1190 - Exploit Public-Facing Application", "T1059 - Command and Scripting Interpreter"],
      cmd_injection: ["T1059 - Command and Scripting Interpreter", "T1190 - Exploit Public-Facing Application"],
      xss_attempt: ["T1189 - Drive-by Compromise"],
      directory_traversal: ["T1083 - File and Directory Discovery"],
      path_traversal: ["T1083 - File and Directory Discovery"],
      sensitive_file_access: ["T1005 - Data from Local System", "T1083 - File and Directory Discovery"],
      scanner_detected: ["T1595 - Active Scanning", "T1046 - Network Service Discovery"],
      command_execution: ["T1059 - Command and Scripting Interpreter", "T1033 - System Owner/User Discovery"],
      file_download: ["T1005 - Data from Local System", "T1041 - Exfiltration Over C2 Channel"],
      connection: ["T1046 - Network Service Discovery"],
      data_received: ["T1071 - Application Layer Protocol"],
    };
    const ttps = ttpMap[event.type] || [];
    for (const t of ttps) p.ttps.add(t);

    if (event.command) {
      const cmdTTPs = {
        whoami: "T1033 - System Owner/User Discovery",
        id: "T1033 - System Owner/User Discovery",
        uname: "T1082 - System Information Discovery",
        "cat /etc/passwd": "T1003 - OS Credential Dumping",
        "cat /etc/shadow": "T1003 - OS Credential Dumping",
        ifconfig: "T1016 - System Network Configuration Discovery",
        "ip addr": "T1016 - System Network Configuration Discovery",
        netstat: "T1049 - System Network Connections Discovery",
        "ss -": "T1049 - System Network Connections Discovery",
        "ps aux": "T1057 - Process Discovery",
        env: "T1082 - System Information Discovery",
        history: "T1552 - Unsecured Credentials",
        wget: "T1105 - Ingress Tool Transfer",
        curl: "T1105 - Ingress Tool Transfer",
        "ssh-": "T1552.004 - Private Keys",
        crontab: "T1053 - Scheduled Task/Job",
        "chmod +x": "T1222 - File and Directory Permissions Modification",
        "rm -rf": "T1485 - Data Destruction",
        "iptables": "T1562 - Impair Defenses",
      };
      for (const [cmd, ttp] of Object.entries(cmdTTPs)) {
        if (event.command.includes(cmd)) p.ttps.add(ttp);
      }
    }
  }

  _updateBehaviorScore(p) {
    let score = 0;
    score += Math.min(p.totalAttacks * 2, 30);
    score += p.credentials.length * 5;
    score += p.commands.length * 3;
    score += p.services.size * 8;
    score += p.toolsDetected.size * 10;
    score += p.ttps.size * 4;
    score += p.paths.filter(path => /\.\.|etc\/passwd|\.env|\.git|wp-config|backup/i.test(path)).length * 7;

    const uniqueUsers = new Set(p.credentials.map(c => c.username)).size;
    const uniquePass = new Set(p.credentials.map(c => c.password)).size;
    if (uniqueUsers > 3) score += 10;
    if (uniquePass > 5) score += 10;

    if (p.commands.some(c => /wget|curl/.test(c))) score += 15;
    if (p.commands.some(c => /rm\s+-rf|chmod|chown/.test(c))) score += 20;
    if (p.commands.some(c => /etc\/shadow|\.ssh\/id_rsa/.test(c))) score += 15;

    const duration = (new Date(p.lastSeen) - new Date(p.firstSeen)) / 1000;
    if (duration > 300) score += 10;
    if (duration > 3600) score += 15;

    p.behaviorScore = Math.min(score, 100);
  }

  _classifyThreat(p) {
    if (p.behaviorScore >= 75) p.threatLevel = "CRITICAL";
    else if (p.behaviorScore >= 50) p.threatLevel = "HIGH";
    else if (p.behaviorScore >= 25) p.threatLevel = "MEDIUM";
    else p.threatLevel = "LOW";
  }

  _analyzeCredentialPatterns(p) {
    if (p.credentials.length === 0) { p.credentialPatterns = null; return; }
    const users = p.credentials.map(c => c.username);
    const passes = p.credentials.map(c => c.password);
    const uniqueUsers = [...new Set(users)];
    const uniquePasses = [...new Set(passes)];

    const commonDefaults = ["admin", "root", "test", "user", "guest", "administrator", "postgres", "mysql", "ftp", "oracle"];
    const defaultCredsUsed = uniqueUsers.filter(u => commonDefaults.includes(u.toLowerCase()));

    const weakPasses = uniquePasses.filter(p => /^(123456|password|admin|root|test|qwerty|letmein|welcome|monkey|dragon|master|login|abc123|passw0rd|12345678)$/i.test(p));

    let attackType = "unknown";
    if (uniqueUsers.length === 1 && uniquePasses.length > 3) attackType = "password_spray";
    else if (uniqueUsers.length > 3 && uniquePasses.length === 1) attackType = "username_enum";
    else if (uniqueUsers.length > 2 && uniquePasses.length > 2) attackType = "dictionary_attack";
    else if (uniqueUsers.length <= 2 && uniquePasses.length <= 2) attackType = "targeted";

    p.credentialPatterns = {
      totalAttempts: p.credentials.length,
      uniqueUsernames: uniqueUsers.length,
      uniquePasswords: uniquePasses.length,
      defaultCredsUsed,
      weakPasswords: weakPasses.length,
      attackType,
      topUsernames: this._topN(users, 5),
      topPasswords: this._topN(passes, 5),
    };
  }

  _topN(arr, n) {
    const counts = {};
    arr.forEach(v => counts[v] = (counts[v] || 0) + 1);
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ value: k, count: v }));
  }

  _reverseDNS(p) {
    dns.reverse(p.ip, (err, hostnames) => {
      if (!err && hostnames && hostnames.length > 0) {
        p.rdns = hostnames;
      } else {
        p.rdns = null;
      }
    });
  }

  _whoisLookup(p) {
    const ip = p.ip;
    const url = `https://rdap.arin.net/registry/ip/${ip}`;
    https.get(url, { timeout: 5000 }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          p.whoisData = {
            name: json.name || null,
            handle: json.handle || null,
            type: json.type || null,
            startAddress: json.startAddress || null,
            endAddress: json.endAddress || null,
            country: json.country || null,
            orgName: null,
            abuseContact: null,
          };
          if (json.entities) {
            for (const entity of json.entities) {
              if (entity.roles?.includes("registrant") || entity.roles?.includes("abuse")) {
                p.whoisData.orgName = p.whoisData.orgName || entity.vcardArray?.[1]?.find(v => v[0] === "fn")?.[3];
              }
              if (entity.roles?.includes("abuse")) {
                const email = entity.vcardArray?.[1]?.find(v => v[0] === "email");
                if (email) p.whoisData.abuseContact = email[3];
              }
            }
          }
        } catch { p.whoisData = null; }
        
        // Asynchronously query AbuseIPDB
        osint.queryAbuseIPDB(ip).then(abuseData => {
          if (!abuseData.status || abuseData.abuseConfidenceScore !== undefined) {
            p.osint = p.osint || {};
            p.osint.abuseIpdb = abuseData;
            if (abuseData.abuseConfidenceScore > 50) p.behaviorScore = Math.min(p.behaviorScore + 30, 100);
          }
        });
        
      });
    }).on("error", () => { p.whoisData = null; });
  }

  _isPrivateIP(ip) {
    return /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1|fe80::|fc00::)/.test(ip);
  }

  getProfileSummary(ip) {
    const p = this.profiles.get(ip);
    if (!p) return null;

    const duration = p.firstSeen && p.lastSeen
      ? (new Date(p.lastSeen) - new Date(p.firstSeen)) / 1000
      : 0;

    return {
      ip: p.ip,
      firstSeen: p.firstSeen,
      lastSeen: p.lastSeen,
      totalAttacks: p.totalAttacks,
      services: [...p.services],
      attackTypes: [...p.attackTypes],
      geo: p.geo,
      rdns: p.rdns,
      osGuess: p.osGuess,
      toolsDetected: [...p.toolsDetected],
      sshClients: [...p.sshClients],
      behaviorScore: p.behaviorScore,
      threatLevel: p.threatLevel,
      ttps: [...p.ttps],
      credentialPatterns: p.credentialPatterns,
      whoisData: p.whoisData,
      userAgents: [...p.userAgents],
      commandCount: p.commands.length,
      credentialCount: p.credentials.length,
      sessionDuration: duration,
      pathsAccessed: [...new Set(p.paths)].slice(0, 20),
      httpFingerprints: p.httpFingerprints.slice(-5),
      timeline: p.timeline.slice(-50),
      commandSequences: p.commandSequences.slice(-30),
      isPrivateIP: this._isPrivateIP(p.ip),
    };
  }

  getAllProfiles() {
    const result = [];
    for (const ip of this.profiles.keys()) {
      result.push(this.getProfileSummary(ip));
    }
    return result.sort((a, b) => b.behaviorScore - a.behaviorScore);
  }
}

module.exports = AttackerProfiler;
