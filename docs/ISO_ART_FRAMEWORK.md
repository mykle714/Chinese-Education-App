# Iso Art Framework

A small SVG kit for drawing scenes in the art style of Nintendo/Paladin's *Good Job!*:
chunky, softly bevelled isometric boxes with flat three-tone shading, no outlines and hard
shadows. Code: `src/features/deckTower/iso/`. Import from its barrel,
`src/features/deckTower/iso/index.ts`, not from the individual files.

Parent: [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md) (sub-documents table). Its only
user so far is [DECK_TOWER.md](./DECK_TOWER.md), which uses `IsoScene`, `IsoPlatform`
(`floating`), `IsoCardStack`, `IsoCardImprint`, `IsoFloorLabel`, `IsoPawn`, `IsoBird`, `IsoCloud` and `IsoWind`. **`IsoCarpet` currently has no user** (the
Deck Tower dropped its carpet on 2026-10-17); it is kept as part of the kit.

**Location.** The kit sits under `features/deckTower/` because the Deck Tower is its only
importer. Per [FRONTEND_LAYERING.md](./FRONTEND_LAYERING.md) § 1 it moves to
`src/components/iso/` as soon as a second feature imports it.

**Outline-rule exemption.** The style tells edges apart only by flat value steps between
faces, so it deliberately ignores the app's outline rule (CLAUDE.md § Buttons & cards).
The exemption covers iso scenes only; it is not a precedent for UI chrome.

## Rules of the style

1. **Everything is an extruded rounded rect** in the world XY plane, pushed up along z.
   The exceptions are the ink figures: the pawn's body (a screen-space pill, which reads
   the same from every angle) and the bird (a screen-space silhouette). A cloud is a
   cluster of rounded rects (pills), so it follows the rule. Wind (`IsoWind`) is not a
   solid at all: it is flat round-capped strokes, the kit's one stroke-only object.
2. **Three flat tones per material:** a lit TOP, a mid LEFT wall and a dark RIGHT wall.
   No gradients except the short blend across a rounded front corner.
3. **One light.** It comes from the upper left, and every shadow falls screen down-right.
4. **Every shadow is made by `IsoShadow`.** No component draws a shadow any other way.
5. **Objects draw themselves.** A page only places objects and tells each one which
   surface it stands on.

## Layers

| Layer | File | Role |
|---|---|---|
| Scene | `IsoScene.tsx` → `IsoScene`, `sceneContext.ts` → `useIsoProjector` | The `<svg>` root and the context that hands the projector to every component inside it |
| Primitive | `IsoSolid.tsx` → `IsoSolid` | Paints one prism in three-tone shading. Takes ready-made geometry, so it needs no context |
| Primitive | `IsoShadow.tsx` → `IsoShadow` | The only shadow drawer |
| Behaviour | `IsoLevitate.tsx` → `IsoLevitate` | Bobs an object up and down; its shadow breathes in sync |
| Behaviour | `usePawnMotion.ts` → `usePawnMotion`, `depthRankAmong`, `PawnEntranceCue` | The pawn's entrance, wander and startle, and depth-sorting a moving object among obstacles |
| Behaviour | `pawnEntrances.ts` → `PawnEntrance`, `FALL_FROM_SKY`, `PAWN_ENTRANCES`, `pickPawnEntrance`, `entranceStartFor` | How a pawn arrives, as pure pose timelines timed by their landing ([DECK_TOWER_TRANSITIONS.md](./DECK_TOWER_TRANSITIONS.md) § Pawn entrances) |
| Behaviour | `skyTraffic.ts` → `planSidePath`, `useSkyTraffic`, `createAltitudeWander`, `useAltitudeWander`, `SkyRegion`, `SkySide`, `prefersReducedMotion` | What birds, clouds and wind share: the path along a tower's side, the wait → cross → wait slot scheduler, and the wandering spawn altitude (§ Sky traffic) |
| Behaviour | `useBirdFlights.ts` → `useBirdFlights`, `BirdFlight`, `BirdSky` | Schedules the birds crossing the sky: speed, timing, wingbeat |
| Behaviour | `useCloudDrifts.ts` → `useCloudDrifts`, `CloudDrift`, `CloudSky`, `sortCloudsBackToFront` | Schedules the clouds drifting past the tower: shapes, speed, timing, mid-sky openers |
| Behaviour | `useWindGusts.ts` → `useWindGusts`, `WindGust`, `WindStrand`, `WindPt`, `WindSky` | Schedules the wind gusts: strand shapes, curl, timing, on-screen placement |
| Object | `IsoPlatform.tsx`, `IsoCarpet.tsx`, `IsoCard.tsx`, `IsoCardStack.tsx`, `IsoCardImprint.tsx`, `IsoCardRuns.tsx`, `IsoFloorLabel.tsx`, `IsoHatch.tsx`, `IsoLever.tsx`, `IsoModeSwitch.tsx`, `IsoSmokePuff.tsx`, `IsoPawn.tsx`, `IsoBird.tsx`, `IsoCloud.tsx`, `IsoWind.tsx` | The things a scene is made of (one component each, below) |
| Behaviour | `cardCollapse.ts` → `planCardCollapse`, `cardsShowingAt`, `fallMsFor`, `shadowLandTiming`, `CardCollapsePlan` | The pure plan for a stack losing cards and settling (§ IsoCardRuns) |
| Rules | `light.ts` → `IsoSurface`, `shadowFootprint`, `shadowTone` | The light and the shadow rule |
| Rules | `palette.ts` → `ISO`, `shadeHex`, `mixHex`, `Material` | Colours (`mixHex` blends two colours continuously, e.g. the Deck Tower sky → space) |
| Rules | `levitation.ts` → `BOB_HEIGHT`, `BOB_PERIOD_MS` | The bob |
| Math | `geometry.ts` | Projection and shape math (below) |
| Math | `cardStackMetrics.ts` → `cardStackMetrics` | Card thickness and seam spacing for a stack of N |

## Geometry

