#!/usr/bin/env bash
###############################################################################
#  HoneyPot Defense System — Automated Deployment Script
#  Handles: fresh install, update, rollback, systemd service, firewall,
#           SSH key generation, auth token setup, health checks, and cleanup.
#  Tested on: Ubuntu 20.04+, Debian 11+, Kali, CentOS/RHEL 8+, Fedora 36+
###############################################################################
set -Euo pipefail
trap 'error_handler $LINENO "$BASH_COMMAND"' ERR

# ─── Colors ──────────────────────────────────────────────────────────────────
R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; B='\033[0;34m'
C='\033[0;36m'; M='\033[0;35m'; W='\033[1;37m'; D='\033[0;90m'; N='\033[0m'

# ─── Config defaults ────────────────────────────────────────────────────────
INSTALL_DIR="${HONEYPOT_DIR:-/opt/honeypot}"
SERVICE_USER="honeypot"
SERVICE_NAME="honeypot"
NODE_MIN_VERSION="18"
BIND_ADDR="0.0.0.0"
SSH_PORT=2222
HTTP_PORT=8080
FTP_PORT=2121
TELNET_PORT=2323
DASHBOARD_PORT=3000
LOG_FILE="/tmp/honeypot-deploy-$(date +%Y%m%d-%H%M%S).log"
BACKUP_DIR=""
ROLLBACK_MODE=false
UNINSTALL_MODE=false
SKIP_FIREWALL=false
SKIP_SERVICE=false
LOCAL_MODE=false
DRY_RUN=false
VERBOSE=false
REPO_URL=""
BRANCH="main"

# ─── Logging ─────────────────────────────────────────────────────────────────
exec > >(tee -a "$LOG_FILE") 2>&1

log()   { echo -e "${D}[$(date +%H:%M:%S)]${N} $1"; }
info()  { echo -e "${D}[$(date +%H:%M:%S)]${N} ${C}ℹ${N}  $1"; }
ok()    { echo -e "${D}[$(date +%H:%M:%S)]${N} ${G}✓${N}  $1"; }
warn()  { echo -e "${D}[$(date +%H:%M:%S)]${N} ${Y}⚠${N}  $1"; }
fail()  { echo -e "${D}[$(date +%H:%M:%S)]${N} ${R}✗${N}  $1"; }
die()   { fail "$1"; echo -e "\n${R}Deployment failed.${N} Log: ${W}$LOG_FILE${N}"; exit 1; }
step()  { echo -e "\n${M}━━━ $1 ━━━${N}"; }

error_handler() {
  local line=$1 cmd=$2
  fail "Error on line $line: $cmd"
  fail "Deployment aborted. Check log: $LOG_FILE"
  if [[ -n "$BACKUP_DIR" && -d "$BACKUP_DIR" ]]; then
    warn "A backup exists at $BACKUP_DIR — you can restore with:"
    echo -e "  ${W}$0 --rollback $BACKUP_DIR${N}"
  fi
  exit 1
}

# ─── Usage ───────────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
${W}HoneyPot Defense System — Deployment Script${N}

${C}Usage:${N}
  $0 [OPTIONS]

${C}Options:${N}
  ${G}--dir PATH${N}            Install directory (default: /opt/honeypot)
  ${G}--repo URL${N}            Git repository URL to clone from
  ${G}--branch NAME${N}         Git branch (default: main)
  ${G}--local PATH${N}          Deploy from local directory instead of git
  ${G}--bind ADDR${N}           Bind address (default: 0.0.0.0)
  ${G}--ssh-port PORT${N}       SSH honeypot port (default: 2222)
  ${G}--http-port PORT${N}      HTTP honeypot port (default: 8080)
  ${G}--ftp-port PORT${N}       FTP honeypot port (default: 2121)
  ${G}--telnet-port PORT${N}    Telnet honeypot port (default: 2323)
  ${G}--dashboard-port PORT${N} Dashboard port (default: 3000)
  ${G}--user NAME${N}           Service user (default: honeypot)
  ${G}--skip-firewall${N}       Skip firewall configuration
  ${G}--skip-service${N}        Skip systemd service setup
  ${G}--rollback PATH${N}       Rollback to a previous backup
  ${G}--uninstall${N}           Remove honeypot completely
  ${G}--dry-run${N}             Show what would happen without doing it
  ${G}--verbose${N}             Show detailed output
  ${G}-h, --help${N}            Show this help

${C}Examples:${N}
  ${D}# Fresh install from git${N}
  sudo $0 --repo https://github.com/you/honeypot.git

  ${D}# Deploy from local project directory${N}
  sudo $0 --local /home/user/HoneyPot

  ${D}# Custom ports + skip firewall${N}
  sudo $0 --local ./HoneyPot --ssh-port 22222 --skip-firewall

  ${D}# Rollback${N}
  sudo $0 --rollback /opt/honeypot-backup-20260807-143022

  ${D}# Uninstall${N}
  sudo $0 --uninstall
EOF
  exit 0
}

# ─── Parse args ──────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)            INSTALL_DIR="$2"; shift 2;;
    --repo)           REPO_URL="$2"; shift 2;;
    --branch)         BRANCH="$2"; shift 2;;
    --local)          LOCAL_MODE=true; LOCAL_PATH="$2"; shift 2;;
    --bind)           BIND_ADDR="$2"; shift 2;;
    --ssh-port)       SSH_PORT="$2"; shift 2;;
    --http-port)      HTTP_PORT="$2"; shift 2;;
    --ftp-port)       FTP_PORT="$2"; shift 2;;
    --telnet-port)    TELNET_PORT="$2"; shift 2;;
    --dashboard-port) DASHBOARD_PORT="$2"; shift 2;;
    --user)           SERVICE_USER="$2"; shift 2;;
    --skip-firewall)  SKIP_FIREWALL=true; shift;;
    --skip-service)   SKIP_SERVICE=true; shift;;
    --rollback)       ROLLBACK_MODE=true; ROLLBACK_PATH="$2"; shift 2;;
    --uninstall)      UNINSTALL_MODE=true; shift;;
    --dry-run)        DRY_RUN=true; shift;;
    --verbose)        VERBOSE=true; shift;;
    -h|--help)        usage;;
    *)                die "Unknown option: $1 (use --help)";;
  esac
done

# ─── Dry run wrapper ────────────────────────────────────────────────────────
run() {
  if $DRY_RUN; then
    echo -e "  ${D}[dry-run]${N} $*"
  else
    "$@"
  fi
}

