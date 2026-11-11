# Hint Pawn (flp study helper)

A pawn on a tiny platform in the bottom-left corner of the flp, which speaks the
front card's hint in a speech bubble. It runs in every Deck Tower world's session. The
writing world's hint is the used-in words (which used to float as bubbles on the writing
card's top edge). Main and reading have the **wrong-streak** hint: a study tip on a card
whose last 3 marks in the world were all wrong. A session with no hint-worthy card never
sees the pawn.

Parent: [DECK_TOWER.md](./DECK_TOWER.md) (the flp runs only inside td). Related:
[WRITING_PRACTICE_REWORK.md](./WRITING_PRACTICE_REWORK.md) § 3b (the used-in data),
[ISO_ART_FRAMEWORK.md](./ISO_ART_FRAMEWORK.md) (§ IsoPawn, § IsoPlatform),
[BEGINNER_KEYBOARD.md](./BEGINNER_KEYBOARD.md) § 6z-4 (the shared hint-bubble motion).

## Components and layers

| Layer | Code | Role |
|---|---|---|
| flp page presentation | `src/features/flashcards/FlashcardsLearnPage/hintPawn/HintPawn.tsx` → `HintPawn` | The stage: platform, pawn, bubble, arrival, swipe-away |
| flp page presentation | `hintPawn/PawnHintBody.tsx` → `PawnHintBody`, `DismissCue` | The bubble's inside: laid out by the hint's bubble variant (§ Bubble variants), filled per `kind`, plus the tap-to-dismiss cue (a soft introduction — `showDismissCue`) |
| flp page presentation | `hintPawn/PawnBubbleTail.tsx` → `PawnBubbleTail` | The bubble's tail, angled at the pawn's head |
| flp page presentation hook | `hintPawn/useSpaceBelowCard.ts` → `useSpaceBelowCard` | The free height under the card, which caps the bubble |
| flp page presentation hook | `hintPawn/useHintPawnIdles.ts` → `useHintPawnIdles`, `pickHintPawnIdle`, `HINT_PAWN_IDLES`, `IDLE_EVERY_MS` | When the pawn plays an idle, and which (§ Idle animations) |
| flp page presentation hook | `hintPawn/usePawnOuch.ts` → `usePawnOuch`, `OUCH_TTL_MS`, `OUCH_EXIT_MS` | The "ouch" bubbles that are up, and their lifetimes (§ Tap reactions) |
| flp page presentation | `hintPawn/PawnOuchBubble.tsx` → `PawnOuchBubble` | The "ouch" bubble's look and its inflate / fade-and-drop motion |
| flp page logic (pure) | `hintPawn/pawnHints.ts` → `PawnHint`, `pawnHintFor`, `hasWrongStreak`, `WRONG_STREAK_LENGTH`, `PawnBubbleVariant`, `PAWN_BUBBLE_VARIANT` | What the pawn has to say about the front card, as data |
| flp page constants | `hintPawn/pawnHintLines.ts` → `USED_IN_LINES`, `WRONG_STREAK_LINES`, `CPCD_LINE_MAX_CHARS`, `OUCH_LINES`, `OUCH_LINE_BAG` | The line collection each kind draws from, in random order, and the tap "ouch" lines |
| feature store | `hintPawn/hintPawnVisit.ts` → `useHintPawnVisit`, `useHintPawnDismissed`, `dismissHintPawn`, `takeHintLineIndex` | State scoped to one td visit: dismissed, and one line shuffle bag per kind (`dealLineBag`) |
| flp loop hook | `FlashcardsLearnPage/useWorkingLoop.ts` → the miss branch of the mark's `.then` (uses `server/contracts/mastery.ts` → `appendTypedMark`) | Patches a missed card's in-loop `typedMarkHistory`, so a card that fails a 3rd time in-session gets the hint when it comes around (§ Wrong-streak) |
| shared hook | `src/timeOfDay/useDayClock.ts` → `useDayClock` | The Deck Tower's clock, read for the night vest (§ Night vest) |
| shared hook | `src/hooks/useHintPawnSetting.ts` → `useHintPawnEnabled`, `setHintPawnEnabled` | The per-device on/off switch |
| page wiring | `FlashcardsLearnPage.tsx` (mounts `HintPawn`, computes `pawnHint`, shares the card frame via `setCardFrame`), `deckTower/DeckTowerPage.tsx` (calls `useHintPawnVisit`), `pages/settings/SettingsBody.tsx` (the switch row) | |
| shared framework | `deckTower/iso` → `IsoScene`, `IsoPlatform` (`ground` optional), `IsoPawn` (`idle`, `onTap`), `fallFromHeight`, `pawnIdles.ts`; `components/hintBubble/HintBubbleSurface.tsx` (`tailSide` incl. `"custom"`, `tailY`, `bodySx`, `onSelect`), `useHintBubblePresence`, `HINT_MOTION` | Reused, not forked |

