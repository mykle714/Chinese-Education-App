/**
 * light.ts — the iso art framework's single light, and the ONE rule every shadow is
 * built with (docs/ISO_ART_FRAMEWORK.md § "Light and shadows").
 *
 * ── The rule ──────────────────────────────────────────────────────────────────
 * A shadow is the caster's FOOTPRINT (its underside outline, a WorldRect) slid across the
 * receiving surface along the light, by
 *
 *     slide = LIGHT_SLOPE · (casterZ − receiver.z + CONTACT_LIFT)
 *
 * stretched out on its two FRONT edges (world +x, +y) by `shadowSpread`, and painted flat
 * on the receiver, in the receiver's own colour darkened by SHADOW_DEPTH. Nothing else decides
 * where a shadow goes or what colour it is:
 *   - casterZ is the caster's underside, so an object resting on a surface (gap 0) still
 *     peeks a short contact sliver out (CONTACT_LIFT), and a floating one throws its
 *     shadow further the higher it is;
 *   - the SHIFT is THIN — a quarter of what it was until 2026-11-04 (0.6), which slid
 *     every resting shadow far enough out to read as the object hovering;
 *   - the SIZE is kept separately: the slid footprint's two front edges (+x, under the
 *     dark right wall; +y, the bottom / front-left) are pushed back out to where the old
 *     shadow's were (`shadowSpread`). So the visible shade is the old shadow's, while its
 *     back edges stay tucked under the object with the thin shift;
 *   - a caster may state its own HEIGHT (`casterHeight`): one thinner than a sheet of
 *     paper then gets a sliver in proportion to it (`contactLift`). Anything 0.06 or
 *     taller — every object today — gets the full (thin) CONTACT_LIFT;
 *   - the tone comes from the receiver, so a shadow on the sky, on the floor and on a
 *     floor plate all read as the same strength of shade.
 *
 * Flat things lying on a surface (flush floor labels) count as PART of that surface: they receive
 * shadows but never cast one.
 *
 * Clouds (IsoCloudShadow) keep LIGHT_DIR but slide by a much shorter CLOUD_LIGHT_SLOPE, so
 * their shadow stays on screen with them (`cloudShadowFootprint`).
 *
 * Depended on by: IsoShadow.tsx (draws it), DeckTowerPage.tsx (viewBox fitting),
 * usePawnMotion.ts (keeps the pawn's shadow on the floor, via `shadowSlide`).
 */
import { translateRect, type WorldRect } from "./geometry";
import { shadeHex } from "./palette";

/**
 * Something a shadow can fall on: a horizontal plane at world height `z`, painted
 * `color`. Every object that stands on something is told which surface it stands on.
 */
export interface IsoSurface {
    z: number;
    color: string;
}

/**
 * The ground-plane direction shadows fall in (unit vector, world x/y). It points screen
 * down-right, away from the upper-left light that the face shading (lit tops, mid LEFT
 * walls, dark RIGHT walls) assumes.
 */
const LIGHT_DIR = (() => {
    const x = 0.3;
    const y = 0.12;
    const len = Math.hypot(x, y);
    return { x: x / len, y: y / len };
})();

/** World units a shadow slides per world unit its caster sits above the receiver. */
const LIGHT_SLOPE = 0.5;

/**
 * Extra height every caster is treated as having, so a shadow of something resting
 * flush on a surface still shows as a contact sliver instead of hiding under it.
 *
 * 0.15 → the shadow slides 0.075 units (~1px on a phone) past a resting object's edge: a
 * thin line of contact. It was 0.6 (~3px) until 2026-11-04, which made everything on the
 * floor — the tower, the pawn, the lever, the notebook stack — look lifted off it. The
 * value is the one a single sheet of notebook paper got under the height rule below, the
 * look that read as resting.
 */
const CONTACT_LIFT = 0.15;

/**
 * Contact lift per world unit of caster height, for a caster that states its height: the
 * sliver is at most this many times the object's own height. Full CONTACT_LIFT from a
 * height of CONTACT_LIFT / 2.5 = 0.06 (one sheet of paper) up, so only something thinner
 * than a sheet gets less.
 */
const CONTACT_LIFT_PER_HEIGHT = 2.5;

/** The contact lift for a caster of `casterHeight` (undefined: unknown → the full CONTACT_LIFT). */
function contactLift(casterHeight?: number): number {
    return casterHeight === undefined ? CONTACT_LIFT : Math.min(CONTACT_LIFT, CONTACT_LIFT_PER_HEIGHT * Math.max(0, casterHeight));
}

/**
 * The contact lift BEFORE 2026-11-04. Kept only to size the spread below: the old
 * shadow's front edges are the look being kept.
 */
const OLD_CONTACT_LIFT = 0.6;

/**
 * Extra weight on the BOTTOM (+y) edge's spread, over the old shadow's. Matching the old
 * shadow exactly (×1, bottom ≈ 0.11) still read as too thin a line under the object's
 * front-left wall once the shift was thin (2026-11-04); ×1.5 puts it at ≈ 0.15. The right
 * edge is not weighted: it already matches the old shadow.
 */