# ─── Root check ──────────────────────────────────────────────────────────────
check_root() {
  if [[ $EUID -ne 0 ]]; then
    die "This script must be run as root (use sudo)"
  fi
}

# ─── OS Detection ───────────────────────────────────────────────────────────
detect_os() {
  step "Detecting Operating System"
  if [[ -f /etc/os-release ]]; then
    . /etc/os-release
    OS_ID="${ID:-unknown}"
    OS_VERSION="${VERSION_ID:-0}"
    OS_NAME="${PRETTY_NAME:-Unknown}"
  elif [[ -f /etc/redhat-release ]]; then
    OS_ID="rhel"
    OS_NAME=$(cat /etc/redhat-release)
    OS_VERSION=$(grep -oP '\d+' /etc/redhat-release | head -1)
  else
    OS_ID="unknown"
    OS_NAME="Unknown"
    OS_VERSION="0"
  fi

  case "$OS_ID" in
    ubuntu|debian|kali|linuxmint|pop|elementary|zorin)
      PKG_MGR="apt"
      PKG_INSTALL="apt-get install -y -qq"
      PKG_UPDATE="apt-get update -qq"
      ;;
    centos|rhel|rocky|alma|fedora|ol)
      PKG_MGR="dnf"
      PKG_INSTALL="dnf install -y -q"
      PKG_UPDATE="dnf check-update -q || true"
      ;;
    opensuse*|sles)
      PKG_MGR="zypper"
      PKG_INSTALL="zypper install -y -q"
      PKG_UPDATE="zypper refresh -q"
      ;;
    arch|manjaro|endeavouros)
      PKG_MGR="pacman"
      PKG_INSTALL="pacman -S --noconfirm --needed"
      PKG_UPDATE="pacman -Sy"
      ;;
    alpine)
      PKG_MGR="apk"
      PKG_INSTALL="apk add --no-cache"
      PKG_UPDATE="apk update"
      ;;
    *)
      warn "Unrecognized OS: $OS_NAME. Will attempt to continue."
      PKG_MGR="unknown"
      ;;
  esac

  ok "OS: $OS_NAME ($OS_ID)"
  ok "Package manager: $PKG_MGR"

  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64|amd64) ARCH_LABEL="x64";;
    aarch64|arm64) ARCH_LABEL="arm64";;
    armv7l) ARCH_LABEL="armv7l";;
    *) ARCH_LABEL="$ARCH";;
  esac
  ok "Architecture: $ARCH ($ARCH_LABEL)"
}

# ─── Dependency checks ──────────────────────────────────────────────────────
check_dependencies() {
  step "Checking Dependencies"
  local missing=()

  # Check/install git
  if ! command -v git &>/dev/null; then
    warn "git not found — installing..."
    if [[ "$PKG_MGR" != "unknown" ]]; then
      run $PKG_UPDATE 2>/dev/null || true
      run $PKG_INSTALL git || die "Failed to install git"
      ok "git installed"
    else
      missing+=("git")
    fi
  else
    ok "git $(git --version | awk '{print $3}')"
  fi

  # Check/install curl
  if ! command -v curl &>/dev/null; then
    warn "curl not found — installing..."
    if [[ "$PKG_MGR" != "unknown" ]]; then
      run $PKG_INSTALL curl || die "Failed to install curl"
      ok "curl installed"
    else
      missing+=("curl")
    fi
  else
    ok "curl found"
  fi

  # Check/install openssl (for SSH key + auth token generation)
  if ! command -v openssl &>/dev/null; then
    warn "openssl not found — installing..."
    if [[ "$PKG_MGR" != "unknown" ]]; then
      run $PKG_INSTALL openssl || die "Failed to install openssl"
    else
      missing+=("openssl")
    fi
  else
    ok "openssl found"
  fi

  # Check/install Node.js
  if ! command -v node &>/dev/null; then
    warn "Node.js not found — installing..."
    install_node
  else
    NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
    if [[ "$NODE_VER" -lt "$NODE_MIN_VERSION" ]]; then
      warn "Node.js v$NODE_VER found but v$NODE_MIN_VERSION+ required — upgrading..."
      install_node
    else
      ok "Node.js $(node -v)"
    fi
  fi

  # Check npm
  if ! command -v npm &>/dev/null; then
    die "npm not found even after Node.js install. Something went wrong."
  else
    ok "npm $(npm -v)"
  fi

  # Report missing
  if [[ ${#missing[@]} -gt 0 ]]; then
    die "Missing dependencies that could not be auto-installed: ${missing[*]}\nInstall them manually and re-run."
  fi
}

install_node() {
  info "Installing Node.js v20 LTS..."

  # Try NodeSource first
  if [[ "$PKG_MGR" == "apt" ]]; then
    if curl -fsSL https://deb.nodesource.com/setup_20.x 2>/dev/null | run bash - 2>/dev/null; then
      run apt-get install -y -qq nodejs 2>/dev/null && { ok "Node.js installed via NodeSource"; return; }
    fi
  elif [[ "$PKG_MGR" == "dnf" ]]; then
    if curl -fsSL https://rpm.nodesource.com/setup_20.x 2>/dev/null | run bash - 2>/dev/null; then
      run dnf install -y -q nodejs 2>/dev/null && { ok "Node.js installed via NodeSource"; return; }
    fi
  fi

  # Fallback: install via package manager defaults
  warn "NodeSource failed, trying default package manager..."
  case "$PKG_MGR" in
    apt)    run $PKG_INSTALL nodejs npm 2>/dev/null;;
    dnf)    run $PKG_INSTALL nodejs npm 2>/dev/null;;
    pacman) run $PKG_INSTALL nodejs npm 2>/dev/null;;
    apk)    run $PKG_INSTALL nodejs npm 2>/dev/null;;
    zypper) run $PKG_INSTALL nodejs npm 2>/dev/null;;
    *)      ;;
  esac

  if command -v node &>/dev/null; then
    local ver=$(node -v | sed 's/v//' | cut -d. -f1)
    if [[ "$ver" -ge "$NODE_MIN_VERSION" ]]; then
      ok "Node.js $(node -v) installed via package manager"
      return
    fi
  fi

  # Fallback 2: nvm
  warn "Package manager Node.js too old. Trying nvm..."
  export NVM_DIR="/usr/local/nvm"
  mkdir -p "$NVM_DIR"
  if curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh 2>/dev/null | PROFILE=/dev/null bash 2>/dev/null; then
    . "$NVM_DIR/nvm.sh"
    nvm install 20 2>/dev/null
    nvm alias default 20 2>/dev/null
    ln -sf "$(which node)" /usr/local/bin/node 2>/dev/null || true
    ln -sf "$(which npm)" /usr/local/bin/npm 2>/dev/null || true
    if command -v node &>/dev/null; then
      ok "Node.js $(node -v) installed via nvm"
      return
    fi
  fi

  # Fallback 3: direct binary
  warn "nvm failed. Downloading Node.js binary directly..."
  local node_url="https://nodejs.org/dist/v20.18.0/node-v20.18.0-linux-${ARCH_LABEL}.tar.xz"
  local tmp_node="/tmp/node-install-$$.tar.xz"
  if curl -fsSL "$node_url" -o "$tmp_node" 2>/dev/null; then
    tar -xf "$tmp_node" -C /usr/local --strip-components=1
    rm -f "$tmp_node"
    hash -r
    if command -v node &>/dev/null; then
      ok "Node.js $(node -v) installed from binary"
      return
    fi
  fi

  die "Could not install Node.js v$NODE_MIN_VERSION+. Install it manually:\n  https://nodejs.org/en/download/"
}

