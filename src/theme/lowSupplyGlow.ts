import { keyframes } from "@mui/material/styles";
import { RAMP } from "./colors";

/**
 * The "low supply" glow — a soft halo that breathes around an "add cards" control.
 * The recipe (size, blur, tempo) is kept here, apart from its one caller, so a second
 * nudge can reuse it with its own hue:
 *
 *   • the compact "+ to Learning" under the eip header's speaker (LearningToggle.tsx —
 *     the dictionary cdp), lit whenever it shows (only for a word not yet in Learning) —
 *     GREEN (`LOW_SUPPLY_GLOW_NUDGE`): an inviting "add this", not a warning.
 *
 * (The old Home page's Add Cards tile wore the same green halo under
 * LEARN_NOW_LOW_THRESHOLD until 2026-11-04; the Deck Tower's equivalent nudge is its
 * sort platform's hop — DeckTowerPage → `learningLow`.)
 *
 * Kept SOFT on purpose: a pure blur with no crisp ring (a `0 0 0 Npx` ring read as a
 * hard outline), in the ramp's MID tier rather than the saturated mark — the
 * mark-tier version was too harsh against pastel surfaces. The `hl*` highlighter
 * tokens are reserved for dark surfaces (theme/colors.ts).
 *
 * `base` is the element's own resting shadow, if it has one (a CARD_SURFACE tile keeps
 * its `SHADOW.cardRest`): `box-shadow` is one property, so the halo is appended to it
 * rather than replacing it.
 *
 * Docs: docs/LEAF_NODE_PAGES.md § "Read-only dictionary cdp".
 */
// Slow on purpose: a calm breath (3.6s) reads as "worth a look", not an alarm. Was 1.4s.
export const LOW_SUPPLY_GLOW_PULSE_MS = 3600;
/** The "+ to Learning" toggle's halo (LearningToggle). */
export const LOW_SUPPLY_GLOW_NUDGE = RAMP.grn.mid;

const withBase = (halo: string, base?: string) => (base ? `${base}, ${halo}` : halo);

export const lowSupplyGlowRest = (color: string, base?: string) => withBase(`0 0 5px 1px ${color}`, base);
/** The peak halo — also the static fallback under prefers-reduced-motion. */
export const lowSupplyGlowPeak = (color: string, base?: string) => withBase(`0 0 14px 4px ${color}`, base);

export const lowSupplyGlowKeyframes = (color: string, base?: string) => keyframes`
    0%, 100% { box-shadow: ${lowSupplyGlowRest(color, base)}; }
    50%      { box-shadow: ${lowSupplyGlowPeak(color, base)}; }
`;