The flp now imports the iso framework too, which makes it the framework's third importer
outside td (after acp's bins). This adds weight to moving it to `src/components/iso/`
(DEFERRED_WORK.md #28).

## Hints

Code: `pawnHints.ts` → `pawnHintFor(world, entry)`.

A hint is a discriminated union (`PawnHint`). Each kind carries a `key` (a new key pops
the old bubble and grows a new one with the next line, and it includes the card id), its
`lines` (the kind's whole collection) and, for a conditional collection, `eligible` (which
lines fit this card, index for index). To add a world's hint: add a variant, its entry in
`PAWN_BUBBLE_VARIANT` (§ Bubble variants), a case in `pawnHintFor`, and — for a cpcd-variant
kind — a case in `PawnHintBody` → `CpcdRowContent`.

| World | Kind | Content |
|---|---|---|
| writing | `used-in` (cpcd variant) | Up to 2 words containing the card's character (`entry.writingUsedIn`; data and selection rules: WRITING_PRACTICE_REWORK.md § 3b). Each word is an `xs` cpcd (`ForeignText size="xs"`) with its pinyin, and its dd under it. The character is masked as `?` except at levels 1–3, whose card front already previews it (`previewShowsWholeCharacter`). Null when the card has no words (multi-character cards always) |
| core, reading | `wrong-streak` (text variant) | One study tip from `WRONG_STREAK_LINES`, line only (§ Wrong-streak). Null unless the card is on a wrong streak |

### Wrong-streak

Code: `pawnHints.ts` → `hasWrongStreak`, `wrongStreakHint`, `meetsCondition`;
`pawnHintLines.ts` → `WRONG_STREAK_LINES`; `useWorkingLoop.ts` (the
in-session patch).

- **Trigger:** the newest `WRONG_STREAK_LENGTH` (3) marks of the world's tracks are all
  wrong. Main merges its recognition and production tracks by timestamp (owner's call
  2026-11-08), so a card failed on alternating faces counts. Reading reads its one track.
  A card with fewer than 3 marks never qualifies. Writing's clock-only marks are skipped.
- **When:** on the question face, as soon as the card comes up (owner, 2026-11-08). The
  pawn's usual rules apply (unseen, parked, dismissed).
- **In-session misses count.** A missed card stays in the working loop, so `useWorkingLoop`
  appends the miss (`appendTypedMark`, as the server does) to the loop's copy once the mark
  lands (not for writing, and not for a suppressed mark). The card's third miss in a session
  therefore shows the hint the next time it comes around. Undo restores the pre-dismiss
  loop, which drops the patch.
- **The tips** are a collection, one picked per card from the kind's shuffle bag (§ The
  lines). Each tip may have a condition, and a tip the card fails is skipped:

| id | Condition | Tip |
|---|---|---|
| `breakdown` | multi-character card with breakdown items (`getBreakdownItems`) | learn each character's meaning in the Breakdown tab |
| `examples` | `exampleSentences` non-empty | read the example sentences |
| `customize` | none | customize the card (the Customize button above the card) |
| `compare` | none | compare it with a similar card (the Compare button above the card) |
| `focus` | none | focus on just this card and hold the answer until next time |

- The tips that point **into the eip** (breakdown, examples) name More Info but carry no
  "dismiss this bubble" instruction (removed, owner 2026-11-10), even though the bubble
  covers the More Info pill until it is tapped closed. Customize and Compare are on the
  word-tools rail above the card in main and reading.
- **Button keywords in Red Salmon** (owner, 2026-11-08). A word in a tip that names a
  button in the app (More Info, Breakdown, Customize, Compare) is wrapped in braces in the
  copy, `{More Info}`, and drawn in `COLORS.keywordInk` (`#E8604C`, a deep salmon outside
  the ramp, 3.4:1 on the white bubble) with the braces dropped. Code:
  `pawnHintLines.ts` → `splitHintKeywords`; `PawnHintBody.tsx` → `HintLine` (both bubble
  variants render through it). Button names are never put in quote marks.
- Copy is provisional (owner, 2026-11-08). Keep at least one unconditional tip, so every
  card has something to say.

## The lines

Code: `pawnHintLines.ts`, `hintPawnVisit.ts` → `takeHintLineIndex`, `dealLineBag`,
`HintPawn` → `lineForKey`.

Each kind has a line collection (used-in: 10 phrasings of one idea; wrong-streak: 5
different tips), said in **random order** (owner, 2026-11-08) from a shuffle bag: each new
hint key takes the next line of a shuffled round, every line is said once per round, and a
reshuffle never puts the last line said first, so no line repeats back to back. There is
**one bag per kind** (keyed by `kind`), so the kinds keep separate rounds. The bags live in
the td visit store, so a round continues across sessions and worlds, and a fresh visit
deals new ones.

A conditional collection (wrong-streak) passes its `eligible` mask to `takeHintLineIndex`.
The bag is still dealt over the whole collection. The taker skips lines this card does not
fit and leaves them in the round for a later card that does. When nothing eligible is left
in the round, it re-deals. A line that leads into the listed content (the
used-in words) ends in a colon. A key takes its line once (cached in a ref), so
re-renders never re-roll it. The used-in lines say "character", never "word" (owner's call
2026-11-08), because a writing card with a used-in hint is always a single character.
A cpcd-variant kind's lines must fit **one line** (`CPCD_LINE_MAX_CHARS`, 33 characters —
about 240 px of 12 px semibold caption on a 360 px phone); the used-in lines were shortened
to fit (2026-11-08), and `src/__tests__/wrongStreakHint.test.ts` enforces the cap.

