#!/usr/bin/env bash
# ============================================================
# The Business Work — Emergency Rollback Script
# Usage: ./deploy/rollback.sh <path-to-target-backup.db>
# ============================================================

set -euo pipefail

if [ "$#" -ne 1 ]; then
    echo "Error: Missing backup file argument."
    echo "Usage: $0 /var/backups/thebusinesswork/tbw_backup_YYYY-MM-DD_HHMMSS.db"
    exit 1
fi

BACKUP_FILE="$1"
APP_DIR="/var/www/tbw-api"

if [ ! -f "${BACKUP_FILE}" ]; then
    echo "Error: Backup file ${BACKUP_FILE} not found."
    exit 1
fi

echo "=================================================="
echo " Starting Emergency Rollback for The Business Work"
echo " Target Backup: ${BACKUP_FILE}"
echo "=================================================="

# 1. Stop systemd service
echo "Step 1: Stopping tbw-api service..."
sudo systemctl stop tbw-api

# 2. Execute safe restore
echo "Step 2: Restoring SQLite database and verifying integrity..."
cd "${APP_DIR}"
node src/db/restore.js "${BACKUP_FILE}"

# 3. Restart systemd service
echo "Step 3: Restarting tbw-api service..."
sudo systemctl start tbw-api

# 4. Verify health
echo "Step 4: Checking service health endpoint..."
sleep 2
HEALTH_STATUS=$(curl -s http://localhost:3001/api/health | grep -o '"status":"ok"' || true)

if [ "${HEALTH_STATUS}" = '"status":"ok"' ]; then
    echo "✓ Rollback completed successfully. System is HEALTHY."
else
    echo "⚠ Warning: Health check did not return status ok. Check /var/log/tbw-api.log"
    exit 1
fi
