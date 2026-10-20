# Deck Tower (experimental)

`/deck-tower` draws the learner's **Learn Now** deck — every card that is off cooldown
right now, in all four utcm bands — as a stack of flashcards standing on an isometric platform, in the
art style of Nintendo/Paladin's *Good Job!*. It is the footer's **Deck** tab, which took
Discover's slot on 2026-10-17. Tapping the floor plate switches the tower to the
**Mastered** deck and back. A slide switch on the platform's front-left wall flips the
Learn Now tower between **Mix** (all four bands) and **Review** (Comfortable + Mastered),
with the Unfamiliar + Target cards ghosting out or dropping back in (§ Mix / Review switch). When the account has the reading or
writing goal on, a **world** for each lies beside the main one — swipe left or right to
dash there (§ Worlds).

The drawing comes from the iso art framework,
[ISO_ART_FRAMEWORK.md](./ISO_ART_FRAMEWORK.md). This doc covers only the page.

Sub-document: [DECK_TOWER_TRANSITIONS.md](./DECK_TOWER_TRANSITIONS.md) — the deck switch:
the plate button, the deck-transition registry (trap door) and the pawn-entrance registry
(fall from the sky), all timed to the new pawn's landing.

Sub-document: [FOCUS_MODE.md](./FOCUS_MODE.md) — the **focus lever** in each platform's
back-right floor corner (`IsoLever`, `useFocusLever`, `useLeverMotion`; layout
`TOWER_LAYOUT.leverAt`, whose hatch is the pawns' second obstacle). It shows on the Learn Now
deck once the world holds 100 off-cooldown cards (or focus is on), and switches the world to a
daily cap of 40. While focus is on, the world's ready counts — and so its Learn Now tower —
cover only today's remaining focus set.

Parent: [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md) (sub-documents table).

## Status

- Built on dev. It is front-end only: no new endpoint, table or migration.
- The route row is in `src/routes/routeMeta.ts` (`/deck-tower`: `access: "any"`,
  `shell: "frame"`, `chrome: "tab"`, `footerTab: "deck"`). The component is in
  `src/routes/registry.ts`. The tab is the `deck` row of `TABS` in
  `src/components/MobileFooter.tsx`.
- The page renders in a non-scrolling `MobileTabScreen` (title "Deck") and ends with a
  `FooterSpacer`, so the scene shrinks to fit above the footer bar.

## Layers

| Layer | File | Role |
|---|---|---|
| Page | `src/features/deckTower/DeckTowerPage.tsx` → `DeckTowerPage` | Picks the shown worlds, reads their counts, fits the viewBox to the world on screen (`scene` memo), runs one build-up per world, handles the world swipe and the scroll height shared across worlds, and shows the title block, inside `MobileTabScreen` |
| Page view | `src/features/deckTower/DeckTowerPlatform.tsx` → `DeckTowerPlatform`, `STARTLE_AT_CARDS` | The platform in one world's colours, with its tower, pawn(s) (depth-sorted, `pawnDepthRanks`), floor plate |
| Page constants | `src/features/deckTower/towerPlatforms.ts` → `TOWER_LAYOUT`, `TowerPlatformLayout`, `FLOOR_Z`, `GROUND_Z` | The platform and the layout on it (the same in every world) |
| Page constants | `src/features/deckTower/towerWorlds.ts` → `TOWER_WORLDS`, `WORLD_ORDER`, `TowerWorld` | The worlds: name, sky, space, platform tone, floor and ground surfaces (§ Worlds) |
| Page logic | `src/features/deckTower/useWorldPan.ts` → `useWorldPan`, `WorldPanView` | The camera dash between worlds: which world is drawn, the scene's slide, speed-line strength, the blending palette (§ Worlds → The pan) |
| Page | `src/features/deckTower/SpeedLines.tsx` → `SpeedLines`; `src/features/deckTower/WorldIndicator.tsx` → `WorldIndicator` | The dash's streaks; the floating edge arrows naming the neighbouring worlds |
| Page logic | `src/features/deckTower/useBuildProgress.ts` → `useBuildProgress`, `buildTimeline` | A tower's build-up, 0 → 1 (or straight to 1 when `animate` is false) |
| Page | `src/features/deckTower/SpaceBackdrop.tsx` → `SpaceBackdrop`, `SpaceBand` | The screen-space sky behind the scene, in the world's colour, which darkens into starry space as a tall tower is climbed (§ Sky → space) |
| Framework | `src/features/deckTower/iso/` | Every object, shadow and colour (see [ISO_ART_FRAMEWORK.md](./ISO_ART_FRAMEWORK.md)) |
| Page logic | `src/features/deckTower/useDeckSwap.ts`, `deckTransitions.ts`, `towerDecks.ts` | The deck switch (see [DECK_TOWER_TRANSITIONS.md](./DECK_TOWER_TRANSITIONS.md)) |
| Page logic | `src/features/deckTower/useStudyModeSwitch.ts` → `useStudyModeSwitch`, `IMPACT_MS`; `towerModes.ts` → `TOWER_MODES`, `MIX_ONLY_BANDS`, `bandTotal` | The Mix / Review switch: each world's mode and the clock of a switch (§ Mix / Review switch) |
| Data | `src/hooks/useFlpReadyCounts.ts` (once per bar: core, reading, writing; `GET /api/onDeck/flpReadyCounts`) + `src/hooks/useMasteredCounts.ts` + `src/features/flashcards/builtinCollections.ts` → `builtinCollectionCount` | Each world's figures, read through its own bar. **Learn Now** = the bar's cards that are OFF COOLDOWN (`flpReadyCountsByBand`, the flp's own readiness rule — the study hand's figures), in the bands of that world's mode (`TOWER_MODES[mode].bands` summed by `bandTotal`: all four in Mix, Comfortable + Mastered in Review); **Mastered** = the bar's whole Mastered total, cooling or not. So the Learn Now tower is not the fdp's Learning tile (which counts cooling cards and leaves out Mastered). Until 2026-10-20 Learn Now was U+T+C only (no off-cooldown Mastered), through `builtinCollectionCount({ kind: "learn-now" })`. Fetched once on open: a card coming off cooldown while the page is up does not grow the tower. The reading and writing figures are fetched even with the goal off (the same choice `useMasteredCounts` makes) |

## The scene

The platform geometry lives in `towerPlatforms.ts` and the worlds' colours in
`towerWorlds.ts`; `DeckTowerPage` holds the sky bands and the framing;
`DeckTowerPlatform` draws the platform.

| Constant | What |
|---|---|
| `PLATFORM`, `PLATFORM_THICKNESS` (`towerPlatforms.ts`) | The platform: an 11×11 slab, corner radius 0.9, 1.5 thick, `floating` (a slow bob, see [ISO_ART_FRAMEWORK.md](./ISO_ART_FRAMEWORK.md) § Levitation). The same in every world |
| `GROUND_Z` (`towerPlatforms.ts`), `TowerWorld.ground` | The sky's plane, 1.6 below the slab's underside, which receives the platform's shadow (its colour is the world's sky) |
| `FLOOR_Z` (`towerPlatforms.ts`), `TowerWorld.floor` | The platform's top (z = 0). The stack and the pawns stand on it (its colour is the world's platform top) |
| `TowerPlatformLayout.card` | A portrait 4.8×6.6 (`CARD_W` × `CARD_D`) footprint, centred on the platform |
| `TowerPlatformLayout.pawnAt`, `.roam` | Where the pawn starts (front right of the tower), and where it wanders: the floor inside the rim, around the tower (the floor label is not an obstacle: the pawn steps up onto it — `DeckTowerPlatform` → `plateStep`, `IsoPawn` `steps`). The obstacles are listed back-to-front; `DeckTowerPlatform` keeps `pawnDepthRanks` in state and slots each pawn into the keyed children just before the first obstacle it stands behind (`depthRankAmong` — not a count of those it is in front of, which put a pawn on the tower's back-left in front of the tower because it is past the back-right lever), so it walks behind the tower rather than over it |
| `STARTLE_AT_CARDS` (`DeckTowerPlatform.tsx`) | 50. When the build-up puts this many cards on a tower, its pawn is startled: it looks up, leaps away from the tower and a `!` pops over its head, stares up for a few seconds, then goes back to wandering (`IsoPawn` `startled`, `startledBy={layout.card}`). Decks under 50 never trigger it, and neither does arriving in a world whose tower already stands at 50+ (the remounted pawn was not watching it grow) |
| `BIRD_BAND_CARDS`, `BIRDS_AIRBORNE_MAX` | Birds (`IsoBird`, `useBirdFlights`) fly along the tower's four sides at the height of cards 100–150 (card k's underside is (k − 1) · `CARD_THICKNESS` up). One is in the air at a time (`BIRDS_AIRBORNE_MAX`): a bird crosses, then 1.5–6.5 s of empty sky, then the next. They take wing when the build-up puts the 100th card on the tower, so a deck under 100 never has birds. A deck short of 150 lowers the band's top to `SKY_CEILING_ABOVE_TOP` (3 units) over its settled top (`skyBand`), so they circle the tower and not empty sky. Back-side birds are drawn before the stack (it hides them) and front-side birds after the pawn's depth-sorted layers. They sit inside `IsoPlatform`, so they ride its 0.35-unit bob, which is lost in their own bounce |
| `CLOUD_BAND_CARDS`, `CLOUDS_IN_SKY_MAX` | Clouds (`IsoCloud`, `useCloudDrifts`) drift slowly (about a minute per crossing) past the tower's four sides, their bases at the height of cards 250–300. Up to 3 are in the sky at once, with 4–14 s gaps between drifts. They switch on when the build-up puts the 250th card on the tower: each slot's first cloud fades in partway across the screen, so the band is never empty at first. A deck under 250 never has clouds; a deck short of 300 lowers the band's top the same way as the birds' (`skyBand`). Back-side clouds are drawn first (before the back-side birds) and front-side clouds last. They are ~57 units above the birds, so the two never overlap. Within each side they are sorted with `sortCloudsBackToFront`. Under reduced motion they still show, parked and still |
| `WIND_BAND_CARDS`, `WIND_GUSTS_MAX` | Wind gusts (`IsoWind`, `useWindGusts`) sweep past the tower's four sides with their baselines at the height of cards 350–400, in the empty sky between the clouds and space. A gust is two or three straight white streaks, the main one ending in a curl. It draws on head-first, then erases tail-first, over about 1.5–2.3 s. Up to 2 play at once, with 1–4 s gaps. Wind starts when the build-up puts the 350th card on the tower, so a deck under 350 never has wind; a deck short of 400 lowers the band's top the same way as the birds' (`skyBand`). Back-side gusts are drawn first, front-side gusts after the front birds. Under reduced motion there is no wind |
| `SPACE_BAND_CARDS` | 450–650. Over this height band the sky darkens into space and stars fade in (§ Sky → space) |
| `TowerPlatformLayout.modeSwitch` | The Mix / Review switch (`IsoWallSlider`) on the platform's front-left wall, centred along it: a 2.0-unit slot and a 3.1-unit label plate, 0.35 apart, on the wall's mid-height (§ Mix / Review switch) |
| `TowerPlatformLayout.labelPlate`, `.labelPlateHit` | The deck's floor plate in front of the stack, and its enlarged tap target. Tapping it switches the world's deck |
| `TOWER_DECKS` (`towerDecks.ts`) | Each deck's name (on the top card and the plate) and its band, the same in every world: `RAMP[LEARN_NOW_HUE].mid` (`yelM`) for Learn Now, `RAMP[MASTERY_BAR_HUES.core].mid` (`bluM`) for Mastered. The `mid` tier, because the fdp card's pale `surface` washes out on the cream card face |
| `FALL_CLEARANCE` | Extra world units a falling tower drops past the screen's bottom edge (the scene memo's `fallDistance`) |

