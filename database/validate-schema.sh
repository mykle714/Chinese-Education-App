#!/bin/bash

# Database Schema Validation Script Wrapper
# This script runs the validation SQL script against the PPE database

echo "========================================"
echo "Database Schema Validation Tool"
echo "========================================"
echo ""
echo "This will check your PPE database schema"
echo "and report any missing tables, columns, or indexes."
echo ""

# Check if running in Docker context
if [ -f "docker-compose.ppe.yml" ]; then
    echo "✓ Found docker-compose.ppe.yml"
    echo ""
    echo "Running validation against PPE database..."
    echo ""
    
    # Run the validation SQL script
    docker exec -i cow-postgres psql -U cow_user -d cow_db < database/validate-schema.sql
    
    echo ""
    echo "========================================"
    echo "Validation complete!"
    echo ""
    echo "If you see missing tables, you can fix them by running:"
    echo "  ./database/fix-missing-tables.sh"
    echo "========================================"
else
    echo "❌ Error: docker-compose.ppe.yml not found"
    echo "Please run this script from the project root directory"
    exit 1
fi