# ─── Port checks ────────────────────────────────────────────────────────────
check_ports() {
  step "Checking Port Availability"
  local ports=("$SSH_PORT:SSH" "$HTTP_PORT:HTTP" "$FTP_PORT:FTP" "$TELNET_PORT:Telnet" "$DASHBOARD_PORT:Dashboard")
  local conflicts=0

  for entry in "${ports[@]}"; do
    local port="${entry%%:*}"
    local name="${entry##*:}"

    # Validate port number
    if ! [[ "$port" =~ ^[0-9]+$ ]] || [[ "$port" -lt 1 || "$port" -gt 65535 ]]; then
      die "Invalid port number for $name: $port (must be 1-65535)"
    fi

    # Check if in use (skip if our own service is using it)
    local pid=""
    if command -v ss &>/dev/null; then
      pid=$(ss -tlnp "sport = :$port" 2>/dev/null | grep -oP 'pid=\K\d+' | head -1)
    elif command -v netstat &>/dev/null; then
      pid=$(netstat -tlnp 2>/dev/null | grep ":$port " | awk '{print $7}' | cut -d/ -f1 | head -1)
    elif command -v lsof &>/dev/null; then
      pid=$(lsof -ti ":$port" 2>/dev/null | head -1)
    fi

    if [[ -n "$pid" ]]; then
      local proc_name=$(ps -p "$pid" -o comm= 2>/dev/null || echo "unknown")
      if [[ "$proc_name" == "node" ]]; then
        # Could be our own previous instance
        local proc_cwd=$(readlink -f "/proc/$pid/cwd" 2>/dev/null || echo "")
        if [[ "$proc_cwd" == "$INSTALL_DIR"* ]]; then
          warn "Port $port ($name) used by existing honeypot (PID $pid) — will restart"
          continue
        fi
      fi
      fail "Port $port ($name) already in use by $proc_name (PID $pid)"
      conflicts=$((conflicts + 1))
    else
      ok "Port $port ($name) available"
    fi
  done

  if [[ $conflicts -gt 0 ]]; then
    die "$conflicts port(s) are in use. Free them or use --ssh-port/--http-port/etc. to pick different ports."
  fi

  # Warn about privileged ports
  for entry in "${ports[@]}"; do
    local port="${entry%%:*}"
    local name="${entry##*:}"
    if [[ "$port" -lt 1024 ]]; then
      warn "Port $port ($name) is privileged (<1024). The service will need CAP_NET_BIND_SERVICE or run as root."
    fi
  done
}

# ─── System resource checks ─────────────────────────────────────────────────
check_resources() {
  step "Checking System Resources"

  # RAM
  local total_ram_kb=$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}')
  if [[ -n "$total_ram_kb" ]]; then
    local total_ram_mb=$((total_ram_kb / 1024))
    if [[ $total_ram_mb -lt 256 ]]; then
      die "Insufficient RAM: ${total_ram_mb}MB (minimum 256MB required)"
    elif [[ $total_ram_mb -lt 512 ]]; then
      warn "Low RAM: ${total_ram_mb}MB (512MB+ recommended)"
    else
      ok "RAM: ${total_ram_mb}MB"
    fi
  fi

  # Disk
  local avail_kb=$(df "$INSTALL_DIR" 2>/dev/null | tail -1 | awk '{print $4}' || df / | tail -1 | awk '{print $4}')
  if [[ -n "$avail_kb" && "$avail_kb" =~ ^[0-9]+$ ]]; then
    local avail_mb=$((avail_kb / 1024))
    if [[ $avail_mb -lt 100 ]]; then
      die "Insufficient disk space: ${avail_mb}MB free (minimum 100MB)"
    elif [[ $avail_mb -lt 500 ]]; then
      warn "Low disk space: ${avail_mb}MB free (500MB+ recommended)"
    else
      ok "Disk: ${avail_mb}MB free"
    fi
  fi

  # CPU cores
  local cores=$(nproc 2>/dev/null || echo 1)
  ok "CPU cores: $cores"
}

# ─── Create service user ────────────────────────────────────────────────────
setup_user() {
  step "Setting Up Service User"

  if id "$SERVICE_USER" &>/dev/null; then
    ok "User '$SERVICE_USER' already exists"
  else
    info "Creating system user '$SERVICE_USER'..."
    run useradd --system --shell /usr/sbin/nologin --home-dir "$INSTALL_DIR" \
      --comment "Honeypot Defense System" "$SERVICE_USER" 2>/dev/null \
      || run adduser --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER" 2>/dev/null \
      || die "Failed to create user '$SERVICE_USER'"
    ok "User '$SERVICE_USER' created"
  fi
}

