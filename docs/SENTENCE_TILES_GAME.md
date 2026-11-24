# Sentence Tiles

> **STATUS: BUILT 2026-11-22, flag `sentenceTiles` ON, feature testers only. Not deployed to PPE.**
> Needs migration **204** and the env var **`SENTENCE_TILES_AI_API_KEY`** on the backend. Without
> the key the game still loads and cached lines still play; any new line answers "judging is
> unavailable".
>
> "Scrabble" is a trademark, so it must not appear in the game's user-facing name.

A two-player **correspondence** word-tile game between friends. Each tile is one whole HSK 1–3
det word, however many characters it has. A play is a straight line of tiles, and the line must
read as a **natural, complete Chinese sentence**. An AI judge on the server decides that, because
sentences cannot be checked against a dictionary. It exercises composition (choosing and ordering
words), which no other game does.

**Language scope:** `zh` only.

**Where the design came from:** the viability pilot in `server/scripts/analysis/wordScrabblePilot/`
(README there) and the Claude Doc
[Scrabble Viability Framework](https://claude.ai/artifact/9rm7EehdaZ2fiJqpzTRH1o). Backlog entry:
[BACKLOG.md § 10](./BACKLOG.md). The pilot's round-3 configuration (connectivity ≥ 3 bag,
rack 11) measured 0% dead racks and a mean best line of ~4 tiles. It never simulated a whole game.
That is what the testing phase is for.

---

## 1. Decisions (owner)

| Date | Decision |
|---|---|
| 2026-11-21 | Whole-word tiles; AI judge; casual players; soft quality scores for the pilot |
| 2026-11-21 | **Crossing rule lifted**: only the line a player places is judged; tiles that end up side by side across it are not |
| 2026-11-21 | Judge consistency is not a goal. Correspondence play, so a few seconds of judging is fine. Every verdict is logged as training data for a future in-house scorer |
| 2026-11-22 | Bag admits only tiles with connectivity ≥ 3; rack 11 (raised to 12 the same day for an even two-row layout); stuck nouns stay in, priced by play rate |
| 2026-11-22 | **Friends only.** The challenger plays the first turn to send the challenge; the friend's first move is the accept |
| 2026-11-22 | Spend limits as in § 6; four new tables (§ 7); feature testers only while testing |
| 2026-11-22 | Updates by **polling** (a cheap heartbeat), not a WebSocket |

No marks, no minute points, no Study Challenge eligibility. It is not a `GAME_REGISTRY` game (not an
flp break), so it has a feature flag rather than a `GAME_FLAGS` entry.

---

## 2. Tiles and the bag

