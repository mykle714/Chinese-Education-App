# Launch Screen

> ↑ Part of [DECK_TOWER.md](./DECK_TOWER.md) (a sub-document: the launch screen is a stage of
> the Deck Tower page, not a route of its own).

The full-screen cover td opens behind once per app launch: a **solid sky colour** with a
**placeholder animation** a fifth of the way up from the bottom. A pawn drops from the top of the screen onto a
mini platform, and the platform recoils from the landing. Once td is ready, a **circle**
opens out of the pawn and reveals td underneath. Then td's sky **fades** from the cover's
colour to the real one: the true twilight blend and the weather.

Why: td's look depends on things that arrive late, the weather (`GET /api/weather` sets
main's sky hue) and the deck counts (the tower's height). Without a cover the sky visibly
jumped colour a moment after opening.

## Status

Built 2026-11-11. Client only: no route, no migration, no server change. It replaced the
**home screen**, archived on `archive/home-screen` ([ARCHIVED_FEATURES.md](./ARCHIVED_FEATURES.md)).
⚠️ The pawn drop is a **placeholder** for a real logo / animation (owner, 2026-11-11).

## Layers

| Layer | File → symbol | Role |
|---|---|---|
| Page logic | `src/features/deckTower/launch/launchDue.ts` → `launchDueOnMount`, `markLaunchTaken` | Whether this td mount opens behind the cover (§ When it shows) |
| Page logic | `src/features/deckTower/launch/launchLook.ts` → `launchLook`, `LaunchLook` | The cover's colours (§ Colour) |
| Page view | `src/features/deckTower/launch/LaunchScreen.tsx` → `LaunchScreen` | The cover, the drop + recoil, the timing contract, the circle (§ The animation, § Timing) |
| Shared view | `src/features/deckTower/SpaceBackdrop.tsx` → `snapSky`, `SKY_FADE_MS` | td's sky follows the truth at once under the closed cover, and fades after (§ The sky fade) |
| API | `src/api/weather.ts` → `fetchWeatherShared` | One weather request shared by the prefetch and td's first read (§ Weather prefetch) |
| Shared hook | `src/hooks/useWeatherPrefetch.ts` → `useWeatherPrefetch`; `src/App.tsx` → `AppPrefetch` | Starts the weather request as soon as the user is known |
| Host | `src/features/deckTower/DeckTowerPage.tsx` → `launchOnMount`, `launchUp`, `launchCovering`, `launchCover`, `launchReady`, `openLaunch`, `endLaunch` | Mounts the cover, hides the footer, holds td's events, snaps the sky while td is hidden |
| Hold | `src/minutePoints/dailyBanking/DailyBankingContext.tsx` → `DailyBankingProvider` `held` | The banking run waits for the cover to go (§ What waits) |

## When it shows

Once per launch (one JS session: a cold start or a reload), and only when the launch itself
landed on `/`. A launch that deep-links elsewhere never shows it, not even when the learner
later taps the Flashcards tab: that is navigation, not an app open. "Landed on `/`" reads
the document's own load URL (the `performance` navigation entry), which no SPA route change
rewrites. `launchDueOnMount` is a pure read used as a `useState` initializer (StrictMode may
call it twice). The page marks it spent with `markLaunchTaken` from an effect.

⚠️ Every route is code-split, so before td's chunk has loaded the screen is the frame's
blank ground (Suspense `fallback={null}`, `src/App.tsx` → `renderRoute`). The cover cannot
show earlier than td's own module.

## Colour

`launchLook()`: the main world in **clear** weather (the weather is not known yet), **always
by day**, whatever the clock says (owner, 2026-11-11). It is the cover's look only: the circle
opens onto td's true time of day, in the real weather if it has arrived and clear weather if
not (§ The sky fade).

- Sky: `COLORS.bluMk`, main's sky (in the colour framework).
- The platform and the pawn take day's wash (`litWorld` / `towerLight`), like td's.

## The animation (placeholder)