## Bubble variants

Code: `pawnHints.ts` → `PawnBubbleVariant`, `PAWN_BUBBLE_VARIANT`; `PawnHintBody.tsx` →
`PawnHintBody`, `CpcdRowContent`, `DismissCue`.

Every hint kind picks one of two dialogue-box variants (owner, 2026-11-08). The map is a
`Record` over `PawnHint["kind"]`, so a new kind does not type-check until it picks one.

| Variant | Kinds | Layout |
|---|---|---|
| `text` | `wrong-streak` | The line alone. It **wraps**; the dismiss cue sits beside it, bottom-right. A line too long for the bubble's capped height clips inside the line's box, so the cue stays visible |
| `cpcd` | `used-in` | The line on **one line** (`white-space: nowrap`, an ellipsis only as a safety net), then a row of cpcd content. The dismiss cue sits **in the cpcd row**, taking its width from the words rather than from the line, and the words centre in what is left. One line keeps the cpcd row from being pushed off the bubble's bottom |

The root (`pawn-hint-body--text` / `--cpcd`) fills the bubble's content box, so the cue keeps
its corner in both variants.

## Arrival

Code: `HintPawn` → `arrival`, `riseIn`, `hintPawnDrop`, `firstBubbleAt`.

- Nothing is drawn until the **first hint of a session** is due on a card the learner can
  see (`hint` set, not `unseen`, not `parked`, not dismissed).
- Then the platform **rises in from below the screen** (`RISE_MS` 520 ms, a slight
  overshoot), and the pawn **drops onto it from the top of the screen** (owner, 2026-11-08).
  The drop is `fallFromHeight(h)`, the sky fall's physics (pawnEntrances.ts), with `h`
  measured per arrival from `window.innerHeight` (`hintPawnDrop`) so the pawn starts with its
  head just above the screen's top edge on any device. It starts at 80% of the
  rise. The bubble grows out beside the pawn after it lands (`FIRST_BUBBLE_AFTER_LAND_MS`).
