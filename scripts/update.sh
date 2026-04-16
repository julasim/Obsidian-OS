#!/usr/bin/env bash
# ============================================================================
#  Obsidian-OS — Update (Docker)
#  Verwendung:  cd /opt/obsidian-os && bash scripts/update.sh
#  Oder remote: bash <(curl -fsSL https://raw.githubusercontent.com/julasim/Obsidian-OS/main/scripts/update.sh)
# ============================================================================
set -euo pipefail

BRAND="Obsidian-OS"
INSTALL_DIR="/opt/obsidian-os"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd 2>/dev/null || echo "$INSTALL_DIR/scripts")"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Falls via curl gestartet: nach INSTALL_DIR wechseln
if [ ! -f "$PROJECT_DIR/docker-compose.yml" ]; then
  PROJECT_DIR="$INSTALL_DIR"
fi

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
step() { echo -e "\n${BOLD}${CYAN}  ── $1${NC}\n"; }

echo -e "\n${BOLD}${CYAN}  ╔══════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}  ║         $BRAND Update              ║${NC}"
echo -e "${BOLD}${CYAN}  ╚══════════════════════════════════════╝${NC}\n"

# ── Preflight ────────────────────────────────────────────────────────────────
[ -d "$PROJECT_DIR" ] || fail "Projekt-Verzeichnis nicht gefunden: $PROJECT_DIR"
[ -f "$PROJECT_DIR/docker-compose.yml" ] || fail "docker-compose.yml fehlt in $PROJECT_DIR"
command -v docker >/dev/null || fail "Docker nicht installiert"
docker compose version >/dev/null 2>&1 || fail "Docker Compose Plugin fehlt"

cd "$PROJECT_DIR"

# ── 1. Git Pull ──────────────────────────────────────────────────────────────
step "1/5  Git Pull"

if [ -d .git ]; then
  BEFORE=$(git rev-parse HEAD)
  git fetch --quiet
  git pull --ff-only || fail "git pull fehlgeschlagen — lokale Aenderungen? Bitte manuell aufloesen."
  AFTER=$(git rev-parse HEAD)

  if [ "$BEFORE" = "$AFTER" ]; then
    ok "Bereits aktuell ($(git rev-parse --short HEAD))"
    NEW_COMMITS=0
  else
    NEW_COMMITS=$(git rev-list --count "$BEFORE..$AFTER")
    ok "$NEW_COMMITS neue Commits"
    echo -e "\n${CYAN}  Aenderungen:${NC}"
    git log --oneline "$BEFORE..$AFTER" | head -10 | sed 's/^/    /'
  fi
else
  fail "Kein Git-Repository — install.sh neu ausfuehren"
fi

# ── 2. Image neu bauen (nur wenn Code sich geaendert hat) ───────────────────
step "2/5  Image Build"

if [ "$NEW_COMMITS" = "0" ] && [ "${FORCE_BUILD:-0}" != "1" ]; then
  ok "Skip (keine Aenderungen — FORCE_BUILD=1 um zu erzwingen)"
  BUILD_SKIPPED=1
else
  echo "  > docker compose build..."
  docker compose build --pull 2>&1 | grep -vE "^#|^$" || true
  ok "Image gebaut"
  BUILD_SKIPPED=0
fi

# ── 3. Container neu starten ────────────────────────────────────────────────
step "3/5  Container Restart"

if [ "${BUILD_SKIPPED:-0}" = "1" ]; then
  # Nur .env-Aenderungen? Restart reicht
  docker compose restart
  ok "Container neu gestartet"
else
  # Neues Image → down + up
  docker compose down 2>/dev/null || true
  docker compose up -d
  ok "Container mit neuem Image gestartet"
fi

# ── 4. Health-Check ─────────────────────────────────────────────────────────
step "4/5  Health-Check"