`geometry.ts` uses a 2:1 dimetric projection, the same flavour as the Night Market grid.
World +x runs down-right, +y down-left and +z up. Screen coordinates are
`sx = (x − y)·unit` and `sy = (x + y)·unit/2 − z·unit`.

- **`prism`.** For a convex shape extruded straight up, the screen silhouette is the convex
  hull of the top and bottom outlines.
- **`flatPath`.** A rounded rect lying flat at height z. Used for floors, decals and
  shadows.
- **`faceTransform`.** Maps flat world-unit drawing onto a top face, so printed text lies
  on it. `faceAffine` is the same map as an `Affine`, for composing.
- **`frontContour`.** The visible front half of an outline. It is used for the card
  stack's seams.
- **`insetRect` and `translateRect`.** Helpers that shrink, grow or slide a rect.
- **`insideRoundedRect`.** Point-in-rounded-rect, corner arcs included. With `insetRect(rect, R)` it
  tests whether a circle of radius R fits in `rect`.
- **Affine maps** (`Affine`, `affineFrom3`, `invertAffine`, `composeAffine`, `affineToSvg`).
  A flat thing that tilts out of the XY plane is still flat, and the projection is affine,
  so a tilted plane is redrawn with one SVG `matrix(…)` instead of re-projecting its paths.
- **Hinges** (`Hinge`, `hingePoint`, `hingedOutline`, `hingedPrism`, `hingedPlaneTransform`,
  `hingedPlaneAffine`). A door swinging about a world-y edge. A positive angle sends the +x
  side down. `hingedPrism` is `prism` for the swung solid. `hingedPlaneTransform` carries
  anything already drawn flat at height z onto the swung plane. It is exact for flat things
  only. `hingedPlaneAffine` is the same map as an `Affine`, so it can be composed or
  inverted. Used by `IsoPlatform`'s `hingeAngle` and IsoFloorLabel's raised plate.

## The scene

`IsoScene` takes a `proj` (from `makeProjector(unit)`), a `viewBox` and an optional
`preserveAspectRatio` (default centred; `"xMidYMax meet"` pins the scene to the bottom). Every object
inside reads the projector from context (`useIsoProjector`, which throws outside a scene),
so objects take world positions only and never a `proj` prop. The page fits the viewBox to
its settled content, so the scene scales to any box.

## Surfaces

An `IsoSurface` is `{ z, color }`: a horizontal plane something can stand on and a shadow
can fall on. Every object that stands on something gets a `surface` prop; the platform's
shadow goes on `ground`. The colour belongs to the surface because a shadow's tone comes
from what it falls on.

## Light and shadows

`light.ts` holds one rule, and `IsoShadow` applies it:

> A shadow is the caster's **footprint** (its underside outline), slid along the light by
> `LIGHT_SLOPE · (casterZ − receiver.z + CONTACT_LIFT)`, laid flat on the receiver, and
> painted in the receiver's colour darkened by `SHADOW_DEPTH`.

- **Direction.** `LIGHT_DIR` points screen down-right, away from the upper-left light that
  the face shading assumes.
- **Distance grows with height.** An object resting flush on a surface still shows a short
  contact sliver (`CONTACT_LIFT`). A floating one throws its shadow further.
- **Tone comes from the receiver.** Shadows on the sky, the floor and a carpet read as the
  same strength of shade. There are no per-receiver shadow colours in the palette.
- **Flat things are part of their surface.** A carpet or floor label receives shadows but casts none.
  A shadow is an opaque fill in the *floor's* shade, so a decal it crosses (a floor label) must be
  shaded in its own tones: the caster draws the decal's `shaded` variant clipped to its shadow
  (`IsoPawn` → `decals`; `IsoFloorLabel` → `shaded`). A plain glaze cannot do this — the floor's
  shade is a saturation-boosted orange, which as a translucent overlay needs ~80% opacity and
  would repaint the decal.
- **Parts cast no shadow.** `IsoCard` used as a stack's top card is a part; the stack casts.
- **Birds and clouds cast no shadow.** They fly 40+ (birds) and 90+ (clouds) units up,
  where the rule would throw the shadow far off the platform into empty sky. `IsoBird` and
  `IsoCloud` are the only standing exceptions.
- **Draw order.** Each object draws its shadow first, then itself, so it covers the hidden
  part of its own shadow.
- **Tilted casters.** A caster that is not level (the platform swung open on its hinge)
  passes `IsoShadow` a `solid` (its world vertices) instead of a footprint. Each vertex
  slides by the same rule for its own height, and the shadow is the hull of where they
  land. With every vertex at one height this is the footprint case.

| Caster | Footprint | `casterZ` | Receiver |
|---|---|---|---|
| `IsoPlatform` | the slab rect | its underside (−thickness) | `ground` |
| `IsoCardStack` | the card rect | its `surface.z` | its `surface` |
| `IsoPawn` | a circle of `FOOT_RADIUS` | its `surface.z` | its `surface` |

## Levitation

`IsoLevitate` takes a `shadow` node and `children`. The shadow stays where it is while the
children rise `BOB_HEIGHT` world units and sink back once per `BOB_PERIOD_MS`. The shadow
shrinks toward its centre and fades as they rise.

The two are separate CSS animations (`LEVITATE_CSS`) with the same duration, easing and
start, so they need no shared clock. Both stop under `prefers-reduced-motion`, leaving the
object at its lowest point, where its shadow was computed. A caller fitting a viewBox must
allow `BOB_HEIGHT` of headroom.

## Objects

### IsoPlatform

`{ rect, thickness, ground, floating?, hingeAngle?, decals?, children, tone?, bodyClassName?, bodyStyle? }`. A slab whose top,
the floor, is at z = 0 and which extends down to −thickness. `tone` (a `PlatformTone`,
from `platformTone(base)`) paints it in any hue; it defaults to the gold `ISO.platform` /
`ISO.platformRim`. The Deck Tower gives each world its own (towerWorlds.ts).

It draws, in order:

1. Its shadow on `ground`.
2. The slab, with its top in the lighter rim tone.
3. The floor, inset by `RIM_WIDTH`, leaving a thin bevel line. `RIM_WIDTH` is exported so a
   scene can keep walkers (and their shadows) off the bevel — the Deck Tower's `TowerPlatformLayout.roam` (towerPlatforms.ts) is
   `insetRect(platform, RIM_WIDTH)`.
