# Fall physics and the gravity lab

Every fall in the Deck Tower's iso world belongs to one **fall type**, and each type has its
own **gravity**, **start speed** and **jerk** (`FallParams` in `src/theme/gravity.ts`).
`/gravity-lab` is the dev page for tuning them on the real components. The plan is to
hardcode the values you pick there in `FALL_DEFAULTS`.

Status: built on 2026-11-20. Every type is still at its starting values (gravity 110, the
pawn's old `PAWN_GRAVITY`; start speed 0; jerk 0) until tuned.

## 1. Fall types and parameters

| Fall type | What falls | Read by |
|---|---|---|
| `trapDoor` | The tower falling through the open trap door on a deck swap | `deckTransitions.ts` → `TRAP_DOOR.plan` |
| `skyFall` | The pawn's sky-fall entrance and the flp hint pawn's drop. **Its gravity is also the pawn's own physics**: plate launch, poke jump, summit jolt, bounces, and its fall when the trap door opens under it | `iso/pawnEntrances.ts` → `fallFromHeight`; `iso/usePawnMotion.ts` via `pawnGravity()` |
| `skyDrop` | A sky drop's falling tower (new cards landing, a swap's new tower) | `towerResizes.ts` → `SKY_DROP` |
| `collapse` | A ghost collapse's settling runs | `iso/cardCollapse.ts` → `planCardCollapse` |
| `launchScreen` | The launch screen's pawn drop | `launch/LaunchScreen.tsx` → `planDrop` |

| Parameter | Unit | Meaning | Lab range |
|---|---|---|---|
| `g`, gravity | world units / s² | The pull | 1–300 |
| `v0`, start speed | world units / s, downward | How fast the fall is already moving at its first frame (0 = from rest) | 0–60 |
| `j`, jerk | world units / s³ | How fast the acceleration grows: the fall accelerates at `g + j·t`, starting gentler and whipping into the landing (0 = constant) | 0–1000 |

**Rules:**
- **Positive jerk only** (owner, 2026-11-20). With j ≥ 0 every fall still lands, and its
  curve stays an exact cubic that a CSS cubic-bezier can represent. A negative jerk would need
  the acceleration floored at 0, and the CSS falls would only approximate it.
- **The pawn's throws use only the sky fall's gravity.** Plate launch and poke jump are set
  by their apex heights, so start speed and jerk never apply to them. The pawn's own free fall
  when the trap door opens blends into the door's fall within `FALL_BLEND_MS`, so it follows
  the trap door's physics through the floor.

**History (2026-11-20).**
1. The falls had separate gravity constants: pawn 110, sky fall 60, launch screen 60 (a
   copy), trap door 140 (raised for tall towers), collapse 140, sky drop 130, splat 170.
2. They were folded into one world gravity. The splat was deleted, since its cards outlived
   their window at lower gravity, and the trap door was uncapped.
3. A shared start speed and jerk were added.
4. All three were split per fall type at the owner's request. Every type started at 110 / 0 / 0,
   so the split changed nothing until tuned.

**Out of scope:** `src/components/ConfettiBurst.tsx` keeps its own `GRAVITY` (1100). It
falls in screen px over the DOM, not in the iso world.

**Code:** `src/theme/gravity.ts` → `FallType`, `FALL_TYPES`, `FallParams`, `FALL_DEFAULTS`,
`FALL_PARAM_RANGE`, `fallParams`, `pawnGravity`.

## 2. The fall math

All of it lives in `src/theme/gravity.ts`. Each function takes an explicit `FallParams`; a
planner reads `fallParams(type)` once and passes the same object to every call, so a plan's
time and its CSS curve always agree.

- **`fallDistanceAt(seconds, p)`**: `d(s) = v0·s + ½·g·s² + ⅙·j·s³`.
- **`fallMs(distance, p)`**: the root of `d(T) = distance`. With no jerk that is
  `(√(v0² + 2·g·d) − v0) / g` exactly. With jerk, Newton's method starts from that value
  (an upper bound) and converges monotonically, because `d` is increasing and convex.
- **`fallEasing(distance, p)`**: normalized, the fall is the cubic `y = a·x + b·x² + c·x³`
  with `a = v0·T/D`, `b = ½·g·T²/D` and `c = ⅙·j·T³/D`. A cubic-bezier whose x controls sit
  at 1/3 and 2/3 represents any such cubic exactly: `cubic-bezier(1/3, a/3, 2/3, (b + 2a)/3)`.
  At v0 = j = 0 that is y = x², a fall from rest. Before 2026-11-20 that curve was
  hardcoded in three files.