There is no carpet: the page does not use `IsoCarpet`.

The stack's `count` is the shown deck's figure on that world's bar (Learn Now, in Mix, on open).
The birds, clouds, wind and sky → space follow the tower of the world on screen; none
start while the camera dashes between worlds (the ones already out finish crossing). The deck's name
(`TOWER_DECKS[…].label`) is printed twice: in the top card's head band, and on
the label plate, an `IsoFloorLabel` on the floor in front of the stack (as wide as the card,
between its front-left face and the platform edge), raised slightly off the floor as a push
button (`IsoFloorLabel` `raised`; [DECK_TOWER_TRANSITIONS.md](./DECK_TOWER_TRANSITIONS.md)
§ "The plate button"). It is part of the floor: it is passed
to `IsoPlatform` as a floor decal, outside the pawn's depth sort, and the pawn steps up onto
it (`IsoPawn` `steps` at the plate's live height, so a pawn on the plate sinks with it when it
is pressed). The floor plate keeps
the deck named when a tall tower's top card is scrolled off screen. It is also the deck
switch ([DECK_TOWER_TRANSITIONS.md](./DECK_TOWER_TRANSITIONS.md)).

**Fixed scale, scroll instead of zoom.** Cards keep a fixed thickness, so a big deck is
far taller than the screen. The page never zooms out to fit it:

- **Width sets the scale.** The viewBox is as wide as the platform (plus padding) and
  the svg is always the full width, so the scale depends only on the platform. The
  viewBox is centred on the platform's own centre; the shadow is ignored, because it
  slides off down-right with the light and would push the platform left of centre.
- **Height follows the tower on screen.** The viewBox runs from the settled tower's top
  in the world on screen (plus `TOP_HEADROOM`, 9 units, so the top card clears the header
  and title) down to the platform shadow's lowest point plus `BOTTOM_MARGIN` (0.4 units).
  The svg takes that aspect ratio (`style.aspectRatio`). It is fitted to the settled
  tower, so nothing reflows during a build-up: it refits once, when the bar's counts
  arrive (before it grows; until then it fits as 0 cards), and on arriving in another
  world. The memo is keyed on that tower's count.
- **Cards' imprint.** The floor under the stack always carries an imprint of its cards,
  printed "0 cards" (`IsoCardImprint`, a floor decal before the plate, so it swings with
  the trap door; see [ISO_ART_FRAMEWORK.md](./ISO_ART_FRAMEWORK.md) § IsoCardImprint). The
  stack covers it; an empty deck, a collapse to 0 or the trap door's fall shows it already
  there. It is not a shadow, so it has no light offset. It is hidden while the deck's
  count is still loading (that reads as 0): `DeckTowerPlatform` `showImprint`, set by
  `DeckTowerPage` from `towerCounts`. Code: `DeckTowerPlatform.tsx` →
  `DeckTowerPlatform` (`decals`).