- After that the pawn **stays** for the session. A card with no hint pops the bubble, and the
  next hint grows a new one after `HINT_MOTION.enterDelayMs`.
- **Parking** (the visit to that tower ends) sends the pawn home. The next dive replays the
  arrival on its first hint.
- **Unseen** (the count card over the cards, the icon editor) hides everything at once
  without leaving. A game break is different: the pawn stays over the break's card and
  leaves with an animation when the game starts (§ Game breaks). The bubble pops (hidden) and regrows once the
  card is seen again.
- Reduced motion: the rise becomes a fade.

## Back stretch

Code: `HintPawn` → `stretch` (the cue), `IsoPawn` → `stretch`, `usePawnMotion` → the
`stretch` mode and `STRETCH_*` (docs/ISO_ART_FRAMEWORK.md § IsoPawn → "Back stretch").

- Every **new line of dialogue** — each bubble that grows in, the arrival's first one
  included — makes the pawn do a back stretch: a little crouch, then it draws itself up tall
  and thin while **curving its back** backward, away from the way it faces (`HintPawn` →
  `PAWN_FACING_DEG`, 15° toward the bubble), so the back curls away from the viewer and a
  little to screen-left. The spine bends and the head tips back with it. On screen that reads
  mostly as a reach upward with a slight lean left. It then holds the reach with a slight quiver, and lets go in a
  soft settling squash (1.2 s).
- Timed to the bubble: the cue's start is the bubble's `visibleAt` (when its grow-in begins),
  so the pawn stretches as it speaks. The cue is keyed by the bubble's key + `visibleAt`, so
  a bubble revived mid-pop stretches again.
- It is also one of the five **idle animations** (§ Idle animations): an idle stretch goes out
  as a stretch cue of its own (`useHintPawnIdles` → `idleStretch`), and `HintPawn` sends
  IsoPawn whichever of the two cues is newer.
- A poke during the stretch jumps on top of it (a flinch replaces it). Reduced motion: no stretch.

## Idle animations

Code: `hintPawn/useHintPawnIdles.ts`; `HintPawn` → `idle`, `idleStretch`, `stretch` (the merge);
the iso side is `deckTower/iso/pawnIdles.ts`, `PawnIdleProps.tsx`, `usePawnMotion.ts` (the
`idle` mode) — docs/ISO_ART_FRAMEWORK.md § IsoPawn → "Idles and the flinch".

- **When:** one idle a minute (`IDLE_EVERY_MS`, 60 s), counted from the landing, then from each
  idle, and restarted by every **tap on the pawn** (owner, 2026-11-08: studying cards does not
  reset it). While the pawn is unseen, leaving or parked there is no timer, and the minute
  starts over when it is back.
- **Which:** one of `HINT_PAWN_IDLES` at random, never the same twice in a row
  (`pickHintPawnIdle`):

| Idle | Kind | What it does |
|---|---|---|
| stretch | temporary | The back stretch (§ Back stretch) |
| sneeze | temporary | Two inhales, head going back, then a snap forward with a white puff (1.6 s) |
| sing | temporary | Head tipped back, swaying, ♪ / ♫ notes floating up and right (4.2 s) |
| doze | **state** | Head droops, slow sleeping breaths, big free-floating ink "Z"s drifting up off the head |
| knit | **state** | Two white needles clicking in front of the chest, a red scarf (`ISO.yarn` = `COLORS.redMk`) growing under them from nothing, without end, eventually off the bottom of the screen, a yarn ball on the slab with its strand up to the work |

- **States** (doze, knit): the pawn stays in them, and no further idle is scheduled, until a
  **tap** on the pawn or a **new line of dialogue** (a new speech bubble, keyed by its
  `stretchKey`) withdraws the cue (owner, 2026-11-08). It then eases back to standing (380 ms):
  a new line goes on to its back stretch, and a tap goes on to its reaction (§ Tap reactions).
- A new arrival clears every cue (`resetKey`), so a pawn parked asleep lands awake.
- Reduced motion: none of it.

## Tap reactions

