#!/bin/bash

if [ $# -eq 0 ]; then
    echo "Usage: $0 <backup_file>"
    echo "Available backups:"
    ls -la database/backups/
    exit 1
fi

CONTAINER_NAME="cow-postgres-local"  # Change to cow-postgres-prod for production
DB_NAME="cow_db"
DB_USER="cow_user"
BACKUP_FILE=$1

# Check if backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
    echo "Error: Backup file '$BACKUP_FILE' not found!"
    exit 1
fi

echo "Restoring database from: $BACKUP_FILE"
echo "WARNING: This will overwrite all existing data in the database!"
read -p "Are you sure you want to continue? (y/N): " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
    # Drop and recreate database to ensure clean restore
    echo "Dropping and recreating database..."
    docker exec $CONTAINER_NAME psql -U $DB_USER -d postgres -c "DROP DATABASE IF EXISTS $DB_NAME;"
    docker exec $CONTAINER_NAME psql -U $DB_USER -d postgres -c "CREATE DATABASE $DB_NAME;"
    
    # Restore database
    echo "Restoring data..."
    docker exec -i $CONTAINER_NAME psql -U $DB_USER -d $DB_NAME < $BACKUP_FILE
    
    if [ $? -eq 0 ]; then
        echo "Database restored successfully from: $BACKUP_FILE"
    else
        echo "Restore failed!"
        exit 1
    fi
else
    echo "Restore cancelled."
fi
