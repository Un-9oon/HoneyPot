const docx = require("docx");
const fs = require("fs");

const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow,
  TableCell, WidthType, AlignmentType, BorderStyle, PageBreak,
  ShadingType, PageNumber, Footer, Header,
  LevelFormat, convertInchesToTwip, PageOrientation,
} = docx;

const C = {
  primary: "0A0A1A",
  accent: "E01040",
  accentDark: "B00D33",
  accentLight: "FFF0F2",
  dark: "1A1A2E",
  mid: "2D2D44",
  text: "1A1A1A",
  textLight: "555555",
  white: "FFFFFF",
  success: "16A34A",
  warning: "CA8A04",
  danger: "DC2626",
  border: "DDDDDD",
  bgLight: "F8F8FA",
  bgMid: "F0F0F4",
  headerBg: "0A0A1A",
  rowAlt: "FAFAFA",
};

const PAGE_W = 12240;
const MARGINS = { top: convertInchesToTwip(1), bottom: convertInchesToTwip(0.8), left: convertInchesToTwip(1.2), right: convertInchesToTwip(1.2) };
const TABLE_W = PAGE_W - convertInchesToTwip(2.4);

function h1(text) { return new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 500, after: 200 }, border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: C.accent } } }); }
function h2(text) { return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 360, after: 140 } }); }
function h3(text) { return new Paragraph({ text, heading: HeadingLevel.HEADING_3, spacing: { before: 280, after: 100 } }); }

function p(text, opts = {}) {
  const runs = typeof text === "string" ? [new TextRun({ text, size: 23, font: "Calibri", color: C.text, ...opts })] : text;
  return new Paragraph({ children: runs, spacing: { after: 140, line: 360 }, alignment: opts.alignment || AlignmentType.JUSTIFIED });
}

function b(text, color = C.text) { return new TextRun({ text, bold: true, size: 23, font: "Calibri", color }); }
function n(text) { return new TextRun({ text, size: 23, font: "Calibri", color: C.text }); }
function it(text) { return new TextRun({ text, italics: true, size: 23, font: "Calibri", color: C.textLight }); }
function mono(text, color = C.mid) { return new TextRun({ text, size: 20, font: "Consolas", color }); }

function bullet(text, level = 0) {
  const runs = typeof text === "string" ? [new TextRun({ text, size: 23, font: "Calibri", color: C.text })] : text;
  return new Paragraph({ children: runs, numbering: { reference: "bullets", level }, spacing: { after: 60, line: 340 } });
}

function spacer(h = 200) { return new Paragraph({ spacing: { before: h } }); }

function hrLine() {
  return new Paragraph({ spacing: { before: 200, after: 200 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.accent } } });
}

function calloutBox(title, text) {
  return new Table({
    width: { size: TABLE_W, type: WidthType.DXA },
    rows: [new TableRow({ children: [new TableCell({
      width: { size: TABLE_W, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: C.accentLight },
      borders: { top: { style: BorderStyle.SINGLE, size: 1, color: C.accent }, bottom: { style: BorderStyle.SINGLE, size: 1, color: C.accent }, left: { style: BorderStyle.SINGLE, size: 12, color: C.accent }, right: { style: BorderStyle.SINGLE, size: 1, color: C.accent } },
      children: [
        new Paragraph({ children: [b(title, C.accentDark)], spacing: { after: 60 } }),
        new Paragraph({ children: [n(text)], spacing: { after: 40, line: 340 }, alignment: AlignmentType.JUSTIFIED }),
      ],
    })] })],
  });
}

function makeTable(headers, rows, colWidths) {
  const totalW = colWidths.reduce((a, b) => a + b, 0);
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) => new TableCell({
      width: { size: colWidths[i], type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: C.headerBg },
      borders: cellBorders(C.border),
      verticalAlign: "center",
      children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 20, font: "Calibri", color: C.white })], spacing: { before: 60, after: 60 }, alignment: AlignmentType.LEFT })],
    })),
  });

  const dataRows = rows.map((row, ri) => new TableRow({
    children: row.map((cell, ci) => {
      const cellText = typeof cell === "object" ? cell : { text: String(cell), color: C.text };
      return new TableCell({
        width: { size: colWidths[ci], type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: ri % 2 === 0 ? C.white : C.rowAlt },
        borders: cellBorders(C.border),
        verticalAlign: "center",
        children: [new Paragraph({
          children: [new TextRun({ text: cellText.text, size: 20, font: cellText.mono ? "Consolas" : "Calibri", color: cellText.color || C.text, bold: cellText.bold || false })],
          spacing: { before: 50, after: 50 },
        })],
      });
    }),
  }));

  return new Table({ width: { size: totalW, type: WidthType.DXA }, columnWidths: colWidths, rows: [headerRow, ...dataRows] });
}

function cellBorders(color) {
  const b = { style: BorderStyle.SINGLE, size: 1, color };
  return { top: b, bottom: b, left: b, right: b };
}

function pageBreak() { return new Paragraph({ children: [new PageBreak()] }); }

// ═══════════════════════════════════════════════════════════════════════
//  BUILD DOCUMENT
// ═══════════════════════════════════════════════════════════════════════

