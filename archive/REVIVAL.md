# Archived: Night Market + Immersive World

**This branch is frozen.** It is `main` at commit `750193f` (2026-11-09), the last commit
in which the Night Market (NM) and Immersive World (IW) features existed, plus this
`archive/` folder. On `main` both features were deleted on 2026-11-09 and their tables
dropped. Both were already behind feature flags that were OFF (`nightMarket` since
2026-09-25, `immersiveWorld` since launch) — see `server/contracts/featureFlags.ts`.

- Branch: `archive/night-market-immersive-world`
- Tag:    `archive/night-market-immersive-world-2026-11-09` (points at the branch's first archive
  commit; the branch head adds corrections to this file only — read REVIVAL.md from the branch)
- `main` keeps a pointer doc: `docs/ARCHIVED_FEATURES.md`

Everything in this tree still builds and runs as it did on 2026-11-09. To revive a
feature, you are porting code from this branch onto a newer `main`, not merging the branch.

---

## 1. What each feature was

| Feature | One-line summary | Design docs (in this branch) |
|---|---|---|
| **Night Market** | An isometric market continent that grows as a learner earns minute points: authored rectangular **templates** are stitched together, earned **unlocks** become **occupants** in template **placeholder slots**, pedestrians walk a street graph recovered from the stitched cells, and the inactivity cron decays occupants when a streak breaks. | `docs/NIGHT_MARKET_FEATURE.md` (entry point), `NIGHT_MARKET_TEMPLATES.md`, `NIGHT_MARKET_TEMPLATE_EDITOR.md`, `NIGHT_MARKET_TEMPLATE_SANDBOX.md`, `NIGHT_MARKET_TEMPLATE_RUNTIME_PLAN.md` (status tracker), `NIGHT_MARKET_TERRAIN_CHUNKING.md`, `NIGHT_MARKET_GRAPH_ASSUMPTIONS.md`, `PEDESTRIAN_WALKING_ALGORITHM.md`, `LUMEISH_ASSET_PIPELINE.md`, `CONSTRUCTS.md` § TileDef / graphs |
| **Immersive World** | Authored scenes on the same iso engine where AI-driven NPCs speak Chinese to the learner (turn budget, model ladder, NPC memories, scene runs + ratings), with a desktop scene editor. Audio-as-clock TTS reveal. | `docs/IMMERSIVE_WORLD.md` (6k lines — the whole design + question log) |

Glossary of NM terms (all defined in the docs above): *template*, *version* / *active
version* (recompute-on-read), *condition*, *placeholder area* / *slot*, *occupant*
(= a `nightmarketunlocks` row), *placement* (= a `nightmarkettemplatelocations` row),
*hub* (the starter template), *edge signature*, *anchor*, *lazy spawn*, *dangling prune*,
*communal cell*, *street recovery*, *tile graph* / *street graph*, *POI*, *ped*.

## 2. Code that was deleted wholesale from `main`

Copy these back as-is.

**Client**
- `src/features/nightmarket/` — pages (`NightMarketEnginePage`, `NightMarketVisitPage`,
  `TemplateEditorPage`, `TemplateSandboxPage`), Pixi viewers, `pixiRuntime.ts`
- `src/features/immersiveworld/` — scene editor + `play/` (`IWWorldPage`, `IWPlayPage`)
- `src/engine/market/` — the shared iso engine (isometric math, terrain, tilesets, templates,
  stitching, graphs, pedestrians, camera)
- `src/engine/iw/`, and `src/engine/__tests__/enginePurity.test.ts` (the whole `src/engine/` tree)
- `src/hooks/useCameraControls.ts`, `usePixiPedestrians.ts`, `useArrowPagedIndex.ts`
- `src/__tests__/`: `anchorFlankBan`, `cameraFit`, `cameraFollow`, `cameraZoom`,
  `continentSeal`, `houseStrips`, `placeholderAreaSync`, `templateTouchPreference`,
  `unlockScheduleSqlSync`, `capDeprioritization`, `maximinSpreadBounds` tests
- `src/assets/free-assets/`, `src/assets/test-assets/` (incl. `lumeish/`), `src/assets/iw-popups/`
- `scripts/normalize-lumeish.mjs`
- npm deps: `pixi.js`, `@pixi/react`

