# flp Game Breaks

> **Status: PHASE 1 DEPLOYED to PPE (2026-11-01), no migration.** The break mechanism, the
> break's card, the server `seedIds` seed and the timer-eye move are built. **Match Speed,
> Word Search and Writing Grid are in the rotation**, so the **core** flp offers Match Speed
> and Word Search (Pinyin), the **reading** flp offers Word Search (No Pinyin), and the
> **writing** flp offers Writing Grid and Superposition (zh). Bucket Drop's adapter is built but switched off
> (§ 6). The other four games join as their Stages are extracted.

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
[READING_WRITING_CENTERS.md](./READING_WRITING_CENTERS.md) (rflp / wflp bars).

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
| **results** | The results card is on top, where the learner left off; the word tools stay away. A tap or a swipe either way moves on (undo is locked; a tower session's tap off the card is still Back). No mark. |
| **skipping** (after results) | A swiped card flies on from where the finger let go, a tapped one plays the writing flp's throw, and the word tools and More Info come back. Same phase as Skip, so nothing rises. |
| **leaving** | No run to report. The whole game falls away through the bottom; then the stack comes back and the page plays `playBreakReturn`: the next card rises, the word tools drop back in, More Info fades up. |

- **Back** (flp header) leaves the whole session, up to Play. The game covers the header (it draws the game's name beside Leave instead), so from there Leave is the only way out, and the audio chip is out of reach until the game ends.
- **Undo:** live on the break's card — it cancels the break (card 10 returns on Side 2,
  the counter goes back to 9, the plan is kept since card 10 is due again, and the tools
  return). Locked in every later phase. The wflp has no undo.
- **Mechanism:** the flp's Web Animations API choreography in
  `src/features/flashcards/flpLaunch.ts` — selector tables animating the CSS
  `translate` property, plus a `fade` step (opacity, to/from the element's own resting
  opacity — MoreInfoPill rests at 0.32 before the flip). An `in` step cancels any
  animation still holding its element (the break's `out` holds with fill forwards).
  No animation library.

Code: `flpLaunch.ts` → `BREAK_AWAY`, `BREAK_RETURN`, `BREAK_TOOLS_RETURN`, `playBreakAway`,
`playBreakReturn`, `playBreakToolsReturn`, `BREAK_AREA_MOTION`, `playChoreography`;
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
     board with pinyin hidden (the reading flp) — Bubble Match, which then marks
     `reading`. (Not expressed as `modes`, because a challenge stores Bubble Match as
     `(bubble-match, mode: null)` in `CHALLENGE_GAMES`.)

5. **Focus mode** — in a focused world on an unrestricted session, only games whose
   minimum (`FlpBreakGame.focusMinimum`, else `focusGameMinimum(gameId)`) the break's cards can meet: everything outside today's set plus
   what remains of it (§ 4). With none left the break is skipped (`useGameBreak` →
   `focusBreakCards`, `breakCards` from `GET /api/focus`, read once per due break).
   [FOCUS_MODE.md](./FOCUS_MODE.md) § 5.

`hiddenFromHub` is **ignored** — Speed Reading, Memory Map and Writing Grid are hub-hidden
but are exactly the rflp / wflp games. The full set once every game is adapted:

| flp bar | Games |
|---|---|
| core | Match Speed ✓, Word Search (Pinyin) ✓, Bubble Match (Pinyin), Hydra Bubbles, Bucket Drop (Pinyin) (off) |
| reading | Word Search (No Pinyin) ✓, Speed Reading (zh), Memory Map, Bubble Match (No Pinyin, zh), Bucket Drop (No Pinyin) (off) |
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
- **Focus mode:** the seed does not apply. A focused unrestricted break sends `?flpBreak=1`
  on every pool request, and the server deals cards from outside today's set, falling back
  to the set when those run out ([FOCUS_MODE.md](./FOCUS_MODE.md) § 4a). The rest of this
  section describes an unfocused session.
- **Seed cards must be game-markable.** `POST /api/flashcards/mark` silently drops a
  game mark on a card that is **cooling** on that track (`isMarkOnCooldown`;
  HYDRA_BUBBLES.md § 8.1) and a recognition / production game mark on a card at
  **core pbh ≥ `FLP_ONLY_CORE_PBH`** (`isFlpOnlyMark`). A seed card in either state
  would play but record nothing, so the server partitions the seed with
  `isCardGameEligible` (which tests both) and fills the board in this order:
  1. markable seeds (each charged to its bucket's quota);
  2. fresh cards for the remaining quotas, then fresh fallback buckets;
  3. **unmarkable seeds** — the fallback;
  4. cooled cards, avoided cards, then lending (the existing ladder).

  Seeds go through the same dd / meaning-group guard as every card, and are kept out of
  the candidate query so they can only enter through tiers 1 and 3.
- **Expected effect:** every rflp seed card was just reading-marked, so an rflp break
  will be mostly top-up cards; the core flp keeps the seeds whose flp mark was on the
  *other* track.
- **Study mode:** the top-up honours the flp's `?mode=` — Match Speed's mode slugs are
  the flp's (`review` / `challenge`, else Mix), so `modeConfigFor(studyMode)` is the
  whole mapping. Word Search and Bucket Drop have no such modes, so a break of theirs ignores the study mode.
- **Tower sessions:** the Deck Tower hosts the flp (`FlpTowerHost`), and `useGameBreak` puts
  that on `FlpBreakContext.towerSession`. An adapter may deal a smaller board from it: Word
  Search plays 7 words on 6×5 there, not 9 on 7×6 ([WORD_SEARCH_GAME.md](./WORD_SEARCH_GAME.md) § 5c).
  Writing Grid keeps its full 8 cells: each position is a level, so a smaller board would
  drop levels.
- **Writing Grid deals characters, not cards.** Its seeds are words, so a seed reaches the
  board as its characters, each marked on its own single-character row. The ladder is
  `sampleWritingGridCharacters`: fresh seed characters, other fresh characters, cooled seed
  characters, other cooled characters, then lending when the candidates fall short of 8. A
  word's result never starts a character's own clock (WRITING_PRACTICE_REWORK.md § 3a), so a
  just-studied word's characters usually stay markable; a just-studied single-character card
  is cooling and falls to the third tier. On a focused break the seed is ignored, characters
  of the set's words take the fallback tier, and there is no lending.
- **Collection:** a deck-launched flp passes its collection to the prefetch and to
  every mid-run top-up, the same rule as the flp refill (docs/DECKS_FEATURE.md § 3).
  Writing Grid is the exception: its deal has no collection, so a deck session's seed is the
  deck's words but any other cell can come from the learner's whole pile.
- **Lending** still runs through `ensureBaseline` on the opening (full-board) request.
- **A board that cannot be dealt:** a card count can pass while the board fails (a Word Search
  grid needs short words, none inside another). An adapter's `isPlayable` reports that
  off the prefetch, and `useGameBreak` → `startPlan` picks another candidate. With none left,
  the break is off until the next card (`abandoned`); if the break's card is already up, it
  leaves as Skip does. A prefetch that FAILED is different: the Stage fetches its own board.

| Endpoint | `seedIds` |
|---|---|
| `GET /api/onDeck/gamePool` (Bubble Match, Match Speed, Speed Reading, Bucket Drop, Hydra) | **built** — capped at 40 ids (`MAX_SEED_IDS`); replaced by the remaining focus set on a focused break |
| `GET /api/onDeck/wordSearchGrid` | **built** — same cap and tiers; seeds over 4 characters are dropped (the grid cannot place them). A tower break adds `board=compact` |
| Memory Map (`src/api/memoryMap.ts`) | not yet |
| `GET /api/writingGrid/deal` | **built** — same cap; characters of the seed words, not the cards themselves. `?flpBreak=1` is sent on an unrestricted session only |

Code: `server/controllers/OnDeckVocabController.ts` → `getGamePool` (`seedIds`,
`MAX_SEED_IDS`); `server/services/OnDeckVocabService.ts` → `getGameVocabPool`
(`opts.seedIds`, tiers 0 and 2b), `fetchRowsByIds`, `isCardGameEligible`;
`src/api/gamePool.ts` → `GamePoolRequest.seedIds`, `gamePoolParams`;
`OnDeckVocabController.getWordSearchGrid`, `OnDeckVocabService.getWordSearchGrid` (`seedIds`);
`src/api/wordSearchGrid.ts` → `wordSearchGridParams`;
`server/controllers/WritingGridController.ts` → `deal`; `server/services/WritingGridService.ts` →
`deal`, `WritingGridDealOptions`; `server/contracts/writingGrid.ts` →
`sampleWritingGridCharacters`; `server/utils/controllerUtils.ts` → `MAX_SEED_IDS`, `parseIdCsv`.

## 5. The break's card

The break's opening is **a card in the stack**, one-sided and never swiped. It only becomes
a game when the learner taps Play.

`BreakCardLayer` holds it over the two card slots in the card frame, in the session's own
stock (`CardFaceSide` `towerStock`, so a tower-hosted flp gets the cream rim and beige
panel). It is a layer, not a third slot, because the slots hold `VocabEntry`s and the break
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

It behaves as a card in the session too: undo works on it, and in a tower session a tap off
it is Back through the same `handleTowerOffCardTap` as any card (`stackIsCards`). Leaving
that way drops the break, and the next visit counts its own interval.

While a flip leaves the front card edge-on, the card's content blanks as a back word card's
does, so the game isn't given away early.

Code: `gameBreak/BreakCardLayer.tsx`, `gameBreak/GameBreakCard.tsx`;
`FlashCardSection.tsx` → `breakCard`, `onBreakCardGone`.

### 5b. The results card

After a run the same layer returns as `GameBreakResultCard`: the medal or "Finished!" / "Run
ended" heading, the score, the accuracy, the personal best, and "Tap or swipe to continue". There is
no game end popup in a break, so no Play Again and no cleanup board.

`FlpBreakResults` is display strings, so the card needs no change per game. Its
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

- **its page** (the route) — `GameLeafPage` (header, accent ground, `useThemeColor`),
  `usePageTitle`, `useBlockEdgeSwipe(true)`, the hub's launch `state`, header controls,
  and where "Back to Games" goes. Standalone behaviour is unchanged.
- **its Stage** — the run: phase machine, card supply (it keeps its own fetching and
  top-ups), marks, timers, `useBackgroundPause` (auto-resuming, no resume screen), the challenge
  round, sense and dd rules, and its results card. It renders inside a **host-injected
  `Frame`** (`GameStageFrameProps`) and branches on `host: GameStageHost` only for:
  the opening board (a break seeds it and may hand over the prefetched pool), the way
  out (page Back = `useGameBack` with the challenge confirm; break Leave = end the live
  run, else close), and the results actions (Play Again on the page only).

The flp side is an **adapter** per game (`FlpBreakGame`, `src/games/flpBreak/`):
`rulesLine`, `prefetch(candidate, context)`, an optional `isPlayable(prefetched)` (§ 4), an optional
`focusMinimum(context)` for a board smaller than the game's own (§ 3), and a lazy
`Stage` taking `FlpBreakStageProps` (`candidate`, `context`, `prefetched`, `Frame`,
`onDone`, `onRunEnded`, `onCardCleared`). `onRunEnded` replaces the game's end card in a
break (§ 5b). `onCardCleared` fires off a mark's response for a correct,
recorded mark on an owned card; a tower-hosted flp tallies them and the tower drops by the
lot in one zoom when the game ends (DECK_TOWER.md § "Studying the tower"), so a new Stage
must call it from its mark path or its cards stay on the tower until the climb-out. It must
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
  the sky. An invisible 8px margin widens its tap target. The game's name (`title`) sits beside the arrow in the `dense` header's type (`GameFrame` → `GameFrameExitTitle`), so the break reads like a page with a header. It is not part of the button, so a mis-tap on it cannot end a run. A game's own route provides
  none, so standalone games are unchanged. Match Speed and Word Search have no top strip:
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
| 5 | Speed Reading | — | — |
| 6 | Hydra Bubbles | — | — |
| 7 | Writing Grid | ✓ `WritingGridStage` | ✓ `WRITING_GRID_BREAK` |
| 8 | Memory Map | — | — (needs `seedIds` on its deal) |

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
`src/games/writing-grid/WritingGridStage.tsx`, `WritingGridPage.tsx`;
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
| Client feature (flp) | Break choreography tables | `src/features/flashcards/flpLaunch.ts` |
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
- The top-up honours the flp study mode (§ 4).
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

- **2026-11-01:** a tower session's Word Search break plays a 6×5, 7-word board (§ 4).

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
nobody is looking at. The routed flp never reads one.

Code: `gameBreak/forcedBreak.ts` → `setForcedBreak`, `useForcedBreak`;
`gameBreak/useGameBreak.ts` → `forcedKey`; `FlashcardsLearnPage.tsx` → `forcedBreakKey`.
