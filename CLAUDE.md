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
dp = discover page (aka sort cards page)
cdp = card detail page
pct = particles and classifiers table
nmp = night market page
ped = pedestrian
poi = point of interest
cdet = chinese dictionary entries table
sdet = spanish dictionary entries table
cvet = chinese vocab entries table
svet = spanish vocab entries table


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

When the user mentions coordinates for night market assets, they are always in isometric grid units (isoX, isoY). See `src/utils/isometric.ts` for the full coordinate system definition.

- **isoX** — distance along the isometric X axis (toward top-right on screen / east)
- **isoY** — distance along the isometric Y axis (toward top-left on screen / north)
- **Origin (0, 0)** — maps to the center of the viewport

All night market assets live at: `/home/cow/src/assets/`
(Note: this is different from `public/assets/` — Vite imports these directly as modules.)

## Touch & Scroll (mobile)
This is a mobile-first app built around drag gestures. Components you create should
default to `touchAction: "none"` so background/empty-area touches don't trigger the
browser's native pan/scroll (which fights the drag interactions). Only set a
scroll-permitting value (`auto`, `pan-y`, etc.) on a component when I explicitly tell
you it should be scrollable.

Text is **non-selectable by default app-wide** — `src/index.css` sets `user-select:
none` on `body` (it cascades to everything). Form fields (`input`/`textarea`/
`contenteditable`) are re-enabled there. The **only** selectable content exception is
**cpcd** (`.cpcd-row__chars` / `.cpcd-row__pinyin-cell`), and only on non-touch
devices — the `@media (hover: hover) and (pointer: fine)` block in `index.css` makes
cpcd selectable on desktop but keeps it non-selectable on mobile. Don't sprinkle
per-component `userSelect: "none"`; rely on the global default and only opt specific
content into `userSelect: "text"` (desktop-gated) when I call it out.

**Games must block the mobile edge-swipe-back gesture by default.** Every game page
should call `useBlockEdgeSwipe(true)` (`src/hooks/useBlockEdgeSwipe.ts`) so a swipe
from the left/right screen edge doesn't navigate away mid-drag. `touch-action: none`
does NOT stop this — the browser claims the history-navigation gesture before the
element sees the touch, so it must be cancelled at the touch-event layer. Reference
implementation: `src/games/bubble-match/BubbleMatchPage.tsx`.

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

### Character Breakdown Feature
→ See [docs/BREAKDOWN_FEATURE_IMPLEMENTATION.md](./docs/BREAKDOWN_FEATURE_IMPLEMENTATION.md)

### User Document Feature
→ See [docs/USER_DOCUMENT_FEATURE_SUMMARY.md](./docs/USER_DOCUMENT_FEATURE_SUMMARY.md)

### Night Market
→ See [docs/NIGHT_MARKET_FEATURE.md](./docs/NIGHT_MARKET_FEATURE.md)
→ Pedestrian movement: [docs/PEDESTRIAN_WALKING_ALGORITHM.md](./docs/PEDESTRIAN_WALKING_ALGORITHM.md)
→ Tile/street graph invariants: [docs/NIGHT_MARKET_GRAPH_ASSUMPTIONS.md](./docs/NIGHT_MARKET_GRAPH_ASSUMPTIONS.md)

### Games
→ See [docs/GAMES_FEATURE.md](./docs/GAMES_FEATURE.md)

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