| Piece | Where |
|---|---|
| Tile set: 1,129 words with connectivity ≥ 3, each with its POS, points and rating | `server/services/sentenceTiles/tileSet.zh.ts` (**generated** by `server/scripts/analysis/wordScrabblePilot/export-tile-set.py` from the pilot's `data/tiles.tsv` + `data/r3-points-all.json`; never hand-edit) |
| Bag composition | `server/services/sentenceTiles/bag.ts` → `buildBag` |

**Points** are `1 + round(9 × (1 − play rate))`, the play rate measured at rack 11 in the pilot
(`tile-points.py`). Sampled tiles use their own rate, shrunk toward their rating's mean. The other
~1,040 tiles use only their rating's mean (rating 3 → 6 pts, 4 → 4, 5 → 2). The owner has said
point values will be tuned later; the verdict log (§ 7) is the data for that.

**Each game draws its own 100-tile bag**, by the pilot's recipe:
1. the function-word skeleton, `ZH_FORCED_COUNTS` (38 copies: 我×3, 你×3, 了×3, …);
2. content words sampled per POS up to `ZH_POS_QUOTA` (forced copies count toward the quota);
3. a top-up from any quota POS until the bag holds 100.

The bag is shuffled with `crypto.randomInt`. Tile ids are 0–99 in shuffled order, so an id says
nothing about its word. Draws pop from the end.

**Display facts** (pinyin + dd) come from det at read time. `SentenceTilesService.wordInfo` loads
every tile word once per process via `IDictionaryDAL.findMultipleByWord1`. It resolves them with
the server twins `resolveDisplayDefinition` / `resolveDisplayPronunciation`
(`server/utils/definitions.ts`). No learner sense pick applies, since tiles are not cards.

---

## 3. Rules

Code: `server/services/sentenceTiles/rules.ts` → `resolvePlay`, `scoreLine`; the end of a turn is
`SentenceTilesService.ts` → `advanceTurn`. Constants: `server/contracts/sentenceTiles.ts`.

| Rule | Value |
|---|---|
| Board | 13 × 13, one tile per square (multi-character words included) |
| Rack | 12 tiles (`SENTENCE_TILES_RACK_SIZE`; the pilot measured 11 — raised 2026-11-22 for two even rows of 6. Games dealt earlier keep 11) |
| Opening | The first line on an empty board covers the centre square (row 6, col 6) and holds ≥ 2 tiles |
| Every later line | Includes ≥ 1 tile already on the board |
| A play | Tiles from your rack in one row (across, read left→right) or one column (down, read top→bottom), no gaps. The **line** is that run extended through adjacent board tiles in both directions. Only the line is judged |
| Score | Sum of every tile's points in the line (board tiles too), plus **10** for a line of **6+** tiles |
| Rejected line | Tiles go back; the turn does **not** pass. After **3** rejections in a turn you must swap or pass |
| Swap | Return any tiles to the bag for the same number of fresh ones (only if the bag holds that many). Scores 0 |
| Pass | Scores 0 |
| Ending | (a) You empty your rack with the bag empty: you gain the opponent's remaining rack points and they lose the same. (b) **4** consecutive scoreless turns (swaps / passes, both players): each loses their own rack's points. Higher score wins; equal is a draw |
| Resign | Active games only; the opponent wins |

There are no premium squares.

### Challenge lifecycle

| Status | Meaning | Who can see it |
|---|---|---|
| `draft` | Created; the challenger has not moved | Challenger only |
| `pending` | The challenger moved; waiting for the friend | Both. The friend can **decline** or make any move to accept |
| `active` | The friend accepted by moving | Both |
| `finished` | Ended by § 3 "Ending" or a resignation | Both |
| `declined` / `cancelled` | The friend declined / the challenger withdrew before an accept | Both |

The challenger can withdraw a `draft` or `pending` game (`cancel`).

---

## 4. The judge

Code: `server/services/sentenceTiles/sentenceJudge.ts` → `judgeLine`; client
`server/services/anthropicClient.ts` → `getSentenceTilesAiClient` (its own key,
`SENTENCE_TILES_AI_API_KEY`).

- **Claude Sonnet 5.5 at `low` effort**, structured output `{ legal: boolean, reason: string }`.
  The `reason` is one English sentence: what is wrong on a rejection, a translation on an
  acceptance. Both are shown to the player.
- The system prompt is frozen and cacheable. It mirrors the pilot's `judge-rules.md`: a natural,
  complete sentence or utterance; bizarre lines and fragments are illegal; order is as given.
- The user message is the line only, shown as separated tiles and joined text.
- A refusal, truncation or API error returns `unavailable`. The player sees "Judging is
  unavailable right now"; nothing is recorded as illegal.
- **Not enabled: server-side refusal fallbacks.** The installed `@anthropic-ai/sdk` (0.77) predates
  the `fallbacks` parameter. Revisit on an SDK upgrade.

**Every verdict is cached by line** (`sentence_tile_verdicts`, unique on `(language, line)`, where
`line` is the words joined with `|`). An identical line never costs a second call, which also makes
rulings consistent across games. The table doubles as the training log for the future scorer.

---

## 5. Concurrency

Code: `SentenceTilesService.playTiles`.

1. **Validate** against an unlocked snapshot: your turn, under the rejection cap, a legal shape.
2. **Verdict**: from the cache, or one guarded judge call (§ 6), made outside any transaction
   because it takes seconds.
3. **Apply** in a transaction holding the game row (`FOR UPDATE`). If the game's `version` moved
   since step 1, the play is refused with a 409. Otherwise the move is written and `version` bumps.
   A rejected line logs a `rejected` move and does not bump `version`.

Swap, pass, resign, decline and cancel are single transactions on the locked row. Game creation
takes advisory locks on both players (`ISentenceTilesDAL.lockUsers`, seed 204) to enforce the
active-games cap ([API_ABUSE_HARDENING.md § 1a](./API_ABUSE_HARDENING.md)).

---

## 6. Abuse protection (AI spend)

Constants: `server/contracts/sentenceTiles.ts`. Order of checks in `SentenceTilesService`
(`playTiles` → `judgeFresh`):

| # | Guard | How it is enforced |
|---|---|---|
| 0 | Feature testers only, both players, and they must be accepted friends | `assertTester` on every endpoint; `createGame` checks the friendship and the opponent's flag |
| 1 | **No client text reaches the model** | The client sends tile ids + cells; the server builds the line from its own rack/board state (all words from the fixed tile set) |
| 2 | Cached lines are free | `findVerdict` before any call |
| 3 | **3 rejected lines per turn** | counted from `sentence_tile_moves` (`kind = 'rejected'`) |
| 4 | **1,000 judge calls per rolling 24 h across all players** | `countVerdictsLastDay` |
| 5 | **One judge call in flight per game** | `claimJudge`: one `UPDATE … WHERE version = $v AND judgeStartedAt is null/stale(60 s)` |
| 6 | **40 judge calls per player per local day** | `reserveJudgeCall`: one conditional upsert-increment on `sentence_tile_judge_usage`; refunded if the request never reached Anthropic |
| 7 | **8 unfinished games per player** (both sides checked at creation) | count under advisory locks |
| 8 | Raw request volume | the global `writeLimiter` (600 writes / 5 min / user) |
| 9 | Kill switch | revoke `SENTENCE_TILES_AI_API_KEY`: judging stops, the rest of the game keeps working |

Worst case at the global ceiling is about $10/day (owner's estimate, Sonnet pricing).

---

## 7. Data model (migration 204)

`database/migrations/204-create-sentence-tiles.sql`. DAL: `server/dal/interfaces/ISentenceTilesDAL.ts`,
`server/dal/implementations/SentenceTilesDAL.ts`. Per-user data; **not** on `/data-ppe-to-dev`.

| Table | Purpose |
|---|---|
| `sentence_tile_games` | One game: the two players (`playerAId` = challenger), `status`, `turnUserId`, `board`, `rackA`, `rackB`, `bag` (jsonb), scores, `scorelessTurns`, `version` (the poll compares it), `judgeStartedAt` (in-flight marker), `winnerId`, timestamps. **Bag and racks are server-only**: a read returns only the caller's rack and the bag's size |
| `sentence_tile_moves` | Move log: `play`, `exchange`, `pass`, `resign`, `rejected`, with `turnNumber`, `placements`, `lineWords`, `points`. The opponent's rejected attempts are never sent to a client |
| `sentence_tile_verdicts` | Verdict per `(language, line)`: `legal`, `reason`, `model`, `requestedBy`. Cache + training log |
| `sentence_tile_judge_usage` | `(userId, usageDate)` → count: the per-player daily cap. `usageDate` is the 04:00-bounded local day (`utils/streakDate.ts` → `streakDateOf`), the dictionary AI cap's convention |

The current turn number is derived (completed moves + 1), not stored.

---

## 8. Endpoints

Router: `server/routes/sentenceTilesRoutes.ts` (mounted in `server.ts` behind the flag).
Controller: `server/controllers/SentenceTilesController.ts`. Wire types: `server/contracts/sentenceTiles.ts`.
Every request may carry `tz` (query on GET, body on POST) for the judge budget's local day.

| Method + path | Body | Returns |
|---|---|---|
| `GET /api/sentenceTiles/games` | — | `{ games: SentenceTilesGameSummary[] }` (drafts hidden from the opponent) |
| `POST /api/sentenceTiles/games` | `{ opponentId }` | `SentenceTilesGameView` (a draft; you move first) |
| `GET /api/sentenceTiles/games/:id[?since=N]` | — | `SentenceTilesGameView`, or **204** while still at version N |
| `POST …/:id/play` | `{ placements: [{tileId,row,col}], direction }` | `SentenceTilesMoveResponse` (`outcome` accepted / rejected, `reason`, `points`, `game`) |
| `POST …/:id/exchange` | `{ tileIds }` | `SentenceTilesMoveResponse` |
| `POST …/:id/pass` · `/resign` · `/decline` · `/cancel` | — | `SentenceTilesMoveResponse` |

Errors: 403 non-tester, 404 not your game (or a draft you are not the challenger of), 400 rule
violations (player-facing message), 409 game moved / judge busy, 429 daily or global judge cap,
503 judge unavailable.

---

## 9. Pages

| Route | Page | Notes |
|---|---|---|
| `/sentence-tiles` | `src/features/sentenceTiles/SentenceTilesPage.tsx` | Node page with the footer (Menu tab); Back arrow (`navigateBackOr` → `/`). Groups: Your move / Their move / Finished. **New game** → inline friend picker → creates the draft and opens it |
| `/sentence-tiles/:gameId` | `src/features/sentenceTiles/SentenceTilesGamePage.tsx` | Footerless node page (`NodePage footerless hideScrollbar`): Back arrow (`navigateBackOr` → `/sentence-tiles`); header Pass + forfeit flag; scores; state line + verdict banner; board; tapped-word info strip; rack; Play / Recall / Swap; move log (`SentenceTilesMoveLog.tsx`); quota line at the bottom |

Entry point: the Menu popover row **Sentence Tiles** (`menuDestinations.ts`), shown only when the
flag is on **and** testing features are on (`useTestingFeatures`). It wears the `moss` hue
(`COLORS.moss*` / `RAMP.moss`, a leafy green added for this game, outside the v2 ramp), which no
other Menu row uses. `sentenceTilesStyles.ts` → `TILES_HUE`.

- **Header** (`headerExtraActions`): **Pass** (`skip_next`, your turn, not in a draft) and the
  **forfeit flag** (`flag`): Resign in an active game, Decline a challenge you received, Withdraw
  your own draft/pending challenge (`forfeitMove`). The first tap arms it (the flag fills and a
  banner says "Tap the flag again to …"); the second tap sends it.
- **Scores**: two equal fixed-width columns (name over total, each centred) either side of a hairline
  divider, no boxes, no turn marker (`SentenceTilesGamePage.tsx` → `Score`).
- **State line**: only when there is a state to name — "Waiting for X to accept.", "X challenged
  you.", declined / withdrawn / game over. No how-to text; a draft or active game shows none.
- **Board** (`SentenceTilesBoard.tsx`): 48 px cells in their own scroller panning both ways
  (`touch-action: pan-x pan-y`; the page sets `horizontalPan`), centred on the middle square at
  mount. No visible scrollbars, and all four edges of the visible window fade out (two intersected
  `mask-image` gradients). The most recent play is tinted moss TINT, unsent tiles moss MID.
- **Tiles** (`TileFace.tsx`): the add-cards page's **card stock** (acp,
  `features/discover/sortCardStock.ts`) rebuilt in `sentenceTilesStyles.ts` → `tileStockShadow`:
  a cream face on a 3 px iso wall stepped down-right, the rounded edge, no outline. Rack tiles
  sit straight on the page (no tray), sized from the rack's measured width so a full rack (12) always fits two rows of 6 (`SentenceTilesGamePage.tsx` → `rackTilePx`, max 50px), and float with a translucent ink cast shadow (theme/shadows.ts → `shadowInk`; `SHADOW.raised` at rest, spreading toward `SHADOW.float` while held — not acp's solid ground-tone blot); board tiles are grounded (wall only).
  The rack is **positional**: a tile placed this turn leaves an empty slot (its neighbours do not
  close up), and after a play or swap the server draws each replacement into the slot it vacated
  (`server/services/sentenceTiles/bag.ts` → `refillInPlace`), so kept tiles never move.
  The word is set in cpcd's **block** layout (`ForeignText layout="block"`: 1–2 chars in a line,
  3 a triangle, 4 a 2×2), pinyin hidden, `sm` for 1 char and `xs` otherwise. **No point values
  are printed** — scoring is provisional while the AI judges lines.