A fixed dimetric scene (`makeProjector(UNIT)`, `UNIT = 30`), centred across the screen with
the pawn's feet `FEET_AT_SCREEN_Y` (0.8) of the way down, i.e. 1/5 from the bottom.

**Baked, and played by the browser** (`LaunchScreen.tsx` header § "A baked animation"). The
scene is drawn once, as stills, and every motion is a precomputed Web Animations keyframe list
on the `transform` of an HTML layer. No JS runs per frame, and transform animations on HTML
layers run on the browser's compositor thread, so the drop stays smooth while td renders
underneath (the weather landing, the tower rebuilding at its real height). The first version
drove an `IsoPawn` entrance from a per-frame JS loop and stalled mid-fall (owner,
2026-11-11). Transforms inside an SVG are not composited, so each moving piece is its own
`<svg>` (`IsoScene`, sharing `SCENE_BOX`'s viewBox), moved from outside:

| Layer (class) | Holds | Animation |
|---|---|---|
| `launch-screen__platform-layer` | `IsoPlatform`: a 3 × 3 rounded slab, 0.9 thick, ≈ 180 px across, no bob, no ground shadow | The recoil |
| `launch-screen__pawn-ride` | the three below | The recoil (the pawn rides the platform's dip) |
| `launch-screen__pawn-fall` | ↓ | The fall |
| `launch-screen__pawn-shape` | `LaunchPawnFigure`: the resting `pawnFigure` (body + head in ink, like `IsoPawn` by day) | Stretch, then the landing squash, scaled about the feet |

- **One clock.** Every animation's `startTime` is pinned (`playAt`) to a `performance.now()`
  time on the document timeline: the fall and the shape at the drop's `startAt`, both
  recoils at the touchdown (`startAt + landMs`). The dip lands on the frame of impact
  whatever the main thread is doing.
- **The fall** (`planDrop`): from the head `FALL_START_MARGIN_PX` above the cover's top edge
  down to the feet's resting place, in the cover's measured box. Exact gravity:
  `landMs = √(2d/g)` with `GRAVITY_UNITS` (60 world units/s², the td sky fall's
  `SKY_FALL_GRAVITY`), and the easing `GRAVITY_EASE`, `cubic-bezier(1/3, 0, 2/3, 1/3)`,
  which is exactly y = x² (from rest, accelerating all the way). `fill: both` holds the pawn
  above the edge (clipped by the cover's `overflow: hidden`) until it starts.
- **Scheduled once the cover has painted**, two frames after mount, then `FALL_DELAY_MS`
  (250 ms) of plain colour. A clock started at render was already deep into the fall by the
  first painted frame on a cold start.
- **The shape:** `STRETCH` (0.92 × 1.1) all the way down, `SQUASH` (1.22 × 0.72)
  `SQUASH_IN_MS` (60 ms) after touchdown, back to rest by `SQUASH_MS` (320 ms). A CSS scale,
  so the head flattens with the body (`IsoPawn`'s pose keeps the head round).
- **The recoil** (`RECOIL_KEYFRAMES`, `RECOIL_MS` 560 ms): bottoms out at `RECOIL_DIP_PX`
  (10 px) about 90 ms after touchdown, inside the squash, then springs back past rest and
  settles.
- Under `prefers-reduced-motion`: no animations; the pawn stands from the start.

## Timing

1. It always plays **one full drop and recoil**, plus `SETTLE_MS` (180 ms), so it never
   flickers in and out.
2. Then it waits for **`ready`** = `useTowerWeather` → `settled` (the first weather answer,
   or the setting off) **and** the shown world's `useFlpReadyCounts` → `loaded`.
3. It waits at most **`MAX_WAIT_MS`** (4 s from mount), then opens anyway, but never before
   step 1 has finished.
4. **The circle:** a hole cut in the cover with a radial-gradient `mask-image`, centred on
   the pawn's middle and grown to `circleCoverRadius` over `CIRCLE_MOTION.ms` (520 ms, the
   app's circle transition — `src/utils/pageTransition.ts`). The radius is written straight
   to the DOM each frame. The centre and the cover radius are measured in the cover's OWN
   box (its `getBoundingClientRect`), not the window's: the mask lays out in the element's
   coordinates, and on desktop the cover sits offset inside the phone frame. td underneath
   is never clipped or touched. Reduced motion: a
   240 ms fade instead.
5. `onDone` → `launchUp` false: the cover unmounts and td's held events play.

## It is a stage of td, not a route

`LaunchScreen` is rendered inside td's screen, `position: absolute` over `MobileTabScreen`'s
ScreenRoot (the page's stage is deliberately unpositioned), at `LAUNCH_Z` (10), above td's
scroller (1) and header layer (2). It is **not** portaled to `<body>`: on desktop the app is
the phone-shaped `MobileDemoFrame`, and a fixed cover would paint the whole browser window.
It swallows touches (`touch-action: none`).

### What waits

While `launchUp`:

| Thing | Hold |
|---|---|
| The footer | `useHideFooter(study.active \|\| launchUp)`: away, and it slides in once the cover has gone |
| The scroller | `overflow: hidden`, `touch-action: none`, `pointer-events: none` |
| The world swipe, cards-page snap, platform stop | `panBlocked`; `useTowerCardsScroll` `enabled` / `snapEnabled` |
| The opening grow (DECK_TOWER.md § Opening at the last height) | The `resolveRecount` effect returns early and re-runs when `launchUp` clears |
| Cooldown releases | `releaseCooldowns` skips the shown tower |
| The daily banking run | `DailyBankingProvider held={launchUp}`: it is stamped seen as it starts, so starting it unseen would lose it for the day |

## The sky fade

`SpaceBackdrop` (also documented in DECK_TOWER.md § Weather):

- **Under the closed cover**: the page passes `snapSky` from mount until the exit starts
  (`DeckTowerPage` → `launchCovering`, cleared by `LaunchScreen` `onOpen`). td is hidden, so
  every sky change is taken at once, and the circle opens onto the true time of day plus the
  weather if it has arrived (owner, 2026-11-11). If the weather was not in yet (the cover
  timed out at `MAX_WAIT_MS`), td shows clear weather, and the weather fades in over 10 s
  when it lands. Clearing `snapSky` does not start a fade by itself.
- **Any change of `palette.sky`** that is not a pan (the weather arriving or
  changing, the clock's samples moving through a twilight) fades from the colour on screen
  (`skyShown`) to the new one over **`SKY_FADE_MS` (10 s)**, smoothstepped in sRGB
  (`mixHex`, like the twilight blend). Owner, 2026-11-11: "fade over much longer".
- **`snapSky`** (`pan.busy`, or the closed cover above): a world pan's per-frame blend is followed at once. It also
  cancels a fade in progress, so a pan started mid-fade jumps to the pan's blend.
- A fade repaints on a slow frame (`SKY_FADE_FRAME_MS`, 50 ms), since `apply` measures layout.
- ⚠️ **Only the backdrop and the footer's cast shadow fade.** Everything else that reads
  the sky takes the new colour at once: the iso scene's ground plane (`litWorld` → `ground`,
  which tones the platform's shadow on the sky), `MobileTabScreen` `surfaceColor`, the
  cards page's `sky`, and the theme-colour meta tag. Fading those too would re-render the
  whole scene every step.

## Weather prefetch

`useWeatherPrefetch` (mounted app-wide by `App.tsx` → `AppPrefetch`, inside `AuthProvider`)
starts `GET /api/weather` as soon as `user?.id` is known and the per-device Weather effects
setting is on. On a cold start that overlaps the request with td's chunk download.
`useTowerWeather`'s first read calls `fetchWeatherShared(userId)`, which returns the same
request when one for that user started under `SHARE_MS` (60 s) ago. A failed request leaves
the share at once, so the next caller retries. Later refreshes (every 30 min) call
`fetchWeather` directly.
