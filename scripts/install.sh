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

# Helper: Lange Zeile (z.B. OneDrive-Token mit 4000+ Zeichen) lesen.
# Linux canonical-mode TTY puffert Zeilen bei 4095 Zeichen und kappt alles
# danach. Das ist genau die Falle, die OneDrive-Token zerstoert.
# Loesung: stty -icanon (line-discipline aus) → Bytes fliessen direkt, kein
# Line-Buffer-Limit. Nach dem Read wird der Terminal-Zustand restored.
read_long_line() {
  local saved=""
  if [ -t 0 ]; then
    saved=$(stty -g 2>/dev/null || true)
    # -icanon: kein Line-Buffering (kein 4095-Limit)
    # min 1 time 0: read kehrt zurueck sobald >=1 Byte da ist
    stty -icanon min 1 time 0 2>/dev/null || true
  fi
  local line=""
  # IFS= und -r: keine Modifikationen, backslash wird nicht escaped
  IFS= read -r line || true
  if [ -n "$saved" ]; then
    stty "$saved" 2>/dev/null || true
  fi
  printf '%s' "$line"
}

# Helper: .env Wert lesen/setzen
# CR-Strip ist essentiell: wenn .env mit CRLF (Windows-Editor) vorliegt,
# liefert `cut -d= -f2-` einen String mit trailing \r. Der bricht dann
# curl-URLs, Vergleiche wie `[ "$X" = "ollama" ]` und env-Propagation.
env_get() { grep -E "^$1=" "$INSTALL_DIR/.env" 2>/dev/null | cut -d'=' -f2- | tr -d '\r' | sed 's/^"//;s/"$//' || true; }

# .env einmal normalisieren: CRLF -> LF (idempotent)
env_normalize() {
  [ -f "$INSTALL_DIR/.env" ] || return 0
  # Nur ausfuehren wenn CR tatsaechlich vorhanden (spart IO)
  if grep -q $'\r' "$INSTALL_DIR/.env" 2>/dev/null; then
    sed -i 's/\r$//' "$INSTALL_DIR/.env"
  fi
}

