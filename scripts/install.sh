#!/usr/bin/env bash
# ============================================================================
#  Obsidian-OS — Vollstaendige Installation + Konfiguration
#  Verwendung: bash <(curl -fsSL https://raw.githubusercontent.com/julasim/Obsidian-OS/main/scripts/install.sh)
# ============================================================================
set -euo pipefail

BRAND="Obsidian-OS"
SERVICE_NAME="obsidian-os"
REPO_URL="https://github.com/julasim/Obsidian-OS.git"
INSTALL_DIR="/opt/obsidian-os"
MOUNT_DIR="/mnt/onedrive"

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

# Helper: .env Wert lesen
env_get() { grep -E "^$1=" "$INSTALL_DIR/.env" 2>/dev/null | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true; }

# Helper: .env Wert setzen (ersetzt oder fuegt hinzu)
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
#  PHASE 1: System-Abhängigkeiten
# ═══════════════════════════════════════════════════════════════════════════════
step "1/8  System-Abhaengigkeiten"

# ── Node.js ─────────────────────────────────────────────────────────────────
install_node() {
  echo -e "  > Node.js wird installiert..."
  if [[ "$(uname)" == "Linux" ]]; then
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
      fail "Paketmanager nicht erkannt — Node.js manuell installieren: https://nodejs.org"
    fi
  elif [[ "$(uname)" == "Darwin" ]]; then
    command -v brew &>/dev/null || fail "Homebrew nicht gefunden — https://brew.sh"
    brew install node
  else
    fail "OS nicht unterstuetzt — Node.js manuell installieren: https://nodejs.org"
  fi
  command -v node &>/dev/null || fail "Node.js Installation fehlgeschlagen."
  ok "Node.js $(node -v) installiert"
}

if ! command -v node &>/dev/null; then
  install_node
else
  NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_MAJOR" -lt 18 ]; then
    warn "Node.js $(node -v) zu alt — wird aktualisiert..."
    install_node
  else
    ok "Node.js $(node -v)"
  fi
fi

# ── Git ─────────────────────────────────────────────────────────────────────
if ! command -v git &>/dev/null; then
  echo -e "  > Git wird installiert..."
  if command -v apt-get &>/dev/null; then
    sudo apt-get install -y git
  elif command -v dnf &>/dev/null; then
    sudo dnf install -y git
  elif command -v yum &>/dev/null; then
    sudo yum install -y git
  fi
fi
ok "Git $(git --version | cut -d' ' -f3)"

# ═══════════════════════════════════════════════════════════════════════════════
#  PHASE 2: Repository
# ═══════════════════════════════════════════════════════════════════════════════
step "2/8  Repository"

if [ -d "$INSTALL_DIR/.git" ]; then
  cd "$INSTALL_DIR"
  git pull --ff-only
  ok "Repo aktualisiert ($INSTALL_DIR)"
else
  sudo mkdir -p "$INSTALL_DIR"
  sudo chown "$(whoami)" "$INSTALL_DIR"
  git clone "$REPO_URL" "$INSTALL_DIR"
  ok "Repo gecloned nach $INSTALL_DIR"
fi
cd "$INSTALL_DIR"

# ── .env Basis erstellen ────────────────────────────────────────────────────
if [ ! -f "$INSTALL_DIR/.env" ]; then
  cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  PHASE 3: Build
# ═══════════════════════════════════════════════════════════════════════════════
step "3/8  Build"

npm install --omit=dev 2>&1 | tail -1
ok "npm install"

npm run build 2>&1 | tail -1
ok "TypeScript kompiliert"

npm link 2>/dev/null && ok "CLI global verlinkt" || true

# ═══════════════════════════════════════════════════════════════════════════════
#  PHASE 4: Telegram Bot Token
# ═══════════════════════════════════════════════════════════════════════════════
step "4/8  Telegram Bot"

