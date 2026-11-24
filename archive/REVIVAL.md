# REVIVAL — Bubble Match, Hydra Bubbles, Bucket Drop

**Archived 2026-11-23.** This branch (`archive/bubble-match-hydra-bucket-drop`) is `main` at
`f4664c6`: the last commit that contained all three games, plus this file. `main` deleted
them in the cleanup pass that followed. Index entry on `main`: `docs/ARCHIVED_FEATURES.md`.

## What they were

| Game | What it was | Why it was archived |
|---|---|---|
| **Bubble Match** | Physics bubble field: drag a foreign-word bubble onto its English bubble. Three levels (Chill / Hustle / Torture) with a dropping ceiling. Recognition marks (reading with pinyin hidden). | Only host was its `/games/bubble-match` route. That route sat behind the OFF `standaloneGames` flag, and the Games hub that linked it was deleted 2026-11-06. It never got an flp break adapter. |
| **Hydra Bubbles** | Endless, clockless recognition drill on Bubble Match's field. Two payout colours (`drain` = 1 spawn, `bloom` = 3) and a fill-ratio spawn table. It lent cards by HSK tier relative to the learner. | Same as Bubble Match: route-only, flag off, no break adapter. |
| **Bucket Drop** | Drag the stack's top word into its meaning's bucket. Two modes, Pinyin (production) and No Pinyin (reading). Stopwatch with medals. | It had a break adapter (`flpBreak/bucketDropBreak.ts`), deliberately left out of `FLP_BREAK_GAMES`. Its route was also behind `standaloneGames`. |

Design docs (on this branch only): `docs/HYDRA_BUBBLES.md`, `docs/BUCKET_DROP_GAME.md`.
Bubble Match's design lives in `docs/GAMES_FEATURE.md`.

**Not archived, still on `main`:** `src/games/bubbles/` (the shared bubble field). The add
cards page (`AddCardsPage`) uses it. Some of its comments still cite `HYDRA_BUBBLES.md` on
this branch.

## Files deleted from `main`

Restore with `git checkout archive/bubble-match-hydra-bucket-drop -- <path>`.

- `src/games/bubble-match/` (8 files)
- `src/games/hydra-bubbles/` (7 files)
- `src/games/bucket-drop/` (9 files)
- `src/games/flpBreak/bucketDropBreak.ts`, `src/games/flpBreak/BucketDropBreakStage.tsx`,
  `src/games/flpBreak/__tests__/bucketDropBreak.test.ts`
- Tests: `src/__tests__/bubbleMatchSpawn.test.ts`, `hydraSpawnTable.test.ts`,
  `hydraSpawnPlanner.test.ts`, `bucketDropQueue.test.ts`, `bucketDropPerimeter.test.ts`
- **The dead Games-hub launcher cluster**, removed together because `GameCard` was built
  around Bubble Match's levels. It had no importer since the hub was deleted on 2026-11-06:
  `src/games/shared/GameCard.tsx`, `src/games/shared/gameCards.ts`,
  `src/components/RoundPlayButton.tsx`, `src/games/word-search/wordSearchCard.tsx`,
  `WordSearchHubItem.tsx`, `WordSearchResumeTile.tsx`, `useWordSearchLauncher.tsx`,
  `NewGameConfirmDialog.tsx`
- Docs: `docs/HYDRA_BUBBLES.md`, `docs/BUCKET_DROP_GAME.md`

## Wiring removed from shared files on `main` (restore each to revive)