Each consumer reads its parameters when it uses them (once per plan, or every frame for the
pawn), never caching them in a module constant, so a lab change applies on the next fall
without a reload. A collapse run (`CollapseRun.fallEase`), a sky drop (`TowerDrop.fallEase`)
and the launch drop (`LaunchDrop.easing`) each carry their own CSS curve. `PAWN_ENTRANCES`
holds builders, not values, so `pickPawnEntrance` builds a fresh entrance with the current
sky-fall physics.

Tested by `src/__tests__/gravityFall.test.ts`: time and distance agree, and the curve tracks
the real fall at every point, jerk included.

A new falling thing in the iso world should belong to a fall type (a new one if it needs its
own feel: add it to `FALL_TYPES` and `FALL_DEFAULTS`, and give it a card in the lab) and time
itself with `fallMs`, using `fallEasing` if it plays as CSS.

## 3. The overrides

`setGravityOverride(type, param, v)` sets a temporary value for one parameter of one fall
type; setting the shipped value clears it. `clearGravityOverrides()` clears them all.
Overrides live in memory and in **sessionStorage** (`gravityLab.<type>.<param>`, e.g.
`gravityLab.trapDoor.g`): they survive a reload of the tab and die with the tab, so they can
never leak into a real session. They apply **app-wide for that tab**, so `/` falls with the
lab's values too. The lab shows a banner while any override is set. Only `/gravity-lab` sets
them.

`useFallParams(type)` and `useGravityVersion()` are the React bindings for showing the values.

**Code:** `src/theme/gravity.ts` → `setGravityOverride`, `clearGravityOverrides`,
`hasGravityOverride`, `useFallParams`, `useGravityVersion`.

## 4. The lab (`/gravity-lab`)

A dev page reachable only by typing the URL (`ROUTE_META` note; `docs/ACTIVE_DUTY_PAGES.md`).
It uses the plain shell and owns its own scroll container, like `/font-lab`.

**Layout.** The iPhone 16 stage sits on the left and stays in view (sticky). The fall-type
cards sit on the right, so you can tune a fall and replay it without scrolling. On a narrow
window they stack. The header has *Reset all* and *Copy FALL_DEFAULTS*, which puts the whole
`FALL_DEFAULTS` literal on the clipboard to paste into `src/theme/gravity.ts`.

**One card per fall type** (`GravityLabPage.tsx` → `FallTypeCard`, `KnobRow`, `PARAM_SPECS`,
`TYPE_SPECS`). Each card has:
- three rows (gravity, start speed, jerk), each with a slider, ± nudge buttons, the value
  (bold when it differs from the shipped value) and *Reset*. Gravity's slider moves in 1s and
  its buttons in 5s; start speed in 1s; jerk's slider in 5s and its buttons in 25s;
- a replay button:
  - Trap door and Pawn sky fall: *Swap deck*. A swap plays both.
  - Sky drop: *Sky drop +8*.
  - Collapse: *Collapse −70*. It always leaves at least one card, so something is left to fall.
  - Launch screen: *Play*. It mounts the real `LaunchScreen` over the page.
- its timing rows. The pawn sky fall card also carries the plate-launch and poke rows, since
  they run on its gravity.