# ─── Stop existing service ──────────────────────────────────────────────────
stop_existing() {
  step "Stopping Existing Instance"

  # systemd
  if systemctl is-active "$SERVICE_NAME" &>/dev/null; then
    info "Stopping systemd service..."
    run systemctl stop "$SERVICE_NAME" 2>/dev/null || true
    sleep 1
    ok "Service stopped"
  fi

  # PID file
  local pidfile="$INSTALL_DIR/data/server.pid"
  if [[ -f "$pidfile" ]]; then
    local pid=$(cat "$pidfile" 2>/dev/null)
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      info "Killing existing process (PID $pid)..."
      run kill "$pid" 2>/dev/null || true
      sleep 2
      if kill -0 "$pid" 2>/dev/null; then
        warn "Process didn't stop gracefully, force killing..."
        run kill -9 "$pid" 2>/dev/null || true
        sleep 1
      fi
      ok "Process stopped"
    fi
  fi

  # Stray node processes on our ports
  for port in $SSH_PORT $HTTP_PORT $FTP_PORT $TELNET_PORT $DASHBOARD_PORT; do
    local pid=""
    if command -v ss &>/dev/null; then
      pid=$(ss -tlnp "sport = :$port" 2>/dev/null | grep -oP 'pid=\K\d+' | head -1)
    elif command -v lsof &>/dev/null; then
      pid=$(lsof -ti ":$port" 2>/dev/null | head -1)
    fi
    if [[ -n "$pid" ]]; then
      local proc=$(ps -p "$pid" -o comm= 2>/dev/null || echo "")
      if [[ "$proc" == "node" ]]; then
        info "Killing stray node process on port $port (PID $pid)..."
        run kill "$pid" 2>/dev/null || true
      fi
    fi
  done
}

# ─── Backup ──────────────────────────────────────────────────────────────────
backup_existing() {
  if [[ -d "$INSTALL_DIR" && -f "$INSTALL_DIR/package.json" ]]; then
    step "Backing Up Existing Installation"
    BACKUP_DIR="${INSTALL_DIR}-backup-$(date +%Y%m%d-%H%M%S)"
    info "Backing up to $BACKUP_DIR..."
    run cp -a "$INSTALL_DIR" "$BACKUP_DIR"

    # Verify backup
    if [[ -f "$BACKUP_DIR/package.json" ]]; then
      local orig_count=$(find "$INSTALL_DIR" -type f -not -path "*/node_modules/*" -not -path "*/data/*" | wc -l)
      local back_count=$(find "$BACKUP_DIR" -type f -not -path "*/node_modules/*" -not -path "*/data/*" | wc -l)
      if [[ $back_count -lt $((orig_count / 2)) ]]; then
        warn "Backup may be incomplete ($back_count files vs $orig_count original)"
      else
        ok "Backup created: $BACKUP_DIR ($back_count files)"
      fi
    else
      warn "Backup verification failed — package.json not found in backup"
    fi
  else
    info "No existing installation to back up"
  fi
}

# ─── Rollback ────────────────────────────────────────────────────────────────
do_rollback() {
  step "Rolling Back"

  if [[ ! -d "$ROLLBACK_PATH" ]]; then
    die "Rollback path does not exist: $ROLLBACK_PATH"
  fi
  if [[ ! -f "$ROLLBACK_PATH/package.json" ]]; then
    die "Not a valid honeypot backup: $ROLLBACK_PATH (no package.json)"
  fi

  stop_existing

  if [[ -d "$INSTALL_DIR" ]]; then
    info "Moving current installation aside..."
    run mv "$INSTALL_DIR" "${INSTALL_DIR}-replaced-$(date +%Y%m%d-%H%M%S)"
  fi

  info "Restoring from $ROLLBACK_PATH..."
  run cp -a "$ROLLBACK_PATH" "$INSTALL_DIR"

  # Re-install deps in case node_modules wasn't backed up
  if [[ ! -d "$INSTALL_DIR/node_modules" ]]; then
    info "Reinstalling dependencies..."
    cd "$INSTALL_DIR"
    run npm install --production 2>&1 | tail -3
  fi

  run chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR" 2>/dev/null || true

  if ! $SKIP_SERVICE && systemctl is-enabled "$SERVICE_NAME" &>/dev/null; then
    run systemctl start "$SERVICE_NAME"
  fi

  ok "Rollback complete from $ROLLBACK_PATH"
  info "Dashboard: http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo localhost):$DASHBOARD_PORT"
  exit 0
}

# ─── Uninstall ───────────────────────────────────────────────────────────────
do_uninstall() {
  step "Uninstalling HoneyPot Defense System"

  echo -e "${Y}This will:${N}"
  echo "  - Stop the honeypot service"
  echo "  - Remove systemd unit file"
  echo "  - Remove firewall rules"
  echo "  - Delete installation at $INSTALL_DIR"
  echo "  - Remove service user $SERVICE_USER"
  echo ""
  read -rp "$(echo -e "${R}Are you sure? Type 'yes' to confirm: ${N}")" confirm
  if [[ "$confirm" != "yes" ]]; then
    info "Uninstall cancelled"
    exit 0
  fi

  # Stop service
  if systemctl is-active "$SERVICE_NAME" &>/dev/null; then
    systemctl stop "$SERVICE_NAME" 2>/dev/null || true
    ok "Service stopped"
  fi
  if [[ -f "/etc/systemd/system/${SERVICE_NAME}.service" ]]; then
    systemctl disable "$SERVICE_NAME" 2>/dev/null || true
    rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
    systemctl daemon-reload 2>/dev/null || true
    ok "Systemd unit removed"
  fi

  # Remove firewall rules
  if command -v ufw &>/dev/null && ufw status | grep -q "active"; then
    for port in $SSH_PORT $HTTP_PORT $FTP_PORT $TELNET_PORT $DASHBOARD_PORT; do
      ufw delete allow "$port/tcp" 2>/dev/null || true
    done
    ok "UFW rules removed"
  fi
  if command -v firewall-cmd &>/dev/null && systemctl is-active firewalld &>/dev/null; then
    for port in $SSH_PORT $HTTP_PORT $FTP_PORT $TELNET_PORT $DASHBOARD_PORT; do
      firewall-cmd --permanent --remove-port="${port}/tcp" 2>/dev/null || true
    done
    firewall-cmd --reload 2>/dev/null || true
    ok "Firewalld rules removed"
  fi

  # Create final backup
  if [[ -d "$INSTALL_DIR" ]]; then
    local final_backup="${INSTALL_DIR}-final-backup-$(date +%Y%m%d-%H%M%S)"
    cp -a "$INSTALL_DIR" "$final_backup" 2>/dev/null || true
    info "Final backup saved: $final_backup"
    rm -rf "$INSTALL_DIR"
    ok "Installation directory removed"
  fi

  # Remove user
  if id "$SERVICE_USER" &>/dev/null; then
    userdel "$SERVICE_USER" 2>/dev/null || true
    ok "User $SERVICE_USER removed"
  fi

  ok "Uninstall complete"
  exit 0
}

