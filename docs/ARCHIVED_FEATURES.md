# Archived Features

Features that were built, then deliberately removed from `main` with their code kept on a
frozen git branch so they can be revived quickly. Nothing here is live: no route, no
table, no cron step. Start from the archive branch's `archive/REVIVAL.md`, not from this file.

## Night Market + Immersive World (removed 2026-11-09)

| | |
|---|---|
| **Branch** | `archive/night-market-immersive-world` (on `origin`) |
| **Tag** | `archive/night-market-immersive-world-2026-11-09`: points at the branch's first archive commit (`29a568d`). The branch head only adds corrections to `REVIVAL.md`, so read that file from the branch. |
| **Base commit** | `750193f` — the last `main` commit that contained both features |
| **Revival guide** | `archive/REVIVAL.md` on that branch: what each feature was, every file deleted, every wiring point in shared files, the revival checklist, known debt |
| **Schema** | `archive/schema.sql` on that branch — `pg_dump --schema-only` of the eight tables (no data was kept, by decision) |
| **Docs** | All NM/IW design docs live only on the branch: `NIGHT_MARKET_*.md`, `PEDESTRIAN_WALKING_ALGORITHM.md`, `LUMEISH_ASSET_PIPELINE.md`, `IMMERSIVE_WORLD.md` |
| **Drop migration** | `database/migrations/185-drop-night-market-and-immersive-world.sql` |
| **Deploy** | [NM_IW_REMOVAL_DEPLOY_RUNBOOK.md](./NM_IW_REMOVAL_DEPLOY_RUNBOOK.md) (temporary) |

```bash
git fetch origin archive/night-market-immersive-world
git show origin/archive/night-market-immersive-world:archive/REVIVAL.md
```

**What they were.** *Night Market*: an isometric market continent (Pixi) that grew from
authored templates as a learner earned minute points, decayed by the inactivity cron.
*Immersive World*: authored scenes on the same iso engine where AI NPCs held a Chinese
conversation with the learner. Both were behind feature flags that were OFF before removal.

**Dropped from the database (migration 185):** `nightmarketunlocks`,
`nightmarkettemplatelocations`, `nightmarkettemplatedefinitions`,
`nightmarkettemplatesandbox`, `iw_scenes`, `iw_scene_runs`, `iw_scene_ratings`,
`iw_npc_memories`, the column `users."isTemplateAuthor"`, and the cron-installed function
`nightmarket_unlocks_for_minutes(int)`. The old creating migrations (47, 107–118, 158–163,
167) stay in `database/migrations/` as history.

**Left on `main`, now without their original caller.** These were built for Immersive
World but are generic, so they were kept. Each is a candidate for removal or reuse. The
list is tracked in [DEFERRED_WORK.md](./DEFERRED_WORK.md).

| Remnant | Where |
|---|---|
| TTS per-call `voice`, `prepare()` (audio-as-clock duration), `stamp: false` | `src/hooks/useTTS.ts`, `src/services/tts/*`, `server/controllers/TTSController.ts` |
| `english-first` dictionary search ranking (the IW hint tray's) | `server/dal/implementations/DictionaryDAL.ts`, `server/contracts/wire.ts` |
| Public sentence-segmentation helper for NPC lines | `DictionaryDAL` / `IDictionaryDAL` |
| `users.gender` / `users."birthDate"` (migration 164), asked at Register and in Settings | `src/utils/demographics.ts`, `src/pages/settings/AboutYouSections.tsx`, `server/services/UserService.ts` |
| `formatDuration`'s Night-Market-badge option | `src/utils/formatDuration.ts` |

**Moved, not removed:** the Beginner Keyboard recognizer debug dump now rides
`users.isFeatureTester` (it rode `isTemplateAuthor`). See `src/features/beginnerKeyboard/BeginnerKeyboardProvider.tsx`.
