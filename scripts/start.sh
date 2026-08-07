#!/usr/bin/env bash
# Quick start — runs honeypot in foreground (for dev/testing)
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -d node_modules ]]; then
  echo "Installing dependencies..."
  npm install --production || { echo "npm install failed"; exit 1; }
fi

if [[ ! -f config/ssh_host_key ]]; then
  echo "Generating SSH host key..."
  ssh-keygen -t rsa -b 2048 -f config/ssh_host_key -N "" -q 2>/dev/null || \
    openssl genrsa -out config/ssh_host_key 2048 2>/dev/null
fi

if [[ ! -f config/auth.json ]]; then
  TOKEN=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p)
  PASS=$(openssl rand -hex 6 2>/dev/null || echo "changeme")
  echo "{\"password\":\"$PASS\",\"token\":\"$TOKEN\"}" > config/auth.json
  echo "Auth created — password: $PASS"
fi

mkdir -p logs data
exec node server.js
