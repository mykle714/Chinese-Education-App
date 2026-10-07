# Bucket Drop (`/games/bucket-drop`)

A drag-and-drop **stopwatch** production/reading drill. The play panel's perimeter is
lined with grey square keycap-shaped **holes** (buckets) — one row along the top edge —, each holding one English dd. All
of the run's foreign words are dealt as a pile in the middle; the player drags **any** word
into the bucket holding its meaning, or leaves it anywhere on the field to clear the pile.
A correct drop sinks the word into the hole and the bucket is replaced; the run is 20 words,
and the clock stops on the last drop. Medals by time.

**Status: BUILT on dev 2026-10-06. No migration, no new table or column** — the personal
best rides the existing `game_personal_bests` (migration 171) under a new contract key.
Not yet deployed to PPE. Medal thresholds are first guesses (§ 6).

Parent: [GAMES_FEATURE.md](./GAMES_FEATURE.md). Hub/launch: [READING_WRITING_CENTERS.md](./READING_WRITING_CENTERS.md).

## Files and layers

| Layer | File | Role |
|---|---|---|
| Contract | `server/constants.ts` → `KNOWN_GAME_IDS`; `server/contracts/featureFlags.ts` → `GAME_FLAGS['bucket-drop']` | id + on/off switch |
| Contract | `server/contracts/wire.ts` → `CARD_BASELINES`, `CARD_BASELINE_ITEMIZED`, `CHALLENGE_GAMES` (`bucket-drop` / `pinyin`) | provisioning baseline (20), itemized notice, challenge spec |
| Contract | `server/contracts/personalBests.ts` → `PERSONAL_BEST_GAMES['bucket-drop']` | lower-is-better ms, per mode |
| Registry | `src/games/registry.ts` (entry + `modes`), `src/games/runtime/challengeLaunch.ts` → `LAUNCHES['bucket-drop']` | hub tile, router, challenge launch |
| Page | `src/games/bucket-drop/BucketDropPage.tsx` | pool fetch, run track, stopwatch, marks, challenge round, PB, wins, popups |
| Page | `src/games/bucket-drop/BucketDropEndPopup.tsx` | end card (modal, not minimizable) |
| Stage | `src/games/bucket-drop/BucketDropStage.tsx` | field measuring, queue state, hit-testing, drop/fall/leave animations |
| Components | `src/games/bucket-drop/DropBucket.tsx`, `StackWord.tsx` | one bucket; one draggable word |
| Pure | `src/games/bucket-drop/perimeterLayout.ts` → `layoutPerimeter` | slot geometry from field size |
| Pure | `src/games/bucket-drop/bucketQueue.ts` → `dealQueue`, `resolveDrop`, `resizeQueue` | run model: remaining words + which bucket is in each slot |
| Constants | `src/games/bucket-drop/constants.ts` | hue, modes, distribution, medals, geometry, timing |
| Launch | `src/games/GamesPage.tsx` (plain tile → Pinyin), `src/features/flashcards/centers/ReadingGamesCarousel.tsx` (No Pinyin, zh only) | the two entry points |
| Tests | `src/__tests__/bucketDropPerimeter.test.ts`, `src/__tests__/bucketDropQueue.test.ts`, `src/games/__tests__/challengePool.test.ts` | geometry (squares, no overlap), the queue over full runs, eligibility |

The server needs no Bucket-Drop-specific code: the pool is `GET /api/onDeck/gamePool`
(`surface=bucket-drop`, `markType=` the run's track, Bubble Match's 2/10/6/2 distribution),
marks are `POST /api/flashcards/mark` (`surface: "bucket-drop"`), wins are the opaque
`bucketDrop` key in the shared `wins` table, and the dd-collision guard
([GAMES_FEATURE.md](./GAMES_FEATURE.md) § "No two cards may share a dd") already covers the
game pool — two buckets can never show the same gloss.

## 1. Modes

Chosen by the launch surface, never in-game — the Word Search pattern.

| Mode | Launched from | Track (zh) | Challenge |
|---|---|---|---|
| `pinyin` | Games hub tile (a plain router link; no `state.mode` ⇒ Pinyin) | production | eligible |
| `no-pinyin` | Reading Center carousel, `state.mode: "no-pinyin"`, **zh only** | reading | not eligible |