4. `decals`: flat things printed on the floor (floor labels).
5. `children`: the carpets and objects on the floor.

With `floating`, steps 2–6 go through `IsoLevitate`. `bodyClassName` / `bodyStyle` land on
the group holding steps 2–6, so a scene can move the whole loaded slab on top of the bob
(the Deck Tower's landing sink, [DECK_TOWER.md](./DECK_TOWER.md) § Tower resizes).

**Trap door.** `hingeAngle` (radians, 0 = shut) swings the slab open on its back-left
top edge (`hingedPrism`).

- **Floor and decals** swing with the slab through one `hingedPlaneTransform`. A decal with
  height (a raised `IsoFloorLabel`) is not flat, so the open hinge is also handed to the
  decals through `IsoDeckHingeContext` (`sceneContext.ts`), null while shut.
- **Shade.** A veil of the tone's right-wall colour (`ISO.platform.right` for gold) darkens the top as it turns to face the way
  the right walls do, up to `SWING_SHADE_MAX` (0.7).
- **Shadow.** The ground shadow comes from `IsoShadow`'s `solid` form. It fades as the door's
  lowest point descends toward the `ground` (opacity `1 − drop / gap`, where `gap` is the
  underside-to-ground distance), gone before the door would pass through the surface its
  shadow is painted on, and fades back in as the door shuts.
- **Children do not swing.** They stand on the door, so making them fall is the scene's
  job. See [DECK_TOWER_TRANSITIONS.md](./DECK_TOWER_TRANSITIONS.md) § Trap door.

### IsoCarpet

`{ rect, surface, thickness? }`. A low solid mat a step darker than the floor
(`ISO.carpet`), 0.07 tall by default, so a sliver of wall shows. Things standing on it use
the surface `{ z: surface.z + thickness, color: ISO.carpet.top }`.

### IsoCard

`{ rect, z, thickness, figure?, label?, caption?, bandColor? }`. One flashcard: a `cardFace` top and
`cardBeige` walls. The face carries:

- an inset beige panel;
- a head band carrying a small-caps label (`bandColor`, default `ISO.cardBand` blue);
- a big centred figure;
- a caption.

The head is the low-y edge, because printed text runs along +x.

### IsoCardStack

`{ rect, count, surface, progress?, label?, bandColor?, figure? }`. A deck of N cards (`bandColor` passes through to the top card). It is drawn as one body
solid plus a full `IsoCard` on top, not as N solids, because a deck can run to hundreds of
cards. Seams (`frontContour`) suggest the individual cards. `cardStackMetrics` sets the
proportions:

- **Fixed thickness.** Every card is `CARD_THICKNESS` (0.38 world units, about 6px on a
  phone), whatever the deck size, with a seam under each, so the height *is* the deck
  size. A 500-card stack is about 190 units tall and runs far off screen; the caller frames that by scrolling,
  not by fitting the stack (see [DECK_TOWER.md](./DECK_TOWER.md) § The scene). Until
  2026-10-17 the stack was capped at 11 units and its cards thinned to fit, which made
  big decks all look the same height.
- **Seam anchoring.** Seams are anchored to the base, one per `CARD_THICKNESS`, so as the
  body grows the placed cards stay put and new cards land on top. One extra seam always
  sits where the top card meets the body; a base seam within a quarter card of it is
  dropped, so the arriving card never shows a doubled line.

`progress` (0 → 1) grows the body upward and counts up the printed figure. `figure`
overrides the printed figure (shown as-is): a stack dropping onto another names the total
it makes.

`count` 0 draws nothing: the floor under it carries an `IsoCardImprint` (below).

### IsoCardImprint

`{ rect, surface }`. The imprint a card stack leaves on its floor, printed "0" / "cards". A
floor decal (like `IsoFloorLabel`): the card rect flat at the floor's height (`flatPath`),
in the floor's tone one shadow step down, its print one step darker again (`shadowTone`
twice). It is NOT a shadow — nothing casts it — so it does not slide along the light and is
not drawn with `IsoShadow`; it sits exactly under the bottom card. It uses a card face's
figure-over-caption layout, but the caption is 1.3 units (a card face's is 0.5), because
here it is the whole message.

The caller draws it under the stack whenever the deck's count is known, not only for an
empty deck (the Deck Tower hides it only while the count loads): the stack
covers it, and anything that clears the floor (a collapse to 0, the trap door's fall, an
empty deck) reveals it already in place. Code: `IsoCardImprint.tsx` → `IsoCardImprint`;
used by `DeckTowerPlatform.tsx` → `DeckTowerPlatform` (`decals`).

### IsoCardRuns

`{ rect, surface, plan, label?, bandColor?, figure }`. A card stack COLLAPSING: it plays one
`CardCollapsePlan` (`cardCollapse.ts` → `planCardCollapse(cards, ghostCount)`) from mount,
then stands exactly as an `IsoCardStack` of `plan.remaining` cards, so the caller swaps one in
at `plan.durationMs`. Key it per plan: remounting restarts it.

- **The plan.** `ghostCount` random cards are ghosts, grouped into chunks of at most
  `GHOST_CHUNK_MAX` (3) consecutive cards; each chunk starts fading at a random time in the
  first `GHOST_SPREAD_MS` (900 ms) and takes `GHOST_FADE_MS` (420). The kept cards form
  RUNS. After a `GHOST_HOLD_MS` (160) beat with the gaps open, every run falls at once,
  each by the ghosts beneath it, under `COLLAPSE_GRAVITY` (140 units/s²); a run with more
  gaps under it lands later, so the landings ripple up. Each gives a `LAND_HOP` (0.08 units,
  `LAND_HOP_MS` 160) hop as it lands. The top card (the lid with the print) is never a
  ghost while any card is kept; it rides down on the top run.
- **Drawing.** One solid per run and per ghost chunk, bottom to top, sharing ONE wall
  gradient (every piece has the same footprint, so their front corners line up). Seams as
  in `IsoCardStack`, plus one at each piece's own base above the floor.
- **Floor shadow.** Cast by the bottom card. When that card is a ghost the shadow fades with
  its chunk (the runs above are left floating) and comes back as the lowest run lands:
  `shadowLandTiming(landAt)` fades it in over `SHADOW_LAND_MS` (120) starting on the impact,
  never before. A floor-height shadow lies almost wholly under the stack (only its contact
  sliver shows), so drawn any earlier it is just a dark patch over the floor's "0 cards"
  imprint. When nothing is kept it stays gone. The Deck Tower's drop onto an empty floor uses the same timing.
- **Ghost wireframes.** A ghost goes in two stages. Under each chunk's solid sits a light
  wireframe (`ISO.ghostWire` at `WIRE_OPACITY` 0.6): every card's full outline, back edges
  included, plus the chunk's silhouette. It does not lift with the ghost, so as the solid
  fades its outline stays standing in the gap. It holds `GHOST_WIRE_HOLD_MS` (260), then
  fades over `GHOST_WIRE_FADE_MS` (220) at the chunk's own `wireFadeDelayMs`, so the
  wireframes go in the order the chunks were picked. `fallStartMs` waits for the last one
  (plus the `GHOST_HOLD_MS` beat).
- **All CSS.** Ghost fade (with a `GHOST_LIFT` 0.25-unit rise), the fall (each run drawn
  where it lands, starting translated up by its drop on `cubic-bezier(1/3, 0, 2/3, 1/3)`,
  which is exactly y = x², free fall from rest) and the hop are CSS animations timed by
  the plan, so a several-hundred-card stack never re-renders while it collapses. Only the
  top card's `figure` changes: the caller counts it down with `cardsShowingAt(plan, ms)`
  (a chunk stops counting halfway through its fade).

Depended on by the Deck Tower's Mix → Review switch.

### IsoFloorLabel

`{ rect, surface, text, fontSize?, bandColor?, shaded?, raised? }`. A name plate printed flat on a floor: a
rounded rect (`bandColor`, default `ISO.cardBand`) with ink text, the same treatment as a
card's head band. Plate and text are drawn in world units inside one `faceTransform` at the
plate's top. Text runs along +x. By default (`raised` 0) it is part of its surface like a carpet: zero height,
no shadow, and pawns walk over it (it is not a `PawnRoam` obstacle).

`raised` (0 → 1, briefly above 1 on a spring overshoot) stands the plate up as a thin slab
of `RAISED_HEIGHT` (0.25 units, ~5 px at the Deck Tower's scale) so it reads as a button:
an `IsoSolid` whose walls are the band shaded by the platform's own steps (`plateMaterial`:
`shadeHex` 0.07 / 0.15 — the same flagged wall-tone divergence as the rest of the palette),
plus an `IsoShadow` contact shadow whose opacity follows `raised`, so it fades as the plate
sinks flush. It stays a floor decal at this height: pawns still walk over it.

On an open trap door (`IsoDeckHingeContext` non-null) the platform's flat decal transform
would squash the raised slab's walls into the door's plane. A raised plate there cancels
that transform (`invertAffine` of the door's `hingedPlaneAffine` at the hinge height) and
draws itself swung for real: walls by `hingedPrism`, its face by the door's
`hingedPlaneAffine` at the face height composed with `faceAffine`. Its contact shadow is flat,
so it stays under the platform's transform. The Deck Tower's door opens to at most 86° (its
bounce swings back toward shut, never past), well short of the 3π/4 at which it would turn edge-on, so the inverse always exists. Draw it before anything standing on the floor,
outside any depth sort. `shaded` draws it as it looks in shadow (plate and print each through
`shadowTone`, walls included); pass that copy, at the same `raised`, to a pawn's `decals` so
the pawn's shadow darkens it. The shaded copy draws no contact shadow — the pawn's shadow
already darkens that floor to the same tone.

### IsoHatch

*Code: `src/features/deckTower/iso/IsoHatch.tsx`, `iso/hatchGeometry.ts` (`hatchFootprint`).
Used by `IsoLever` and `IsoModeSwitch`; animated by the Deck Tower's `usePopUpMotion`.*

`{ at, w, d?, surface, sink, hatch, sinkDepth, shadowFootprint, air?, className?, children }`.
A rectangular (`w` across x by `d` along y; square when `d` is omitted) trapdoor in a floor that a fixture rises out of and sinks back into. It draws the
hatch and frames the fixture; the fixture's body is `children(standZ)`, drawn standing at
world z `standZ` (the lift's top). The hatch is two trapdoor flaps hinged on the hole's two x
edges plus a **lift**, a floor-coloured slab (`surface.color` with shaded sides) filling the
hole that the fixture stands on. Risen, the lift is flush and drawn as just its top, unclipped,
slightly larger than the hole, in the floor's colour: the floor under a standing fixture is
unbroken, with no seam.

`sink` (0 = risen, lift flush; 1 = sunk `sinkDepth` below the floor; clamped to [0, 1], so the
lift never rises proud of the floor) and `hatch` (0 = flaps shut flush; 1 = hanging open). At
exactly `hatch = 0` the flaps are not drawn at all, so a sunk, shut fixture leaves the floor
unbroken with no outline; the flaps (and their seams) exist only while they swing, including a
shut's spring overshoot below 0. An optional `air` (a `PawnEntranceFrame`, pawnEntrances.ts)
poses a standing fixture mid-entrance: the body is lifted `hop` units and scaled `sx`/`sy`
about its feet, and its shadow (`shadowFootprint`) stays under the landing spot, scaled by
`shadowScale` and faded by `shadowOpacity`. No part of the hatch (hole, flaps, lift top) is
drawn while `air` is set, because the floor under it may still be moving; the Deck Tower drops
its fixtures in on `FALL_FROM_SKY` ([FOCUS_MODE.md](./FOCUS_MODE.md) § 5). Below-floor parts
are hidden by clips: the lift always, and the fixture while `sink > 0`, by the hole's opening
swept up the screen; the flaps by the opening itself (a hanging near flap is hidden under the
floor's front edge). Standing, the fixture is unclipped, so one that overhangs the hole's
column must pull itself in while it passes through (IsoLever stands its stick upright).
Scenes may target `iso-hatch__hole`, `__flap`, `__lift-top` and `__shadow` (the Deck Tower
hides them on a fixture falling away with its floor).

### IsoLever

*Code: `src/features/deckTower/iso/IsoLever.tsx`, `iso/hatchGeometry.ts` (`leverFootprint`,
`LEVER_HOLE`). Used by the Deck Tower's focus lever ([FOCUS_MODE.md](./FOCUS_MODE.md) § 5).*

`{ at, surface, pull, sink, hatch, air? }`. A floor lever standing in an `IsoHatch` (1.0-unit
opening). A cream base box (`ISO.leverBase`, card stock's tones) with a dark pivot slot on its
top, a short, thick ink stick pivoting there in the world x–z plane, and a plain red ball
(`ISO.leverKnob` = `redMk` by default, flat, no outline or highlight; the optional `knob` prop recolours it — the Deck Tower's writing world passes `grnMk` (off its red sky) and reading `purMk` (off its lime sky), `towerWorlds.ts` → `TowerWorld.leverKnob`). `pull` is 0 leaning back toward −x
and 1 pulled toward the viewer (may overshoot); `sink`, `hatch` and `air` are the hatch's.
Standing, the leaning ball overhangs the hole's column, so the stick stands upright from a
third of the way down and a sinking or rising ball stays inside the clip. Its footprint is an
obstacle among the standing things.

⚠️ `ISO.leverBase.right` is derived with `shadeHex`, the same flagged divergence as the card
stock's right wall.

### IsoModeSwitch

*Code: `src/features/deckTower/iso/IsoModeSwitch.tsx`, `iso/hatchGeometry.ts`
(`MODE_SWITCH_HOLE`, `modeSwitchFootprint`). Used by the Deck Tower's Mix / Review switch
([DECK_TOWER.md](./DECK_TOWER.md) § Mix / Review switch).*

`{ at, surface, flip, labels, colors, sink, hatch, air? }`. A two-position light switch
standing in an `IsoHatch` (`MODE_SWITCH_HOLE`, 1.6 × 2.7, long along world y) — it rises,
sinks and drops in from the sky exactly like `IsoLever`.

- **Shape.** A solid grey body (`ISO.switchBase` — `greyA`, so the light yellow Mix paddle
  stands off it; `BODY_H` 0.5) with one solid V-shaped paddle (`PADDLE_W` 0.95 × `PADDLE_L`
  2.0) seated in it, sharing its centre. The body is the paddle's plan plus an even `RIM`
  (0.2) all round, and a dark slot (`SLOT_GAP` 0.05 wider than the paddle, `shadeHex` 0.4 off
  the body's grey — a flagged divergence like the wall tones) is printed on its top under the
  paddle. The paddle has a flat underside sunk `PADDLE_SKIRT` (0.5) into the body — deeper
  than its raised end lifts, so no gap ever shows under it — and a top of two faces meeting
  in a valley, the crease (a line along world x at `at`; `CREASE_T` 0.2 thick there), each
  face rising `V_ANGLE` (0.116 rad, ≈6.7°) toward its end. It rocks on the crease by the same
  `V_ANGLE`, raised `CREASE_LIFT` so the pressed end just meets the body: the pressed half's
  face lies level, the raised half's stands at 2·`V_ANGLE`. `flip` 0 presses the +y end
  (screen lower left), 1 the −y end (upper right); it is a spring and may overshoot.
- **Drawing.** The body is a prism. The V is not convex, so the paddle is drawn as its two
  convex halves, each like a prism (`halfGeometry`), the far (−y) half first. Each half's
  wall edges are cut in the world where they cross the body's top, and its silhouette is the
  hull of its top face and those cut points — so the walls end exactly at the body's top
  and the skirt inside the body is never drawn. (A screen-space clip to the body's outline
  would not do: the buried skirt projects down onto the body's top face, inside that
  outline, and the paddle looked slid forward off its seat.)
- **Colour.** The paddle takes `colors[nearer]` — the band of the position `flip` is nearer
  — in the platform's wall steps (`shadeHex` 0.07 / 0.15, the same flagged wall-tone
  divergence as the rest of the palette).
- **Label.** Only `labels[nearer]` is printed, centred on the crease and folded over both
  faces of the V: it is printed once per face through the affine map onto that face
  (`facePlane`, measured along the surface from the crease so the two prints meet at the
  fold), each clipped to its own side. Reads along −y (screen left → right). Its ink fades
  to 0 as the paddle passes level, where the label and colour swap. `LABEL_FONT` 0.4 fits
  "REVIEW" across the two faces.

Its footprint is an obstacle among the standing things.

### IsoSmokePuff

`{ rect, z, side, delayMs? }`. The dust where something heavy lands: `PUFF_COUNT` (14) round
white (`ISO.smoke`) puffs spaced evenly by arc length round the lander's footprint at height
`z`, each swelling, drifting `PUFF_REACH` out and `PUFF_RISE` up, and fading over `PUFF_MS`
(700). Drawn twice — `side="behind"` before the lander (the footprint's back half) and
`side="front"` after it. Flat discs with no walls: a puff is gone in under a second and the
cartoon wants soft round shapes. CSS-animated from mount after `delayMs`, so mount it ahead
of the landing. Hidden under reduced motion.

### IsoPawn

`{ at, surface, startled?, roam?, startledBy?, alarmed?, onDepthRankChange?, decals?, entrance?, steps? }`. A featureless ink
worker: a pill body and a ball head in screen space, standing at a projected world point.
Its shadow is a round world footprint cast through `IsoShadow`, like every other shadow.

**Shadow on decals.** `decals` are flat things on its floor that its shadow can cross, passed
already in their shaded tones (e.g. `<IsoFloorLabel shaded … />`). The pawn draws them over its
shadow, clipped to the shadow's outline, inside `travel` (so the clip moves with the shadow) under a
`decal-anchor` group that `usePawnMotion` counter-translates (so the decals stay put). The clip
outline shrinks and the copy fades in step with `shadow-hop`.

**How it moves.** The pawn is drawn once, at `at`. All movement is `usePawnMotion.ts` →
`usePawnMotion`, a requestAnimationFrame state machine that writes CSS transforms
straight onto four nested groups through refs: `travel` (slides the whole pawn, shadow
included), `shadow-hop`, `hop` (lifts the body and emote) and `pose` (leans and squashes
the body about its feet), plus `decalShade` / `decalClip` / `decalAnchor` for the shaded decals. The projection is affine, so sliding the drawn pawn by a
projected floor delta is the same as redrawing it there. React state changes only when
an emote fires or the depth rank changes, so a walking pawn does not re-render the page.
Under `prefers-reduced-motion` nothing runs and the pawn stands at `at`.

**Entrance.** With `entrance: { animation, startAt }` (a `PawnEntranceCue`, read once on
mount), the pawn ARRIVES instead of standing there from the start.

- **Hidden until `startAt`.** `travel` is set to `visibility: hidden`, and it is hidden
  from the first paint.
- **Plays the timeline.** It runs the `PawnEntrance` (`pawnEntrances.ts`), writing
  `hop`, `pose` and the shadow from each frame.
- **Then idle.** It takes the idle wander's opening pause.
- **Startles are dropped** mid-entrance.
- **Timed by landing.** Entrances are scheduled by their landing: start at
  `entranceStartFor(entrance, landAt)`. Remount the pawn (new key) to play another.
  See [DECK_TOWER_TRANSITIONS.md](./DECK_TOWER_TRANSITIONS.md) § Pawn entrances.

**Idle: wander.** With `roam` (`PawnRoam { area, obstacles }`) it loops through pause →
walk → land:

- **Where it may stand.** `area` is a rounded rect, corners honoured (`geometry.ts` →
  `insideRoundedRect`). A spot is legal when BOTH the foot circle and the shadow circle (the
  same circle slid by `light.ts` → `shadowSlide`, ~0.3 units down-right) fit inside it
  (`usePawnMotion.ts` → `onFloor`), so the shadow never lands on the bevel or past the edge.
  The pawn therefore stops ~0.3 units further from the front-right edges than the back-left
  ones. Both regions are convex, so a straight walk between legal spots stays legal.

- **Pause** for 0.7–2.6 s. The first pause after mount is a longer opening hold of 3.5–6 s
  (`OPENING_PAUSE_MIN_MS` / `OPENING_PAUSE_MAX_MS`), so the pawn stands still while the
  page settles in rather than walking off the instant it appears.
- **Walk** to a random spot in `area` 1.2–5.5 units away whose straight path keeps the
  foot circle (`PAWN_FOOT_RADIUS`) plus `OBSTACLE_CLEARANCE` off every obstacle, at
  `WALK_SPEED`. The body bounces once per step (`STEP_RATE`, `STEP_HOP`) and waddles
  side to side (`WADDLE_DEG`).
- **Land.** On arrival it keeps stepping in place until its feet touch down, so it never
  drops out of mid-air.

**Steps.** `steps` (`PawnStep[]`, `{ rect, height }`) are raised floor regions it walks
ONTO, not around — e.g. a raised `IsoFloorLabel` at its current `raised · RAISED_HEIGHT`.
While the foot centre is inside one (`usePawnMotion.ts` → `stepUnder`, rounded corners
honoured; the highest wins on overlap), the `travel` slide is projected at that height, so
body, shadow and the shaded-decal clip all sit on the step's top face (the decal anchor still
undoes the whole slide, so the decals stay put). Crossing an edge eases the lift over
`STEP_MS` (a quick hop up or down); on the same step the lift tracks the live height exactly,
so a pawn on a pressed plate sinks with it and rides its spring back up. Heights are read
from a latest-value ref, so passing a fresh array every render does not restart the loop.
Known gap: a pawn standing on the floor just BEHIND a raised step is still drawn over it
(steps are decals, outside the depth sort), so the step never hides its feet.

**Alarm.** When `alarmed` turns true, only the startle's `!` bubble pops (emote
`leanSign: 0`, so it sits straight over the head). The motion loop is untouched: no lean,
no leap. The Deck Tower uses it on the pawn falling through the trap door.

**Startle.** When `startled` turns true, from wherever it is (a pawn that MOUNTS with
`startled` already true does not startle — only a change it watches counts;
`usePawnMotion` seeds `wasStartled` with the mount value):

1. **Look up.** The body snaps into a lean back (`LOOK_UP_LEAN_DEG` over `LEAN_MS`),
   which on a faceless pawn reads as looking up. It leans away from `startledBy` on
   screen.
2. **Leap.** Still leaning, it hops `LEAP_DISTANCE` away from the nearest point of
   `startledBy`, kept on a legal spot (`clampToFloor`), on a parabolic arc (`LEAP_HOP_HEIGHT`). It stretches
   on takeoff and squashes on landing (`SETTLE_MS`); the shadow shrinks at the top of
   the arc.
3. **Emote.** A white `!` bubble snaps in over the leaning head the instant the pawn is
   startled (about 70 ms, no delay: shock is sudden), holds, and fades. This one is a CSS
   keyframe one-shot (`PAWN_CSS`), remounted by key per startle. It rides the hop's arc
   but does not lean. When the one-shot ends (`onAnimationEnd`) the bubble is
   **unmounted** (`IsoPawn` → `finishedEmoteId`), not left at opacity 0. The page
   reorders the pawn as its depth rank changes, React re-inserts its DOM node to do so,
   and re-inserting a node restarts its CSS animations, so a lingering bubble would
   replay.
4. **Stare, then recover.** It holds the look-up for `LOOK_HOLD_MS` (2.8 s), straightens
   over `RECOVER_MS`, and goes back to wandering.

**Depth sorting.** A wandering pawn can be in front of or behind the things it walks
around. An iso object is nearer the viewer than a box when it is past the box's far edge
on +x or +y. `roam.obstacles` are given back-to-front, and `depthRankAmong(point, rects)`
returns the index of the FIRST rect the point stands behind (`rects.length` when it is in
front of all of them). It is deliberately not a count of the rects it is in front of: a
fixed back-to-front list is not a total order for every point (with the Deck Tower's lever at
the floor's back-right corner, where it once stood, a pawn on the tower's back-left was behind
the tower yet in front of the lever, and a count of 1 drew it over the tower). Any slot respecting the rects it is behind is right, since the ones it is
"wrongly" behind don't overlap it on screen. The pawn reports the slot through
`onDepthRankChange` when it changes, and the caller renders the pawn after that many
obstacles. Children must be keyed, so the reorder moves the pawn's DOM node instead of
remounting it and losing its motion state.

### IsoBird

`{ flight }` (a `BirdFlight` from `useBirdFlights`). A bird in the pawn's ink style.

**Shape.** An oval body, a ball head, a stub tail and two wings, drawn in screen space
at the projected start of the flight. It faces its screen direction of travel (mirrored
when flying left) and tips `TILT_FRACTION` of the way along the path's 2:1 slope.

**Motion.** Its own requestAnimationFrame loop writes three transforms through refs:

- **travel** slides it along the flight line at a constant speed;
- **bounce** lifts it `FLAP_BOUNCE` on each downstroke (highest with the wings down),
  plus a slow `DRIFT` undulation;
- **wings** flap by scaling about the shoulder from spread up (1) through flat to swept
  down (`WING_DOWN`, −0.7). The flip through zero reads as the wings swinging past the
  body.

It has no shadow (§ Light and shadows). It is mounted per flight (keyed on `flight.id`)
and unmounted when the flight ends, so it never resets.

**Scheduling: `useBirdFlights({ proj, active, sky, maxAirborne })`.** `BirdSky` is a
`SkyRegion` (§ Sky traffic), and paths and slots come from there.

- **Slots.** `maxAirborne` slots (default 3). Waits are 1.5–6.5 s, and first flights are
  staggered by slot (`FIRST_WAIT_MS`).
- **Paths.** 0.7–2.6 units out from `around`, `OFFSCREEN_MARGIN` 2 past each screen edge.
  Speed (3.2–4.6 units/s) and wingbeat (2.6–3.6 Hz, random phase) are picked per flight.
- **Height.** Read from the birds' altitude wander (§ Sky traffic), `ALTITUDE_WANDER`
  `{ knotMs: 6000, maxStep: 0.2 }`.
- **No sorting among birds.** They are the same flat ink, so their overlap order is
  invisible.
- **Reduced motion.** Under `prefers-reduced-motion` no birds fly. A bird frozen in
  mid-air would read as a glitch.
- **Memoize `sky`.** A new object restarts every slot.

### IsoCloud

`{ drift }` (a `CloudDrift` from `useCloudDrifts`). A cloud drifting past the tower.

**Shape.** A cluster of low **pill** prisms (a rounded rect whose radius is half its short
side): a raised crown over two or three base lobes (`CLOUD_SHAPES` in
`useCloudDrifts.ts`). Each puff is an `IsoSolid` in `ISO.cloud`, so a cloud follows the
three-tone rule like every other solid. The shapes are authored long side along the drift
direction and turned to the path (`orientPuffs` swaps x ↔ y on a path along world y),
scaled 0.8–1.25, and sorted back-to-front by view depth: the 2:1 projection's view ray is
(1, 1, 1), so a puff is nearer the larger the x + y + z of its centre.

**Motion.** Drawn once at its starting position and slid by its own requestAnimationFrame
loop (the projection is affine, as for the bird). It fades in over `FADE_MS` (1.6 s). No
bob or wobble: a cloud only drifts.

**Scheduling: `useCloudDrifts({ proj, active, sky, maxInSky })`.** `CloudSky` is a
`SkyRegion` whose `band` is the range of cloud **bases**.

- **Slots.** `maxInSky` slots (default 3). Waits between drifts are 4–14 s.
- **Paths.** The cloud's near edge is 1.5–4.5 units out from `around`: `planSidePath` gets
  the cloud's across-path extent as `depth`, so a back-side cloud never overlaps the
  tower. The margin is the cloud's own extent plus 0.5, so it starts and ends fully off
  screen. Speed is 0.4–0.8 units/s, about a minute per crossing.
- **Height.** Read from the clouds' altitude wander (§ Sky traffic), `ALTITUDE_WANDER`
  `{ knotMs: 20000, maxStep: 0.12 }`: slow, because a cloud is up for a minute or more and
  every cloud in the sky with it should sit at a close height.
- **Openers.** A slot's first drift starts 15–75% of the way across (`startT`) and fades
  in, so the band has sky in it the moment clouds switch on instead of staying empty
  while one drifts in from the edge.
- **Sorting among clouds.** Unlike birds, overlapping clouds show their order.
  `sortCloudsBackToFront` orders them by the view depth of their path's midpoint.
  ⚠️ This is approximate: two clouds on perpendicular sides swap true order as they move,
  which a static sort cannot follow.
- **Reduced motion.** Clouds still show: a still cloud reads as a cloud. Nothing is
  scheduled. There is one opener per slot, parked at its `startT`, fully opaque.
- **Memoize `sky`.** A new object restarts every slot.

### IsoWind

`{ gust }` (a `WindGust` from `useWindGusts`). A cartoon gust sweeping past the tower.

**Shape.** Two or three dead-straight parallel strands (two points each, no wave), so
they project as clean lines at the grid's 2:1 slope and keep the kit's faceted look. The
main strand runs 6–9 units and ends in a **curl**: a spiral
entered moving forward, rising up and back over itself, and winding inward to
`CURL_INNER` (0.55) of its 0.7–1 unit radius over `CURL_TURNS` (0.85) of a turn. The one
or two side strands (`SIDE_STRANDS`) sit just above or below it, shorter and with no curl.
Every strand is authored in the gust's own **vertical plane**: `s` along its travel and
`h` straight up. That plane is parallel to one of the tower's sides, so the curl projects
as an iso-correct ellipse on an invisible wall beside the tower, not as a screen-space
sticker. Strands are flat, round-capped strokes in `ISO.wind` at `WIND_OPACITY` (0.7),
`STROKE_WIDTH` 0.2 units. There is no fill and no three-tone shading (§ Rules of the style).

**Motion.** Its own requestAnimationFrame loop plays each strand as a moving visible
window, using `pathLength = 1` so the dash maths is in fractions of the strand. The head
sweeps to the end over the first `HEAD_SPAN` (60%) of the play time on an ease-out. The
tail starts at `TAIL_FROM` (40%) and catches up at the end, erasing it. Strands stagger by
up to 220 ms. A strand shorter than `MIN_VISIBLE` is hidden, so its round cap never leaves
a dot. The whole gust also slides `drift` (1.2–2.2 units) along its travel. No shadow.

**Scheduling: `useWindGusts({ proj, active, sky, maxGusts })`.** `WindSky` is a
`SkyRegion` whose `band` is the range of gust **baselines**.

- **Slots.** `maxGusts` slots (default 2). Waits between gusts are 1–4 s.
- **Paths.** Unlike birds and clouds, a gust does not cross the screen. `planSidePath`
  runs with a negative margin (`SCREEN_INSET`, 1 unit inside each edge). The gust is then
  placed at a random point on that path where its whole extent fits (back side strand →
  curl's forward bulge + drift), so it plays fully on screen. The plane is 1–3.5 units out
  from `around`.
- **Height.** Read from the gusts' altitude wander (§ Sky traffic), `ALTITUDE_WANDER`
  `{ knotMs: 4000, maxStep: 0.15 }`.
- **No sorting among gusts.** They are the same flat white, so their overlap order is
  invisible.
- **Reduced motion.** No wind. A gust is nothing but motion, and a frozen half-drawn
  streak would read as a glitch.
- **Memoize `sky`.** A new object restarts every slot.

### Sky traffic

`skyTraffic.ts` is the part birds, clouds and wind share.

- **`planSidePath(proj, region, gap, margin, depth = 0)`.** A straight path parallel to one
  of the four sides of `region.around`, `gap` units out, along a world axis, so on screen
  it crosses at the grid's 2:1 slope. It runs from `margin` units past one edge of
  `region.screenSpan` to `margin` past the other. `depth` is the traveller's extent across
  the path from its origin toward +x/+y (0 for a bird). On the back sides the origin is
  pushed out by it, so the whole footprint stays `gap` clear.
- **Draw order.** `side` is `"front"` for the +x and +y sides (the walls a viewer sees),
  so the caller draws the traveller after the tower. It is `"behind"` for the other two,
  drawn before it so the tower hides it. This holds for the whole crossing: where a
  back-side path runs out past the tower's corner, the traveller is beside the tower on
  screen, not over it.
- **`useSkyTraffic({ active, slots, plan, firstWaitMs, waitMs })`.** Keeps `slots`
  travellers looping wait → cross → wait on their own timeouts, so 0 to `slots` are up at
  once, at irregular intervals. `plan(id, first)` builds one crossing. `first` marks a
  slot's opener. React state changes only when a crossing starts or ends. `plan` and the
  wait functions are effect dependencies, so callers memoize them.
- **`createAltitudeWander({ knotMs, maxStep })` / `useAltitudeWander(config)`.** Where a
  traveller's height comes from. Each traveller type (birds, clouds, wind) owns ONE
  wander, and every spawn reads `sample(band)` from it instead of picking its own random
  z. The wander is a bounded random walk on 0–1 of the band: a new waypoint every
  `knotMs`, at most `maxStep` from the last (reflected at 0 and 1), cosine-eased in
  between. It runs on wall-clock time, so it keeps drifting while nothing spawns. Why:
  two travellers up at once at very different heights can project into the same patch of
  screen, and in an isometric view that reads as a depth ambiguity (higher, or just
  nearer?). Spawns close in time now get close heights, while the band is still covered
  over a few knots. The fraction-of-band position means a band that changes (the tower
  settling lower) rescales the wander rather than stranding it outside.
- **`prefersReducedMotion()`.** The one reduced-motion check for the iso folder and the
  Deck Tower page.

## Palette

The base colours are all `COLORS` tokens:

| Role | `ISO` key | Token |
|---|---|---|
| Sky | `sky` | `bluMk` |
| Platform | `platform` | `gld` (any other hue through `platformTone(base)`, which applies the same wall / rim shading) |
| Card top | `card.top` | `cardFace` |
| Card walls and face panel | `card.left`, `cardPanel` | `cardBeige` |
| Card head band, floor label plate (default; callers may pass `bandColor`) | `cardBand` | `bluMk` |
| Cloud top | `cloud.top` | `white` |
| Wind strokes | `wind` | `white` (at 0.7 opacity, `IsoWind` → `WIND_OPACITY`) |
| Space (Deck Tower backdrop above the sky) | `space` | derived: `spaceOver(bluMk)` = `shadeHex(bluMk, 0.55)` ⚠️; the Deck Tower's worlds all share this one |
| Stars | `star` | `white` |
| Smoke puffs | `smoke` | `white` |
| Ghost wireframes (IsoCardRuns) | `ghostWire` | `white` (at 0.6 stroke opacity, `IsoCardRuns` → `WIRE_OPACITY`) |
| Ink | `ink` | `onSurface` |

⚠️ **Divergence from the colour framework.** The darker tones are derived at runtime with
`shadeHex` (an HSL lightness step), because the framework has no darker tier for these
hues. That covers `space` (the sky's hue taken down to night, `spaceOver` — deep navy for
blue; every Deck Tower world shares it), the wall tones (of every `platformTone`) (cloud walls included, shaded off `white`), the rim, the carpet, the card seams and every shadow
(`shadowTone`). If the style spreads beyond the Deck Tower, promote them to tokens in
`src/theme/colors.ts`.

Adding an object: build it from `IsoSolid` and `flatPath`, read the projector with
`useIsoProjector`, take a `surface` if it stands on something, cast its shadow with
`IsoShadow` before drawing itself, and export it from `index.ts`.
