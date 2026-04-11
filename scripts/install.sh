#!/usr/bin/env bash
# ============================================================================
#  Obsidian-OS — Installation
#  Verwendung: bash scripts/install.sh
# ============================================================================
set -euo pipefail

BRAND="Obsidian-OS"
SERVICE_NAME="obsidian-os"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

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

# ── 1. Node.js prüfen ───────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  fail "Node.js nicht gefunden. Bitte installieren: https://nodejs.org"
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  fail "Node.js >= 18 erforderlich (installiert: $(node -v))"
fi
ok "Node.js $(node -v)"

# ── 2. npm install ───────────────────────────────────────────────────────────
echo -e "\n  > Dependencies installieren..."
cd "$PROJECT_DIR"
npm install --production=false
ok "npm install"

# ── 3. .env erstellen ────────────────────────────────────────────────────────
if [ ! -f "$PROJECT_DIR/.env" ]; then
  cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
  warn ".env erstellt aus .env.example — bitte ausfuellen!"
else
  ok ".env vorhanden"
fi

# ── 4. TypeScript kompilieren ────────────────────────────────────────────────
echo -e "\n  > TypeScript kompilieren..."
npm run build
ok "Build erfolgreich"

# ── 5. CLI global verlinken ──────────────────────────────────────────────────
echo -e "\n  > CLI global verlinken..."
npm link 2>/dev/null && ok "obsidian-os CLI verfuegbar" || warn "npm link fehlgeschlagen — verwende: npx obsidian-os"

# ── 6. Whisper prüfen (optional) ────────────────────────────────────────────
echo ""
if command -v whisper &>/dev/null; then
  ok "Whisper installiert"
elif command -v pip &>/dev/null; then
  warn "Whisper nicht installiert. Fuer Sprachnachrichten: pip install openai-whisper"
else
  warn "Python/pip nicht gefunden. Whisper (Sprachnachrichten) nicht verfuegbar."
fi

# ── 7. systemd Service (nur Linux) ──────────────────────────────────────────
if [[ "$(uname)" == "Linux" ]] && command -v systemctl &>/dev/null; then
  echo ""
  read -p "  Systemd-Service installieren? (j/N) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[JjYy]$ ]]; then
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
fi

# ── Fertig ───────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}${GREEN}  Installation abgeschlossen!${NC}\n"
echo -e "  Naechste Schritte:"
echo -e "    1. ${CYAN}.env ausfuellen${NC} (BOT_TOKEN, WORKSPACE_PATH, OLLAMA_BASE_URL)"
echo -e "    2. ${CYAN}obsidian-os start${NC}"
echo -e "    3. Bot im Telegram oeffnen — Setup startet automatisch\n"