Code: `HintPawn` → `onPawnTap`, `PAWN_TAP_JUMP_SHARE`, `OUCH_TIP`; `usePawnOuch.ts`;
`PawnOuchBubble.tsx`; `pawnHintLines.ts` → `OUCH_LINES`; the iso side is `IsoPawn` → `onTap`,
`usePawnMotion` → `poke`, the `flinch` mode.

Every tap restarts the idle minute and ends a doze or knit. Then:

- **4 in 5 ground taps: "ouch".** The pawn flinches on the spot (a quick recoil, tipped back
  away from the viewer) and says a short line in its own bubble. That bubble is a different
  kind of dialogue from the hint bubble: it says nothing about the card, never closes or
  replaces the hint bubble, and does not stretch the pawn.
  - **Lines:** `OUCH_LINES` (8 short ones, provisional copy drafted 2026-11-08), from their own
    shuffle bag in the visit store (`OUCH_LINE_BAG`), so no line repeats back to back.
  - **Where:** up and to the right of the head, **over the flashcard** (z-index 4, above the
    hint bubble's 3). The bubble's tail tip sits just off the head's outline (`OUCH_TIP`), and
    the body rises up-right of it on one line. It is inert (`pointer-events: none`), so a tap
    on the card under it still reaches the card.
  - **Life:** `OUCH_TTL_MS` (2.2 s). A re-tap replaces it (owner, 2026-11-08): the old one leaves
    at once and a new one inflates. Hiding, leaving or parking sends it away (`hush`).
  - **Motion:** it grows out of the pawn (from the tail tip) and **inflates like a balloon**,
    settling at full size with one light wobble whose swings shrink to rest without ringing
    (`ouchInflate`, 560 ms). It leaves by **fading while dropping** 16 px (`ouchLeave`,
    `OUCH_EXIT_MS` 280 ms). Reduced motion: plain fades. Same surface as the hint bubble (white,
    `COLORS.border` outline, `SHADOW.chip`).
- **1 in 5: the jump** (`PAWN_TAP_JUMP_SHARE`, owner 2026-11-08), the tower's poke jump.
- **Mid-air taps always jump again.** Jumps chain as on the Deck Tower, climbing with each
  tap.
- **No "!"**: passing `onTap` turns off IsoPawn's "!" emote, and the ouch replaces it. The
  Deck Tower's pawns keep the "!".

## Game breaks

Code: `HintPawn` → `away`, `returning`, `RETURN_MS`; `FlashcardsLearnPage.tsx` → the
`HintPawn` props, `PAWN_AWAY_PHASES`; the phases are `gameBreak/useGameBreak.ts` →
`GameBreakPhase` ([FLP_GAME_BREAKS.md](./FLP_GAME_BREAKS.md)).

- **The break's card** (`title` phase): the pawn **stays** in its corner, over the break's
  card, with **no bubble**. The page passes a null hint, because the word card the hint
  was about is covered. No arrival starts here either.
- **Play** sends it **away** (owner, 2026-11-10): the dismissing swipe's throw (§ Dismissing
  — `LEAVE_MS`, off the left edge, turning), but **not** a dismissal. It starts on the tap
  (`playPending`), before the game's prefetch settles, so a slow prefetch doesn't hold it
  back. The bubble, idles and ouch are off while it is away, and it takes no touches.
  `away` stays set through `growing`, `playing`, `shrinking`, `results` and `leaving`.
- **Back:** once the cards return (`skipping` after the results card, or `cards` after
  Leave), it **slides back in from the left** (`RETURN_MS` 420 ms, the throw in reverse
  with a slight overshoot; owner, 2026-11-10). The hint bubble then regrows, with its back
  stretch.
- **Skip** on the break's card never sends it away: the cards uncover and it just stays.
- Reduced motion: the same throw and slide as the dismissing swipe (which has no
  reduced-motion variant either).

## Night vest

Code: `HintPawn` → `wearsVest` (reads `src/timeOfDay/useDayClock.ts` → `useDayClock` and
`dayPhase.ts` → `phaseShare`), `IsoPawn` → `vest`, `iso/pawnFigure.ts` → `pawnVest`,
`usePawnMotion` → the `vest` / `vestStripes` / `vestOpenings` refs, `iso/palette.ts` →
`ISO.vest` / `ISO.vestStripe`, `src/theme/colors.ts` → `COLORS.hiViz`.

