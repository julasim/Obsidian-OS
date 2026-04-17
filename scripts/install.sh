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
# env_set nutzt kein sed (bricht bei langen Werten mit /, &, etc.) sondern
# atomic file rewrite: alte Zeile raus, neue Zeile anhaengen.
env_set() {
  local key="$1" val="$2" file="$INSTALL_DIR/.env"
  local tmp="${file}.tmp"
  if [ -f "$file" ]; then
    grep -v "^${key}=" "$file" > "$tmp" || true
  else
    : > "$tmp"
  fi
  printf '%s=%s\n' "$key" "$val" >> "$tmp"
  mv "$tmp" "$file"
}
env_del() {
  local key="$1" file="$INSTALL_DIR/.env"
  [ -f "$file" ] || return 0
  local tmp="${file}.tmp"
  grep -v "^${key}=" "$file" > "$tmp" || true
  mv "$tmp" "$file"
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
#  4. LLM Provider
# ═══════════════════════════════════════════════════════════════════════════════
step "4/6  LLM Provider"

# Detect existing provider
LLM_PROVIDER="unknown"
EXISTING_OR_KEY="$(env_get OPENROUTER_API_KEY)"
EXISTING_LLM_KEY="$(env_get LLM_API_KEY)"
EXISTING_OLLAMA_URL="$(env_get OLLAMA_BASE_URL)"

if [ -n "$EXISTING_OR_KEY" ] || [ -n "$EXISTING_LLM_KEY" ]; then
  LLM_PROVIDER="remote"
elif [ -n "$EXISTING_OLLAMA_URL" ]; then
  LLM_PROVIDER="ollama"
fi

echo -e "  Welchen LLM-Provider moechtest du nutzen?\n"
echo -e "    ${CYAN}1)${NC} ${BOLD}OpenRouter${NC} (empfohlen) — ein Key, viele Modelle (Claude, GPT-4o, Gemini, Llama...)"
echo -e "       Pay-per-Use, kein Abo. Key holen: ${CYAN}https://openrouter.ai${NC}"
echo -e ""
echo -e "    ${CYAN}2)${NC} Ollama lokal — Open-Source-Modelle im Container (kein API-Key noetig)"
echo -e ""
echo -e "    ${CYAN}3)${NC} Anderer Provider — OpenAI, Together, Groq, etc. (OpenAI-kompatibel)"
echo -e ""

DEFAULT_CHOICE=1
[ "$LLM_PROVIDER" = "ollama" ] && DEFAULT_CHOICE=2

while true; do
  read -rp "  Auswahl [1/2/3] (default $DEFAULT_CHOICE): " PROVIDER_CHOICE
  PROVIDER_CHOICE="${PROVIDER_CHOICE:-$DEFAULT_CHOICE}"
  case "$PROVIDER_CHOICE" in
    1)
      # ── OpenRouter ──
      echo -e ""
      CURRENT_OR_KEY="${EXISTING_OR_KEY:-${EXISTING_LLM_KEY:-}}"
      if [ -n "$CURRENT_OR_KEY" ]; then
        ok "API-Key vorhanden (${#CURRENT_OR_KEY} Zeichen)"
        read -rp "  Neuen Key eingeben? (Enter = behalten): " NEW_KEY
        [ -n "$NEW_KEY" ] && CURRENT_OR_KEY="$NEW_KEY"
      else
        while true; do
          read -rp "  OpenRouter API-Key (sk-or-v1-...): " CURRENT_OR_KEY
          CURRENT_OR_KEY=$(echo "$CURRENT_OR_KEY" | xargs)
          [ -n "$CURRENT_OR_KEY" ] && break
          warn "Key darf nicht leer sein."
        done
      fi
      env_set "OPENROUTER_API_KEY" "$CURRENT_OR_KEY"
      # Ollama-spezifische Keys entfernen (leere Werte wuerden Fallback-Chain stoeren)
      env_del "OLLAMA_BASE_URL"
      env_del "OLLAMA_MODEL"
      env_del "LLM_API_KEY"
      ok "OpenRouter API-Key gespeichert"

      echo -e ""
      echo -e "  ${BOLD}Modelle (kostenlos — koennen jederzeit aus OpenRouter verschwinden):${NC}"
      echo -e "    ${CYAN}1)${NC} google/gemini-2.5-flash-preview:free    — Schnell, robustes Tool-Calling ${GREEN}(empfohlen)${NC}"
      echo -e "    ${CYAN}2)${NC} meta-llama/llama-3.3-70b-instruct:free  — Open-Source, stabil"
      echo -e "    ${CYAN}3)${NC} mistralai/mistral-small-3.1-24b-instruct:free — Klein, schnell"
      echo -e "    ${CYAN}4)${NC} nvidia/nemotron-3-super-120b-a12b:free  — 120B, ${YELLOW}Tool-Calling flakig${NC}"
      echo -e ""
      echo -e "  ${BOLD}Modelle (kostenpflichtig, Credits noetig — deutlich stabiler):${NC}"
      echo -e "    ${CYAN}5)${NC} anthropic/claude-sonnet-4               — Bestes Tool-Calling"
      echo -e "    ${CYAN}6)${NC} openai/gpt-4o                           — Solides Allround-Modell"
      echo -e "    ${CYAN}7)${NC} google/gemini-2.5-pro                   — Grosses Kontextfenster"
      echo -e "    ${CYAN}8)${NC} Eigene Eingabe"
      echo -e ""

      CURRENT_MODEL="$(env_get LLM_MODEL)"
      while true; do
        read -rp "  Auswahl [1-8] (default 1): " MODEL_CHOICE
        MODEL_CHOICE="${MODEL_CHOICE:-1}"
        case "$MODEL_CHOICE" in
          1) SELECTED_MODEL="google/gemini-2.5-flash-preview:free" ; break ;;
          2) SELECTED_MODEL="meta-llama/llama-3.3-70b-instruct:free" ; break ;;
          3) SELECTED_MODEL="mistralai/mistral-small-3.1-24b-instruct:free" ; break ;;
          4) SELECTED_MODEL="nvidia/nemotron-3-super-120b-a12b:free" ; break ;;
          5) SELECTED_MODEL="anthropic/claude-sonnet-4" ; break ;;
          6) SELECTED_MODEL="openai/gpt-4o" ; break ;;
          7) SELECTED_MODEL="google/gemini-2.5-pro" ; break ;;
          8) read -rp "  Modell-ID (provider/model): " SELECTED_MODEL
             if [ -n "$SELECTED_MODEL" ]; then break; fi
             warn "Modell-ID darf nicht leer sein." ;;
          *) warn "Ungueltig — 1 bis 8 waehlen." ;;
        esac
      done

      # Live-Check: hat das Modell ueberhaupt aktive Endpoints auf OpenRouter?
      # (Deckt ab: Modell wurde entfernt, Free-Tier deaktiviert, Typo.)
      echo -e "  > Pruefe Modell-Verfuegbarkeit..."
      MODEL_CHECK=$(curl -s -m 10 "https://openrouter.ai/api/v1/models/${SELECTED_MODEL}/endpoints" 2>/dev/null || echo "")
      if echo "$MODEL_CHECK" | grep -q '"No endpoints found"\|"error"'; then
        warn "OpenRouter liefert keine aktiven Endpoints fuer $SELECTED_MODEL"
        warn "Modell scheint entfernt/deaktiviert. Waehle ein anderes oder pruefe https://openrouter.ai/models"
        read -rp "  Trotzdem speichern? (y/N): " FORCE_SAVE
        if [[ ! "$FORCE_SAVE" =~ ^[yY]$ ]]; then
          continue 2>/dev/null || { warn "Bitte Script neu starten und anderes Modell waehlen."; exit 1; }
        fi
      elif [ -z "$MODEL_CHECK" ]; then
        warn "OpenRouter-Check nicht moeglich (Netzwerk?) — ueberspringe Validierung"
      else
        ok "Modell verfuegbar"
      fi

      env_set "LLM_MODEL" "$SELECTED_MODEL"
      ok "Modell: $SELECTED_MODEL"
      LLM_PROVIDER="remote"
      break
      ;;

    2)
      # ── Ollama lokal ──
      env_set "OLLAMA_BASE_URL" "http://localhost:11434/v1"
      env_set "LLM_API_KEY" "ollama"
      CURRENT_MODEL="$(env_get OLLAMA_MODEL)"
      CURRENT_MODEL=${CURRENT_MODEL:-qwen2.5:7b}
      read -rp "  Ollama-Modell [$CURRENT_MODEL]: " MODEL_INPUT
      env_set "LLM_MODEL" "${MODEL_INPUT:-$CURRENT_MODEL}"
      ok "Ollama lokal mit ${MODEL_INPUT:-$CURRENT_MODEL}"
      LLM_PROVIDER="ollama"
      break
      ;;

    3)
      # ── Anderer Provider ──
      echo -e ""
      read -rp "  API Base-URL (z.B. https://api.openai.com/v1): " CUSTOM_URL
      read -rp "  API-Key: " CUSTOM_KEY
      read -rp "  Modell (z.B. gpt-4o): " CUSTOM_MODEL
      env_set "LLM_BASE_URL" "$CUSTOM_URL"
      env_set "LLM_API_KEY" "$CUSTOM_KEY"
      env_set "LLM_MODEL" "${CUSTOM_MODEL:-gpt-4o}"
      ok "Provider: $CUSTOM_URL — Modell: ${CUSTOM_MODEL:-gpt-4o}"
      LLM_PROVIDER="remote"
      break
      ;;

    *) warn "Ungueltig — 1, 2 oder 3 waehlen" ;;
  esac