# ─── Deploy source code ─────────────────────────────────────────────────────
deploy_source() {
  step "Deploying Source Code"

  mkdir -p "$INSTALL_DIR"

  if $LOCAL_MODE; then
    # Deploy from local directory
    if [[ ! -d "$LOCAL_PATH" ]]; then
      die "Local path does not exist: $LOCAL_PATH"
    fi
    if [[ ! -f "$LOCAL_PATH/package.json" ]]; then
      die "Not a valid honeypot project: $LOCAL_PATH (no package.json)"
    fi
    if [[ ! -f "$LOCAL_PATH/server.js" ]]; then
      die "Missing server.js in $LOCAL_PATH"
    fi

    info "Copying from $LOCAL_PATH..."
    # Use rsync if available (handles excludes better), fall back to cp
    if command -v rsync &>/dev/null; then
      run rsync -a --delete \
        --exclude='node_modules' \
        --exclude='data/' \
        --exclude='logs/' \
        --exclude='.git' \
        "$LOCAL_PATH/" "$INSTALL_DIR/"
    else
      # Manual copy, preserve existing data/logs
      local temp_data="" temp_logs=""
      if [[ -d "$INSTALL_DIR/data" ]]; then
        temp_data=$(mktemp -d)
        cp -a "$INSTALL_DIR/data" "$temp_data/"
      fi
      if [[ -d "$INSTALL_DIR/logs" ]]; then
        temp_logs=$(mktemp -d)
        cp -a "$INSTALL_DIR/logs" "$temp_logs/"
      fi

      # Copy source (exclude node_modules)
      find "$LOCAL_PATH" -mindepth 1 -maxdepth 1 \
        ! -name 'node_modules' ! -name 'data' ! -name 'logs' ! -name '.git' \
        -exec cp -a {} "$INSTALL_DIR/" \;

      # Restore data/logs
      if [[ -n "$temp_data" && -d "$temp_data/data" ]]; then
        cp -a "$temp_data/data" "$INSTALL_DIR/"
        rm -rf "$temp_data"
      fi
      if [[ -n "$temp_logs" && -d "$temp_logs/logs" ]]; then
        cp -a "$temp_logs/logs" "$INSTALL_DIR/"
        rm -rf "$temp_logs"
      fi
    fi
    ok "Source deployed from local directory"

  elif [[ -n "$REPO_URL" ]]; then
    # Deploy from git
    info "Cloning $REPO_URL (branch: $BRANCH)..."
    local temp_clone=$(mktemp -d)
    if ! git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$temp_clone" 2>&1; then
      rm -rf "$temp_clone"
      die "Failed to clone repository. Check URL and branch:\n  URL: $REPO_URL\n  Branch: $BRANCH"
    fi

    if [[ ! -f "$temp_clone/package.json" ]]; then
      rm -rf "$temp_clone"
      die "Cloned repo has no package.json — not a valid honeypot project"
    fi

    # Copy to install dir (preserve data/logs)
    if command -v rsync &>/dev/null; then
      run rsync -a --exclude='.git' --exclude='node_modules' "$temp_clone/" "$INSTALL_DIR/"
    else
      find "$temp_clone" -mindepth 1 -maxdepth 1 ! -name '.git' ! -name 'node_modules' \
        -exec cp -a {} "$INSTALL_DIR/" \;
    fi
    rm -rf "$temp_clone"
    ok "Source deployed from git"

  else
    die "No source specified. Use --local PATH or --repo URL"
  fi

  # Verify critical files
  local required_files=("server.js" "package.json")
  for f in "${required_files[@]}"; do
    if [[ ! -f "$INSTALL_DIR/$f" ]]; then
      die "Critical file missing after deploy: $f"
    fi
  done

  # Verify directory structure
  for dir in honeypots monitoring monitoring/backend monitoring/frontend config; do
    if [[ ! -d "$INSTALL_DIR/$dir" ]]; then
      die "Required directory missing: $dir"
    fi
  done

  ok "Source verified — all critical files present"
}

# ─── Install npm dependencies ───────────────────────────────────────────────
install_deps() {
  step "Installing Node.js Dependencies"
  cd "$INSTALL_DIR"

  # Clean install
  if [[ -d "node_modules" ]]; then
    info "Removing old node_modules..."
    rm -rf node_modules package-lock.json
  fi

  info "Running npm install --production..."
  local npm_output
  npm_output=$(npm install --production 2>&1) || {
    fail "npm install failed:"
    echo "$npm_output" | tail -20
    echo ""

    # Diagnose common issues
    if echo "$npm_output" | grep -qi "EACCES\|permission denied"; then
      die "Permission error. Check ownership of $INSTALL_DIR"
    elif echo "$npm_output" | grep -qi "ENOSPC\|no space"; then
      die "Disk full. Free up space and retry."
    elif echo "$npm_output" | grep -qi "ENETUNREACH\|EAI_AGAIN\|network"; then
      warn "Network error. Retrying in 5 seconds..."
      sleep 5
      npm_output=$(npm install --production 2>&1) || die "npm install failed after retry. Check your internet connection."
    elif echo "$npm_output" | grep -qi "node-gyp\|compilation\|gcc\|g++\|make"; then
      warn "Native module build failed. Installing build tools..."
      case "$PKG_MGR" in
        apt)    run $PKG_INSTALL build-essential python3 2>/dev/null;;
        dnf)    run $PKG_INSTALL gcc gcc-c++ make python3 2>/dev/null;;
        pacman) run $PKG_INSTALL base-devel python 2>/dev/null;;
        apk)    run $PKG_INSTALL build-base python3 2>/dev/null;;
      esac
      npm_output=$(npm install --production 2>&1) || die "npm install failed even after installing build tools."
    else
      die "npm install failed with unknown error. Check the output above."
    fi
  }

  # Verify critical modules
  local required_modules=("express" "ws" "level" "ssh2" "geoip-lite")
  for mod in "${required_modules[@]}"; do
    if [[ ! -d "node_modules/$mod" ]]; then
      die "Critical module not installed: $mod"
    fi
  done

  local dep_count=$(ls -1 node_modules/ 2>/dev/null | wc -l)
  ok "Dependencies installed ($dep_count packages)"
}