# LLM-Provider erkennen
LLM_KEY=$(grep -E "^(LLM_API_KEY|OPENROUTER_API_KEY)=" "$PROJECT_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2-)
LLM_URL=$(grep -E "^LLM_BASE_URL=" "$PROJECT_DIR/.env" 2>/dev/null | cut -d= -f2-)
USES_LOCAL=false
if [ -z "$LLM_KEY" ] || [ "$LLM_KEY" = "ollama" ]; then
  USES_LOCAL=true
elif echo "$LLM_URL" | grep -qE "localhost|127\.0\.0\.1"; then
  USES_LOCAL=true
fi

if [ "$USES_LOCAL" = "true" ]; then
  echo "  > Warte auf Ollama..."
  OLLAMA_OK=0
  for i in $(seq 1 20); do
    if docker compose exec -T bot curl -sf http://localhost:11434/api/version &>/dev/null; then
      ok "Ollama laeuft"
      OLLAMA_OK=1
      break
    fi
    sleep 2
  done
  [ "$OLLAMA_OK" = "0" ] && warn "Ollama antwortet nicht — ggf. 'docker compose exec bot ollama signin'"
else
  LLM_MODEL=$(grep -E "^LLM_MODEL=" "$PROJECT_DIR/.env" 2>/dev/null | cut -d= -f2-)
  ok "Remote LLM-Provider (${LLM_MODEL:-auto})"
fi

# OneDrive Mount pruefen (falls konfiguriert)
if grep -q "^RCLONE_TOKEN=." "$PROJECT_DIR/.env" 2>/dev/null; then
  echo "  > Pruefe OneDrive Mount..."
  sleep 3  # Mount braucht Zeit
  if docker compose exec -T bot mountpoint -q /vault 2>/dev/null; then
    FILE_COUNT=$(docker compose exec -T bot ls /vault 2>/dev/null | wc -l)
    ok "OneDrive gemountet ($FILE_COUNT Eintraege unter /vault)"
  else
    warn "OneDrive NICHT gemountet — Logs: docker compose logs bot | grep -i onedrive"
    # Haeufigste Ursachen anzeigen
    TOKEN_LEN=$(grep "^RCLONE_TOKEN=" "$PROJECT_DIR/.env" | cut -d= -f2- | wc -c)
    DRIVE_TYPE=$(grep "^ONEDRIVE_DRIVE_TYPE=" "$PROJECT_DIR/.env" | cut -d= -f2-)
    echo -e "    ${CYAN}Diagnose:${NC}"
    echo -e "      RCLONE_TOKEN Laenge: $TOKEN_LEN (erwartet >4100)"
    echo -e "      ONEDRIVE_DRIVE_TYPE: ${DRIVE_TYPE:-<leer>}  (personal|business|documentLibrary)"
    [ "$TOKEN_LEN" -lt 4100 ] && echo -e "      ${YELLOW}→ Token vermutlich abgeschnitten — nano .env neu eintragen${NC}"
    [ -z "$DRIVE_TYPE" ] && echo -e "      ${YELLOW}→ DRIVE_TYPE fehlt — nano .env setzen (business fuer Microsoft 365)${NC}"
  fi
else
  warn "Kein RCLONE_TOKEN in .env — OneDrive uebersprungen"
fi

# Bot-Prozess pruefen
if docker compose ps 2>/dev/null | grep -q "Up"; then
  ok "Bot-Container laeuft"
else
  fail "Bot-Container laeuft NICHT — docker compose logs bot"
fi

# ── 5. Summary ───────────────────────────────────────────────────────────────
step "5/5  Fertig"

CURRENT_COMMIT=$(git rev-parse --short HEAD)
CURRENT_MSG=$(git log -1 --pretty=%s)

echo -e "${BOLD}${GREEN}  Update abgeschlossen!${NC}\n"
echo -e "  ${BOLD}Aktuell:${NC}       $CURRENT_COMMIT — $CURRENT_MSG"
echo -e "  ${BOLD}Neue Commits:${NC}  $NEW_COMMITS"
echo -e ""
echo -e "  ${BOLD}Live-Logs:${NC}     ${CYAN}cd $PROJECT_DIR && docker compose logs -f bot${NC}"
echo -e "  ${BOLD}Config edit:${NC}   ${CYAN}nano $PROJECT_DIR/.env${NC}"
echo -e "  ${BOLD}Hard-Rebuild:${NC}  ${CYAN}FORCE_BUILD=1 bash scripts/update.sh${NC}"
echo -e ""
