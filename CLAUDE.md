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
- **Docker Setup**: See [README_DOCKER.md](./README_DOCKER.md)
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
| **Chinese det** (cdet) | `dictionaryentries_zh` | surrogate `id`; looked up by `word1` (+ `language`) | The original rich table, **renamed from `dictionaryentries` (migration 57)** and now Chinese-only. Holds Chinese (`zh`) data plus all CJK-style enrichment columns (`numberedPinyin`, `tone`, `hskLevel`, `breakdown`, `classifier`, etc.). A `gender` column exists (migration 55) but is NULL for Chinese. |
| **Spanish det** (sdet) | `dictionaryentries_es` | logical key **(`word1`, `pos`, `gender`)**, enforced by a `UNIQUE NULLS NOT DISTINCT` constraint (surrogate `id` PK) | Schema = clone of `dictionaryentries_zh` + scalar `pos` + `etymology` (Wiktionary etymology text, migration 59) + `raw` (jsonb source blocks). `longDefinition` is reserved for the AI definition-elaboration backfill, NOT etymology. Gender-homographs are **separate rows** (e.g. `cura`/n/f = "cure" vs `cura`/n/m = "priest"), because gender carries distinct meaning in Spanish. `gender` holds a cleaned primary token (`m`, `f`, `mf`, `mfbysense`, `m-p`, …); `?`/unknown is NULL. |
| **Affixes** | `affixes` | (`language`, `affix`, `type`) | Bound morphemes for ALL languages. Kept out of the det tables because they are not standalone headwords. `type` ∈ {`prefix`,`suffix`,`interfix`,`infix`} (migration 61 added interfix/infix for Spanish `-i-`/`-x-`). `gender` ∈ {`m`,`f`,NULL} and `number` ∈ {`s`,`p`,NULL} (migration 61) carry the singular/plural + gender caveats for inflected affix forms (e.g. `-eada` = feminine singular of `-eado`). |

Why the split: Chinese identity is essentially `word1`; Spanish identity needs
`pos` + `gender` to keep semantic homographs distinct. Rather than overload one
schema, each gets its own table. Source for Spanish/affixes: `doozan/spanish_data`
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
`dictionaryentries_zh`), 58 (create `dictionaryentries_es`), 59 (es etymology), 60 (affixes), 61 (affix gender/number + interfix/infix).

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
An hourly Postgres cron on the prod server (a) breaks stale streaks (mirroring `UserMinutePointsService.newDayOperation`) and (b) debits 10 minute points per local day of continued inactivity from any user with `totalMinutePoints > 0`, until they hit zero. Not installed on dev.
→ See [docs/STREAK_EXPIRATION_CRON.md](./docs/STREAK_EXPIRATION_CRON.md)

### Flashcards & Review History
→ See [docs/FLASHCARD_REVIEW_HISTORY_IMPLEMENTATION.md](./docs/FLASHCARD_REVIEW_HISTORY_IMPLEMENTATION.md)

### Vocabulary Enrichment
→ See [docs/VOCAB_ENRICHMENT_IMPLEMENTATION.md](./docs/VOCAB_ENRICHMENT_IMPLEMENTATION.md)

### Definition Mapping
→ See [docs/DEFINITION_MAPPING.md](./docs/DEFINITION_MAPPING.md) — index of every definition *form* across the app (flat `definitions`, lead gloss, dd, `shortDefinition`, `longDefinition`, per-segment defs) and the enrichment operations that transform one into the next.
  → Sense clustering: [docs/DEFINITION_CLUSTERS.md](./docs/DEFINITION_CLUSTERS.md) — splitting `definitions` into orthogonal sense clusters (`definitionClusters`, migration 90); per-cluster reading + 1–5 vernacular score.

### Character Breakdown Feature
→ See [docs/BREAKDOWN_FEATURE_IMPLEMENTATION.md](./docs/BREAKDOWN_FEATURE_IMPLEMENTATION.md)

### User Document Feature
→ See [docs/USER_DOCUMENT_FEATURE_SUMMARY.md](./docs/USER_DOCUMENT_FEATURE_SUMMARY.md)

### Night Market
→ See [docs/NIGHT_MARKET_FEATURE.md](./docs/NIGHT_MARKET_FEATURE.md)
→ Templates (layout authoring/tiling): [docs/NIGHT_MARKET_TEMPLATES.md](./docs/NIGHT_MARKET_TEMPLATES.md)
→ Pedestrian movement: [docs/PEDESTRIAN_WALKING_ALGORITHM.md](./docs/PEDESTRIAN_WALKING_ALGORITHM.md)
→ Tile/street graph invariants: [docs/NIGHT_MARKET_GRAPH_ASSUMPTIONS.md](./docs/NIGHT_MARKET_GRAPH_ASSUMPTIONS.md)

### UX & Navigation
→ See [docs/UX_AND_NAVIGATION.md](./docs/UX_AND_NAVIGATION.md) — umbrella for navigation + the mobile shell: app navigation structure (footer tabs + `/` Home menu + back-arrow drill-ins), the `MobileTabScreen` scroll-away-header layout, the **Leaf**/**Node** drill-in archetypes, the Discover two-level surface, and the global touch/scroll/selection rules.

### Games
→ See [docs/GAMES_FEATURE.md](./docs/GAMES_FEATURE.md)

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
When writing functions, always write down which docs depend on or reference the code being written. In addition, when writing docs, add to each section which lines of code in which files the sections references or depends on.

When editting code, check the referenced documentation and update it if need be. When editting documentation, check the referenced code to see if there is alignment.

When implementing features, make sure the document referencing the system/component/mechanism in question has a section on the new behavior/feature.