- **Build-up pace.** `buildTimeline` (driven by `useBuildProgress`) has two phases:
  - **Cruise:** a steady `BUILD_CARDS_PER_SECOND` (40), so every deck rises at the same
    speed and the duration scales with the deck.
  - **Settle:** the last `BUILD_DECEL_CARDS` (60) cards decelerate on a power-
    `BUILD_DECEL_POWER` (3, cubic) ease-out to a stop — it brakes hard, then crawls over
    the last few cards. It is timed to start at the cruising speed (settle time =
    power × cards ÷ speed = 4.5 s), so there is no lurch where the phases meet. A deck
    smaller than 60 decelerates the whole way.

  581 cards take about 17.5 s. The build-up is skipped under `prefers-reduced-motion`.
- **Scrolling.** The svg sits in `deck-tower-page__scroller`, the page's one vertical
  scroll surface (`touch-action: pan-y`). It runs from the **top of the screen**, over
  the header, to the footer bar's top (`FOOTER_TOTAL_HEIGHT`), so a tall tower climbs
  over the header and off the top of the screen. This works because the stage is
  deliberately *unpositioned*: the scroller's containing block is `MobileTabScreen`'s
  full-screen `ScreenRoot`, which also lets it escape the clipping of the
  overflow-hidden (but unpositioned) `ScrollArea`. The cost: the header's controls (the
  minute-points flame) are covered and not tappable on this page. Its scrollbar is hidden (`scrollbarWidth: none` +
  `::-webkit-scrollbar`), the same pattern as `GamesBelt`. The scene is pinned to the bottom with
  `marginTop: auto`, so a short tower sits on the footer with sky above it. (Not
  `justify-content: flex-end`, which would push overflow past the top, where a scroll
  container cannot reach.) The page opens scrolled to the bottom. A refit within a world
  (its count arriving, a deck swap) re-snaps to the bottom; arriving in another world
  keeps the height of the world left (§ Worlds → "Scroll height").
- **Title.** The title block (the world on screen's `TowerWorld.title`: "Flashcards",
  "Reading Flashcards" or "Writing Flashcards"; until 2026-10-19 it named the deck, and
  the count subtitle was removed 2026-10-17) uses the app's header-title type (`pageHeaderTitleTypeSx("hub")` from
  `src/components/PageHeader.tsx` — semibold `FONTS.sans`), enlarged to 40px, in white. It stays
  in normal flow under the header, raised above the scroller
  (`z-index: 2`, `pointer-events: none`, so drags on it still scroll). A tall tower
  scrolls up behind it.
- **Shadow.** It is fitted (above), because the scroller clips at the footer bar and an
  unfitted shadow is cut off there.

