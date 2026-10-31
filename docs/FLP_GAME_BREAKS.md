# flp Game Breaks

> **Status: PHASE 1 BUILT (dev, not on PPE), no migration.** The break mechanism, the
> break's card, the server `seedIds` seed and the timer-eye move are built; **Match Speed is
> the only game with a break adapter**, so today only the **core** flp offers breaks (the
> reading and writing flps have no adapted game yet and simply never fall due). The other
> seven games join as their Stages are extracted (§ 6).

Every 10 cards in an flp session (core, reading and writing alike), the learner is
offered a **game break**: one randomly chosen game whose mark type matches the flp's
bar, played on the cards just studied (topped up from the server to the game's
baseline). The break takes a position in the card sequence: the card behind card 10 is the
**break's card** (§ 5), a normal flashcard offering the game. Swiping card 10 away reveals
it. Only Play grows it into the game; Skip sends it off like any card.

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

`useGameBreak` phases: `cards → title → growing → playing → leaving → cards`, and Skip goes
`title → skipping → cards`. Results are not a hook phase: they are the Stage's own end card.

| Moment | What moves |
|---|---|
| **card 10 dismissed** | Card 10 flies out as usual (`CARD_FLY_OUT_MS`), revealing the break's card under it. In parallel the **More Info pill fades out** (and disables) and the **word tools (`WordToolsRail`: Write it / Compare) slide up off screen** (`playBreakAway`): the break's card has no word for them. The flp header (back / undo) stays. |
| **title** | The break's card is on top (§ 5). The next word card is already the front slot under it, unseen and not narrated. Play waits for the prefetch to settle (spinner on the button if it hasn't). |
| **skipping** | Skip: the break's card flies off to the right, uncovering the next word card, while the word tools and More Info come back (`playBreakToolsReturn`). No swap, no rise, no mark. |
| **growing** | Play: `GameBreakArea`'s grow plate starts exactly on the card and takes the card-shaped play panel's box (`BREAK_AREA_MOTION.growMs`), its cream rim thinning to nothing and its panel turning the game panel's colour (`FlpBreakGame.panelFill`). The plate lives in the area because the card slot clips. A game drawn on the ground (`panelFill: null`, Match Speed) has no panel: the plate fades on the spot over the same time, and in a tower session the deck fades with it and comes back when the game starts to fall (`FlpTowerHost.onGameBreakChange`'s `onGround`; DECK_TOWER.md § "The platform fades"). On the routed flp the area paints the game's `RAMP[hue].mark`, because white paint needs a mid-tone ground. The word cards under it are hidden by opacity (`FlashCardSection` → `hiddenForBreak`), because `CardFace`'s facing side sets its own `visibility: visible` and would show through bare ground. |
| **playing** | The Stage mounts under the plate, which fades off it. The game's own `GameFrame` takes the same place (the Stage, in `GameBreakFrame`). **Leave** sits on the panel's top strip, top-right (`GameFrameExitContext` → `GameFrame`'s exit button). Leave on a live run ENDS it into its results card (the partial run is judged like a natural end); from any other phase it closes the break. |
| **results** | The Stage's own end card, whose only action is **Back to cards**. |
| **leaving** | After a game only. The game area falls away through the bottom with its content still on it; then the stack comes back and the page plays `playBreakReturn`: the next card rises, the word tools drop back in, More Info fades up. |

- **Back** (flp header) leaves the whole session, even mid-break.
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
   `focusGameMinimum(gameId)` today's remaining focus cards can meet; with none left the
   break is skipped (`useGameBreak` → `focusRemaining`, read from `GET /api/focus` once per
   due break). [FOCUS_MODE.md](./FOCUS_MODE.md) § 5.

`hiddenFromHub` is **ignored** — Speed Reading, Memory Map and Writing Grid are hub-hidden
but are exactly the rflp / wflp games. The full set once every game is adapted:

| flp bar | Games |
|---|---|
| core | Match Speed ✓, Bubble Match (Pinyin), Hydra Bubbles, Bucket Drop (Pinyin), Word Search (Pinyin) |
| reading | Speed Reading (zh), Memory Map, Bubble Match (No Pinyin, zh), Bucket Drop (No Pinyin), Word Search (No Pinyin) |
| writing | Writing Grid (zh) |

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
  whole mapping.
- **Collection:** a deck-launched flp passes its collection to the prefetch and to
  every mid-run top-up, the same rule as the flp refill (docs/DECKS_FEATURE.md § 3).
- **Lending** still runs through `ensureBaseline` on the opening (full-board) request.

| Endpoint | `seedIds` |
|---|---|
| `GET /api/onDeck/gamePool` (Bubble Match, Match Speed, Speed Reading, Bucket Drop, Hydra) | **built** — capped at 40 ids (`MAX_SEED_IDS`) |
| `GET /api/onDeck/wordSearchGrid` | not yet (needed when Word Search is adapted) |
| Memory Map (`src/api/memoryMap.ts`) | not yet |
| `GET /api/writingGrid/deal` | not yet |

Code: `server/controllers/OnDeckVocabController.ts` → `getGamePool` (`seedIds`,
`MAX_SEED_IDS`); `server/services/OnDeckVocabService.ts` → `getGameVocabPool`
(`opts.seedIds`, tiers 0 and 2b), `fetchRowsByIds`, `isCardGameEligible`;
`src/api/gamePool.ts` → `GamePoolRequest.seedIds`, `gamePoolParams`.

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

It behaves as a card in the session too: undo works on it, and in a tower session a tap off
it is Back through the same `handleTowerOffCardTap` as any card (`stackIsCards`). Leaving
that way drops the break, and the next visit counts its own interval.

While a flip leaves the front card edge-on, the card's content blanks as a back word card's
does, so the game isn't given away early.

Code: `gameBreak/BreakCardLayer.tsx`, `gameBreak/GameBreakCard.tsx`;
`FlashCardSection.tsx` → `breakCard`, `onBreakCardGone`.

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
  top-ups), marks, timers, `useBackgroundPause` + `GamePausedOverlay`, the challenge
  round, sense and dd rules, and its results card. It renders inside a **host-injected
  `Frame`** (`GameStageFrameProps`) and branches on `host: GameStageHost` only for:
  the opening board (a break seeds it and may hand over the prefetched pool), the way
  out (page Back = `useGameBack` with the challenge confirm; break Leave = end the live
  run, else close), and the results actions (Play Again on the page only).

