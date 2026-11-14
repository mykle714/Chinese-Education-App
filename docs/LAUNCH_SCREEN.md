# Launch Screen

> ↑ Part of [DECK_TOWER.md](./DECK_TOWER.md) (a sub-document: the scene and its timing are
> drawn with the Deck Tower's iso kit). Since 2026-11-14 it is the **app shell's boot cover**,
> not a stage of td: [LOGIN_REWORK.md](./LOGIN_REWORK.md) § 1.

The full-screen cover the app opens behind on **every cold start**, before auth has
resolved: a **solid sky colour** with a **placeholder animation** a fifth of the way up from
the bottom. A pawn drops from the top of the screen onto a mini platform, and the platform
recoils from the landing. Once the page underneath is ready, a **circle** opens out of the
pawn and reveals it: td when signed in, `/login` when not, or the page a deep link opened. On
td, the sky then **fades** from the cover's colour to the real one: the true twilight blend
and the weather.

Why: td's look depends on things that arrive late, the weather (`GET /api/weather` sets
main's sky hue) and the deck counts (the tower's height). Without a cover the sky visibly
jumped colour a moment after opening.

## Status

Built 2026-11-11 as a stage of td; moved to the app shell 2026-11-14 (every cold start,
before auth). Client only: no route, no migration, no server change. It replaced the
**home screen**, archived on `archive/home-screen` ([ARCHIVED_FEATURES.md](./ARCHIVED_FEATURES.md)).
⚠️ The pawn drop is a **placeholder** for a real logo / animation (owner, 2026-11-11).

## Layers

| Layer | File → symbol | Role |
|---|---|---|
| Shared state | `src/hooks/useBootCover.ts` → `BootCoverContext`, `useBootCover`, `useHoldBootCover` | The gate: phase, holds, and when the cover may open (§ When it opens) |
| Shared view (app shell) | `src/components/bootCover/BootCover.tsx` → `BootCoverProvider`, `BootCoverSlot`, `BootRouteMounted` | Owns the phase; the slot Layout mounts in both shells; the per-route "page mounted" signal |
| Composition root | `src/App.tsx` → `renderBootCover`, `renderRoute` | Hands the cover to the provider (lazily); puts `BootRouteMounted` in every route's Suspense |
| Shared constant | `src/components/bootCover/bootCoverGround.ts` → `BOOT_COVER_GROUND` | The sky colour painted while the scene's chunk loads |
| Page view | `src/features/deckTower/launch/BootLaunchScreen.tsx` → `BootLaunchScreen` | LaunchScreen with the session's look, as its own lazily loaded chunk |
| Page logic | `src/features/deckTower/launch/launchLook.ts` → `launchLook`, `LaunchLook` | The cover's colours (§ Colour) |
| Page view | `src/features/deckTower/launch/LaunchScreen.tsx` → `LaunchScreen` | The cover, the drop + recoil, the timing contract, the circle (§ The animation, § Timing) |
| Shared view | `src/features/deckTower/SpaceBackdrop.tsx` → `snapSky`, `SKY_FADE_MS` | td's sky follows the truth at once under the closed cover, and fades after (§ The sky fade) |
| API | `src/api/weather.ts` → `fetchWeatherShared` | One weather request shared by the prefetch and td's first read (§ Weather prefetch) |
| Shared hook | `src/hooks/useWeatherPrefetch.ts` → `useWeatherPrefetch`; `src/App.tsx` → `AppPrefetch` | Starts the weather request as soon as the user is known |
| td | `src/features/deckTower/DeckTowerPage.tsx` → `launchReady`, `useHoldBootCover`, `launchUp`, `launchCovering` | Holds the cover until td is ready, holds td's events while it is up, snaps the sky while td is hidden |
| Hold | `src/minutePoints/dailyBanking/DailyBankingContext.tsx` → `DailyBankingProvider` `held` | The banking run waits for the cover to go (§ What waits) |

## When it shows

On **every cold start** (one JS session: a cold start or a reload), deep links included
(owner, 2026-11-13). `BootCoverProvider` starts in phase `covering`. Navigation within a
session never brings it back: once `done`, `useHoldBootCover` and `BootRouteMounted` are
no-ops. (Until 2026-11-14 it showed only when the launch landed on `/`, via `launchDue.ts`,
which was deleted.)

### When it opens

`BootCoverProvider` → `ready` requires all three (src/hooks/useBootCover.ts):

