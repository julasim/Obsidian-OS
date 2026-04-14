#!/usr/bin/env bash
# ============================================================================
#  Obsidian-OS — Installation (Docker)
#  Alles laeuft im Container. Auf dem Host nur Docker + Git.
#  Verwendung: bash <(curl -fsSL https://raw.githubusercontent.com/julasim/Obsidian-OS/main/scripts/install.sh)
# ============================================================================
set -euo pipefail

BRAND="Obsidian-OS"
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
step() { echo -e "\n${BOLD}${CYAN}  ── $1${NC}\n"; }

# Helper: .env Wert lesen/setzen
env_get() { grep -E "^$1=" "$INSTALL_DIR/.env" 2>/dev/null | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true; }
env_set() {
  local key="$1" val="$2" file="$INSTALL_DIR/.env"
  if grep -qE "^${key}=" "$file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$file"
  else
    echo "${key}=${val}" >> "$file"
  fi
}

echo -e "\n${BOLD}${CYAN}  ╔══════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}  ║       $BRAND Installation          ║${NC}"
echo -e "${BOLD}${CYAN}  ╚══════════════════════════════════════╝${NC}\n"

# ═══════════════════════════════════════════════════════════════════════════════
#  1. Docker + Git
# ═══════════════════════════════════════════════════════════════════════════════
step "1/6  Host-Abhaengigkeiten"

if ! command -v docker &>/dev/null; then
  echo -e "  > Docker wird installiert..."
  curl -fsSL https://get.docker.com | sh
  sudo systemctl enable docker
  sudo systemctl start docker
  ok "Docker installiert"
else
  ok "Docker $(docker --version | grep -oP '\d+\.\d+\.\d+')"
fi

if ! docker compose version &>/dev/null; then
  echo -e "  > Docker Compose Plugin wird installiert..."
  sudo apt-get update && sudo apt-get install -y docker-compose-plugin 2>/dev/null || true
fi
ok "Docker Compose $(docker compose version --short 2>/dev/null || echo 'ok')"

if ! command -v git &>/dev/null; then
  sudo apt-get update && sudo apt-get install -y git
fi
ok "Git $(git --version | cut -d' ' -f3)"

# ═══════════════════════════════════════════════════════════════════════════════
#  2. Repository
# ═══════════════════════════════════════════════════════════════════════════════
step "2/6  Repository"

if [ -d "$INSTALL_DIR/.git" ]; then
  cd "$INSTALL_DIR"
  git pull --ff-only
  ok "Repo aktualisiert"
else
  sudo mkdir -p "$INSTALL_DIR"
  sudo chown "$(whoami)" "$INSTALL_DIR"
  git clone "$REPO_URL" "$INSTALL_DIR"
  ok "Repo gecloned nach $INSTALL_DIR"
fi
cd "$INSTALL_DIR"

if [ ! -f "$INSTALL_DIR/.env" ]; then
  cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
fi

# Ollama laeuft im Container — immer localhost
env_set "OLLAMA_BASE_URL" "http://localhost:11434/v1"
env_set "WORKSPACE_PATH" "/vault"

# ═══════════════════════════════════════════════════════════════════════════════
#  3. Telegram Bot Token
# ═══════════════════════════════════════════════════════════════════════════════
step "3/6  Telegram Bot"

CURRENT_TOKEN="$(env_get BOT_TOKEN)"
if [ -n "$CURRENT_TOKEN" ]; then
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://api.telegram.org/bot${CURRENT_TOKEN}/getMe")
  if [ "$HTTP_CODE" = "200" ]; then
    BOT_NAME=$(curl -s "https://api.telegram.org/bot${CURRENT_TOKEN}/getMe" | grep -oP '"first_name"\s*:\s*"\K[^"]+')
    ok "Bot Token gueltig — @${BOT_NAME}"
  else
    warn "Gespeicherter Token ungueltig"
    CURRENT_TOKEN=""
  fi
fi

if [ -z "$CURRENT_TOKEN" ]; then
  while true; do
    echo -e "  Token von ${CYAN}@BotFather${NC} in Telegram holen."
    read -rp "  Bot Token: " BOT_TOKEN_INPUT
    BOT_TOKEN_INPUT=$(echo "$BOT_TOKEN_INPUT" | xargs)
    [ -z "$BOT_TOKEN_INPUT" ] && { warn "Token darf nicht leer sein."; continue; }

    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://api.telegram.org/bot${BOT_TOKEN_INPUT}/getMe")
    if [ "$HTTP_CODE" = "200" ]; then
      BOT_NAME=$(curl -s "https://api.telegram.org/bot${BOT_TOKEN_INPUT}/getMe" | grep -oP '"first_name"\s*:\s*"\K[^"]+')
      env_set "BOT_TOKEN" "$BOT_TOKEN_INPUT"
      ok "Bot Token gespeichert — @${BOT_NAME}"
      break
    else
      warn "Token ungueltig (HTTP $HTTP_CODE). Nochmal."
    fi
  done
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  4. LLM Modell
# ═══════════════════════════════════════════════════════════════════════════════
step "4/6  LLM Modell"

echo -e "  Ollama laeuft im Container. Cloud-Modelle haben ${CYAN}:cloud${NC} Suffix."
CURRENT_MODEL="$(env_get OLLAMA_MODEL)"
CURRENT_MODEL=${CURRENT_MODEL:-kimi-k2.5:cloud}
read -rp "  Modell [$CURRENT_MODEL]: " MODEL_INPUT
env_set "OLLAMA_MODEL" "${MODEL_INPUT:-$CURRENT_MODEL}"
ok "Modell: ${MODEL_INPUT:-$CURRENT_MODEL}"

