# Claude Development Guide

You are a detail oriented coding assistant with very artistic UI design taste. You are cautious and always double check assumptions with the user. You ask lots of questions. You value consistency in the design.

## Abbreviations
cpcd = CharacterPinyinColorDisplay
eip = Extra Info Panel
fc = Flashcard(s)
det = dictionary entries table
vet = vocab entries table
sct = shared characters tab (in the extra info card)
st = synonyms tab (in the extra info card)
bt = breakdown tab (in the extra info card)
est = example sentence tab (in the extra info card)
et = expansion tab (in the extra info card)
mdp = mobile demo page
flp = /flashcards/learn page
fdp = /flashcards/decks page
gsa = greedy segmentation algorithm
dp = discover page — the `/discover` hub menu (lists discover activities)
scp = sort cards page — the drag-to-sort page at `/discover/sort/:language` (reached from the discover hub)
hp = home page — the `/` hub menu (Night Market, Games, Reader, Dictionary, Tester Dashboard); footer Home tab
tdp = tester dashboard page — `/tester-dashboard` (former landing content: study time, streak, calendar, leaderboard)
cdp = card detail page
pct = particles and classifiers table
nmp = night market page
ped = pedestrian
poi = point of interest
cdet = chinese dictionary entries table
sdet = spanish dictionary entries table
cvet = chinese vocab entries table
svet = spanish vocab entries table
fie = flashcard icon editor
dd = display definition (the definition that we display on a flashcard)
ddt = display definition transformation
utcm = mastery progress (unfamiliar, target, comfortable, mastered)
mdp = mark discoverable pipeline (refers to the skill)
pbh = progress bar height
nme = night market editor
nms = night market sandbox


## Terminology: "Learn Now" cards

The `'library'` starter-pack bucket is presented to users as **"Learn Now"** cards
(renamed from "Library"). This rename is **front-end visible text only** — all
internal identifiers keep the `library` name: the `StarterPackBucket` value
`'library'`, API endpoint paths (`/add-to-library`, `/non-mastered-library-cards`,
etc.), variable names (`onAddToLibrary`, `totalLibraryCards`), CSS class names
(`flashcards-decks__library-*`), and the `'already-in-library'` API status are all
unchanged because they are backend contracts. When adding new user-facing copy for
this bucket, write "Learn Now"; when touching code/API, keep "library".

## Night Market Coordinate System
→ Moved to the Coordinate System section of [docs/NIGHT_MARKET_FEATURE.md](./docs/NIGHT_MARKET_FEATURE.md) — asset coordinates are always isometric grid units (isoX, isoY); assets live in `src/assets/` (not `public/assets/`).

## Touch & Scroll (mobile)
→ Moved to [docs/UX_AND_NAVIGATION.md](./docs/UX_AND_NAVIGATION.md) — default components to `touchAction: "none"` (scrolling is opt-in per page via an inner container); the app shell never scrolls; text is app-wide `user-select: none` (cpcd is the desktop-only exception); every game page must call `useBlockEdgeSwipe(true)`.

## Writing .md files
Do not write content descibing what you just completed; you should write the status/structure of the service/code. The files are meant to be for future AI  agents.

## 🚀 Getting Started

- **Project Goal**: See [docs/PROJECT_GOAL.md](./docs/PROJECT_GOAL.md)
- **Project Constructs**: See [docs/CONSTRUCTS.md](./docs/CONSTRUCTS.md) — consult this when encountering unfamiliar project-specific terms
- **Project Overview**: See [README.md](./README.md)
- **Docker Setup**: See [docs/DOCKER_GUIDE.md](./docs/DOCKER_GUIDE.md) and [docs/DOCKER_COMMANDS.md](./docs/DOCKER_COMMANDS.md)
- **Server Development**: See [server/README.md](./server/README.md)
- **General Reference**: See [AI_REFERENCE.md](./AI_REFERENCE.md)
- **Which machine am I on?**: See [amIOnTheProdMachine.md](./amIOnTheProdMachine.md) — present on all machines (gitignored); read the file to determine if this is dev or prod