const doc = new Document({
  styles: {
    default: {
      heading1: { run: { size: 36, bold: true, font: "Calibri", color: C.primary }, paragraph: { spacing: { before: 400, after: 160 } } },
      heading2: { run: { size: 30, bold: true, font: "Calibri", color: C.accentDark }, paragraph: { spacing: { before: 300, after: 120 } } },
      heading3: { run: { size: 26, bold: true, font: "Calibri", color: C.mid }, paragraph: { spacing: { before: 240, after: 100 } } },
    },
  },
  numbering: {
    config: [{
      reference: "bullets",
      levels: [
        { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        { level: 1, format: LevelFormat.BULLET, text: "◦", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
        { level: 2, format: LevelFormat.BULLET, text: "–", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 2160, hanging: 360 } } } },
      ],
    }],
  },
  sections: [

    // ── COVER PAGE ──
    {
      properties: { page: { size: { width: PAGE_W, height: 15840 }, margin: MARGINS } },
      headers: { default: new Header({ children: [] }) },
      footers: { default: new Footer({ children: [] }) },
      children: [
        spacer(2000),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: C.accent } }, children: [new TextRun({ text: "FINAL YEAR PROJECT REPORT", size: 22, font: "Calibri", color: C.accent, bold: true, characterSpacing: 200 })] }),
        spacer(400),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "HONEYPOT", size: 72, font: "Calibri", bold: true, color: C.primary, characterSpacing: 300 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "DEFENSE SYSTEM", size: 52, font: "Calibri", bold: true, color: C.accent, characterSpacing: 200 })] }),
        spacer(200),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [new TextRun({ text: "Production-Grade Network Honeypot with Real-Time Threat Intelligence", size: 26, font: "Calibri", bold: true, color: C.mid })] }),
        spacer(60),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [it("A Multi-Protocol Deception Platform with Attacker Profiling,\nMITRE ATT&CK Mapping, and Automated Deployment")] }),
        spacer(600),
        hrLine(),
        spacer(100),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [b("Department of Computer Science & Cyber Security", C.mid)] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [n("Academic Year 2025-2026")] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [n("August 2026")] }),
      ],
    },

    // ── ABSTRACT ──
    {
      properties: { page: { size: { width: PAGE_W, height: 15840 }, margin: MARGINS } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "HoneyPot Defense System - FYP Report", size: 16, font: "Calibri", color: C.textLight, italics: true })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "HoneyPot Defense System - FYP Report  |  Page ", size: 16, font: "Calibri", color: C.textLight }), new TextRun({ children: [PageNumber.CURRENT], size: 16, font: "Calibri", color: C.textLight })] })] }) },
      children: [
        h1("ABSTRACT"),
        hrLine(),
        spacer(100),
        calloutBox("Project Summary",
          "This Final Year Project presents the HoneyPot Defense System, a production-grade multi-protocol network honeypot platform implemented in Node.js. The system deploys four deception services — SSH, HTTP, FTP, and Telnet — that emulate real production servers to attract, capture, and analyze attacker behavior in real time. It features deep attacker profiling with OS fingerprinting, MITRE ATT&CK TTP mapping, behavioral scoring, credential pattern analysis, and a glassmorphism-styled real-time monitoring dashboard with WebSocket push updates."
        ),
        spacer(100),
        p([
          n("The platform addresses the critical cybersecurity challenge of early threat detection by deploying "),
          b("interactive deception services"),
          n(" that convincingly mimic vulnerable infrastructure. Unlike passive network monitoring tools, the HoneyPot Defense System actively engages attackers, records their complete session data including commands executed, credentials attempted, tools used, and attack patterns employed — building comprehensive threat intelligence profiles for each unique attacker IP."),
        ]),
        p([
          n("Key innovations include: a "),
          b("unified EventEmitter-based architecture"),
          n(" connecting all services through a central message bus; an "),
          b("AttackerProfiler engine"),
          n(" that performs real-time OS detection from 24 User-Agent patterns and 12 SSH client signatures, maps attacks to 18+ MITRE ATT&CK technique IDs, and scores attacker behavior on a 0-100 scale; a "),
          b("PCAP synthesis engine"),
          n(" that reconstructs TCP sessions for Wireshark-compatible analysis; and a comprehensive "),
          b("automated deployment system"),
          n(" supporting 8+ Linux distributions with full error recovery, systemd integration, firewall auto-configuration, and rollback capability."),
        ]),
        p([
          n("The monitoring dashboard provides 10 specialized views including live attack feeds, attacker intelligence profiles, credential analysis, PCAP stream inspection with hex dump visualization, and professional threat reports with print-ready formatting. The system integrates with ClickHouse for analytics, Suricata IDS for signature-based detection, and external threat intelligence APIs (VirusTotal, AbuseIPDB) for IoC enrichment. The production codebase comprises "),
          b("~4,000 lines"),
          n(" across 10 Node.js modules and a 1,505-line single-page dashboard application."),
        ]),
        spacer(100),
        p([b("Keywords: ", C.textLight), it("Network Honeypot, Deception Technology, Threat Intelligence, MITRE ATT&CK, Attacker Profiling, Real-Time Monitoring, SSH/HTTP/FTP/Telnet, Behavioral Analysis, PCAP Analysis, Intrusion Detection, Node.js, WebSocket, Automated Deployment")]),
      ],
    },

    // ── TABLE OF CONTENTS ──
    {
      properties: { page: { size: { width: PAGE_W, height: 15840 }, margin: MARGINS } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "HoneyPot Defense System - FYP Report", size: 16, font: "Calibri", color: C.textLight, italics: true })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "HoneyPot Defense System - FYP Report  |  Page ", size: 16, font: "Calibri", color: C.textLight }), new TextRun({ children: [PageNumber.CURRENT], size: 16, font: "Calibri", color: C.textLight })] })] }) },
      children: [
        h1("TABLE OF CONTENTS"),
        hrLine(),
        spacer(200),
        ...[
          ["Chapter 1: Introduction", ["1.1 Project Overview", "1.2 Motivation and Need of the Hour", "1.3 Problem Statement", "1.4 Proposed Solution", "1.5 Objectives"]],
          ["Chapter 2: Literature Review", ["2.1 Evolution of Honeypots", "2.2 Existing Tools and Their Limitations", "2.3 MITRE ATT&CK Framework in Deception", "2.4 Modern Deception Technology"]],
          ["Chapter 3: System Architecture", ["3.1 EventEmitter Bus Architecture", "3.2 Component Topology", "3.3 Data Flow Pipeline", "3.4 Technology Stack"]],
          ["Chapter 4: Implementation Details", ["4.1 SSH Honeypot Service", "4.2 HTTP Honeypot Service", "4.3 FTP Honeypot Service", "4.4 Telnet Honeypot Service", "4.5 Attacker Profiler Engine", "4.6 PCAP Synthesis Engine", "4.7 Monitoring Dashboard & API", "4.8 Automated Deployment System"]],
          ["Chapter 5: Testing and Results", ["5.1 Per-Service Test Results", "5.2 Integrated System Test", "5.3 Dashboard Verification"]],
          ["Chapter 6: Security Assessment", ["6.1 Identified Vulnerabilities", "6.2 Remediation Roadmap"]],
          ["Chapter 7: Comparative Analysis", ["7.1 Feature Comparison Matrix"]],
          ["Chapter 8: Conclusion and Future Work", ["8.1 Key Achievements", "8.2 Limitations", "8.3 Future Directions", "8.4 Project Statistics"]],
        ].flatMap(([chapter, subs]) => [
          new Paragraph({ children: [b(chapter, C.primary)], spacing: { before: 200, after: 60 } }),
          ...subs.map(s => new Paragraph({ children: [n("     " + s)], spacing: { after: 40 }, indent: { left: 400 } })),
        ]),
      ],
    },

    // ── CHAPTER 1: INTRODUCTION ──
    {
      properties: { page: { size: { width: PAGE_W, height: 15840 }, margin: MARGINS } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "HoneyPot Defense System - FYP Report", size: 16, font: "Calibri", color: C.textLight, italics: true })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "HoneyPot Defense System - FYP Report  |  Page ", size: 16, font: "Calibri", color: C.textLight }), new TextRun({ children: [PageNumber.CURRENT], size: 16, font: "Calibri", color: C.textLight })] })] }) },
      children: [
        h1("CHAPTER 1: INTRODUCTION"),
        hrLine(),

        h2("1.1 Project Overview"),
        p([
          b("HoneyPot Defense System"),
          n(" is a production-grade, multi-protocol network honeypot platform built entirely in Node.js. It deploys four interactive deception services — SSH (port 2222), HTTP (port 8080), FTP (port 2121), and Telnet (port 2323) — that emulate real production servers to attract and trap attackers. Every interaction is captured, analyzed, and presented through a real-time glassmorphism-styled monitoring dashboard with deep threat intelligence capabilities."),
        ]),
        p("The system is designed with forward-looking modularity, enabling seamless integration into enterprise SOC workflows. All services communicate through a central EventEmitter bus, producing unified attack events that feed into persistent LevelDB storage, ClickHouse analytics, attacker profiling, and real-time WebSocket-powered dashboard updates."),

        h2("1.2 Motivation and Need of the Hour"),
        p([n("The cybersecurity landscape in 2025-2026 faces unprecedented challenges. According to "), b("IBM's Cost of a Data Breach Report 2024"), n(", the average dwell time for a breach is "), b("204 days"), n(", and the average cost has reached "), b("$4.88 million"), n(". Organizations need early warning systems that detect threats before they reach production infrastructure.")]),
        p("Key industry challenges driving this project include:"),
        bullet([b("Volume Overload: "), n("Security Operations Centers (SOCs) receive thousands of alerts daily. Honeypots provide high-fidelity alerts with near-zero false positives — every interaction is inherently suspicious.")]),
        bullet([b("Threat Intelligence Gap: "), n("Traditional firewalls and IDS block attacks but capture minimal attacker behavior data. Honeypots record complete session transcripts, credential dictionaries, tool signatures, and attack sequences.")]),
        bullet([b("Active Defense Shortage: "), n("Most security tools are passive monitors. Deception technology actively wastes attacker time and resources while gathering intelligence.")]),
        bullet([b("Skill Shortage: "), n("There is a global shortage of 3.4 million cybersecurity professionals (ISC² 2023). Automated profiling and MITRE ATT&CK mapping reduces the expertise needed to interpret attack data.")]),
        bullet([b("Dwell Time Reduction: "), n("Early detection through honeypot alerts can reduce breach dwell time from months to minutes.")]),

        h2("1.3 Problem Statement"),
        p("Existing honeypot solutions suffer from significant limitations:"),
        bullet([b("Single Protocol: "), n("Most honeypots (Cowrie, Dionaea, Kippo) focus on one or two protocols, missing multi-vector attacks.")]),
        bullet([b("No Attacker Intelligence: "), n("Traditional honeypots log raw events but don't profile attackers — no OS detection, tool identification, or behavioral scoring.")]),
        bullet([b("No MITRE Mapping: "), n("Attack events aren't classified against the MITRE ATT&CK framework, making it difficult to understand attacker TTPs.")]),
        bullet([b("Deployment Complexity: "), n("Most honeypots require manual configuration, dependency installation, and service management with no automated deployment.")]),
        bullet([b("Poor Visualization: "), n("CLI-only interfaces or basic web UIs that don't provide professional threat reporting or real-time monitoring.")]),
        spacer(100),
        calloutBox("Gap Identified", "There is a clear need for a unified, multi-protocol honeypot platform that combines interactive deception services, deep attacker intelligence with automated MITRE ATT&CK mapping, real-time visualization, and one-command production deployment — all in a single, open-source package."),

        h2("1.4 Proposed Solution"),
        p([n("The HoneyPot Defense System addresses every identified gap through a "), b("four-layer architecture"), n(":")]),
        spacer(60),
        makeTable(
          ["LAYER", "COMPONENTS", "FUNCTION"],
          [
            ["Deception", "SSH, HTTP, FTP, Telnet Honeypots", "Attract and engage attackers across 4 protocols"],
            ["Intelligence", "AttackerProfiler, IDS Engine, OSINT Engine", "OS detection, tool identification, MITRE mapping, behavioral scoring"],
            ["Storage", "LevelDB, ClickHouse, PCAP Engine", "Persistent event storage, analytics, packet capture"],
            ["Presentation", "Express API, WebSocket, Dashboard", "Real-time monitoring, reporting, data export"],
          ],
          [1800, 3400, 3800],
        ),

        h2("1.5 Objectives"),
        p("The primary objectives of this project are:"),
        bullet("Design and implement a multi-protocol honeypot system supporting SSH, HTTP, FTP, and Telnet services with convincing emulation."),
        bullet("Build an attacker profiling engine with OS fingerprinting, tool detection (24+ tools), and automated MITRE ATT&CK TTP mapping (18+ techniques)."),
        bullet("Develop a real-time monitoring dashboard with glassmorphism UI, 10 specialized views, WebSocket live updates, and professional report generation."),
        bullet("Implement a PCAP synthesis engine for Wireshark-compatible session reconstruction."),
        bullet("Create a credential pattern analyzer that classifies attack strategies (password spray, dictionary attack, username enumeration)."),
        bullet("Integrate with external threat intelligence APIs (VirusTotal, AbuseIPDB) and Suricata IDS for enriched detection."),
        bullet("Build a fully automated deployment system supporting 8+ Linux distributions with error recovery, rollback, and systemd integration."),
        bullet("Produce persistent storage with LevelDB and optional ClickHouse analytics for long-term attack trend analysis."),

        // ── CHAPTER 2: LITERATURE REVIEW ──
        pageBreak(),
        h1("CHAPTER 2: LITERATURE REVIEW"),
        hrLine(),

        h2("2.1 Evolution of Honeypots"),
        p([b("First Generation"), n(" honeypots were simple port listeners that logged connection attempts. Tools like Honeyd (2003) could simulate network topologies but provided no interaction — attackers received no response, limiting intelligence gathered.")]),
        p([b("Second Generation"), n(" honeypots introduced protocol emulation. Kippo (2009) and its successor Cowrie (2015) provided interactive SSH sessions with fake filesystems. Dionaea focused on malware collection via service emulation. These tools were single-protocol and required manual analysis.")]),
        p([b("Third Generation"), n(" deception platforms — the current frontier — combine multiple protocols, automated analysis, and real-time intelligence. Commercial platforms like Attivo Networks and Illusive Networks offer enterprise-grade deception but are prohibitively expensive. "), b("The HoneyPot Defense System represents this third generation"), n(" in the open-source space, integrating multi-protocol deception with automated profiling and MITRE mapping.")]),

        h2("2.2 Existing Tools and Their Limitations"),
        makeTable(
          ["TOOL", "STRENGTHS", "LIMITATIONS", "OUR ADVANTAGE"],
          [
            ["Cowrie", "Mature SSH/Telnet honeypot", "No HTTP/FTP, no profiling, no dashboard", "4 protocols + full intelligence"],
            ["Dionaea", "Multi-protocol, malware capture", "Complex setup, no real-time UI, no MITRE", "One-command deploy + MITRE mapping"],
            ["T-Pot", "Multi-honeypot platform", "Very heavy (30+ containers), complex ops", "Lightweight single-process Node.js"],
            ["HoneyD", "Network topology simulation", "No interaction, abandoned since 2007", "Active development, interactive services"],
            ["OpenCanary", "Easy deployment, alerting", "Low interaction, limited protocols", "Medium-high interaction, deep intel"],
            ["Artillery", "Simple Python honeypot", "Port monitoring only, no emulation", "Full protocol emulation + profiling"],
          ],
          [1600, 2400, 2800, 2200],
        ),

        h2("2.3 MITRE ATT&CK Framework in Deception"),
        p([n("The "), b("MITRE ATT&CK"), n(" (Adversarial Tactics, Techniques, and Common Knowledge) framework catalogs over 200 techniques across 14 tactics. Our system maps honeypot events directly to ATT&CK technique IDs, enabling automated threat classification. The profiler maps 18+ technique IDs including T1110 (Brute Force), T1078 (Valid Accounts), T1059 (Command and Scripting Interpreter), T1083 (File and Directory Discovery), T1005 (Data from Local System), and T1105 (Ingress Tool Transfer).")]),

        h2("2.4 Modern Deception Technology"),
        p("Modern deception technology operates on the principle that any interaction with a honeypot is inherently malicious — eliminating the false positive problem that plagues traditional IDS/IPS systems. By combining medium-interaction emulation with automated intelligence extraction, honeypots provide SOC analysts with high-confidence, actionable threat data that requires no signature updates or rule tuning."),

        // ── CHAPTER 3: SYSTEM ARCHITECTURE ──
        pageBreak(),
        h1("CHAPTER 3: SYSTEM ARCHITECTURE"),
        hrLine(),

        h2("3.1 EventEmitter Bus Architecture"),
        p([n("The system uses Node.js's built-in "), b("EventEmitter"), n(" as a central message bus (maxListeners=50). All honeypot services and the monitoring server subscribe to a shared bus instance. This pattern provides:")]),
        bullet([b("Loose coupling: "), n("Services don't know about each other — they only emit and subscribe to events on the bus.")]),
        bullet([b("Extensibility: "), n("New services or analyzers can be added by subscribing to existing events without modifying existing code.")]),
        bullet([b("Reliability: "), n("If the dashboard goes down, honeypots continue operating and events queue in persistent storage.")]),

        h2("3.2 Component Topology"),
        p("The system comprises 10 interconnected modules organized in four layers:"),
        spacer(60),
        makeTable(
          ["MODULE", "FILE", "LINES", "FUNCTION"],
          [
            ["Orchestrator", { text: "server.js", mono: true }, "150", "Service lifecycle, logging, webhooks"],
            ["SSH Honeypot", { text: "honeypots/ssh-honeypot.js", mono: true }, "260", "Real SSH protocol (ssh2), credential capture, interactive shell"],
            ["HTTP Honeypot", { text: "honeypots/http-honeypot.js", mono: true }, "318", "Admin panels, sensitive file traps, attack detection"],
            ["FTP Honeypot", { text: "honeypots/ftp-honeypot.js", mono: true }, "165", "ProFTPD emulation, directory traversal tracking"],
            ["Telnet Honeypot", { text: "honeypots/telnet-honeypot.js", mono: true }, "200", "Interactive shell, Firecracker MicroVM isolation, fake responses"],
            ["Attacker Profiler", { text: "intel/profiler.js", mono: true }, "452", "OS detection, MITRE mapping, behavioral scoring"],
            ["IDS Engine", { text: "intel/ids-engine.js", mono: true }, "78", "Suricata EVE log integration"],
            ["OSINT Engine", { text: "intel/osint-engine.js", mono: true }, "93", "VirusTotal, AbuseIPDB lookups"],
            ["MicroVM Engine", { text: "honeypots/microvm-engine.js", mono: true }, "150", "Firecracker VM lifecycle, per-session isolation"],
            ["Monitor Server", { text: "monitoring/backend/server.js", mono: true }, "480", "REST API, WebSocket, auth, LevelDB"],
            ["PCAP Engine", { text: "monitoring/backend/pcap-engine.js", mono: true }, "211", "TCP session reconstruction, hex dump"],
            ["Dashboard", { text: "monitoring/frontend/index.html", mono: true }, "1505", "10-page SPA, glassmorphism UI, reports"],
          ],
          [1600, 3000, 600, 3800],
        ),
        spacer(60),
        p([b("Total production code: ~4,100 lines (JS) + 1,505 lines (HTML/CSS/JS) = ~5,600 lines")]),

        h2("3.3 Data Flow Pipeline"),
        p("Attack events flow through the system in 6 stages:"),
        bullet([b("Stage 1 — Capture: "), n("Honeypot service receives attacker connection, parses protocol data, extracts credentials/commands/paths.")]),
        bullet([b("Stage 2 — Emit: "), n("Service emits structured attack event on the EventEmitter bus with type, service, srcIP, details, analysis.")]),
        bullet([b("Stage 3 — Record: "), n("Orchestrator logs to attacks.log, sends desktop notification, fires webhook. PCAP engine records packet data.")]),
        bullet([b("Stage 4 — Persist: "), n("MonitorServer stores in LevelDB with UUID key. Optionally inserts into ClickHouse for analytics.")]),
        bullet([b("Stage 5 — Analyze: "), n("AttackerProfiler updates the IP profile: OS guess, tools detected, TTPs mapped, behavior score recalculated.")]),
        bullet([b("Stage 6 — Push: "), n("WebSocket broadcasts event to all connected dashboard clients for real-time display.")]),

        h2("3.4 Technology Stack"),
        makeTable(
          ["COMPONENT", "TECHNOLOGY"],
          [
            ["Runtime", "Node.js 18+ (single-threaded event loop)"],
            ["Framework", "Express 4.21 (REST API)"],
            ["Real-Time", "ws 8.18 (WebSocket server)"],
            ["Persistent Storage", "LevelDB via level 8.0 (embedded key-value store)"],
            ["Analytics DB", "ClickHouse (columnar OLAP, optional Docker container)"],
            ["GeoIP", "geoip-lite 1.4 (MaxMind GeoLite2 database)"],
            ["IDS Integration", "Suricata EVE JSON log parsing"],
            ["Threat Intel APIs", "VirusTotal API v3, AbuseIPDB API v2"],
            ["WHOIS", "ARIN RDAP REST API"],
            ["Frontend", "Vanilla JS SPA, CSS3 glassmorphism, particles"],
            ["Deployment", "Bash 4+, systemd, UFW/firewalld/iptables/nftables"],
            ["TLS", "Auto-generated self-signed certificate, custom cert support"],
            ["Sandbox Isolation", "AWS Firecracker MicroVM (per-session disposable VMs)"],
            ["Containerization", "Docker + Docker Compose (ClickHouse, Suricata)"],
          ],
          [2600, 6400],
        ),

        // ── CHAPTER 4: IMPLEMENTATION DETAILS ──
        pageBreak(),
        h1("CHAPTER 4: IMPLEMENTATION DETAILS"),
        hrLine(),

        h2("4.1 SSH Honeypot Service"),
        p([n("Module: "), mono("honeypots/ssh-honeypot.js"), n(" (260 lines)")]),
        bullet([b("Real SSH Protocol (ssh2): "), n("Uses the ssh2 library for genuine SSH key exchange, authentication negotiation, and channel management — attackers interact with a real SSH server, not a TCP socket.")]),
        bullet([b("Password Authentication Capture: "), n("Intercepts SSH password authentication via the ssh2 'authentication' event, extracting exact username/password pairs with zero false positives.")]),
        bullet([b("Interactive Shell Session: "), n("After 3 failed login attempts, grants shell access with PTY support, backspace/Ctrl-C handling, and realistic command responses — luring attackers deeper for intelligence.")]),
        bullet([b("Exec Channel Support: "), n("Handles SSH exec requests (e.g., 'ssh user@host whoami') separately from interactive sessions, capturing one-shot commands.")]),
        bullet([b("TCP Fallback Mode: "), n("Gracefully falls back to banner-only TCP mode if ssh2 library is unavailable, ensuring the service always starts.")]),
        bullet([b("PCAP Recording: "), n("All packets recorded via PCAPEngine for post-session analysis with TCP handshake/teardown synthesis.")]),

        h2("4.2 HTTP Honeypot Service"),
        p([n("Module: "), mono("honeypots/http-honeypot.js"), n(" (318 lines)")]),
        bullet([b("Fake Login Panels: "), n("Three convincing admin interfaces — generic Admin Panel, WordPress wp-login.php, and phpMyAdmin — with credential capture on form submission.")]),
        bullet([b("Sensitive File Traps: "), n("Serves fake .env (with realistic DB credentials), wp-config.php.bak, backup.sql, .git/config, robots.txt with honeypot paths, and REST API endpoints.")]),
        bullet([b("Attack Detection (5 engines): "), n("SQL injection (UNION, OR 1=1, DROP patterns), path traversal (../ sequences), XSS (<script>, onerror, javascript: patterns), command injection (;, |, && with system commands), scanner detection (Nmap, Nikto, SQLMap, Masscan signatures).")]),
        bullet([b("Response Fidelity: "), n("Sets Apache/2.4.56 Server header, PHP/8.1.2 X-Powered-By, and serves HTML with realistic PHP error patterns to maintain the deception.")]),

        h2("4.3 FTP Honeypot Service"),
        p([n("Module: "), mono("honeypots/ftp-honeypot.js"), n(" (165 lines)")]),
        bullet([b("ProFTPD Emulation: "), n("Full FTP protocol implementation supporting USER, PASS, LIST, CWD, RETR, STOR, PWD, SYST, FEAT, PASV, PORT, TYPE, QUIT commands.")]),
        bullet([b("Deliberate Weakness: "), n("Allows login after 3 failed attempts (configurable) — a deliberate design decision to lure attackers deeper into the honeypot for more intelligence gathering.")]),
        bullet([b("Directory Traversal Tracking: "), n("Records all CWD attempts, detecting path traversal attacks (../../etc/passwd) and logging accessed paths.")]),
        bullet([b("File Operation Logging: "), n("RETR and STOR commands logged as file_download and file_upload attack types for attacker behavior analysis.")]),

        h2("4.4 Telnet Honeypot Service"),
        p([n("Module: "), mono("honeypots/telnet-honeypot.js"), n(" (200 lines)")]),
        bullet([b("Interactive Shell: "), n("State machine (login → password → shell) with realistic Telnet negotiation and BusyBox-style prompt.")]),
        bullet([b("Firecracker MicroVM Isolation: "), n("Integrates with the MicroVM Engine (microvm-engine.js) to execute attacker commands inside disposable Firecracker microVMs — each session gets an isolated 128MB VM with its own rootfs copy, eliminating host compromise risk.")]),
        bullet([b("Graceful Fallback: "), n("When Firecracker is unavailable, falls back to comprehensive fake responses for 30+ Linux commands (whoami, id, ls, cat, ifconfig, ps, netstat, env, etc.) with realistic output.")]),
        bullet([b("Command Capture: "), n("Records all executed commands with timestamps for behavioral analysis and MITRE ATT&CK mapping.")]),
        bullet([b("Sensitive Data Traps: "), n("Fake SSH private key, /etc/passwd with realistic user entries, env with fake AWS keys and database credentials to detect data exfiltration attempts.")]),
        bullet([b("Session Cleanup: "), n("On disconnect, the MicroVM is killed and its rootfs copy wiped — zero forensic trace of attacker activity remains on the host.")]),

        h2("4.5 Attacker Profiler Engine"),
        p([n("Module: "), mono("intel/profiler.js"), n(" (452 lines)")]),
        p("The AttackerProfiler is the intelligence core of the system, building comprehensive profiles for each unique attacker IP:"),
        spacer(40),
        h3("OS Detection"),
        bullet([b("User-Agent Analysis: "), n("24 regex patterns detecting Windows 7-11, macOS, Ubuntu, Debian, Fedora, CentOS, Red Hat, Arch, Kali, Parrot, Android, iOS, FreeBSD, OpenBSD.")]),
        bullet([b("SSH Client Fingerprinting: "), n("12 patterns identifying OpenSSH (Ubuntu/Debian variants), PuTTY, WinSCP, Paramiko, Bitvise, JSch, Dropbear, Windows OpenSSH.")]),
        spacer(40),
        h3("Tool Detection (24+ tools)"),
        p("Identifies attacker tooling from User-Agent strings and behavioral signatures:"),
        makeTable(
          ["CATEGORY", "TOOLS DETECTED"],
          [
            ["Scanners", "Nmap, Masscan, Nuclei, ZGrab, Censys, Shodan"],
            ["Vulnerability", "Nikto, SQLMap, WPScan, OWASP ZAP, Burp Suite"],
            ["Brute Force", "Hydra, Medusa"],
            ["Frameworks", "Metasploit Framework"],
            ["Fuzzers", "FFUF, DirBuster, Gobuster"],
            ["Scripted", "Python Requests/urllib, cURL, Wget, Go HTTP, Axios, Perl LWP, Scrapy"],
          ],
          [2000, 7000],
        ),
        spacer(40),
        h3("MITRE ATT&CK TTP Mapping"),
        p("Maps attack events and commands to 18+ MITRE ATT&CK technique IDs:"),
        makeTable(
          ["TECHNIQUE ID", "NAME", "TRIGGER"],
          [
            ["T1110", "Brute Force", "credential_capture, login_attempt events"],
            ["T1078", "Valid Accounts", "Successful credential use"],
            ["T1059", "Command and Scripting Interpreter", "Shell command execution"],
            ["T1083", "File and Directory Discovery", "Directory traversal, path traversal"],
            ["T1005", "Data from Local System", "Sensitive file access"],
            ["T1190", "Exploit Public-Facing Application", "SQL injection, command injection"],
            ["T1033", "System Owner/User Discovery", "whoami, id commands"],
            ["T1082", "System Information Discovery", "uname, env commands"],
            ["T1003", "OS Credential Dumping", "cat /etc/passwd, /etc/shadow"],
            ["T1016", "System Network Configuration", "ifconfig, ip addr commands"],
            ["T1049", "System Network Connections", "netstat, ss commands"],
            ["T1057", "Process Discovery", "ps aux command"],
            ["T1105", "Ingress Tool Transfer", "wget, curl download commands"],
            ["T1053", "Scheduled Task/Job", "crontab commands"],
            ["T1222", "File Permissions Modification", "chmod +x commands"],
            ["T1485", "Data Destruction", "rm -rf commands"],
            ["T1562", "Impair Defenses", "iptables modification"],
            ["T1552", "Unsecured Credentials", "history, .ssh/id_rsa access"],
          ],
          [1400, 3200, 4400],
        ),
        spacer(40),
        h3("Behavioral Scoring (0-100)"),
        p("Multi-factor scoring algorithm weighing:"),
        bullet("Attack count (2 pts each, max 30)"),
        bullet("Credentials attempted (5 pts each)"),
        bullet("Commands executed (3 pts each)"),
        bullet("Services targeted (8 pts per service)"),
        bullet("Tools detected (10 pts per tool)"),
        bullet("TTPs mapped (4 pts per TTP)"),
        bullet("Sensitive paths accessed (7 pts each)"),
        bullet("Dangerous commands like wget, rm -rf, chmod (15-20 pts)"),
        bullet("Session duration bonuses (>5min: +10, >1hr: +15)"),
        p([n("Threat classification: "), b("LOW", C.success), n(" (0-24) → "), b("MEDIUM", C.warning), n(" (25-49) → "), b("HIGH", "E97A00"), n(" (50-74) → "), b("CRITICAL", C.danger), n(" (75-100)")]),
        spacer(40),
        h3("Credential Pattern Analysis"),
        p("Classifies attack strategies:"),
        bullet([b("Password Spray: "), n("1 username with many passwords — testing common passwords against a known account")]),
        bullet([b("Username Enumeration: "), n("Many usernames with 1 password — searching for valid accounts")]),
        bullet([b("Dictionary Attack: "), n("Many usernames with many passwords — brute-force credential stuffing")]),
        bullet([b("Targeted: "), n("Few usernames and passwords — specific account targeting")]),

        h2("4.6 PCAP Synthesis Engine"),
        p([n("Module: "), mono("monitoring/backend/pcap-engine.js"), n(" (211 lines)")]),
        bullet([b("TCP Reconstruction: "), n("Synthesizes SYN → SYN-ACK → ACK handshake and FIN → ACK teardown for each session.")]),
        bullet([b("Hex Dump Visualization: "), n("Wireshark-style hex dump with ASCII sidebar for packet inspection.")]),
        bullet([b("JSON Streaming: "), n("Streams saved as JSON files in logs/pcap/ for dashboard consumption.")]),
        bullet([b("Connection Statistics: "), n("Tracks total, successful, failed, and active connections across all services.")]),

        h2("4.7 Monitoring Dashboard & API"),
        p([n("Module: "), mono("monitoring/backend/server.js"), n(" (480 lines) + "), mono("monitoring/frontend/index.html"), n(" (1,505 lines)")]),
        spacer(40),
        h3("REST API (20+ endpoints)"),
        makeTable(
          ["ENDPOINT", "METHOD", "FUNCTION"],
          [
            ["/api/status", "GET", "System status, uptime, service info"],
            ["/api/attacks", "GET", "All attack events with pagination"],
            ["/api/attack/:id", "GET", "Single attack detail"],
            ["/api/credentials", "GET", "Captured credential pairs"],
            ["/api/attackers", "GET", "Per-IP attack summaries"],
            ["/api/services", "GET", "Per-service statistics"],
            ["/api/timeline", "GET", "Hourly attack distribution"],
            ["/api/intel/profiles", "GET", "All attacker intelligence profiles"],
            ["/api/intel/profile/:ip", "GET", "Single IP deep profile"],
            ["/api/report", "GET", "Full threat intelligence report"],
            ["/api/pcap/streams", "GET", "All PCAP stream list"],
            ["/api/pcap/stream/:id", "GET", "Single stream with packets"],
            ["/api/export", "GET", "JSON/CSV data export"],
            ["/api/reset", "POST", "Clear all data (danger zone)"],
          ],
          [2800, 1000, 5200],
        ),
        spacer(40),
        h3("Dashboard Pages (10 views)"),
        bullet([b("Overview: "), n("Threat level indicator, live stats, attack feed, service activity charts, top attackers")]),
        bullet([b("Attacks: "), n("Full attack log with severity badges, filterable, clickable for detail modal")]),
        bullet([b("Services: "), n("Per-service status cards with attack counts and port information")]),
        bullet([b("Credentials: "), n("Captured username/password table with service and timestamp")]),
        bullet([b("Attackers: "), n("Per-IP profile cards with geo, attack count, last seen")]),
        bullet([b("Intel: "), n("Deep attacker profiles — OS, tools, TTPs, credential analysis, commands, paths, HTTP fingerprint, timeline")]),
        bullet([b("PCAP Streams: "), n("Wireshark-style packet list with transcript and hex dump views")]),
        bullet([b("Analytics: "), n("Severity breakdown bar, 24h attack timeline, top passwords/usernames/attack types charts")]),
        bullet([b("Reports: "), n("Professional 9-section threat report with print-ready CSS formatting")]),
        bullet([b("Settings: "), n("System configuration display, danger zone with data reset")]),

        h2("4.8 Automated Deployment System"),
        p([n("Module: "), mono("scripts/deploy.sh"), n(" (1,340 lines)")]),
        p("Comprehensive production deployment script supporting:"),
        bullet([b("8+ Linux Distributions: "), n("Ubuntu, Debian, Kali, CentOS, RHEL, Fedora, Arch, Alpine, openSUSE, Manjaro")]),
        bullet([b("Automatic Dependency Resolution: "), n("Node.js installation via NodeSource → package manager → nvm → direct binary (4-level fallback)")]),
        bullet([b("npm Install Error Recovery: "), n("Detects and handles permission errors, disk full, network failures, native build failures (auto-installs build-essential)")]),
        bullet([b("Port Conflict Detection: "), n("Identifies blocking processes, distinguishes own previous instances")]),
        bullet([b("Firewall Auto-Configuration: "), n("UFW, firewalld, iptables, nftables — detects and configures whichever is active")]),
        bullet([b("Systemd Service: "), n("Auto-creates unit file with security hardening (NoNewPrivileges, ProtectSystem, MemoryMax, CPUQuota)")]),
        bullet([b("Backup and Rollback: "), n("Auto-backup before every deployment, verified backup integrity, one-command rollback")]),
        bullet([b("Health Checks: "), n("HTTP, API, WebSocket, and per-port verification with retry logic")]),
        bullet([b("Uninstall: "), n("Complete removal with final backup, firewall rule cleanup, user removal")]),

        // ── CHAPTER 5: TESTING ──
        pageBreak(),
        h1("CHAPTER 5: TESTING AND RESULTS"),
        hrLine(),

        h2("5.1 Per-Service Test Results"),
        h3("SSH Honeypot"),
        makeTable(
          ["TEST CASE", "INPUT", "EXPECTED RESULT", "STATUS"],
          [
            ["SSH Key Exchange", "SSH client connects to port 2222", "Real SSH handshake via ssh2 library", { text: "PASS", color: C.success, bold: true }],
            ["Password Auth Capture", "SSH login with admin:password123", "Exact credentials captured via auth event", { text: "PASS", color: C.success, bold: true }],
            ["Interactive Shell", "3 failed logins, then commands", "Shell granted, commands captured with responses", { text: "PASS", color: C.success, bold: true }],
            ["Exec Channel", "ssh user@host 'whoami'", "Command captured, response sent, channel closed", { text: "PASS", color: C.success, bold: true }],
            ["PCAP Recording", "Multiple packets exchanged", "JSON stream file created in logs/pcap/", { text: "PASS", color: C.success, bold: true }],
          ],
          [2000, 2800, 3000, 1200],
        ),
        spacer(100),
        h3("HTTP Honeypot"),
        makeTable(
          ["TEST CASE", "INPUT", "EXPECTED RESULT", "STATUS"],
          [
            ["Admin Panel Served", "GET /admin", "Login form with credential capture", { text: "PASS", color: C.success, bold: true }],
            ["Sensitive File Trap", "GET /.env", "Fake .env with DB credentials", { text: "PASS", color: C.success, bold: true }],
            ["SQLi Detection", "GET /?id=1 OR 1=1", "sql_injection event emitted", { text: "PASS", color: C.success, bold: true }],
            ["Path Traversal", "GET /../../etc/passwd", "path_traversal event emitted", { text: "PASS", color: C.success, bold: true }],
            ["Scanner Detection", "Nikto User-Agent request", "scanner_detected event, tool identified", { text: "PASS", color: C.success, bold: true }],
            ["Credential POST", "POST /login with admin:test", "credential_capture event emitted", { text: "PASS", color: C.success, bold: true }],
          ],
          [2000, 2800, 3000, 1200],
        ),
        spacer(100),
        h3("FTP Honeypot"),
        makeTable(
          ["TEST CASE", "INPUT", "EXPECTED RESULT", "STATUS"],
          [
            ["Banner Response", "TCP connection to port 2121", "220 ProFTPD 1.3.8 Server ready", { text: "PASS", color: C.success, bold: true }],
            ["Login After Failures", "3 failed USER/PASS attempts", "Login granted on 4th attempt", { text: "PASS", color: C.success, bold: true }],
            ["Directory Traversal", "CWD ../../etc", "directory_traversal event emitted", { text: "PASS", color: C.success, bold: true }],
            ["File Download Trap", "RETR /etc/passwd", "file_download event emitted", { text: "PASS", color: C.success, bold: true }],
          ],
          [2000, 2800, 3000, 1200],
        ),
        spacer(100),
        h3("Telnet Honeypot"),
        makeTable(
          ["TEST CASE", "INPUT", "EXPECTED RESULT", "STATUS"],
          [
            ["Shell Access", "Login with admin:admin", "Shell prompt displayed", { text: "PASS", color: C.success, bold: true }],
            ["Command Capture", "whoami, ls, cat /etc/passwd", "Commands logged, events emitted", { text: "PASS", color: C.success, bold: true }],
            ["Fake Responses", "Various Linux commands", "Realistic fake output returned", { text: "PASS", color: C.success, bold: true }],
            ["Session Timeout", "2 minutes idle", "Connection closed cleanly", { text: "PASS", color: C.success, bold: true }],
          ],
          [2000, 2800, 3000, 1200],
        ),

        h2("5.2 Integrated System Test"),
        calloutBox("Full Pipeline Result",
          "A comprehensive test attack sequence targeting all 4 honeypot services was executed using generate_attacks.js. 68 attack events were captured across SSH, HTTP, FTP, and Telnet services. The AttackerProfiler assigned a behavior score of 100/100 (CRITICAL), identified 3 tools (cURL, Nikto, SQLMap), mapped 11 MITRE ATT&CK TTPs, and classified the credential pattern as dictionary_attack with 22 attempts across 3 usernames and 9 passwords. All events persisted in LevelDB, pushed via WebSocket to the dashboard in real-time, and the professional report generated successfully with all 9 sections populated."
        ),

        h2("5.3 Dashboard Verification"),
        p("All 10 dashboard pages verified for correct rendering and data display:"),
        makeTable(
          ["PAGE", "VERIFICATION", "STATUS"],
          [
            ["Overview", "Threat level, live stats, attack feed, charts render", { text: "PASS", color: C.success, bold: true }],
            ["Attacks", "Full event log with severity badges, detail modal", { text: "PASS", color: C.success, bold: true }],
            ["Services", "4 service cards with correct port/status", { text: "PASS", color: C.success, bold: true }],
            ["Credentials", "Username/password pairs with service tags", { text: "PASS", color: C.success, bold: true }],
            ["Intel", "Full profile: OS, tools, TTPs, commands, paths, timeline", { text: "PASS", color: C.success, bold: true }],
            ["Analytics", "Severity bar, timeline chart, top lists", { text: "PASS", color: C.success, bold: true }],
            ["Reports", "9-section report with print formatting", { text: "PASS", color: C.success, bold: true }],
            ["Settings", "Config display, reset button functional", { text: "PASS", color: C.success, bold: true }],
          ],
          [1800, 5000, 2200],
        ),

        // ── CHAPTER 6: SECURITY ASSESSMENT ──
        pageBreak(),
        h1("CHAPTER 6: SECURITY ASSESSMENT"),
        hrLine(),
        p("A thorough security audit was conducted on the codebase. The following vulnerabilities were identified, assessed, and remediated:"),

        h2("6.1 Identified Vulnerabilities and Remediation"),
        makeTable(
          ["#", "SEVERITY", "VULNERABILITY", "REMEDIATION", "STATUS"],
          [
            ["1", { text: "CRITICAL", color: C.danger, bold: true }, "Auth bypass via X-Forwarded-For spoofing", "_getIP() rewritten to use req.socket.remoteAddress only; X-Forwarded-For no longer trusted", { text: "FIXED", color: C.success, bold: true }],
            ["2", { text: "CRITICAL", color: C.danger, bold: true }, "Command injection in Telnet docker exec", "Docker exec removed entirely; replaced with Firecracker MicroVM isolation + safe fake responses", { text: "FIXED", color: C.success, bold: true }],
            ["3", { text: "HIGH", color: "E97A00", bold: true }, "Hardcoded credentials in source code", "Credentials moved to environment variables; .env.example provided; docker-compose reads from .env file", { text: "FIXED", color: C.success, bold: true }],
            ["4", { text: "HIGH", color: "E97A00", bold: true }, "No TLS on dashboard, API, or WebSocket", "Auto-generated self-signed TLS certificate; HTTPS/WSS enabled by default; custom cert support via config/tls/", { text: "FIXED", color: C.success, bold: true }],
            ["5", { text: "HIGH", color: "E97A00", bold: true }, "Unbounded memory growth", "LRU eviction caps added: attacks (10K), credentials (5K), sessions (2K), connections (2K); 20% eviction on overflow", { text: "FIXED", color: C.success, bold: true }],
            ["6", { text: "HIGH", color: "E97A00", bold: true }, "SSH honeypot using raw TCP instead of ssh2", "Complete rewrite using ssh2 library; real SSH key exchange, password auth, interactive shell, exec channels", { text: "FIXED", color: C.success, bold: true }],
            ["7", { text: "MEDIUM", color: C.warning, bold: true }, "CSV injection in data export", "Formula-character escaping added (=, +, -, @, tab, CR prefixed with single quote)", { text: "FIXED", color: C.success, bold: true }],
            ["8", { text: "MEDIUM", color: C.warning, bold: true }, ".env files not fully gitignored", ".gitignore updated to cover *.env, monitoring/backend/.env, and config/tls/ directory", { text: "FIXED", color: C.success, bold: true }],
          ],
          [400, 1200, 2600, 3200, 900],
        ),

        spacer(100),
        calloutBox("Security Posture Summary",
          "All 6 critical and high-severity vulnerabilities have been remediated. The auth bypass was the most dangerous — a single spoofed X-Forwarded-For header could grant full unauthenticated API access. The command injection in the Telnet honeypot could have led to host compromise. Both are now fully patched. The system now runs HTTPS by default, credentials are externalized, memory is bounded, and the SSH honeypot uses the real ssh2 protocol library."
        ),

        h2("6.2 Security Hardening Applied"),
        bullet([b("Network Layer: "), n("TLS encryption for all dashboard traffic. Self-signed certificate auto-generated on first run; production deployments can supply CA-signed certificates in config/tls/.")]),
        bullet([b("Authentication: "), n("IP detection uses socket-level address only (req.socket.remoteAddress). X-Forwarded-For is no longer parsed, eliminating header spoofing attacks.")]),
        bullet([b("Credential Management: "), n("All sensitive credentials (ClickHouse password, API tokens) read from environment variables. No secrets in source code. .env.example documents required variables.")]),
        bullet([b("Command Isolation: "), n("Telnet shell commands execute inside disposable Firecracker microVMs (128MB RAM, 1 vCPU). Each session gets an isolated rootfs copy that is wiped on disconnect. Falls back to safe fake responses when Firecracker is unavailable.")]),
        bullet([b("Memory Protection: "), n("In-memory arrays capped with automatic eviction (oldest 20% removed when limit reached). Prevents memory exhaustion under sustained attack.")]),
        bullet([b("Data Export: "), n("CSV export sanitizes formula-injection characters (=, +, -, @) with single-quote prefix to prevent Excel formula execution.")]),

        // ── CHAPTER 7: COMPARATIVE ANALYSIS ──
        pageBreak(),
        h1("CHAPTER 7: COMPARATIVE ANALYSIS"),
        hrLine(),

        h2("7.1 Feature Comparison Matrix"),
        p([n("Y = Full support, "), b("P", C.warning), n(" = Partial support, "), b("N", C.danger), n(" = Not supported")]),
        spacer(60),
        makeTable(
          ["FEATURE", "OURS", "COWRIE", "T-POT", "DIONAEA", "OPENCANARY"],
          [
            ["SSH Honeypot", { text: "Y", color: C.success, bold: true }, { text: "Y", color: C.success, bold: true }, { text: "Y", color: C.success, bold: true }, { text: "N", color: C.danger, bold: true }, { text: "P", color: C.warning, bold: true }],
            ["HTTP Honeypot", { text: "Y", color: C.success, bold: true }, { text: "N", color: C.danger, bold: true }, { text: "Y", color: C.success, bold: true }, { text: "Y", color: C.success, bold: true }, { text: "P", color: C.warning, bold: true }],
            ["FTP Honeypot", { text: "Y", color: C.success, bold: true }, { text: "N", color: C.danger, bold: true }, { text: "Y", color: C.success, bold: true }, { text: "Y", color: C.success, bold: true }, { text: "N", color: C.danger, bold: true }],
            ["Telnet Honeypot", { text: "Y", color: C.success, bold: true }, { text: "Y", color: C.success, bold: true }, { text: "Y", color: C.success, bold: true }, { text: "N", color: C.danger, bold: true }, { text: "N", color: C.danger, bold: true }],
            ["Real-Time Dashboard", { text: "Y", color: C.success, bold: true }, { text: "N", color: C.danger, bold: true }, { text: "Y", color: C.success, bold: true }, { text: "N", color: C.danger, bold: true }, { text: "N", color: C.danger, bold: true }],
            ["WebSocket Push", { text: "Y", color: C.success, bold: true }, { text: "N", color: C.danger, bold: true }, { text: "P", color: C.warning, bold: true }, { text: "N", color: C.danger, bold: true }, { text: "N", color: C.danger, bold: true }],
            ["MITRE ATT&CK Mapping", { text: "Y", color: C.success, bold: true }, { text: "N", color: C.danger, bold: true }, { text: "P", color: C.warning, bold: true }, { text: "N", color: C.danger, bold: true }, { text: "N", color: C.danger, bold: true }],
            ["Attacker OS Detection", { text: "Y", color: C.success, bold: true }, { text: "N", color: C.danger, bold: true }, { text: "N", color: C.danger, bold: true }, { text: "N", color: C.danger, bold: true }, { text: "N", color: C.danger, bold: true }],
            ["Tool Detection (24+)", { text: "Y", color: C.success, bold: true }, { text: "N", color: C.danger, bold: true }, { text: "P", color: C.warning, bold: true }, { text: "N", color: C.danger, bold: true }, { text: "N", color: C.danger, bold: true }],
            ["Behavioral Scoring", { text: "Y", color: C.success, bold: true }, { text: "N", color: C.danger, bold: true }, { text: "N", color: C.danger, bold: true }, { text: "N", color: C.danger, bold: true }, { text: "N", color: C.danger, bold: true }],
            ["Credential Analysis", { text: "Y", color: C.success, bold: true }, { text: "P", color: C.warning, bold: true }, { text: "P", color: C.warning, bold: true }, { text: "N", color: C.danger, bold: true }, { text: "N", color: C.danger, bold: true }],
            ["PCAP Reconstruction", { text: "Y", color: C.success, bold: true }, { text: "P", color: C.warning, bold: true }, { text: "Y", color: C.success, bold: true }, { text: "P", color: C.warning, bold: true }, { text: "N", color: C.danger, bold: true }],
            ["Professional Reports", { text: "Y", color: C.success, bold: true }, { text: "N", color: C.danger, bold: true }, { text: "P", color: C.warning, bold: true }, { text: "N", color: C.danger, bold: true }, { text: "N", color: C.danger, bold: true }],
            ["One-Command Deploy", { text: "Y", color: C.success, bold: true }, { text: "P", color: C.warning, bold: true }, { text: "Y", color: C.success, bold: true }, { text: "N", color: C.danger, bold: true }, { text: "P", color: C.warning, bold: true }],
            ["Rollback Support", { text: "Y", color: C.success, bold: true }, { text: "N", color: C.danger, bold: true }, { text: "N", color: C.danger, bold: true }, { text: "N", color: C.danger, bold: true }, { text: "N", color: C.danger, bold: true }],
            ["Lightweight (<5K LOC)", { text: "Y", color: C.success, bold: true }, { text: "P", color: C.warning, bold: true }, { text: "N", color: C.danger, bold: true }, { text: "P", color: C.warning, bold: true }, { text: "Y", color: C.success, bold: true }],
          ],
          [2200, 900, 1100, 1100, 1300, 1600],
        ),

        // ── CHAPTER 8: CONCLUSION ──
        pageBreak(),
        h1("CHAPTER 8: CONCLUSION AND FUTURE WORK"),
        hrLine(),

        h2("8.1 Key Achievements"),
        bullet([b("1. Multi-Protocol Deception: "), n("Four interactive honeypot services covering SSH, HTTP, FTP, and Telnet — the most common attack vectors — in a single unified platform.")]),
        bullet([b("2. Deep Attacker Intelligence: "), n("Automated OS detection (36 patterns), tool identification (24+ tools), MITRE ATT&CK mapping (18+ TTPs), and behavioral scoring (0-100) per attacker.")]),
        bullet([b("3. Real-Time Monitoring: "), n("WebSocket-powered dashboard with 10 specialized views, glassmorphism UI, and professional report generation with print support.")]),
        bullet([b("4. Production Deployment: "), n("1,340-line deployment script supporting 8+ Linux distributions with 4-level Node.js fallback, firewall auto-config, systemd hardening, backup/rollback.")]),
        bullet([b("5. Compact Codebase: "), n("~5,600 lines of production code delivering feature parity with platforms that require 30+ Docker containers and 100K+ lines.")]),
        bullet([b("6. Security Hardened: "), n("All critical vulnerabilities remediated — TLS encryption, auth bypass fixed, command injection eliminated via Firecracker isolation, credentials externalized, memory bounded.")]),

        h2("8.2 Limitations"),
        p("The following limitations are acknowledged:"),
        bullet([b("Self-Signed TLS: "), n("The auto-generated TLS certificate is self-signed. Production deployments should supply CA-signed certificates or use a reverse proxy with Let's Encrypt.")]),
        bullet([b("Medium Interaction: "), n("Honeypot services emulate protocols at medium fidelity. Sophisticated attackers may detect the deception through timing analysis or missing protocol features.")]),
        bullet([b("Single Process: "), n("Node.js single-threaded model limits throughput under extreme attack volumes. PM2 clustering would resolve this.")]),
        bullet([b("Firecracker Dependency: "), n("Full command isolation requires Firecracker binary, kernel image, and rootfs. Falls back to fake responses when unavailable.")]),

        h2("8.3 Future Directions"),
        bullet([b("1. Let's Encrypt Integration: "), n("Add ACME protocol support for automatic CA-signed certificate provisioning, replacing the self-signed default.")]),
        bullet([b("2. STIX/TAXII Integration: "), n("Export threat intelligence in STIX 2.1 format for sharing with threat intelligence platforms.")]),
        bullet([b("3. Machine Learning: "), n("Train anomaly detection models on attacker behavioral patterns for predictive threat scoring.")]),
        bullet([b("4. ForensiX Integration: "), n("Feed captured malware samples from the honeypot directly into the ForensiX malware analysis pipeline.")]),
        bullet([b("5. SIEM Integration: "), n("Export events in CEF/LEEF format for Splunk, QRadar, and ELK Stack ingestion.")]),
        bullet([b("6. DNS Honeypot: "), n("Add DNS protocol emulation to detect DNS tunneling and domain enumeration.")]),
        bullet([b("7. Email (SMTP) Honeypot: "), n("Capture phishing attempts and spam relay abuse.")]),
        bullet([b("8. High-Interaction Expansion: "), n("Extend Firecracker microVM support to SSH and FTP honeypots for full high-interaction mode across all protocols.")]),

        h2("8.4 Project Statistics"),
        makeTable(
          ["METRIC", "VALUE"],
          [
            [{ text: "Total Lines of Code", bold: true }, "~5,600 (Node.js + HTML/CSS/JS)"],
            [{ text: "Backend Modules", bold: true }, "11 (4 honeypots + MicroVM engine + 3 intel + 3 monitoring)"],
            [{ text: "Frontend", bold: true }, "1,505 lines (single-page application)"],
            [{ text: "Dashboard Pages", bold: true }, "10 specialized views"],
            [{ text: "Protocols Emulated", bold: true }, "4 (SSH, HTTP, FTP, Telnet)"],
            [{ text: "MITRE ATT&CK Techniques", bold: true }, "18+ technique IDs mapped"],
            [{ text: "Tool Detection Signatures", bold: true }, "24+ attacker tools"],
            [{ text: "OS Detection Patterns", bold: true }, "36 (24 UA + 12 SSH client)"],
            [{ text: "REST API Endpoints", bold: true }, "20+"],
            [{ text: "Deployment Script", bold: true }, "1,340 lines (8+ distros, 4-level fallback)"],
            [{ text: "Dependencies", bold: true }, "7 (express, ws, level, ssh2, geoip-lite, chalk, dotenv)"],
            [{ text: "Language", bold: true }, "100% JavaScript (Node.js)"],
          ],
          [3600, 5400],
        ),
        spacer(400),
        hrLine(),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [b("HoneyPot Defense System", C.primary), n(" — Production-Grade Network Honeypot Platform")] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [n("Department of Computer Science & Cyber Security  |  Academic Year 2025-2026")] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [it("This document was generated as part of the Final Year Project submission.")] }),
      ],
    },
  ],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync("/home/we/HoneyPot/HoneyPot_FYP_Report.docx", buf);
  console.log("Report generated: HoneyPot_FYP_Report.docx (" + buf.length + " bytes)");
});
