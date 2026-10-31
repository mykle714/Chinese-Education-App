import { NO_WASH, type IsoWash } from "../../../timeOfDay/wash";
import { ISO, type Material, type PlatformTone } from "./palette";

export { blendWash, hexToOklch, hueTurn, lightWash, NO_WASH, oklchToHex, type IsoWash, type WashLight } from "../../../timeOfDay/wash";

/**
 * wash.ts — the iso framework's AMBIENT WASH: one colour transform laid over every
 * colour a scene paints, so a whole scene can be lit for a time of day (dawn's pink,
 * sunset's orange, night's dim blue) without any object knowing about it
 * (docs/ISO_ART_FRAMEWORK.md § "Ambient wash").
 *
 * The rule (one place it is applied, so nothing is washed twice):
 *   - IsoScene takes a `wash` and hands every object the WASHED palette through
 *     `useIsoPalette()` (sceneContext.ts). An object reads its constants from that, never
 *     from `ISO` directly.
 *   - Colours a CALLER passes in (a platform tone, a floor surface, a plate's band) are
 *     the caller's to wash first (`washHex` / `washMaterial` / `washTone`). Primitives
 *     (IsoSolid, IsoShadow) paint what they are given.
 *   - A shadow takes its tone from its (already-washed) receiver, so shadows follow.
 *
 * The colour transform itself and the OKLCH conversions live in src/timeOfDay/wash.ts,
 * because HTML outside the iso kit washes its colours too (a tower-toned game). This file
 * adds the kit's own shapes: materials, tones and the palette.
 *
 * Depends on: palette.ts. Depended on by: IsoScene.tsx, sceneContext.ts, and the Deck
 * Tower's timeOfDay.ts (which builds the skies). There is no DOM-content form: HTML washes
 * colour by colour, because the old `washColorMatrix` SVG filter (cut 2026-10-30) was
 * CPU-rasterised in WebKit and made the flp lag.
 */

export function washMaterial(m: Material, wash: IsoWash): Material {
    return { top: wash(m.top), left: wash(m.left), right: wash(m.right) };
}

export function washTone(tone: PlatformTone, wash: IsoWash): PlatformTone {
    return { material: washMaterial(tone.material, wash), rim: wash(tone.rim) };
}

/** The framework's palette (`ISO`), every colour in it washed. */
export type IsoPalette = typeof ISO;

/** `ISO` with every colour — plain or a material's three tones — washed. */
export function washPalette(wash: IsoWash): IsoPalette {
    if (wash === NO_WASH) return ISO;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(ISO)) {
        out[key] = typeof value === "string" ? wash(value) : washMaterial(value as Material, wash);
    }
    return out as IsoPalette;
}
