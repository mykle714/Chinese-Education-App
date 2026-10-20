import { keyframes } from "@mui/material/styles";
import { RAMP } from "./colors";

/**
 * The "low supply" glow — a soft halo that breathes around a control while the
 * learner's core Learning count is short. ONE shape (size, blur, tempo) shared by the
 * nudge and its follow-through; each site picks its own hue:
 *
 *   • the fdp's Sort Cards tile (DecksTopRail.tsx), lit under LEARN_NOW_LOW_THRESHOLD —
 *     GREEN (`LOW_SUPPLY_GLOW_NUDGE`): an inviting "go here", not a warning;
 *   • the sort page's Learning tally pill (SortCardsPage.tsx → SortTallyValue), lit
 *     while a learner who arrived short is still under LEARN_NOW_ENOUGH_THRESHOLD —
 *     YELLOW (`LOW_SUPPLY_GLOW_TALLY`), the Learning hue, so it reads as "fill this one";
 *   • the compact "+ to Learning" under the eip header's speaker (LearnNowToggle.tsx — the
 *     Dictionary page's eip and the dictionary cdp), lit whenever it shows (only for a word
 *     not yet in Learning) — GREEN (`LOW_SUPPLY_GLOW_NUDGE`), the same "add cards" nudge.
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
 * Docs: docs/DECKS_FEATURE.md § "Sort Cards tile", docs/SORT_CARDS_REQUIREMENTS.md § 5.3a,
 * docs/LEAF_NODE_PAGES.md § "Read-only dictionary cdp".
 */
// Slow on purpose: a calm breath (3.6s) reads as "worth a look", not an alarm. Was 1.4s.
export const LOW_SUPPLY_GLOW_PULSE_MS = 3600;
/** The fdp Sort Cards tile's halo (and its "Low" badge fill). */
export const LOW_SUPPLY_GLOW_NUDGE = RAMP.grn.mid;
/** The sort page's Learning tally pill halo. */
export const LOW_SUPPLY_GLOW_TALLY = RAMP.yel.mid;

const withBase = (halo: string, base?: string) => (base ? `${base}, ${halo}` : halo);

export const lowSupplyGlowRest = (color: string, base?: string) => withBase(`0 0 5px 1px ${color}`, base);
/** The peak halo — also the static fallback under prefers-reduced-motion. */
export const lowSupplyGlowPeak = (color: string, base?: string) => withBase(`0 0 14px 4px ${color}`, base);

export const lowSupplyGlowKeyframes = (color: string, base?: string) => keyframes`
    0%, 100% { box-shadow: ${lowSupplyGlowRest(color, base)}; }
    50%      { box-shadow: ${lowSupplyGlowPeak(color, base)}; }
`;
