# Deploy Runbooks — open index + deploy history

Index of the **temporary** `docs/*_DEPLOY_RUNBOOK.md` files that still need a PPE action
or verification, plus the history of retired runbooks and the lessons their deploys
taught. The rule for *when* to write a runbook and what it must contain lives in
CLAUDE.md § "Nonstandard deploys need a temp runbook"; the deploy procedure itself is the
`/deploy` skill (`.claude/commands/deploy.md`).

**Maintaining this file:**
- Writing a runbook → add a row to the open table below.
- Deploying → update the row's status (and the runbook's own banner).
- Verifying on PPE → delete the runbook file, remove its row, and add a short
  "Deployed and retired" entry to the history, keeping anything worth remembering.

> ⚠️ **A status here is not evidence.** Derive pending migrations from
> `schema_migrations` and `migrate.sh --dry-run`, and treat any disagreement as this
> file (or the runbook banner) being stale.

PPE is current through migration **174** (2026-10-06).

## Open runbooks

| Runbook | What | Status | Still open because |
|---|---|---|---|
| [EXAMPLE_SENTENCE_TARGET_INDEX_DEPLOY_RUNBOOK.md](./EXAMPLE_SENTENCE_TARGET_INDEX_DEPLOY_RUNBOOK.md) | Example-sentence target index + per-occurrence tags. **No migration**; needs the manual `--locate-targets` heal on PPE | **NOT YET DEPLOYED** | Everything: deploy, heal, verify |
| [MEMORY_MAP_SLOTS_DEPLOY_RUNBOOK.md](./MEMORY_MAP_SLOTS_DEPLOY_RUNBOOK.md) | Memory Map slot tree (migration **173**, contract) | Deployed 2026-10-06 | Someone must open Memory Map on PPE and see a full, tilted 50-tile map |
| [DROP_SHORT_DEF_OVERRIDE_DEPLOY_RUNBOOK.md](./DROP_SHORT_DEF_OVERRIDE_DEPLOY_RUNBOOK.md) | 164 + 165 before the rebuild, contract drop 166 after it; `searchReadings` backfill | Deployed 2026-09-24 | Someone must run a logged-in dictionary search for 行 and see results |
| [IW_SCENE_NOTES_DEPLOY_RUNBOOK.md](./IW_SCENE_NOTES_DEPLOY_RUNBOOK.md) | iw scene notes + scene events (migrations **160**, **161**; expand-only, applied BEFORE the rebuild because the shipped `ImmersiveWorldDAL` selects both columns by name) | Deployed 2026-09-05; notes/events confirmed 2026-09-06 | Someone must confirm a HALF-BUILT scene saves with amber warnings rather than being refused |
| [GLOSS_CONFUSABILITY_PHASE2_RUNTIME_RUNBOOK.md](./GLOSS_CONFUSABILITY_PHASE2_RUNTIME_RUNBOOK.md) | Gloss phase-2 half B, the runtime guard (**no migration**) | Deployed 2026-08-24; infrastructure checks passed | Someone must open a real game board and confirm it fills rather than coming back short (the one over-blocking symptom the checks cannot see) |

## Deploy history and lessons

Deployed 2026-09-05 (second deploy of the day, **no runbook** — and that was correct):
place interactions (**162**, `iw_scenes.interactions`). A single expand-only migration
applied by `migrate.sh` before the container rebuild is the *standard* procedure this
skill already describes, so it needs no temp runbook; write one only when the deploy
cannot be `/deploy` as-is. The usual ordering reason applied — the shipped
`ImmersiveWorldDAL` selects `iw_scenes.interactions` by name, so old schema + new code
would 500 every scene read. Verified after applying: the column landed NOT NULL
defaulting to `'{}'::jsonb` and PPE's single existing scene backfilled in one pass.

Deployed and retired on 2026-09-05 (runbook deleted): Immersive World scene authoring
(**159**). Its one open condition — an author opening the editor and saving a scene — was
closed by the scene "Get Dinner" appearing in PPE's `iw_scenes` before the 160/161 deploy.

Worth keeping from it: a contract migration that was nevertheless a **single-pass** deploy. It
drops `iw_scenes.words` / `.objective`, reshapes `iw_scene_runs."complicationId"` into a
`TEXT[]`, and adds start facings — normally that ordering must land *after* the rebuild (the
2026-08-17 lesson), but **no shipped code read either table** (the feature is unreleased) and
both were empty, so there was no old-code window to split around. The runbook made that
assumption a **pre-check** rather than a claim, which is the part to copy: `scenes = 0`,
`runs = 0` was verified on PPE before `migrate.sh` ran.