CURRENT_TOKEN="$(env_get BOT_TOKEN)"
if [ -n "$CURRENT_TOKEN" ]; then
  # Token vorhanden — validieren
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://api.telegram.org/bot${CURRENT_TOKEN}/getMe")
  if [ "$HTTP_CODE" = "200" ]; then
    BOT_NAME=$(curl -s "https://api.telegram.org/bot${CURRENT_TOKEN}/getMe" | grep -oP '"first_name"\s*:\s*"\K[^"]+')
    ok "Bot Token gueltig — @${BOT_NAME}"
  else
    warn "Gespeicherter Token ungueltig (HTTP $HTTP_CODE)"
    CURRENT_TOKEN=""
  fi
fi

if [ -z "$CURRENT_TOKEN" ]; then
  while true; do
    echo -e "  Token von ${CYAN}@BotFather${NC} in Telegram holen."
    read -p "  Bot Token: " BOT_TOKEN_INPUT
    BOT_TOKEN_INPUT=$(echo "$BOT_TOKEN_INPUT" | xargs)  # trim

    if [ -z "$BOT_TOKEN_INPUT" ]; then
      warn "Token darf nicht leer sein."
      continue
    fi

    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://api.telegram.org/bot${BOT_TOKEN_INPUT}/getMe")
    if [ "$HTTP_CODE" = "200" ]; then
      BOT_NAME=$(curl -s "https://api.telegram.org/bot${BOT_TOKEN_INPUT}/getMe" | grep -oP '"first_name"\s*:\s*"\K[^"]+')
      env_set "BOT_TOKEN" "$BOT_TOKEN_INPUT"
      ok "Bot Token gespeichert — @${BOT_NAME}"
      break
    else
      warn "Token ungueltig (HTTP $HTTP_CODE). Nochmal versuchen."
    fi
  done
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  PHASE 5: LLM / Ollama
# ═══════════════════════════════════════════════════════════════════════════════
step "5/8  LLM Konfiguration"

CURRENT_URL="$(env_get OLLAMA_BASE_URL)"
if [ -z "$CURRENT_URL" ]; then
  CURRENT_URL="https://api.ollama.com/v1"
fi

echo -e "  LLM API Optionen:"
echo -e "    ${CYAN}1${NC}) Ollama Cloud  (api.ollama.com — empfohlen)"
echo -e "    ${CYAN}2${NC}) Lokales Ollama (localhost:11434)"
echo -e "    ${CYAN}3${NC}) Andere URL     (OpenAI, OpenRouter, etc.)"
echo ""
read -p "  Auswahl [1]: " LLM_CHOICE
LLM_CHOICE=${LLM_CHOICE:-1}

case $LLM_CHOICE in
  1)
    env_set "OLLAMA_BASE_URL" "https://api.ollama.com/v1"
    ok "Ollama Cloud konfiguriert"

    CURRENT_KEY="$(env_get OLLAMA_API_KEY)"
    if [ -z "$CURRENT_KEY" ]; then
      echo -e "\n  API Key wird benoetigt."
      echo -e "  Holen auf ${CYAN}ollama.com/settings/keys${NC} oder via ${CYAN}ollama signin${NC}"
      read -p "  API Key: " API_KEY_INPUT
      if [ -n "$API_KEY_INPUT" ]; then
        env_set "OLLAMA_API_KEY" "$API_KEY_INPUT"
        ok "API Key gespeichert"
      fi
    else
      ok "API Key vorhanden"
    fi
    ;;
  2)
    env_set "OLLAMA_BASE_URL" "http://localhost:11434/v1"
    env_set "OLLAMA_API_KEY" "ollama"
    ok "Lokales Ollama konfiguriert"

    if ! command -v ollama &>/dev/null; then
      echo -e "  > Ollama wird installiert..."
      curl -fsSL https://ollama.com/install.sh | sh
      ok "Ollama installiert"
    else
      ok "Ollama bereits installiert ($(ollama --version 2>/dev/null || echo 'ok'))"
    fi
    ;;
  3)
    read -p "  API URL: " CUSTOM_URL
    env_set "OLLAMA_BASE_URL" "$CUSTOM_URL"
    read -p "  API Key: " CUSTOM_KEY
    [ -n "$CUSTOM_KEY" ] && env_set "OLLAMA_API_KEY" "$CUSTOM_KEY"
    ok "Custom LLM konfiguriert"
    ;;