- **When:** after dark by the Deck Tower's clock: the learner's real sunrise and sunset,
  or a feature tester's pinned phase (the TimeOfDayToggle). It goes on once the hour-long
  twilight is **more night than day** (`phaseShare(time, "night") >= 0.5`), and changes
  live if a session spans that point. It does not follow the scene's colours, because the
  session is always drawn in day colours (the study camera fades the night wash out).
  It does not follow the Settings theme either.
- **What:** an **open** hi-viz safety vest. Neon yellow-green cloth (`COLORS.hiViz`, a
  token added for this prop) from the hips to over the shoulders, with two pale grey
  reflective stripes (`COLORS.grey`) across it. A gap runs down the front's centre line,
  a slit at the hem opening into a V at the neck, and it breaks both stripes. Two
  arm-hole scoops sit on the body's straight sides under the shoulder straps. The pawn has
  no arms, so they are just empty.
- **Turned toward the bubble:** the vest faces 15° off the viewer toward screen-right
  (`HintPawn` → `PAWN_FACING_DEG`, passed as `IsoPawn` → `facing`), so the pawn reads as
  turned to its speech bubble. The open front shows just right of centre, the left arm hole
  comes a little way onto the body's face, and the right one slips mostly round the back,
  leaving a thin crescent at the right outline.
- **How it is drawn:** painted on the body. The cloth and stripes are bands of the capsule
  between two spine heights, bounded by their rings' front arcs. The openings are drawn in
  the body's own ink over the cloth. All of it is clipped to the body's live outline and
  sits under the head. It is redrawn every frame with the pose, so it squashes, leans and
  arches with the back stretch. docs/ISO_ART_FRAMEWORK.md § IsoPawn → "Vest" has the
  geometry.
- Only the hint pawn wears one. The tower's own pawns do not (owner, 2026-11-08).

## Dismissing

Code: `HintPawn` → `onPointerDown` / `onPointerMove` / `onPointerEnd`, `LEAVE_MS`;
`hintPawnVisit.ts`.

- A **swipe left** on the platform or the pawn, past `DISMISS_DRAG_PX` (44 px), throws the
  platform off the left edge (`LEAVE_MS` 280 ms, turning). Then `dismissHintPawn()` hides
  it **for the rest of the td visit**, across parking, re-diving and every world. A shorter
  drag springs back. A rightward drag follows the finger at 25% only.
- The scope is the **td visit**: `DeckTowerPage` calls `useHintPawnVisit()`, which resets
  the store on mount, so leaving td (or reloading) brings the pawn back. A module-level
  store, because each world's session is its own `FlashcardsLearnPage` mount.
