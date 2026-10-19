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
 * and painted flat on the receiver, in the receiver's own colour darkened by
 * SHADOW_DEPTH. Nothing else decides where a shadow goes or what colour it is:
 *   - casterZ is the caster's underside, so an object resting on a surface (gap 0) still
 *     peeks a short contact sliver out (CONTACT_LIFT), and a floating one throws its
 *     shadow further the higher it is;
 *   - the tone comes from the receiver, so a shadow on the sky, on the floor and on a
 *     carpet all read as the same strength of shade.
 *
 * Flat things lying on a surface (carpets) count as PART of that surface: they receive
 * shadows but never cast one.
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
 */
const CONTACT_LIFT = 0.6;

/** How much darker than its receiver a shadow is (HSL lightness, see `shadeHex`). */
const SHADOW_DEPTH = 0.1;

/** How far (world x/y) a shadow lands from its caster's footprint, for a caster at `casterZ` over a receiver at `receiverZ`. */
export function shadowSlide(casterZ: number, receiverZ: number): { x: number; y: number } {
    const slide = LIGHT_SLOPE * Math.max(0, casterZ - receiverZ + CONTACT_LIFT);
    return { x: LIGHT_DIR.x * slide, y: LIGHT_DIR.y * slide };
}

/** Where the shadow of `footprint` (underside at `casterZ`) lands on `receiver`. */
export function shadowFootprint(footprint: WorldRect, casterZ: number, receiver: IsoSurface): WorldRect {
    const slide = shadowSlide(casterZ, receiver.z);
    return translateRect(footprint, slide.x, slide.y);
}

/** The colour of a shadow falling on a surface of `color`. */
export function shadowTone(color: string): string {
    return shadeHex(color, SHADOW_DEPTH);
}