# ─── Generate SSH host key ──────────────────────────────────────────────────
setup_ssh_key() {
  step "Setting Up SSH Host Key"
  local keyfile="$INSTALL_DIR/config/ssh_host_key"

  if [[ -f "$keyfile" ]]; then
    # Validate existing key
    if openssl rsa -in "$keyfile" -check -noout 2>/dev/null; then
      ok "Existing SSH host key is valid"
      return
    else
      warn "Existing SSH key is invalid — regenerating..."
      mv "$keyfile" "${keyfile}.bad.$(date +%s)"
    fi
  fi

  info "Generating 2048-bit RSA host key..."
  if command -v ssh-keygen &>/dev/null; then
    run ssh-keygen -t rsa -b 2048 -f "$keyfile" -N "" -q 2>/dev/null
    rm -f "${keyfile}.pub" 2>/dev/null || true
  elif command -v openssl &>/dev/null; then
    run openssl genrsa -out "$keyfile" 2048 2>/dev/null
  else
    die "Neither ssh-keygen nor openssl available to generate SSH key"
  fi

  if [[ ! -f "$keyfile" ]]; then
    die "SSH key generation failed — file not created"
  fi

  chmod 600 "$keyfile"
  ok "SSH host key generated"
}

# ─── Generate auth token ────────────────────────────────────────────────────
setup_auth() {
  step "Setting Up Authentication"
  local authfile="$INSTALL_DIR/config/auth.json"

  if [[ -f "$authfile" ]]; then
    # Validate existing auth
    if python3 -c "import json;json.load(open('$authfile'))" 2>/dev/null || \
       node -e "JSON.parse(require('fs').readFileSync('$authfile','utf8'))" 2>/dev/null; then
      ok "Existing auth config is valid"
      # Show token for reference
      local token=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$authfile','utf8')).token)" 2>/dev/null || echo "")
      if [[ -n "$token" ]]; then
        info "Dashboard token: ${token:0:8}...${token: -8}"
      fi
      return
    else
      warn "Existing auth.json is corrupted — regenerating..."
    fi
  fi

  info "Generating auth credentials..."
  local password token
  if command -v openssl &>/dev/null; then
    password=$(openssl rand -hex 6)
    token=$(openssl rand -hex 32)
  else
    password=$(head -c 12 /dev/urandom | xxd -p 2>/dev/null || echo "honeypot$(date +%s)")
    token=$(head -c 32 /dev/urandom | xxd -p 2>/dev/null || echo "$(date +%s)$(hostname)$(whoami)" | sha256sum | cut -d' ' -f1)
  fi

  cat > "$authfile" <<AUTHEOF
{
  "password": "$password",
  "token": "$token"
}
AUTHEOF

  chmod 600 "$authfile"
  ok "Auth credentials generated"
  info "Dashboard password: $password"
  info "API token: ${token:0:8}...${token: -8}"
  echo ""
  echo -e "  ${Y}Save these credentials! They won't be shown again.${N}"
}

# ─── Configure honeypot settings ────────────────────────────────────────────
configure() {
  step "Configuring Honeypot"
  local cfgfile="$INSTALL_DIR/config/honeypot.json"

  if [[ -f "$cfgfile" ]]; then
    info "Updating existing config with deployment settings..."
  else
    info "Creating new configuration..."
  fi

  cat > "$cfgfile" <<CFGEOF
{
  "bind": "$BIND_ADDR",
  "services": {
    "ssh": { "enabled": true, "port": $SSH_PORT, "banner": "SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.6" },
    "http": { "enabled": true, "port": $HTTP_PORT, "serverHeader": "Apache/2.4.56 (Ubuntu)" },
    "ftp": { "enabled": true, "port": $FTP_PORT, "banner": "220 ProFTPD 1.3.8 Server ready." },
    "telnet": { "enabled": true, "port": $TELNET_PORT }
  },
  "monitor": { "port": $DASHBOARD_PORT, "wsPath": "/ws" },
  "alerts": { "desktop": false, "webhooks": [], "logFile": "logs/alerts.log" },
  "notifications": { "desktop": false, "sound": false, "minSeverity": "MEDIUM" },
  "capture": { "maxSessionSize": 65536, "recordSessions": true },
  "auth": { "enabled": true },
  "maxSessionDuration": 300,
  "maxConnectionsPerIP": 20,
  "rateLimitWindow": 60,
  "rateLimitMax": 100
}
CFGEOF

  ok "Config written: bind=$BIND_ADDR ssh=$SSH_PORT http=$HTTP_PORT ftp=$FTP_PORT telnet=$TELNET_PORT dashboard=$DASHBOARD_PORT"

  # Create required directories
  mkdir -p "$INSTALL_DIR"/{logs,data}
  ok "Directories created"
}

# ─── Set permissions ─────────────────────────────────────────────────────────
set_permissions() {
  step "Setting Permissions"

  run chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR"
  run chmod 750 "$INSTALL_DIR"
  run chmod 600 "$INSTALL_DIR/config/auth.json" 2>/dev/null || true
  run chmod 600 "$INSTALL_DIR/config/ssh_host_key" 2>/dev/null || true
  run chmod 755 "$INSTALL_DIR/server.js"

  # Allow binding to privileged ports if needed
  local needs_cap=false
  for port in $SSH_PORT $HTTP_PORT $FTP_PORT $TELNET_PORT $DASHBOARD_PORT; do
    if [[ $port -lt 1024 ]]; then needs_cap=true; break; fi
  done

  if $needs_cap; then
    local node_bin=$(which node)
    if command -v setcap &>/dev/null; then
      run setcap 'cap_net_bind_service=+ep' "$node_bin" 2>/dev/null || \
        warn "Could not set CAP_NET_BIND_SERVICE on node. Privileged ports may fail."
    else
      warn "setcap not found. Install libcap2-bin for privileged port binding."
    fi
  fi

  ok "Permissions set"
}

