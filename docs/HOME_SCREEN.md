# Home Screen

> ↑ Part of [DECK_TOWER.md](./DECK_TOWER.md) (a sub-document: the home screen is a stage of
> the Deck Tower page, not a route of its own).

The screen the app opens on. It stands on td's own sky (time of day, weather, stars, aurora)
and shows the **home platform**: its own floating platform with the learner's pawn on it, and
the unlocks that will spawn there as they progress. Over it, the app's title (a placeholder
wordmark for now — § The title). Under the platform: the **Dictionary** key (left) and the
words **"Swipe down to enter"** painted on the sky (right).

- **Dictionary** opens `/dictionary` with the circle transition. Its back arrow returns to
  td, not to the home screen.
- **Enter** — a swipe anywhere on the home that scrolls down toward the tower (finger up,
  wheel down; `useEnterSwipe`), or a tap on the words — takes the camera **down** to the sky above the top of the learner's deck, then
  scrolls down the tower to the platform, slowing a little at the end.
- **The home stands above the tower.** From td, a fresh pull up past the top of the deck goes
  back up to it (§ Back to home). Momentum stops at the top; only another swipe goes home.

## Status

Built 2026-11-09. Client only: no route, no migration, no server change. **Unlocks:** none
yet. The pawn is the default (and only) occupant, and there is deliberately **no unlock
plumbing** (owner, 2026-11-09: "pawn only, no plumbing"; wire it up when the first real
unlock arrives — § The platform).

## Layers

| Layer | File | Role |
|---|---|---|
| Page logic | `src/features/deckTower/home/homeLaunch.ts` → `homeDueOnLaunch`, `markHomeTaken` | Whether this td mount opens on the home stage (§ When it shows) |
| Page logic | `src/features/deckTower/home/useHomeEntrance.ts` → `useHomeEntrance`, `HomePhase`, `HomeShiftDirection`, `shiftFrameAt`, `descentTimeline` | The phases, both shifts' frames and the descent's speed profile (§ Enter, § Back to home) |
| Page logic | `src/features/deckTower/home/useHomePull.ts` → `useHomePull` | The pull past the deck's top that goes back home: touch and wheel, armed only by a gesture that starts at the top (§ Back to home) |
| Page view | `src/features/deckTower/home/HomeStage.tsx` → `HomeStage` | The layer over td: the title, the scene, the footer row, the enter swipe (`useEnterSwipe`) and its own shift offset |
| Page view | `src/features/deckTower/home/HomeScene.tsx` → `HomeScene` | The iso scene: td's own `DeckTowerPlatform` in td's frame, with the pawn alone (§ The platform) |
| Shared view | `src/features/deckTower/DeckTowerPlatform.tsx` → `DeckTowerPlatform` (`plate`, `lever` optional) | The platform itself, shared with td |
| Page logic | `src/features/deckTower/home/useHomePull.ts` → `usePullGesture`, `useHomePull`, `useEnterSwipe` | The one release-committed vertical gesture, read both ways: td → home and home → td (§ Back to home, § Enter) |
| Page view | `src/features/deckTower/home/HomeButtons.tsx` → `HomeButtons` | The Dictionary keycap and the "Swipe down to enter" words (§ The buttons) |
| Page view | `src/features/deckTower/home/HomeTitle.tsx` → `HomeTitle` | The placeholder title wordmark (§ The title) |
| Shared style | `src/features/deckTower/towerKeycap.ts` → `towerKeyShadow` | The diagonal-wall keycap shadow, shared with td's filter keys (`TowerFilterKeys`) |
| Shared view | `src/features/deckTower/SpeedLines.tsx` → `SpeedLines` `axis="y"` | The world pan's streaks turned vertical, for the shift |
| Host | `src/features/deckTower/DeckTowerPage.tsx` → `home`, `homeUp`, `homeShifting`, `homeStageShown`, `altitudeAt`, `homeAltitudeY`, `bankingHeld`, `openDictionaryFromHome`, `homeWorld` | Mounts the stage, hides the chrome, holds td's events, owns the scroller |
| Destination | `src/features/dictionary/DictionaryPage.tsx` → `readHomeBack`, `backToTower` | The back arrow shown only when the page was opened from home (§ Dictionary) |
| Hold | `src/minutePoints/dailyBanking/DailyBankingContext.tsx` → `DailyBankingProvider` `held` | The banking run waits for the home screen to go (§ What waits) |

