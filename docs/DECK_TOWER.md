# Deck Tower (experimental)

`/deck-tower` draws the learner's **Learn Now** deck as a stack of flashcards standing on an
isometric platform, in the art style of Nintendo/Paladin's *Good Job!*. It is the
footer's **Deck** tab, which took Discover's slot on 2026-10-17.

The drawing comes from the iso art framework,
[ISO_ART_FRAMEWORK.md](./ISO_ART_FRAMEWORK.md). This doc covers only the page.

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
| Page | `src/features/deckTower/DeckTowerPage.tsx` → `DeckTowerPage` | Lays out the scene, fits the viewBox, runs the build-up (`useBuildProgress`), and shows the title block, inside `MobileTabScreen` |
| Page | `src/features/deckTower/SpaceBackdrop.tsx` → `SpaceBackdrop`, `SpaceBand` | The screen-space sky behind the scene, which darkens into starry space as a tall tower is climbed (§ Sky → space) |
| Framework | `src/features/deckTower/iso/` | Every object, shadow and colour (see [ISO_ART_FRAMEWORK.md](./ISO_ART_FRAMEWORK.md)) |
| Data | `src/hooks/useCategoryCounts.ts` + `src/features/flashcards/builtinCollections.ts` → `builtinCollectionCount` | The Learn Now figure. It is the same derivation the fdp's Learn Now tile uses, so the two cannot disagree |

## The scene

`DeckTowerPage` only places objects and names the surfaces they stand on:

| Constant | What |
|---|---|
| `PLATFORM`, `PLATFORM_THICKNESS` | An 11×11 slab, corner radius 0.9, 1.5 thick, `floating` (a slow bob, see [ISO_ART_FRAMEWORK.md](./ISO_ART_FRAMEWORK.md) § Levitation) |
| `GROUND` | The sky's plane, 1.6 below the slab's underside, which receives the platform's shadow |
| `FLOOR` | The platform's top (z = 0). The stack and the pawn stand on it |
| `CARD` | A portrait 4.8×6.6 footprint, centred on the platform |
| `PAWN_AT`, `PAWN_ROAM` | Where the pawn starts (front right of the tower), and where it wanders: the floor inside the rim, around the tower (the floor label is not an obstacle: the pawn walks over it). The obstacles are listed back-to-front; the page keeps `pawnDepthRank` in state and slots the pawn into the keyed children after that many of them, so it walks behind the tower rather than over it |
| `STARTLE_AT_CARDS` | 50. When the build-up puts this many cards on the tower, the pawn is startled: it looks up, leaps away from the tower and a `!` pops over its head, stares up for a few seconds, then goes back to wandering (`IsoPawn` `startled`, `startledBy={CARD}`). Decks under 50 never trigger it |
| `BIRD_BAND_CARDS`, `BIRDS_AIRBORNE_MAX` | Birds (`IsoBird`, `useBirdFlights`) fly along the tower's four sides at the height of cards 100–150 (card k's underside is (k − 1) · `CARD_THICKNESS` up). One is in the air at a time (`BIRDS_AIRBORNE_MAX`): a bird crosses, then 1.5–6.5 s of empty sky, then the next. They take wing when the build-up puts the 100th card on the tower, so a deck under 100 never has birds. A deck short of 150 lowers the band's top to `SKY_CEILING_ABOVE_TOP` (3 units) over its settled top (`skyBand`), so they circle the tower and not empty sky. Back-side birds are drawn before the stack (it hides them) and front-side birds after the pawn's depth-sorted layers. They sit inside `IsoPlatform`, so they ride its 0.35-unit bob, which is lost in their own bounce |
| `CLOUD_BAND_CARDS`, `CLOUDS_IN_SKY_MAX` | Clouds (`IsoCloud`, `useCloudDrifts`) drift slowly (about a minute per crossing) past the tower's four sides, their bases at the height of cards 250–300. Up to 3 are in the sky at once, with 4–14 s gaps between drifts. They switch on when the build-up puts the 250th card on the tower: each slot's first cloud fades in partway across the screen, so the band is never empty at first. A deck under 250 never has clouds; a deck short of 300 lowers the band's top the same way as the birds' (`skyBand`). Back-side clouds are drawn first (before the back-side birds) and front-side clouds last. They are ~57 units above the birds, so the two never overlap. Within each side they are sorted with `sortCloudsBackToFront`. Under reduced motion they still show, parked and still |
| `WIND_BAND_CARDS`, `WIND_GUSTS_MAX` | Wind gusts (`IsoWind`, `useWindGusts`) sweep past the tower's four sides with their baselines at the height of cards 350–400, in the empty sky between the clouds and space. A gust is two or three straight white streaks, the main one ending in a curl. It draws on head-first, then erases tail-first, over about 1.5–2.3 s. Up to 2 play at once, with 1–4 s gaps. Wind starts when the build-up puts the 350th card on the tower, so a deck under 350 never has wind; a deck short of 400 lowers the band's top the same way as the birds' (`skyBand`). Back-side gusts are drawn first, front-side gusts after the front birds. Under reduced motion there is no wind |
| `SPACE_BAND_CARDS` | 450–650. Over this height band the sky darkens into space and stars fade in (§ Sky → space) |
| `DECK_LABEL`, `LABEL_PLATE` | The deck's name and its floor plate, in front of the stack |
| `DECK_BAND` | The band the name is printed on, on the top card and the floor plate: `RAMP[LEARN_NOW_HUE].mid` (`yelM`), Learn Now's yellow. It uses the `mid` tier because the fdp card's pale `surface` washes out on the cream card face |

