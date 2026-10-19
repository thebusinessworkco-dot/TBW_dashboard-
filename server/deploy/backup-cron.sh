#!/usr/bin/env bash
# ============================================================
# The Business Work — Automated SQLite Backup Script
# Run daily via cron: 0 3 * * * /var/www/tbw-api/deploy/backup-cron.sh
# ============================================================

set -euo pipefail

APP_DIR="/var/www/tbw-api"
BACKUP_DIR="/var/backups/thebusinesswork"
DATE_TAG=$(date +"%Y-%m-%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/tbw_backup_${DATE_TAG}.db"

mkdir -p "${BACKUP_DIR}"

echo "[$(date -u)] Starting automated backup..."

# Trigger online non-blocking backup
cd "${APP_DIR}"
NODE_ENV=production node src/db/backup.js

# Keep only the last 30 daily backups
find "${BACKUP_DIR}" -name "tbw_backup_*.db" -type f -mtime +30 -delete

echo "[$(date -u)] Backup completed and older backups pruned."
