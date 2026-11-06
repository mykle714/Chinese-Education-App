# flp Game Breaks

> **Status: PHASE 1 DEPLOYED to PPE (2026-11-01), no migration.** The break mechanism, the
> break's card, the server `seedIds` seed and the timer-eye move are built. **Match Speed,
> Word Search, Writing Grid, Superposition and Speed Reading are in the rotation**, so the
> **core** flp offers Match Speed and Word Search (Pinyin), the **reading** flp offers Match
> Speed (No Pinyin, zh), Word Search (No Pinyin), Speed Reading (zh; on PPE 2026-11-04)
> and Memory Map (zh; on PPE 2026-11-04), and the **writing** flp offers Writing Grid and Superposition (zh).
> Bucket Drop's adapter is built but switched off (§ 6). The other two games join as their
> Stages are extracted.

Every 10 cards in an flp session (core, reading and writing alike), the learner is
offered a **game break**: one randomly chosen game whose mark type matches the flp's
bar, played on the cards just studied (topped up from the server to the game's
baseline). The break takes a position in the card sequence: the card behind card 10 is the
**break's card** (§ 5), a normal flashcard offering the game. Swiping card 10 away reveals
it. Only Play opens the game, which takes over the whole screen; Skip sends the card off
like any other.

Related docs: [GAMES_FEATURE.md](./GAMES_FEATURE.md) (game framework; § "Routes" covers
the page/Stage split), [MATCH_SPEED_GAME.md](./MATCH_SPEED_GAME.md) (the first Stage),
[FLASHCARD_REVIEW_HISTORY_IMPLEMENTATION.md](./FLASHCARD_REVIEW_HISTORY_IMPLEMENTATION.md)
(marking), [MASTERY_REWORK.md](./MASTERY_REWORK.md) § 6 (the flp-only mark line),
[PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md) (top-up lending),
[MASTERY_REWORK.md](./MASTERY_REWORK.md) § "The reading flp" (rflp / wflp bars),
[DECK_TOWER.md](./DECK_TOWER.md) § "Studying the tower" (the flp's one host).

The flp runs only inside the Deck Tower (`FlashcardsLearnPage`'s `tower` prop is
required), always unrestricted and always in Study Mix: there is no study mode, no
deck or collection session and no routed flp.

---

## 1. Session sequence

```
card 1 … card 9 │ card 10 │ BREAK CARD │ (game) │ card 11 … card 20 │ BREAK CARD │ (game) │ …
```

- **Counter.** `cardsSinceBreak` counts every dismiss: left, right, the wflp tap, and
  cooldown-suppressed marks. Undo takes one back. It is per page visit (reset on
  remount) and resets to 0 when a break ends, **played or skipped**. The counts come
  from `useWorkingLoop`'s `onDismissed` / `onUndone` callbacks, which fire only for a
  dismiss that actually advanced the stack and an undo that actually restored a card.
- **Break due** when `cardsSinceBreak % BREAK_INTERVAL === BREAK_INTERVAL − 1`
  (`BREAK_INTERVAL = 10`), **and** there is a candidate game (§ 3), **and** the loop
  holds ≥ 2 cards (a 1-card loop is about to run dry), **and** the card editor is
  closed. The modulo means a break missed for one of those reasons comes round a full
  interval later rather than never. While due:
  - the page passes `nextEntry: null`, `gameBreak="due"` and `breakCard` to
    `FlashCardSection`, so the break's card sits behind card 10, and the card that flies
    out keeps its own content (`holdOutgoing` — its back slot is empty, so it would
    otherwise vanish on release);
  - the game is **picked**, and its opening board **prefetched** with the loop as the
    seed (§ 4), so Play has no spinner.
- **The break is virtual** — a position in the sequence, never an element of
  `workingLoop`. The loop stays `VocabEntry[]`, and its refill, `excludeIds`, dedupe
  guard and `removeCardAndReanchor` never see it. `currentIndex` advances past card 10
  as usual, so when the break ends the front card is simply `workingLoop[currentIndex]`.

Code: `src/features/flashcards/FlashcardsLearnPage/gameBreak/useGameBreak.ts` →
`useGameBreak`, `BREAK_INTERVAL`; `useWorkingLoop.ts` → `onDismissed` / `onUndone`;
`FlashCardSection.tsx` → `gameBreak` prop, `holdOutgoing`; `FlashcardsLearnPage.tsx`
(the wiring, `breakCountersRef`).

## 2. Phases & choreography

`useGameBreak` phases: `cards → title → growing → playing → shrinking → results → skipping →
cards`. Skip goes `title → skipping → cards`. A game with no run to report (a failed load,
Leave before a deal) goes `playing → leaving → cards`.

| Moment | What moves |
|---|---|
| **card 10 dismissed** | Card 10 flies out as usual (`CARD_FLY_OUT_MS`), revealing the break's card under it. In parallel the **More Info pill fades out** (and disables) and the **word tools (`WordToolsRail`: Write it / Compare) slide up off screen** (`playBreakAway`): the break's card has no word for them. The flp header (back / undo) stays. |
| **title** | The break's card is on top (§ 5). The next word card is already the front slot under it, unseen and not narrated. Play waits for the prefetch to settle (spinner on the button if it hasn't). |
| **skipping** | Skip: the break's card flies off to the right, uncovering the next word card, while the word tools and More Info come back (`playBreakToolsReturn`). No swap, no rise, no mark. |
| **growing** | Play: `GameBreakArea` portals to the phone frame (`useScreenOverlayHost`), above the flp header and the footer, below a game's own popups. A white circle grows out of the screen's middle (`BREAK_AREA_MOTION.growMs`, a `transform` so the compositor runs it) until it passes the corners. The break's card holds still under it (`stackHold: "growing"`), so it goes when it is covered, not at the tap. |
| **playing** | The Stage mounts on the finished circle: the area is white from here on, and the game IS the screen (`GameBreakFrame`). There is no header bar: the game sits straight on the white ground, with **Leave** a back arrow top-left, at the exact spot and size of the study header's (`GameFrameExitContext` → `GameFrame`'s exit button), and the game's name beside it. Leave on a live run ENDS it (the run reports what it managed, as a natural end does; Writing Grid left during Phase 1 keeps showing Phase 1 on the way out — `WritingGridStage` → `leftDuringArrange`); with the lent-card offer up, Leave answers "not now"; from any other phase it closes the break. The word cards behind are hidden by opacity (`FlashCardSection` → `hiddenForBreak`). |
| **shrinking** | The run ended (`FlpBreakStageProps.onRunEnded` → `finishRun`). The grow in reverse: the board holds `shrinkHoldMs`, fades to the white circle at full size (`shrinkFadeMs`), and the circle closes to the screen's middle over `growMs`. The break's card is back under it, now showing the results (§ 5b), over the next word card. Input is dead throughout: the area stops taking touches as the shrink starts, and the break's card swallows them until **results**, so a tap or swipe aimed at the card as it appears can't reach the word card under it (`BreakCardLayer.tsx` → `pointerEvents`). A lent-card offer holds this until it is answered, because the offer lives over the board. |
| **results** | The results card is on top, where the learner left off; the word tools stay away. A tap or a swipe either way moves on (undo is locked; a tap off the card is still Back). No mark. |
| **skipping** (after results) | A swiped card flies on from where the finger let go, a tapped one plays the writing flp's throw, and the word tools and More Info come back. Same phase as Skip, so nothing rises. |
| **leaving** | No run to report. The whole game falls away through the bottom; then the stack comes back and the page plays `playBreakReturn`: the next card rises, the word tools drop back in, More Info fades up. |