## Worlds

`towerWorlds.ts`, `useWorldPan.ts`, `SpeedLines.tsx`, `WorldIndicator.tsx`,
`DeckTowerPage.tsx`.

| World | Id (`MasteryWorldId`) | Title | Sky | Platform | Shown when |
|---|---|---|---|---|---|
| Main | `core` | Flashcards | `bluMk` | `gld` | Always |
| Reading | `reading` | Reading Flashcards | `limMk` | `pnk` | `users.readingGoal` |
| Writing | `writing` | Writing Flashcards | `redMk` | `bluMk` | `users.writingGoal` |

Side by side, left to right (`WORLD_ORDER`): **reading ← main → writing**. One world is on
screen at a time: the same platform and layout (`TOWER_LAYOUT`) in that world's colours.
The goals are the same gate the fdp's Centers rail uses; a world whose goal is off is
skipped, and if it goes off while it is on screen the page falls back to main.

- **Colours.** Each world has its own sky and platform hue (table above, all from the
  framework); they are NOT the bars' `MASTERY_BAR_HUES` (writing's sky is red, not its
  bar's purple). Reading's `limMk` and `pnk` are single-tier tokens added for this page
  (`colors.ts` § "Lime and pink"), outside the design's ramp. Space is ONE night for every world (`SPACE` = `spaceOver(bluMk)`, main's sky taken down to
  night): each sky fades into the same starfield. `platformTone` gives a platform the gold platform's shading. No platform is yellow (it
  would hide the `yelM` LEARN NOW plate). The decks' plates are the same in every world —
  Mastered is always blue (`bluM`) — so writing's blue platform carries it one tier
  lighter than the slab.
- **Getting there.** A horizontal swipe on the scene (`useSwipeCommit` on the scroller,
  axis-locked so a vertical drag still climbs the tower): LEFT brings the right-hand
  world in, RIGHT the left-hand one. It commits past `WORLD_SWIPE_FRACTION` (18%) of the
  stage width (min `WORLD_SWIPE_MIN_PX`, 48 px) or on a flick. While held, the scene follows
  the finger (`DRAG_FOLLOW`, 0.4; only `DRAG_FOLLOW_EDGE`, 0.12, toward an edge with no
  world) on the svg's CSS `translate`, separate from the pan's `transform`, and springs
  back if it does not commit. The edge indicators (`WorldIndicator`) name the
  neighbours: a white arrow at the screen edge floating gently outward, with the world's
  name beside it on the inner side ("‹ Reading", "Writing ›"; the two arrows float in
  step on a shared clock, `floatPhaseDelay`), drawn straight on the sky
  with no box — an exception to the
  app's outline rule for tappable things. A tap does the same as the swipe. Swipe and arrows are off (arrows hidden) while a pan or this world's deck
  swap runs.
- **The pan** (`useWorldPan`, ~1.3 s; instant under reduced motion):
  1. `OUT_MS` (300): the scene whips off the far side (ease-in) as the speed lines gather.
     A swipe carries straight into this (`PanCarry`): the release hands over the scene's
     dragged offset and the finger's release speed (`useSwipeCommit`'s `SwipeRelease`, both
     × `DRAG_FOLLOW`), and the scene leaves from there at that speed, still accelerating
     (`outPlan`: the phase is shortened to the distance left, and never decelerates). The
     drag's `translate` is dropped the same frame the pan's `transform` takes the offset
     over; only a release that does not move to a world springs back. A finger that stopped
     before lifting (`RELEASE_STALE_MS`, 60 ms) carries no speed, only its offset.
  2. `CRUISE_MS` (560): empty sky racing past (`SpeedLines` at full strength: 16 flat white
     streaks racing opposite to the camera) while the sky blends into the new world's
     colour (sky and space both, smoothstep). The drawn world switches at the start of this
     phase, while no scene is on screen.
  3. `IN_MS` (440): the new world's scene slides in from the near side (ease-out) and the
     streaks die away.
  The camera travels toward the destination, so going right (main → writing) the scene
  leaves to the left. The title block rides with it: it slides on the same
  `sceneShiftX` and follows a held swipe on the same `translate` (`titleBlockRef`), so
  the old world's title whips off and the new one's slides in. The plate does not press during a pan.
- **Arriving.** The platform is keyed by world, so it mounts fresh with its pawn standing.
  Every world's tower is kept built whether on screen or not: main's builds up on page
  load (`useBuildProgress`), and a skill world's goes straight to full height
  (`animate` false) — it only grows after a deck swap there.
