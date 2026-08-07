#!/usr/bin/env bash
# Stop the honeypot
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -f data/server.pid ]]; then
  PID=$(cat data/server.pid)
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID"
    echo "Honeypot stopped (PID $PID)"
  else
    echo "Process $PID not running"
    rm -f data/server.pid
  fi
elif systemctl is-active honeypot &>/dev/null; then
  sudo systemctl stop honeypot
  echo "Honeypot service stopped"
else
  echo "No running honeypot found"
fi