Deployed and retired on 2026-09-04 (runbook deleted): the Chinese typeface account setting
(**157**, `users."chineseFont"`) shipped alongside the immersive-world schema (**158**).
Both are expand-only, so a single `migrate.sh` pass before the container rebuild covered
them — 157 had to go first for the usual reason (the shipped `UserDAL.findById` selects
`users."chineseFont"` by name, so old schema + new code 500s *every* authenticated
request), and 158 creates four brand-new `iw_*` tables no shipped code reads yet, which no
ordering can break. Verification matched the runbook exactly: the column landed NOT NULL
defaulting to `975-maru`, and all 71 pre-existing accounts backfilled to `noto-sans-sc` in
a single row. **The 2026-09-02 lesson repeated verbatim** — PPE again held uncommitted
tracked work (the `backfill-icons` v2 LLM acceptability judge, authored on PPE because the
hourly oracle cron runs there), and it was again committed and pushed **from PPE** before
the dev branch, keeping the pull a fast-forward. Treat this as the norm, not the exception:
PPE always has local work, and `git status --short` on PPE is the only thing that shows it.

Deployed and retired on 2026-09-02 (runbook deleted): the Study Challenge shelf-system
redesign (**156**, `study_challenges.taunts`). Applied BEFORE the container rebuild as its
runbook required — the shipped `StudyChallengeDAL` selects `taunts` by name, so old schema
+ new code 500s every challenge read (the same shape as 152's `users."arenaMessage"`). The
deploy also surfaced a second habit worth keeping: **PPE's checkout had four uncommitted
tracked files** (oracle cron `ORACLE_LANGS`, the es backfill `--stale`/`--words=` fixes),
authored on PPE because the hourly oracle cron runs there. They were committed and pushed
from PPE *before* the dev branch was pushed, so the pull was a fast-forward rather than a
conflict. Always run `git status --short` on PPE during the divergence check — the
ancestor/descendant counts alone report `0 0` for a PPE that has real uncommitted work.

> **A rubric/prompt change does NOT need a runbook.** Bumping a backfill's
> `SCRIPT_VERSION` (+ its `requiredScripts.js` entry) makes every already-enriched row a
> candidate again, and rows heal in place — deploy normally and drain with
> `run-lazy-enrichment.js`. See
> [DISCOVER_LAZY_ENRICHMENT.md](./DISCOVER_LAZY_ENRICHMENT.md) § 5a for the two
> limits (partial coverage, and `--stale` vs `--rescore-only` on the clusterer).

Gloss confusability shipped in two halves on 2026-08-24, and the split is worth
remembering as a pattern: **half A** (migration 154 + the dev→PPE `gloss_meaning_groups`
push, 7647 rows / 5076 groups) was inert by construction because no shipped code read the
table, so it could land with zero user-visible risk; **half B** (the runtime guard in
`OnDeckVocabService` → `getGameVocabPool` / `getWordSearchGrid`) then became a pure code
deploy with no data step attached. Half B has **no feature flag** — it went live the moment
the containers rebuilt. Rollback for both is still `TRUNCATE gloss_meaning_groups;` with no
code change, but note it now turns a live feature OFF rather than reverting an inert table.

Deployed and retired on 2026-08-23 (runbook deleted): the arena message column (**152**)
and the card-fill repaint remap (**153**). Split around the rebuild exactly as its runbook
required — 152 first, because the shipped `UserDAL.findById` selects `users."arenaMessage"`
by name and old schema + new code 500s *every* authenticated request, not just the arena;
then the rebuild; then 153, which only remaps stored `vet."cardColor"` hexes and is
order-independent. 153's remap touched 2 rows, and the runbook's stale-fill check returned 0.

Deployed and retired on 2026-08-17, second deploy of the day (runbook deleted): the
Study Challenge week-counter migration (**150**), which renamed
`study_challenges."weekStart"` (timestamptz) to `"weekIndex"` (integer weeks since
Monday 2026-01-05 UTC). A rename has no both-versions-work window, so it was applied
**before** the container rebuild, per its runbook. One wrinkle worth remembering: 150
carries its own `BEGIN`/`COMMIT`, and `migrate.sh` already wraps each file in a
transaction — the run printed `WARNING: there is already a transaction in progress`
and `WARNING: there is no transaction in progress`. It applied and recorded correctly,
but **migration files should not open their own transaction**; the file's `COMMIT`
closes the runner's, so the tracking `INSERT` lands outside it and the all-or-nothing
guarantee is lost.

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
Retired in the same pass, having shipped earlier and been verified on PPE after the
fact: per-language minute points (130, 134), provisional cards (140), unit-slot unlocks
(cron SQL only). Earlier, on 2026-08-11: collection Sort by + `masteredAt` (142), three
mastery bars (143), `sortable` drop (144).

> ⚠️ **A runbook's own status line is not evidence.** Four of the runbooks retired above
> still read "not yet on PPE" when their migrations had already been applied — the
> 2026-08-16 deploy nearly acted on that, and the remedy (`--allow-out-of-order`) would
> have suppressed the guard that was correctly reporting the mismatch. **Always derive
> pending work from `schema_migrations` and a `migrate.sh --dry-run`**, and treat any
> disagreement with a runbook as the runbook being stale. Two runbooks still carrying
> false "NOT YET DEPLOYED" banners are tracked in [docs/DEFERRED_WORK.md](./DEFERRED_WORK.md).

The loose end from the 2026-08-11 deploy (the dead `compute_utcm_category`) is tracked in
[DEFERRED_WORK.md](./DEFERRED_WORK.md).
