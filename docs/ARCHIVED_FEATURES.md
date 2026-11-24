# Archived Features

Features that were built, then deliberately removed from `main` with their code kept on a
frozen git branch so they can be revived quickly. Nothing here is live: no route, no
table, no cron step. Start from the archive branch's `archive/REVIVAL.md`, not from this file.

## Bubble Match, Hydra Bubbles, Bucket Drop (removed 2026-11-23)

| | |
|---|---|
| **Branch** | `archive/bubble-match-hydra-bucket-drop` (local only so far; push with `git push origin archive/bubble-match-hydra-bucket-drop`) |
| **Base commit** | `f4664c6`: the last `main` commit that contained all three games |
| **Revival guide** | `archive/REVIVAL.md` on that branch: what each game was, every file deleted, every wiring point in shared files, the data deleted, the revival checklist |
| **Schema** | None dropped for the games themselves (`wins` / `game_personal_bests` are game-keyed). Their stored rows were deleted by `database/migrations/206-drop-game-framework-and-archived-game-rows.sql` |
| **Docs** | `docs/HYDRA_BUBBLES.md` and `docs/BUCKET_DROP_GAME.md` live only on the branch. Bubble Match's design sections were in `docs/GAMES_FEATURE.md` on that branch |

```bash
git show archive/bubble-match-hydra-bucket-drop:archive/REVIVAL.md
```

**What they were.** Three routed games with no live host. *Bubble Match* was a physics
bubble field where you drag a word onto its meaning. *Hydra Bubbles* was an endless,
clockless drill on the same field, with a two-colour payout ladder that lent cards by tier.
*Bucket Drop* sent the stack's top word into its meaning's bucket. Their pages sat behind the
OFF `standaloneGames` flag, the Games hub that linked them was deleted 2026-11-06, and none
had a live flp break, so no user could reach them.

**Moved, not removed:** the app-wide rule "cooldown is a hard next-markable-at" (formerly
HYDRA_BUBBLES.md § 8) now lives in
[FLASHCARD_REVIEW_HISTORY_IMPLEMENTATION.md](./FLASHCARD_REVIEW_HISTORY_IMPLEMENTATION.md)
§ "Cooldown is a hard next-markable-at".

**Removed with them, because it had no caller once they were gone:**
- `src/games/bubbles/`, the bubble field the two bubble games shared, and
  `src/games/runtime/GameEndPopup.tsx`.
- Hydra's card-pool options (`strictBuckets`, `lendLevelOffset`, rolling supply).
- The challenge scorer's `survival` bonus kind.
- The dead Games-hub launcher cluster (`GameCard`, `RoundPlayButton`, Word Search's hub
  tile/resume tile/launcher).

**Left on `main` without its caller:** `GET /api/onDeck/gamePool`'s `avoid` parameter
(Bubble Match's "Play Again").

## Home Screen (removed 2026-11-11)

| | |
|---|---|
| **Branch** | `archive/home-screen` (local only so far; push with `git push origin archive/home-screen`) |
| **Base commit** | `f276eb7`: the last `main` commit that contained the home screen |
| **Revival guide** | `archive/REVIVAL.md` on that branch: what it was, every file deleted, every wiring point in shared files, the revival checklist |
| **Schema** | None (client only) |
| **Docs** | `docs/HOME_SCREEN.md` lives only on the branch |

```bash
git show archive/home-screen:archive/REVIVAL.md
```

**What it was.** A stage of the Deck Tower the app opened on once per launch: td's own
platform and pawn standing above the tower on td's sky, a placeholder title, a Dictionary
keycap (circle transition to `/dictionary`, whose back arrow returned to td), and "Swipe down
to enter". A fresh pull past the deck's top went back up to it. Replaced by the launch screen
([LAUNCH_SCREEN.md](./LAUNCH_SCREEN.md)).

**Left on `main`, now without a caller** (tracked in [DEFERRED_WORK.md](./DEFERRED_WORK.md)):
`SpeedLines` `axis="y"`; `DeckTowerPlatform`'s optional `plate` / `lever` props (td always
passes both).

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