esac

# Modell
CURRENT_MODEL="$(env_get OLLAMA_MODEL)"
if [ -z "$CURRENT_MODEL" ]; then
  CURRENT_MODEL="kimi-k2.5:cloud"
fi
echo ""
read -p "  LLM Modell [$CURRENT_MODEL]: " MODEL_INPUT
MODEL_INPUT=${MODEL_INPUT:-$CURRENT_MODEL}
env_set "OLLAMA_MODEL" "$MODEL_INPUT"
ok "Modell: $MODEL_INPUT"

# ═══════════════════════════════════════════════════════════════════════════════
#  PHASE 6: Obsidian Vault (OneDrive / lokal)
# ═══════════════════════════════════════════════════════════════════════════════
step "6/8  Obsidian Vault"

CURRENT_VAULT="$(env_get WORKSPACE_PATH)"

echo -e "  Wo liegt dein Obsidian Vault?"
echo -e "    ${CYAN}1${NC}) OneDrive  (via rclone — fuer VPS empfohlen)"
echo -e "    ${CYAN}2${NC}) Lokaler Pfad"
if [ -n "$CURRENT_VAULT" ] && [ "$CURRENT_VAULT" != "/vault" ] && [ -d "$CURRENT_VAULT" ]; then
  echo -e "    ${CYAN}3${NC}) Bestehend beibehalten: $CURRENT_VAULT"
fi
echo ""
read -p "  Auswahl [1]: " VAULT_CHOICE
VAULT_CHOICE=${VAULT_CHOICE:-1}

case $VAULT_CHOICE in
  1)
    # ── rclone installieren ─────────────────────────────────────────────────
    if ! command -v rclone &>/dev/null; then
      echo -e "  > rclone wird installiert..."
      curl -fsSL https://rclone.org/install.sh | sudo bash
      ok "rclone installiert"
    else
      ok "rclone $(rclone --version 2>/dev/null | head -1 | awk '{print $2}')"
    fi

    # FUSE pruefen
    if [[ "$(uname)" == "Linux" ]]; then
      if ! command -v fusermount &>/dev/null && ! command -v fusermount3 &>/dev/null; then
        echo -e "  > FUSE wird installiert..."
        sudo apt-get install -y fuse3 2>/dev/null || sudo apt-get install -y fuse 2>/dev/null || true
      fi
    fi

    # ── rclone Remote pruefen/erstellen ─────────────────────────────────────
    if rclone listremotes 2>/dev/null | grep -q "onedrive:"; then
      ok "rclone Remote 'onedrive' vorhanden"
    else
      echo -e "\n  ${BOLD}OneDrive Authentifizierung:${NC}"
      echo -e "  Da der VPS keinen Browser hat, brauchst du ein Token von deinem PC.\n"
      echo -e "  ${CYAN}Auf deinem PC/Mac ausfuehren:${NC}"
      echo -e "    1. rclone installieren: ${CYAN}https://rclone.org/install/${NC}"
      echo -e "    2. ${CYAN}rclone authorize \"onedrive\"${NC}"
      echo -e "    3. Im Browser anmelden"
      echo -e "    4. Token wird angezeigt — hierher kopieren\n"
      read -p "  Token (beginnt mit {\"access_token\"...): " RCLONE_TOKEN

      if [ -z "$RCLONE_TOKEN" ]; then
        warn "Kein Token angegeben — OneDrive wird uebersprungen."
        warn "Spaeter einrichten: rclone config"
        read -p "  Lokaler Vault-Pfad stattdessen: " LOCAL_PATH
        env_set "WORKSPACE_PATH" "$LOCAL_PATH"
        ok "Vault: $LOCAL_PATH"
      else
        # rclone config erstellen
        RCLONE_CONF="${HOME}/.config/rclone/rclone.conf"
        mkdir -p "$(dirname "$RCLONE_CONF")"

        # Drive ID abfragen
        echo -e "\n  OneDrive Drive-ID ermitteln..."
        echo -e "  (Enter fuer Standard-OneDrive Personal)"
        read -p "  Drive-ID (oder Enter): " DRIVE_ID

        cat >> "$RCLONE_CONF" <<RCONF