## 💾 Database Tasks

> ⚠️ **Before doing any database work**, read [amIOnTheProdMachine.md](./amIOnTheProdMachine.md) to determine which machine you are on. If it says **PROD**, be especially careful about writes, migrations, and destructive operations — confirm with the user before proceeding. If it says **DEV**, normal local development is safe.

### PostgreSQL Queries
When querying or working with the PostgreSQL database:
→ See [POSTGRES_QUERY_GUIDE.md](./POSTGRES_QUERY_GUIDE.md)

**Key Points**:
- Always use lowercase table names: `dictionaryentries_zh` (not `"DictionaryEntries"`)
- Run db scripts from the `server/` directory
- Use parameterized queries to prevent SQL injection
- Always release database clients

### Dictionary Tables (per-language, intentionally NOT unified)

Dictionary data lives in **separate tables per language family** because their
natural identity/keying differs. Do not try to force them into one table.

| Concept | Table | Identity / key | Notes |
|---|---|---|---|
| **Chinese det** (cdet) | `dictionaryentries_zh` | surrogate `id`; looked up by `word1` (+ `language`) | The original rich table, **renamed from `dictionaryentries` (migration 57)** and now Chinese-only. Holds Chinese (`zh`) data plus all CJK-style enrichment columns (`numberedPinyin`, `tone`, `breakdown`, `classifier`, `wordForms`, `components`, `breakdownElaboration`, etc.). A `gender` column used to exist (added by migration 55 back when this table was the unified `dictionaryentries`) but was always NULL for Chinese and was **dropped by migration 103**; grammatical gender is a Spanish-only concept living on `dictionaryentries_es`. |
| **Spanish det** (sdet) | `dictionaryentries_es` | `word1` (+ `language`), enforced by `uq_es_word1_language` (surrogate `id` PK) | Schema = clone of `dictionaryentries_zh` + `etymology` (Wiktionary etymology text, migration 59) + `raw` (jsonb source blocks). `longDefinition` is reserved for the AI definition-elaboration backfill, NOT etymology. A word's several parts of speech and its gender-homographs (`cura`/f "cure" vs `cura`/m "priest") live **inside** the row as `definitionClusters` — the same sense-cluster column zh uses — with `pos` + `gender` per cluster. Until migration 123 they were **separate rows** keyed (`word1`, `pos`, `gender`); that migration merged them and dropped the `pos`/`gender`/`hasMultiplePos`/`alternateGender`/`alternateMeaning` columns. |
| **Affixes** | `affixes` | (`language`, `affix`, `type`) | Bound morphemes for ALL languages. Kept out of the det tables because they are not standalone headwords. `type` ∈ {`prefix`,`suffix`,`interfix`,`infix`} (migration 61 added interfix/infix for Spanish `-i-`/`-x-`). `gender` ∈ {`m`,`f`,NULL} and `number` ∈ {`s`,`p`,NULL} (migration 61) carry the singular/plural + gender caveats for inflected affix forms (e.g. `-eada` = feminine singular of `-eado`). |

Why the split: **not** identity — both tables are keyed by `word1` since migration
123 — but ENRICHMENT. The zh table carries CJK-only columns (`numberedPinyin`,
`tone`, `breakdown`, `classifier`, `wordForms`, `components`) that are meaningless for
Spanish, and the es table carries `etymology` + `raw` that are meaningless for
Chinese. Rather than one schema half-NULL in both directions, each gets its own
table and the shared read path unions them (`server/dal/shared/dictJoin.ts`).
Source for Spanish/affixes: `doozan/spanish_data`
(`es-en.data`, Wiktionary-derived, CC-BY-SA), imported via
`server/scripts/import-esdict-temp.ts`; the `raw` column preserves the full
per-POS source structure (gender, etymology, glosses, syn/q/usage).