# ─── Firewall ────────────────────────────────────────────────────────────────
setup_firewall() {
  if $SKIP_FIREWALL; then
    info "Firewall configuration skipped (--skip-firewall)"
    return
  fi

  step "Configuring Firewall"

  local ports=($SSH_PORT $HTTP_PORT $FTP_PORT $TELNET_PORT $DASHBOARD_PORT)

  # UFW (Ubuntu/Debian)
  if command -v ufw &>/dev/null; then
    if ufw status 2>/dev/null | grep -q "active"; then
      info "Configuring UFW..."
      for port in "${ports[@]}"; do
        run ufw allow "$port/tcp" comment "Honeypot" 2>/dev/null || true
      done
      ok "UFW rules added"
    else
      info "UFW installed but not active — skipping"
    fi

  # firewalld (CentOS/RHEL/Fedora)
  elif command -v firewall-cmd &>/dev/null; then
    if systemctl is-active firewalld &>/dev/null; then
      info "Configuring firewalld..."
      for port in "${ports[@]}"; do
        run firewall-cmd --permanent --add-port="${port}/tcp" 2>/dev/null || true
      done
      run firewall-cmd --reload 2>/dev/null || true
      ok "Firewalld rules added"
    else
      info "firewalld installed but not active — skipping"
    fi

  # iptables fallback
  elif command -v iptables &>/dev/null; then
    info "Configuring iptables..."
    for port in "${ports[@]}"; do
      # Check if rule already exists
      if ! iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
        run iptables -A INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null || true
      fi
    done
    # Try to persist
    if command -v iptables-save &>/dev/null; then
      iptables-save > /etc/iptables.rules 2>/dev/null || true
    fi
    if command -v netfilter-persistent &>/dev/null; then
      netfilter-persistent save 2>/dev/null || true
    fi
    ok "iptables rules added"

  # nftables
  elif command -v nft &>/dev/null; then
    info "Configuring nftables..."
    local port_list=$(IFS=,; echo "${ports[*]}")
    nft add rule inet filter input tcp dport "{ $port_list }" accept 2>/dev/null || \
      warn "nftables rule failed — you may need to add rules manually"
    ok "nftables rules added"

  else
    warn "No firewall detected. Ensure ports ${ports[*]} are accessible."
  fi
}

# ─── Systemd service ────────────────────────────────────────────────────────
setup_systemd() {
  if $SKIP_SERVICE; then
    info "Systemd service setup skipped (--skip-service)"
    return
  fi

  step "Setting Up Systemd Service"

  if ! command -v systemctl &>/dev/null; then
    warn "systemd not found. Creating init script instead..."
    setup_init_script
    return
  fi

  local node_path=$(which node)
  local unit_file="/etc/systemd/system/${SERVICE_NAME}.service"

  cat > "$unit_file" <<SVCEOF
[Unit]
Description=HoneyPot Defense System v3.0
Documentation=https://github.com/honeypot-defense-system
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
ExecStart=$node_path $INSTALL_DIR/server.js
ExecStop=/bin/kill -SIGTERM \$MAINPID

# Restart policy
Restart=always
RestartSec=5
StartLimitBurst=5
StartLimitIntervalSec=60

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$INSTALL_DIR/logs $INSTALL_DIR/data
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true

# Resource limits
LimitNOFILE=65536
LimitNPROC=4096
MemoryMax=512M
CPUQuota=80%

# Environment
Environment=NODE_ENV=production
Environment=HOME=$INSTALL_DIR

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME

[Install]
WantedBy=multi-user.target
SVCEOF

  run systemctl daemon-reload
  run systemctl enable "$SERVICE_NAME" 2>/dev/null
  ok "Systemd service created and enabled"
}

setup_init_script() {
  local node_path=$(which node)
  local initfile="/etc/init.d/$SERVICE_NAME"

  cat > "$initfile" <<'INITEOF'
#!/bin/sh
### BEGIN INIT INFO
# Provides:          honeypot
# Required-Start:    $network $remote_fs
# Required-Stop:     $network $remote_fs
# Default-Start:     2 3 4 5
# Default-Stop:      0 1 6
# Description:       HoneyPot Defense System
### END INIT INFO
INITEOF

  cat >> "$initfile" <<INITEOF
DAEMON="$node_path"
DAEMON_ARGS="$INSTALL_DIR/server.js"
PIDFILE="$INSTALL_DIR/data/server.pid"
USER="$SERVICE_USER"
DIR="$INSTALL_DIR"

case "\$1" in
  start)
    echo "Starting honeypot..."
    cd "\$DIR" && su -s /bin/sh "\$USER" -c "NODE_ENV=production \$DAEMON \$DAEMON_ARGS &"
    ;;
  stop)
    echo "Stopping honeypot..."
    [ -f "\$PIDFILE" ] && kill \$(cat "\$PIDFILE") 2>/dev/null
    ;;
  restart)
    \$0 stop; sleep 2; \$0 start
    ;;
  status)
    [ -f "\$PIDFILE" ] && kill -0 \$(cat "\$PIDFILE") 2>/dev/null && echo "Running" || echo "Stopped"
    ;;
  *)
    echo "Usage: \$0 {start|stop|restart|status}"
    exit 1
    ;;
esac
INITEOF

  chmod +x "$initfile"
  ok "Init script created at $initfile"
}

