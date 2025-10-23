#!/bin/bash

# Master Dictionary Import Script for Production Deployment
# This script handles the complete dictionary setup process:
# 1. Runs database migrations
# 2. Downloads all dictionary files
# 3. Imports all 4 language dictionaries (Chinese, Japanese, Korean, Vietnamese)
#
# Usage: bash server/scripts/import-all-dictionaries.sh [production|local]
# Default: local

set -e  # Exit on error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
MODE="${1:-local}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DATA_DIR="$PROJECT_ROOT/data/dictionaries"
MIGRATIONS_DIR="$PROJECT_ROOT/database/migrations"

# Docker container names based on mode
if [ "$MODE" = "production" ]; then
    POSTGRES_CONTAINER="cow-postgres-prod"
    BACKEND_CONTAINER="cow-backend-prod"
    echo -e "${BLUE}🚀 Running in PRODUCTION mode${NC}\n"
else
    POSTGRES_CONTAINER="cow-postgres-local"
    BACKEND_CONTAINER="cow-backend-local"
    echo -e "${BLUE}🔧 Running in LOCAL mode${NC}\n"
fi

# Function to print section headers
print_header() {
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
}

# Function to print success messages
print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

# Function to print error messages
print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Function to print warning messages
print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# Function to print info messages
print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Check if Docker containers are running
check_containers() {
    print_header "Checking Docker Containers"
    
    if ! docker ps | grep -q "$POSTGRES_CONTAINER"; then
        print_error "PostgreSQL container ($POSTGRES_CONTAINER) is not running!"
        print_info "Start it with: docker-compose up -d postgres"
        exit 1
    fi
    print_success "PostgreSQL container is running"
    
    if ! docker ps | grep -q "$BACKEND_CONTAINER"; then
        print_warning "Backend container ($BACKEND_CONTAINER) is not running"
        print_info "The backend container should be running for imports to work properly"
        print_info "Start it with: docker-compose up -d backend"
        exit 1
    fi
    print_success "Backend container is running"
}

# Run database migrations
run_migrations() {
    print_header "Running Database Migrations"
    
    # Check if migration 05 exists
    if [ ! -f "$MIGRATIONS_DIR/05-add-multi-language-support.sql" ]; then
        print_error "Migration file not found: 05-add-multi-language-support.sql"
        exit 1
    fi
    
    print_info "Running migration 05: Multi-language support..."
    docker exec -i "$POSTGRES_CONTAINER" psql -U cow_user -d cow_db < "$MIGRATIONS_DIR/05-add-multi-language-support.sql" 2>&1 | grep -v "already exists" || true
    print_success "Migration 05 completed"
    
    # Run migrations 06-10 if they exist
    for i in 06 07 08 09 10; do
        MIGRATION_FILE="$MIGRATIONS_DIR/${i}-*.sql"
        if ls $MIGRATION_FILE 1> /dev/null 2>&1; then
            for file in $MIGRATION_FILE; do
                print_info "Running migration $(basename "$file")..."
                docker exec -i "$POSTGRES_CONTAINER" psql -U cow_user -d cow_db < "$file" 2>&1 | grep -v "already exists" || true
                print_success "Migration $(basename "$file") completed"
            done
        fi
    done
    
    print_success "All migrations completed"
}

# Download dictionary files
download_dictionaries() {
    print_header "Downloading Dictionary Files"
    
    # Create data directory if it doesn't exist
    mkdir -p "$DATA_DIR"
    
    print_info "Running download script..."
    bash "$SCRIPT_DIR/download-dictionaries.sh"
    
    # Uncompress JMdict if it's still compressed
    if [ -f "$DATA_DIR/JMdict_e.gz" ]; then
        print_info "Uncompressing JMdict..."
        gunzip -f "$DATA_DIR/JMdict_e.gz"
        print_success "JMdict uncompressed"
    fi
    
    # Verify all required files exist
    print_info "Verifying dictionary files..."
    MISSING_FILES=0
    
    if [ ! -f "$PROJECT_ROOT/cedict_ts.u8" ]; then
        print_warning "Chinese dictionary not found: cedict_ts.u8"
        MISSING_FILES=$((MISSING_FILES + 1))
    fi
    
    if [ ! -f "$DATA_DIR/JMdict_e" ]; then
        print_warning "Japanese dictionary not found: JMdict_e"
        MISSING_FILES=$((MISSING_FILES + 1))
    fi
    
    if [ ! -f "$DATA_DIR/kengdic.tsv" ]; then
        print_warning "Korean dictionary not found: kengdic.tsv"
        MISSING_FILES=$((MISSING_FILES + 1))
    fi
    
    if [ ! -f "$DATA_DIR/viet-dict.txt" ] && [ ! -f "$DATA_DIR/viet-dict-full.txt" ]; then
        print_warning "Vietnamese dictionary not found: viet-dict.txt"
        MISSING_FILES=$((MISSING_FILES + 1))
    fi
    
    if [ $MISSING_FILES -gt 0 ]; then
        print_warning "$MISSING_FILES dictionary file(s) missing - will skip those imports"
    else
        print_success "All dictionary files present"
    fi
}

