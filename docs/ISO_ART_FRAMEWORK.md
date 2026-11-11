# Iso Art Framework

A small SVG kit for drawing scenes in the art style of Nintendo/Paladin's *Good Job!*:
chunky, softly bevelled isometric boxes with flat three-tone shading, no outlines and hard
shadows. Code: `src/features/deckTower/iso/`. Import from its barrel,
`src/features/deckTower/iso/index.ts`, not from the individual files.

Parent: [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md) (sub-documents table). Its main
user is [DECK_TOWER.md](./DECK_TOWER.md), which uses `IsoScene`, `IsoPlatform`
(`floating`), `IsoCardStack`, `IsoCardImprint`, `IsoFloorLabel`, `IsoPawn`, `IsoCloud` and `IsoWind`.
The acp also imports it (`src/features/discover/SortBins.tsx`, which draws through its own
`makeProjector`; `sortTimeOfDay.ts` → `mixHex`, `shadowTone`; `AddCardsPage.tsx` → `shadeHex`). Its decks'
top faces carry the mini card drawn as **native SVG** — `MiniCardSvg` (`src/components/MiniCardSvg.tsx`,
MiniCard's SVG twin, laid out by `miniCardSvgLayout.ts` on MiniCard's own numbers) in card px,
mapped by `faceTransform` composed with a px → world scale (`SortBins.tsx` → `DeckFace`). **No HTML
on an iso face:** the face used to be the real `MiniCard` in a `<foreignObject>`, and WebKit (iOS
Safari) painted that positioned HTML WITHOUT the SVG transforms — the face sat flat and unrotated at
the scene's corner (2026-11-10). Every face print is SVG; and so
does the flp's hint pawn (`hintPawn/HintPawn.tsx`: a tiny, non-bobbing `IsoPlatform` with an `IsoPawn`,
[HINT_PAWN.md](./HINT_PAWN.md)).
`IsoCarpet` (a low floor mat) and `IsoModeSwitch` (the Mix / Review floor switch) were deleted
on 2026-11-08, unused since 2026-10-17 and 2026-10-22.

**Location.** The kit sits under `features/deckTower/`, but it now has a second importing
feature (`features/discover`), so per [FRONTEND_LAYERING.md](./FRONTEND_LAYERING.md) § 1 it is
due to move to `src/components/iso/`.

**Outline-rule exemption.** The style tells edges apart only by flat value steps between
faces, so it deliberately ignores the app's outline rule (CLAUDE.md § Buttons & cards).
The exemption covers iso scenes only; it is not a precedent for UI chrome.

## Rules of the style

1. **Everything is an extruded rounded rect** in the world XY plane, pushed up along z.
   The exception is the ink figure: the pawn's body (a screen-space pill, which reads
   the same from every angle), and the rare red balloon's body (`IsoBalloon`, a true
   round solid like the pawn's head). A cloud is a
   cluster of rounded rects (pills), so it follows the rule. Wind (`IsoWind`) is not a
   solid at all: it is flat round-capped strokes, the kit's one stroke-only object.
2. **Three flat tones per material:** a lit TOP, a mid LEFT wall and a dark RIGHT wall.
   No gradients except the short blend across a rounded front corner.
3. **One light.** It comes from the upper left, and every shadow falls screen down-right.
4. **Every shadow is made by `IsoShadow`.** No component draws a shadow any other way.
5. **Objects draw themselves.** A page only places objects and tells each one which
   surface it stands on.
