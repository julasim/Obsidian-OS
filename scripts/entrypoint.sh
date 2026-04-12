#!/bin/bash
set -e

# ── OneDrive Mount (wenn RCLONE_TOKEN gesetzt) ──────────────────────────────
if [ -n "$RCLONE_TOKEN" ]; then
  echo "[entrypoint] OneDrive Mount wird eingerichtet..."

  mkdir -p /vault /root/.config/rclone

  # rclone Config aus Umgebungsvariablen erstellen
  cat > /root/.config/rclone/rclone.conf <<EOF
[onedrive]
type = onedrive
token = ${RCLONE_TOKEN}
drive_type = ${ONEDRIVE_DRIVE_TYPE:-personal}
EOF

  if [ -n "${ONEDRIVE_DRIVE_ID:-}" ]; then
    echo "drive_id = ${ONEDRIVE_DRIVE_ID}" >> /root/.config/rclone/rclone.conf
  fi

  # Mount — Vault-Unterordner auf /vault
  rclone mount "onedrive:${ONEDRIVE_VAULT_PATH:-}" /vault \
    --vfs-cache-mode full \
    --vfs-cache-max-age 1h \
    --cache-dir /tmp/rclone \
    --daemon

  # Warten bis Mount bereit ist
  for i in $(seq 1 15); do
    if mountpoint -q /vault 2>/dev/null; then
      echo "[entrypoint] OneDrive gemountet: /vault"
      break
    fi
    sleep 1
  done

  if ! mountpoint -q /vault 2>/dev/null; then
    echo "[entrypoint] WARNUNG: OneDrive Mount nicht bereit!"
  fi
fi

# ── Bot starten ──────────────────────────────────────────────────────────────
echo "[entrypoint] Bot wird gestartet..."
exec node dist/index.js
