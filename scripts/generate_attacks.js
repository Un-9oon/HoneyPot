const http = require("http");
const net = require("net");

function fireHTTP(path, headers = {}, postData = null) {
  return new Promise(resolve => {
    const opts = {
      hostname: "127.0.0.1", port: 8082, path, method: postData ? "POST" : "GET",
      headers: { "User-Agent": "Mozilla/5.0", ...headers }
    };
    if (postData) opts.headers["Content-Type"] = "application/x-www-form-urlencoded";
    const req = http.request(opts, res => { resolve(); });
    req.on("error", resolve);
    setTimeout(resolve, 300);
    if (postData) req.write(postData);
    req.end();
  });
}

function fireTCP(port, payloadArr) {
  return new Promise(resolve => {
    const s = net.connect(port, "127.0.0.1", () => {
      let idx = 0;
      const sendNext = () => {
        if (idx < payloadArr.length) {
          s.write(payloadArr[idx++] + "\r\n");
          setTimeout(sendNext, 100);
        } else {
          setTimeout(() => { s.end(); resolve(); }, 100);
        }
      };
      sendNext();
    });
    s.on("error", resolve);
    setTimeout(resolve, 1000);
  });
}

async function run() {
  console.log("=== FIRING FAST ATTACK BURST TO POPULATE HONEYPOT DASHBOARD ===");

  await fireHTTP("/.env");
  await fireHTTP("/wp-config.php.bak", { "User-Agent": "Nikto/2.1.6" });
  await fireHTTP("/login", { "User-Agent": "sqlmap/1.7.2#stable" }, "username=admin' OR '1'='1&password=toor");
  await fireHTTP("/admin/config");
  await fireHTTP("/backup.sql");

  await fireTCP(2325, ["root", "toor", "whoami", "id", "cat /etc/passwd", "exit"]);
  await fireTCP(2325, ["admin", "wrongpass"]);
  await fireTCP(2123, ["USER root", "PASS shadow123", "PWD", "LIST"]);
  await fireTCP(2123, ["USER admin", "PASS 123456"]);
  await fireTCP(2225, ["SSH-2.0-OpenSSH_8.9p1"]);

  console.log("=== BURST COMPLETED! 10 STREAMS CREATED! ===");
  process.exit(0);
}

run();
