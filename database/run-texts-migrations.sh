#!/bin/bash

# Run texts table migrations in production
# This script creates the texts table and adds user-specific columns

echo "========================================"
echo "Texts Table Migration Runner"
echo "========================================"
echo ""

# Check if running in Docker context
if [ ! -f "docker-compose.prod.yml" ]; then
    echo "❌ Error: docker-compose.prod.yml not found"
    echo "Please run this script from the project root directory"
    exit 1
fi

echo "This will run the following migrations in order:"
echo "  1. Create texts table (clean, no sample data)"
echo "  2. Add userId and isUserCreated columns"
echo ""
read -p "Do you want to proceed? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Migration cancelled."
    exit 0
fi

echo ""
echo "========================================"
echo "Step 1: Creating texts table..."
echo "========================================"
docker exec -i cow-postgres-prod psql -U cow_user -d cow_db < database/migrations/06-create-texts-table-clean.sql

if [ $? -eq 0 ]; then
    echo "✅ texts table created successfully"
else
    echo "❌ Error creating texts table"
    exit 1
fi

echo ""
echo "========================================"
echo "Step 2: Adding userId and isUserCreated columns..."
echo "========================================"
docker exec -i cow-postgres-prod psql -U cow_user -d cow_db < database/migrations/08-add-userid-to-texts.sql

if [ $? -eq 0 ]; then
    echo "✅ User-specific columns added successfully"
else
    echo "❌ Error adding user columns"
    exit 1
fi

echo ""
echo "========================================"
echo "Step 3: Verifying texts table structure..."
echo "========================================"
docker exec -i cow-postgres-prod psql -U cow_user -d cow_db -c "\d texts"

echo ""
echo "========================================"
echo "Migration Complete!"
echo "========================================"
echo ""
echo "Next steps:"
echo "  1. Restart backend: docker-compose -f docker-compose.prod.yml restart backend"
echo "  2. Test the /api/texts endpoint"
echo "  3. Verify no sample texts appear in the UI"
echo ""
