#!/bin/bash
set -e

# ==============================================================================
# HONEYPOT DEFENSE SYSTEM - AUTOMATED DEPLOYMENT SCRIPT
# ==============================================================================

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color
LOG_FILE="install.log"

echo -e "${CYAN}╔═══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║          HONEYPOT DEPLOYMENT SEQUENCE INITIATED       ║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════════════╝${NC}"
echo -e "${YELLOW}Detailed logs are being saved to: ${LOG_FILE}${NC}\n"

> "$LOG_FILE"

# Error handling trap
trap 'echo -e "\n\n${RED}[!] FATAL ERROR: Installation failed at line $LINENO.${NC}"; echo -e "${RED}Please check $LOG_FILE for exact error details.${NC}"; exit 1' ERR

# Progress bar function
draw_progress() {
    local percent=$1
    local task=$2
    local bar_length=40
    local filled=$((percent * bar_length / 100))
    local empty=$((bar_length - filled))
    
    # Create the progress bar string (===...)
    local bar=""
    for ((i=0; i<filled; i++)); do bar="${bar}="; done
    for ((i=0; i<empty; i++)); do bar="${bar} "; done
    
    # Print the line (carriage return overwrites previous line)
    printf "\r\033[K${CYAN}[${bar}] ${percent}%%${NC} | ${task}"
}

# 1. Check for root privileges
draw_progress 5 "Checking system permissions..."
if [ "$EUID" -ne 0 ]; then
  echo -e "\n${RED}[!] Please run this script as root (use sudo ./install.sh)${NC}"
  exit 1
fi
sleep 1

# 2. Update system and install system dependencies
draw_progress 15 "Updating system packages & dependencies..."
export DEBIAN_FRONTEND=noninteractive
echo iptables-persistent iptables-persistent/autosave_v4 boolean true | debconf-set-selections >> "$LOG_FILE" 2>&1
echo iptables-persistent iptables-persistent/autosave_v6 boolean true | debconf-set-selections >> "$LOG_FILE" 2>&1
apt-get update -y >> "$LOG_FILE" 2>&1
apt-get install -y -q curl wget build-essential iptables-persistent >> "$LOG_FILE" 2>&1

# 3. Install Node.js (v18)
draw_progress 35 "Installing Node.js (v18.x environment)..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - >> "$LOG_FILE" 2>&1
    apt-get install -y nodejs >> "$LOG_FILE" 2>&1
else
    echo "Node.js is already installed" >> "$LOG_FILE"
fi

# 4. Install PM2 globally
draw_progress 50 "Installing PM2 Process Manager..."
if ! command -v pm2 &> /dev/null; then
    npm install -g pm2 >> "$LOG_FILE" 2>&1
else
    echo "PM2 is already installed" >> "$LOG_FILE"
fi

# 5. Configure Honeypot for Public Access
draw_progress 65 "Configuring Honeypot for public network access..."
if [ -f "config/honeypot.json" ]; then
    sed -i 's/"bind": "127.0.0.1"/"bind": "0.0.0.0"/g' config/honeypot.json
else
    echo -e "\n${RED}[!] Error: config/honeypot.json not found.${NC}"
    exit 1
fi

# 6. Install Project Dependencies
draw_progress 80 "Installing NPM Project Dependencies..."
npm install >> "$LOG_FILE" 2>&1

# 7. Start the Honeypot with PM2
draw_progress 90 "Launching Honeypot engine via PM2..."
pm2 stop honeypot >> "$LOG_FILE" 2>&1 || true
pm2 delete honeypot >> "$LOG_FILE" 2>&1 || true
pm2 start server.js --name "honeypot" >> "$LOG_FILE" 2>&1

# 8. Setup PM2 Startup Script
draw_progress 95 "Configuring server auto-restart sequence..."
env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u root --hp /root >> "$LOG_FILE" 2>&1 || true
pm2 save >> "$LOG_FILE" 2>&1

draw_progress 100 "Finalizing deployment..."
sleep 1
PUBLIC_IP=$(curl -s https://api.ipify.org || echo "YOUR_SERVER_IP")

echo -e "\n\n${GREEN}======================================================================${NC}"
echo -e "${GREEN}✓ DEPLOYMENT COMPLETE 100%${NC}"
echo -e "${GREEN}======================================================================${NC}"
echo -e "Your honeypot is now running securely in the background."
echo ""
echo -e "${CYAN}[Dashboard]${NC} Access at: http://${PUBLIC_IP}:3000"
echo -e "${CYAN}[Fake SSH]${NC}  Access at: ssh -p 2222 root@${PUBLIC_IP}"
echo ""
echo -e "${CYAN}Useful PM2 Commands:${NC}"
echo -e "  - ${GREEN}pm2 logs honeypot${NC}    (View live console output)"
echo -e "  - ${GREEN}pm2 status${NC}           (Check if the honeypot is running)"
echo -e "  - ${GREEN}pm2 restart honeypot${NC} (Restart the honeypot)"
echo ""
echo -e "${RED}Security Warning:${NC} Ensure your cloud firewall (e.g. AWS Security Group)"
echo -e "allows inbound traffic on ports 2222, 8080, 2121, 2323, and 3000."
echo "======================================================================"