**Server**
- Controllers: `NightMarket{,Template,Sandbox,World}Controller`, `ImmersiveWorld{Scene,Runtime}Controller`
- Services: `NightMarket{,Template,Sandbox,World,Placement}Service`, `ImmersiveWorld{,Scene}Service`, `services/iw/`
- DAL: `NightMarket{,Placement,Sandbox}DAL`, `ImmersiveWorldDAL` (+ interfaces)
- `dal/shared/`: `continentSeal`, `placeholderArea`, `templatePlacement`, `templatePrune`,
  `unlockSchedule`, `unlockScheduleSql`, `versionSelection`
- Routes: `nightMarketRoutes`, `nightMarketTemplateRoutes`, `nightMarketSandboxRoutes`, `immersiveWorldRoutes`
- `config/nightMarketRegistry.ts`, `config/iwNpcs.ts`, `contracts/iw.ts`, `contracts/iwLineGuard.ts`,
  `types/nightMarket.ts`, `types/iwNpc.ts`
- Scripts: `scripts/night-market/prune-dangling-templates.ts`, `scripts/iw-turn-probe.ts`,
  `scripts/iw-transcript.js`, `scripts/iw-route-probe.js`, `scripts/bench/npc-latency/`,
  `scripts/generate-unlock-schedule-sql.ts` (+ npm scripts `gen:unlock-schedule-sql`, `gen:lumeish-assets`)
- Tests: `server/__tests__/iw*.test.ts`, `versionSelection.test.ts`

**Ops / tooling**
- `.claude/commands/template-pull.md` (pulls authored templates PPE → local)
- `database/nightmarkettemplatedefinitions-*.{dump,txt}`

## 3. Wiring in shared files that was cut (re-add by hand)

| File | Symbol / spot | What it did |
|---|---|---|
| `server/server.ts` | route mounts under `isFeatureEnabled('nightMarket' / 'immersiveWorld')`; `validateStoredNpcIds(immersiveWorldDAL)` boot check | mounts the 4 routers; checks stored NPC ids against `config/iwNpcs.ts` |
| `server/dal/setup.ts` | NM + IW DAL/service/controller construction and exports | DI wiring (never flag-gated) |
| `server/contracts/featureFlags.ts` | `nightMarket`, `immersiveWorld` flags | on/off switch |
| `server/services/UserMinutePointsService.ts` | ctor param `nightMarketPlacementService`; `grantUnlocks` call in `incrementMinutePoints`; `adjustMinutesForAuthor` (+ `reconcileUnlocks`) | every banked minute grew the market; author ±N minute tool |
| `server/controllers/UserMinutePointsController.ts` | `adjustMinutes` handler (`POST /api/nightMarket/dev/adjustMinutes`) | author minute tool |
| `server/controllers/UserController.ts` | ctor param `nightMarketWorldService`; `seedNightMarketHub` in `register` + admin `createUser` | seeds the starter hub placement |
| `server/dal/implementations/UserDAL.ts`, `server/contracts/wire.ts` (`User.isTemplateAuthor`), `src/AuthContext.tsx` | `isTemplateAuthor` | author grant (column dropped — see § 4) |
| `server/services/UsageDashboardService.ts`, `dal/implementations/UsageStatsDAL.ts`, `contracts/usage.ts` | `immersiveWorld` usage metric (`iw_scene_runs`) | Usage dashboard row |
| `src/routes/registry.ts`, `src/routes/routeMeta.ts` | `/night-market*`, `/immersive-world*` routes | client routes |
| `src/components/menuPopover/menuDestinations.ts` | Night Market / Immersive World rows; Template Editor / Sandbox / Scene Editor author rows | menu entry points |
| `src/features/profile/UserProfilePage.tsx` | "Visit night market" button → `/night-market/user/:userId` | the only way to visit another user's market |
| `src/constants.ts` + `src/minutePoints/eligibility.ts` | `/immersive-world` prefix in the minute-earning admit list + exclusion | IW play earned minutes |
| `src/features/beginnerKeyboard/eligibility.ts` (`isKeyboardDisabledPath`) + `BeginnerKeyboardProvider.tsx` | route opt-out list for the two editors, and the BK debug dump's `isTemplateAuthor` gate | desktop editors used the OS keyboard |
| `src/minutePoints/eligibility.ts` | `MINUTE_POINTS_EXCLUDED_EXACT_PAGES` (`src/constants.ts`) | carved the IW scene list + editor out of the `/immersive-world` prefix |
| `src/data/tips.ts` | Night Market tip | tip box |
| `database/cron/expire-stale-streaks.sql` | `nightmarket_unlocks_for_minutes()` + the `decay_targets`/`decay_ranked`/`decay_delete` CTEs | trims occupants on a penalty |
| `database/cron/cow-maintenance.service.template`, `install-timers.sh` | second `ExecStart` running `dist/scripts/night-market/prune-dangling-templates.js` | dangling-template prune |
| `database/init/01-init-schema.sql`, `database/deploy/01-schema.sql` | NM/IW tables, `users."isTemplateAuthor"` | fresh-DB schema |

