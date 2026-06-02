#!/bin/bash

# Discoverable Entry Enrichment Pipeline — SPANISH (es)
#
# Runs the AI/deterministic backfill scripts for discoverable es entries in
# dictionaryentries_es, in dependency order. Safe to re-run: each script skips
# entries that already have the relevant field populated.
#
# Spanish backfill scripts live in server/scripts/backfill/spanish/.
# The Chinese equivalent pipeline is run-discoverable-enrichment.sh.
#
# NOTE: dictionaryentries_es currently has 0 discoverable rows, and the AI steps
# filter discoverable = TRUE, so they no-op until Spanish rows are flagged
# discoverable. The two deterministic definition-cleanup steps run on all es rows.
#
# Prerequisites:
#   - Docker containers must be running
#   - ANTHROPIC_API_KEY must be set in server/.env.docker
#   - dictionaryentries_es must be populated (import-esdict-temp.ts) with
#     partsOfSpeech (used by long-definitions and example-sentences)
#
# Usage:
#   bash server/scripts/run-discoverable-enrichment-es.sh [production|local]
#   Default: local
#
# Pipeline order (each step depends on the previous):
#   1. backfill-split-semicolon-definitions  — normalize definitions array (deterministic)
#   2. backfill-expand-abbreviations         — expand sth/sb in definitions (deterministic)
#   3. backfill-parts-of-speech              — materialize one row per POS, delegate
#                                              definitions, collapse gender into
#                                              alternateGender/alternateMeaning (AI)
#   4. backfill-sort-definitions             — sort defs by usefulness (AI)
#   5. backfill-long-definitions             — generate longDefinition (AI)
#   6. backfill-example-sentences            — generate example sentences (AI)
#   7. backfill-vernacular-score             — score vernacular register (AI)
#
# Step 3 runs before sort/long/examples because it rewrites each row's definitions
# and partsOfSpeech, which those later steps consume. It defaults to --prune-mode=soft
# (folded gender rows are hidden, not deleted); pass production-side review before a
# hard prune. See backfill/spanish/backfill-parts-of-speech.js for details.
#
# Intentionally NOT in the Spanish pipeline (vs the Chinese one):
#   - synonyms: removed from the project
#   - tones / numbered-pinyin / pinyin-ucolon / toneless / hsk-level / classifier /
#     breakdown / expansion: Chinese-only concepts with no Spanish analog

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

# All Spanish backfill scripts live under scripts/backfill/spanish/
SCRIPT_DIR="backfill/spanish"

run_script() {
    local label="$1"
    local script="$2"
    print_header "$label"
    docker exec -i "$BACKEND_CONTAINER" sh -c "npx tsx /app/scripts/$SCRIPT_DIR/$script"
    print_success "$label complete"
}

# ─── Main ────────────────────────────────────────────────────────────────────

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                                                               ║"
echo "║       DISCOVERABLE ENTRY ENRICHMENT PIPELINE — SPANISH        ║"
echo "║                                                               ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

START_TIME=$(date +%s)

check_container

# Step 1: Normalize definitions — split any semicolon-delimited elements (deterministic)
run_script "Step 1: Split Semicolon Definitions" "backfill-split-semicolon-definitions.js"

# Step 2: Expand sth/sb abbreviations in definitions (deterministic)
run_script "Step 2: Expand Abbreviations" "backfill-expand-abbreviations.js"

# Step 3: Materialize one row per POS, delegate definitions, collapse gender (AI)
run_script "Step 3: Parts of Speech & Gender Collapse" "backfill-parts-of-speech.js"

# Step 4: Sort definitions from most useful to least (AI)
run_script "Step 4: Sort Definitions by Usefulness" "backfill-sort-definitions.js"

# Step 5: Generate longDefinition using sorted definitions (AI)
run_script "Step 5: Long Definitions" "backfill-long-definitions.js"

# Step 6: Generate example sentences (AI) — uses partsOfSpeech
run_script "Step 6: Example Sentences" "backfill-example-sentences.js"

# Step 7: Vernacular register score (AI)
run_script "Step 7: Vernacular Score" "backfill-vernacular-score.js"

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
MINUTES=$((DURATION / 60))
SECONDS=$((DURATION % 60))

echo ""
print_success "Spanish enrichment pipeline complete in ${MINUTES}m ${SECONDS}s"
