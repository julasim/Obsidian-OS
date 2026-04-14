#!/bin/bash
set -e

# ── OneDrive Mount (wenn RCLONE_TOKEN gesetzt) ──────────────────────────────
if [ -n "${RCLONE_TOKEN:-}" ]; then
  echo "[entrypoint] OneDrive wird konfiguriert..."

  mkdir -p /vault /root/.config/rclone

  # Schritt 1: Minimale Config mit Token erstellen
  cat > /root/.config/rclone/rclone.conf <<EOF
[onedrive]
type = onedrive
token = ${RCLONE_TOKEN}
EOF

  # Schritt 2: Drive-ID automatisch erkennen
  DRIVE_ID="${ONEDRIVE_DRIVE_ID:-}"
  DRIVE_TYPE="${ONEDRIVE_DRIVE_TYPE:-personal}"

  if [ -z "$DRIVE_ID" ]; then
    echo "[entrypoint] Drive-ID wird automatisch erkannt..."
    DRIVES_JSON=$(rclone backend drives onedrive: 2>/dev/null || true)

    if [ -n "$DRIVES_JSON" ]; then
      DRIVE_ID=$(echo "$DRIVES_JSON" | grep -oP '"id"\s*:\s*"\K[^"]+' | head -1)
      DRIVE_TYPE=$(echo "$DRIVES_JSON" | grep -oP '"driveType"\s*:\s*"\K[^"]+' | head -1)
      echo "[entrypoint] Drive-ID: ${DRIVE_ID:0:20}..."
      echo "[entrypoint] Drive-Type: $DRIVE_TYPE"
    else
      echo "[entrypoint] WARNUNG: Drive-ID konnte nicht erkannt werden"
    fi
  fi

  # Schritt 3: Vollstaendige Config schreiben
  cat > /root/.config/rclone/rclone.conf <<EOF
[onedrive]
type = onedrive
token = ${RCLONE_TOKEN}
drive_type = ${DRIVE_TYPE}
EOF

  if [ -n "$DRIVE_ID" ]; then
    echo "drive_id = ${DRIVE_ID}" >> /root/.config/rclone/rclone.conf
  fi

  # Schritt 4: Mount
  VAULT_SUBPATH="${ONEDRIVE_VAULT_PATH:-}"
  echo "[entrypoint] Mounte onedrive:${VAULT_SUBPATH} -> /vault"

  rclone mount "onedrive:${VAULT_SUBPATH}" /vault \
    --vfs-cache-mode full \
    --vfs-cache-max-age 1h \
    --cache-dir /tmp/rclone \
    --daemon 2>&1 || true

  # Warten bis Mount bereit
  for i in $(seq 1 15); do
    if mountpoint -q /vault 2>/dev/null; then
      echo "[entrypoint] OneDrive gemountet!"
      ls /vault/ 2>/dev/null | head -5
      break
    fi
    sleep 1
  done

  if ! mountpoint -q /vault 2>/dev/null; then
    echo "[entrypoint] WARNUNG: OneDrive Mount fehlgeschlagen — Bot startet ohne Vault"
  fi
fi

# ── Bot starten ──────────────────────────────────────────────────────────────
echo "[entrypoint] Bot wird gestartet..."
exec node dist/index.js