const BOTTOM_SPREAD_SCALE = 1.5;

/**
 * How far (world x, world y) a shadow's two FRONT edges are pushed out past the slid
 * footprint's: +x (the right edge, under the dark right wall) by `x`, +y (the bottom /
 * front-left edge) by `y`. The back edges are not moved.
 *
 * The SIZE of a shadow and its SHIFT are separate. Until 2026-11-04 they were the same
 * number: a resting shadow was the footprint slid 0.3 units along the light (CONTACT_LIFT
 * 0.6), and the object looked like it hovered. CONTACT_LIFT now keeps the shift thin, and
 * this spread puts both front edges back where the old shadow's were: the old slide minus
 * the new one, per axis, LIGHT_DIR · LIGHT_SLOPE · (0.6 − 0.15) ≈ (0.209, 0.084), with the
 * bottom then weighted by BOTTOM_SPREAD_SCALE (→ 0.126). Visible shade: right ≈ 0.28 (the
 * old shadow's), bottom ≈ 0.15 (a little more than the old 0.11), shift still thin. Tried and rejected 2026-11-04: growing EVERY side by 0.225 (bottom band too heavy,
 * rims on the back edges) and growing +x only (bottom sliver too thin, ≈ 0.028).
 *
 * Constant with height (a floating caster's shadow slides further, it does not grow), and
 * scaled down with `contactLift` for a caster thinner than a sheet of paper.
 */
export function shadowSpread(casterHeight?: number): { x: number; y: number } {
    const extra = LIGHT_SLOPE * (OLD_CONTACT_LIFT - CONTACT_LIFT) * (contactLift(casterHeight) / CONTACT_LIFT);
    return { x: LIGHT_DIR.x * extra, y: LIGHT_DIR.y * extra * BOTTOM_SPREAD_SCALE };
}

/** How much darker than its receiver a shadow is (HSL lightness, see `shadeHex`). */
const SHADOW_DEPTH = 0.1;
/**
 * The opacity of a GLAZE shadow (IsoShadow `glaze`): ink at this opacity darkens a pale
 * receiver about as much as SHADOW_DEPTH does, and leaves what is printed on it readable.
 */
export const SHADOW_GLAZE_OPACITY = 0.12;

/**
 * How far (world x/y) a shadow lands from its caster's footprint, for a caster at `casterZ`
 * over a receiver at `receiverZ`. `casterHeight` (optional) shrinks the contact sliver of a
 * very short caster (`contactLift`).
 */
export function shadowSlide(casterZ: number, receiverZ: number, casterHeight?: number): { x: number; y: number } {
    const slide = LIGHT_SLOPE * Math.max(0, casterZ - receiverZ + contactLift(casterHeight));
    return { x: LIGHT_DIR.x * slide, y: LIGHT_DIR.y * slide };
}

/**
 * Where the shadow of `footprint` (underside at `casterZ`, optionally `casterHeight` tall)
 * lands on `receiver`: slid by `shadowSlide`, then stretched on its two front edges (+x,
 * +y) by `shadowSpread`. The origin stays put, so the back edges keep the thin shift; the
 * corner radius is unchanged.
 */
export function shadowFootprint(footprint: WorldRect, casterZ: number, receiver: IsoSurface, casterHeight?: number): WorldRect {
    const slide = shadowSlide(casterZ, receiver.z, casterHeight);
    const slid = translateRect(footprint, slide.x, slide.y);
    const spread = shadowSpread(casterHeight);
    return { ...slid, w: slid.w + spread.x, d: slid.d + spread.y };
}

/**
 * World units a CLOUD's shadow slides per world unit of drop — the one deliberate
 * exception to LIGHT_SLOPE (docs/ISO_ART_FRAMEWORK.md § "Light and shadows" → clouds).
 *
 * Clouds fly ~18–24 units over the floor. Under LIGHT_SLOPE their shadows would land ~10
 * units down-right of them, so far that the cloud and its shadow are never on screen
 * together. The DIRECTION is still LIGHT_DIR (one light); only the skew is shortened, so a
 * shadow sits ~1.5–2 units off the point straight under its cloud. Decided with the user
 * 2026-11-04.
 */
const CLOUD_LIGHT_SLOPE = 0.08;

/**
 * Where a cloud puff's shadow lands on `receiver`: its footprint slid along LIGHT_DIR by
 * CLOUD_LIGHT_SLOPE · drop. No contact lift and no right-side spread — those exist for
 * objects resting on a surface, and a cloud never does.
 */
export function cloudShadowFootprint(footprint: WorldRect, casterZ: number, receiver: IsoSurface): WorldRect {
    const slide = CLOUD_LIGHT_SLOPE * Math.max(0, casterZ - receiver.z);
    return translateRect(footprint, LIGHT_DIR.x * slide, LIGHT_DIR.y * slide);
}

/** The colour of a shadow falling on a surface of `color`. */
export function shadowTone(color: string): string {
    return shadeHex(color, SHADOW_DEPTH);
}