| File | What was removed |
|---|---|
| `src/games/registry.ts` | The three `ALL_GAMES` rows and their `constants` imports |
| `src/games/flpBreak/index.ts` | (Bucket Drop was never in `FLP_BREAK_GAMES`; add it there to make it a break) |
| `src/games/runtime/challengeLaunch.ts` | `LAUNCHES` rows for `bubble-match` (`level: 2`), `hydra-bubbles`, `bucket-drop` (`mode: "pinyin"`) |
| `src/games/runtime/challengeScoring.ts` | The `survival` bonus kind and the `survivalStart` event (used only by Bubble Match's survival bonus and Hydra's clear bonus) |
| `server/contracts/wire.ts` | `CardBaselineSurface` / `CARD_BASELINES` / `CARD_BASELINE_ITEMIZED` rows (`bubble-match`: 20, `bucket-drop`: 20); `RollingSupplySurface`, `ROLLING_SUPPLY_SURFACES`, `isRollingSupplySurface`; the three `CHALLENGE_GAMES` entries; `ChallengeScoringBonus`'s `survival` kind and its `trigger` / `decayPoints` / `floor` / `forfeitOnLoss` fields |
| `server/contracts/personalBests.ts` | `hydra-bubbles` (higher / count) and `bucket-drop` (lower / ms) |
| `server/contracts/featureFlags.ts` | The three `GAME_FLAGS` rows |
| `server/constants.ts` | The three `KNOWN_GAME_IDS` slugs |
| `src/constants.ts` | `/games/bubble-match`, `/games/hydra-bubbles`, `/games/bucket-drop` in `MINUTE_POINTS_ELIGIBLE_PAGES` |
| `src/api/flashcards.ts` | `MarkSurface` values `bubble-match`, `hydra-bubbles`, `bucket-drop` |
| `src/data/tips.ts` | The Bubble Match tip |
| **Hydra's card-pool machinery** (it was the only caller): `src/api/gamePool.ts` (`strictBuckets`, `lendLevelOffset`); `server/controllers/OnDeckVocabController.ts` → `getGamePool` (the `?strictBuckets=`, `?lendLevelOffset=` params and rolling-supply `lendOnRefill`); `server/services/OnDeckVocabService.ts` → `getGameVocabPool` (`opts.strictBuckets` / `lendOnRefill` / `lendLevelOffset`), `lendGameCandidates`'s `levelOffset`; `server/services/ProvisionalCardService.ts` → `resolveLendLevel` and `PROVISIONAL_MIN_LEVEL` / `PROVISIONAL_MAX_LEVEL` | Diff this branch against `main` on those files |

**Left on `main` without its caller:** `GET /api/onDeck/gamePool`'s `avoid` soft-demote
parameter. Its one caller was Bubble Match's "Play Again".

## Data deleted (migration 206, by decision)

- `wins` rows where `game IN ('bubbleMatch', 'hydraBubbles', 'bucketDrop')`. PPE had 82
  `bubbleMatch` rows.
- `game_personal_bests` rows where `game IN ('bubble-match', 'hydra-bubbles', 'bucket-drop')`.
  PPE had 1 `bucket-drop` row.
- NOT touched: `study_challenges` rounds that name these games. They render as unplayable.

A revival starts with empty wins and personal bests. No schema change is needed: both
tables are game-keyed.

## The cooldown rule moved, it was not archived

`HYDRA_BUBBLES.md` § 8 held the app-wide rule "cooldown is a hard next-markable-at, enforced
at `POST /api/flashcards/mark`". It now lives on `main` in
`docs/FLASHCARD_REVIEW_HISTORY_IMPLEMENTATION.md` § "Cooldown is a hard next-markable-at".

## Revival checklist

1. Restore the game folder(s) and the tests listed above.
2. Re-add the registry row, the flag, the `KNOWN_GAME_IDS` slug, the `MarkSurface` value and
   the minute-points path.
3. Give it a host. The archive happened because these games had none. Either write an flp
   break adapter and add it to `FLP_BREAK_GAMES`, or turn on `standaloneGames` AND add an
   entry point (the hub is gone).
4. Hydra only: restore the pool machinery (strict buckets, lend offset, rolling supply) in
   the files above.
5. Challenge eligibility: restore the `CHALLENGE_GAMES` entry, the `LAUNCHES` row and (for
   Bubble Match / Hydra) the `survival` bonus kind in the contract and the scorer.
6. Personal bests: restore the `PERSONAL_BEST_GAMES` entry.
7. Restore the design doc from this branch and re-link it from `docs/GAMES_FEATURE.md`.