## When it shows

The app **opens** on it once per launch (one JS session: a cold start or a reload), and only
when the launch itself landed on `/`. A launch that deep-links elsewhere (`/dictionary`, a cdp) never shows
it, not even when the learner later taps the Deck tab: that tap is navigation, not an app
open. Every later td mount (back from Dictionary, a Deck-tab tap) opens straight on the tower.
From td, the learner can always go back up to it with the pull (§ Back to home).

- "Landed on `/`" reads the document's own load URL (`performance` navigation entry,
  `LAUNCHED_ON_TD`), which no SPA route change rewrites.
- `homeDueOnLaunch` is a pure read, used as a `useState` initializer (which StrictMode may
  call twice). The page marks it spent with `markHomeTaken` from an effect.

## It is a stage of td, not a route

`HomeStage` is an absolutely-positioned layer over td's scroller and header (`z-index: 4`),
with a transparent background, so td's `SpaceBackdrop` is its sky. The sky never remounts,
which is what lets Enter read as one camera move across it. While the stage is up:

- **The tower is laid out but hidden** (`visibility: hidden` on the scroller), so it can be
  measured for the shift. The scroller is locked (`overflow: hidden`, `pointer-events: none`).
- **No header, no footer.** The header layer sits at opacity 0 and fades in as the descent
  starts. The footer is hidden by `useHideFooter` (shared with a study) and slides back in as
  the descent starts.
- **No world swipe** (`panBlocked`), so the world arrows and the cards cue are hidden too, and
  there is no cards-page snap or platform stop (`useTowerCardsScroll` `enabled` / `snapEnabled`).
- **The platform stands in the main world's colours** (`homeWorld` = `litWorld(core, light)`)
  even when td opens on another world (a reload with `towerWorld` route state). The sky behind
  it is the world on screen's (`pan.palette`).

### What waits

td's own events would play unseen behind the stage, so they **wait for `homeUp` to clear**
and then play where the learner can see them:

| Event | Hold |
|---|---|
| The opening grow (main's tower opening at its last height, then growing to today's count — DECK_TOWER.md § Opening at the last height) | The `resolveRecount` effect returns early while `homeUp` and re-runs on its change |
| Cooldown releases (sky drops) | `releaseCooldowns` skips the shown tower while `homeUp` (it is in the effect's deps) |
| The daily banking run (header flame → avatar embers) | `DailyBankingProvider held={bankingHeld}`: held only until the learner first leaves the launch's home (`homeLeftOnce`). The run is stamped seen as it starts, so starting it unseen would lose it for the day, and a later return home must not cancel a run already playing |

## The platform

**It is td's platform**, not a lookalike: `HomeScene` renders `DeckTowerPlatform` itself with
td's layout (`towerPlatforms.ts` → `TOWER_LAYOUT`, the 11 × 11 slab), td's projector and
td's frame, so every style, size and behaviour is td's own.

- **Same spot.** `HomeStage` places the svg the way td's scroller places its scene at rest on
  the platform line: full width, bottom edge on the footer slab's top (`SLAB_FOOTER_TOTAL_HEIGHT`
  up from the screen's bottom). Its viewBox takes td's left edge, width and bottom edge
  (`DeckTowerPage` passes td's `scene` as `frame`; those three are the same for every tower
  size); only its top is its own (`HEADROOM_Z` over the slab, since there is no tower). So Enter
  lands td's platform exactly where the home's stood.
- **What it leaves off**: no deck (`stack={null}`), no "0 cards" imprint, no deck plate and no
  focus lever (both optional props for this caller), no corner fixture, no lightning, no cloud
  shadows. The empty deck spot stays an obstacle (`TOWER_LAYOUT.roam`), and with no cards its
  summit is closed, so the pawn walks round it as it does round td's tower.
- Lit for the hour: the main world through `litWorld`, and the scene takes `light.wash`.
- Weather: the sky's particles are SpaceBackdrop's. The platform also takes td's platform rain
  (not under an aurora) and td's fog field (`fogClouds`, planned against td's identical frame).
