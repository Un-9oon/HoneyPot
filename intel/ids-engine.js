const fs = require('fs');
const path = require('path');
const readline = require('readline');

class IDSEngine {
  constructor(bus) {
    this.bus = bus;
    this.logFile = path.join(__dirname, '../../data/suricata-logs/eve.json');
    this.lastSize = 0;
  }

  start() {
    if (!fs.existsSync(path.dirname(this.logFile))) {
      fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
    }

    // Touch the file if it doesn't exist
    if (!fs.existsSync(this.logFile)) {
      fs.writeFileSync(this.logFile, "");
    }

    console.log("[IDS Engine] Monitoring Suricata eve.json for CVE alerts...");

    // Watch the file for changes
    fs.watch(this.logFile, (eventType) => {
      if (eventType === 'change') {
        this.processNewLogs();
      }
    });
  }

  processNewLogs() {
    const stats = fs.statSync(this.logFile);
    if (stats.size < this.lastSize) {
      this.lastSize = 0; // File was rotated/truncated
    }

    if (stats.size === this.lastSize) return;

    const stream = fs.createReadStream(this.logFile, {
      start: this.lastSize,
      end: stats.size,
      encoding: 'utf8'
    });

    this.lastSize = stats.size;

    const rl = readline.createInterface({ input: stream });

    rl.on('line', (line) => {
      try {
        const event = JSON.parse(line);
        if (event.event_type === 'alert' && event.alert) {
          const { action, signature, severity, category } = event.alert;
          
          this.bus.emit('attack', {
            service: 'IDS',
            type: 'ids_alert',
            srcIP: event.src_ip,
            srcPort: event.src_port,
            dstPort: event.dest_port,
            timestamp: event.timestamp,
            details: `[Suricata] Signature: ${signature} | Category: ${category}`,
            command: signature, // Map signature to command for profiler
            analysis: {
              severity: severity === 1 ? "CRITICAL" : severity === 2 ? "HIGH" : "MEDIUM",
              description: `Deep Packet Inspection detected known malware/exploit pattern: ${signature}`
            }
          });
        }
      } catch (err) {
        // Ignore JSON parse errors for partial lines
      }
    });
  }
}

module.exports = IDSEngine;