**The stage** (`src/pages/gravityLab/GravityLabStage.tsx`). The real `DeckTowerPlatform`,
`useDeckSwap` and `useTowerResize`, in the core world's day colours. Press the plate to swap
decks (plate launch, trap door, sky fall, then the new tower's sky drop); tap the pawn to poke
it. Tower sizes are 30, 80 or 150 cards. The frame clips, so a falling tower leaves at the
bottom edge, the way td's leaves the screen.

**What the stage copies from `DeckTowerPage`.** Re-check these if td's wiring changes:
- the tower count under a swap or resize (`towerCountFor`, `swapDropPending`);
- the swap's new tower arriving as a 0 → count `SKY_DROP` at the ready beat (`startSwapDrop`);
- a **fixed iPhone 16 frame** (393 × 852 CSS px, `GravityLabStage.tsx` → `STAGE_PX`, `FRAME`) in
  place of `fitScene`. It uses td's horizontal framing and scale, and td's scene bottom edge
  (the slab or its ground shadow, plus `BOTTOM_MARGIN`). That edge sits on top of the
  footer's 104 px footprint (`FOOTER`), with a stand-in slab drawn where td's footer floats
  (16 px side insets, 34 px up, a 64 px face on a 6 px lip). The frame never refits with the
  tower; a taller tower runs off the top. Not mirrored: td's header and top safe area, the
  scroll, weather bands and camera.

**Timings and checks** (`src/pages/gravityLab/gravityTimings.ts` → `gravityTimings`). Every
number comes from the production code (`fallFromSky`, `TRAP_DOOR.plan`, `fallMs`,
`plateLaunchApexMs`, `plateSettleMs`, `launch/launchDrop.ts` → `launchFall`), so the table
cannot drift from the app. Each row is tagged with its fall type (`pawn` for the throws).
Trap-door rows use an approximate fall distance per tower size (`trapDistanceFor`); the
launch-screen row uses the cover's real geometry for an iPhone 16-tall screen. The two timing
rules checked live are:
1. **The sky fall lands before the trap door's shortest ready beat** (1420 ms). Otherwise
   the new pawn pops in mid-fall. With no start speed or jerk this breaks below ~45 skyFall
   gravity (from the 45-unit spawn).
2. **The plate launch peaks inside the plate's 300 ms settle** (`PLATE_POP_SETTLE_MS`). Past
   it, every deck swap waits for the pawn's apex. Breaks below ~59 skyFall gravity.

**Code:** `src/pages/gravityLab/GravityLabPage.tsx`, `GravityLabStage.tsx`, `gravityTimings.ts`;
`src/routes/registry.ts`, `src/routes/routeMeta.ts` → `/gravity-lab`.

## 5. Hardcoding the winners

1. Tune on `/gravity-lab`, then *Copy FALL_DEFAULTS*.
2. Replace `FALL_DEFAULTS` in `src/theme/gravity.ts` with it.
3. Update the "at 110" sample numbers in `docs/DECK_TOWER_TRANSITIONS.md` (§ Trap door,
   § Fall from the sky, § The plate button) and `docs/ISO_ART_FRAMEWORK.md` (§ IsoPawn → Feet
   physics, § IsoCardRuns). With a non-zero start speed or jerk, the "y = x²" / "from rest"
   wording there and in `docs/LAUNCH_SCREEN.md` needs updating too.
4. *Reset all* in the lab (or close the tab) so the overrides are gone.

## 6. Where the sky fall spawns

The pawn's sky fall (`pawnEntrances.ts` → `SKY_FALL_HEIGHT`) starts a **fixed 45 world units
above its landing spot**. It is not measured from the screen edge, so how far off screen it
starts depends on the phone. The worst case is the pawn landing at the front of the
platform, which is drawn lowest. The table measures the margin from the top edge of the
screen to the pawn's feet (the first part to appear) in td's layout: the scene fills the
screen's width and sits on the footer slab.

The table was computed on 2026-11-20 for the old 55-unit height. 45 units takes 10 units off
each row (about 17 px per unit on these screens):

| Phone | Front landing at 55 | Front landing at 45 | Centre landing at 45 |
|---|---|---|---|
| Pixel 9 (tightest) | 12.4 u · ~215 px | **~2.4 u · ~40 px** | ~8.8 u |
| Pixel 9 Pro XL / 8a | 12.9 u | ~2.9 u | ~9.2 u |
| iPhone 16 Pro Max | 14.1 u | ~4.1 u | ~10.5 u |
| iPhone 14 / 15 / 16 | 14.9 u | ~4.9 u | ~11.2 u |
| Galaxy S24 | 15.0 u | ~5.0 u | ~11.3 u |
| iPhone SE (3rd gen) | 24.0 u | ~14.0 u | ~20.3 u |

The taller and narrower the screen, the smaller the margin. A screen taller in aspect than a
Pixel 9 would show the spawn mid-air. td's header and top safe area were ignored; both only
add margin.

**The lab's stage matches td on an iPhone 16** (§ 4, the footer footprint and td's scene
bottom), so the spawn margins it shows are the iPhone 14 / 15 / 16 row above. It does not
show td's header, which only adds margin.

**Code:** `src/features/deckTower/iso/pawnEntrances.ts` → `SKY_FALL_HEIGHT`, `fallFromSky`.