[onedrive]
type = onedrive
token = ${RCLONE_TOKEN}
drive_type = personal
RCONF
        if [ -n "$DRIVE_ID" ]; then
          echo "drive_id = ${DRIVE_ID}" >> "$RCLONE_CONF"
        fi

        ok "rclone Remote 'onedrive' erstellt"

        # Remote testen
        echo -e "  > Verbindung testen..."
        if rclone lsd onedrive: --max-depth 1 &>/dev/null; then
          ok "OneDrive Verbindung erfolgreich"
        else
          warn "OneDrive Verbindung fehlgeschlagen — spaeter pruefen: rclone lsd onedrive:"
        fi
      fi
    fi

    # ── Vault-Pfad auf OneDrive finden ──────────────────────────────────────
    if rclone listremotes 2>/dev/null | grep -q "onedrive:"; then
      echo -e "\n  Verfuegbare Ordner auf OneDrive:"
      rclone lsd onedrive: --max-depth 1 2>/dev/null | awk '{print "    " $NF}' | head -20
      echo ""
      read -p "  Pfad zum Vault auf OneDrive (z.B. Obsidian/MeinVault): " OD_VAULT_PATH
      OD_VAULT_PATH=$(echo "$OD_VAULT_PATH" | sed 's|^/||;s|/$||')  # trim slashes

      # Mount einrichten
      sudo mkdir -p "$MOUNT_DIR"
      sudo chown "$(whoami)" "$MOUNT_DIR"
      env_set "WORKSPACE_PATH" "${MOUNT_DIR}/${OD_VAULT_PATH}"

      # systemd Mount Service
      if [[ "$(uname)" == "Linux" ]] && command -v systemctl &>/dev/null; then
        MOUNT_SERVICE="/etc/systemd/system/rclone-onedrive.service"
        sudo tee "$MOUNT_SERVICE" > /dev/null <<MEOF
[Unit]
Description=rclone OneDrive FUSE mount
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
ExecStart=$(which rclone) mount onedrive: ${MOUNT_DIR} --vfs-cache-mode full --vfs-cache-max-age 1h --allow-other
ExecStop=/bin/fusermount -uz ${MOUNT_DIR}
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
MEOF
        sudo systemctl daemon-reload
        sudo systemctl enable rclone-onedrive
        sudo systemctl start rclone-onedrive
        sleep 2
        if mountpoint -q "$MOUNT_DIR" 2>/dev/null; then
          ok "OneDrive gemountet: $MOUNT_DIR"
        else
          warn "Mount noch nicht bereit — pruefe: systemctl status rclone-onedrive"
        fi
      else
        # Manueller Mount
        rclone mount onedrive: "$MOUNT_DIR" --vfs-cache-mode full --daemon
        ok "OneDrive gemountet: $MOUNT_DIR (daemon)"
      fi

      ok "Vault: ${MOUNT_DIR}/${OD_VAULT_PATH}"
    fi
    ;;

  2)
    read -p "  Pfad zum Obsidian Vault: " LOCAL_PATH
    LOCAL_PATH=$(echo "$LOCAL_PATH" | sed 's|/$||')  # trim trailing slash
    if [ ! -d "$LOCAL_PATH" ]; then
      warn "Pfad existiert nicht — wird erstellt..."
      mkdir -p "$LOCAL_PATH"
    fi
    env_set "WORKSPACE_PATH" "$LOCAL_PATH"
    ok "Vault: $LOCAL_PATH"
    ;;

  3)
    ok "Vault beibehalten: $CURRENT_VAULT"
    ;;