1. **Auth has settled** (`useAuth().isLoading` false): the silent refresh has either restored
   the session or failed.
2. **The current path's page has mounted.** `BootRouteMounted` sits beside every page inside
   its Suspense boundary (and inside `ProtectedRoute`), so it commits only once the lazy chunk
   has loaded and auth has let the page render. It records the pathname, and `ready` compares
   it to the current one, so a redirect under the cover (`/` → `/login`) waits for the
   destination's chunk instead of opening onto a blank frame.
3. **No page holds it.** td holds it while `!launchReady` (below). Holds are layout effects,
   so td's first hold lands in the same commit as its mount signal.

LaunchScreen keeps its own floor (one full drop) and ceiling (`MAX_WAIT_MS`), § Timing.

### Where it is drawn

`BootCoverSlot` is mounted by `Layout` in **both** shells: absolutely over `MobileDemoFrame`
(the phone card on desktop) at `BOOT_COVER_Z` (200, above the footer pill's 100), or fixed
over the window in the plain shell. `/login` and `/register` moved into the frame for this
(`src/routes/routeMeta.ts`): the main signed-out path, `/` → `/login`, then stays in one shell
and the cover is never remounted. A signed-out deep link into a plain-shell page does switch
shells under the cover, which remounts it and restarts the drop (accepted, it is rare). The slot
hides the footer pill (`useHideFooter`), which slides in once the cover has gone.

### Leaving the login screen

The login screen continues the launch scene (the same pawn and platform at rest:
`LaunchScreen.tsx` → `LaunchSceneStill`, reached through `useBootScene`). After a sign-in it
leaves by playing the boot circle **in reverse**: the destination mounts underneath at once,
and the whole login screen shrinks into a circle that closes onto the **centre of the
platform's floor** (owner, 2026-11-14). The boot circle opens out of the pawn's middle
instead, about half a head higher.

- `LaunchSceneStill` puts a zero-size marker at the floor's centre (the pawn's feet,
  `FEET_AT_SCREEN_Y`) and hands it out as `BootSceneRenderProps.platformCentreRef`.
- `src/pages/LoginPage.tsx` measures that marker and calls `src/hooks/usePageSlide.ts` →
  `runCircleExit`: the app's circle exit, `CIRCLE_MOTION` (520 ms) with the shrink easing.
- Only a sign-in made on the page gets the circle (`formShown`). A session that was already
  live when `/login` was reached redirects at once with `<Navigate>`.
- Reduced motion, or the scene's chunk not loaded yet (no marker): a plain redirect.
- ⚠️ td's footer pill (z 100) sits above the shrinking clone (z 50), so it shows over the
  closing circle as td mounts.

### Loading

The scene is drawn with the iso kit, which added ~75 kB to the main chunk when imported
statically. `App.tsx` loads `BootLaunchScreen` **lazily**. Until its chunk (~5 kB of its own)
lands, the slot paints a plain ground in `BOOT_COVER_GROUND` (`COLORS.bluMk`), the same colour
as the scene's sky, so the scene appears on an unchanged screen.
`src/features/deckTower/launch/__tests__/launchLook.test.ts` keeps the two equal.

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
2. Then it waits for **`ready`** (§ When it opens). On td that includes td's hold:
   `useTowerWeather` → `settled` (the first weather answer, or the setting off) **and** the
   shown world's `useFlpReadyCounts` → `loaded`.
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
5. `onDone` → phase `done`: the slot unmounts the cover, `useBootCover().up` turns false, and
   td's held events play.

## Inside the slot

`LaunchScreen` fills the slot (`position: absolute`, `LAUNCH_Z` inside it). It is **not**
portaled to `<body>`: on desktop the app is the phone-shaped `MobileDemoFrame`, and a fixed
cover would paint the whole browser window. It swallows touches (`touch-action: none`).

### What waits

While the cover is up (`useBootCover().up`, read by td as `launchUp`):

| Thing | Hold |
|---|---|
| The footer | `BootCoverSlot` → `useHideFooter` (and td's own `useHideFooter(study.active \|\| launchUp)`): away, and it slides in once the cover has gone |
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
- **`snapSky`** (`pan.busy`, the closed cover above, or the render carrying a weather tester pin tap — `DeckTowerPage` → `weatherPinTapped`): a world pan's per-frame blend, or a tapped pin's sky, is followed at once. It also
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
