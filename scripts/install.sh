#!/usr/bin/env bash
# ============================================================================
#  Obsidian-OS — Installation
#  Verwendung: bash scripts/install.sh
# ============================================================================
set -euo pipefail

BRAND="Obsidian-OS"
SERVICE_NAME="obsidian-os"
REPO_URL="https://github.com/julasim/Obsidian-OS.git"
INSTALL_DIR="/opt/obsidian-os"

# ── Farben ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}!${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }

echo -e "\n${BOLD}${CYAN}  $BRAND Installation${NC}\n"

# ── 1. Node.js prüfen / installieren ────────────────────────────────────────
install_node() {
  echo -e "\n  > Node.js wird installiert..."
  if [[ "$(uname)" == "Linux" ]]; then
    # NodeSource Setup fuer Node 22 LTS
    if command -v apt-get &>/dev/null; then
      curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
      sudo apt-get install -y nodejs
    elif command -v dnf &>/dev/null; then
      curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
      sudo dnf install -y nodejs
    elif command -v yum &>/dev/null; then
      curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
      sudo yum install -y nodejs
    else
      fail "Paketmanager nicht erkannt. Bitte Node.js manuell installieren: https://nodejs.org"
    fi
  elif [[ "$(uname)" == "Darwin" ]]; then
    if command -v brew &>/dev/null; then
      brew install node
    else
      fail "Homebrew nicht gefunden. Bitte Node.js manuell installieren: https://nodejs.org"
    fi
  else
    fail "Betriebssystem nicht unterstuetzt. Bitte Node.js manuell installieren: https://nodejs.org"
  fi

  if ! command -v node &>/dev/null; then
    fail "Node.js Installation fehlgeschlagen."
  fi
  ok "Node.js $(node -v) installiert"
}

if ! command -v node &>/dev/null; then
  warn "Node.js nicht gefunden — wird installiert..."
  install_node
else
  NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VERSION" -lt 18 ]; then
    warn "Node.js $(node -v) zu alt — wird auf Version 22 aktualisiert..."
    install_node
  else
    ok "Node.js $(node -v)"
  fi
fi

# ── 2. Git prüfen / Repo clonen ─────────────────────────────────────────────
if ! command -v git &>/dev/null; then
  echo -e "\n  > Git wird installiert..."
  if command -v apt-get &>/dev/null; then
    sudo apt-get install -y git
  elif command -v dnf &>/dev/null; then
    sudo dnf install -y git
  elif command -v yum &>/dev/null; then
    sudo yum install -y git
  fi
fi
ok "Git $(git --version | cut -d' ' -f3)"

if [ -d "$INSTALL_DIR/.git" ]; then
  echo -e "\n  > Repository aktualisieren..."
  cd "$INSTALL_DIR"
  git pull --ff-only
  ok "Repo aktualisiert"
else
  echo -e "\n  > Repository clonen..."
  sudo mkdir -p "$INSTALL_DIR"
  sudo chown "$(whoami)" "$INSTALL_DIR"
  git clone "$REPO_URL" "$INSTALL_DIR"
  ok "Repo gecloned nach $INSTALL_DIR"
fi

PROJECT_DIR="$INSTALL_DIR"
cd "$PROJECT_DIR"

# ── 3. npm install ───────────────────────────────────────────────────────────
echo -e "\n  > Dependencies installieren..."
npm install --production=false
ok "npm install"

# ── 4. .env erstellen ────────────────────────────────────────────────────────
if [ ! -f "$PROJECT_DIR/.env" ]; then
  cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
  warn ".env erstellt aus .env.example — bitte ausfuellen!"
else
  ok ".env vorhanden"
fi

# ── 5. TypeScript kompilieren ────────────────────────────────────────────────
echo -e "\n  > TypeScript kompilieren..."
npm run build
ok "Build erfolgreich"

# ── 6. CLI global verlinken ──────────────────────────────────────────────────
echo -e "\n  > CLI global verlinken..."
npm link 2>/dev/null && ok "obsidian-os CLI verfuegbar" || warn "npm link fehlgeschlagen — verwende: npx obsidian-os"

# ── 7. Whisper prüfen (optional) ────────────────────────────────────────────
echo ""
if command -v whisper &>/dev/null; then
  ok "Whisper installiert"
elif command -v pip &>/dev/null; then
  warn "Whisper nicht installiert. Fuer Sprachnachrichten: pip install openai-whisper"
else
  warn "Python/pip nicht gefunden. Whisper (Sprachnachrichten) nicht verfuegbar."
fi

# ── 8. systemd Service (nur Linux) ──────────────────────────────────────────
if [[ "$(uname)" == "Linux" ]] && command -v systemctl &>/dev/null; then
  echo ""
  SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
  sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=$BRAND — Obsidian Vault Assistant via Telegram
After=network.target

[Service]
Type=simple
WorkingDirectory=$PROJECT_DIR
ExecStart=$(which node) $PROJECT_DIR/dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable "$SERVICE_NAME"
  ok "Systemd-Service installiert: $SERVICE_NAME"
  echo -e "     Start: ${CYAN}sudo systemctl start $SERVICE_NAME${NC}"
  echo -e "     Logs:  ${CYAN}journalctl -u $SERVICE_NAME -f${NC}"
fi

# ── Fertig ───────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}${GREEN}  Installation abgeschlossen!${NC}\n"
echo -e "  Naechste Schritte:"
echo -e "    1. ${CYAN}.env ausfuellen${NC} (BOT_TOKEN, WORKSPACE_PATH, OLLAMA_BASE_URL)"
echo -e "    2. ${CYAN}obsidian-os start${NC}"
echo -e "    3. Bot im Telegram oeffnen — Setup startet automatisch\n"