**Deprecated unified model / broken flows:** `dictionaryentries` used to be a
single shared table for `zh/ja/ko/vi`. It now holds Chinese only. The ja/ko/vi
import scripts (`import-jmdict.ts`, `import-edict2.ts`, `import-kedict.ts`,
`import-kengdic-tsv.ts`, `import-vdict.ts`) are **intentionally left broken**
(they throw on startup and reference not-yet-existing `dictionaryentries_ja/_ko/_vi`).
Those languages are **not user-selectable** for now; build the per-language
tables before re-enabling them. Relevant migrations: 55 (gender), 57 (rename →
`dictionaryentries_zh`), 58 (create `dictionaryentries_es`), 59 (es etymology), 60 (affixes), 61 (affix gender/number + interfix/infix), 103 (drop vestigial `gender` from `dictionaryentries_zh`), 123 (es converges on the zh clustered-sense model: `word1` unique, per-(pos,gender) rows merged into `definitionClusters`).

### Marking Words Discoverable

It is **illegal** to set `discoverable = TRUE` on any `dictionaryentries_zh` or
`dictionaryentries_es` row outside of the `/mark-discoverable` skill. Setting
the flag directly (a bare `UPDATE ... SET discoverable = TRUE`) without running
the rest of that skill's pipeline leaves the row's enrichment columns
(`partsOfSpeech`, `longDefinition`, `exampleSentences`, `frequencyScore`, zh's
`breakdown`/`classifier`/`wordForms`/`definitionClusters`, etc.) null, and the
word ships to learners incompletely enriched. Always go through
`/mark-discoverable` end to end, including its verification step.

## 🗣️ Multi-Language Support

For adding or modifying language support:
→ See [docs/MULTI_LANGUAGE_IMPLEMENTATION.md](./docs/MULTI_LANGUAGE_IMPLEMENTATION.md)

For adding a completely new language:
→ See [docs/ADDING_NEW_LANGUAGE_GUIDE.md](./docs/ADDING_NEW_LANGUAGE_GUIDE.md)

## 🔐 Authentication & Users

### Token Management
→ See [docs/TOKEN_EXPIRATION_IMPLEMENTATION.md](./docs/TOKEN_EXPIRATION_IMPLEMENTATION.md)

## 📚 Features

### Minute Points & Streak System
→ See [docs/MINUTE_POINTS_SYSTEM.md](./docs/MINUTE_POINTS_SYSTEM.md)

#### Inactivity penalty cron (prod only)
An hourly Postgres cron on the prod server. For each **(user, language)** balance that has gone a full local day below the 3-minute threshold, it breaks that language's streak and debits an **escalating** penalty by consecutive missed day (`3, 15, 30, 60, 90, 120`, then the remainder at day 7+), floored at the balance's **24-hour checkpoint** (a penalty never carries a balance across a multiple of 1440 minute points; under 1440 it can still reach 0), and decays the user's Night Market occupants to match. The streak breaks on a missed day even when the checkpoint absorbs the whole penalty. Penalties are per language (migration 130): keeping up Chinese does not shield neglected Spanish. Never touches `lifetimeMinutesEarned` (gross is monotonic). Not installed on dev.
→ See [docs/STREAK_EXPIRATION_CRON.md](./docs/STREAK_EXPIRATION_CRON.md)

### Flashcards & Review History
→ See [docs/FLASHCARD_REVIEW_HISTORY_IMPLEMENTATION.md](./docs/FLASHCARD_REVIEW_HISTORY_IMPLEMENTATION.md)
  → Mastery rework (typed marks, goals, progress bar): [docs/MASTERY_REWORK.md](./docs/MASTERY_REWORK.md) — **DESIGN/DRAFT**: four typed mark tracks (Recognition/Production/Reading/Writing, 8 each in `typedMarkHistory`), per-account reading/writing goals, the goal-weighted progress-bar-height (pbh) formula that replaces the generated `category` column with a service-layer utcm compute, and the cdp stacked progress bar.

### Vocabulary Enrichment
→ See [docs/VOCAB_ENRICHMENT_IMPLEMENTATION.md](./docs/VOCAB_ENRICHMENT_IMPLEMENTATION.md)

