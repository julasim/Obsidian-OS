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
  # Wichtig: Build-Fehler MUESSEN scheitern lassen. `| grep … || true`
  # maskiert Build-Fails. Stattdessen in Tempfile + PIPESTATUS-Check.
  BUILD_LOG=$(mktemp)
  if ! docker compose build --pull 2>&1 | tee "$BUILD_LOG" | grep -vE "^#|^$"; then
    # grep exit 1 == kein Treffer; Build-Status steht in PIPESTATUS[0]
    :
  fi
  if [ "${PIPESTATUS[0]:-0}" != "0" ]; then
    rm -f "$BUILD_LOG"
    fail "docker compose build fehlgeschlagen — siehe Output oben"
  fi
  rm -f "$BUILD_LOG"
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

# Helper: .env-Wert lesen mit CR-strip (CRLF-Schutz fuer Windows-editierte .env)
env_get() {
  grep -E "^$1=" "$PROJECT_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r'
}

# LLM-Provider erkennen
LLM_KEY_OR="$(env_get OPENROUTER_API_KEY)"
LLM_KEY_GEN="$(env_get LLM_API_KEY)"
LLM_URL="$(env_get LLM_BASE_URL)"
USES_LOCAL=false
if [ -z "$LLM_KEY_OR" ] && { [ -z "$LLM_KEY_GEN" ] || [ "$LLM_KEY_GEN" = "ollama" ]; }; then
  USES_LOCAL=true
elif [ -n "$LLM_URL" ] && echo "$LLM_URL" | grep -qE "localhost|127\.0\.0\.1"; then
  # Nur wenn auch wirklich kein Remote-Key gesetzt ist
  [ -z "$LLM_KEY_OR" ] && [ -z "$LLM_KEY_GEN" ] && USES_LOCAL=true
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
  LLM_MODEL="$(env_get LLM_MODEL)"
  ok "Remote LLM-Provider (${LLM_MODEL:-auto})"
fi

# OneDrive Mount pruefen (falls konfiguriert)
RCLONE_TOKEN_VAL="$(env_get RCLONE_TOKEN)"
if [ -n "$RCLONE_TOKEN_VAL" ] && [ "${#RCLONE_TOKEN_VAL}" -gt 200 ]; then
  echo "  > Pruefe OneDrive Mount..."
  sleep 3  # Mount braucht Zeit
  if docker compose exec -T bot mountpoint -q /vault 2>/dev/null; then
    FILE_COUNT=$(docker compose exec -T bot ls /vault 2>/dev/null | wc -l)
    ok "OneDrive gemountet ($FILE_COUNT Eintraege unter /vault)"
  else
    warn "OneDrive NICHT gemountet — Logs: docker compose logs bot | grep -iE 'onedrive|rclone'"
    DRIVE_TYPE="$(env_get ONEDRIVE_DRIVE_TYPE)"
    echo -e "    ${CYAN}Diagnose:${NC}"
    echo -e "      RCLONE_TOKEN Laenge: ${#RCLONE_TOKEN_VAL} (erwartet >4000)"
    echo -e "      ONEDRIVE_DRIVE_TYPE: ${DRIVE_TYPE:-<leer>}  (personal|business|documentLibrary)"
    [ "${#RCLONE_TOKEN_VAL}" -lt 4000 ] && echo -e "      ${YELLOW}→ Token vermutlich abgeschnitten — nano .env neu eintragen${NC}"
    [ -z "$DRIVE_TYPE" ] && echo -e "      ${YELLOW}→ DRIVE_TYPE fehlt — nano .env setzen (business fuer Microsoft 365)${NC}"
  fi
elif [ -n "$RCLONE_TOKEN_VAL" ]; then
  warn "RCLONE_TOKEN in .env aber zu kurz (${#RCLONE_TOKEN_VAL} Zeichen) — vermutlich abgeschnitten"
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