done

# ═══════════════════════════════════════════════════════════════════════════════
#  5. OneDrive / Vault
# ═══════════════════════════════════════════════════════════════════════════════
step "5/6  Obsidian Vault (OneDrive)"

CURRENT_RCLONE_TOKEN="$(env_get RCLONE_TOKEN)"

if [ -n "$CURRENT_RCLONE_TOKEN" ] && [ "${#CURRENT_RCLONE_TOKEN}" -gt 200 ]; then
  ok "OneDrive Token vorhanden (${#CURRENT_RCLONE_TOKEN} Zeichen)"
else
  echo -e "  Der Vault wird via OneDrive in den Container gemountet."
  echo -e ""
  echo -e "  ${BOLD}1. Token auf deinem PC erzeugen:${NC}"
  echo -e "     ${CYAN}rclone authorize \"onedrive\"${NC}  (rclone muss am PC installiert sein)"
  echo -e "     Im Browser anmelden — rclone zeigt einen JSON-Block ${CYAN}{...}${NC}"
  echo -e ""
  echo -e "  ${BOLD}2. Token bereitstellen${NC} — zwei Optionen:"
  echo -e "     ${CYAN}a)${NC} Komplettes JSON in eine Datei speichern, z.B. via"
  echo -e "        ${CYAN}cat > /tmp/rclone-token.json${NC} + Paste + ${CYAN}Ctrl+D${NC}"
  echo -e "        → dann hier den Pfad ${CYAN}/tmp/rclone-token.json${NC} eingeben"
  echo -e "     ${CYAN}b)${NC} Direkt einfuegen (nur zuverlaessig wenn <4000 Zeichen)"
  echo -e "     ${CYAN}c)${NC} Leer lassen — OneDrive bleibt deaktiviert, spaeter nachtragen"
  echo -e ""

  RCLONE_TOKEN_VALUE=""
  read -rp "  Pfad zu Token-Datei (oder leer fuer direkt-Paste/ueberspringen): " TOK_FILE
  if [ -n "$TOK_FILE" ]; then
    if [ -f "$TOK_FILE" ]; then
      # Whitespace + Newlines raus (robuster JSON)
      RCLONE_TOKEN_VALUE="$(tr -d '\r\n' < "$TOK_FILE" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    else
      warn "Datei nicht gefunden: $TOK_FILE"
    fi
  fi

  if [ -z "$RCLONE_TOKEN_VALUE" ]; then
    read -rp "  Token direkt einfuegen (JSON, leer = spaeter): " RCLONE_TOKEN_VALUE
  fi

  if [ -n "$RCLONE_TOKEN_VALUE" ] && [ "${#RCLONE_TOKEN_VALUE}" -gt 200 ]; then
    env_set "RCLONE_TOKEN" "$RCLONE_TOKEN_VALUE"
    ok "Token gespeichert (${#RCLONE_TOKEN_VALUE} Zeichen)"
    CURRENT_RCLONE_TOKEN="$RCLONE_TOKEN_VALUE"
  elif [ -n "$RCLONE_TOKEN_VALUE" ]; then
    warn "Token zu kurz (${#RCLONE_TOKEN_VALUE} Zeichen, erwartet >200) — ignoriert"
    echo -e "     Spaeter nachtragen: ${CYAN}nano $INSTALL_DIR/.env${NC}"
  else
    warn "Kein Token — OneDrive bleibt deaktiviert."
    echo -e "     Spaeter nachtragen: ${CYAN}nano $INSTALL_DIR/.env${NC} + ${CYAN}docker compose restart${NC}"
  fi

  # Drive-Typ + ID nur abfragen wenn Token da ist — sonst ist es unnoetig.
  if [ -n "$CURRENT_RCLONE_TOKEN" ] && [ "${#CURRENT_RCLONE_TOKEN}" -gt 200 ]; then
    echo -e ""
    echo -e "  ${BOLD}OneDrive-Typ:${NC}"
    echo -e "    ${CYAN}1)${NC} personal   — privates Microsoft-Konto (outlook.com, hotmail.com, live.com)"
    echo -e "    ${CYAN}2)${NC} business   — Geschaefts-/Uni-Konto (Microsoft 365, SharePoint)"
    echo -e "    ${CYAN}3)${NC} documentLibrary — SharePoint-Dokumentbibliothek"
    while true; do
      read -rp "  Auswahl [1/2/3] (default 2 = business): " DRIVE_TYPE_CHOICE
      DRIVE_TYPE_CHOICE="${DRIVE_TYPE_CHOICE:-2}"
      case "$DRIVE_TYPE_CHOICE" in
        1) env_set "ONEDRIVE_DRIVE_TYPE" "personal"; ok "Typ: personal"; break;;
        2) env_set "ONEDRIVE_DRIVE_TYPE" "business"; ok "Typ: business"; break;;
        3) env_set "ONEDRIVE_DRIVE_TYPE" "documentLibrary"; ok "Typ: documentLibrary"; break;;
        *) warn "Ungueltig — 1, 2 oder 3 waehlen";;
      esac
    done

    echo -e ""
    echo -e "  ${BOLD}Drive-ID${NC} (optional — wird sonst automatisch erkannt):"
    read -rp "  Drive-ID: " DRIVE_ID_INPUT
    if [ -n "$DRIVE_ID_INPUT" ]; then
      env_set "ONEDRIVE_DRIVE_ID" "$DRIVE_ID_INPUT"
      ok "Drive-ID gespeichert"
    fi
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
#  6. Container bauen + starten
# ═══════════════════════════════════════════════════════════════════════════════
step "6/6  Container starten"