There is no carpet: the page does not use `IsoCarpet`.

The stack's `count` is the Learn Now figure. The deck's name (`DECK_LABEL`, "LEARN NOW")
is printed twice: in the top card's head band, and on `LABEL_PLATE`, an `IsoFloorLabel` on
the floor in front of the stack (as wide as the card, between its front-left face and the
platform edge). It is part of the floor: it is drawn first,
outside the pawn's depth sort, and the pawn walks over it. The floor plate keeps the deck
named when a tall tower's top card is scrolled off screen.

**Fixed scale, scroll instead of zoom.** Cards keep a fixed thickness, so a big deck is
far taller than the screen. The page never zooms out to fit it:

- **Width sets the scale.** The viewBox is as wide as the platform (plus padding) and the
  svg is always the full width, so the scale depends only on the platform. The viewBox is
  centred on the platform's own centre; the shadow is ignored, because it slides off
  down-right with the light and would push the platform left of centre.
- **Height follows the tower.** The viewBox runs from the settled tower's top (plus
  `TOP_HEADROOM`, 9 units, so the top card clears the header and title) down to the platform
  shadow's lowest point plus `BOTTOM_MARGIN` (0.4 units). The svg takes that aspect
  ratio (`style.aspectRatio`). It is fitted to the settled tower, so nothing reflows
  during the build-up.
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
  container cannot reach.) The page opens scrolled to the bottom, re-snapping only when
  the viewBox (the count) changes.
- **Title.** The title block (just "Learn Now"; the count subtitle was removed
  2026-10-17) uses the app's header-title type (`pageHeaderTitleTypeSx("hub")` from
  `src/components/PageHeader.tsx` — semibold `FONTS.sans`), enlarged to 40px, in white. It stays
  in normal flow under the header, raised above the scroller
  (`z-index: 2`, `pointer-events: none`, so drags on it still scroll). A tall tower
  scrolls up behind it.
- **Shadow.** It is fitted (above), because the scroller clips at the footer bar and an
  unfitted shadow is cut off there.

## Sky → space

On a tall tower the sky turns into space as the learner scrolls up.

- **Backdrop.** `SpaceBackdrop` is an absolutely positioned box with the scroller's box
  (top of the screen → footer bar) and z-index (1). It comes before the scroller in the
  DOM, so the svg paints over it. It is drawn in screen space and is not part of the iso
  framework. `MobileTabScreen`'s `surfaceColor` stays `ISO.sky`, but the backdrop covers
  it everywhere above the footer.
- **Altitude, not time.** The scene memo gives it `spaceBand`: the viewBox y's of cards
  `SPACE_BAND_CARDS.from` and `.to` on the tower's axis. On each scroll it maps the
  middle of the visible scroller to a viewBox y and gets `t` (0 below the band, 1 above
  it).
  - The background blends `ISO.sky` → `ISO.space` (`mixHex`) on `smoothstep(0, 1, t)`.
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

The white "Learn Now" title on `bluMk` breaks v2's "colour never carries text" rule. That
copies the reference art's white logo on blue. Over space (`ISO.space`, deep navy) it reads
as normal light-on-dark. For the framework's colour divergence, see
[ISO_ART_FRAMEWORK.md](./ISO_ART_FRAMEWORK.md) § Palette.
