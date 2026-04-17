#!/bin/bash
set -e

# ── LLM-Provider erkennen ─────────────────────────────────────────────────────
# Prioritaet: API-Key > Base-URL. Wenn OPENROUTER_API_KEY oder ein
# LLM_API_KEY != "ollama" gesetzt ist, IMMER remote — auch wenn ein
# veralteter LLM_BASE_URL=localhost in .env steht (Resthass aus Ollama-
# Konfig, der frueher zu ungewolltem Ollama-Start gefuehrt hat).
NEED_OLLAMA=true

if [ -n "${OPENROUTER_API_KEY:-}" ]; then
  NEED_OLLAMA=false
elif [ -n "${LLM_API_KEY:-}" ] && [ "${LLM_API_KEY}" != "ollama" ]; then
  NEED_OLLAMA=false
elif [ -n "${LLM_BASE_URL:-}" ]; then
  # Nur wenn KEIN Key gesetzt: Base-URL entscheidet.
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
  chmod 700 /root/.config/rclone

  # Config ueber Umgebungs-Referenzen erstellen statt Token zu interpolieren.
  # Rclone unterstuetzt $VAR im config-file; $RCLONE_CONFIG_ONEDRIVE_TOKEN
  # wird zur Laufzeit gelesen und vermeidet Shell-Expansion ($, backtick).
  # Drive-Typ: User-env hat Prioritaet, Detection nur als Fallback.
  DRIVE_ID="${ONEDRIVE_DRIVE_ID:-}"
  DRIVE_TYPE="${ONEDRIVE_DRIVE_TYPE:-}"

  # Minimale Config fuer den Drive-Detection-Call
  # Single-quoted heredoc (\'EOF\') verhindert $-Expansion im Token.
  cat > /root/.config/rclone/rclone.conf <<'EOF'
[onedrive]
type = onedrive
EOF
  # Token via Env-Ref statt Interpolation (rclone liest RCLONE_CONFIG_*)
  # Aber rclone unterstuetzt keine env-refs IM config-file — wir muessen
  # schreiben. Loesung: token VIA ENV exportieren, config-file referenziert
  # nicht direkt.
  # Pragmatisch: Token schreiben mit single-quote heredoc, damit $ im
  # Token-String NICHT expandiert wird.
  {
    echo "token = $RCLONE_TOKEN"
  } >> /root/.config/rclone/rclone.conf

  if [ -z "$DRIVE_ID" ] || [ -z "$DRIVE_TYPE" ]; then
    echo "[entrypoint] Drive-ID/Typ wird erkannt..."
    DRIVES_JSON=$(rclone backend drives onedrive: 2>/dev/null || true)
    if [ -n "$DRIVES_JSON" ]; then
      [ -z "$DRIVE_ID" ] && DRIVE_ID=$(echo "$DRIVES_JSON" | grep -oP '"id"\s*:\s*"\K[^"]+' | head -1)
      [ -z "$DRIVE_TYPE" ] && DRIVE_TYPE=$(echo "$DRIVES_JSON" | grep -oP '"driveType"\s*:\s*"\K[^"]+' | head -1)
      echo "[entrypoint] Drive-ID: ${DRIVE_ID:0:20}..., Typ: $DRIVE_TYPE"
    fi
  fi

  # Fallback-Default fuer Drive-Typ falls Detection nichts lieferte
  DRIVE_TYPE="${DRIVE_TYPE:-personal}"

  # Finale Config schreiben
  {
    echo "[onedrive]"
    echo "type = onedrive"
    echo "token = $RCLONE_TOKEN"
    echo "drive_type = $DRIVE_TYPE"
    [ -n "$DRIVE_ID" ] && echo "drive_id = $DRIVE_ID"
  } > /root/.config/rclone/rclone.conf
  chmod 600 /root/.config/rclone/rclone.conf

  # Mount — Stderr in Log-Datei, damit wir bei Fail debuggen koennen
  VAULT_SUBPATH="${ONEDRIVE_VAULT_PATH:-}"
  echo "[entrypoint] Mounte onedrive:${VAULT_SUBPATH} -> /vault"
  RCLONE_LOG=/tmp/rclone-mount.log
  rclone mount "onedrive:${VAULT_SUBPATH}" /vault \
    --vfs-cache-mode full \
    --vfs-cache-max-age 1h \
    --cache-dir /tmp/rclone \
    --log-file "$RCLONE_LOG" \
    --log-level INFO \
    --daemon

  # Mount-Wait: 30s statt 15s (OneDrive OAuth + erster List-Call dauern)
  MOUNT_OK=0
  for i in $(seq 1 30); do
    if mountpoint -q /vault 2>/dev/null; then
      echo "[entrypoint] OneDrive gemountet (nach ${i}s)"
      MOUNT_OK=1
      break
    fi
    sleep 1
  done

  if [ "$MOUNT_OK" = "0" ]; then
    echo "[entrypoint] FEHLER: RCLONE_TOKEN gesetzt, aber /vault konnte nach 30s nicht gemountet werden."
    echo "[entrypoint]         Rclone-Log:"
    tail -n 40 "$RCLONE_LOG" 2>/dev/null | sed 's/^/[rclone] /' || true
    echo "[entrypoint]         Haeufige Ursachen: Token abgelaufen, ONEDRIVE_DRIVE_TYPE falsch, ONEDRIVE_VAULT_PATH zeigt auf nicht-existenten Ordner."
    echo "[entrypoint]         Bot startet NICHT (verhindert Schreiben ins Container-FS statt OneDrive)."
    exit 1
  fi
fi

# ── Vault-Integritaet: Warnung wenn /vault nicht gemountet ──────────────────
# Wenn RCLONE_TOKEN leer ist aber WORKSPACE_PATH=/vault, schreibt der Bot
# Notizen ins fluechtige Container-FS. Das wollen wir sichtbar machen, aber
# nicht erzwingen — User will evtl. erst ohne OneDrive testen.
if [ "${WORKSPACE_PATH:-}" = "/vault" ] && ! mountpoint -q /vault 2>/dev/null; then
  echo "[entrypoint] ============================================================"
  echo "[entrypoint]  WARNUNG: /vault ist KEIN Mount — OneDrive ist nicht aktiv."
  echo "[entrypoint]  Notizen landen im fluechtigen Container-FS und verschwinden"
  echo "[entrypoint]  beim naechsten 'docker compose down'."
  echo "[entrypoint]  Fix: RCLONE_TOKEN in .env eintragen (siehe install.sh)."
  echo "[entrypoint] ============================================================"
fi

# ── System-Daten-Pfad sicherstellen (Agent-State, Logs) ────────────────────
mkdir -p "${SYSTEM_DATA_PATH:-/data}"

# ── Bot starten ──────────────────────────────────────────────────────────────
echo "[entrypoint] Bot wird gestartet..."
exec node dist/index.js