The flp side is an **adapter** per game (`FlpBreakGame`, `src/games/flpBreak/`):
`rulesLine`, `panelFill`, `prefetch(candidate, context)`, and a lazy
`Stage` taking `FlpBreakStageProps` (`candidate`, `context`, `prefetched`, `Frame`,
`onDone`, `onCardCleared`). `onCardCleared` fires off a mark's response for a correct,
recorded mark on an owned card; a tower-hosted flp tallies them and the tower drops by the
lot in one zoom when the game ends (DECK_TOWER.md § "Studying the tower"), so a new Stage
must call it from its mark path or its cards stay on the tower until the climb-out. A game joins the rotation by getting an entry in `FLP_BREAK_GAMES`.

The break's `Frame` is `GameBreakFrame` (`gameBreakFrameFor(hue)`, memoized per hue so a
re-render never remounts the Stage), and it is deliberately almost nothing — in a break
the game IS its play panel:
- **no header bar and no ground paint** — the flp header above is the only header, and
  the flp's ground shows around the panel; `title` / `headerRight` are ignored;
- **Leave** reaches the panel through `GameFrameExitContext`
  (`src/games/shared/gameFrameExit.ts`): any `GameFrame` under a provider draws an exit
  button top-right, vertically centred on its top strip. A game's own route provides
  none, so standalone games are unchanged. ⚠️ A strip with its own content at the right
  edge (a HUD's last label as the TOP strip, `GameTimer`'s `trailing` — Writing Grid's
  phase label) collides with it; such a game must make room before it gets an adapter;
- the game's **hue** reaches the panel's own parts (border, HUD / timer tint) through
  `GameSurfaceContext` provided directly — never `GameSurfaceProvider`, whose
  `useThemeColor` would repaint the browser chrome.

The area holds `useBlockEdgeSwipe(true)` from the grow on.

This is not a generic game shell (GAMES_FEATURE.md still holds: each game owns its
page and its Stage).

| # | Game | Stage | Adapter |
|---|---|---|---|
| 1 | Match Speed | ✓ `MatchSpeedStage` | ✓ `MATCH_SPEED_BREAK` |
| 2 | Bucket Drop | — | — |
| 3 | Bubble Match | — | — |
| 4 | Speed Reading | — | — |
| 5 | Word Search | — | — (needs `seedIds` on `wordSearchGrid`) |
| 6 | Hydra Bubbles | — | — |
| 7 | Writing Grid | — | — (needs `seedIds` on the deal) |
| 8 | Memory Map | — | — (needs `seedIds` on its deal) |

