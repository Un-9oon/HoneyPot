#!/bin/bash

# Nexus Honeypot - Automated Management CLI
# Usage: ./manage.sh {deploy|start|stop|restart|dashboard}

GREEN='\033[0;32m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

command=$1

if [ -z "$command" ]; then
    echo -e "${CYAN}Nexus Honeypot Management Tool${NC}"
    echo "Usage: ./manage.sh {deploy|start|stop|restart|dashboard}"
    exit 1
fi

case "$command" in
    deploy)
        echo -e "${GREEN}[*] Initiating Automated Deployment for New System...${NC}"
        if [ -f "install.sh" ]; then
            sudo chmod +x install.sh
            sudo ./install.sh
        else
            echo -e "${RED}[!] Error: install.sh not found.${NC}"
        fi
        ;;
    start)
        echo -e "${GREEN}[*] Starting Honeypot & Dashboard...${NC}"
        npx pm2 start server.js --name "honeypot"
        
        npx pm2 save
        echo -e "${GREEN}[+] System online. Run './manage.sh dashboard' for access info.${NC}"
        ;;
    stop)
        echo -e "${GREEN}[*] Stopping Honeypot Services...${NC}"
        npx pm2 stop honeypot
        ;;
    restart)
        echo -e "${GREEN}[*] Restarting Honeypot Services...${NC}"
        npx pm2 restart honeypot
        ;;
    dashboard)
        echo -e "${CYAN}================================================${NC}"
        echo -e "${CYAN}       HONEYPOT DASHBOARD & ACCESS INFO         ${NC}"
        echo -e "${CYAN}================================================${NC}"
        npx pm2 status honeypot | grep -E "honeypot|online"
        echo -e "${CYAN}------------------------------------------------${NC}"
        
        LOCAL_IP=$(ip -4 addr show | grep -v '127.0.0.1' | grep -Eo 'inet [0-9.]+' | awk '{print $2}' | head -n 1)
        [ -z "$LOCAL_IP" ] && LOCAL_IP="127.0.0.1"
        PUBLIC_IP=$(curl -s --max-time 3 http://api.ipify.org || echo "Unknown")

        if [ -f "config/auth.json" ]; then
            USER=$(grep '"username"' config/auth.json | cut -d'"' -f4)
            PASS=$(grep '"password"' config/auth.json | cut -d'"' -f4)
            echo -e "${GREEN}Honeypot Dashboard  : http://127.0.0.1:3000${NC}"
            echo -e "${GREEN}Honeypot Username   : ${USER}${NC}"
            echo -e "${GREEN}Honeypot Password   : ${PASS}${NC}"
            echo -e "${CYAN}------------------------------------------------${NC}"
            echo -e "${YELLOW}Live LAN IP (Internal) : ${LOCAL_IP}${NC}"
            echo -e "${YELLOW}Live WAN IP (External) : ${PUBLIC_IP}${NC}"
            
            if command -v xdg-open &> /dev/null; then
                echo -e "${GREEN}[*] Opening Honeypot dashboard in your default browser...${NC}"
                xdg-open "http://127.0.0.1:3000" &> /dev/null &
            fi
        else
            echo -e "${RED}Dashboard credentials not found. Please run './manage.sh start' first.${NC}"
        fi
        echo -e "${CYAN}================================================${NC}"
        ;;
    *)
        echo "Usage: ./manage.sh {deploy|start|stop|restart|dashboard}"
        ;;
esac