cd "$INSTALL_DIR"

echo -e "  > Image wird gebaut (kann beim ersten Mal einige Minuten dauern)..."
docker compose build
ok "Image gebaut"

docker compose down 2>/dev/null || true
docker compose up -d
ok "Container gestartet"

# Ollama-spezifische Schritte nur wenn lokal
if [ "$LLM_PROVIDER" = "ollama" ]; then
  echo -e "\n  > Warte auf Ollama im Container..."
  for i in $(seq 1 20); do
    if docker compose exec -T bot curl -sf http://localhost:11434/api/version &>/dev/null; then
      ok "Ollama laeuft im Container"
      break
    fi
    sleep 2
  done

  # Ollama Cloud Signin (nur wenn Cloud-Modell)
  SELECTED_MODEL="$(env_get LLM_MODEL)"
  if [[ "$SELECTED_MODEL" == *":cloud"* ]]; then
    echo -e ""
    echo -e "  ${BOLD}Ollama Cloud Anmeldung:${NC}"
    echo -e "  Gleich erscheint ein Link — diesen im Browser oeffnen und anmelden.\n"
    docker compose exec bot ollama signin || warn "Signin fehlgeschlagen — spaeter: cd $INSTALL_DIR && docker compose exec bot ollama signin"
    echo -e ""
    read -rp "  Link im Browser geoeffnet und angemeldet? [Enter zum Fortfahren] "
    ok "Ollama Anmeldung abgeschlossen"
    docker compose restart
    sleep 3
  fi