- **Scroll height.** One altitude shared by all worlds: the camera pans sideways, so
  arriving opens at the height the learner last scrolled to (`climb`, px above the
  bottom; the svg's height differs per world, so a `scrollTop` would not carry over). A
  shorter tower clips it at its top, but `climb` keeps the height asked for (the page's
  own scroll sets are ignored when recorded, `placedScrollTop`), so panning on to a taller
  world climbs back to it. A refit within a world (counts arriving, a deck swap) resets
  it to the platform. Not persisted: a page open starts at the bottom.
- **Its own deck.** Every world has its own plate, deck and swap (one `useDeckSwap` per
  world, [DECK_TOWER_TRANSITIONS.md](./DECK_TOWER_TRANSITIONS.md) § "Several worlds"):
  reading flips between reading Learn Now (off cooldown) and reading Mastered, writing
  likewise. The deck shown is named on the plate and the top card; the page title names
  the world (`TowerWorld.title`), switching mid-pan while no scene is on screen.
- **Sky travellers everywhere.** Birds, clouds, wind and space appear in every world, at the
  same card heights, around that world's tower. In main they are earned (a band appears
  once the tower reaches it). Reading and writing always have birds, clouds and wind, for
  now, because their decks are usually much smaller: their sky is framed at least
  `SKILL_WORLD_SKY_CARDS` (the wind band's top, 400 cards) high, so a short tower stands
  under scrollable sky. The bands keep their card heights, and the travellers fly
  whatever the count (`alwaysHasSky`). Space is still earned, so a short skill tower
  never reaches it.

(Until 2026-10-19 the reading and writing towers stood on their own platforms behind the
main one, up-left and up-right, reached by a diagonal camera pan; that layout was replaced
by the swipeable worlds.)

## Mix / Review switch

`towerModes.ts`, `useStudyModeSwitch.ts`, `DeckTowerPlatform.tsx`, `DeckTowerPage.tsx`
(`onModeTap`, the camera effect, `keepClimbFor`), drawn with `IsoWallSlider`,
`IsoCardRuns` and `IsoSmokePuff` ([ISO_ART_FRAMEWORK.md](./ISO_ART_FRAMEWORK.md)).

A slide switch pokes out of every world's platform on its front-left wall (under the floor
plate), with a label plate beside it naming the mode: **MIX** (knob at the slot's near,
upper-left end; `RAMP.yel.mid`) or **REVIEW** (far end; `RAMP.blu.mid`) — the flp study
hand's hues for the same modes. The modes are the flp's own
(`server/contracts/studyMode.ts`): Mix = all four utcm bands, Review = Comfortable +
Mastered, both counting off-cooldown cards only.

