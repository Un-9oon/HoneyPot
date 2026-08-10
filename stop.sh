#!/bin/bash
set -e

# ==============================================================================
# HONEYPOT DEFENSE SYSTEM - SHUTDOWN SEQUENCE
# ==============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${CYAN}╔═══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║            INITIATING SYSTEM SHUTDOWN SEQUENCE        ║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════════════╝${NC}"
echo ""

echo -e "${YELLOW}[1/4] Stopping Node.js Backend & Dashboard (PM2)...${NC}"
if command -v pm2 &> /dev/null || command -v npx &> /dev/null; then
    npx pm2 stop all > /dev/null 2>&1 || true
    echo -e "${GREEN}✓ Backend processes halted.${NC}"
else
    echo -e "${GREEN}✓ PM2 not found, skipping.${NC}"
fi

echo -e "${YELLOW}[2/4] Shutting down Enterprise Services (ClickHouse & Suricata)...${NC}"
if command -v docker-compose &> /dev/null; then
    docker-compose down > /dev/null 2>&1 || true
    echo -e "${GREEN}✓ Docker containers stopped and removed.${NC}"
else
    echo -e "${GREEN}✓ docker-compose not found, skipping.${NC}"
fi

echo -e "${YELLOW}[3/4] Terminating any active Firecracker MicroVMs...${NC}"
pkill -f firecracker > /dev/null 2>&1 || true
# Clean up leftover socket and config files from MicroVMs
rm -f /tmp/firecracker-*.socket /tmp/fc-config-*.json > /dev/null 2>&1 || true
echo -e "${GREEN}✓ All active traps and environments destroyed.${NC}"

echo -e "${YELLOW}[4/4] Freeing up network ports...${NC}"
pkill -f "node server.js" > /dev/null 2>&1 || true
echo -e "${GREEN}✓ Network ports released.${NC}"

echo -e "\n${GREEN}======================================================================${NC}"
echo -e "${GREEN}✓ SYSTEM SUCCESSFULLY SHUT DOWN${NC}"
echo -e "${GREEN}======================================================================${NC}"
echo -e "To bring the honeypot back online, run: ${CYAN}sudo bash install.sh${NC}"
echo ""
