import { COLORS } from "./colors";

/**
 * roundedEdge — the hairline ROUNDED PERIMETER of an extruded tower-style object (a face
 * standing on a diagonal box-shadow wall stepped 1px along (1, 1)). Instead of a hard
 * corner where face meets wall, the edge reads as a tiny fillet:
 *
 *  - FILLET: one copy of the face outline ROUNDED_EDGE_FILLET_PX along (1, 1), coloured
 *    half-way from face to wall. List it BEFORE the wall copies (box-shadows paint
 *    first-listed on top) so it sits over the wall's first step.
 *  - RIM LIGHT: a crisp 1px inset highlight on the face's top-left edge — the rounded
 *    perimeter catching the (−1, −1) light the walls are shaded against. It is an inset
 *    shadow, so it paints over the face's background but under its children.
 *
 * The wall itself stays the caller's solid wall colour, so the side still reads as a side.
 * Every colour derives from the caller's face + wall pair (and `COLORS.white`), so nothing
 * leaves the framework. The blends are CSS `color-mix(in srgb, …)` rather than `mixHex`
 * so a caller may pass CSS variables — the footer slab's colours are `tier2Var(…)`
 * (src/timeOfDay/tier2Chrome.ts), which turn slate at night; the browser resolves the mix.
 *
 * ── Three wall shapes ──
 *  - DIAGONAL, outset (the tower style's extrusion: td filter keys, card stock, footer slab):
 *    `roundedEdgeFillet` + `roundedEdgeRimLight` (top-left).
 *  - DIAGONAL, inset (a key set INTO a slab, its wall drawn inside its own box: the footer's
 *    active tab): `roundedEdgeInsetFillet`, listed AFTER the inset wall steps so they cover
 *    all but its last 0.5px, + `roundedEdgeRimLight`.
 *  - STRAIGHT lip (`0 Npx 0 wall` — the wall seen head-on below the face: the flp plates,
 *    the eip keys, the acp / Dictionary / tone-keyboard keycaps, Match Speed cards):
 *    `roundedEdgeFilletDown` + `roundedEdgeRimLightTop` (top edge only — head-on, the light
 *    is straight above the wall, so there is no lit left side). A key with an inset 1px
 *    outline ring passes `insideRingPx` 1 and lists the ring FIRST, so the highlight shows
 *    as the 1px just inside the outline.
 * The standard: every rectangular raised object takes the edge — docs/designGuidelines.md
 * § Buttons → "The rounded edge".
 *
 * History (2026-11-08, on the td filter keys): a full-depth quarter-round turned the wall
 * face-coloured (head-on, most of a quarter-round faces the viewer) and it stopped reading
 * as a side; 2px and 1px fillets plus an inset shade on the face read as too big. 0.5px is
 * the smallest round that still shows (on a 1x desktop screen it may round away, leaving
 * only the rim light).
 *
 * Used by: src/features/deckTower/TowerFilterKeys.tsx (`keyShadow`),
 *          src/features/discover/sortCardStock.ts (`cardStockShadow`, the pressed stock),
 *          src/components/MobileFooter.tsx (`slabLipShadow`, the footer slab),
 *          src/features/deckTower/iso/IsoSolid.tsx (`roundedEdge` — the SVG form of the same edge
 *          on the iso solids: cards, raised plates, the notebook, the lever base, the acp bins'
 *          top layers; it reuses these constants).
 *   Inset: MobileFooter.tsx (`slabKeyShadow`, the active tab).
 *   Straight lip: theme/towerPlate.ts (`restShadow` — flp plate buttons, game-break plates),
 *          gameBreak/GameBreakCard.tsx (the game token), FlashcardsLearnPage/EipAddKey.tsx,
 *          FlashcardsLearnPage/EipEntryHeader.tsx (headword tile), discover/AddCardsPage.tsx
 *          (`keycapShadow`), dictionary/DictionaryPageParts.tsx (`Keycap`),
 *          beginnerKeyboard/PinyinToneKeyboard.tsx (`keycapShadow`), games/match-speed/
 *          MatchSpeedCard.tsx (`keyShadow`).
 * Docs: docs/designGuidelines.md § Buttons → "The rounded edge"; docs/DECK_TOWER.md § "The filter keys", § "Footer"; docs/TOWER_STYLE_SHIFT.md § "Card stock";
 *       docs/ISO_ART_FRAMEWORK.md § "The rounded edge";
 *       docs/SORT_CARDS_REQUIREMENTS.md § 4.5.
 */

/** The fillet's depth along (1, 1), px. Constant whatever the wall's depth. */
export const ROUNDED_EDGE_FILLET_PX = 0.5;
/** How much white the rim light mixes into the face colour, %. */
export const RIM_LIGHT_WHITE_PCT = 45;
/** The rim light's width inside the face's edge, px. */
export const RIM_LIGHT_PX = 1;

/**
 * The fillet box-shadow — list it before the wall steps. Omit it when there is no wall.
 * `face` / `wall` may be hex or CSS variables.
 */
export const roundedEdgeFillet = (face: string, wall: string) =>
    `${ROUNDED_EDGE_FILLET_PX}px ${ROUNDED_EDGE_FILLET_PX}px 0 ${filletColor(face, wall)}`;

/** The rim-light inset box-shadow on the face's top-left edge. `face` may be a CSS variable. */
export const roundedEdgeRimLight = (face: string) =>
    `inset ${RIM_LIGHT_PX}px ${RIM_LIGHT_PX}px 0 0 ${rimLightColor(face)}`;

/** The rim light's colour: the face mixed RIM_LIGHT_WHITE_PCT toward white. */
const rimLightColor = (face: string) => `color-mix(in srgb, ${face} ${100 - RIM_LIGHT_WHITE_PCT}%, ${COLORS.white})`;
/** The fillet's colour: half-way from face to wall. */
const filletColor = (face: string, wall: string) => `color-mix(in srgb, ${face}, ${wall})`;

/**
 * The fillet for a DIAGONAL wall drawn INSIDE the key's box (inset steps `inset -k px -k px`,
 * k = 1…wallPx): one step past the wall, list it AFTER the steps. Omit it when `wallPx` is 0.
 */
export const roundedEdgeInsetFillet = (face: string, wall: string, wallPx: number) =>
    `inset ${-(wallPx + ROUNDED_EDGE_FILLET_PX)}px ${-(wallPx + ROUNDED_EDGE_FILLET_PX)}px 0 ${filletColor(face, wall)}`;

/** The fillet for a STRAIGHT lip (`0 Npx 0 wall`) — list it before the lip; omit it when the lip is 0. */
export const roundedEdgeFilletDown = (face: string, wall: string) =>
    `0 ${ROUNDED_EDGE_FILLET_PX}px 0 ${filletColor(face, wall)}`;

/**
 * The rim light for a STRAIGHT-lip key: the face's top edge only. `insideRingPx` pushes it
 * below an inset outline ring of that width (list the ring first, so it covers the overlap).
 */
export const roundedEdgeRimLightTop = (face: string, insideRingPx = 0) =>
    `inset 0 ${RIM_LIGHT_PX + insideRingPx}px 0 0 ${rimLightColor(face)}`;
