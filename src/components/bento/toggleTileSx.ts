import { RAMP, type RampHue } from "../../theme/colors";
import { mixHex } from "../../theme/shadeHex";
import { KEYCAP_POP_TRANSITION } from "../../theme/keycapPress";
import { CARD_SHELL } from "./CardShell";

/**
 * toggleTileSx — the selection look for a row of `compact` BentoTiles where at most one
 * is selected. The host owns the state and the tap rule; this only styles the tiles. Callers:
 *   - src/features/friends/FriendActionTiles.tsx (Send / Accept / Remove) — a toggle
 *     group: tapping the selected tile deselects it, so "none selected" is a state
 *   - src/features/reader/ReaderCollectionTiles.tsx (Documents / Journal) — PRESS FEEL
 *     ONLY (`dimmed` always false): plain switch buttons with no selected look
 * Docs: docs/FRIENDS_FEATURE.md § "The action tiles", docs/USER_DOCUMENT_FEATURE_SUMMARY.md
 * § "Collections (Documents / Journal)".
 *
 * ── Each tile is a TWO-STATE BUTTON: state by COLOUR, press by SIZE ──
 *   none selected   every tile wears its hue's MID tier (BentoTile's body)
 *   one selected    the selected tile KEEPS its MID fill; its siblings fade to a blend
 *                   halfway between their hue's SURFACE and TINT tiers (DIM_TOWARD_TINT),
 *                   so the selected tile reads as lit and its siblings recede. Their
 *                   ghost glyphs fade with them (DIMMED_GHOST_OPACITY). Both are tiers of
 *                   the tile's own hue, so the state stays inside the colour framework.
 *   held            scale(0.76), from any state; the fill does not change while held
 * Size never encodes the state: every tile rests at full size. Pressing sinks the tile
 * quickly (PRESS_IN_TRANSITION); releasing fires the click, while the tile springs back to
 * full size with a small overshoot (KEYCAP_POP_TRANSITION, ease-out-back) and the fills
 * fade to the new state.
 * (History: until 2026-11-16 the selected tile wore a 2px ink outline; on 2026-11-16 it
 * was briefly shown by a latched smaller scale, then by a MARK-tier fill on the selected
 * tile — judged too loud — then by fading the siblings to TINT — too drastic — and
 * then to SURFACE — not strong enough — and finally to the SURFACE↔TINT midpoint, all on
 * 2026-11-17.)
 *
 * ── `:active` only, deliberately NOT the keycap delegate ──
 * The app-wide keycap delegate (src/utils/keycapPressDelegate.ts) holds a press for a
 * minimum KEYCAP_MIN_HELD_MS so even the quickest tap paints. On these tiles that floor
 * read as lag — the tile sat at its smallest size after the finger lifted (user,
 * 2026-11-16) — so the held look is plain `:active` and ends the instant the finger does.
 *
 * Moved out of FriendActionTiles (2026-11-17) when the Reader's collection tiles adopted it.
 * Layer: shared UI primitive (src/components/bento).
 */

/** Scale while the finger is down, from either state. */
const HELD_SCALE = 0.76;
/** The press-in: quick and settling, like the tower plate's 80 ms sink. */
const PRESS_IN_TRANSITION = "90ms cubic-bezier(0.2, 0.8, 0.2, 1)";
/** The fill's fade between states. A plain ease-out: the spring's overshoot is for size,
 *  and a colour that overshoots just flickers. */
const FILL_TRANSITION = "220ms cubic-bezier(0.2, 0.8, 0.2, 1)";

/**
 * How far a dimmed sibling's fill sits from SURFACE toward TINT (0 = surface, 1 = tint).
 * The ramp has no tier between the two: SURFACE alone was too faint a difference and
 * TINT too drastic, so the fill is a blend of the two framework tiers — both from the
 * tile's own hue, so it never leaves that hue. Tune this one number.
 */
const DIM_TOWARD_TINT = 0.5;
/**
 * A dimmed sibling's ghost-glyph opacity (rest: CARD_SHELL.ghostOpacity, 0.15). The glyph
 * is ink at a FIXED opacity, so on the lighter dimmed fill it would hold its weight and
 * end up the most emphasized thing on a tile meant to recede. Fading it with the fill
 * keeps the glyph's contrast against its tile roughly where it was.
 */
const DIMMED_GHOST_OPACITY = 0.07;

/**
 * A toggle tile's press + selection styles (see header). `dimmed` = ANOTHER tile of the
 * same group is selected. Pass `false` for an action tile that shares the row but is not
 * part of the group, so it presses the same way.
 */
export function toggleTileSx(dimmed: boolean, hue: RampHue) {
    return {
        // A sibling of the selected tile fades MID → the SURFACE↔TINT blend. `backgroundColor` overrides the
        // colour that CardShell's `background` shorthand set, since this sx merges after it.
        ...(dimmed ? { backgroundColor: mixHex(RAMP[hue].surface, RAMP[hue].tint, DIM_TOWARD_TINT) } : {}),
        // The ghost glyph fades with the fill (see DIMMED_GHOST_OPACITY). Parent + child
        // class out-specifies the glyph's own single-class opacity from CardShell.
        "& .bento-tile__ghost": {
            opacity: dimmed ? DIMMED_GHOST_OPACITY : CARD_SHELL.ghostOpacity,
            transition: `opacity ${FILL_TRANSITION}`,
        },
        transform: "scale(1)",
        // The transition on the RESTING state is the one that runs on release, so it
        // carries the spring; the held state's own transition runs on the press-in.
        transition: `transform ${KEYCAP_POP_TRANSITION}, background-color ${FILL_TRANSITION}`,
        "&:active": {
            transform: `scale(${HELD_SCALE})`,
            transition: `transform ${PRESS_IN_TRANSITION}, background-color ${FILL_TRANSITION}`,
        },
        "@media (prefers-reduced-motion: reduce)": {
            transition: "none",
            "&:active": { transition: "none" },
            "& .bento-tile__ghost": { transition: "none" },
        },
    } as const;
}