Pinyin mode is **production**, not the recognition Bubble Match's pinyin rule would give: the
English bucket is the prompt and the foreign word is the answer the learner finds (the same
track Word Search's Pinyin mode marks). The run's track is `runTrackFor(language, mode)`
(`constants.ts`), latched at the first pool fetch (`BucketDropPage` → `lockRunTrack`), because
the pool is bucketed and cooled on that track. The board hides pinyin only on a reading run.
Spanish is always production (it has no reading to hide), which is why the Reading
Center card is gated to zh in the carousel rather than by `GameDef.languages` — the hub's
Pinyin mode is playable in es (plain words via `ForeignText`).

Code: `constants.ts` → `MODE_CONFIGS`, `modeConfigFor`, `runTrackFor`; `registry.ts` → `modes`.

## 2. Bucket layout

**Every bucket is the same square** — `BUCKET_SIZE` (91px) on every screen — and they sit in
**one row along the top edge** of the field. The side columns and the bottom row were removed
on request (2026-10-06). Only the COUNT and the SPACING adapt. `layoutPerimeter(width, height)`
(`src/games/bucket-drop/perimeterLayout.ts` — the name predates the single row):

- The row holds as many squares as fit with at least `BUCKET_GAP` (10) of space around each.
- **The spacing is even**: one gap g = (width − n·size) / (n + 1) separates neighbouring
  buckets, separates the end buckets from the side edges, AND insets the row from the top
  edge — so a corner bucket is equally far from both edges it touches (~17px on a 340px field,
  ~24px at 370px). The top inset is capped at `MAX_EDGE_INSET` (40), which binds only far
  wider than a tablet.
- **Cap** `MAX_LIVE_BUCKETS` (12) — reachable only on a very wide field.
- Resulting counts: any phone field (320–400px) → **3**; a 768px tablet → 6.
- The open area below the row (`PerimeterLayout.stack`) is where the opening pile is dealt.

Hit-testing is against this slot geometry (± `HIT_SLOP` 4px) in field coordinates —
no bucket measures its own DOM rect.

## 3. The run model

`bucketQueue.ts` — pure, immutable, `rng` injected for tests. State is just the remaining
words and which word's bucket sits in each slot.

Every word is on the field, but only up to `slots.length` buckets are; a word whose bucket
is not showing simply cannot be placed yet, and the player sorts the placeable ones out of
the pile. Every showing bucket belongs to a word still in play, so something is always
placeable until the run ends.

**Refills are random**: a freed slot takes a random word whose bucket is not showing. It must
never follow what the player is doing (e.g. the word they are holding), or the slot that just
emptied would point at an answer.

- `dealQueue` — random buckets into the slots. Dealt into 0 slots on mount; `resizeQueue`
  sizes it once the field is measured.
- `resolveDrop(state, slot, word)` — the word's own bucket: retire it and refill the slot.
  Anything else returns the SAME state object (the stage tells a wrong drop by identity).
- `resizeQueue` — buckets keep their slot where it still exists; a shrink returns cut
  buckets' words to the unshown pool; new slots fill from it.

## 4. Look

- **Bucket** (`DropBucket`): the sort flow's bucket (`SortCardsPage` → `Bucket`) — inset
  `SHADOW.recessedDeep`, `1px COLORS.border` — with two asked-for departures: fill
  `COLORS.grey` (no hue), and a keycap corner (`BUCKET_RADIUS` 16; a `%` radius goes
  elliptical on a rectangle). Gloss in `FONTS.sans`, **fitted to the hole** (`DropBucket` →
  `FittedGloss`): lines break only at spaces, never inside a word, and the font steps down by
  `GLOSS_FONT_STEP_PX` (0.5) from `GLOSS_MAX_FONT_PX` (14) toward `GLOSS_MIN_FONT_PX` (8) until
  no word is cut off and the lines fit. Measured in a layout effect (before paint) and again
  once web fonts load. Only a word too long even at 8px may break mid-word, as a last resort.
- **Hovered** (word held over it): the shared `COLORS.scrim` wash, as on a hovered bubble.
- **Wrong**: hairline and an extra 1.5px outer ring in `WRONG_BUBBLE_BG` (`--redMk`, the
  palette's strongest red — `dangerInk` is ink in v2) plus the shared `bubbleShake`
  (`WRONG_SHAKE_KEYFRAMES`, `src/games/bubbles/constants.ts`).
- **Words** (`StackWord`): bare `ForeignText` (size `md` — 36px characters, one cpcd step under the `lg` it
  launched at; sense-resolved pinyin), no tile,
  a thin 6×8px invisible grab margin (thin so an upper word in the pile does not steal grabs
  from the one beneath). Dealt at load as a pile around the open centre
  (`PILE_JITTER_X/Y` 14/10px of random offset), with a word whose bucket is showing on top
  (`BucketDropStage` → `dealPile`). On pickup a word jumps to the front, scales to
  `HELD_SCALE` (1.12, Bubble Match's `SCALE_HELD`) and fades to `HELD_OPACITY` (0.75), held
  for the whole drag; put down, it stays in front of the others.
- **No HUD row, no hint.** The panel is the stopwatch (`GameTimer`, with its show/hide eye — § 6) over the field — nothing
  else. The words-left count, progress bar, miss counter and the foot `GameHint` were all
  removed on request; misses still appear on the end card.
- Hue `red` (`GAME_HUE`), shared with Bubble Match.

## 5. Drops

| Release | Board | Input | Mark |
|---|---|---|---|
| On the word's own bucket | word falls into the hole (`FallingWord`, WAAPI, `DROP_FALL_MS` 340); bucket fades out (`BUCKET_EXIT_MS`); replacement fades in after it | the rest of the field stays live — the queue resolves on release, the animations are ghosts | positive, **only if the word was never missed** |
| On another word's bucket | word springs back to **where that drag started** (`SNAP_BACK_MS`); bucket goes red and shakes | **locked** for max(`SNAP_BACK_MS`, `WRONG_SHAKE_MS`) | negative, **first miss of that word only** |
| Anywhere else (open field, an empty slot) | the word **stays where it was let go**, clamped so it is wholly inside the field | — | none |
| Cancelled (pointercancel) | springs back to the drag start | — | none |

No time penalty for a miss — the lockout and the running clock are the cost. One mark per
word per run, the same once-per-word rule as the challenge spec's `missChargedOncePerWord`.

Each `StackWord` owns its resting spot imperatively (`restRef`) and is placed purely by
`transform`; the stage only supplies the dealt spot (read once on mount) and a verdict on
release (`DropVerdict`: `correct` / `wrong` / `moved` with the clamped centre). It is
memoized with stable callbacks (the stage reads page callbacks through `propsRef`), so a hover
change never re-renders a word's CPCDRow mid-drag ([GAMES_FEATURE.md](./GAMES_FEATURE.md)
§ Grab latency). On a production run the word is narrated on pickup (`tts.autoSpeak`),
never on a reading run. The header carries the app-wide narration chip
(`AudioModeChip`, `BucketDropPage` → `GameLeafPage` `rightContent`) so it can be muted
mid-run — shown only when `runTrack !== "reading"`, mirroring Bubble Match's
`showAudioChip` (a reading run has nothing to narrate).

## 6. Clock, medals, personal best

- **Accumulated active time** (`BucketDropPage` → `activeMsRef`, `segmentStartRef`,
  `clockRunning`): runs while `phase === "playing"` and not `clockPaused`
  (provisional notice OR backgrounding — `useBackgroundPause` + `GamePausedOverlay`). Each
  running segment is banked on pause / end / unmount.
- **Show/hide eye** — the stopwatch is a bare `GameTimer` with Word Search's eye
  (`TimerEyeToggle`, via `GameTimer`'s `valueShown` / `onToggleValueShown`), the same as
  Writing Grid. Hiding keeps the numerals' height (`visibility`, so the field never
  reflows) and never pauses the clock; the end popup always shows the final time. The
  preference is device-local under this game's own key (`constants.ts` →
  `SETTINGS_STORAGE_KEY` = `bucketDrop.settings`, `DEFAULT_SETTINGS`; read in
  `BucketDropPage` via `useLocalGameSettings`).
- The clock stops on the last drop; the end popup opens `DROP_FALL_MS` later so the fall
  is seen.
- **Medals** (`MEDAL_THRESHOLDS`): gold ≤ 45 s, silver ≤ 70 s, bronze ≤ 100 s, else none.
  ⚠️ Placeholders — re-tune from real runs. A medalled run logs a win (`bucketDrop`, level 1).
- **Personal best**: fastest time per mode (`usePersonalBest('bucket-drop', mode)`).
- A run the dictionary could not fill to 20 (`pool.length < TOTAL_WORDS`) still plays, but
  earns no medal and records no best.

## 7. Study Challenge

Pinyin mode only (`CHALLENGE_GAMES` → `bucket-drop` / `pinyin`, production, no language
restriction). Scored like Word Search's stopwatch with misses added: contested ±100,
filler +20 / −20, `missChargedOncePerWord`, and an `elapsedPenalty` of −10 per second of
active time after a **45 s grace** (the gold line — keep the two together). Launch state
`{ mode: "pinyin" }` (`challengeLaunch.ts`).

The page follows the shared contract (GAMES_FEATURE.md § Challenge-eligible games):
`useChallengeRound({ gameId, mode, paused: clockPaused, running })`, `poolParams` on the
pool request, wait for `ready`, `emit` hit/miss per drop, `finish(true)` on the last drop,
`ChallengeRoundScoreboard` in place of the end card (no Play Again), Back via `useGameBack`.

## Open questions / flags

- Medal thresholds and the 45 s challenge grace are guesses (§ 6, § 7).
- `MAX_LIVE_BUCKETS` = 12 is a judgment call layered on the size rules (§ 2).
- Words can be left overlapping each other; there is no collision or tidy-up (by design).
- **Only 3 buckets on a phone** (§ 2) — 3 of the 20 words are placeable at a time, so most
  of a run is finding one of those 3 in the pile. Levers if it plays slow: a smaller
  `BUCKET_SIZE` (≤ 72px fits 4 across a ~340px field), or a smaller `BUCKET_GAP`.
