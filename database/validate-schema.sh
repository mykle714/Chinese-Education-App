#!/bin/bash

# Database Schema Validation Script Wrapper
# This script runs the validation SQL script against the production database

echo "========================================"
echo "Database Schema Validation Tool"
echo "========================================"
echo ""
echo "This will check your production database schema"
echo "and report any missing tables, columns, or indexes."
echo ""

# Check if running in Docker context
if [ -f "docker-compose.prod.yml" ]; then
    echo "✓ Found docker-compose.prod.yml"
    echo ""
    echo "Running validation against production database..."
    echo ""
    
    # Run the validation SQL script
    docker exec -i cow-postgres-prod psql -U cow_user -d cow_db < database/validate-schema.sql
    
    echo ""
    echo "========================================"
    echo "Validation complete!"
    echo ""
    echo "If you see missing tables, you can fix them by running:"
    echo "  ./database/fix-missing-tables.sh"
    echo "========================================"
else
    echo "❌ Error: docker-compose.prod.yml not found"
    echo "Please run this script from the project root directory"
    exit 1
fi