**Kept on `main`** (generic enough to survive, though IW was their first caller):
TTS `voice` option, `prepare()` and the audio-paced reveal hooks, the `english-first`
dictionary ranking (the IW hint tray's), (`src/services/tts/*`, `useTTS.ts`),
`DictionaryDAL` segment helper used for tappable NPC lines, `users.gender` /
`users."birthDate"` (migration 164 — asked at Register and in Settings, now with no reader), the Beginner Keyboard
inset/transition machinery.

## 4. Database

`archive/schema.sql` is a `pg_dump --schema-only` (dev, 2026-11-09, migrations ≤ 183)
of all eight tables, with indexes, constraints and comments:

| Feature | Tables |
|---|---|
| NM | `nightmarketunlocks` (occupants), `nightmarkettemplatelocations` (placements), `nightmarkettemplatedefinitions` (authored catalog), `nightmarkettemplatesandbox` |
| IW | `iw_scenes`, `iw_scene_runs`, `iw_scene_ratings`, `iw_npc_memories` |

Also dropped on `main`: column `users."isTemplateAuthor"` (BOOLEAN NOT NULL DEFAULT false,
migration 115) and the PPE function `nightmarket_unlocks_for_minutes(int)` (created by the
cron file). The Beginner Keyboard debug dump moved to `isFeatureTester`.

**No data was kept** — authored templates and scenes were deliberately not dumped. A
revival starts with an empty catalog.

The original migrations (47, 107–109, 112–118, 130's NM part, 158–163, 167) stay in
`database/migrations/` on `main` as history; the drop is migration
**185** (`database/migrations/185-drop-night-market-and-immersive-world.sql` on `main`).

## 5. Reviving a feature — checklist

1. Write ONE new forward migration from `archive/schema.sql` (the old migrations have
   already run and been reversed; do not re-run them). Add `users."isTemplateAuthor"` back
   if you want the author grant, and confirm the tables with the user first.
2. Copy the § 2 folders/files back onto `main`; `npm install pixi.js @pixi/react`.
3. Re-apply the § 3 wiring. Expect drift: shared files (`setup.ts`, `UserMinutePointsService`,
   `routeMeta`, the menu) will have moved on — port by intent, not by patch.
4. Restore the docs (§ 1) and the CLAUDE.md lines: abbreviations `nmp`, `nme`, `nms`,
   `ped`, `poi`; the "Night Market Coordinate System" section; the "Night Market" feature
   section linking FEATURE / TEMPLATES / PEDESTRIAN_WALKING / GRAPH_ASSUMPTIONS; the
   occupant-decay clause in the inactivity-cron paragraph; Night Market + Immersive World
   in the "flags switched OFF" list.
5. Re-add the cron branch + prune `ExecStart` (§ 3) and redeploy timers on PPE.
6. Known debt at archive time: nothing asserts the graph invariants S1–T2
   (`NIGHT_MARKET_GRAPH_ASSUMPTIONS.md`); TEMPLATES.md's edge-signature bit-order table
   disagrees with `outerEdgesOf`; `tileRegistry.ts` exports empty vestigial graphs; the
   baked-terrain chunking was never verified on a real screen.