- **Back** (flp header) leaves the whole session, up to Play. The game covers the header (it draws the game's name beside Leave instead), so from there Leave is the only way out, and the audio chip is out of reach until the game ends.
- **Undo:** live on the break's card — it cancels the break (card 10 returns on Side 2,
  the counter goes back to 9, the plan is kept since card 10 is due again, and the tools
  return). Locked in every later phase. The wflp has no undo.
- **Mechanism:** the flp's Web Animations API choreography in
  `src/features/flashcards/FlashcardsLearnPage/gameBreak/breakMotion.ts` — selector tables animating the CSS
  `translate` property, plus a `fade` step (opacity, to/from the element's own resting
  opacity — MoreInfoPill rests at 0.32 before the flip). An `in` step cancels any
  animation still holding its element (the break's `out` holds with fill forwards).
  No animation library.

Code: `gameBreak/breakMotion.ts` → `BREAK_AWAY`, `BREAK_RETURN`, `BREAK_TOOLS_RETURN`, `playBreakAway`,
`playBreakReturn`, `playBreakToolsReturn`, `BREAK_AREA_MOTION` (its circle's grow / shrink length and easings come from `src/utils/pageTransition.ts` → `CIRCLE_MOTION`, shared with the page-level circle transition — LEAF_NODE_PAGES.md § The circle transition), `playChoreography`;
`gameBreak/GameBreakArea.tsx`, `BreakCardLayer.tsx`; `FlashcardsLearnPage.tsx`
(`breakCardOnTop`, the `returnNonce` layout effect, `breakUp`).

## 3. Which game

The candidate set is **derived from `GAME_REGISTRY`**, never hand-listed:

1. **Has a break adapter** (`FLP_BREAK_GAMES`, § 6).
2. **Enabled** — `GAME_REGISTRY` is already filtered by `isGameEnabled`.
3. **Language** — `GameDef.languages`.
4. **Track on the flp's world** — `worldForMarkType(track) === world`, where the track is:
   - a moded game's per-mode `markType`, one candidate per matching mode;
   - otherwise `GameDef.markType`, **except** a game with `noPinyinMarkType` on a zh
     board with pinyin hidden (the reading flp) — Match Speed and Bubble Match, which
     then mark `reading`. (Not expressed as `modes`, because a challenge stores both as
     `(gameId, mode: null)` in `CHALLENGE_GAMES`.) Match Speed honours it **only as a
     break**: the candidate's `markType` rides the prefetch and `MatchSpeedStage`'s
     `markType` prop; its route's pinyin chip is display-only and always marks
     `recognition` (`MATCH_SPEED_BREAK`, `MatchSpeedBreakStage`, `matchSpeedPoolRequest`).

5. **Focus mode** — in a focused world, only games whose
   minimum (`FlpBreakGame.focusMinimum`, else `focusGameMinimum(gameId)`) the break's cards can meet: everything outside today's set plus
   what remains of it (§ 4). With none left the break is skipped (`useGameBreak` →
   `focusBreakCards`, `breakCards` from `GET /api/focus`, read once per due break).
   [FOCUS_MODE.md](./FOCUS_MODE.md) § 5.

Routed and **break-only** games alike are candidates — Speed Reading, Memory Map, Writing
Grid and Superposition have no route at all (`isRoutedGame`, `src/games/registry.ts`) and
are exactly the rflp / wflp games. The full set once every game is adapted:

| flp bar | Games |
|---|---|
| core | Match Speed ✓, Word Search (Pinyin) ✓, Bubble Match (Pinyin), Hydra Bubbles, Bucket Drop (Pinyin) (off) |
| reading | Match Speed (No Pinyin, zh) ✓, Word Search (No Pinyin) ✓, Speed Reading (zh) ✓, Memory Map (zh) ✓, Bubble Match (No Pinyin, zh), Bucket Drop (No Pinyin) (off) |
| writing | Writing Grid (zh) ✓, [Superposition](./SUPERPOSITION_GAME.md) (zh) ✓ |

**Pinyin follows the bar**: core shown, reading hidden (`breakShowsPinyin`).

**Pick:** uniform random, never the same (gameId, mode) as the previous break unless it
is the only option (`pickBreakCandidate`). Long and endless games are included as is;
Leave is the way out.

Code: `src/games/flpBreak/candidates.ts` → `flpBreakCandidates`, `pickBreakCandidate`,
`breakShowsPinyin`; `src/games/flpBreak/index.ts` → `flpBreakCandidatesFor`;
`src/games/types.ts` → `GameDef.noPinyinMarkType`. Tests:
`src/games/flpBreak/__tests__/candidates.test.ts`.

## 4. Which cards

- **Seed:** the ids in `workingLoop` at the moment the break falls due
  (`FlpBreakContext.seedIds`).
- **Focus mode:** the seed does not apply. A focused break sends `?flpBreak=1`
  on every pool request, and the server deals cards from outside today's set, falling back
  to the set when those run out ([FOCUS_MODE.md](./FOCUS_MODE.md) § 4a). The rest of this
  section describes an unfocused session.
- **The seed rule (2026-11-03): the game plays every loop card it can clear.** A loop
  card is dealt only when the game's mark on it COUNTS, so a correct one takes it out of
  the loop (§ 4a). `isBreakSeedPlayable` tests three things:
  - the card is not **cooling** on the game's bar (`isMarkOnCooldown`;
    HYDRA_BUBBLES.md § 8.1 — the mark gate would drop the mark);
  - the mark is not **flp-only** (`isFlpOnlyMark`, core pbh ≥ 6 — same);
  - the card is **under pbh 6 on the bar the game's mark lands in**
    (`BREAK_SEED_PBH_LIMIT` = `FLP_ONLY_CORE_PBH`). On core this is the flp-only line
    again. On reading and writing it is a product rule: a game mark there would still
    count, but a loop card at Comfortable or above is left for the flp to finish.

  The board fills in this order:
  1. playable seeds (each charged to its bucket's quota);
  2. fresh cards for the remaining quotas, then fresh fallback buckets;
  3. cooled cards, avoided cards, then lending (the existing ladder).

  A seed that fails the rule is **never** on the board. It is kept out of the candidate
  query too, so it cannot ride in on the cooled tier. (Until 2026-11-03 it was a
  last-resort filler, which played but recorded nothing.) Seeds go through the same
  dd / meaning-group guard as every card. The split is `partitionBreakSeeds`, shared by
  the game pool and the Word Search grid; a focused break keeps its own two-tier split
  (FOCUS_MODE.md § 4a).
- **Expected effect:** a loop card is normally off cooldown on the flp's bar (a correct
  swipe replaces it), so the board leads with the loop's Unfamiliar and Target cards and
  tops up from outside it.
- **Context:** `FlpBreakContext` is `{ language, world, seedIds }` — no study mode (every
  break deals the game's own Mix distribution) and no collection.
- **Board size:** Word Search always deals its compact board in a break
  (`WORD_SEARCH_BREAK_BOARD`, 7 words on 6×5 rather than 9 on 7×6 —
  [WORD_SEARCH_GAME.md](./WORD_SEARCH_GAME.md) § 5c). Writing Grid keeps its full 8 cells:
  each position is a level, so a smaller board would drop levels.
- **Writing Grid deals characters, not cards.** Its seeds are words, so a seed reaches the
  board as its characters, each marked on its own single-character row. The seed WORDS
  pass the seed rule first, on the writing bar (`parseWritingDealOptions` →
  `OnDeckVocabService.filterBreakSeedIds`); Superposition shares that filter. The ladder is
  `sampleWritingGridCharacters`: fresh seed characters, other fresh characters, cooled seed
  characters, other cooled characters, then lending when the candidates fall short of 8. A
  word's result never starts a character's own clock (WRITING_PRACTICE_REWORK.md § 3a), so a
  just-studied word's characters usually stay markable; a just-studied single-character card
  is cooling and falls to the third tier. On a focused break the seed is ignored, characters
  of the set's words take the fallback tier, and there is no lending.
- **Lending** still runs through `ensureBaseline` on the opening (full-board) request.
- **A board that cannot be dealt:** a card count can pass while the board fails (a Word Search
  grid needs short words, none inside another). An adapter's `isPlayable` reports that
  off the prefetch, and `useGameBreak` → `startPlan` picks another candidate. With none left,
  the break is off until the next card (`abandoned`); if the break's card is already up, it
  leaves as Skip does. A prefetch that FAILED is different: the Stage fetches its own board.

| Endpoint | `seedIds` |
|---|---|
| `GET /api/onDeck/gamePool` (Bubble Match, Match Speed, Speed Reading, Bucket Drop, Hydra) | **built** — capped at 40 ids (`MAX_SEED_IDS`); replaced by the remaining focus set on a focused break |
| `GET /api/onDeck/wordSearchGrid` | **built** — same cap and tiers; seeds over 4 characters are dropped (the grid cannot place them). Every break adds `board=compact` |
| `GET /api/memoryMap` (Memory Map) | **never** — the break opens the learner's own map and its saved run, not a dealt board (§ 4b) |
| `GET /api/writingGrid/deal`, `GET /api/superposition/deal` | **built** — same cap; the seed words pass the seed rule, then reach the board as their characters. `?flpBreak=1` is sent on every break |

Code: `server/controllers/OnDeckVocabController.ts` → `getGamePool` (`seedIds`,
`MAX_SEED_IDS`); `server/services/OnDeckVocabService.ts` → `getGameVocabPool`
(`opts.seedIds`, tier 0; tier 2b on a focused break only), `partitionBreakSeeds`,
`isBreakSeedPlayable`, `BREAK_SEED_PBH_LIMIT`, `filterBreakSeedIds`, `fetchRowsByIds`,
`isCardGameEligible`;
`src/api/gamePool.ts` → `GamePoolRequest.seedIds`, `gamePoolParams`;
`OnDeckVocabController.getWordSearchGrid`, `OnDeckVocabService.getWordSearchGrid` (`seedIds`);
`src/api/wordSearchGrid.ts` → `wordSearchGridParams`;
`server/controllers/WritingGridController.ts` → `deal`; `server/services/WritingGridService.ts` →
`deal`, `WritingGridDealOptions`; `server/contracts/writingGrid.ts` →
`sampleWritingGridCharacters`; `server/utils/controllerUtils.ts` → `MAX_SEED_IDS`, `parseIdCsv`.

## 4b. Memory Map plays the learner's own map

Memory Map is the one break game that is not dealt from the session. Its map is a durable
per-user slot tree with a saved run (MEMORY_MAP_GAME.md § 1, § 4), and a break opens **that
run, in whatever state it was left** (owner, 2026-11-04). So `seedIds` does not reach it: the prefetch is `GET /api/memoryMap` as is. Chinese only
(`GameDef.languages`).

- **Never on a focused break.** A focused break plays cards from outside today's set
  (§ 4), which the map cannot do. Its `focusMinimum` is `Infinity`, so the § 3 focus filter
  always drops it, a tester's pin included.

- **Five words, then out.** The break closes once `BREAK_PROMPTS` (5) prompts have resolved,
  green, orange or red alike. A skip does not count.
- **Fewer left → finish the map.** With fewer than five words uncoloured the break asks only
  those, which completes the map.
- **The next break starts again.** A break that opens on a complete saved run reshuffles it
  first (`useMemoryMapRun`). The game has no route of its own.
- **Leave** with words found reports them (results card, "Run ended"); with none it closes.
  Either way nothing is lost: every answer is already in the save, which is flushed on
  unmount.
- **Clears (§ 4a):** a recorded green on the learner's own card (`starterPackBucket` is not
  `'provisional'`; the map's words now carry it) calls `onCardCleared`.
- **Results card:** "Finished!" / "Map complete!" / "Run ended", "N words found", the
  break's green / orange / red split and how much of the map is coloured. No personal best.

Code: `src/games/flpBreak/memoryMapBreak.ts` → `MEMORY_MAP_BREAK`; `MemoryMapBreakStage.tsx`;
`src/games/memory-map/MemoryMapStage.tsx` (the break's quota, `leaveBreak`, the results);
`useMemoryMapRun.ts` → `MemoryMapRunOptions`; `constants.ts` → `BREAK_PROMPTS`,
`BREAK_END_HOLD_MS`.

## 4a. Cleared cards leave the loop

A correct, recorded game mark on a loop card is the game's version of a right swipe: the
card leaves the working loop and its slot is refilled. Without it the flp dealt the same
cards straight after the game (2026-11-03).

- **Report.** Every Stage calls `onCardCleared(cardId)` off a correct, unsuppressed mark on
  a card the learner owns (§ 6). A character game passes the character's card id, so only
  a loop card that IS that single character leaves; a multi-character word stays until
  its own card is studied.
- **Hold, then settle.** `useBreakClears` reports each id to the Deck Tower at once
  (`FlpTowerHost.onGameCardCleared`, which tallies) and holds it for the loop until the
  game closes (`growing` / `playing` ends). A mark that answers after that is passed
  straight through.
- **Remove, then refill.** `useWorkingLoop` → `replaceGameCleared` drops the cleared loop
  cards at once (`removeFromLoop`: the front card stays on front, or the next survivor
  takes it), clears the undo snapshot, and asks `GET /api/onDeck/loopRefill` for that many
  replacements. They are spliced in **behind** the front card (`insertBehindFront`), so
  the cards on screen do not change under the learner. Ids not in the loop (top-up cards)
  are ignored.
- **The refill** (`OnDeckVocabController.getLoopRefill` → `OnDeckVocabService.refillWorkingLoop`)
  is the swipe refill run once per cleared card: same `getNextLibraryCardWithFallback`,
  same world / focus resolution as the loop fetch, lending on its own
  when the pool is spent. The one difference: the preferred band is the cleared card's
  band on the session bar *after* the game's mark, since the pre-mark band is gone by then.
  A short answer winds those slots down, as a swipe refill that came back empty does.
- **An emptied loop.** If the game cleared every loop card, `useWorkingLoop` reports
  `loading` until the refill lands, so neither the empty state nor the tower's climb-out
  fires in between.

| Endpoint | Params |
|---|---|
| `GET /api/onDeck/loopRefill` | `replace` (cleared ids), `exclude` (the loop's ids), both capped at `MAX_SEED_IDS`; plus the loop's own `world` (`workingLoopParams`) |

Code: `src/features/flashcards/FlashcardsLearnPage/gameBreak/useBreakClears.ts` →
`useBreakClears`; `useWorkingLoop.ts` → `replaceGameCleared`; `loopSplice.ts` →
`removeFromLoop`, `insertBehindFront` (tests: `__tests__/loopSplice.test.ts`);
`src/api/workingLoop.ts` → `fetchLoopRefill`; `server/controllers/OnDeckVocabController.ts`
→ `getLoopRefill`; `server/services/OnDeckVocabService.ts` → `refillWorkingLoop`;
`server/routes/onDeckRoutes.ts`.

## 5. The break's card

The break's opening is **a card in the stack**, one-sided and never swiped. It only becomes
a game when the learner taps Play.

`BreakCardLayer` holds it over the two card slots in the card frame, in the session's own
stock (`CardFaceSide`: every face is the tower card stock, cream rim and beige panel). It is a layer, not a third slot, because the slots hold `VocabEntry`s and the break
is never one (§ 1). `GameBreakCard` is its face. The game's colour is held back to two
raised objects, so the card still reads as one of the deck's:

- the **glyph token** (`GameDef.glyph`): a thick slab built like a tower plate, its face
  `RAMP[hue].mid`, its wall that colour shaded down;
- the game's name (`GameDef.title`);
- the adapter's **one-line rule** (`FlpBreakGame.rulesLine`) — on the adapter rather
  than `GameDef`, so copy exists only for games that can actually be offered;
- **Skip** (a cream plate) and **Play** (a plate in the game's hue): `towerPlateSx`, so
  their edge is their wall, with no `COLORS.border` outline (TOWER_STYLE_SHIFT.md).

The wflp's used-in hint bubbles sit on the front word card, which is the card under the
break's, so they stay away until that word is uncovered (`WritingUsedInBubbles` → `unseen`,
released on `skipping`).

It behaves as a card in the session too: undo works on it, and a tap off
it is Back through the same `handleTowerOffCardTap` as any card (`stackIsCards`). Leaving
that way drops the break, and the next visit counts its own interval.

While a flip leaves the front card edge-on, the card's content blanks as a back word card's
does, so the game isn't given away early.

**A sideways game turns the card.** An adapter with `sideways: true` (Speed Reading, the
one landscape game) turns the whole face 90°, Skip and Play included, the same way the
game's own `useSidewaysStage` does. The learner turns the phone before Play, so they are
already holding it the game's way when it opens. `SidewaysCardFace` wraps the face and
reuses that hook, so the card follows the game's rule: rotate while the box is taller than
wide. Turned, the Skip / Play row is capped (`SIDEWAYS_ACTIONS_MAX_PX`) so the plates
don't stretch along the card's long side. The swipe and tap handling in `BreakCardLayer`
sit outside the turned box and are unchanged.

Code: `gameBreak/BreakCardLayer.tsx`, `gameBreak/GameBreakCard.tsx`,
`gameBreak/SidewaysCardFace.tsx`; `FlashCardSection.tsx` → `breakCard`, `onBreakCardGone`;
`src/games/flpBreak/types.ts` → `FlpBreakGame.sideways`.

### 5b. The results card

After a run the same layer returns as `GameBreakResultCard`: the medal or "Finished!" / "Run
ended" heading, the score, the accuracy, the personal best, and "Tap or swipe to continue". There is
no game end popup in a break, so no Play Again and no cleanup board.

`FlpBreakResults` is display strings, so the card needs no change per game. A sideways
game's results card turns as its title card did (`sideways`, read off the plan's adapter in
`FlashcardsLearnPage` → `breakCard`): the learner is still holding the phone sideways when
the game closes onto it. Its
`personalBest` is a promise because the server's verdict can land after the Stage has
unmounted; the line appears when it settles.

`BreakCardLayer` takes the swipe through `useSwipeCommit` (`CARD_DISMISS_THRESHOLD_VW`, or a
flick), in `paint` mode so a drag re-renders nothing. A tap (`wasDrag()` false) plays the
writing flp's "grab and throw" to the right, the same motion through the Web Animations API
(`cardThrow.ts` → `cardThrowSteps`). Neither carries a wash or records a mark.

A Stage reports from its run-ended path, not from each way a run can end, so a natural end,
Leave and running out of cards all land here.

Code: `gameBreak/GameBreakResultCard.tsx`, `BreakCardLayer.tsx`, `GameBreakArea.tsx` (the shrink);
`cardThrow.ts` → `cardThrowSteps`;
`useGameBreak.ts` → `finishRun`, `finishShrink`, `results`; `src/games/flpBreak/types.ts` →
`FlpBreakResults`; `MatchSpeedStage.tsx` → `onRunEnded`, `sortOfferPending`;
`src/components/ProvisionalSortOffer.tsx` → `onNothingToOffer`.

### 5a. Per-game settings during a break

Not read from the learner's standalone settings:

| Setting | Value |
|---|---|
| **Pinyin** | Follows the flp bar (§ 3), passed as `FlpBreakCandidate.showPinyin`. |
| **Bubble Match level** | Level 2; level 1 when ≥ 50% of the final dealt set is utcm Unfamiliar. Decided once at deal time. *(Lands with Bubble Match's adapter.)* |
| **Other games** | The game's defaults. |

## 6. Embedding games: page + Stage

A break-capable game is split into:

- **its page** (the route, routed games only; not mounted while the `standaloneGames` flag is off, which since 2026-11-06 makes the break the only live host) — `GameLeafPage` (header, accent ground,
  `useThemeColor`), `usePageTitle`, `useBlockEdgeSwipe(true)`, the hub's launch `state`,
  header controls, and where "Back to Games" goes.
- **its Stage** — the run: phase machine, card supply (it keeps its own fetching and
  top-ups), marks, timers, `useBackgroundPause` (auto-resuming, no resume screen), the challenge
  round, sense and dd rules, and its results card. It renders inside a **host-injected
  `Frame`** (`GameStageFrameProps`). A routed game's Stage (Match Speed, Word Search,
  Bucket Drop) branches on `host: GameStageHost` only for: the opening board (a break seeds
  it and may hand over the prefetched pool), the way out (page Back = `useGameBack` with the
  challenge confirm; break Leave = end the live run, else close), and the results actions
  (Play Again on the page only). A **break-only** game's Stage (Speed Reading, Memory Map,
  Writing Grid, Superposition) has no page and no `host` prop: the break is its one host.

The flp side is an **adapter** per game (`FlpBreakGame`, `src/games/flpBreak/`):
`rulesLine`, `prefetch(candidate, context)`, an optional `isPlayable(prefetched)` (§ 4), an optional
`focusMinimum(context)` for a board smaller than the game's own (§ 3), and a lazy
`Stage` taking `FlpBreakStageProps` (`candidate`, `context`, `prefetched`, `Frame`,
`onDone`, `onRunEnded`, `onCardCleared`). `onRunEnded` replaces the game's end card in a
break (§ 5b). `onCardCleared(cardId)` fires off a mark's response for a correct,
recorded mark on an owned card; a tower-hosted flp tallies them and the tower drops by the
lot in one zoom when the game ends (DECK_TOWER.md § "Studying the tower"), and every flp
takes the card out of its working loop (§ 4a). A new Stage must call it from its mark path,
or its cards stay on the tower until the climb-out and come straight back in the flp. It must
also skip a card stamped `outsideFocus` (a focused break's off-set card, which was never on
the tower), and send `flpBreak` on every pool request (FOCUS_MODE.md § 4a). Writing Grid's
marks land on character rows, so only a cell whose row is the learner's own card
(`WritingGridCharacter.ownCard`) calls it: a word stays on the tower until its own card is
studied. A game joins the rotation by getting an entry in `FLP_BREAK_GAMES`.

The break's `Frame` is `GameBreakFrame` (`gameBreakFrameFor(hue)`, memoized per hue so a
re-render never remounts the Stage), and it is deliberately almost nothing — in a break
the game IS the screen:
- **no panel** — a `GameFrame` under a Leave provider drops its inset, corner and line, and
  the area's white is the ground; a new game's Stage needs no change for this;
- **no header bar** — the flp header is covered, and a `GameTimer` / `GameHud` under a Leave
  provider drops its tint and hairline, so the clock sits straight on the ground. A spacer
  clears the status bar (`.game-break-frame__status-spacer`), rather than padding, so Leave
  and the end popup's puck, both pinned to the frame's corner, clear it too. `headerRight`
  is ignored;
- **Leave** reaches the frame through `GameFrameExitContext`
  (`src/games/shared/gameFrameExit.ts`): any `GameFrame` under a provider draws the tower study header's back
  arrow: same glyph, size and screen position (`src/components/pageHeaderSizing.ts`, which
  `PageHeader` reads too), in the default header ink because the ground here is white, not
  the sky. An invisible 8px margin widens its tap target. The game's name (`title`) sits beside the arrow in the `dense` header's type (`GameFrame` → `GameFrameExitTitle`), so the break reads like a page with a header. It is not part of the button, so a mis-tap on it cannot end a run. A routed game's own page
  provides none. Match Speed and Word Search have no top strip:
  each keeps `GAME_FRAME_EXIT_CLEARANCE_PX` (the header row's bottom edge) clear above its
  content. Writing Grid keeps its phase label, in a `GameHud` strip sized to that same row
  and pinned right, level with the arrow.
  ⚠️ A strip with its own content at the left edge (a HUD's first label, `GameTimer`'s eye)
  collides with it; such a game must make room before it gets an adapter;
- the game's **hue** reaches the game's own parts through
  `GameSurfaceContext` provided directly — never `GameSurfaceProvider`, whose
  `useThemeColor` would repaint the browser chrome.

The area holds `useBlockEdgeSwipe(true)` from the grow on.

This is not a generic game shell (GAMES_FEATURE.md still holds: each game owns its
page and its Stage).

| # | Game | Stage | Adapter |
|---|---|---|---|
| 1 | Match Speed | ✓ `MatchSpeedStage` | ✓ `MATCH_SPEED_BREAK` |
| 2 | Word Search | ✓ `WordSearchStage` | ✓ `WORD_SEARCH_BREAK` |
| 3 | Bucket Drop | ✓ `BucketDropStage` | built, **off**: `BUCKET_DROP_BREAK` has no entry in `FLP_BREAK_GAMES` |
| 4 | Bubble Match | — | — |
| 5 | Speed Reading | ✓ `SpeedReadingStage` | ✓ `SPEED_READING_BREAK` (`sideways`) |
| 6 | Hydra Bubbles | — | — |
| 7 | Writing Grid | ✓ `WritingGridStage` | ✓ `WRITING_GRID_BREAK` |
| 8 | Memory Map | ✓ `MemoryMapStage` | ✓ `MEMORY_MAP_BREAK` (own map, no seed — § 4b) |
| 9 | Superposition | ✓ `SuperpositionStage` | ✓ `SUPERPOSITION_BREAK` |

Code: `src/games/types.ts` → `GameStageHost`, `GameStageFrameProps`;
`src/games/flpBreak/types.ts` → `FlpBreakGame`, `FlpBreakContext`,
`FlpBreakCandidate`, `FlpBreakStageProps`; `src/games/flpBreak/index.ts` →
`FLP_BREAK_GAMES`, `flpBreakGameFor`; `src/games/flpBreak/matchSpeedBreak.ts`,
`MatchSpeedBreakStage.tsx`; `src/games/match-speed/MatchSpeedStage.tsx`,
`MatchSpeedPage.tsx`, `poolRequest.ts` → `matchSpeedPoolRequest`;
`src/games/flpBreak/wordSearchBreak.ts`, `WordSearchBreakStage.tsx`;
`src/games/word-search/WordSearchStage.tsx`, `WordSearchPage.tsx`, `gridRequest.ts`;
`src/games/flpBreak/bucketDropBreak.ts`, `BucketDropBreakStage.tsx`;
`src/games/bucket-drop/BucketDropStage.tsx`, `BucketDropPage.tsx`, `poolRequest.ts`;
`src/games/flpBreak/writingGridBreak.ts`, `WritingGridBreakStage.tsx`;
`src/games/flpBreak/speedReadingBreak.ts`, `SpeedReadingBreakStage.tsx`;
`src/games/speed-reading/SpeedReadingStage.tsx`, `poolRequest.ts`;
`src/games/flpBreak/memoryMapBreak.ts`, `MemoryMapBreakStage.tsx`;
`src/games/memory-map/MemoryMapStage.tsx`;
`src/games/writing-grid/WritingGridStage.tsx`;
`src/features/flashcards/FlashcardsLearnPage/gameBreak/GameBreakFrame.tsx`;
`src/games/shared/gameFrameExit.ts` → `GameFrameExitContext`; `GameFrame.tsx` →
`GameFrame`, `GameFrameExitButton`.

## 7. Timer eye on the left (all games)

`TimerEyeToggle` (inside `GameTimer`, `src/games/shared/GameFrame.tsx`) is always pinned
to the **left** edge of the timer strip, in both states, so it never moves under the
thumb. That is the edge a break's Leave arrow takes (§ 6), so a game with the eye needs
room made before it can be a break. `GameTimer`'s corner
slot moved to the right to make room: it is `trailing` (top-right). No game draws
`GameTimer` today: Writing Grid dropped its visible clock on 2026-11-01, and Word Search and Bucket Drop show no clock
(WORD_SEARCH_GAME.md § 5, BUCKET_DROP_GAME.md § 6).

Code: `src/games/shared/TimerEyeToggle.tsx`, `GameFrame.tsx` → `GameTimer`
(`trailing`). Docs: WRITING_PRACTICE_REWORK.md § 2.

## 8. Layering

| Layer | Piece | Location |
|---|---|---|
| Client feature (flp) | `useGameBreak` — counter, due flag, pick, prefetch, phases | `src/features/flashcards/FlashcardsLearnPage/gameBreak/useGameBreak.ts` |
| Client feature (flp) | `BreakCardLayer` + `GameBreakCard` — the break's card in the stack | `…/gameBreak/BreakCardLayer.tsx`, `GameBreakCard.tsx` |
| Client feature (flp) | `GameBreakArea` — the full-screen layer; grow and shrink circle, Stage host | `…/gameBreak/GameBreakArea.tsx` |
| Client feature (flp) | `GameBreakResultCard` — the results face of the break's card | `…/gameBreak/GameBreakResultCard.tsx` |
| Client feature (flp) | `GameBreakFrame` — status-bar spacer, hue + Leave contexts for the Stage | `…/gameBreak/GameBreakFrame.tsx` |
| Games engine | `GameFrame`'s host exit arrow + `GameFrameExitContext` | `src/games/shared/GameFrame.tsx`, `gameFrameExit.ts`, `src/components/pageHeaderSizing.ts` |
| Client feature (flp) | Break choreography tables | `src/features/flashcards/FlashcardsLearnPage/gameBreak/breakMotion.ts` |
| Games engine | Stage host contract, `noPinyinMarkType` | `src/games/types.ts`, `src/games/registry.ts` |
| Games engine | Adapters, candidate derivation, pick | `src/games/flpBreak/` |
| Games engine | `<X>Stage` per game | `src/games/<game>/` |
| API client | `seedIds` on the pool, grid and deal requests | `src/api/gamePool.ts`, `src/api/wordSearchGrid.ts`, `src/api/writingGrid.ts` |
| Server | `seedIds` partition + fill tiers | `OnDeckVocabController.getGamePool` / `getWordSearchGrid`, `OnDeckVocabService.getGameVocabPool` / `getWordSearchGrid`, `WritingGridController.deal`, `WritingGridService.deal` |

Direction: `features/flashcards` imports `src/games` (engine), never the reverse
(docs/FRONTEND_LAYERING.md). No new tables or columns.

## 9. Decision log (2026-10-18)

- The break is a virtual position, not a loop element (§ 1).
- Back leaves the whole session, even mid-break (§ 2).
- No browser-chrome repaint during a break (§ 6).
- One game-markable rule (cooling OR pbh ≥ 6): swapped out server-side, used only as
  a fallback (§ 4).
- The top-up honoured the flp study mode (§ 4) — moot since the study modes were removed
  (2026-11-04); every break deals the game's own Mix distribution.
- Play waits for the board prefetched while card 10 was up. That prefetch belongs to its
  plan (`PlannedBreak.id`), not to the `due` effect's lifetime — the swipe that opens the
  break is what ends `due`.
- Pinyin follows the bar; Bubble Match is level 2, level 1 when ≥ 50% Unfamiliar (§ 5a).
- The break's card names the game only; it has no "Game break" label, medal targets or
  personal best, so it fits a smaller space (§ 5, changed 2026-10-31).
- Long / endless games are included as is; Leave ends them (§ 3).
- The timer eye sits on the left in every game (§ 7).
- **2026-10-31:** the break opens as a normal flashcard behind card 10, in the Deck Tower
  style, one-sided, with Skip / Play buttons and no swipe (§ 2, § 5).
- **2026-10-31:** on Play a white circle grows from the screen's middle into the game, which
  takes the whole screen: no game area, the flp header covered, and the clock straight on the
  ground with no header of its own (§ 2, § 6). This replaced the card-shaped play panel on the flp's ground. Match Speed
  went back to its bento look (white cards, ink clock, dark countdown scrim), on its route too.

- **2026-11-01:** a tower session's Word Search break plays a 6×5, 7-word board (§ 4); every
  break since 2026-11-04, when the flp became tower-only.

- **2026-11-03:** the seed rule: a break deals every loop card whose game mark would count
  and that is under pbh 6 on the game's bar, on every bar; a loop card that fails is never
  on the board (it used to be a last-resort filler). A correct game mark takes the card
  out of the loop, refilled in one request when the game closes (§ 4, § 4a).

- **2026-11-04:** Speed Reading joined the reading flp's rotation on its full 20-round run.
  Its break card and results card turn 90° with the game, buttons included (§ 5, § 5b). Its
  live clock was dropped on both hosts to match the other games; the time shows on the
  results only (SPEED_READING_GAME.md § Screen layout).

- **2026-11-04:** Memory Map joined the reading flp's rotation. It opens the learner's own
  map and saved run, asks for 5 words (or what is left, finishing the map), and the next
  break after a finish starts the map again (§ 4b).

- **2026-11-01:** Bucket Drop's adapter was built on its full 20-word board, then taken out of
  the rotation the same day. Adding it back to `FLP_BREAK_GAMES` re-enables it (§ 6).

- **2026-11-01:** Writing Grid joined the rotation as the writing flp's game, on its full
  8-cell board. A break's Leave ends the run with no confirm, as in every other game, and
  only a learner's own single-character card comes off the tower (§ 4, § 6).

- **2026-10-31:** a run's end card became the reverse of the grow: the game closes back onto
  the break's card, which shows the results and is swiped away (§ 2, § 5b). The fall remains
  only for a game with no run to report.

## 10. Forced breaks (feature testers)

The Deck Tower's `ForcedBreakPicker` ([DECK_TOWER.md](./DECK_TOWER.md) § "Forced game
breaks") pins one candidate per world. While a studied tower session of that world has a
pin, `useGameBreak` (`forcedKey`):

- **opens the visit on the break's card**, with no card swiped: a tap on the tower lands on
  the game card (`forcedOpeningSpentRef`). The break's card is up once the plan is, before
  the board has landed, and Play waits for the board as usual. Once per visit: the opening is
  spent when it shows or when a card is swiped first, and it comes back on the next visit
  (`reset`). The first word card is under it, so Skip lands there;
- falls **due on every card** after that, not every `BREAK_INTERVAL` cards. The other due
  gates still apply: no card editor, and at least 2 cards in the loop;
- **plans the pinned game** instead of a random pick. The focus rule of § 3 still applies,
  so a pinned game the break's cards cannot fill is skipped;
- ignores a pin that is not a candidate here (no adapter, or set in another language).

A parked session reads no pin, so nothing plans or prefetches a break for a session
nobody is looking at.

Code: `gameBreak/forcedBreak.ts` → `setForcedBreak`, `useForcedBreak`;
`gameBreak/useGameBreak.ts` → `forcedKey`; `FlashcardsLearnPage.tsx` → `forcedBreakKey`.