# env_set nutzt kein sed (bricht bei langen Werten mit /, &, etc.) sondern
# atomic file rewrite: alte Zeile raus, neue Zeile anhaengen.
# grep -F (fixed-string) statt -E: Key-Namen haben keine Regex-Bedeutung,
# aber Metacharacter im Key-Namen koennten sonst zum Problem werden.
env_set() {
  local key="$1" val="$2" file="$INSTALL_DIR/.env"
  local tmp="${file}.tmp"
  env_normalize
  if [ -f "$file" ]; then
    # awk: nur Zeilen beibehalten wo Field-1 nicht exakt $key ist.
    # Praeziser als `grep -v "^KEY="` bei Regex-Metacharactern im Key-Namen.
    awk -v k="$key" 'BEGIN{FS="="} $1!=k {print}' "$file" > "$tmp"
  else
    : > "$tmp"
  fi
  printf '%s=%s\n' "$key" "$val" >> "$tmp"
  mv "$tmp" "$file"
}
env_del() {
  local key="$1" file="$INSTALL_DIR/.env"
  [ -f "$file" ] || return 0
  env_normalize
  local tmp="${file}.tmp"
  awk -v k="$key" 'BEGIN{FS="="} $1!=k {print}' "$file" > "$tmp" 2>/dev/null || true
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

# Defensiv: CRLF raus falls Repo mit autocrlf oder via Windows-Editor editiert wurde
env_normalize

env_set "WORKSPACE_PATH" "/vault"

# ═══════════════════════════════════════════════════════════════════════════════
#  3. Telegram Bot Token
# ═══════════════════════════════════════════════════════════════════════════════
step "3/6  Telegram Bot"

# Bot-Token validieren ohne ihn in die curl-URL zu setzen.
# URL-Token ist in `ps auxf` sichtbar und kann in Proxy-Logs landen.
# Stattdessen: Token in Tempfile schreiben, via URL lesen.
# (Telegram Bot-API akzeptiert Token nur in der URL — aber wir koennen
#  den Prozess-Args verstecken, indem wir die URL aus einer Datei lesen
#  lassen via curl --url-query ist nicht passend; stattdessen curl `-K` config.)
validate_telegram_token() {
  local token="$1"
  local cfg
  cfg=$(mktemp)
  printf 'url = "https://api.telegram.org/bot%s/getMe"\n' "$token" > "$cfg"
  local http_code
  http_code=$(curl -sS -K "$cfg" -o /dev/null -w "%{http_code}" 2>/dev/null || echo "000")
  rm -f "$cfg"
  [ "$http_code" = "200" ]
}

get_bot_name() {
  local token="$1"
  local cfg
  cfg=$(mktemp)
  printf 'url = "https://api.telegram.org/bot%s/getMe"\n' "$token" > "$cfg"
  local name
  name=$(curl -sS -K "$cfg" 2>/dev/null | grep -oP '"first_name"\s*:\s*"\K[^"]+')
  rm -f "$cfg"
  echo "$name"
}

CURRENT_TOKEN="$(env_get BOT_TOKEN)"
if [ -n "$CURRENT_TOKEN" ]; then
  if validate_telegram_token "$CURRENT_TOKEN"; then
    BOT_NAME=$(get_bot_name "$CURRENT_TOKEN")
    ok "Bot Token gueltig — @${BOT_NAME}"
  else
    warn "Gespeicherter Token ungueltig (moeglicherweise durch CRLF/Whitespace beschaedigt)"
    CURRENT_TOKEN=""
  fi
fi

if [ -z "$CURRENT_TOKEN" ]; then
  while true; do
    echo -e "  Token von ${CYAN}@BotFather${NC} in Telegram holen."
    # -s: kein Echo (Secret), -r: kein Backslash-Escape
    read -rsp "  Bot Token (Eingabe wird versteckt): " BOT_TOKEN_INPUT
    echo  # Newline nach verstecktem Input
    BOT_TOKEN_INPUT=$(echo "$BOT_TOKEN_INPUT" | tr -d '\r\n' | xargs)
    [ -z "$BOT_TOKEN_INPUT" ] && { warn "Token darf nicht leer sein."; continue; }

    if validate_telegram_token "$BOT_TOKEN_INPUT"; then
      BOT_NAME=$(get_bot_name "$BOT_TOKEN_INPUT")
      env_set "BOT_TOKEN" "$BOT_TOKEN_INPUT"
      ok "Bot Token gespeichert — @${BOT_NAME}"
      break
    else
      warn "Token ungueltig. Nochmal."
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
        read -rsp "  Neuen Key eingeben? (Enter = behalten, versteckt): " NEW_KEY
        echo
        [ -n "$NEW_KEY" ] && CURRENT_OR_KEY="$NEW_KEY"
      else
        while true; do
          read -rsp "  OpenRouter API-Key (sk-or-v1-..., versteckt): " CURRENT_OR_KEY
          echo
          CURRENT_OR_KEY=$(echo "$CURRENT_OR_KEY" | tr -d '\r\n' | xargs)
          [ -n "$CURRENT_OR_KEY" ] && break
          warn "Key darf nicht leer sein."
        done
      fi
      env_set "OPENROUTER_API_KEY" "$CURRENT_OR_KEY"
      # Alte Ollama/Custom-Config komplett entfernen — sonst verwirrt die
      # Fallback-Chain in config.ts + der Entrypoint startet faelschlich Ollama.
      env_del "OLLAMA_BASE_URL"
      env_del "OLLAMA_MODEL"
      env_del "LLM_API_KEY"
      env_del "LLM_BASE_URL"
      ok "OpenRouter API-Key gespeichert"

      # ── Modell-Auswahl: live von OpenRouter, gefiltert auf Tool-Support ──
      # Statt hardcodierter Liste (wird stale) + ohne Tool-Support-Filter
      # (vorher wurde z.B. liquid/lfm-2.5-1.2b-instruct:free angeboten, das
      # Tool-Calling nicht unterstuetzt → Bot crasht sofort im Setup),
      # hole die API live und filtere nach `supported_parameters` enthält "tools".
      echo -e ""
      echo -e "  > Hole Tool-faehige :free-Modelle von OpenRouter..."
      MODELS_JSON=$(curl -s -m 15 -H "Authorization: Bearer $CURRENT_OR_KEY" \
        "https://openrouter.ai/api/v1/models" 2>/dev/null || echo "")

      FREE_MODELS=()
      if [ -n "$MODELS_JSON" ] && command -v python3 >/dev/null 2>&1; then
        # Python3 parse ist robust (handled nested arrays, quotes escapes etc.);
        # reiner grep kommt bei supported_parameters nicht durch.
        while IFS= read -r id; do
          [ -n "$id" ] && FREE_MODELS+=("$id")
        done < <(echo "$MODELS_JSON" | python3 -c '
import sys, json
try:
    data = json.load(sys.stdin).get("data", [])
except Exception:
    sys.exit(0)
for m in data:
    mid = m.get("id", "")
    if not mid.endswith(":free"):
        continue
    params = m.get("supported_parameters") or []
    if "tools" in params:
        print(mid)
' 2>/dev/null | sort -u)
      elif [ -n "$MODELS_JSON" ]; then
        # Kein python3 → grep-Fallback (kann Tool-Support nicht pruefen)
        warn "python3 fehlt — kann Tool-Support nicht pruefen, zeige alle :free"
        while IFS= read -r id; do
          [ -n "$id" ] && FREE_MODELS+=("$id")
        done < <(echo "$MODELS_JSON" \
          | grep -oE '"id":"[^"]*:free"' \
          | sed 's/^"id":"//;s/"$//' \
          | sort -u)
      fi

      # Fallback wenn API nicht erreichbar war (diese Modelle hatten Tool-Support
      # Stand April 2026 — koennen sich aendern, daher nur als letzte Reserve)
      if [ ${#FREE_MODELS[@]} -eq 0 ]; then
        warn "OpenRouter /models nicht erreichbar oder leer — nutze minimale Fallback-Liste"
        FREE_MODELS=(
          "google/gemini-2.5-flash:free"
          "meta-llama/llama-3.3-70b-instruct:free"
          "mistralai/mistral-small-3.1-24b-instruct:free"
        )
      else
        ok "${#FREE_MODELS[@]} Tool-faehige :free-Modelle gefunden"
      fi

      # Paid-Modelle sind stabiler und bekannt — handkuratiert reicht
      PAID_MODELS=(
        "anthropic/claude-sonnet-4"
        "openai/gpt-4o"
        "google/gemini-2.5-pro"
      )

      echo -e ""
      echo -e "  ${BOLD}Kostenlos (live von OpenRouter):${NC}"
      for i in "${!FREE_MODELS[@]}"; do
        printf "    ${CYAN}%2d)${NC} %s\n" "$((i + 1))" "${FREE_MODELS[$i]}"
      done
      FREE_COUNT=${#FREE_MODELS[@]}
      PAID_START=$((FREE_COUNT + 1))
      echo -e ""
      echo -e "  ${BOLD}Kostenpflichtig (Credits noetig — stabiler, besseres Tool-Calling):${NC}"
      for i in "${!PAID_MODELS[@]}"; do
        printf "    ${CYAN}%2d)${NC} %s\n" "$((PAID_START + i))" "${PAID_MODELS[$i]}"
      done
      CUSTOM_IDX=$((PAID_START + ${#PAID_MODELS[@]}))
      printf "    ${CYAN}%2d)${NC} Eigene Modell-ID eingeben\n" "$CUSTOM_IDX"
      MAX_CHOICE=$CUSTOM_IDX
      echo -e ""

      # Modell-Auswahl + Live-Check (Endpoints existieren + Modell-ID valide)
      MODEL_SELECTED=0
      while [ "$MODEL_SELECTED" = "0" ]; do
        read -rp "  Auswahl [1-${MAX_CHOICE}] (default 1): " MODEL_CHOICE
        MODEL_CHOICE="${MODEL_CHOICE:-1}"

        if ! [[ "$MODEL_CHOICE" =~ ^[0-9]+$ ]]; then
          warn "Bitte eine Zahl eingeben."; continue
        fi

        if [ "$MODEL_CHOICE" -ge 1 ] && [ "$MODEL_CHOICE" -le "$FREE_COUNT" ]; then
          SELECTED_MODEL="${FREE_MODELS[$((MODEL_CHOICE - 1))]}"
        elif [ "$MODEL_CHOICE" -ge "$PAID_START" ] && [ "$MODEL_CHOICE" -lt "$CUSTOM_IDX" ]; then
          SELECTED_MODEL="${PAID_MODELS[$((MODEL_CHOICE - PAID_START))]}"
        elif [ "$MODEL_CHOICE" = "$CUSTOM_IDX" ]; then
          read -rp "  Modell-ID (provider/model): " SELECTED_MODEL
          [ -z "$SELECTED_MODEL" ] && { warn "Modell-ID darf nicht leer sein."; continue; }
        else
          warn "Ungueltig — 1 bis ${MAX_CHOICE} waehlen."; continue
        fi

        # Validierung mit HTTP-Code, nicht body-grep.
        # HTTP 400 → Modell-ID invalid (das war der bisher unerkannte Fall).
        # HTTP 404 → Modell existiert nicht.
        # HTTP 200 + empty endpoints → Modell hat aktuell keine Provider.
        # HTTP 200 + endpoints Array → verfuegbar.
        echo -e "  > Pruefe $SELECTED_MODEL ..."
        TMP_CHECK=$(mktemp)
        HTTP_CODE=$(curl -s -m 10 \
          -H "Authorization: Bearer $CURRENT_OR_KEY" \
          -o "$TMP_CHECK" -w "%{http_code}" \
          "https://openrouter.ai/api/v1/models/${SELECTED_MODEL}/endpoints" \
          2>/dev/null || echo "000")
        BODY="$(cat "$TMP_CHECK" 2>/dev/null || echo "")"
        rm -f "$TMP_CHECK"

        case "$HTTP_CODE" in
          200)
            if echo "$BODY" | grep -qE '"endpoints"\s*:\s*\[\s*\]'; then
              warn "Modell hat aktuell 0 Provider-Endpoints — bitte anderes waehlen."
            elif echo "$BODY" | grep -qE '"endpoints"\s*:\s*\['; then
              ok "Modell verfuegbar"
              MODEL_SELECTED=1
            else
              warn "Unerwarteter 200-Body — nutze Modell trotzdem"
              MODEL_SELECTED=1
            fi
            ;;
          400|404)
            warn "OpenRouter HTTP $HTTP_CODE: Modell-ID ungueltig oder entfernt."
            # Fehlermeldung auszugweise zeigen
            MSG=$(echo "$BODY" | grep -oE '"message":"[^"]*"' | head -1 | sed 's/^"message":"//;s/"$//')
            [ -n "$MSG" ] && echo "    → $MSG"
            ;;
          401|403)
            warn "OpenRouter HTTP $HTTP_CODE — API-Key ungueltig?"
            break 2  # raus aus model-loop + provider-loop; nutzer muss neu starten
            ;;
          000)
            warn "OpenRouter nicht erreichbar (Netzwerk?) — nutze Modell ohne Pruefung"
            MODEL_SELECTED=1
            ;;
          *)
            warn "OpenRouter HTTP $HTTP_CODE — unerwartet, nutze Modell trotzdem"
            MODEL_SELECTED=1
            ;;
        esac
      done

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
      read -rsp "  API-Key (versteckt): " CUSTOM_KEY
      echo
      read -rp "  Modell (z.B. gpt-4o): " CUSTOM_MODEL
      CUSTOM_KEY=$(echo "$CUSTOM_KEY" | tr -d '\r\n' | xargs)
      env_set "LLM_BASE_URL" "$CUSTOM_URL"
      env_set "LLM_API_KEY" "$CUSTOM_KEY"
      env_set "LLM_MODEL" "${CUSTOM_MODEL:-gpt-4o}"
      env_del "OPENROUTER_API_KEY"
      env_del "OLLAMA_BASE_URL"
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
  echo -e "  ${BOLD}2. Token einfuegen${NC} (JSON-Block mit Anfuehrungszeichen/Klammern):"
  echo -e "     Rechtsklick paste im Terminal, dann ${CYAN}Enter${NC}."
  echo -e "     Das 4095-Zeichen-Limit wird waehrend der Eingabe automatisch umgangen."
  echo -e ""
  echo -e "     Falls der Paste trotzdem zerhackt aussieht:"
  echo -e "       Alternative Datei-Methode in anderem Terminal:"
  echo -e "       ${CYAN}cat > /tmp/rclone-token.json${NC} + paste + ${CYAN}Ctrl+D${NC}"
  echo -e "       Dann hier eingeben: ${CYAN}file:/tmp/rclone-token.json${NC}"
  echo -e ""
  echo -e "     (Leer lassen = OneDrive jetzt skippen, spaeter via nano nachtragen)"
  echo -e ""

  RCLONE_TOKEN_VALUE=""
  echo -n "  Token: "
  RAW_INPUT="$(read_long_line)"

  if [ -z "$RAW_INPUT" ]; then
    RCLONE_TOKEN_VALUE=""
  elif [[ "$RAW_INPUT" == file:* ]]; then
    # Datei-Modus: "file:/pfad/token.json"
    TOK_FILE="${RAW_INPUT#file:}"
    if [ -f "$TOK_FILE" ]; then
      RCLONE_TOKEN_VALUE="$(tr -d '\r\n' < "$TOK_FILE" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    else
      warn "Datei nicht gefunden: $TOK_FILE"
    fi
  else
    # Direkter Paste — whitespace raus (read_long_line entfernt bereits
    # CR/LF am Ende; hier zur Sicherheit zusaetzlich trim)
    RCLONE_TOKEN_VALUE="$(printf '%s' "$RAW_INPUT" | tr -d '\r\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  fi

  # Exakt 4095 = altes Terminal-Limit. Mit stty-Trick sollte das nicht
  # mehr passieren, aber wenn doch (z.B. SSH-Client-Buffering), ablehnen.
  if [ -n "$RCLONE_TOKEN_VALUE" ] && [ "${#RCLONE_TOKEN_VALUE}" = "4095" ]; then
    warn "Token ist EXAKT 4095 Zeichen — verdaechtig (alter Terminal-Limit)."
    warn "Bitte ueber Datei-Methode erneut eingeben: ${CYAN}file:/tmp/rclone-token.json${NC}"
    RCLONE_TOKEN_VALUE=""
  fi

  if [ -n "$RCLONE_TOKEN_VALUE" ] && [ "${#RCLONE_TOKEN_VALUE}" -ge 2500 ]; then
    env_set "RCLONE_TOKEN" "$RCLONE_TOKEN_VALUE"
    ok "Token gespeichert (${#RCLONE_TOKEN_VALUE} Zeichen)"
    CURRENT_RCLONE_TOKEN="$RCLONE_TOKEN_VALUE"
  elif [ -n "$RCLONE_TOKEN_VALUE" ]; then
    warn "Token zu kurz (${#RCLONE_TOKEN_VALUE} Zeichen, erwartet >=2500) — vermutlich beschaedigt, ignoriert"
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
