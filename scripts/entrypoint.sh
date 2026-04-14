#!/bin/bash
set -e

# ── Ollama Server starten ───────────────────────────────────────────────────
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
    echo "[entrypoint] WARNUNG: OneDrive Mount fehlgeschlagen"
  fi
fi

# ── System-Daten-Pfad sicherstellen (Agent-State, Logs) ────────────────────
mkdir -p "${SYSTEM_DATA_PATH:-/data}"

# ── Bot starten ──────────────────────────────────────────────────────────────
echo "[entrypoint] Bot wird gestartet..."
exec node dist/index.js
