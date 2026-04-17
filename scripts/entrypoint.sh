#!/bin/bash
set -e

# ── LLM-Provider erkennen ─────────────────────────────────────────────────────
# Ollama nur starten wenn kein Remote-API-Key gesetzt ist UND
# LLM_BASE_URL auf localhost zeigt (oder gar nicht gesetzt ist).
NEED_OLLAMA=true

if [ -n "${LLM_API_KEY:-}" ] || [ -n "${OPENROUTER_API_KEY:-}" ]; then
  # Expliziter API-Key gesetzt → remote Provider (OpenRouter/OpenAI/etc.)
  NEED_OLLAMA=false
fi

if [ -n "${LLM_BASE_URL:-}" ]; then
  case "${LLM_BASE_URL}" in
    *localhost*|*127.0.0.1*) NEED_OLLAMA=true ;;
    *) NEED_OLLAMA=false ;;
  esac
fi

# ── Ollama Server starten (nur wenn lokal benoetigt) ──────────────────────────
if [ "$NEED_OLLAMA" = true ]; then
  echo "[entrypoint] Ollama Server wird gestartet..."
  ollama serve &
  OLLAMA_PID=$!

  # Warten bis Ollama bereit ist
  for i in $(seq 1 15); do
    if curl -sf http://localhost:11434/api/version &>/dev/null; then
      echo "[entrypoint] Ollama laeuft"
      break
    fi
    sleep 1
  done
else
  echo "[entrypoint] Remote LLM-Provider — Ollama wird uebersprungen"
fi

# ── OneDrive Mount (wenn RCLONE_TOKEN gesetzt) ──────────────────────────────
if [ -n "${RCLONE_TOKEN:-}" ]; then
  echo "[entrypoint] OneDrive wird konfiguriert..."

  echo "[entrypoint] RCLONE_TOKEN Laenge: ${#RCLONE_TOKEN} Zeichen"

  mkdir -p /vault /root/.config/rclone

  # Minimale Config mit Token
  cat > /root/.config/rclone/rclone.conf <<EOF
[onedrive]
type = onedrive
token = ${RCLONE_TOKEN}
EOF

  # Drive-ID automatisch erkennen
  DRIVE_ID="${ONEDRIVE_DRIVE_ID:-}"
  DRIVE_TYPE="${ONEDRIVE_DRIVE_TYPE:-personal}"

  if [ -z "$DRIVE_ID" ]; then
    echo "[entrypoint] Drive-ID wird erkannt..."
    DRIVES_JSON=$(rclone backend drives onedrive: 2>/dev/null || true)
    if [ -n "$DRIVES_JSON" ]; then
      DRIVE_ID=$(echo "$DRIVES_JSON" | grep -oP '"id"\s*:\s*"\K[^"]+' | head -1)
      DRIVE_TYPE=$(echo "$DRIVES_JSON" | grep -oP '"driveType"\s*:\s*"\K[^"]+' | head -1)
      echo "[entrypoint] Drive-ID erkannt: ${DRIVE_ID:0:20}..."
    fi
  fi

  # Vollstaendige Config schreiben
  cat > /root/.config/rclone/rclone.conf <<EOF
[onedrive]
type = onedrive
token = ${RCLONE_TOKEN}
drive_type = ${DRIVE_TYPE}
EOF
  [ -n "$DRIVE_ID" ] && echo "drive_id = ${DRIVE_ID}" >> /root/.config/rclone/rclone.conf

  # Mount
  VAULT_SUBPATH="${ONEDRIVE_VAULT_PATH:-}"
  echo "[entrypoint] Mounte onedrive:${VAULT_SUBPATH} -> /vault"
  rclone mount "onedrive:${VAULT_SUBPATH}" /vault \
    --vfs-cache-mode full \
    --vfs-cache-max-age 1h \
    --cache-dir /tmp/rclone \
    --daemon 2>&1 || true

  for i in $(seq 1 15); do
    if mountpoint -q /vault 2>/dev/null; then
      echo "[entrypoint] OneDrive gemountet!"
      break
    fi
    sleep 1
  done

  if ! mountpoint -q /vault 2>/dev/null; then
    echo "[entrypoint] FEHLER: RCLONE_TOKEN gesetzt, aber /vault ist kein Mount."
    echo "[entrypoint]         Rclone-Log oben pruefen (Token abgelaufen? Drive-Typ falsch? ONEDRIVE_VAULT_PATH?)"
    echo "[entrypoint]         Bot startet NICHT (verhindert Schreiben ins Container-FS statt OneDrive)."
    exit 1
  fi
fi

# ── Vault-Integritaet pruefen ───────────────────────────────────────────────
# WORKSPACE_PATH=/vault ist der Docker-Default. Wenn nichts gemountet ist
# (RCLONE_TOKEN leer oder Mount fehlgeschlagen) wuerde der Bot Notizen ins
# Container-FS schreiben, die beim naechsten `docker compose down` verloren
# gehen. Besser: laut scheitern.
if [ "${WORKSPACE_PATH:-}" = "/vault" ] && ! mountpoint -q /vault 2>/dev/null; then
  echo "[entrypoint] FEHLER: WORKSPACE_PATH=/vault, aber kein OneDrive-Mount aktiv."
  echo "[entrypoint]         Ursache: RCLONE_TOKEN fehlt in .env (rclone authorize \"onedrive\" am PC + JSON in .env)."
  echo "[entrypoint]         Bot startet NICHT — sonst landen Notizen im fluechtigen Container-FS."
  echo "[entrypoint]         Override fuer dev: WORKSPACE_PATH in .env auf lokalen Pfad setzen."
  exit 1
fi

# ── System-Daten-Pfad sicherstellen (Agent-State, Logs) ────────────────────
mkdir -p "${SYSTEM_DATA_PATH:-/data}"

# ── Bot starten ──────────────────────────────────────────────────────────────
echo "[entrypoint] Bot wird gestartet..."
exec node dist/index.js