else
  # Remote-Provider: kurz warten bis Container stabil laeuft
  sleep 3
fi

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

FINAL_MODEL="$(env_get LLM_MODEL)"
FINAL_PROVIDER="OpenRouter"
[ "$LLM_PROVIDER" = "ollama" ] && FINAL_PROVIDER="Ollama lokal"

echo -e "  ${BOLD}Konfiguration:${NC}"
echo -e "    Verzeichnis:  ${CYAN}$INSTALL_DIR${NC}"
echo -e "    LLM-Provider: ${CYAN}$FINAL_PROVIDER${NC}"
echo -e "    Modell:       ${CYAN}$FINAL_MODEL${NC}"
echo -e ""
echo -e "  ${BOLD}Befehle:${NC}"
echo -e "    Logs:     ${CYAN}cd $INSTALL_DIR && docker compose logs -f${NC}"
echo -e "    Restart:  ${CYAN}cd $INSTALL_DIR && docker compose restart${NC}"
echo -e "    Stop:     ${CYAN}cd $INSTALL_DIR && docker compose down${NC}"
echo -e "    Update:   ${CYAN}cd $INSTALL_DIR && git pull && docker compose up -d --build${NC}"
echo -e "    Config:   ${CYAN}nano $INSTALL_DIR/.env${NC}"
if [ "$LLM_PROVIDER" = "ollama" ]; then
  echo -e "    Signin:   ${CYAN}cd $INSTALL_DIR && docker compose exec bot ollama signin${NC}"
fi
echo -e ""
echo -e "  ${BOLD}Jetzt Telegram oeffnen und dem Bot schreiben!${NC}\n"
