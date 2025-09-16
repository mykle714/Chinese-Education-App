#!/bin/bash

# Configuration
CONTAINER_NAME="cow-postgres-local"  # Change to cow-postgres-prod for production
DB_NAME="cow_db"
DB_USER="cow_user"
BACKUP_DIR="./database/backups"
DATE=$(date +%Y%m%d_%H%M%S)

# Create backup directory if it doesn't exist
mkdir -p $BACKUP_DIR

# Create backup
echo "Creating backup..."
docker exec $CONTAINER_NAME pg_dump -U $DB_USER -d $DB_NAME > $BACKUP_DIR/cow_db_backup_$DATE.sql

if [ $? -eq 0 ]; then
    echo "Backup completed successfully: cow_db_backup_$DATE.sql"
    
    # Keep only last 7 days of backups
    find $BACKUP_DIR -name "cow_db_backup_*.sql" -mtime +7 -delete
    echo "Old backups cleaned up (kept last 7 days)"
else
    echo "Backup failed!"
    exit 1
fi