# ═══════════════════════════════════════════════════════════════════════════════
#  5. OneDrive / Vault
# ═══════════════════════════════════════════════════════════════════════════════
step "5/6  Obsidian Vault (OneDrive)"

CURRENT_RCLONE_TOKEN="$(env_get RCLONE_TOKEN)"

if [ -n "$CURRENT_RCLONE_TOKEN" ]; then
  ok "OneDrive Token vorhanden"
else
  echo -e "  Der Vault wird via OneDrive in den Container gemountet."
  echo -e ""
  echo -e "  ${BOLD}So bekommst du das Token:${NC}"
  echo -e "    1. Auf deinem ${CYAN}PC/Mac${NC} rclone installieren: ${CYAN}https://rclone.org/install/${NC}"
  echo -e "    2. Ausfuehren: ${CYAN}rclone authorize \"onedrive\"${NC}"
  echo -e "    3. Im Browser bei Microsoft anmelden"
  echo -e "    4. Das Token wird angezeigt — hierher kopieren"
  echo -e ""
  read -rp "  rclone Token (oder Enter zum Ueberspringen): " RCLONE_TOKEN_INPUT

  if [ -n "$RCLONE_TOKEN_INPUT" ]; then
    env_set "RCLONE_TOKEN" "$RCLONE_TOKEN_INPUT"
    ok "OneDrive Token gespeichert"
  else
    warn "Kein Token — OneDrive uebersprungen. Spaeter in .env setzen."
  fi
fi

CURRENT_OD_PATH="$(env_get ONEDRIVE_VAULT_PATH)"
if [ -n "$(env_get RCLONE_TOKEN)" ] && [ -z "$CURRENT_OD_PATH" ]; then
  echo -e ""
  read -rp "  OneDrive Vault-Pfad (z.B. Obsidian_Julius Sima): " OD_PATH_INPUT
  [ -n "$OD_PATH_INPUT" ] && env_set "ONEDRIVE_VAULT_PATH" "$OD_PATH_INPUT" && ok "Vault-Pfad: $OD_PATH_INPUT"
elif [ -n "$CURRENT_OD_PATH" ]; then
  ok "Vault-Pfad: $CURRENT_OD_PATH"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  6. Container bauen + starten + Ollama signin
# ═══════════════════════════════════════════════════════════════════════════════
step "6/6  Container starten"

cd "$INSTALL_DIR"

echo -e "  > Image wird gebaut (kann beim ersten Mal einige Minuten dauern)..."
docker compose build
ok "Image gebaut"

docker compose down 2>/dev/null || true
docker compose up -d
ok "Container gestartet"

# Warten bis Ollama im Container bereit ist
echo -e "\n  > Warte auf Ollama im Container..."
for i in $(seq 1 20); do
  if docker compose exec -T bot curl -sf http://localhost:11434/api/version &>/dev/null; then
    ok "Ollama laeuft im Container"
    break
  fi
  sleep 2
done

# Ollama Cloud Signin
echo -e ""
echo -e "  ${BOLD}Ollama Cloud Anmeldung:${NC}"
echo -e "  Gleich erscheint ein Link — diesen im Browser oeffnen und anmelden.\n"

docker compose exec bot ollama signin || warn "Signin fehlgeschlagen — spaeter: cd $INSTALL_DIR && docker compose exec bot ollama signin"

echo -e ""
read -rp "  Link im Browser geoeffnet und angemeldet? [Enter zum Fortfahren] "
ok "Ollama Anmeldung abgeschlossen"

# Container neu starten damit Bot die Anmeldung erkennt
echo -e "\n  > Bot wird neu gestartet..."
docker compose restart
sleep 3

if docker compose ps 2>/dev/null | grep -q "Up"; then
  ok "$BRAND laeuft!"
else
  warn "Status pruefen: cd $INSTALL_DIR && docker compose logs -f"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  Zusammenfassung
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}${GREEN}  ╔══════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}  ║       Installation abgeschlossen!    ║${NC}"
echo -e "${BOLD}${GREEN}  ╚══════════════════════════════════════╝${NC}\n"

echo -e "  ${BOLD}Konfiguration:${NC}"
echo -e "    Verzeichnis:  ${CYAN}$INSTALL_DIR${NC}"
echo -e "    Modell:       ${CYAN}$(env_get OLLAMA_MODEL)${NC}"
echo -e ""
echo -e "  ${BOLD}Befehle:${NC}"
echo -e "    Logs:     ${CYAN}cd $INSTALL_DIR && docker compose logs -f${NC}"
echo -e "    Restart:  ${CYAN}cd $INSTALL_DIR && docker compose restart${NC}"
echo -e "    Stop:     ${CYAN}cd $INSTALL_DIR && docker compose down${NC}"
echo -e "    Update:   ${CYAN}cd $INSTALL_DIR && git pull && docker compose up -d --build${NC}"
echo -e "    Config:   ${CYAN}nano $INSTALL_DIR/.env${NC}"
echo -e "    Signin:   ${CYAN}cd $INSTALL_DIR && docker compose exec bot ollama signin${NC}"
echo -e ""
echo -e "  ${BOLD}Jetzt Telegram oeffnen und dem Bot schreiben!${NC}\n"