Code: `src/games/types.ts` → `GameStageHost`, `GameStageFrameProps`;
`src/games/flpBreak/types.ts` → `FlpBreakGame`, `FlpBreakContext`,
`FlpBreakCandidate`, `FlpBreakStageProps`; `src/games/flpBreak/index.ts` →
`FLP_BREAK_GAMES`, `flpBreakGameFor`; `src/games/flpBreak/matchSpeedBreak.ts`,
`MatchSpeedBreakStage.tsx`; `src/games/match-speed/MatchSpeedStage.tsx`,
`MatchSpeedPage.tsx`, `poolRequest.ts` → `matchSpeedPoolRequest`;
`src/features/flashcards/FlashcardsLearnPage/gameBreak/GameBreakFrame.tsx`;
`src/games/shared/gameFrameExit.ts` → `GameFrameExitContext`; `GameFrame.tsx` →
`GameFrame`, `GameFrameExitButton`.

## 7. Timer eye on the left (all games)

`TimerEyeToggle` (inside `GameTimer`, `src/games/shared/GameFrame.tsx`) is always pinned
to the **left** edge of the timer strip, in both states, so it never moves under the
thumb and the right edge stays clear of a break's Leave button. `GameTimer`'s corner
slot moved to the right to make room: it is `trailing` (top-right; Writing Grid's
"Phase 1 / Phase 2"). Applies everywhere — Word Search, Writing Grid, Bucket Drop.

Code: `src/games/shared/TimerEyeToggle.tsx`, `GameFrame.tsx` → `GameTimer`
(`trailing`); `src/games/writing-grid/WritingGridPage.tsx`. Docs:
WORD_SEARCH_GAME.md § HUD, WRITING_PRACTICE_REWORK.md § 2.

## 8. Layering

| Layer | Piece | Location |
|---|---|---|
| Client feature (flp) | `useGameBreak` — counter, due flag, pick, prefetch, phases | `src/features/flashcards/FlashcardsLearnPage/gameBreak/useGameBreak.ts` |
| Client feature (flp) | `BreakCardLayer` + `GameBreakCard` — the break's card in the stack | `…/gameBreak/BreakCardLayer.tsx`, `GameBreakCard.tsx` |
| Client feature (flp) | `GameBreakArea` — the transparent layer; grow plate, Stage host | `…/gameBreak/GameBreakArea.tsx` |
| Client feature (flp) | `GameBreakFrame` — hue + Leave contexts for the Stage | `…/gameBreak/GameBreakFrame.tsx` |
| Games engine | `GameFrame`'s host exit button + `GameFrameExitContext` | `src/games/shared/GameFrame.tsx`, `gameFrameExit.ts` |
| Client feature (flp) | Break choreography tables | `src/features/flashcards/flpLaunch.ts` |
| Games engine | Stage host contract, `noPinyinMarkType` | `src/games/types.ts`, `src/games/registry.ts` |
| Games engine | Adapters, candidate derivation, pick | `src/games/flpBreak/` |
| Games engine | `<X>Stage` per game | `src/games/<game>/` |
| API client | `seedIds` on the pool request | `src/api/gamePool.ts` |
| Server | `seedIds` partition + fill tiers | `OnDeckVocabController.getGamePool`, `OnDeckVocabService.getGameVocabPool` |

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
- In a break the play panel keeps the flp card's aspect ratio (`FLP_CARD_ASPECT`), as large
  as fits with the slab's wall under it, and centred (`GameBreakFrame.tsx` → `breakPanelBox`); on its own route a game
  fills the page as before.
- The game is its play panel (`GameFrame`), not a full-screen layer: on the flp's own
  ground, with Leave on its top strip and no extra header bar (§ 2, § 6).
- **2026-10-31:** the break opens as a normal flashcard behind card 10, in the Deck Tower
  style, one-sided, with Skip / Play buttons and no swipe. It grows into the panel only on
  Play. This replaced the panel-coloured title panel that faded in (§ 2, § 5).

## 10. Forced breaks (feature testers)

The Deck Tower's `ForcedBreakPicker` ([DECK_TOWER.md](./DECK_TOWER.md) § "Forced game
breaks") pins one candidate per world. While a studied tower session of that world has a
pin, `useGameBreak` (`forcedKey`):

- falls **due on every card**, not every `BREAK_INTERVAL` cards. The other due gates still
  apply: no card editor, and at least 2 cards in the loop;
- **plans the pinned game** instead of a random pick. The focus rule of § 3 still applies,
  so a pinned game today's focus set cannot fill is skipped;
- ignores a pin that is not a candidate here (no adapter, or set in another language).

A parked session reads no pin, so nothing plans or prefetches a break for a session
nobody is looking at. The routed flp never reads one.

Code: `gameBreak/forcedBreak.ts` → `setForcedBreak`, `useForcedBreak`;
`gameBreak/useGameBreak.ts` → `forcedKey`; `FlashcardsLearnPage.tsx` → `forcedBreakKey`.