- **Only on Learn Now.** While the Mastered deck is up (the plate's `titleDeck`), the
  label greys out (`ISO.inertPlate` / `inertInk`) and taps are ignored; the Mastered tower
  is always the whole Mastered total. The mode is kept, so swapping back to Learn Now
  builds the tower in it.
- **Per world, for the visit.** One `useStudyModeSwitch` per world, held by the page, so a
  world keeps its mode across world swipes. Not persisted: a page open starts in Mix.
- **When it takes a tap.** The tower settled (build-up at 1), counts loaded, and no swap,
  pan or other switch running. While a switch runs, the plate, swipes and arrows are off.
- **Instant** under reduced motion, or when nothing moves (no off-cooldown U+T cards, or
  no cards): the mode and the count just change.

**Mix → Review (collapse).** `planCardCollapse(mixCards, U+T)` picks the U+T count's worth
of the tower's cards at random (`IsoCardRuns`): they ghost out a few at a time over about
a second, each leaving a light wireframe of its cards behind that holds a beat and then
fades too (in the same order), while the top card's figure counts down to the Review
total. Once the last wireframe has gone the gaps hold open a beat, then every floating run
drops into place under gravity, the lower ones landing first. If the bottom card is one of
the ghosts, the tower's floor shadow fades with it and darkens back in as the lowest run
lands on the floor, from the impact (it stays gone when every card ghosts). The scene stays fitted to the Mix tower until the collapse ends, then refits to the
Review tower keeping the altitude (`keepClimbFor`), so the camera does not jump.

**Review → Mix (drop).** At the tap the page plans against the Mix frame it is about to
refit to (`fitScene`, pure):

1. **Camera** (`CAMERA_BASE_MS` 260 + 0.5 ms/px, ≤ `CAMERA_MAX_MS` 900; 0 if already
   there): the scene refits to the Mix frame keeping the altitude, then the scroller eases
   so the landing point — the Review tower's top — sits `LANDING_ON_SCREEN` (62%) down the
   screen. Written straight to `scrollTop` and marked as the page's own (`placedScrollTop`).
2. **Drop:** a tower of the U+T cards (`IsoCardStack` with its top card printing the Mix
   total, `figure`) falls from with its underside `DROP_CLEARANCE` (1 unit) above the
   screen's top edge — at least `DROP_MIN_LIFT` (8) above the landing — under
   `DROP_GRAVITY` (130 units/s²), as a CSS free fall. A seam is drawn under its bottom card,
   where it meets the Review tower's top card. When the Review tower had no cards it lands
   on the bare floor instead: its floor shadow is drawn there, still, and fades in from the
   impact (`shadowLandTiming`) — not before, or it would cover the "0 cards" imprint while
   the tower is still in the air.
3. **Impact** (`IMPACT_MS` 760): the whole loaded platform sinks `IMPACT_SINK` (0.55
   units) and springs back past rest before settling (on top of its bob), and a ring of
   smoke puffs bursts round the join — the back half under the dropped tower, the front half
   over it. The tower counts as the Mix total from this frame (`dropLanded`, timed from
   the frame the drop mounted, since its CSS fall starts on that paint), so a total crossing
   `STARTLE_AT_CARDS` startles the pawn on the impact, and a band the tower now reaches
   (birds, clouds, wind) switches on with it.

At the end the two stacks are replaced by one `IsoCardStack` of the Mix count, which draws
the same picture. After the first switch on main, a count change there no longer grows the
tower from nothing (`useBuildProgress`'s `animate`), since the switch animated it.

## Sky → space

On a tall tower the sky turns into space as the learner scrolls up.

- **Backdrop.** `SpaceBackdrop` is an absolutely positioned box with the scroller's box
  (top of the screen → footer bar) and z-index (1). It comes before the scroller in the
  DOM, so the svg paints over it. It is drawn in screen space and is not part of the iso
  framework. `MobileTabScreen`'s `surfaceColor` follows the same palette's sky, but the
  backdrop covers it everywhere above the footer.
- **Altitude, not time.** The scene memo gives it `spaceBand`: the viewBox y's of cards
  `SPACE_BAND_CARDS.from` and `.to` on the tower's axis. On each scroll it maps the
  middle of the visible scroller to a viewBox y and gets `t` (0 below the band, 1 above
  it).
  - It measures the scene through the scroller's direct `<svg>` child
    (`:scope > svg`), not its first child — the scroller also holds the page's
    falling-shadow `<style>`.
  - The background blends the world's sky → space (`palette`, from `useWorldPan`) with
    `mixHex` on `smoothstep(0, 1, t)`. Mid-pan the palette itself blends between worlds;
    each change repaints at once, without waiting for a scroll.
  - The stars fade in on `smoothstep(0.35, 1, t)` (`STARS_FADE_FROM`), so they never
    show on a light sky.
  - Scrolling back down brings the sky back. A tower whose top stays below the band
    never sees space. One just short of it can show a slight darkening at its top,
    because the screen's middle sits in the `TOP_HEADROOM` sky above the top card.
- **Stars.** Two tiled layers of flat white dots (`STAR_LAYERS`) are made once as SVG
  data URIs from a seeded PRNG, so the field is the same on every visit. The tiles are
  233 px and 317 px, so the repeat is hard to spot. The layers drift down at 0.4% and 0.8%
  of the distance climbed, a slow parallax that keeps space looking far away.
- **No re-render.** The scroll listener is passive and rAF-throttled. It writes
  `backgroundColor`, `opacity` and `backgroundPosition` straight to the DOM rather than
  React state, so scrolling never re-renders the tower, pawn, birds or clouds.

## Palette notes

The white page title on the worlds' `Mk` skies breaks v2's "colour never carries text" rule. That
copies the reference art's white logo on blue. Over space (`spaceOver(sky)`) it reads
as normal light-on-dark. For the framework's colour divergence, see
[ISO_ART_FRAMEWORK.md](./ISO_ART_FRAMEWORK.md) § Palette.
