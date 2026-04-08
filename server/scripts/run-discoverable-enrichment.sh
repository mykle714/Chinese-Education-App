#!/bin/bash

# Discoverable Entry Enrichment Pipeline
#
# Runs all AI-powered backfill scripts for discoverable zh dictionaryentries,
# in dependency order. Safe to re-run: each script skips entries that already
# have the relevant field populated.
#
# Prerequisites:
#   - Docker containers must be running
#   - ANTHROPIC_API_KEY must be set in server/.env.docker
#   - Entries must already be marked discoverable = TRUE in the database
#
# Usage:
#   bash server/scripts/run-discoverable-enrichment.sh [production|local]
#   Default: local
#
# Pipeline order (each step depends on the previous):
#   1. backfill-split-semicolon-definitions  — normalize definitions array
#   2. backfill-sort-definitions             — sort defs by prototypicality (AI)
#   3. backfill-hsk-level                    — assign HSK1-HSK6 level (AI)
#   4. backfill-short-long-definitions       — generate longDefinition (AI)
#   5. backfill-example-sentences            — generate example sentences (AI)
#   6. backfill-example-sentences-metadata   — segment metadata for sentences
#   7. backfill-synonyms                     — find synonyms (AI)
#   8. backfill-expansion                    — generate expansion form (AI)
#   9. backfill-classifier                   — assign measure words (AI)
#  10. backfill-dictionary-breakdown         — per-character breakdown (AI)
#  11. backfill-vernacular-score             — score vernacular register (AI)

set -e

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

MODE="${1:-local}"

if [ "$MODE" = "production" ]; then
    BACKEND_CONTAINER="cow-backend-prod"
    echo -e "${BLUE}Running in PRODUCTION mode${NC}\n"
else
    BACKEND_CONTAINER="cow-backend-local"
    echo -e "${BLUE}Running in LOCAL mode${NC}\n"
fi

print_header() {
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
}

print_success() { echo -e "${GREEN}✅ $1${NC}"; }
print_error()   { echo -e "${RED}❌ $1${NC}"; }
print_info()    { echo -e "${BLUE}ℹ️  $1${NC}"; }

check_container() {
    if ! docker ps | grep -q "$BACKEND_CONTAINER"; then
        print_error "Backend container ($BACKEND_CONTAINER) is not running!"
        print_info "Start it with: docker-compose up -d"
        exit 1
    fi
    print_success "Backend container is running"
}

run_script() {
    local label="$1"
    local script="$2"
    print_header "$label"
    docker exec -i "$BACKEND_CONTAINER" sh -c "npx tsx /app/scripts/$script"
    print_success "$label complete"
}

# ─── Main ────────────────────────────────────────────────────────────────────

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                                                               ║"
echo "║         DISCOVERABLE ENTRY ENRICHMENT PIPELINE               ║"
echo "║                                                               ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

START_TIME=$(date +%s)

check_container

# Step 1: Normalize definitions — split any semicolon-delimited elements
run_script "Step 1: Split Semicolon Definitions" "backfill-split-semicolon-definitions.js"

# Step 2: Sort definitions from most prototypical to least (AI)
run_script "Step 2: Sort Definitions by Prototypicality" "backfill-sort-definitions.js"

# Step 3: Assign HSK level for discoverable zh entries (AI)
run_script "Step 3: HSK Level" "backfill-hsk-level.js"

# Step 4: Generate longDefinition using sorted definitions (AI)
run_script "Step 4: Short + Long Definitions" "backfill-short-long-definitions.js"

# Step 5: Generate example sentences (AI) — uses definitions
run_script "Step 5: Example Sentences" "backfill-example-sentences.js"

# Step 6: Segment metadata for example sentences — must follow step 5
run_script "Step 6: Example Sentence Metadata" "backfill-example-sentences-metadata.js"

# Step 7: Find synonyms (AI)
run_script "Step 7: Synonyms" "backfill-synonyms.js"

# Step 8: Generate expansion form (AI)
run_script "Step 8: Expansion" "backfill-expansion.js"

# Step 9: Assign measure words / classifiers (AI)
run_script "Step 9: Classifiers" "backfill-classifier.js"

# Step 10: Per-character breakdown for multi-character words (AI)
run_script "Step 10: Dictionary Breakdown" "backfill-dictionary-breakdown.js"

# Step 11: Vernacular register score (AI)
run_script "Step 11: Vernacular Score" "backfill-vernacular-score.js"

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
MINUTES=$((DURATION / 60))
SECONDS=$((DURATION % 60))

echo ""
print_success "Enrichment pipeline complete in ${MINUTES}m ${SECONDS}s"