- **Tap to dismiss** closes **only the bubble** (owner, 2026-11-08): a tap anywhere on it
  (`HintBubbleSurface onSelect`) pops that hint's bubble (`closedKey`) and uncovers the More
  Info pill. The pawn and platform stay, and the next card's hint grows a new bubble. The cue
  (`PawnHintBody` → `DismissCue`, `pawn-hint-body__dismiss-cue`) is only a cue: "Tap / to / dismiss" on three short right-aligned
  lines, with a tapping-hand icon beside the middle "to", at 10 px (`DISMISS_CUE_FONT_SIZE`,
  below the type scale's smallest token), in the bubble's bottom-right corner, inset the same 6px from the bottom and right edges (`DISMISS_CUE_INSET`), sharing a row rather than taking
  a row of its own: the line's row in the text variant, the cpcd row in the cpcd variant (§ Bubble variants). Only the swipe sends the pawn away.
- **The cue is a soft introduction** (`pawnDismissCue`, [SOFT_INTRODUCTION.md](./SOFT_INTRODUCTION.md)):
  shown until the learner has had **49 pawn arrivals over at least 14 days**, then not
  rendered at all (`PawnHintBody` `showDismissCue`), so it takes **no space** and the line
  or the cpcd words take its width. The bubble stays tappable. A visit is one **arrival**
  (one study session, `HintPawn` → `DismissCueSoftIntro`, keyed by `arrival.id`), not one
  bubble, and two arrivals within 30 min count once; the style is fixed per arrival.
- A **tap** on the pawn is a tap reaction (§ Tap reactions), never a dismiss. The click
  that ends a drag is swallowed (`onClickCapture`), so a swipe never pokes.

## Layout and hit area

Code: `HintPawn` → `SCENE_BOX`, `GUTTER`, `BASELINE_DROP`, `BUBBLE_MAX_WIDTH`.

- A fixed dimetric scene (`makeProjector(39)`, tripled from 13 on 2026-11-08 so the pawn is
  3× as big). The platform keeps its original on-screen size (`PLATFORM_SCALE` = 13/39: the
  old 2.6 × 2.6 slab, 0.7 thick, at unit 13), **standing still** — no levitation bob (`IsoPlatform` without `floating`; owner, 2026-11-08) — with the
  pawn in the middle. The stage is about 76 × 140 px — the pawn makes up most of its height.
- **Colour**: `TOWER_WORLDS[world].platform` (gold / pink / cornflower) and `.floor` as the
  pawn's `surface`, **unwashed**. The study camera fades the time-of-day wash out on the dive
  (DECK_TOWER.md § Time of day → "The wash"), so a session is always seen in day colours.
- **No ground shadow** (`IsoPlatform` with `ground` omitted): it floats over DOM, not over a
  sky plane.
- **No rim band**: the slab's light bevel line round its top edge is dropped (its `rim`
  tone is the floor's own `material.top`), so the top reads as one flat face.
- **No pawn shadow** (`IsoPawn castsShadow={false}`): on the tiny slab the pawn's floor
  shadow clashed with the platform (owner, 2026-11-08).
- **Position**: 10 px from ContentArea's left, its bottom `BASELINE_DROP` (20 px) below the
  More Info pill's baseline (`24px + SAFE_BOTTOM`) — i.e. 4 px above the safe area's bottom
  (lowered from 6 px below the baseline, owner 2026-11-08). That puts it in the free space
  left of the centred pill.
- **Bubble**: in the band below the card (owner, 2026-11-08), **covering the More Info pill**
  (z-index 3 over the pill's 2) until the learner taps it closed. A sibling of the stage:
  from beside the stage (`BUBBLE_GAP` + the tail) to the right gutter, its bottom
  `BUBBLE_BOTTOM` (10 px) + `SAFE_BOTTOM` up. It **never overlaps the card**: its height is
  capped to the measured space below the card (`useSpaceBelowCard`: ContentArea's bottom
  minus the card frame's, de-scaled for the dive camera, less `BUBBLE_BOTTOM`,
  `BUBBLE_CARD_CLEARANCE` and `SAFE_BOTTOM`; floor 44 px). What doesn't fit is clipped by
  the content box (`hint-pawn__bubble-content`), not the body, so the tail survives. The
  hint fills the row; the dismiss cue sits in its bottom-right corner (§ Bubble variants). Its tail **points at the pawn's head** (owner, 2026-11-08): the head sits up and to the
  left of the bubble, so the shared straight-out tail can't reach it. `PawnBubbleTail` draws
  a short wedge (14 px) on the upper left edge, angled at the head's centre
  (`PAWN_HEAD_FROM_BUBBLE`, from `HEAD_CENTRE` in pawnFigure.ts), re-aimed as the body's
  measured height changes (`HintBubbleSurface tailSide="custom"`). It stays put during a drag and pops on a
  throw.
- **Hit area**: the stage is `pointer-events: none` except for the platform's hit box (from
  the floor's back corner down) and the pawn's tap target, so a swipe on the card's corner
  still reaches the card. The bubble is outside the stage and is all one tap target.
- Painted after the card stack and before the eip (z-index 2, like the pill), so the eip
  sheet covers it.

## The setting

Code: `src/hooks/useHintPawnSetting.ts`; `SettingsBody.tsx` → `settings-page__hint-pawn-row`.

Settings → Display → **Study helper**. Stored **per device** in localStorage
(`flp.hintPawn.off` = `'1'` when off; owner's choice 2026-11-08, no account column).
**Default on.** A `useSyncExternalStore` store, so a flip reaches a mounted (parked) session
without a reload. When it's off, `FlashcardsLearnPage` doesn't mount `HintPawn` at all.
