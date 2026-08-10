const https = require("https");
const crypto = require("crypto");

class OSINTEngine {
  constructor() {
    // These should ideally come from environment variables (.env)
    this.vtApiKey = process.env.VIRUSTOTAL_API_KEY || null;
    this.abuseIpdbKey = process.env.ABUSEIPDB_API_KEY || null;
    this.cache = new Map();
  }

  // Calculate SHA-256 of any payload buffer
  calculateHash(buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex");
  }

  async queryVirusTotalHash(hash) {
    if (!this.vtApiKey) return { status: "skipped", reason: "No API Key" };
    if (this.cache.has(hash)) return this.cache.get(hash);

    return new Promise((resolve) => {
      const options = {
        hostname: "www.virustotal.com",
        path: `/api/v3/files/${hash}`,
        method: "GET",
        headers: { "x-apikey": this.vtApiKey }
      };

      https.get(options, (res) => {
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            if (json.data && json.data.attributes) {
              const attrs = json.data.attributes;
              const result = {
                malicious: attrs.last_analysis_stats?.malicious || 0,
                undetected: attrs.last_analysis_stats?.undetected || 0,
                family: attrs.popular_threat_classification?.suggested_threat_label || "Unknown Malware",
                names: attrs.names ? attrs.names.slice(0, 3) : []
              };
              this.cache.set(hash, result);
              resolve(result);
            } else {
              resolve({ status: "clean_or_not_found" });
            }
          } catch (e) { resolve({ error: e.message }); }
        });
      }).on("error", () => resolve({ error: "Network Error" }));
    });
  }

  async queryAbuseIPDB(ip) {
    if (!this.abuseIpdbKey) return { status: "skipped", reason: "No API Key" };
    if (this.cache.has(ip)) return this.cache.get(ip);

    return new Promise((resolve) => {
      const options = {
        hostname: "api.abuseipdb.com",
        path: `/api/v2/check?ipAddress=${ip}&maxAgeInDays=90`,
        method: "GET",
        headers: { "Key": this.abuseIpdbKey, "Accept": "application/json" }
      };

      https.get(options, (res) => {
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            if (json.data) {
              const result = {
                abuseConfidenceScore: json.data.abuseConfidenceScore,
                totalReports: json.data.totalReports,
                isPublic: json.data.isPublic,
                usageType: json.data.usageType,
                isp: json.data.isp,
                domain: json.data.domain
              };
              this.cache.set(ip, result);
              resolve(result);
            } else {
              resolve({ status: "not_found" });
            }
          } catch (e) { resolve({ error: e.message }); }
        });
      }).on("error", () => resolve({ error: "Network Error" }));
    });
  }
}

module.exports = new OSINTEngine();