### Definition Mapping
→ See [docs/DEFINITION_MAPPING.md](./docs/DEFINITION_MAPPING.md) — index of every definition *form* across the app (flat `definitions`, lead gloss, dd, `shortDefinition`, `longDefinition`, per-segment defs) and the enrichment operations that transform one into the next.
  → Sense clustering: [docs/DEFINITION_CLUSTERS.md](./docs/DEFINITION_CLUSTERS.md) — splitting `definitions` into orthogonal sense clusters (`definitionClusters`, migration 90); per-cluster reading + 1–5 conversation-frequency score.

### Character Breakdown Feature
→ See [docs/BREAKDOWN_FEATURE_IMPLEMENTATION.md](./docs/BREAKDOWN_FEATURE_IMPLEMENTATION.md)

### Word Compare (eip Compare tab)
→ See [docs/WORD_COMPARE_FEATURE.md](./docs/WORD_COMPARE_FEATURE.md) — **DESIGN**: a singleton entry tab in the eip tab strip (not attached to a card) with two xl-cpcd slots; slot B fills via a mini dictionary search, then `POST /api/dictionary/compare` returns an AI paragraph on the pair's difference, cached in `word_comparison_cache` (migration 105) under the shared `dictionary_ai_usage` daily cap.

### User Document Feature
→ See [docs/USER_DOCUMENT_FEATURE_SUMMARY.md](./docs/USER_DOCUMENT_FEATURE_SUMMARY.md)

### Data Validation System
→ See [docs/DATA_VALIDATION_SYSTEM.md](./docs/DATA_VALIDATION_SYSTEM.md) — validator accounts (`users.isValidator`, migration 104) download an auto-composed Reader doc for one field of one discoverable det entry (`Validate - <word1>`) and Approve or Flag-with-suggestion; outcomes go to the dedicated `validations` table (per entry+field, keyed by det id — survives det data deploys) with the reviewed `content` stored for both actions, a shared content sanitizer guards document bodies, and backfills skip human-reviewed fields via `validatedClause`.

### Night Market
→ See [docs/NIGHT_MARKET_FEATURE.md](./docs/NIGHT_MARKET_FEATURE.md)
→ Templates (layout authoring/tiling): [docs/NIGHT_MARKET_TEMPLATES.md](./docs/NIGHT_MARKET_TEMPLATES.md)
→ Pedestrian movement: [docs/PEDESTRIAN_WALKING_ALGORITHM.md](./docs/PEDESTRIAN_WALKING_ALGORITHM.md)
→ Tile/street graph invariants: [docs/NIGHT_MARKET_GRAPH_ASSUMPTIONS.md](./docs/NIGHT_MARKET_GRAPH_ASSUMPTIONS.md)