- **The pawn**: td's (`TOWER_LAYOUT.pawnAt`, the same roam, tappable), one pawn, never swapped.
- **Unlocks (future).** Not built. When the first one lands, it needs a slot in
  `DeckTowerPlatform`'s obstacle layers (its `layers` / `roam.obstacles` pairing; the pawn
  depth-sorts against it through `pawnDepthRanks`). The one existing minutes→unlocks curve,
  the Night Market's `unlocksForMinutes`, was removed with that feature on 2026-11-09 (archived —
  [ARCHIVED_FEATURES.md](./ARCHIVED_FEATURES.md)). This is an open decision, not a plan.

## The title

`HomeTitle`, centred `TITLE_TOP_PX` (56 px) under the top safe area (`HomeStage`), in the sky
the hidden header leaves. ⚠️ **Placeholder** until a real title asset exists: the app's name
("Cow", as `index.html` and `usePageTitle`'s `APP_NAME` spell it) in the face td paints on its
sky (`FONTS.cjk`, bold, 64 px — "Tap to Start"'s), `COLORS.white` under the hour's wash, with a hard 4 px (1, 1) cast
shadow in `--home-ground-shadow` (the keys' shadow). The asset replaces the component's body;
`HomeStage` places the box.

## The buttons

One row (`HomeButtons`) in the hidden footer slab's footprint: the Dictionary keycap in the left
third (glyph over label, like the footer's tabs) and, in the right two thirds, **"Swipe down to
enter"** over one down chevron centred under the words — a white sky cue cut exactly like td's world labels
("‹ Reading", "Writing ›", `WorldIndicator`): the same 32 px MUI chevron turned down
(`ExpandMore`), the same `FONTS.cjk` / `SIZE.bodyLg` / bold label, washed `COLORS.white`, and
the same float on the shared sky-cue clock (`skyCueFloat` → `FLOAT_MS`, `floatPhaseDelay`),
drifting down 4 px (the way the swipe goes) where the world labels drift outward. The words are a `<button>`, so a
tap or the keyboard also enters, but the swipe is the way in they advertise (§ Enter).

The keycap is 60 px tall, 15 px radius, in the hidden footer
slab's footprint (`HomeStage`: its 16 px side insets, standing on `SLAB_FOOTER_BOTTOM`, its
top on the slab's top line), cut exactly like td's cards-page filter keys: a diagonal 5 px wall, a hard cast
shadow on the sky, the hairline rounded edge (`towerKeyShadow`) and the app's raised-key press
(`keycapPressSx`, down the (1, 1) diagonal). Like the filter keys it carries **no outline**: on
the sky a keycap's edge is its wall and cast shadow (the tower style's exception to CLAUDE.md's
outline rule). The cast shadow reads `--home-ground-shadow` (`shadowTone(sky)`, set by
`HomeStage`).

| Key | Face / wall | Glyph |
|---|---|---|
| Dictionary (left) | `COLORS.cardFace` / `COLORS.cardWall`, the card stock of the slab footer | `translate` (the Dictionary tab's) |

The key and the words go dead once the shift starts.

## Dictionary

The key pushes `/dictionary` with the **circle transition** grown from the key's centre
(`useSlideNavigate` `circleFrom`), with route state `{ homeBack: true, circleFrom }`.

- Only with that state does `DictionaryPage` wear a back arrow (`showBack`, node-style left
  arrow). Opened from the footer it stays a bare tab root.
- The arrow (`backToTower`) runs `usePageSlide`'s **circle exit** onto the same point (the
  page is wrapped in `dictionary-page__surface` so the exit has a surface to clone), then pops
  to td's own history entry (`navigate(-1)`), so the arrow and the browser's Back agree. If the
  Dictionary is the tab's first entry (a reload), it replaces itself with `/`.
- Either way td remounts **without** the home screen, which is spent for the launch.

## Enter

`useHomeEntrance`. Phases: `home` → `shift` → `descend` → `done`.

**The trigger** is `useEnterSwipe` on the home stage's root: the same gesture as the pull home
(`usePullGesture`, the same thresholds) read the other way — a one-finger drag UP that commits
on release past `PULL_PX` (or a `FLICK_MIN_PX` flick at `FLICK_SPEED`), or a wheel stream
scrolling DOWN `WHEEL_PULL_PX`. "Swipe down" means scroll down toward the tower, which is
below. A tap on the words does the same.

1. **The shift** is the world pan's dash turned vertical, on the same beats (`DASH_MOTION`).
   The camera goes DOWN (the home is above the tower):
   - `out` (260 ms): the home stage slides up off the top of the screen (ease-in) as vertical
     speed lines gather (`SpeedLines axis="y" direction={-1}`, streaks rising: the camera
     sinks).
   - `cruise` (260 ms): empty sky races past. Its first frame calls `onCruise("enter")`: with
     nothing on screen, the page jumps the scroller to the **top of the tower** (scrollTop 0,
     the tower top + `TOP_HEADROOM` of sky) and measures the sky's altitude where it left (the
     platform line) and at the top (`altitudeAt`). Through the cruise the sky blends between
     them (`homeAltitudeY` → `SpaceBackdrop` `altitudeY`, smoothstep), so a tall tower's top
     arrives in space without a jump.
   - `in` (300 ms): the sky over the tower's top rises in from below (the scroller's
     `translateY`, ease-out) as the streaks die away.
2. **The descent** scrolls from the top down to the platform line (`platformScrollTop`):
   a power-2 **ease-in** over the first 140 px (so it leaves the shift's rest with no lurch),
   a cruise at ≥ 1.5 px/ms (faster for a very tall tower, keeping the move near 2.2 s), and a
   gentle power-2 **settle** over the last 300 px: it "slows down a little at the end"
   (`descentTimeline`; the pieces meet at the same speed). The target is read every frame, so
   a refit mid-descent is absorbed. Each frame is marked as the page's own scroll
   (`placedScrollTop`), so `climb` ignores it.
3. **Landed**: td is fully in charge. The held events play (§ What waits). On first open
   that usually means main's opening grow, cards dropping from the sky onto the tower.

A short tower that fits the screen has nothing to scroll: the descent is instant, and the
shift lands straight on the platform. Under `prefers-reduced-motion` Enter goes straight to
`done`.

While the move runs, a refit of td's scene (its counts arriving) keeps the scroller at the
top through the shift (`homeAtTop`) and leaves it to the descent after that
(`DeckTowerPage`'s refit layout effect checks `homePhaseRef`).

## Back to home

From td, **a fresh pull up past the top of the deck** goes back up to the home
(`useHomePull` → `useHomeEntrance` `returnHome`). Owner rule (2026-11-09): **momentum stops at
the top of the deck, and another swipe triggers it.** A fling up the tower that coasts into the
top stops there (the scroll's own edge, with iOS's rubber band) however fast it was. So a pull
counts only when the gesture **started** with the scroller already at the top
(`scrollTop` ≤ `TOP_EPS_PX`, 2 px):

| Input | Armed by | Commits |
|---|---|---|
| Touch | a one-finger touch that starts at the top | on **release**, if the finger travelled down `PULL_PX` (80 px), or `FLICK_MIN_PX` (28 px) at `FLICK_SPEED` (0.6 px/ms), and the scroller is still at the top. A shorter pull springs back on the native rubber band. A second finger disarms it |
| Wheel / trackpad | a wheel **stream** (events with no `WHEEL_GAP_MS` = 240 ms gap) that starts at the top | at once, after `WHEEL_PULL_PX` (120 px) of upward travel. Any downward delta disarms the stream. A trackpad's momentum tail belongs to the stream that started lower down, so it stops at the top; the next stream does it |

Not while anything else moves the camera (`enabled: !panBlocked`: a pan, a deck swap, a
resize, a study, or the home move itself). Deep in the cards page the scroller is never at the
top, so nothing there can trigger it.

**The return shift** is Enter's shift mirrored (`shiftFrameAt(ms, "return")`), and the camera
goes UP:
- `out`: the tower slides down off the bottom as the streaks fall (`direction={1}`). The header
  fades out and the footer slides away as it starts.
- `cruise`: `onCruise("return")` measures the sky and parks the scroller back on the platform
  line, the home phase's own state (the tower hidden there, `visibility: hidden`). The sky
  blends from the tower top's altitude down to the home's.
- `in`: the home stage comes down in from above.

Then the phase is `home` again, exactly as at launch. Enter works the same way the second
time. Under reduced motion the return cuts straight to the home.

Tests: `src/__tests__/homeEntranceTimeline.test.ts` (descent endpoints, continuity, the
settle, the duration cap, both shifts' frames).
