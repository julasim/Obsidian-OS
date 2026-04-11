#!/usr/bin/env bash
# ============================================================================
#  Obsidian-OS — Update
#  Verwendung: bash scripts/update.sh
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

echo -e "\n${BOLD}${CYAN}  $BRAND Update${NC}\n"

cd "$PROJECT_DIR"

# ── 1. Git Pull ──────────────────────────────────────────────────────────────
echo "  > Git Pull..."
if git rev-parse --is-inside-work-tree &>/dev/null; then
  BEFORE=$(git rev-parse HEAD)
  git pull --rebase
  AFTER=$(git rev-parse HEAD)
  if [ "$BEFORE" = "$AFTER" ]; then
    ok "Bereits aktuell"
  else
    COMMITS=$(git log --oneline "$BEFORE".."$AFTER" | wc -l)
    ok "$COMMITS neue Commits"
  fi
else
  warn "Kein Git-Repository — ueberspringe Pull"
fi

# ── 2. Dependencies ─────────────────────────────────────────────────────────
echo -e "\n  > Dependencies aktualisieren..."
npm install --production=false
ok "npm install"

# ── 3. Build ─────────────────────────────────────────────────────────────────
echo -e "\n  > TypeScript kompilieren..."
npm run build
ok "Build erfolgreich"

# ── 4. Service neustarten (Linux systemd) ────────────────────────────────────
if [[ "$(uname)" == "Linux" ]] && systemctl is-active "$SERVICE_NAME" &>/dev/null; then
  echo -e "\n  > Service neustarten..."
  sudo systemctl restart "$SERVICE_NAME"
  sleep 2
  if systemctl is-active "$SERVICE_NAME" &>/dev/null; then
    ok "Service laeuft"
  else
    fail "Service konnte nicht gestartet werden — journalctl -u $SERVICE_NAME"
  fi
fi

# ── Fertig ───────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}${GREEN}  Update abgeschlossen!${NC}\n"

# Version aus package.json
VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf-8')).version)")
echo -e "  ${BRAND} v${VERSION}\n"
