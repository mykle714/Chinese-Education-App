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
# The AI steps filter discoverable = TRUE, so they only touch flagged rows. The two
# deterministic definition-cleanup steps run table-wide on all es rows.
#
# ⚠ THIS RUNNER IS DEV-SHAPED: it drives `docker exec` against a local backend
# container. `cow-backend-prod` ships neither scripts/backfill/ nor tsx, so the
# `production` mode below CANNOT work — for prod use the per-step
# `server/scripts/backfill/run-prod.sh` invocations in /mark-discoverable §B3.
#
# Prerequisites:
#   - Docker containers must be running
#   - ANTHROPIC_API_KEY must be set in server/.env.docker
#   - dictionaryentries_es must be populated (import-esdict-temp.ts)
#
# Usage:
#   bash server/scripts/run-discoverable-enrichment-es.sh [production|local]
#   Default: local
#
# Pipeline order — MUST match REQUIRED_SCRIPTS_ES in
# server/scripts/backfill/shared/lib/requiredScripts.js, which is what
# oracle-plan.js --lang=es plans against. Update both together.
#   1. backfill-split-semicolon-definitions  — normalize definitions array (deterministic)
#   2. backfill-expand-abbreviations         — expand sth/sb in definitions (deterministic)
#   3. backfill-process-definitions-array    — split comma-joined synonym runs, then
#                                              sort defs by usefulness + prune (AI)
#   4. backfill-icons (--lang=es)            — icons8 lookup keyed off definitions[0]
#   5. backfill-frequency-score              — word-level conversation-frequency score (AI)
#   6. backfill-cluster-definitions          — partition definitions into sense clusters,
#                                              also writes partsOfSpeech (AI)
#   7. backfill-long-definitions             — generate longDefinition per sense (AI)
#   8. backfill-example-sentences            — generate example sentences per sense (AI)
#   9. repair-frequency-score-drift          — enforce frequencyScore == MAX(cluster scores) (no AI)
#
# Why this order:
#   - Steps 1-3 all rewrite `definitions`; everything downstream reads it.
#   - Step 3 owns the COMMA split (docs/DEFINITION_MAPPING.md, "Step 4, Spanish only").
#     The es source packs synonym runs into one gloss ("later, afterwards, post") where
#     CEDICT would give separate elements, so without this step definitions[0] — and
#     therefore dd, the icon search term, and every cluster gloss — is a whole list.
#   - Step 4 keys its icon search off definitions[0], so it follows every rewriter.
#   - Step 6's checkShape requires clusters to be an EXACT PARTITION of `definitions`,
#     so it MUST follow step 3 — clustering first would leave the partition referencing
#     glosses a later prune removed.
#   - Steps 7-8 read the cluster `sense` labels to tag what they generate.
#
# There is NO Spanish parts-of-speech step: `partsOfSpeech` is a by-product of step 6.
# The old backfill-parts-of-speech.js materialized one det row per POS and was deleted
# by migration 123, which made word1 unique and moved the split into definitionClusters.
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

# Most Spanish backfill scripts live under scripts/backfill/spanish/; the icons step is
# language-shared and lives at the backfill root, hence the explicit path + args below.
SCRIPT_DIR="backfill/spanish"

# run_script <label> <script-name> [extra args…]  — path relative to $SCRIPT_DIR
run_script() {
    local label="$1"; shift
    local script="$1"; shift
    print_header "$label"
    docker exec -i "$BACKEND_CONTAINER" sh -c "npx tsx /app/scripts/$SCRIPT_DIR/$script $*"
    print_success "$label complete"
}

# run_root_script <label> <script-name> [extra args…]  — path relative to scripts/backfill
run_root_script() {
    local label="$1"; shift
    local script="$1"; shift
    print_header "$label"
    docker exec -i "$BACKEND_CONTAINER" sh -c "npx tsx /app/scripts/backfill/$script $*"
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

# Step 3: Split comma-joined synonym runs, then sort definitions from most useful to
# least + prune low-value (AI). Must precede clustering — see the exact-partition note
# in the header (and the split must precede it too, or clusters partition joined runs).
run_script "Step 3: Process Definitions Array" "backfill-process-definitions-array.js"

# Step 4: icons8 icon lookup — keyed off definitions[0], so it follows every step that
# can still rewrite that array. Language-shared script at the backfill root.
run_root_script "Step 4: Icons" "backfill-icons.js" --lang=es

# Step 5: Word-level everyday-conversation frequency score (AI)
run_script "Step 5: Frequency Score" "backfill-frequency-score.js"

# Step 6: Partition definitions into sense clusters; also writes partsOfSpeech (AI)
run_script "Step 6: Cluster Definitions" "backfill-cluster-definitions.js"

# Step 7: Generate longDefinition per sense (AI) — reads cluster `sense` labels
run_script "Step 7: Long Definitions" "backfill-long-definitions.js"

# Step 8: Generate example sentences per sense (AI) — reads cluster `sense` labels
run_script "Step 8: Example Sentences" "backfill-example-sentences.js"

# Step 9 lives in backfill/shared/ (language-generic), so it bypasses run_script's
# SCRIPT_DIR. It reconciles the word-level frequencyScore with the per-cluster scores —
# steps 5 and 6 already enforce the invariant, this is the safety net. No API calls.
# See docs/DEFINITION_CLUSTERS.md § "The word/cluster frequency invariant".
print_header "Step 9: Frequency Invariant Repair"
docker exec -i "$BACKEND_CONTAINER" sh -c "npx tsx /app/scripts/backfill/shared/repair-frequency-score-drift.js --language=es"
print_success "Step 9: Frequency Invariant Repair complete"

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
MINUTES=$((DURATION / 60))
SECONDS=$((DURATION % 60))

echo ""
print_success "Spanish enrichment pipeline complete in ${MINUTES}m ${SECONDS}s"