# ─── Start and verify ────────────────────────────────────────────────────────
start_and_verify() {
  step "Starting HoneyPot"

  if ! $SKIP_SERVICE && command -v systemctl &>/dev/null; then
    run systemctl start "$SERVICE_NAME"
    sleep 3

    # Check if it started successfully
    if systemctl is-active "$SERVICE_NAME" &>/dev/null; then
      ok "Service started via systemd"
    else
      fail "Service failed to start. Checking logs..."
      journalctl -u "$SERVICE_NAME" --no-pager -n 30 2>/dev/null || true
      echo ""

      # Diagnose
      local status_output=$(systemctl status "$SERVICE_NAME" 2>&1 || true)
      if echo "$status_output" | grep -qi "EADDRINUSE\|address already in use"; then
        die "Port conflict. Another process is using one of the honeypot ports."
      elif echo "$status_output" | grep -qi "EACCES\|permission denied"; then
        die "Permission denied. Check file ownership and port permissions."
      elif echo "$status_output" | grep -qi "MODULE_NOT_FOUND\|Cannot find module"; then
        die "Missing Node.js module. Run: cd $INSTALL_DIR && npm install --production"
      elif echo "$status_output" | grep -qi "ENOENT"; then
        die "File not found. Check that all source files are deployed."
      else
        die "Unknown startup failure. Check: journalctl -u $SERVICE_NAME -f"
      fi
    fi
  else
    # Manual start
    info "Starting manually..."
    cd "$INSTALL_DIR"
    run su -s /bin/sh "$SERVICE_USER" -c "cd $INSTALL_DIR && NODE_ENV=production node server.js &" 2>/dev/null \
      || run bash -c "cd $INSTALL_DIR && NODE_ENV=production node server.js &" 2>/dev/null
    sleep 3
  fi

  # Health check — dashboard
  step "Running Health Checks"
  local max_retries=5
  local retry=0
  local health_ok=false

  while [[ $retry -lt $max_retries ]]; do
    local http_code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$DASHBOARD_PORT/" 2>/dev/null || echo "000")
    if [[ "$http_code" == "200" || "$http_code" == "304" ]]; then
      health_ok=true
      break
    fi
    retry=$((retry + 1))
    if [[ $retry -lt $max_retries ]]; then
      info "Dashboard not ready (HTTP $http_code), retrying in 2s... ($retry/$max_retries)"
      sleep 2
    fi
  done

  if $health_ok; then
    ok "Dashboard responding (HTTP $http_code)"
  else
    warn "Dashboard health check failed after $max_retries attempts (HTTP $http_code)"
    warn "The service may still be starting. Check: curl http://127.0.0.1:$DASHBOARD_PORT/"
  fi

  # Health check — API
  local api_code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$DASHBOARD_PORT/api/status" 2>/dev/null || echo "000")
  if [[ "$api_code" == "200" ]]; then
    ok "API endpoint responding"
  else
    warn "API health check returned HTTP $api_code"
  fi

  # Health check — WebSocket
  if command -v node &>/dev/null; then
    local ws_check=$(node -e "
      const ws=new (require('ws'))('ws://127.0.0.1:$DASHBOARD_PORT/ws');
      ws.on('open',()=>{console.log('ok');ws.close();process.exit(0)});
      ws.on('error',()=>{console.log('fail');process.exit(1)});
      setTimeout(()=>{console.log('timeout');process.exit(1)},3000);
    " 2>/dev/null || echo "skip")
    if [[ "$ws_check" == "ok" ]]; then
      ok "WebSocket connection verified"
    elif [[ "$ws_check" != "skip" ]]; then
      warn "WebSocket check: $ws_check"
    fi
  fi

  # Verify honeypot ports are listening
  for entry in "$SSH_PORT:SSH" "$HTTP_PORT:HTTP" "$FTP_PORT:FTP" "$TELNET_PORT:Telnet"; do
    local port="${entry%%:*}"
    local name="${entry##*:}"
    if ss -tln "sport = :$port" 2>/dev/null | grep -q "$port" || \
       netstat -tln 2>/dev/null | grep -q ":$port "; then
      ok "$name honeypot listening on port $port"
    else
      warn "$name honeypot not listening on port $port"
    fi
  done
}

# ─── Logrotate ───────────────────────────────────────────────────────────────
setup_logrotate() {
  if ! command -v logrotate &>/dev/null; then
    info "logrotate not found — skipping log rotation setup"
    return
  fi

  step "Setting Up Log Rotation"

  cat > "/etc/logrotate.d/$SERVICE_NAME" <<LREOF
$INSTALL_DIR/logs/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
    maxsize 50M
    su $SERVICE_USER $SERVICE_USER
}
LREOF

  ok "Log rotation configured (30 days, 50MB max)"
}

# ─── Print summary ──────────────────────────────────────────────────────────
print_summary() {
  local ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  [[ -z "$ip" ]] && ip="<server-ip>"
  local public_ip=$(curl -s --max-time 3 ifconfig.me 2>/dev/null || echo "")

  echo ""
  echo -e "${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
  echo -e "${W}  HoneyPot Defense System — Deployment Complete${N}"
  echo -e "${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
  echo ""
  echo -e "  ${C}Dashboard:${N}      http://$ip:$DASHBOARD_PORT"
  [[ -n "$public_ip" ]] && \
  echo -e "  ${C}Public URL:${N}     http://$public_ip:$DASHBOARD_PORT"
  echo ""
  echo -e "  ${C}Honeypot Services:${N}"
  echo -e "    SSH:          ${W}$BIND_ADDR:$SSH_PORT${N}"
  echo -e "    HTTP:         ${W}$BIND_ADDR:$HTTP_PORT${N}"
  echo -e "    FTP:          ${W}$BIND_ADDR:$FTP_PORT${N}"
  echo -e "    Telnet:       ${W}$BIND_ADDR:$TELNET_PORT${N}"
  echo ""
  echo -e "  ${C}Install Dir:${N}    $INSTALL_DIR"
  echo -e "  ${C}Service User:${N}   $SERVICE_USER"
  echo -e "  ${C}Log File:${N}       $LOG_FILE"
  [[ -n "$BACKUP_DIR" ]] && \
  echo -e "  ${C}Backup:${N}         $BACKUP_DIR"
  echo ""
  echo -e "  ${C}Management Commands:${N}"
  if command -v systemctl &>/dev/null && ! $SKIP_SERVICE; then
    echo -e "    ${W}systemctl status $SERVICE_NAME${N}    — Check status"
    echo -e "    ${W}systemctl restart $SERVICE_NAME${N}   — Restart"
    echo -e "    ${W}systemctl stop $SERVICE_NAME${N}      — Stop"
    echo -e "    ${W}journalctl -fu $SERVICE_NAME${N}      — Live logs"
  else
    echo -e "    ${W}cd $INSTALL_DIR && node server.js${N} — Start"
  fi
  echo -e "    ${W}$0 --rollback $BACKUP_DIR${N}"
  echo -e "    ${W}$0 --uninstall${N}"
  echo ""
  echo -e "  ${Y}Test with:${N}"
  echo -e "    ${D}curl http://$ip:$HTTP_PORT${N}"
  echo -e "    ${D}ssh -p $SSH_PORT user@$ip${N}"
  echo -e "    ${D}ftp $ip $FTP_PORT${N}"
  echo ""
  echo -e "${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
}

# ═════════════════════════════════════════════════════════════════════════════
#  MAIN
# ═════════════════════════════════════════════════════════════════════════════

echo ""
echo -e "${R}  ╔═══════════════════════════════════════════════════════╗${N}"
echo -e "${R}  ║     HONEYPOT DEFENSE SYSTEM — DEPLOYMENT SCRIPT      ║${N}"
echo -e "${R}  ║     v3.0  •  Automated Production Installer          ║${N}"
echo -e "${R}  ╚═══════════════════════════════════════════════════════╝${N}"
echo ""

check_root

# Handle special modes
$ROLLBACK_MODE && { detect_os; setup_user; do_rollback; }
$UNINSTALL_MODE && { detect_os; do_uninstall; }

if $DRY_RUN; then
  warn "DRY RUN MODE — no changes will be made"
fi

# Validate source is specified
if ! $LOCAL_MODE && [[ -z "$REPO_URL" ]]; then
  die "No source specified. Use --local PATH or --repo URL\n  Example: $0 --local /home/user/HoneyPot\n  Run $0 --help for all options"
fi

detect_os
check_resources
check_dependencies
check_ports
setup_user
stop_existing
backup_existing
deploy_source
install_deps
setup_ssh_key
setup_auth
configure
set_permissions
setup_firewall
setup_systemd
setup_logrotate
start_and_verify
print_summary

echo -e "\n${G}Deployment completed successfully!${N}\n"
