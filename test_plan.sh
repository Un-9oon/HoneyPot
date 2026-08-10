#!/bin/bash
echo "[*] Functional Testing: HTTP Path Traversal"
curl -s -i "http://127.0.0.1:8082/../../../etc/passwd" | head -n 5

echo "\n[*] Functional Testing: HTTP SQL Injection"
curl -s -i "http://127.0.0.1:8082/?id=1' OR '1'='1" | head -n 5

echo "\n[*] Functional Testing: HTTP XSS"
curl -s -i "http://127.0.0.1:8082/?search=<script>alert(1)</script>" | head -n 5

echo "\n[*] Functional Testing: SSH Connect & Close"
timeout 2 ssh -p 2225 fakeuser@127.0.0.1 || echo "SSH timeout (expected)"

echo "\n[*] Functional Testing: FTP Login"
curl -s -u admin:admin123 ftp://127.0.0.1:2123/ || echo "FTP rejected (expected)"

echo "\n[*] Fuzz Testing: Large HTTP Header"
curl -s -i -H "User-Agent: $(head -c 2000 < /dev/zero | tr '\0' 'A')" http://127.0.0.1:8082/ | head -n 5

echo "\n[*] Performance Testing: Simple HTTP Flood (50 requests)"
for i in {1..50}; do curl -s http://127.0.0.1:8082/ > /dev/null & done
wait
echo "Flood complete."