6. **Centred text goes through `IsoText` / `IsoSpacedText`, never `dominantBaseline`.**
   See [Text in the iso kit](#text-in-the-iso-kit); eslint enforces it.

## Layers

| Layer | File | Role |
|---|---|---|
| Scene | `IsoScene.tsx` → `IsoScene`, `sceneContext.ts` → `useIsoProjector` | The `<svg>` root and the context that hands the projector to every component inside it |
| Primitive | `IsoSolid.tsx` → `IsoSolid` | Paints one prism in three-tone shading. Takes ready-made geometry, so it needs no context |
| Primitive | `IsoShadow.tsx` → `IsoShadow` | The only shadow drawer |
| Primitive | `IsoSpacedText.tsx` → `IsoSpacedText` | Centred letter-spaced text that anchors the same in every engine (§ Objects → IsoSpacedText) |
| Behaviour | `IsoLevitate.tsx` → `IsoLevitate` | Bobs an object up and down; its shadow breathes in sync |
| Behaviour | `usePawnMotion.ts` → `usePawnMotion`, `depthRankAmong`, `pointInFrontOfRect`, `backToFront`, `PawnEntranceCue`, `PawnTapReaction`, `PawnActiveIdle` | The pawn's entrance, wander and startle, its idles and tap reactions, and depth-sorting a moving object among obstacles |
| Behaviour | `pawnIdles.ts` → `PawnIdleKind`, `PawnIdleCue`, `LASTING_IDLES`, `idlePose`, `flinchPose`, `SNEEZE_SNAP_MS`, `KNIT_CLICK_MS` | The idle animations' and the tap flinch's pose curves, pure (§ IsoPawn → "Idles and the flinch") |
| Math | `pawnFigure.ts` → `pawnFigure`, `pawnVest`, `circleHullPath`, `HEAD_CENTRE` (also read by the flp hint pawn's bubble tail) | The pawn's body as a projected 3D capsule + sphere (§ IsoPawn → "View"); bent along a curved spine by `arch` (§ IsoPawn → "Back stretch"); the optional night vest (§ IsoPawn → "Vest") |
| Behaviour | `pawnEntrances.ts` → `PawnEntrance`, `FALL_FROM_SKY`, `PAWN_ENTRANCES`, `pickPawnEntrance`, `entranceStartFor` | How a pawn arrives, as pure pose timelines timed by their landing ([DECK_TOWER_TRANSITIONS.md](./DECK_TOWER_TRANSITIONS.md) § Pawn entrances) |
| Behaviour | `skyTraffic.ts` → `planSidePath`, `useSkyTraffic`, `createAltitudeWander`, `useAltitudeWander`, `SkyRegion`, `SkySide`, `prefersReducedMotion` | What clouds and wind share: the path along a tower's side, the wait → cross → wait slot scheduler, and the wandering spawn altitude (§ Sky traffic) |
| Behaviour | `useCloudDrifts.ts` → `useCloudDrifts`, `CloudDrift`, `CloudSky`, `sortCloudsBackToFront` | Schedules the clouds drifting past the tower: shapes, speed, timing, mid-sky openers |
| Behaviour | `fogClouds.ts` → `planFogClouds`, `FogCloud`, `FogUnit`, `FogBridge`, `FogCover`, `FOG_LEVELS` | Shapes the fog clouds (staggered, bridged units) and plans their lanes across a screen box (§ IsoFog) |
| Behaviour | `useWindGusts.ts` → `useWindGusts`, `WindGust`, `WindStrand`, `WindPt`, `WindSky` | Schedules the wind gusts: strand shapes, curl, timing, on-screen placement |
| Object | `IsoPlatform.tsx`, `IsoCard.tsx`, `IsoCardStack.tsx`, `IsoCardImprint.tsx`, `IsoFloorPrint.tsx`, `IsoPaperStack.tsx`, `IsoSortPlatform.tsx`, `IsoCardRuns.tsx`, `IsoFloorLabel.tsx`, `IsoHatch.tsx`, `IsoLever.tsx`, `IsoSmokePuff.tsx`, `IsoPawn.tsx` (+ its `PawnIdleProps.tsx`), `IsoCloud.tsx`, `IsoCloudShadow.tsx`, `IsoBalloon.tsx`, `IsoWind.tsx`, `IsoFog.tsx`, `IsoRain.tsx`, `IsoSnow.tsx`, `IsoSnowCap.tsx`, `IsoSnowFloor.tsx` (+ `snowTrail.ts`), `IsoLightningBolt.tsx`, `IsoBurnMark.tsx` | The things a scene is made of (one component each, below) |
| Behaviour | `cardCollapse.ts` → `planCardCollapse`, `cardsShowingAt`, `fallMsFor`, `shadowLandTiming`, `CardCollapsePlan` | The pure plan for a stack losing cards and settling (§ IsoCardRuns) |
| Rules | `light.ts` → `IsoSurface`, `shadowFootprint`, `shadowSpread`, `shadowTone`, `cloudShadowFootprint` | The light and the shadow rule |
| Rules | `palette.ts` → `ISO` (incl. `yarn`), `shadeHex`, `mixHex`, `Material` | Colours (`mixHex` blends two colours continuously, e.g. the Deck Tower sky → space) |
| Rules | `levitation.ts` → `BOB_HEIGHT`, `BOB_PERIOD_MS`, `frozenBobOffsetPx` | The bob, and reading back where a paused one stopped |
| Math | `geometry.ts` | Projection and shape math (below) |
| Math | `camera.ts` → `makeCameraProjector`, `dimetricView`, `CameraView` | A moving camera with perspective that reproduces the fixed view exactly at one setting (§ The camera) |
| Math | `cardStackMetrics.ts` → `cardStackMetrics` | Card thickness, stack height for N, and the seam-spacing rule (`seamHeights`) |

## Geometry

`geometry.ts` uses a dimetric projection tilted `VIEW_PITCH` (55°) from straight down. It was the Night Market's 2:1 grid (60°) until 2026-10-31; the tilt makes the floor 15% deeper on screen and heights 5% shorter at the same width. Every scene draws through it, so the Deck Tower and the acp's bins change together. The floor and heights no longer share a scale: `Projector.unit` (and `scaleAt`) is the floor's and `Projector.heightUnit` is height's.
World +x runs down-right, +y down-left and +z up. Screen coordinates are
`sx = (x − y)·unit` and `sy = (x + y)·unit/2 − z·unit`.

- **`prism`.** For a convex shape extruded straight up, the screen silhouette is the convex
  hull of the top and bottom outlines.
- **`flatPath`.** A rounded rect lying flat at height z. Used for floors, decals and
  shadows.
- **`faceTransform`.** Maps flat world-unit drawing onto a top face, so printed text lies
  on it. `faceAffine` is the same map as an `Affine`, for composing. Both are built from
  where a point `at` (pass the print's centre) and its two unit neighbours project, so
  they work under any `Projector`: exact everywhere under the fixed view, exact at `at`
  and a fraction of a px off a few units away under a perspective camera.
- **`Projector`.** `{ unit, heightUnit, project, scaleAt, facingScaleAt, seesHighSide }`. `seesHighSide(axis, at)` says whether the camera sees the vertical plane `axis = at` from its high side — always under the fixed view (it looks in from +x/+y); under a camera, whether the camera stands past the plane (`camera.ts` → `makeCameraProjector`). Depth sorting reads it (§ IsoPawn → "Depth sorting"). `heightUnit` is what a screen-y move by a world height reads (the bob, a card run's drop, the platform sink, the hatch hop); a camera reports its floor `unit` there, because looking straight down a height has no screen length. `scaleAt(x, y, z)` is the screen px per
  world unit AT a point (the square root of the floor plane's area scale there) — equal to
  `unit` everywhere under the fixed view, shrinking with distance under a perspective
  camera. Anything that sizes itself in screen px (a stroke width, a radius) should use it
  rather than `unit` (`IsoLever`'s stick and knob, `IsoSmokePuff`'s puffs, `prism`'s
  bevel width, the pawn's shadow). `facingScaleAt(x, y, z)` is the px per world unit of a
  length FACING the camera (the projected radius of a unit sphere): only perspective
  shrinks it, so it is `unit·√2` under the fixed view, whose floor is foreshortened but
  whose spheres are not. It sizes things drawn as true 3D round shapes (the pawn's figure,
  `iso/pawnFigure.ts`). Code: `geometry.ts` → `Projector`, `makeProjector`; `camera.ts` →
  `makeCameraProjector`.
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
- **`posedPrism`.** `prism` for a solid carried rigidly through space by any `place`
  function (world point → where it is now): a rigid motion keeps the solid convex, so the
  silhouette is still the hull of the two placed outlines. `hingedPrism` is `posedPrism`
  with `hingePoint` (its only caller today).

## The camera

`camera.ts` → `makeCameraProjector(view)`. The fixed view generalised into an orbit
camera: relative to `target`, a point is turned by `yaw` about world z, its height scaled by
`zScale`, tilted by `pitch` (`VIEW_PITCH` = the iso tilt, 0 = straight down), scaled by `scale` px
per unit and divided by `(1 − depth · perspective)` (1 / `perspective` is the camera's
distance; anything that close or closer is clamped, `MIN_DEPTH_FACTOR`, not flipped),
then placed so `target` lands on `screen`. `dimetricView(unit, target)` is the setting that
reproduces `makeProjector(unit)` exactly (yaw π/4, pitch `VIEW_PITCH`, `zScale` √(2/3), `scale`
unit·√2, no perspective) — so a camera can start on the frame already on screen with no
jump (`__tests__/camera.test.ts` pins this).

Used by the Deck Tower's dive onto its top card (DECK_TOWER.md § Studying the tower). What
a moving camera changes for the objects:

- They all draw through `project`, so they follow it. A memoised geometry keyed on `proj`
  recomputes each frame the camera moves.
- Screen-px sizes use `scaleAt` (§ Geometry → `Projector`).
- Prints use `faceTransform` with their centre (§ Geometry).
- The CSS screen-y slides (the bob, a sky drop's fall, the platform sink, the swap fall)
  are only "up/down" under the fixed view. The bob is paused while the camera is away
  (§ Levitation); the others belong to animations that only play in the fixed view.
- The pawn is a projected 3D figure, so it looks right from any angle (§ IsoPawn → "View").
- Hinged planes (`hingedPlaneAffine`) and the sky traffic's planned paths still assume
  the fixed view.

## The scene

`IsoScene` takes a `proj` (from `makeProjector(unit)`, or a `makeCameraProjector` camera), a `viewBox` and an optional
`preserveAspectRatio` (default centred; `"xMidYMax meet"` pins the scene to the bottom). Every object
inside reads the projector from context (`useIsoProjector`, which throws outside a scene),
so objects take world positions only and never a `proj` prop. The page fits the viewBox to
its settled content, so the scene scales to any box.

An optional `wash` lights the whole scene (§ Ambient wash): the scene provides the washed
palette (`useIsoPalette`) and the wash itself (`useIsoWash`) to everything inside it.

## Ambient wash

`src/timeOfDay/wash.ts` → `IsoWash`, `NO_WASH`, `WashLight`, `lightWash`, `blendWash`,
`phaseWash`, `hexToOklch`, `oklchToHex`, `hueTurn` (re-exported by `iso/wash.ts`); `iso/wash.ts`
→ `washPalette`, `washMaterial`, `washTone`; `iso/sceneContext.ts` →
`useIsoPalette`, `useIsoWash`; `IsoScene` `wash`.

A wash is one colour transform, `(hex) => hex`, laid over every colour a scene paints — how
the Deck Tower lights its scene for a time of day ([DECK_TOWER.md](./DECK_TOWER.md)
§ "Time of day"). One rule, so nothing is washed twice:

- **Objects read their constants from `useIsoPalette()`, never from `ISO`.** IsoScene builds
  it once per wash (`washPalette`: every plain colour and every material tone of `ISO`).
  Outside a washed scene it is plain `ISO`.
- **Colours a caller passes in are the caller's to wash** — a platform `tone`, a `surface`
  colour, a `bandColor`, a lever `knob`. A component inside the scene that passes its own
  colours reads the wash with `useIsoWash()`. Prop defaults (`bandColor`, `knob`, `tone`)
  fall back to the washed palette.
- **Primitives paint what they are given** (`IsoSolid`, `IsoShadow`). A shadow's tone comes
  from its receiver, which is already washed, so shadows follow.
- **A light** (`WashLight`, `lightWash`): an sRGB mix `amount` toward `toward` (the cast —
  what warms near-white card stock, which has no hue to turn), then OKLCH lightness × (1 −
  `dim`) (dimming in OKLCH keeps the hue: a dim gold stays a darker orange, not olive).
  `blendWash(a, b, t)` mixes two lights' RESULTS, exact at both ends, memoised per colour.

Keep the wash's identity stable between renders: a new one re-washes the palette and
re-renders every object.

- **DOM content is not washed.** The kit lights only what it draws. HTML laid over a washed
  scene (the Deck Tower's flp session, the slab footer) is drawn as is. A
  `washColorMatrix` SVG `feColorMatrix` filter used to light it (until 2026-10-30); it was
  cut because WebKit rasterises an SVG `url()` filter on HTML on the CPU and re-ran it on
  every repaint, which made the flp lag (DECK_TOWER.md § Time of day → "The wash").

## Surfaces

An `IsoSurface` is `{ z, color }`: a horizontal plane something can stand on and a shadow
can fall on. Every object that stands on something gets a `surface` prop; the platform's
shadow goes on `ground`. The colour belongs to the surface because a shadow's tone comes
from what it falls on.

## Light and shadows

`light.ts` holds one rule, and `IsoShadow` applies it:

> A shadow is the caster's **footprint** (its underside outline), slid along the light by
> `LIGHT_SLOPE · (casterZ − receiver.z + CONTACT_LIFT)`, stretched on its two front edges
> (+x, +y) by `shadowSpread`, laid flat on the receiver, and painted in the receiver's colour darkened by
> `SHADOW_DEPTH`.

- **Direction.** `LIGHT_DIR` points screen down-right, away from the upper-left light that
  the face shading assumes.
- **Distance grows with height.** An object resting flush on a surface still shows a short
  contact sliver (`CONTACT_LIFT`). A floating one throws its shadow further.
- **The sliver is thin.** `CONTACT_LIFT` is 0.15, so a resting object's shadow peeks
  ~1px (0.075 units) past its edge. It was 0.6 (~3px) until 2026-11-04, which read as every
  object on the floor hovering; 0.15 is what a single sheet of paper got under the height
  rule below.
- **Size is separate from shift.** The slid footprint's two front edges are pushed back
  out to where the old 0.6-lift shadow's were (`light.ts` → `shadowSpread`, applied inside
  `shadowFootprint`): `LIGHT_DIR · LIGHT_SLOPE · (0.6 − 0.15)` ≈ 0.209 on +x (the right edge,
  under the dark right wall) and ≈ 0.084 × `BOTTOM_SPREAD_SCALE` (1.5) ≈ 0.126 on +y (the
  bottom / front-left edge). Visible shade: right ≈ 0.28 (the old shadow's), bottom ≈ 0.15
  (a little more than the old 0.11, which read as too thin next to the thin shift), while the
  back edges stay tucked under the object. Rejected on 2026-11-04: growing every side
  (bottom band too heavy, rims on the back edges) and growing +x only (bottom sliver too thin).
  The spread does not grow with height, and it scales down with `contactLift` for a caster
  thinner than a sheet of paper. The `solid` form pushes each landed vertex past the landing's
  centre by `spread` on that axis, so a closing door hands over to the footprint shadow without
  a jump. The pawn's roam check (`usePawnMotion.ts` → `onFloor`) holds its shadow's centre
  `spread` further from the roam area's +x and +y edges, so the stretched shadow stays on the floor.
- **Very short casters may scale it further.** `IsoShadow` takes an optional `casterHeight`;
  with it, the sliver is `min(CONTACT_LIFT, 2.5 · casterHeight)` (`contactLift`,
  `CONTACT_LIFT_PER_HEIGHT`), which only bites below 0.06 units (one sheet of paper).
  `IsoPaperStack` and `IsoSortPlatform` pass a height; every other caster takes the full lift.
- **Tone comes from the receiver.** Shadows on the sky, the floor and a floor plate read as the
  same strength of shade. There are no per-receiver shadow colours in the palette.
- **Flat things are part of their surface.** A flush floor label receives shadows but casts none.
  A shadow is an opaque fill in the *floor's* shade, so a decal it crosses (a floor label) must be
  shaded in its own tones: the caster draws the decal's `shaded` variant clipped to its shadow
  (`IsoPawn` → `decals`; `IsoFloorLabel` → `shaded`). A plain glaze cannot do this — the floor's
  shade is a saturation-boosted orange, which as a translucent overlay needs ~80% opacity and
  would repaint the decal.
- **Parts cast no shadow.** `IsoCard` used as a stack's top card is a part; the stack casts.
- **Clouds use a shorter skew.** Clouds fly ~18–24 units over the floor, where `LIGHT_SLOPE`
  would land their shadows ~10 units down-right, never on screen with the cloud. So a cloud's
  shadow keeps `LIGHT_DIR` but slides by `CLOUD_LIGHT_SLOPE` (0.08 per unit of drop, ~1.5–2
  units), with no contact lift or spread (`light.ts` → `cloudShadowFootprint`; decided
  2026-11-04). It falls only on horizontal surfaces, the floor and the ground: the tower's
  visible walls face away from the light, so the one-light rule never shades them (§ IsoCloud
  → Shadow).
- **Wind casts no shadow.** `IsoWind` is the only standing exception.
- **Draw order.** Each object draws its shadow first, then itself, so it covers the hidden
  part of its own shadow.
- **Tilted casters.** A caster that is not level (the platform swung open on its hinge)
  passes `IsoShadow` a `solid` (its world vertices) instead of a footprint. Each vertex
  slides by the same rule for its own height, and the shadow is the hull of where they
  land. With every vertex at one height this is the footprint case.

| Caster | Footprint | `casterZ` | Receiver |
|---|---|---|---|
| `IsoPlatform` | the slab rect | its underside (−thickness) | `ground` (optional: omitted, no shadow is drawn) |
| `IsoCardStack` | the card rect | its `surface.z` | its `surface` |
| `IsoPawn` | a circle of `FOOT_RADIUS` | its `surface.z` | its `surface` |

## The rounded edge

`IsoSolid.tsx` → `IsoSolid` (`roundedEdge` prop); `geometry.ts` → `splitChains`,
`PrismGeometry.topFront` / `topBack`; constants from `src/theme/roundedEdge.ts`
(`ROUNDED_EDGE_FILLET_PX`, `RIM_LIGHT_PX`, `RIM_LIGHT_WHITE_PCT`); palette `ISO.edgeLight`.

The SVG form of the hairline round the HTML tower objects draw with box-shadows (the td
filter keys, the card-stock mini cards, the slab footer — `theme/roundedEdge.ts`), so a
solid in the scene and a key on the page share one edge. Opt-in per solid:
`roundedEdge={palette.edgeLight}`. It has two parts, both stroked on the top face's outline
split at its leftmost and rightmost screen points (`splitChains`):

- **Fillet.** The FRONT chain (`topFront`, where the top meets the walls) stroked
  2 × `ROUNDED_EDGE_FILLET_PX` (1px) wide before the top is painted. The top covers the
  inner half, so 0.5px shows on the wall side. Its colour is half-way from the top to the
  wall beneath: a gradient on the walls' own left → right step across the front corner.
- **Rim light.** The BACK chain (`topBack`, against the sky, the edge the upper-left light
  catches) stroked 2 × `RIM_LIGHT_PX` wide and clipped to the top, so 1px shows inside the
  face. Its colour is the top mixed `RIM_LIGHT_WHITE_PCT` (45%) toward `ISO.edgeLight`.
  `edgeLight` is `COLORS.white` kept as a palette entry so the wash dims it; an unwashed
  white would glow at night. It is painted after the solid's children (unlike the HTML
  inset shadow, which sits under content), because a raised floor plate's face covers its
  whole top. Every other print stays inset from the edge.

Widths are viewBox px, which the scenes keep at about screen px (like the 1px wall seams).
On a white or cream top (the notebook, card stock) the rim light is barely visible, as on
the HTML card stock.

| Solid | Edge |
|---|---|
| `IsoCard` (every top card: IsoCardStack's, IsoCardRuns', TowerCoverCard's) | yes |
| `IsoCardStack` body | no. Its top is under the top card, so a fillet there would double the seam under the top card |
| `IsoPaperStack` (the notebook) | yes |
| `IsoPlatform`, `IsoSortPlatform` | no. Their light rim bevel (`RIM_WIDTH`, `MINI_RIM`) already rounds the edge |
| `IsoFloorLabel` raised plate | yes, once it has a wall (`raised` > 0); the shaded copy's edge light goes through `shadowTone` |
| `IsoLever` base | yes |
| `IsoHatch` lift | no. Flush with the floor when risen, so it would only show mid-motion |
| acp's `SortBins` | the TOP layer only (the shown top, the old top while placing, the lifted top on Undo — `TOP_EDGE_LIGHT`, the unwashed `ISO.edgeLight`, since the acp is lit by its `SortLook`); the under-layers no, like the card stack's body |

## Text in the iso kit

*Code: `src/features/deckTower/iso/IsoText.tsx` → `IsoText`, `INK_CENTRE_DY`;
`src/features/deckTower/iso/IsoSpacedText.tsx` → `IsoSpacedText`; `eslint.config.js` → the
"iso text" block.*

**The pitfall.** The usual way to centre SVG text on a point is
`dominant-baseline="central"`. It centres the font's em box, not its ink, and WebKit
(iOS Safari, the Capacitor app) and Chromium compute that box differently for a CJK face.
The kit prints in `FONTS.cjk` (975 Maru SC), so a `central` label looks centred in desktop
Chrome and sits visibly off-centre on an iPhone. A desktop check, headless or not, cannot
catch it. It has shipped twice: the Deck Tower's "LEARNING" plate, then the acp's 1–4
rating numbers inside their dotted boxes (2026-11-10).

**The rule.** Draw centred iso text with:

| Need | Use |
|---|---|
| Centred text, no letter-spacing (figures, digits, emote marks) | `IsoText` — a `<text>` whose props type omits `dominantBaseline` and `dy` |
| Centred, letter-spaced text (plates, head-band labels, floor prints) | `IsoSpacedText` (§ IsoSpacedText) |
| Text deliberately placed by its baseline (words stacked above something) | a plain `<text>` with no baseline prop — e.g. the Deck Tower's `TapToStartHint` |

Both components keep the **alphabetic** baseline, which every engine places identically,
and shift it down by `INK_CENTRE_DY` (0.34 em), so the ink centres on `y`. eslint rejects
any `dominantBaseline` attribute in `src/features/deckTower/iso/**` and in
`features/discover/SortBins.tsx`.

**Where 0.34 em comes from.** It is measured from Maru's own outlines (the cn-fontsource
woff2 subsets, bounds via fontTools), not tuned by eye:

| Glyphs | Ink centre above the baseline |
|---|---|
| capitals (`H`, `Z`, `LEARNING`) | 0.338 em |
| digits `0`–`4` | 0.337–0.344 em |
| `!` | 0.341 em |
| `cards` (has an ascender) | 0.356 em |
| x-height-only words (`acrs`) | 0.257 em, so it would sit ~0.08 em high (none drawn today) |

Chromium's `central` put Maru at (hhea ascent 928 − descent 256) / 2 = 0.336 em. So the
switch left desktop rendering unchanged to within 0.004 em and moved only WebKit.

**Caveats.**
- **The value belongs to the font.** If `FONTS.cjk`'s face changes (`useChineseFont` →
  `DEFAULT_CHINESE_FONT_ID`), re-measure and update `INK_CENTRE_DY`. `IsoSpacedText` used
  to carry its own 0.38 em, tuned for Noto Sans SC before the app moved to Maru. That is
  exactly the drift a single shared constant avoids.
- **Glyphs Maru lacks fall back per device.** The pawn's singing notes (♪ ♫,
  `PawnIdleProps` → `PawnSingNotes`) are not in Maru, so they render in whatever the stack falls
  back to (PingFang SC / a symbol face on iOS). The baseline is still Maru's and still
  engine-independent, but their ink centre is the fallback's. Note glyphs usually run from
  the baseline to about cap height, so 0.34 em is close but not measured. Drawing them as
  paths would make them exact.
- **Exemption.** acp's speech bubble (`SortBins` → `SpeechBubble`'s `sort-bins__bubble-text`)
  stays on `central` behind an `eslint-disable` comment. It is set in `FONTS.sans`
  (Instrument Sans, a Latin face without the CJK em-box disagreement), and it is multi-line
  mixed-case prose with no single ink centre to measure.

**Users of `IsoText`:** `IsoCard` (figure + caption), `IsoCardImprint` ("0" / "cards"),
`IsoPawn` (the emote "!"), `PawnIdleProps` (mark discs, doze Z's), acp's `SortBins` →
`NumberPrint`.

## Levitation

`IsoLevitate` takes a `shadow` node and `children`. The shadow stays where it is while the
children rise `BOB_HEIGHT` world units and sink back once per `BOB_PERIOD_MS`. The shadow
shrinks toward its centre and fades as they rise.

The two are separate CSS animations (`LEVITATE_CSS`) with the same duration, easing and
start, so they need no shared clock. Both stop under `prefers-reduced-motion`, leaving the
object at its lowest point, where its shadow was computed. A caller fitting a viewBox must
allow `BOB_HEIGHT` of headroom.

`paused` FREEZES both animations where they are (`animation-play-state`), so un-pausing
carries on with no jump; the rise's px size (`--iso-bob`) is frozen with it, because a
moving camera changes `unit` every frame. `IsoPlatform` passes it through as `bobPaused`.
`levitation.ts` → `frozenBobOffsetPx(root)` reads back the screen-y offset a paused bob
stopped at (the computed transform of the first `.iso-levitate__body` under `root`), so
a camera can aim at where the object actually stands (the Deck Tower's study camera).

## Objects

### IsoPlatform

`{ rect, thickness, ground?, floating?, hingeAngle?, decals?, groundDecals?, children, tone?, bodyClassName?, bodyStyle?, bobPaused?, fadeStyle?, fadeChildren? }`. A slab whose top,
the floor, is at z = 0 and which extends down to −thickness. `tone` (a `PlatformTone`,
from `platformTone(base)`) paints it in any hue; it defaults to the gold `ISO.platform` /
`ISO.platformRim`. The Deck Tower gives each world its own (towerWorlds.ts).

It draws, in order:

0. `groundDecals`: flat things on the ground (drifting cloud shadows). Drawn outside the bob
   (the ground stays put) but inside `fadeStyle`; the slab's shadow and the slab cover what lies under them.
1. Its shadow on `ground`. With no `ground` (a platform floating over DOM content, like the flp's
   hint pawn), no shadow is drawn.
2. The slab, with its top in the lighter rim tone. No rounded edge (§ The rounded edge): the bevel is its edge.
3. The floor, inset by `RIM_WIDTH`, leaving a thin bevel line. `RIM_WIDTH` is exported so a
   scene can keep walkers (and their shadows) off the bevel — the Deck Tower's `TowerPlatformLayout.roam` (towerPlatforms.ts) is
   `insetRect(platform, RIM_WIDTH)`.
4. `decals`: flat things printed on the floor (floor labels).
5. `children`: the objects on the floor, in their own group after the slab's.

With `floating`, steps 2–5 go through `IsoLevitate`. `bodyClassName` / `bodyStyle` land on
the group holding steps 2–5, so a scene can move the whole loaded slab on top of the bob
(the Deck Tower's landing sink, [DECK_TOWER.md](./DECK_TOWER.md) § Tower resizes).

**Fading.** `fadeStyle` (e.g. `{ opacity }`) lands on the groups holding steps 1–5. A
group's opacity cannot be undone by a child, so a scene that must keep one child opaque
through a fade passes `fadeChildren={false}` — the children's group is then left unfaded —
and fades the other children itself, each on its own wrapper. The kept child stays in its
slot of the draw order, so what stands in front of it still draws over it; lifting it out
over the faded group (the old `overlay` prop, removed 2026-10-30) painted it over
everything. The Deck Tower fades its platform out on the study dive and keeps its deck this
way ([DECK_TOWER.md](./DECK_TOWER.md) § Studying the tower → "Hiding the
platform").

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

### IsoCard

`{ rect, z, thickness, figure?, label?, caption?, bandColor?, printOpacity? }`. One flashcard: a `cardFace` top and
`cardBeige` walls, with the hairline rounded edge (§ The rounded edge). `printOpacity` (default 1) fades everything printed on the face —
panel, band, text — leaving the bare card stock (IsoCardStack passes it to its top card; the
Deck Tower sets it to 0 while its study camera is down on the card, when the count card is
drawn as its own layer — DECK_TOWER.md § Studying the tower → "The count card"). The face carries:

- an inset beige panel (`FACE_PAD` 0.34 units in from the edge, corner `PANEL_RADIUS` 0.24 —
  rounder than concentric, and shared with the head band's corner. The tower-hosted flp
  paints the same rim at `FLP_CARD_STOCK_INSET_RATIO` = `FACE_PAD` / `CARD_W` and
  `FLP_CARD_PANEL_RADIUS_RATIO` = `PANEL_RADIUS` / `CARD_W`,
  `src/features/flashcards/constants.ts`; retune each pair together);
- a head band housing a small-caps `label` (drawn with `IsoSpacedText`, spacing 0.055, so it centres on iOS Safari too; `bandColor`, default `ISO.cardBand` blue) — drawn ONLY when a `label` is passed; without one the face has no band and the figure + caption centre on the whole panel (the Deck Tower passes both: the standing deck's plate label and `band`);
- a big centred figure;
- a caption (0.8 units).

The head is the low-y edge, because printed text runs along +x.

### IsoCardStack

`{ rect, count, surface, progress?, label?, bandColor?, figure?, printOpacity? }`. A deck of N cards (`bandColor` and `printOpacity` pass through to the top card). It is drawn as one body
solid plus a full `IsoCard` on top, not as N solids, because a deck can run to hundreds of
cards. Seams (`frontContour`), evenly spaced at 2 per 5 cards, suggest the individual cards. `cardStackMetrics` sets the
proportions:

- **Fixed thickness.** Every card is `CARD_THICKNESS` (0.12 world units, about 2px on a
  phone; on 2026-10-22 halved from 0.38 to 0.19, halved again to 0.095, doubled back to 0.19, then cut ~25% to 0.12), whatever the deck size, so the height *is* the deck
  size. A 500-card stack is about 60 units tall and runs far off screen; the caller frames that by scrolling,
  not by fitting the stack (see [DECK_TOWER.md](./DECK_TOWER.md) § The scene). Until
  2026-10-17 the stack was capped at 11 units and its cards thinned to fit, which made
  big decks all look the same height.
- **Uniform seams.** Seams sit every `SEAM_SPACING_CARDS` (2.5) card thicknesses, ~5px apart,
  counted down from the top card (`seamHeights`), not under every card. At
  `CARD_THICKNESS` per-card seams would be ~2px apart: a 1px line under each would cover half
  the wall and shimmer as the platform bobs. Most seams therefore fall partway up a card, on
  purpose: on whole-card boundaries 2-in-5 could only alternate gaps of 2 and 3 cards, which
  was rejected on 2026-10-31 as non-uniform. (Every card was used briefly at 0.19 units. A ruler
  with one seam every 10 cards was tried and rejected on 2026-10-22: the wall read as
  blocks. Every other card (~4px) ran until 2026-10-31; every third (~6px) was tried that day and dropped.) All of a stack's seams are drawn as ONE path, so the cost does not grow with the
  deck.
- **Seam anchoring.** The grid is fixed in world z and phased by the SETTLED count: seams
  sit at `count − 1 − n · SEAM_SPACING_CARDS` cards above the floor. So as the body grows the placed seams stay put and new ones appear on top,
  and the seam where the top card meets the body (always drawn, so the top card reads as a
  separate card) lands ON the grid. Phasing from the base instead could put the last
  grid seam just under it (40 cards at every-2 → 38 and 39), a doubled line at the tower's top. A
  grid seam within a quarter card of the moving top seam is dropped during the build-up, so
  the arriving card never shows a doubled line. The top card's own upper edge gets no seam.
  `IsoCardRuns` phases by `plan.remaining`, so its landed runs match the settled stack.

`progress` (0 → 1) grows the body upward and counts up the printed figure. `figure`
overrides the printed figure (shown as-is): a stack dropping onto another names the total
it makes.

`count` 0 draws nothing: the floor under it carries an `IsoCardImprint` (below).

### IsoPaperStack

`src/features/deckTower/iso/IsoPaperStack.tsx` → `IsoPaperStack`, `PAPER_SHEET_THICKNESS`;
palette `ISO.paper`, `paperSeam`, `paperRule`, `paperMargin`.

`{ rect, sheets, surface, progress? }`. A stack of notebook paper: IsoCardStack's construction at
paper scale. It is ONE body solid in `ISO.paper` (white top, walls shaded off white like the
clouds'), never a solid per sheet, with the hairline rounded edge (§ The rounded edge). Its sheets are suggested by a seam every 5 sheets, drawn
as one path. Every sheet is `PAPER_SHEET_THICKNESS` (0.06 units, ~1px), so the height is the
count. The top face is printed as ruled paper: sky-blue rules (`bluMk`) run along world x
(the page's head is its low-y edge, like IsoCard's), and a red margin line (`redMk`) runs
down its low-x side. The rule ends are projected straight onto the face, because both are
straight in world space. There is no figure or band. It casts its own `IsoShadow`.
`progress` (0 → 1) builds it up like IsoCardStack's: the top sheet is always drawn and
rides up as the sheets under it grow in (`paperStackHeight(sheets, progress)`, exported so
a scene's fog / rain stand-ins match). Its shadow is classed `iso-paper-stack__shadow`, so a
scene can hide it alongside `iso-card-stack__shadow`. `sheets` 0 draws nothing. Its user is
the Deck Tower's notebook stack (DECK_TOWER.md
§ The notebook stack).

### IsoSortPlatform

`src/features/deckTower/iso/IsoSortPlatform.tsx` → `IsoSortPlatform`;
`sortPlatformMetrics.ts` → `sortPlatformTopZ`, `SORT_PLATFORM_JUMP`, `HOP_PERIOD_MS`,
`MINI_RIM`. acp's four band-coloured bins (SortBins.tsx → `BIN_CELLS`;
SORT_CARDS_REQUIREMENTS.md § 5.3) in miniature, as one slab.

`{ rect, surface, shadowReceiver?, quadrantColors, thickness?, buriedTo?, progress?, hopping?, paused?, snow? }`.
`thickness` (default `SLAB_THICKNESS`) deepens the slab — the Deck Tower passes the floor
snow's depth on a snowy floor, so its top lies flush with the snow's. `buriedTo` (the snow
surface's z) clips the slab to above the snow line in the scene's frame (a clip outside
the hop: the band the walls fill at rest, grown by `BURIED_EDGE_GROW` so no anti-aliased
edge survives), and draws the top face again unclipped; so at rest no wall shows, and
while it hops the part lifted out of the snow does.
A thin slab (0.28 units) lying flat on `surface` — standing up from it like any object on a
floor, unlike IsoPlatform, whose top is pinned at z = 0 — with IsoPlatform's light rim
bevel at this scale (`platformTone`). Its four quadrants are each in one band's colour,
`quadrantColors` in acp's bin order (Unfamiliar, Target, Comfortable, Mastered), placed to
keep acp's S-piece neighbours: Unfamiliar left on screen, Target at the front, Comfortable
right, Mastered at the back (`QUADRANT_CELLS`). Each quadrant is the whole slab drawn in its
tone, clipped to its quarter's COLUMN (the screen hull of the vertical prism over the
quarter, open past the slab on its outer sides), painted back to front (`backToFront`): the
front column wins where two overlap, so the walls and top split exactly along the quarter
lines while the slab keeps its one rounded outline. A column reaches `SEAM_OVERLAP` past a
quarter line under a neighbour painted after it, so no hairline shows at the seams. `snow`
is one `IsoSnowCap` over the whole top (all four colours hidden), inside the hop. It casts a standing object's `IsoShadow` (with `casterHeight`), classed
`iso-sort-platform__shadow`. It is drawn in world z, never by a screen-y translate, so it
stays right under a moving camera. `progress` (0 → 1) grows the slab up out of the surface.
`hopping` plays one big jump (`SORT_PLATFORM_JUMP`, 1.6 units) with rebounds at 0.28 and
0.08 of it, all in the first 1 s of every `HOP_PERIOD_MS` (2 s), with ballistic quadratic
easing and each flight timed by the square root of its height. Only the body hops; its
shadow stays on the surface and shrinks and fades in step. `paused` freezes the hop. No hop
under reduced motion. Its user is the Deck Tower's sort platform (DECK_TOWER.md § The sort
platform).

### IsoCardImprint

`{ rect, surface }`. The imprint a card stack leaves on its floor, printed "0" / "cards". A
floor decal (like `IsoFloorLabel`): the card rect flat at the floor's height (`flatPath`),
in the floor's tone one shadow step down, its print one step darker again (`shadowTone`
twice). It is NOT a shadow — nothing casts it — so it does not slide along the light and is
not drawn with `IsoShadow`; it sits exactly under the bottom card. It uses a card face's
figure-over-caption layout, but the caption is 1.3 units (a card face's is 0.8), because
here it is the whole message.

The caller draws it under the stack whenever the deck's count is known, not only for an
empty deck (the Deck Tower hides it only while the count loads): the stack
covers it, and anything that clears the floor (a collapse to 0, the trap door's fall, an
empty deck) reveals it already in place. Code: `IsoCardImprint.tsx` → `IsoCardImprint`;
used by `DeckTowerPlatform.tsx` → `DeckTowerPlatform` (`decals`).

### IsoFloorPrint

`{ at, lines, surface, fontSize?, lineHeight?, letterSpacing?, opacity?, color?, maxX?, align?, run?, anchor?, tail? }`.
A few short lines of text printed flat into a floor, with no plate: in `color` (the
caller washes it) or by default the floor's tone two shadow steps down (`shadowTone` twice
— `IsoCardImprint`'s print ink), bold, letter-spaced via `IsoSpacedText`. Lines read along
`run`: world x (default, stacking along +y) or world −y (`"-y"`, a quarter-turn on the floor
— up-right on screen, stacking along +x, a glyph's "up" toward −x). `anchor` says what `at`
marks along the run: the block's centre (default) or its end (`"end"`); across the run the
block is always centred on `at`. `tail` (flush-right only) hangs a mark — e.g. an arrow — a
word-space past the last line's end, outside the alignment, so the lines' own last letters
set the edge; with `anchor="end"`, `at` marks the tail's tip (measured after layout). `maxX` (`run="x"` only) slides the block left so its
widest line (measured with `getBBox` after layout, once per text/size and per web-font
load — `useFontLoadEpoch`, `src/hooks/useFontLoadEpoch.ts`, shared with IsoSpacedText) ends there. `align` sets each line
within the block: `"center"` (default) or `"right"` (`textAnchor="end"` on the block's
end, so shorter lines end flush with the widest).
Not raised, not a shadow, `aria-hidden` and `pointer-events: none` (it labels something;
it is not the button). No wrapping: the caller keeps lines short. Code: `IsoFloorPrint.tsx`
→ `IsoFloorPrint`; used by `DeckTowerPlatform.tsx` → `DeckTowerPlatform` (`decals`, the
corner fixtures' si labels — [DECK_TOWER.md](./DECK_TOWER.md) § Corner fixture labels).

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
  in `IsoCardStack` (by landed position, phased by `plan.remaining`, so they match the settled
  stack once the runs land), plus one at each piece's own base above the floor and one under the lid; one seam
  path per piece.
- **Floor shadow.** Cast by the bottom card. When that card is a ghost the shadow fades with
  its chunk (the runs above are left floating) and comes back as the lowest run lands:
  `shadowLandTiming(landAt)` fades it in over `SHADOW_LAND_MS` (120) starting on the impact,
  never before. A floor-height shadow lies almost wholly under the stack (only its contact
  sliver shows), so drawn any earlier it is just a dark patch over the floor's "0 cards"
  imprint. When nothing is kept it stays gone. The Deck Tower's drop onto an empty floor uses the same timing.
- **Ghost wireframes.** A ghost goes in two stages. Under each chunk's solid sits a light
  wireframe (`ISO.ghostWire` at `WIRE_OPACITY` 0.6): the chunk's top and bottom outlines and
  one at each drawn seam inside it (every 2.5 cards, not every card — at `CARD_THICKNESS` those would merge
  into a white slab), back edges included, plus the chunk's silhouette. It does not lift with the ghost, so as the solid
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

Depended on by the Deck Tower's tower shrinks (the focus lever's focus-on,
[DECK_TOWER.md](./DECK_TOWER.md) § Tower resizes).

### IsoFloorLabel

`{ rect, surface, text, fontSize?, bandColor?, shaded?, raised?, wallSteps? }`. A name plate printed flat on a floor: a
rounded rect (`bandColor`, default `ISO.cardBand`) with ink text, the same treatment as a
card's head band. Plate and text are drawn in world units inside one `faceTransform` at the
plate's top. The text is an `IsoSpacedText` (spacing 0.06), not a bare `letterSpacing` `<text>` — see § IsoSpacedText. Text runs along +x. By default (`raised` 0) it is part of its surface like a carpet: zero height,
no shadow, and pawns walk over it (it is not a `PawnRoam` obstacle).

`raised` (0 → 1, briefly above 1 on a spring overshoot) stands the plate up as a thin slab
of `RAISED_HEIGHT` (0.25 units, ~5 px at the Deck Tower's scale) so it reads as a button:
an `IsoSolid` whose walls are the band shaded by the platform's own steps (`plateMaterial`, built on palette.ts → `bandMaterial`:
`shadeHex` 0.07 / 0.15 — the same flagged wall-tone divergence as the rest of the palette;
`wallSteps` `{ left, right }` overrides the two steps for a band whose default walls read too
faint — the Deck Tower's yellow Learning plate, `towerDecks.ts` → `TOWER_DECKS` `plateWallSteps`
0.25 / 0.36, because a full-saturation yellow barely changes brightness at the default steps),
the hairline rounded edge (§ The rounded edge; the plate's face is drawn as the slab's child so the rim light lands over it),
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

### IsoSpacedText

*Code: `src/features/deckTower/iso/IsoSpacedText.tsx` → `IsoSpacedText`. Used by `IsoFloorLabel` (the plate text), `IsoCard` (the head-band label) and `IsoFloorPrint` (the floor prints).*

`{ children: string, letterSpacing, ...<text> props }`. A centred (`textAnchor="middle"`), letter-spaced SVG `<text>`. Use it
instead of a bare `letterSpacing` + `textAnchor="middle"` `<text>`: WebKit (iOS Safari) anchors on the run's UNSPACED width
and then adds the spacing, so the word slides toward its end by about half its total spacing (~8 px on the Deck Tower's
plate), while Chrome centres it.

- **How.** It measures the natural glyph width with `getComputedTextLength` and draws the text with
  `textLength = natural + letterSpacing × (glyphs − 1)` and `lengthAdjust="spacing"`. Every engine anchors on an explicit
  `textLength`, and `spacing` spreads the extra length evenly between glyphs, so it looks the same as `letterSpacing`.
- **When it measures.** Once per measure key (text, `fontSize`, `fontWeight`, font-load epoch), in a layout effect. A
  render with no measurement for its key draws the bare text; the effect measures and re-renders before paint. Per-frame
  re-renders (the plate's press spring) keep the key and do no work.
- **Fonts.** The epoch bumps on `document.fonts.ready` and on every `loadingdone`, so a measurement taken against a
  fallback face is retaken when Noto Sans SC (or a `--cjk-font` override) arrives.
- **No layout** (measure is 0 or throws, e.g. jsdom): falls back to plain `letterSpacing`.
- **Vertical centring.** `y` is the line's visual centre; callers pass no `dominantBaseline` (the prop is omitted from
  the type). It keeps the alphabetic baseline and shifts down by the kit-wide `INK_CENTRE_DY` (0.34 em, from
  `IsoText.tsx`), so the ink centres on `y` in every engine. Why `central` is banned, and how the value was measured:
  [Text in the iso kit](#text-in-the-iso-kit).

### IsoHatch

*Code: `src/features/deckTower/iso/IsoHatch.tsx`, `iso/hatchGeometry.ts` (`hatchFootprint`).
Used by `IsoLever`; animated by the Deck Tower's `usePopUpMotion`.*

`{ at, w, d?, surface, sink, hatch, sinkDepth, shadowFootprint, air?, className?, children }`.
A rectangular (`w` across x by `d` along y; square when `d` is omitted) trapdoor in a floor that a fixture rises out of and sinks back into. It draws the
hatch and frames the fixture; the fixture's body is `children(standZ)`, drawn standing at
world z `standZ` (the lift's top). The hatch is two trapdoor flaps hinged on the hole's two x
edges plus a **lift**, a floor-coloured slab (palette.ts → `floorSlabMaterial`) filling the
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
swept up the screen (`hatchGeometry.ts` → `openingSweepPath`); the flaps by the opening itself (a hanging near flap is hidden under the
floor's front edge). Standing, the fixture is unclipped, so one that overhangs the hole's
column must pull itself in while it passes through (IsoLever stands its stick upright).
Scenes may target `iso-hatch__hole`, `__flap`, `__lift-top` and `__shadow` (the Deck Tower
hides them on a fixture falling away with its floor). `inside` (a `Material`, optional) is the
body under the floor — the Deck Tower passes its world's `platform.material` (through IsoLever
`inside`) — and lines the hole: the open hole is palette.ts → `holeTone` (that body's darker,
right wall tone — the hole's far walls face the viewer as the slab's outer walls do), and the
lift's walls are `floorSlabMaterial` (the floor's colour on top, the body's walls). Without
`inside` both fall back to the floor colour stepped down 0.1 / 0.18 (`insideMaterial`).

### IsoLever

*Code: `src/features/deckTower/iso/IsoLever.tsx`, `iso/hatchGeometry.ts` (`leverFootprint`,
`LEVER_HOLE`). Used by the Deck Tower's focus lever ([FOCUS_MODE.md](./FOCUS_MODE.md) § 5).*

`{ at, surface, pull, sink, hatch, air? }`. A floor lever standing in an `IsoHatch` (1.0-unit
opening). A cream base box (`ISO.leverBase`, card stock's tones) with a dark pivot slot on its
top, a short, thick ink stick pivoting there in the world x–z plane, and a plain red ball
(`ISO.leverKnob` = `redMk` by default, flat, no outline or highlight; the optional `knob` prop recolours it — the Deck Tower passes `towerWorlds.ts` → `TowerWorld.leverKnob`, currently the default red in every world). `pull` is 0 leaning back toward −x
and 1 pulled toward the viewer (may overshoot); `sink`, `hatch` and `air` are the hatch's.
Standing, the leaning ball overhangs the hole's column, so the stick stands upright from a
third of the way down and a sinking or rising ball stays inside the clip. Its footprint is an
obstacle among the standing things.

⚠️ `ISO.leverBase.right` is derived with `shadeHex`, the same flagged divergence as the card
stock's right wall.

### IsoSmokePuff

`{ rect, z, side, delayMs? }`. The dust where something heavy lands: `PUFF_COUNT` (14) round
white (`ISO.smoke`) puffs spaced evenly by arc length round the lander's footprint at height
`z`, each swelling, drifting `PUFF_REACH` out and `PUFF_RISE` up, and fading over `PUFF_MS`
(700). Drawn twice — `side="behind"` before the lander (the footprint's back half) and
`side="front"` after it. Flat discs with no walls: a puff is gone in under a second and the
cartoon wants soft round shapes. CSS-animated from mount after `delayMs`, so mount it ahead
of the landing. Hidden under reduced motion.

### IsoPawn

`{ at, surface, startled?, roam?, startledBy?, floorDrop?, onDepthRankChange?, decals?, entrance?, steps?, tappable?, floorSpot?, shockId?, crispy?, castsShadow?, stretch? }`. `castsShadow={false}` drops its floor shadow (the flp hint pawn, whose shadow clashed with its tiny slab; the motion refs stay mounted, empty). A featureless ink
worker: a pill body and a ball head — a 3D capsule and sphere projected through the scene's
camera (§ "View") — standing at a world point. Its shadow is a round world footprint cast through `IsoShadow`, like every other shadow.

**Shadow on decals.** `decals` are flat things on its floor that its shadow can cross, passed
already in their shaded tones (e.g. `<IsoFloorLabel shaded … />`, or an `IsoFloorPrint` with
`color={shadowTone(ink)}`). Every decal a shadow can cross must be passed, or the opaque
shadow paints over it (DeckTowerPlatform → `floorDecalsShaded`: the si fixture print + the
deck plate). The pawn draws them over its
shadow, clipped to the shadow's outline, inside `travel` (so the clip moves with the shadow) under a
`decal-anchor` group that `usePawnMotion` counter-translates (so the decals stay put). The clip
outline shrinks and the copy fades in step with `shadow-hop`.

**How it moves.** All movement is `usePawnMotion.ts` → `usePawnMotion`, a
requestAnimationFrame state machine that advances the pose (position, lift, `hop`, `lean`,
squash `sx`/`sy`) and hands it to `applyFrame`, which writes straight onto the SVG through
refs: `presence` (hidden before an entrance), `travel` (slides the shadow, drawn once at
`at`), `shadow-hop`, `decalShade` / `decalClip` / `decalAnchor` for the shaded decals, the
body's path and head's circle (§ "View"), and `emoteAnchor`. The shadow slide is a
projected floor delta, which is the same as redrawing the flat shadow there. React state
changes only when an emote fires or the depth rank changes, so a walking pawn does not
re-render the page. `applyFrame` also runs in a layout effect after every render, so the
first paint, a re-render with a new camera, and `prefers-reduced-motion` (when no loop
runs and the pawn stands at `at`) all draw the current frame at once. **Idle frames write
nothing:** the loop keeps running, but `applyFrame` skips a frame whose inputs (projector,
surface z, opening clip, position, lift and pose) match what it last drew (`drawn` ref in
`usePawnMotion.ts`). Any write into the scene svg repaints the whole svg (svg children get
no compositor layers of their own), so a pawn standing in a pause used to repaint the
tower 60 times a second. The layout-effect draw is always forced, because a render can
mount a node (the "!" bubble's anchor) that has not been placed yet.

**View.** The body is a true 3D figure (`iso/pawnFigure.ts` → `pawnFigure`): a vertical
capsule (the pill) under a sphere (the head), each sphere's outline a circle round its
projected centre at `radius · facingScaleAt`, the capsule the hull of its two end circles
(`circleHullPath`). It is recomputed from the feet's world point and the pose every frame,
so it is right under any camera: under the fixed view it is the same width as the old (heights 5% shorter, `Projector.heightUnit`)
screen-space pill (0.78 × 1.5 `unit`s, the head 0.44 `unit`s across its radius, `lean` the
same screen rotation about the feet; pinned by `__tests__/pawnFigure.test.ts`), and seen
from straight above — the Deck Tower's study camera — it is a round head with the body
peeking out on the side away from the view's centre, small far below the camera. Lean
tilts the axis toward world (1, −1), the fixed view's screen-right; squash scales the
axis by `sy` and the radii by `sx` (the head by √(sx·sy)) — circles where the old 2D scale
made ellipses, which the brief squashes hide. The head is drawn after the body (it is the
nearer part to any camera looking down). The "!" bubble is a billboard: upright on screen,
its tail just over the head, sized by the head's `facingScaleAt`; it follows the startle's
look-up lean but not the waddle or squash. The shadow, a true projection at `at`, rescales
by `scaleAt(here) / scaleAt(at)`. The loop reads the projector through a ref, so a camera
moving every frame neither restarts it nor resets the walk (the Deck Tower's pawn keeps
wandering through a study).

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

- **Pause** for 0.9–3.3 s. The first pause after mount is a longer opening hold of 3.5–6 s
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
undoes the whole slide, so the decals stay put). On the same step the lift tracks the live
height exactly, so a pawn on a pressed plate sinks with it and rides its spring back up.
- **Edge hop.** A walk HOPS on and off a step, from a standstill, rather than ramping
  (`usePawnMotion.ts` → the `edgeHop` mode, `EdgeHopMode`). Each frame the walk looks `HOP_LEAD`
  ahead (about the body's half width, clamped to the walk's end so a walk that stops short
  never hops); when that point is over a surface whose height differs from the current lift
  by at least `HOP_MIN_RISE`, it stops there and hops in three phases:
  1. **Prepare** (`HOP_PREP_MS`) — the walk's bounce and waddle die out over `HOP_STOP_MS`
     (feet down, upright), then it crouches to `HOP_CROUCH`, deepest at take-off.
  2. **Air** (`HOP_MS`) — it covers up to `2 · HOP_LEAD` (less if the walk ends sooner or the
     far side of a narrow step would be overshot) in a `HOP_ARC` parabola, stretched like the
     startle leap. `lift` (body + shadow) glides from the take-off height to the landing
     surface's live height; the arc rides on top in `hop` (body only — the shadow shrinks).
  3. **Recover** (`HOP_RECOVER_MS`) — on touch-down the landing surface is committed, a
     `HOP_LAND_SQUASH` squash eases out over `HOP_SQUASH_MS`, and it stands the rest of the
     beat before walking on to the same target from feet-down (or pausing, if the hop carried
     it to the walk's end).
  A plate pressed flush (rise under `HOP_MIN_RISE`) is walked over without a hop.
- **Fallback ease.** Any other edge crossing — a startle leap landing on the step, an entrance,
  a hop cut short by a startle (the startle effect hands the lift over mid-glide) — eases the
  lift over `STEP_MS` instead.
- **Feet physics.** On top of `lift` (the surface, carrying the shadow) the feet have their own
  height and vertical speed (`feetZ`, `feetV`) under `GRAVITY` — the pawn's own cartoon
  gravity, 110 u/s² (`pawnEntrances.ts` → `PAWN_GRAVITY`; the sky-fall entrance uses a gentler
  60, `SKY_FALL_GRAVITY`, and the scene's falling towers use 130–140) — so the pawn reacts to its step
  moving under it (the Deck Tower plate being pressed and released, docs/DECK_TOWER_TRANSITIONS.md
  § "The plate button"):
  - **Pressed** — the plate's ease-out sink drops away faster than gravity can follow at
    first, so the pawn FALLS onto it (~67 ms for the full 0.25-unit press) instead of
    snapping down with it, landing in a small bounce.
  - **Released** — a step that sank under the feet (`launchArmed`) and then rises into them
    launches them at `PLATE_LAUNCH_SPEED` (derived from `PLATE_LAUNCH_APEX` = 2.4 units, the
    pawn's own full height): they ride the plate up (no gravity while it is still pushing
    faster than that — in practice they leave it at once, the launch being ~23 u/s), peak
    `PLATE_LAUNCH_APEX_MS` (~209 ms) after the release, and — when the floor is still there —
    land in shrinking bounces (`BOUNCE_RESTITUTION`: ~0.5 then ~0.1 units, settling under
    `BOUNCE_MIN_SPEED`). The Deck Tower's swap holds its trap door at least
    `PLATE_LAUNCH_APEX_MS`, so in practice the floor drops away while the pawn is coming back
    down (**Floor drop** below). On a quick tap the plate rises while the pawn is still
    falling; the launch fires when they meet.
  - Each impact squashes (`IMPACT_SQUASH_PER_SPEED`, capped at `IMPACT_SQUASH_MAX`, over
    `IMPACT_MS`). While airborne this way the pawn does not step-bounce, waddle, start a walk or
    start an edge hop; the flight is added to a startle's arc. An entrance or an edge hop places
    the body itself, so during those the feet simply stand on the surface.

Heights are read from a latest-value ref, so passing a fresh array every render does not
restart the loop. Known gap: a pawn standing on the floor just BEHIND a raised step is still
drawn over it (steps are decals, outside the depth sort), so the step never hides its feet.

**Floor drop.** `floorDrop` (world units, read live from a latest-value ref) is how far the
pawn's floor itself has fallen away — the Deck Tower's trap door. Above 0 the pawn has no
surface and falls ON ITS OWN, so its wrapper must NOT also be translated by the drop
(`usePawnMotion.ts` → FLOOR DROP, the `fall` state): its feet fly free under `GRAVITY`; once
they are no longer rising (a plate launch reaches its apex first) the fall starts, its `!`
bubble pops (the startle's bubble alone: emote `leanSign: 0`, no lean, no leap), and its
height blends over `FALL_BLEND_MS` from that free fall into `lift − floorDrop` (where it would
be standing on the falling floor — a launched pawn catches up rather than trailing by its
launch height), so it falls out of the air and then keeps pace with the floor. Mid edge hop
it falls from where the arc had it (walking on, legs still); mid entrance it ignores the drop. Below its surface
the shadow does not grow (`air` is clamped at 0) — the page fades it out instead.

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

**Poke.** With `tappable`, a tap on the figure calls `usePawnMotion` → `poke`: the "!" bubble
pops and the feet are thrown straight up (`POKE_JUMP_HEIGHT`, 2.6 units) through the feet
physics, so the jump lands in the plate launch's shrinking bounces. Taps count in the air
too: each re-throws the feet from where they are, so quick taps climb with no ceiling, and
gravity brings the pawn back down once they stop. A mid-air re-throw leaves no mark (a
kick-off ring was tried and removed 2026-11-09 as too loud). A page can pick the reaction instead
(`onTap`, below). A walk stops where it is, and the pawn
stands until the bubble has gone (`EMOTE_MS`), then wanders on. A startle keeps its
timeline, with the jump on top of it. A tap is ignored during an entrance or an edge hop
(no feet physics runs there), while the floor is dropping, and under
`prefers-reduced-motion`. The tap target is an invisible circle
(`iso-pawn__hit`, `PAWN_HIT_RADIUS`) that `applyFrame` keeps centred on the figure, because
the body alone is only a few px wide. Code: `iso/IsoPawn.tsx`, `iso/usePawnMotion.ts`.

**Tap reaction.** With `onTap` (`(tap: { airborne }) => "jump" | "flinch"`), the page picks
each tap's reaction, and the poke pops **no** "!" (the page answers in its own way: the flp
hint pawn's "ouch" bubble, docs/HINT_PAWN.md § "Tap reactions"). `"flinch"` is the `flinch`
mode: a 420 ms recoil on the spot, pressed down and tipped back away from the viewer, springing
back with one small rebound (`pawnIdles.ts` → `flinchPose`, `FLINCH_MS`). A tap while the feet
are in the air always jumps, whatever `onTap` returns, so jumps still chain. Without `onTap`
every tap is the jump with the "!" (the Deck Tower's pawns). Code: `usePawnMotion.ts` →
`poke`, `onTap`; `IsoPawn.tsx` → `onTap`.

**Idles and the flinch.** Each new `idle` cue (`PawnIdleCue` = `{ id, kind, at }`) plays an
idle animation, the `idle` mode. Its pose is a pure curve (`pawnIdles.ts` → `idlePose`) of
`lean`, `arch`, `reach` and `squash`, which map to the figure as the back stretch's do. The
bend runs in the plane of the pawn's facing, plus the curve's `bendHeadingOffset`. Like a
stretch cue, it starts only from a standstill; a stretch due at the same time goes first.

| Kind | Shape | Pose | Marks (`PawnIdleProps.tsx`) |
|---|---|---|---|
| `sneeze` | one-shot, `SNEEZE_MS` 1.6 s | two inhales, the head going back further each time, a quiver, then a fast snap forward — the spine folding (`arch` +22°) and the whole body tipping with it (`lean` +9°) — with a squash (`SNEEZE_SNAP_MS`), and a recovery | three white discs burst out in front of the face on the snap |
| `sing` | one-shot, `SING_MS` 4.2 s | head tipped back (`arch` −8°), swaying side to side, breathing on the beat. The sway swings the head-back bend's DIRECTION ±70° round the facing, because a pose has one bend plane | ♪ / ♫ notes on white discs float up and right, swaying, one every 0.5 s |
| `doze` | lasting | the head droops forward (`arch` +13°) and the body sags, then slow sleeping breaths | big ink "Z"s (no disc, free-floating) drift up off the head, each bigger than the last — one every `DOZE_Z_GAP_MS` (2 s), each drifting for 3 s |
| `knit` | lasting | looking down (`arch` +7°), the head bobbing on each needle click (`KNIT_CLICK_MS`) | two white needles crossing and clicking in front of the chest, a scarf (`ISO.yarn`, ribbed in a shade of it) growing from nothing for as long as it knits (`SCARF_RATE`, a long strip sliding out of a clip at the needles), down past the slab and off the bottom of the screen, a yarn ball on the floor screen-left of the feet with its strand up to the work |

- A one-shot cue still waiting `IDLE_STALE_MS` (3 s) after `at` is dropped; a lasting one waits.
- A **lasting** idle holds until the cue is withdrawn (null) or replaced, then eases back to
  rest over `IDLE_EXIT_MS` (380 ms; `idlePose`'s `endingFor`). A replacement then starts once
  the pawn stands again.
- A **tap** ends any idle at once (`startedIdleId` keeps a still-set cue from replaying).
- **Marks.** `usePawnMotion` mirrors what plays to React (`activeIdle` = `{ id, kind, ending }`,
  set on a change only, never per frame). IsoPawn mounts `PawnIdleProps` (keyed by id, so its
  CSS restarts) inside the head anchor, in `EMOTE_DRAW_SCALE` units, and fades it out while
  `ending`. The notes are ink glyphs on white discs, the "!" bubble's family; the doze Z's are bare, larger ink glyphs. The
  anchor follows the **bent** head during the idle (`pose.marksFollowHead`), so the marks come
  off a drooping or tipped-back head. The exception is knitting: its yarn ball sits on the
  floor and must not slide as the head bobs. The "!" never follows the bend. Reaching the chest
  and the floor from the head converts world heights through the projector
  (`heightUnit / facingScaleAt`). This is exact under the fixed view and approximate under a
  moving camera.
- Reduced motion: no idle, no flinch, no marks.
- Code: `iso/pawnIdles.ts`, `iso/PawnIdleProps.tsx`, `iso/usePawnMotion.ts` → the `idle` /
  `flinch` modes, `pendingIdle`; `iso/IsoPawn.tsx` → `idle`. The flp hint pawn schedules them
  (docs/HINT_PAWN.md § "Idle animations"); the Deck Tower's pawns have none.

**Back stretch.** Each new `stretch` cue (`PawnStretchCue` = `{ id, at }`) plays a stretch
starting at `at`: a little crouch, then the pawn draws itself up tall and thin
(`STRETCH_REACH`) while **curving its back** away from the way it faces (IsoPawn `facing`)
— the spine bends
`STRETCH_ARCH_DEG` (−15°) from hips to shoulders over a small whole-body lean
(`STRETCH_LEAN_DEG`, −3°) — holds the reach with a slight quiver of the arch, and lets go
into a soft settling squash — `STRETCH_MS` (1.2 s) in
all. It starts only from a standstill (a `pause`): a cue arriving while the pawn is arriving,
walking or in the air waits, and is dropped `STRETCH_STALE_MS` after `at`. A poke rides on
top of it, as on a startle; reduced motion skips it. The flp's hint pawn cues one per new
speech bubble (docs/HINT_PAWN.md § "Back stretch"). Code: `iso/usePawnMotion.ts` → the
`stretch` mode, `STRETCH_*`; `iso/IsoPawn.tsx` → `stretch`.

The curve is the figure's `arch` (`iso/pawnFigure.ts` → `PawnPose.arch`,
`archedPawnFigure`): the axis's tilt turns from `lean` at the feet to `lean + arch` at the
body's top, gathered toward the top (`ARCH_PROFILE_POWER`), and the spine is traced by
integrating that direction. The body is drawn as a chain of `ARCH_SEGMENTS` short capsules
(`circleHullPath`) in ONE path — they all wind the same way, so the nonzero fill draws
their union as one smooth bent pill, under any camera. The head continues along the top's
direction. `arch` 0 (every other pose) takes the straight capsule's path unchanged.

The plane of the bend is `PawnPose.bendHeading` (`pawnFigure.ts` → `bendAxis`). It is
measured like the vest's facing: 0 is toward the camera, +90 is screen-right and 180 is
away. The default is 90, so every waddle, startle and hop leans in the picture plane as it
always has. The back stretch sets it to the pawn's `facing`, so its negative lean and arch
curl the back away from where the pawn faces. Under the fixed view a bend away from the
camera moves the head straight up the screen, so a pawn facing nearly forward stretches
mostly upward.

**Vest.** With `vest`, the pawn wears an open hi-viz safety vest (the flp's hint pawn
after dark, docs/HINT_PAWN.md § "Night vest"). `pawnFigure.ts` → `pawnVest` takes the same
`(proj, feet, pose)` as `pawnFigure`, plus `facingDeg` (IsoPawn `facing`: 0 faces the
camera, + turns the vest's front toward screen-right), and returns three paths:
- `vestPath`: the cloth, spine fractions `VEST_SPAN` of `BODY_HEIGHT`.
- `stripesPath`: two reflective stripes at `VEST_STRIPE_CENTRES`.
- `openingsPath`: the open front plus two arm holes.

usePawnMotion writes all three every frame, and only while they are mounted, so a pawn
without a vest computes nothing. IsoPawn draws them between the body and the head, inside a
clip made from a `<use>` of the body path. That way they follow each frame's rewrite of the
outline.
- **Cloth and stripes.** A band painted on a cylinder is bounded, as seen, by the **front
  arcs** of its two edge rings, so each band is the top ring's front arc left → right, then
  the bottom ring's back. The rings are horizontal circles round the spine point
  (`spinePoint`, which traces the arch the way `archedPawnFigure` does, via the shared
  `spineTilt`). They are `VEST_RING_OVERSHOOT` × the body's radius, so the arcs' ends run
  past the outline the clip trims to. "Front" means lower on screen, which holds for every
  camera this kit has, since each one looks down.
- **Openings,** filled with `ISO.ink`, which reads as cut out of the cloth. Both are
  patches of the body's SURFACE, placed by angle round it from the ring's front-most point
  (`frontAngle`, refined between samples; `screenRightSign` says which way round is
  screen-right). `surfacePoint` clamps an angle to the camera-facing half, so a patch that
  wraps round the side is flattened onto the outline (just past it, where the clip trims)
  and one wholly round the back vanishes:
  - **Open front** (`vestOpeningPath`): the strip within ±`VEST_OPENING_HALF_ANGLE` of the
    vest's facing. It is a slit at the hem easing out to a V at the neck.
  - **Arm holes** (`vestArmHolePath`): ovals ±`VEST_ARM_HOLE.halfAngle` round the body, a
    quarter turn either side of the facing. Facing the camera they are scoops out of the two
    sides of the outline. Turned, one comes onto the body's face and the other goes round
    the back. They sit on the capsule's straight sides (`VEST_ARM_HOLE`): above the top end
    sphere's centre the outline curves in, and a hole there would fall off the body.
- Colours: `ISO.vest` (`COLORS.hiViz`) and `ISO.vestStripe` (`COLORS.grey`), washed with the
  scene like the rest of the palette.

**Lightning.** `floorSpot` (a ref) is kept at the pawn's live ground point every frame, or
null while it is not on the floor (before its entrance, on the summit, falling). The Deck Tower
tests strikes against it. Each change of `shockId` (not its mount value) is a strike landing
on it. usePawnMotion's SHOCK freezes it for `SHOCK_MS` (1 s) plus a 0.9 s beat. Meanwhile
IsoPawn's CSS flickers the body and head ink ↔ white (`--iso-pawn-ink` / `--iso-pawn-flash`
override the fill attribute), jitters the figure and blinks four white zig-zag sparks. A
one-shot white puff goes up as the shock ends and is unmounted when done, like the "!"
bubble. With `crispy`, outside a shock, it smoulders: two thin white S-wisps of smoke rise
off its head in turn (3.4 s loop). A frizzled-hair crown was dropped on 2026-11-04. The
sparks and smoke ride the "!" bubble's head-following anchor, in its `EMOTE_DRAW_SCALE`
units. Under reduced motion none of it shows.

**Summit.** A step with `summit: { closed, held }` is a surface no walk reaches (the Deck
Tower's tower top). A poke while the feet are above it, and not in a startle, throws the pawn
onto a random spot there, `SUMMIT_LANDING_INSET` in from the edge (`startFlight`, the `flight` mode: the feet physics carries the
height, the ground position glides over the time they take to land). It wanders that step
(`walkRoam`), ranks in front of every obstacle, ignores startles, and its shadow swaps to a
see-through glaze of ink (`floorShadow` / `summitShadow`, IsoShadow `glaze`,
`SHADOW_GLAZE_OPACITY`), so the top card's print shows through it. The height is live, as on any step: a drop
leaves it to fall, and a rise of `SUMMIT_JOLT_RISE` in one frame throws it up. When `closed`
turns true it flies back to `at`; while `held` it finishes its step and stands still. Where it
stands is published (`summitSpot`, `onSummitChange`) so a caller can carry it away:
`IsoPawnStill` draws the same figure, feet at a world point, in another scene. Code: `iso/usePawnMotion.ts`, `iso/IsoPawn.tsx`.

**Depth sorting.** A wandering pawn can be in front of or behind the things it walks
around. An object is nearer the viewer than a box when it is past one of the box's faces
that the camera sees (`pointInFrontOfRect`, reading `Projector.seesHighSide`) — under the
fixed view, past its far edge on +x or +y. Under a moving camera the order changes: as the
Deck Tower's study camera tips over the tower to look straight down, the tower's walls stop
being seen one by one and its top comes to hide what stood in front of it. So
`roam.obstacles` are given back-to-front FOR THE FIXED VIEW, `backToFront(rects, proj)`
re-orders them for the camera (a footprint moves behind an earlier one only when that one
is unambiguously in front of it — two separated on both axes can test in front of each
other at once, can then never overlap on screen, and keep the listed order), and both the
caller's draw order of the obstacles (`DeckTowerPlatform`) and the pawn's rank (re-computed
every frame against `projRef`) read that same order. `depthRankAmong(point, rects, proj)`
returns the index of the FIRST rect the point stands behind (`rects.length` when it is in
front of all of them). It is deliberately not a count of the rects it is in front of: a
fixed back-to-front list is not a total order for every point (with the Deck Tower's lever at
the floor's back-right corner, where it once stood, a pawn on the tower's back-left was behind
the tower yet in front of the lever, and a count of 1 drew it over the tower). Any slot respecting the rects it is behind is right, since the ones it is
"wrongly" behind don't overlap it on screen. The pawn reports the slot through
`onDepthRankChange` when it changes, and the caller renders the pawn after that many
obstacles. Children must be keyed, so the reorder moves the pawn's DOM node instead of
remounting it and losing its motion state.

### IsoCloud

`{ drift }` (a `CloudDrift` from `useCloudDrifts`). A cloud drifting past the tower.

**Shape.** A cluster of low **pill** prisms (a rounded rect whose radius is half its short
side): a raised crown over two or three base lobes (`CLOUD_SHAPES` in
`useCloudDrifts.ts`). Each puff is an `IsoSolid` in `ISO.cloud`, so a cloud follows the
three-tone rule like every other solid. The shapes are authored long side along the drift
direction and turned to the path (`orientPuffs` swaps x ↔ y on a path along world y),
scaled 0.8–1.25, and sorted back-to-front by view depth: the fixed view's ray is
(1, 1, `VIEW_RAY_Z`), so a puff is nearer the larger the x + y + z · `VIEW_RAY_Z` of its centre.

**Motion.** Drawn once at its starting position and slid by its own requestAnimationFrame
loop (the projection is affine, so a projected world delta moves the drawing exactly). It fades in over `FADE_MS` (1.6 s). No
bob or wobble: a cloud only drifts. The start point, screen delta and loop live in
`cloudDriftMotion.ts` → `useDriftGeometry`, `useDriftMotion`, shared with the cloud's shadows.

**Shadow: `IsoCloudShadow` `{ drift, receiver, clip? }`.** The cloud's shadow on one
surface. The cloud cannot draw it itself, because its shadow falls on surfaces that sit
elsewhere in the draw order. It is the union of the puff footprints, each slid by the
cloud skew from its own underside height (`IsoShadow`'s `cloudPuffs` form, one path under
the nonzero fill rule, so overlapping puffs do not double-darken). It is painted as an ink
glaze at `SHADOW_GLAZE_OPACITY`, so floor print stays readable. Each shadow runs its own
`useDriftMotion` loop. They mount in the same commit as the cloud and read the same rAF
timestamp, so they move in lockstep with it. A bounded surface passes `clip` (its outline
at `receiver.z`), and the clip stays still while the shadow slides. The Deck Tower draws one
per cloud on the floor (clipped to the platform, the last floor decal) and one on the
ground (`IsoPlatform` `groundDecals`), from both sides of the tower: a back-side cloud's
floor shadow is hidden where the tower stands over it. Objects standing on the floor do not
receive cloud shade; they are drawn over it.

**Scheduling: `useCloudDrifts({ proj, active, sky, maxInSky })`.** `CloudSky` is a
`SkyRegion` whose `band` is the range of cloud **bases**, plus a `balloonBand` for the rare
red balloon (§ IsoBalloon).

- **Slots.** `maxInSky` slots (default 3). Waits between drifts are 4–14 s.
- **Paths.** The cloud's near edge is 1.5–4.5 units out from `around`: `planSidePath` gets
  the cloud's across-path extent as `depth`, so a back-side cloud never overlaps the
  tower. The margin is the cloud's own extent plus 0.5, so it starts and ends fully off
  screen. Speed is 0.4–0.8 units/s, about a minute per crossing.
- **Height.** Read from the clouds' altitude wander (§ Sky traffic), `ALTITUDE_WANDER`
  `{ knotMs: 20000, maxStep: 0.12 }`: slow, because a cloud is up for a minute or more and
  every cloud in the sky with it should sit at a close height.
- **No openers: every cloud traverses in.** Every moving drift starts off screen
  (`startT` 0); none appears mid-sky when the clouds switch on. Clouds are the cloudy
  weather (the commonest kind), so they arrive quietly: slot n's first drift waits a
  0–1.5 s lead-in (`FIRST_LEAD_IN_MS`) plus n ordinary 4–14 s gaps (`firstWaitMs`), so the band
  fills one cloud at a time. `IsoCloud`'s fade-in stays only as a safety net.
- **Sorting among clouds.** Overlapping clouds show their order.
  `sortCloudsBackToFront` orders them by the view depth of their path's midpoint.
  ⚠️ This is approximate: two clouds on perpendicular sides swap true order as they move,
  which a static sort cannot follow.
- **Reduced motion.** Clouds still show: a still cloud reads as a cloud. Nothing is
  scheduled. There is one cloud per slot, parked 15–75% of the way across (`PARKED_AT`, its
  `startT`), fully opaque.
- **Memoize `sky`.** A new object restarts every slot.
- **The red balloon.** Each planned drift (moving or parked) has a `BALLOON_CHANCE`
  (1 in 100) of being `kind: "balloon"` instead of a cloud (§ IsoBalloon).

### IsoBalloon

`{ drift }` (a `CloudDrift` of `kind: "balloon"`). The rare red balloon that drifts by in
place of a cloud. Code: `iso/IsoBalloon.tsx`; planned by `useCloudDrifts.ts` →
`planDrift` (`BALLOON_CHANCE`, `BALLOON_RADIUS`, `BALLOON_SHAPE`); drawn instead of
`IsoCloud` by `SkyTraffic.tsx` → `SkyTrafficLayer`.

- **Scheduling.** It is a cloud drift in every respect except its look and height: it takes
  a cloud slot, a side path, the cloud speed and the side draw-order rule, and is sorted
  with the clouds. So it flies only under the `cloudy` weather. Its height is a random pick
  in `sky.balloonBand` (the Deck Tower: cards 110–140, `BALLOON_BAND_CARDS`, just under the
  clouds), not the clouds' shared altitude wander. It is always one size (no scale).
- **One puff.** Its `puffs` is a single 2r cube on the drift origin (`BALLOON_SHAPE`), the
  body's bounding box. The path extent, the depth sort and `IsoCloudShadow` all read it
  unchanged, so it casts one round shadow under the same rules as a cloud.
- **Shape.** The body is a true round solid like the pawn's head (§ Rules, rule 1's
  exception). The outline is centred on the projected sphere centre, `BALLOON_RADIUS ·
  facingScaleAt` wide, and stretched `BODY_STRETCH` taller with its bottom fixed. It is
  kept as flat as the rest of the kit: the lit `ISO.balloon.top` (`redMk`) face over the
  body in its `left` tone (a `shadeHex` step: the flagged wall divergence), stepped toward
  the upper left (`LIT_FACE`) so one thin shade crescent shows on the lower right. No glint
  and no third tone (a stepped three-ring version with a glint, 2026-11-10, read as more
  depth than any other object). Below hang a shade-tone knot and a thin `ink` string with a
  lazy S, `STRING_LENGTH` (3) world units long. The string casts no shadow.
- **Motion.** The same as a cloud's (`cloudDriftMotion.ts`): no bob.
- **Tester spawn.** `useCloudDrifts`'s `balloonRequest`: each change of the number spawns one
  balloon now (`useForcedBalloons`), outside the slots and whatever `active` says, with ids
  from `FORCED_BALLOON_ID_BASE` so they never share a key with a slot drift. It flies in
  `sky.visibleBalloonBand`, which the Deck Tower brings down beside the tower when the tower
  on screen is shorter than the real band (`DeckTowerPage.tsx` → `visibleBalloonBand`), so a
  tap always shows one. Under reduced motion it parks partway across for `FORCED_PARKED_MS`
  (15 s). Driven by `BalloonSpawnChip` (DECK_TOWER.md § Feature-tester rows).

### IsoFog

`{ clouds, opacity, piercers? }` (`iso/IsoFog.tsx` → `IsoFog`, `IsoFogPiercer`), with its
field planned by `iso/fogClouds.ts` → `planFogClouds`, `FogCloud`, `FogUnit`, `FogBridge`,
`FogCover`, `FOG_LEVELS`. Fog clouds lie flat in the world XY plane and roll across the
**whole screen width** (the platform and the sky either side of it) the way clouds cross
the sky. Used by the Deck Tower's fog weather ([DECK_TOWER.md](./DECK_TOWER.md) § Weather).
`DeckTowerPage` plans the field per framing, and `DeckTowerPlatform` draws it as the last
layer on the floor, under the front sky travellers.

**A fog cloud (`shapeCloud`).** Each cloud is 2–4 fog **units** (`UNITS_PER_CLOUD`). A unit
is a skinny pill: 0.6–0.9 wide (`UNIT_WIDTH`, one width per cloud) and 5–12 long
(`UNIT_LENGTH`), with its long side along the travel. The units lie side by side across
world y, `UNIT_GAP` (0.3) apart, all at the cloud's height. They are **staggered**: each one
slides up to `STAGGER` (5) along x from the previous unit, so the silhouette steps rather
than scatters. Neighbouring units are **connected where they can be**: part of the gap
between them is filled by a flat `FogBridge`. A bridge keeps `BRIDGE_END_INSET` (1) unit
width clear of every unit's tip, so it never reaches a rounded cap. Inside that room its
length is random, from `MIN_BRIDGE_WIDTHS` (2) widths up to the whole room, at a random
spot; with less room than 2 widths the pair stays a notch. In a sample field about 70% of
gaps are bridged, a bridge filling about 70% of its room on average. The bridge runs centre
line to centre line, and each end is pinched in by two concave **fillets** of the units'
own radius (`bridgeEnd`): one circle sits just off each unit's side and touches it at the
bridge's end, and the two arcs curve inward to meet mid-gap (the gap is narrower than 2r,
so they meet at a slight crease). The outline is pre-sampled (`FILLET_STEPS` segments per
arc) in world offsets, so IsoFog only projects its points.

**The field (`planFogClouds(proj, floorZ, cover)`).** It is pure, and it is planned against
the **fixed** view, so the study camera re-projects the same clouds rather than re-planning
them (which would remount them and restart their loops). `cover` is a screen box in viewBox
units that the fog must fill. Every cloud travels along world +x (down-right on screen), so
the field is made of **lanes**: lines of constant world y that hold each cloud's centre
line, `LANE_SPACING` (1.2) apart and slightly jittered. Lanes take the three heights in turn
(`FOG_LEVELS`: 0.35, 1.0 and 1.9 over the floor, so the pawn wades through). A lane's y range
comes from inverting the affine projection at the box's corners, grown by a cloud's depth.
A lane runs only where any part of its cloud-deep band crosses the box, widened by the
lane's longest cloud plus `EDGE_MARGIN` at each end, so clouds enter and leave fully outside
the box. A lane gets one cloud per `CLOUD_PITCH` (17) units of its travel, with at least
one, spread evenly round its loop. Each lane moves at 0.06–0.1 units/s (`SPEED`), far slower
than the sky clouds (0.4–0.8), so the fog barely drifts; a crossing takes many minutes. A seeded PRNG keeps the field the same every time it is planned. On a phone
framing that comes to about 35 clouds (107 units), with about 40% of the box under fog at
any moment.

**Drawing.** Each cloud is two paths: its units (rounded rects, radius = half their width,
unioned by the nonzero fill) and its bridges (the projected outlines, kept in their own path
because their winding may oppose the units' and would cut holes in a shared one), in flat
`ISO.fog` (white) with no walls and no gradient. `opacity` is set once per height level, on
the level's group. The shapes composite first and the group then fades as a whole, so a
bridge over its units reads as one even silhouette with no darker seams. Clouds at
different heights do stack, so the fog reads thicker where they cross.

**Motion.** Each cloud crosses from `x0` to `x1` as one group. It fades in over the first
`FADE_SHARE` (12%) of the crossing and out over the last 12%, then loops, so there is no
scheduler. The motion is one linear CSS animation of the projected crossing vector per
cloud. That is exact because the projection is affine, and it needs no JS per frame. Each
cloud starts at its own `phase` (a negative animation-delay), so the screen is already
foggy when fog switches on. Under reduced motion each cloud is parked, fully opaque, at its
`phase`.

**Depth.** A flat layer at height h can't sit at one place in the painter's order against a
solid that rises through it. The layer veils the solid's base in front of it, but the solid
above h is nearer the camera than the fog behind it. So the fog is drawn **over** everything
on the floor, and each `piercer` (a footprint and its top z) is cut out of every height level
it rises **above**. An SVG mask on the level's group removes the screen hull of the
footprint's prism from the level's z to the piercer's top. The mask sits outside the moving
pills, so the cut-out stays on the tower as the fog rolls under it. A piercer whose top is
at or below a level is not cut, so a short tower sits wholly in the fog. Pawns are not
piercers because they move every frame. A pawn's head can pick up a faint veil from fog
behind it, which the owner accepted on 2026-11-04.

### IsoRain

`{ rect, floorZ, fall, solids?, ceilingY? }` (`iso/IsoRain.tsx`). Rain falling in front of
what stands on a platform and splashing on it. A scene's sky rain sits behind its svg, so
this layer draws only the drops whose column the platform or a solid would hide. Each drop
has a landing point on open floor or on a solid's top (`openFloor.ts` → `openFloorSpot`),
falls straight down the screen onto it, and splashes there with a flat iso ring and two
droplets. Flat `ISO.rain`, unwashed, at the sky rain's opacity. A few `<path>`s are
rewritten from one rAF loop, with sizes in CSS px converted every frame from the svg's
screen matrix. Only the visible column is simulated. Nothing is drawn under reduced motion.
The Deck Tower's use: [DECK_TOWER.md](./DECK_TOWER.md) § Weather.

### IsoSnow

`{ rect, floorZ, fall: IsoSnowFall, solids?, ceilingY? }` (`iso/IsoSnow.tsx`). IsoRain's
snow counterpart, with the same landing rule and on-screen-only simulation. Flakes sway
down, the sway easing out over the last 36 CSS px so each lands on its spot, then lie
there fading (0.9 s) instead of splashing. They are round-capped dots in two radius
buckets (small and large), plus the settled flakes, in flat unwashed `ISO.snow`. The flake
look comes in `fall` (the Deck Tower passes the sky's `SNOW_*`, `towerWeather.ts`). Nothing
is drawn under reduced motion. [TOWER_SNOW.md](./TOWER_SNOW.md) § Falling snow.

### Snow

Settled snow, drawn by each object itself (`iso/IsoSnowCap.tsx`, `iso/IsoSnowFloor.tsx`;
[TOWER_SNOW.md](./TOWER_SNOW.md)). A snowy object is handed a `SnowCover`: present means
snowy. While the snow is being brushed off, it carries `shed: { id, delayMs }`.

- **`IsoSnowShed`** wraps every cover. Lying, it just draws it. Shedding (keyed by the
  brush's id), after `delayMs`, the snow hops up, drops and fades over `SNOW_SHED_MS`,
  while eight flakes spray out from `burstAt`. Under reduced motion a shedding cover
  draws nothing.
- **`SnowSlab`** `{ rect, z, depth, className, trail?, channelFloorZ?, holes?, children? }`: the base of every
  flat cover. A slab of snow with thickness: an `IsoSolid` in `snowMaterial` (palette.ts:
  the washed `snow` on top, walls stepped 0.07 / 0.15 like the platform's), with the
  rounded edge. `trail` (a `SnowTrail`) ploughs the pawns' channel through it
  (`snowChannel.ts` → `useSnowChannel`), drawn over the slab and clipped to its top face:
  the channel's outline projected at the snow's top, in the lit wall tone, is the far wall,
  and the same outline at `channelFloorZ` (default the base; clipped to the top one) is the
  channel's floor of packed snow, in `shadowTone(snow)`. `holes` (world
  rounded rects) are dug clean through: a mask opens the snow where each hole's outline at
  the top and at the base overlap, so what was painted under the slab shows, and the rest
  of the top outline is the hole's far wall. `children` print on the top.
- **`IsoSnowCap`** `{ rect, z, cover, inset?, depth? }`: a `SnowSlab` of `SNOW_CAP_DEPTH`
  (0.3, ~6 px) on a rounded-rect top face. Used by `IsoSortPlatform` `snow` (inside the hop
  group) and `IsoPaperStack` `snow` (on the top sheet).
- **`IsoCardSnow`** `{ rect, z, cover }`: a card's snow, an `IsoSnowCap` over the whole
  top card (inset 0.03), hiding its print. Used by `IsoCardStack` `snow` (on the top card, riding the build-up) and the Deck Tower's
  `TowerCoverCard`.
- **`IsoBallSnow`** `{ cx, cy, r, cover }`: a dome standing proud of a ball's top, with a
  scalloped lower edge, in screen space. A lip under it (the outline dropped a little, in
  the snow's right-wall tone) gives it thickness. Used by `IsoLever` `snow` on the knob.
- **`IsoFloorSnow`** `{ rect, z, slide?, trail?, drift? }`: a `SnowSlab` of
  `FLOOR_SNOW_DEPTH` (0.4, ~8 px) over a platform's whole floor, out to
  its outer edge (rim bevel buried; the snow's walls stand flush on the platform's). It is passed as a floor decal, so it swings with a trap door, and
  whatever decal is drawn before it lies buried under it. `slide` 0 → 1 slides it toward
  the door's free edge (+x, accelerating) and fades it. `drift` `{ rect, rise, cover? }` is the
  snow over something raised buried under it (the Deck Tower's plate): lying, a slab `rise`
  tall on the sheet's top, ploughing the same `trail` down to the region's top
  (`channelFloorZ`); shedding, a hole through the sheet with the drift and the sheet
  under it playing the brush-off over it (`IsoSnowShed`); with no cover, just the hole.
- **`IsoSnowSkirt`** `{ rect, z, height, shadow?, casterHeight? }`: the floor's snow banked
  round the base of an object standing in it, drawn right after the object. It paints the
  prism's walls from `z` up to `z + min(FLOOR_SNOW_DEPTH, height)` (hull minus top face,
  even-odd) in the snow's top tone: the snow lying in front of those walls. With `shadow`,
  an object taller than the snow gets the part of its shadow (cast on the snow's top) that
  falls inside the band painted again over it, clipped to it.
- **The channel** (`snowChannel.ts`). Recording and drawing are split by the store:
  `useSnowTrailRecorder(trail, walkers, enabled)` runs one rAF loop that reads each
  walker's point ref (`SnowWalker`; IsoPawn `floorSpot`, or the Deck Tower's `summitSpot`
  for the tower's top) and extends that walker's run every 0.08 units of travel; a walker
  whose ref is null, or that is airborne (`SnowWalker` `airborne`, IsoPawn / usePawnMotion
  `airborne`: feet physics above `AIRBORNE_MIN`, a flight, an edge hop), ends its run. It notifies the store's `listeners` at most every
  `REDRAW_MS` (100 ms). Each `SnowSlab` with that `trail` subscribes (`useSnowChannel`)
  and rewrites its own three paths — so the floor's sheet, a drift and a cap plough by
  the same code. Each run is offset to both sides by the
  pawn's body radius (`pawnFigure.ts` → `PAWN_BODY_RADIUS`), with round ends, broken at
  every sharp turn (one whose inner offset would fold, or past `MAX_SMOOTH_TURN`) into stretches whose round ends overlap there
  (so a sharp turn is round, not notched; a one-point run is a circle), and drawn
  into the slab. So the pawn ploughs a channel its own width, packed snow at the bottom.
  A slab repaints on each notify and when the projection or its heights change. **Cost:** the paths are
  re-rasterized on every repaint of the scene svg (each frame while snow falls), so their
  size is what makes a long-lived trail slow. Each run is simplified first
  (`simplifyRun`, Ramer–Douglas–Peucker within `SIMPLIFY_TOLERANCE` 0.012), its outlines
  and projected paths are cached on the run (`runCache`: only the runs being extended are
  redone), and each slab takes only the runs whose bounds reach it. The store (`snowTrail.ts` → `SnowTrail`, `newSnowTrail`,
  `capSnowTrail`, `MAX_TRAIL_POINTS`) is the caller's, so the channel outlasts a remount.
- **Shadows on snow.** A scene whose floor is snowy passes the floor surface recoloured to
  the snow (`{ ...floor, color: palette.snow }`) as each standing object's `surface`, so
  their opaque shadows are the snow's shadow tone. While the snow lies, the objects that
  take `shadowReceiver` (`IsoCardStack`, `IsoPaperStack`, `IsoSortPlatform`) are handed the
  snow's TOP as it (null — no shadow — for one shorter than the snow).
- **Wading.** IsoPawn `snowDepth` (usePawnMotion): the floor's snow depth; a `PawnStep`
  may set its own `snowDepth` (0 = bare; a summit never takes the floor's, an ordinary step
  inherits it, lifted with the step as a drift is). Wherever the depth under the pawn is
  above 0, the snow line is that depth over the surface it stands on (`z0 + lift`), and the
  figure is clipped to everything above it in front of it (`pawnFigure.ts` →
  `pawnSnowClip`, the near half of the body's circle at the snow's top, levelled out past
  its side points), so its bottom is hidden in the snow, and it casts no shadow (nor shows
  its shaded decals). Off while the floor drops.

### IsoLightningBolt

`{ at, z, seed, onDone? }` (`iso/IsoLightningBolt.tsx`). One lightning strike coming down
onto a floor point. It is a jagged flat-white (`ISO.lightning`) stroke from `BOLT_HEIGHT` (90)
world units of height above the point straight down to it. Its 14 kinks bunch toward the
bottom, and it has one short fork plus a flat iso ring where it hits. The jag is seeded
(`seededRandom`), so a re-render never re-jags it. It plays the sky flash's double-strike
flicker once (~0.5 s) and calls `onDone`, and the caller keys it per strike. Draw it in front
of everything on the floor, at a VISIBLE point (`openFloor.ts`), so its column never passes
behind a solid. Under reduced motion it draws nothing and reports done at once.

### IsoBurnMark

`{ at, z, seed }` (`iso/IsoBurnMark.tsx`). A strike's scorch, as a floor **decal**. It has two
flat ink shapes (`useIsoPalette().ink`, so it is washed by time of day): a faint ragged
11-point star splash, and a darker wobbly core over it. Its outline is seeded, so a mark keeps
its exact shape across remounts. `BURN_MARK_RADIUS` (0.95) is the farthest any part of a mark
reaches from its centre. A caller keeps that much floor clear of objects (the Deck Tower:
`towerLightning.ts` → `scorchFits`).

### openFloor.ts

`openFloorSpot(floor, solids, { inset, onSolids, tries?, random? })` and `hiddenBehind(x, y,
solid)`: a uniformly random spot of a floor that the FIXED view can see. A point is hidden
behind a `FloorSolid` (`{ rect, zTop }`) when it is short of both of the solid's visible faces
and inside its screen-x span. With `onSolids`, a point inside a footprint lands on that
solid's top (IsoRain's landings); without it such points are rejected (strike points). Rounded
corners are ignored.

### IsoWind

`{ gust }` (a `WindGust` from `useWindGusts`). A cartoon gust sweeping past the tower.

**Shape.** Two or three dead-straight parallel strands (two points each, no wave), so
they project as clean lines at the floor grid's slope and keep the kit's faceted look. The
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
- **Paths.** Unlike a cloud, a gust does not cross the screen. `planSidePath`
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

`skyTraffic.ts` is the part clouds and wind share.

- **`planSidePath(proj, region, gap, margin, depth = 0)`.** A straight path parallel to one
  of the four sides of `region.around`, `gap` units out, along a world axis, so on screen
  it crosses at the floor grid's slope. It runs from `margin` units past one edge of
  `region.screenSpan` to `margin` past the other. `depth` is the traveller's extent across
  the path from its origin toward +x/+y (0 for a flat gust). On the back sides the origin is
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
  traveller's height comes from. Each traveller type (clouds, wind) owns ONE
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
blue; every Deck Tower world shares it), the wall tones (of every `platformTone`) (cloud walls included, shaded off `white`), the card seams and every shadow
(`shadowTone`). Every colour under a non-identity ambient wash (§ Ambient wash) is derived
too. If the style spreads beyond the Deck Tower, promote them to tokens in
`src/theme/colors.ts`.

The platform's rim is derived too, but not with `shadeHex`: `theme/towerSlab.ts` →
`slabRim` lifts the base by a fixed OKLCH lightness step (`timeOfDay/wash.ts` → `liftHex`),
holding hue and chroma, and `platformTone` reads it. An HSL step costs
chroma near HSL white, so it took reading's pale pink floor (`pnk`) to a white rim that read
as an outline.

Adding an object: build it from `IsoSolid` and `flatPath`, read the projector with
`useIsoProjector`, read its colours with `useIsoPalette` (§ Ambient wash), take a `surface` if it stands on something, cast its shadow with
`IsoShadow` before drawing itself, and export it from `index.ts`.