- **Placing — drag and drop** (`DraggableRackTile.tsx`, acp's gesture from `AddCardsPage.tsx` →
  `DraggableCard`): pick up a rack tile and it scales to 1.12× while its shadow eases out; it
  tracks the finger 1:1; the board lights the free square under it (moss MID + ink ring) through
  its imperative handle (`cellAt`, `setHover` — hover state lives in the board so a drag never
  re-renders the page or the tile). Released on a free square it lands as an unsent tile; anywhere
  else it springs home. Taps still work as a fallback: tap a rack tile to select it, then an empty
  square. Tap your unsent tile to take it back, any other tile to see its pinyin + dd. **Play**
  sends tile ids; the direction is inferred (`inferDirection`). **Swap** switches the rack into
  select-to-return mode (drag is off while swapping).
- **Quota line**, the last element, at the screen's bottom edge: tiles left in the bag, today's
  judge usage, and this turn's rejection count.
- Leaf rules: `useBlockEdgeSwipe(true)`; load effects key on `user?.id`, never `token`.

### Updates: a heartbeat, not a socket

`src/features/sentenceTiles/useGameHeartbeat.ts`. The page loads the game once. Then, every
**10 s while the tab is visible**, it calls `GET …/:id?since=<version>`; the server answers **204**
(one row read) when nothing changed. It checks at once when the tab becomes visible again, pauses
while a move is in flight (the move's response carries the new state), and stops once the game is
over. A WebSocket was rejected: correspondence play doesn't need instant updates, and the app's one
socket (voice) needs reconnect and auth handling this doesn't. The list page does not poll.

---

## 10. Layers

| Layer | Component |
|---|---|
| Contract | `server/contracts/sentenceTiles.ts` (rules constants, limits, wire types); `featureFlags.ts` → `sentenceTiles` |
| Route / Controller | `sentenceTilesRoutes.ts`, `SentenceTilesController.ts` |
| Service | `SentenceTilesService.ts` (lifecycle, turns, limits, views); pure helpers `sentenceTiles/bag.ts`, `sentenceTiles/rules.ts`; external I/O `sentenceTiles/sentenceJudge.ts` |
| DAL | `ISentenceTilesDAL.ts`, `SentenceTilesDAL.ts` |
| Generated asset | `sentenceTiles/tileSet.zh.ts` ← `export-tile-set.py` |
| Client API | `src/api/sentenceTiles.ts` |
| Client pages | `src/features/sentenceTiles/*` |
| Tests | `server/__tests__/sentenceTilesRules.test.ts` (bag, placement rules, scoring, endings) |

---

## 11. Open items

| # | Item |
|---|---|
| 1 | **No expiry for abandoned games.** A game nobody moves in stays unfinished and counts toward the 8-game cap until someone resigns or withdraws. A turn deadline (an hourly cron, like the challenge expiry) is the likely fix |
| 2 | **No notification** when it becomes your turn; you see it when you open the list or the game |
| 3 | Point values are provisional (§ 2); tune from the verdict log |
| 4 | Board size 13 × 13 is a guess; no whole game has been simulated |
| 5 | Refusal fallbacks need an SDK upgrade (§ 4) |
| 6 | Bag composition ignores the learner's own cards and level |
| 7 | Matching with non-friends, and a solo mode, are out of scope for v1 |