esac

# ═══════════════════════════════════════════════════════════════════════════════
#  PHASE 7: Sicherheit
# ═══════════════════════════════════════════════════════════════════════════════
step "7/8  Sicherheit"

CURRENT_CHAT_ID="$(env_get ALLOWED_CHAT_ID)"
if [ -z "$CURRENT_CHAT_ID" ]; then
  echo -e "  Chat-ID beschraenkt wer den Bot nutzen darf."
  echo -e "  ${CYAN}Tipp:${NC} Starte den Bot, schreib /start, dann /whoami — dort steht die Chat-ID."
  read -p "  ALLOWED_CHAT_ID (oder Enter um spaeter zu setzen): " CHAT_ID_INPUT
  if [ -n "$CHAT_ID_INPUT" ]; then
    env_set "ALLOWED_CHAT_ID" "$CHAT_ID_INPUT"
    ok "Chat-ID gesetzt: $CHAT_ID_INPUT"
  else
    warn "Keine Chat-ID — Bot ist fuer alle offen! Spaeter in .env setzen."
  fi
else
  ok "Chat-ID: $CURRENT_CHAT_ID"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  PHASE 8: systemd Service + Start
# ═══════════════════════════════════════════════════════════════════════════════
step "8/8  Service starten"

if [[ "$(uname)" == "Linux" ]] && command -v systemctl &>/dev/null; then
  SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
  sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=$BRAND — Obsidian Vault Assistant via Telegram
After=network-online.target rclone-onedrive.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStart=$(which node) $INSTALL_DIR/dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
EnvironmentFile=$INSTALL_DIR/.env

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable "$SERVICE_NAME"
  sudo systemctl restart "$SERVICE_NAME"
  ok "Service gestartet"

  sleep 2
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    ok "$BRAND laeuft!"
  else
    warn "Service gestartet aber moeglicherweise noch nicht bereit"
    echo -e "     Logs:  ${CYAN}journalctl -u $SERVICE_NAME -f${NC}"
  fi
else
  ok "Kein systemd — manuell starten: cd $INSTALL_DIR && npm start"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  Zusammenfassung
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}${GREEN}  ╔══════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}  ║       Installation abgeschlossen!    ║${NC}"
echo -e "${BOLD}${GREEN}  ╚══════════════════════════════════════╝${NC}\n"

echo -e "  ${BOLD}Konfiguration:${NC}"
echo -e "    Verzeichnis:  ${CYAN}$INSTALL_DIR${NC}"
echo -e "    Vault:        ${CYAN}$(env_get WORKSPACE_PATH)${NC}"
echo -e "    LLM:          ${CYAN}$(env_get OLLAMA_BASE_URL)${NC}"
echo -e "    Modell:       ${CYAN}$(env_get OLLAMA_MODEL)${NC}"
echo -e ""
echo -e "  ${BOLD}Befehle:${NC}"
echo -e "    Status:   ${CYAN}sudo systemctl status $SERVICE_NAME${NC}"
echo -e "    Logs:     ${CYAN}journalctl -u $SERVICE_NAME -f${NC}"
echo -e "    Restart:  ${CYAN}sudo systemctl restart $SERVICE_NAME${NC}"
echo -e "    Config:   ${CYAN}nano $INSTALL_DIR/.env${NC}"
echo -e ""
echo -e "  ${BOLD}Jetzt Telegram oeffnen und dem Bot schreiben!${NC}\n"