### UX & Navigation
→ See [docs/UX_AND_NAVIGATION.md](./docs/UX_AND_NAVIGATION.md) — umbrella for navigation + the mobile shell: app navigation structure (footer tabs + `/` Home menu + back-arrow drill-ins), the `MobileTabScreen` scroll-away-header layout, the **Leaf**/**Node** drill-in archetypes, the Discover two-level surface, and the global touch/scroll/selection rules.

### Hub Menu System
→ See [docs/HUB_MENU_SYSTEM.md](./docs/HUB_MENU_SYSTEM.md) — the shared `HubMenu`/`HubMenuRow` component behind the Home/Discover/Games hubs: rounded cards, per-item persistent pastel colors, header/footer slots (welcome text, tip box, floating-footer spacer), and horizontally-scrolling "array" menu items (used by Bubble Match's level picker).

### Games
→ See [docs/GAMES_FEATURE.md](./docs/GAMES_FEATURE.md)

### Provisional Cards (no game/flp ever blocks on card count)
→ See [docs/PROVISIONAL_CARDS.md](./docs/PROVISIONAL_CARDS.md) — every game's and flp's old
minimum-card requirement is now a **baseline** (`CARD_BASELINES`, `server/contracts/wire.ts`).
When a learner is short, the server lends them cards as `starterPackBucket = 'provisional'`
vet rows (migration 140) chosen from the level nearest theirs, ordered by commonality.
Lent cards accept marks but are hidden from every deck/search read (`vetSortedClause()` vs
`vetPlayableClause()` in `server/dal/shared/vetTable.ts`); sorting one promotes it in place
so the progress survives.

### Friends
→ See [docs/FRIENDS_FEATURE.md](./docs/FRIENDS_FEATURE.md) — the friend graph (`friendships`, migration 138): the hp Friends row and its three NodePages (`/friends`, `/friends/sent`, `/friends/requests`), adding a friend by pasted user ID, the one-row-per-pair model (a friendship IS an accepted request; declining deletes the row), and the crossing-request auto-accept rule.

### Arena (weekly global division leaderboard)
→ See [docs/ARENA_FEATURE.md](./docs/ARENA_FEATURE.md) — **BUILT ON DEV, not on prod**: the hp Arena row and `/arena`, a weekly cluster of 25 players ranked by minutes earned while the arena is live. Covers the Tue 04:00 → **Sun 16:00** cycle and its 36-hour break/opt-in period (the app's only non-04:00 boundary, and why), 12 divisions held **per (user, language)** on `user_languages`, clustering as a **sort-and-chunk over a geohash cell** (a space-filling curve, so the stored location format *is* the sort key) inside a hard (timezone, division) partition, synthetic padding that lives in `arena_members` rather than `users`, ±5 promotion/relegation, and the opt-in location flow for `users."geoCell"` (a ~5 km cell truncated **on the device**; coordinates never reach the server).

### Study Challenge (weekly head-to-head between friends)
→ See [docs/STUDY_CHALLENGE.md](./docs/STUDY_CHALLENGE.md) — **DESIGN/DRAFT**: a Monday-issued, Friday-played challenge between two friends over a 10-word set — the same-word vs different-word variants, the 04:00-local week boundaries, generated (non-editable) challenge decks that don't count against the 100-deck cap, the `mastered-first` provisioning mode, the per-game contested/filler scoring contract every recognition/production game must now implement, and results/no-contest. Live (synchronous) mode is deferred to phase 2.

### Practice Writing (character writing-practice drill)
→ See [docs/PRACTICE_WRITING.md](./docs/PRACTICE_WRITING.md) — the "Practice Writing Me" drill: four assistance levels (Trace / Step Through / Memorize / Test), the 2×2 grid for multi-char words, the generalized modal lockout + greyed-background step-back, Memorize's study-first lock (no-writing badge + Start-Writing pulse), top-1 grading, and completion stars.
→ Recognition path (stroke format, backends, Google proxy, Hanzi Writer guide): [docs/HANDWRITING_RECOGNITION.md](./docs/HANDWRITING_RECOGNITION.md)

### Custom Card Icon Layout (flp)
→ See [docs/CARD_ICON_LAYOUT.md](./docs/CARD_ICON_LAYOUT.md) — per-word custom icon arrangements on flashcards: the back-face canvas editor (drag/resize/rotate up to 12 icons via gestures), the `iconLayout` jsonb on the vet tables (normalized coords), the icons8 search proxy + download-on-select, and the face-gating rule (icons render only on English-bearing faces).

### Example Sentences (est)
→ See [docs/EXAMPLE_SENTENCES.md](./docs/EXAMPLE_SENTENCES.md) — the est tab: AI-generated sentences rendered as tappable cpcd segments with definition popups. Covers the generation pipeline, segment enrichment, and **form modification** (contextually inflected English glosses via `wordForms` + `resolveWordForm`, zh only).

### CPCD Pinyin Shift (character + pinyin column spacing)
→ See [docs/CPCD_PINYIN_SHIFT.md](./docs/CPCD_PINYIN_SHIFT.md) — how `CPCDRow` spaces out long pinyin (rendered wider than its column): a long syllable stays centered over its char and pushes its immediate neighbors outward; opposing pushes cancel.

### Client Performance Diagnostics
→ See [docs/CLIENT_PERF_DIAGNOSTICS.md](./docs/CLIENT_PERF_DIAGNOSTICS.md) — real-user tap-latency telemetry (Event Timing / long tasks) for the prod-only footer/decks lag; sink at `POST /api/diagnostics/perf`, analyze with `server/scripts/analyze-client-perf.ts`

## 🔧 Troubleshooting

→ See [docs/troubleshooting/DOCKER_STARTUP_ISSUES.md](./docs/troubleshooting/DOCKER_STARTUP_ISSUES.md) — port conflicts, zombie processes, compose project name conflicts, network issues, password mismatches

## 🐳 Deployment & DevOps

### Deploying
Use the `/deploy` skill. It contains the full deployment procedure, server details, and migration steps.

#### ⚠️ Nonstandard deploys need a temp runbook committed alongside the change
If a change cannot be shipped by running `/deploy` as-is — an expand/contract migration
pair where the DROP must wait for the new code, a migration that must be held back from
`migrate.sh`, a cron/crontab change, a required manual backfill, an ordering constraint
between the DB and the code, anything needing a pre-deploy dump — then **write a temporary
runbook in `docs/` and commit it with the change**. Name it `docs/<FEATURE>_DEPLOY_RUNBOOK.md`.
The agent doing the deploy is not the agent that wrote the code and cannot infer these steps
from the diff.

The runbook must state: the exact **step order**, which migrations are safe to auto-run vs.
held back, **copy-pasteable verification SQL with the expected result**, what to do when a
check fails, the rollback path, and any user-visible behaviour change to expect. Mark it
**TEMPORARY** at the top with a "delete once verified on prod" note, and say plainly whether
it has been deployed yet. Delete the file once prod is verified.

#### Migration number collisions — just renumber, don't ask
Work happens on more than one machine, so two branches can independently claim the same
migration number (e.g. two files numbered `142`). When you find a collision, **resolve it
yourself as part of the deploy prep** — do not stop to ask which number wins. Rules:

1. **Only renumber migrations that have not reached any database.** Check
   `schema_migrations` (and the runbook's "not yet on prod" status). A migration that has
   been applied anywhere is immutable — renumber the other one.
2. **Order by deploy constraint, not by authorship date.** Migrations that must run
   *before* the new code get the lower numbers; any **held-back / contract** migration
   (one that must run *after* the code) gets the **highest** number in the batch, because
   `migrate.sh` applies everything above `MAX(version)` in order and cannot skip a gap.
3. **Renumber whichever file is cheaper to move** — count the references (`grep -rn
   "migration N"`) and rename the one with the smaller footprint, unless rule 2 forces the
   other way.
4. `git mv` the file, then fix **every** reference: the migration's own header comment, its
   runbook, the CLAUDE.md runbook line, and all code comments/doc mentions. Leave a short
   note in the runbook saying it was renumbered and why.

Current open runbooks: **none.** Prod is current through migration **149**.

Deployed and retired on 2026-08-17 (runbook deleted): Study Challenge phase 1 async
(**148**), the dead `compute_utcm_category` drop (**147**) and the lifetime-mark-counter
drop (**149**). This batch could **not** be applied in one `migrate.sh` pass, and the
runbook did not say so: **148 had to land before the rebuild** (the shipped deck read
selects `decks."editMode"`, so old schema + new code 500s `/decks`) while **149 had to
land after it** (it drops `vet."totalMarkCount"`/`"totalCorrectCount"`, which the old code
still wrote on every mark). 147+148 were applied by hand with their tracking rows, then
the containers were rebuilt, then `migrate.sh` picked up 149 alone. **When a batch mixes
expand and contract migrations, split it around the rebuild rather than trusting a single
`migrate.sh` run.** The deploy also re-rendered the systemd units via
`database/cron/install-timers.sh` — a git pull does not roll out a unit-template change,
and until it does the feature's whole time-triggered half stays inert while everything
else works; the `Description=` line is the tell that it took.

Deployed and retired on 2026-08-16 (runbooks deleted): the `user_language_points` →
`user_languages` rename (145) and Arena (146), which also installed the **`cow-arena`**
hourly systemd timer via `database/cron/install-timers.sh` — **renamed** from
`install-maintenance-timer.sh`; it now installs both `cow-maintenance` and `cow-arena`.
Retired in the same pass, having shipped earlier and been verified on prod after the
fact: per-language minute points (130, 134), provisional cards (140), unit-slot unlocks
(cron SQL only). Earlier, on 2026-08-11: collection Sort by + `masteredAt` (142), three
mastery bars (143), `sortable` drop (144).

> ⚠️ **A runbook's own status line is not evidence.** Four of the runbooks retired above
> still read "not yet on prod" when their migrations had already been applied — the
> 2026-08-16 deploy nearly acted on that, and the remedy (`--allow-out-of-order`) would
> have suppressed the guard that was correctly reporting the mismatch. **Always derive
> pending work from `schema_migrations` and a `migrate.sh --dry-run`**, and treat any
> disagreement with a runbook as the runbook being stale. Two runbooks still carrying
> false "NOT YET DEPLOYED" banners are tracked in [docs/DEFERRED_WORK.md](./docs/DEFERRED_WORK.md).

The loose end from the 2026-08-11 deploy (the dead `compute_utcm_category`) is tracked in
the deferred-work list below.

### Deferred work (the "do it later" queue)
→ See [docs/DEFERRED_WORK.md](./docs/DEFERRED_WORK.md) — work that is known, agreed, and
deliberately not being done yet: outstanding contract migrations, safe cleanup, and
explicitly postponed decisions. Add an item here rather than leaving a `⚠️` in a feature
doc that nobody re-reads. **Not** for bugs, and not for feature design questions (those
belong in the owning doc's question log).

### Data Deployment (syncing `dictionaryentries_zh` to prod)
→ See [docs/DATA_DEPLOYMENT_GUIDE.md](./docs/DATA_DEPLOYMENT_GUIDE.md)

### Docker Commands & Setup
→ See [docs/DOCKER_COMMANDS.md](./docs/DOCKER_COMMANDS.md)
→ See [docs/DOCKER_GUIDE.md](./docs/DOCKER_GUIDE.md)

### HTTPS/SSL Setup
→ See [docs/HTTPS_SETUP_GUIDE.md](./docs/HTTPS_SETUP_GUIDE.md)

### Deployment Checklist
→ See [docs/deployment-checklist.md](./docs/deployment-checklist.md)

### Deployment Guide
→ See [docs/deployment-guide.md](./docs/deployment-guide.md)

### Windows/WSL Migration
→ See [docs/WSL_TO_WINDOWS_MIGRATION_GUIDE.md](./docs/WSL_TO_WINDOWS_MIGRATION_GUIDE.md)

## 🤖 MCP Servers

### Puppeteer
The Puppeteer MCP server is available for browser automation and screenshots. Since this environment runs as root, every `navigate` call must include `allowDangerous: true` and the `--no-sandbox` flags:

```json
{
  "url": "https://...",
  "allowDangerous": true,
  "launchOptions": {
    "headless": true,
    "args": ["--no-sandbox", "--disable-setuid-sandbox"]
  }
}
```

Available tools: `puppeteer_navigate`, `puppeteer_screenshot`, `puppeteer_click`, `puppeteer_fill`, `puppeteer_evaluate`, `puppeteer_hover`, `puppeteer_select`.

## 🧪 Testing & Data

### Test Users
→ See [docs/TEST_USERS.md](./docs/TEST_USERS.md)

### Backfill Scripts
→ See [README_BACKFILL_SCRIPT.md](./README_BACKFILL_SCRIPT.md)

### AI Enrichment Testing
→ See [docs/AI_ENRICHMENT_TEST_GUIDE.md](./docs/AI_ENRICHMENT_TEST_GUIDE.md)

## 📋 Contributing

For contribution guidelines:
→ See [server/CONTRIBUTING.md](./server/CONTRIBUTING.md)

For design guidelines:
→ See [docs/designGuidelines.md](./docs/designGuidelines.md)

For layering rules (where a file goes, and which layer may do what):
→ Server: [docs/BACKEND_LAYERING.md](./docs/BACKEND_LAYERING.md) — Controller/Service/DAL, "a service does not write SQL", the transaction exception, camelCase API paths, `migrate.sh`
→ Client: [docs/FRONTEND_LAYERING.md](./docs/FRONTEND_LAYERING.md) — `features/` ÷ `pages/` ownership, engine has no back-edge to features, all server calls via `src/api/http.ts`, **no API function takes a `token`**

## How to Use This Guide

1. **Read this file first** to find the relevant documentation for your task
2. **Navigate to the specific doc** mentioned in the arrow (→)
3. **Follow the detailed instructions** in that document
4. If you need more context, check related documentation links

# User-Defined Rules

## Behavior
- Give your input on the software design.
- Offer to rename variables and columns to be more accurate and descriptive.
- Look for places to clean up duplicated and unused code.
- Leave descriptive comments as you code.
- Bring up inconsistencies in the code and database when you find them.
- Describe the design in terms of which layer each component belongs to.
- When you present information to the user, use nice formatting techniques to make the content easily digestible for the user.
- Always use descriptive class names for all HTML components
- When a terminal command should be run on this machine, do not tell the user to run it, you should try to run it yourself first.
- In all locations where the code doesn't quite seem to make sense or have a clear goal, flag it and bring it to my attention. Tell me what your guess is for what the code does and tell me how you would clarify/improve it.
- Make sure to confirm all new tables and columns with me in a question form.
- Don't automatically validate with puppeteer. I will let you know if I want you to use puppeteer.

## Code Quality Standards
When reviewing or writing code, actively look for and address:
- **Duplicate code** — if the same logic appears 2+ times, extract it into a shared function, hook, or utility
- **Large files** — files over ~300 lines should be evaluated for splitting into focused modules (controllers, hooks, utils, etc.)
- **Non-robust patterns** — missing null/undefined guards, unchecked array access, `JSON.parse` without try-catch, fire-and-forget promises without `.catch()`, unvalidated external inputs
- **Potential failure paths** — database clients not released in all branches, missing error handling in async code, `Promise.all` failing mid-batch without individual error capture
- **Complex code without comments** — algorithms, non-obvious state management (stale closure workarounds, ref sync patterns), and transaction flows should have inline comments explaining *why*, not just *what*

### ⛔ Never reload/reset a page on a silent token refresh
The access token rotates every ~15 min, so the `token` from `useAuth()` **changes
identity on every refresh** while the session is unchanged. A data-load or
state-reset `useEffect` **must key on a stable auth identity** (`user?.id` or
`isAuthenticated`), **never on `token`** — keying on `token` re-runs the effect on
each refresh and wipes in-progress UI (this caused a mid-game Word Search reset,
2026-07-02). `token` is fine *inside* a fetch callback's header (it self-heals via
the interceptor); if such a callback *drives* a load effect, build its header with
`authHeader()` (`src/utils/authHeader.ts`) and drop `token` from its deps.
Full rule + rationale + converted-sites list:
→ [docs/TOKEN_EXPIRATION_IMPLEMENTATION.md](./docs/TOKEN_EXPIRATION_IMPLEMENTATION.md) (§ "Client rule: never reload/reset a page on a silent token refresh")

## Documentation
Do not add to CLAUDE.md without asking me. Generally speaking I would like new documents to be linked as grandchild documents to CLAUDE.md so that this file does not grow too large.

### Dependency Documentation
When writing functions, always write down which docs depend on or reference the code being written. In addition, when writing docs, add to each section which code it references or depends on.

**Cite by file path + symbol name, never by line number.** Good:
`server/services/OnDeckVocabService.ts` → `fetchFlpCandidates`. Bad:
`OnDeckVocabService.ts:645`. A line number is correct only until the next edit to that
file — a 2026-08-16 audit found 105 such citations across 25 docs, several already
pointing past the end of their file and many landing on a blank line or an unrelated
statement. A symbol name survives every edit that does not delete the symbol, and when
it *is* deleted the dangling name is a useful signal rather than a silently-wrong number.

When editting code, check the referenced documentation and update it if need be. When editting documentation, check the referenced code to see if there is alignment.

When implementing features, make sure the document referencing the system/component/mechanism in question has a section on the new behavior/feature.