# Import Chinese dictionary
import_chinese() {
    print_header "Importing Chinese Dictionary (CC-CEDICT)"
    
    if [ ! -f "$PROJECT_ROOT/cedict_ts.u8" ]; then
        print_warning "Chinese dictionary file not found, skipping..."
        return
    fi
    
    print_info "Starting Chinese import (~2-3 minutes)..."
    docker exec -i "$BACKEND_CONTAINER" node --loader ts-node/esm /app/scripts/import-cedict-pg.ts /app/cedict_ts.u8
    
    # Verify import
    COUNT=$(docker exec -i "$POSTGRES_CONTAINER" psql -U cow_user -d cow_db -t -c "SELECT COUNT(*) FROM dictionaryentries WHERE language = 'zh';" | tr -d ' ')
    if [ "$COUNT" -gt 0 ]; then
        print_success "Chinese dictionary imported: $COUNT entries"
    else
        print_error "Chinese dictionary import may have failed"
    fi
}

# Import Japanese dictionary
import_japanese() {
    print_header "Importing Japanese Dictionary (JMdict)"
    
    if [ ! -f "$DATA_DIR/JMdict_e" ]; then
        print_warning "Japanese dictionary file not found, skipping..."
        return
    fi
    
    print_info "Starting Japanese import (~5-10 minutes)..."
    docker exec -i "$BACKEND_CONTAINER" node --loader ts-node/esm /app/scripts/import-jmdict.ts /app/data/dictionaries/JMdict_e
    
    # Verify import
    COUNT=$(docker exec -i "$POSTGRES_CONTAINER" psql -U cow_user -d cow_db -t -c "SELECT COUNT(*) FROM dictionaryentries WHERE language = 'ja';" | tr -d ' ')
    if [ "$COUNT" -gt 0 ]; then
        print_success "Japanese dictionary imported: $COUNT entries"
    else
        print_error "Japanese dictionary import may have failed"
    fi
}

# Import Korean dictionary
import_korean() {
    print_header "Importing Korean Dictionary (KENGDIC)"
    
    if [ ! -f "$DATA_DIR/kengdic.tsv" ]; then
        print_warning "Korean dictionary file not found (kengdic.tsv), skipping..."
        return
    fi
    
    print_info "Starting Korean import (~1-2 minutes)..."
    docker exec -i "$BACKEND_CONTAINER" node --loader ts-node/esm /app/scripts/import-kengdic-tsv.ts /app/data/dictionaries/kengdic.tsv
    
    # Verify import
    COUNT=$(docker exec -i "$POSTGRES_CONTAINER" psql -U cow_user -d cow_db -t -c "SELECT COUNT(*) FROM dictionaryentries WHERE language = 'ko';" | tr -d ' ')
    if [ "$COUNT" -gt 0 ]; then
        print_success "Korean dictionary imported: $COUNT entries"
    else
        print_error "Korean dictionary import may have failed"
    fi
}

# Import Vietnamese dictionary
import_vietnamese() {
    print_header "Importing Vietnamese Dictionary (OVDP VietAnh)"
    
    if [ ! -f "$DATA_DIR/viet-dict-full.txt" ]; then
        print_warning "Vietnamese dictionary file not found (viet-dict-full.txt), skipping..."
        return
    fi
    
    VDICT_FILE="/app/data/dictionaries/viet-dict-full.txt"
    
    print_info "Starting Vietnamese import (~1-2 minutes)..."
    docker exec -i "$BACKEND_CONTAINER" node --loader ts-node/esm /app/scripts/import-vdict.ts "$VDICT_FILE"
    
    # Verify import
    COUNT=$(docker exec -i "$POSTGRES_CONTAINER" psql -U cow_user -d cow_db -t -c "SELECT COUNT(*) FROM dictionaryentries WHERE language = 'vi';" | tr -d ' ')
    if [ "$COUNT" -gt 0 ]; then
        print_success "Vietnamese dictionary imported: $COUNT entries"
    else
        print_error "Vietnamese dictionary import may have failed"
    fi
}

# Display final summary
show_summary() {
    print_header "Import Summary"
    
    echo "Dictionary entry counts:"
    docker exec -i "$POSTGRES_CONTAINER" psql -U cow_user -d cow_db -c "
        SELECT 
            language,
            COUNT(*) as entries,
            CASE language
                WHEN 'zh' THEN '🇨🇳 Chinese'
                WHEN 'ja' THEN '🇯🇵 Japanese'
                WHEN 'ko' THEN '🇰🇷 Korean'
                WHEN 'vi' THEN '🇻🇳 Vietnamese'
                ELSE language
            END as language_name
        FROM dictionaryentries
        GROUP BY language
        ORDER BY language;
    "
    
    TOTAL=$(docker exec -i "$POSTGRES_CONTAINER" psql -U cow_user -d cow_db -t -c "SELECT COUNT(*) FROM dictionaryentries;" | tr -d ' ')
    echo ""
    print_success "Total dictionary entries: $TOTAL"
    
    print_info "Dictionary import process complete!"
    print_info "Your application now supports Chinese, Japanese, Korean, and Vietnamese!"
}

# Main execution
main() {
    START_TIME=$(date +%s)
    
    echo -e "${BLUE}"
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║                                                               ║"
    echo "║        VOCABULARY APP - DICTIONARY IMPORT SCRIPT              ║"
    echo "║                                                               ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    
    check_containers
    run_migrations
    download_dictionaries
    
    print_info "Starting dictionary imports - this will take 15-30 minutes..."
    
    import_chinese
    import_japanese
    import_korean
    import_vietnamese
    
    show_summary
    
    END_TIME=$(date +%s)
    DURATION=$((END_TIME - START_TIME))
    MINUTES=$((DURATION / 60))
    SECONDS=$((DURATION % 60))
    
    echo ""
    print_success "All operations completed in ${MINUTES}m ${SECONDS}s"
}

# Run main function
main
