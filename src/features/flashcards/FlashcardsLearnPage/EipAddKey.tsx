import { ButtonBase } from "@mui/material";
import Icon from "../../../components/Icon";
import { COLORS } from "../../../theme/colors";
import { FONTS } from "../../../theme/fonts";
import { WEIGHT } from "../../../theme/scale";
import { keycapPressSx } from "../../../theme/keycapPress";
import type { LearningToggleState } from "../../../hooks/useLearningToggle";
import { useEipColors } from "./useEipPalette";

/**
 * EipAddKey — the Dictionary eip's "Add ⇄ Added!" Learning key (Tower Tier 2 design,
 * `.kc.add`, artboard "Dictionary · entry"), built to the design exactly. It sits in the
 * word-trail row at its right end (EipUpperPanel). Driven by `useLearningToggle`, the
 * same state the dictionary cdp's glowing `LearningToggle` reads.
 *
 * A RAISED KEY: a solid lip under the face, no blur. Four states:
 *
 *   Add          face on a 5px `edge` lip, lifted 1px            (+  Add)
 *   Add, held    sunk 4px, no lip — the key bottoms out
 *   Added!       face on a 2px lip, sat 2px lower; green check     (✓  Added!)
 *   Added!, held sunk 4px, no lip
 *
 * The key's resting height drops by 3px once added (5px lip → 2px), so "Added!" reads as a
 * key that has been pressed and stayed down. Still a button when added: tap = remove, no
 * confirmation (removal demotes to 'provisional'; see useLearningToggle). No glow — the
 * dictionary cdp's `LearningToggle` keeps its breathing halo; this key does not.
 *
 * Fixed 92px width so "Add" → "Added!" never moves the trail beside it; the label is
 * centred in the space right of the icon (design `.add i{flex:1;text-align:center}`).
 * Carries the app's 1px outline (CLAUDE.md § Buttons & cards; the design's `.ol` ring) as
 * an inset shadow so it adds no width.
 *
 * Status unknown (still loading) or entry ineligible → renders nothing.
 *
 * ⚠️ COLOUR OUTSIDE THE FRAMEWORK: the check is the design's oklch(55% 0.15 155), shipped as
 * #008A48. The framework's greens are all pale grounds (grnMk #50DF5F reads as a highlighter
 * on white) and its `successInk` is ink, so no token is close. Flagged in
 * docs/EIP_SHEET_GESTURES.md § Add key.
 *
 * Layer: feature component (src/features/flashcards). Depends on: EipPaletteContext,
 * useLearningToggle. Depended on by: EipUpperPanel. Docs: docs/EIP_SHEET_GESTURES.md § Add key.
 */

/** The check's green: oklch(55% 0.15 155), clamped to sRGB. */
const ADDED_CHECK = "#008A48";

const KEY_WIDTH = 92;
const LIP_ADD = 5;
const LIP_ADDED = 2;
const SINK = 4;

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

const EipAddKey: React.FC<{ state: LearningToggleState }> = ({ state }) => {
    const { available, inLibrary, toggle } = state;
    const colors = useEipColors();
    if (!available || inLibrary === undefined) return null;

    // The outline ring: the app's border token by day, a faint white ring on night slate.
    const ring = `inset 0 0 0 1px ${colors.dark ? "rgba(255, 255, 255, 0.12)" : COLORS.border}`;
    const lip = inLibrary ? LIP_ADDED : LIP_ADD;

    return (
        <ButtonBase
            // Pressed look from the app-wide keycap delegate (keycapPressDelegate.ts) — the
            // key sits in the upper panel's drag handle, whose pointer capture steals `:active`.
            className={`eip-add-key ${inLibrary ? "eip-add-key--added" : "eip-add-key--add"}`}
            aria-label={inLibrary ? "Added to Learning — tap to remove" : "Add to Learning"}
            aria-pressed={inLibrary}
            // The hook flips Add ⇄ Added! at once and sends the request after paint
            // (optimistic), so the key never waits on — or is disabled by — the network.
            onClick={(e) => { stop(e); toggle(); }}
            onMouseDown={stop}
            onTouchStart={stop}
            onTouchEnd={stop}
            disableRipple
            sx={{
                boxSizing: "border-box",
                width: KEY_WIDTH,
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-start",
                gap: "5px",
                padding: "6px 11px 6px 10px",
                borderRadius: "12px",
                backgroundColor: colors.face,
                color: colors.ink,
                fontFamily: FONTS.sans,
                fontSize: 13,
                fontWeight: WEIGHT.semibold,
                whiteSpace: "nowrap",
                // The app's raised-key press (theme/keycapPress.ts — it snaps, no easing):
                // lifted 1px at rest (an added key sits 2px LOW, as if it stayed pressed);
                // held, it jumps 4px down with the lip gone, and jumps back.
                ...keycapPressSx({
                    restShadow: `${ring}, 0 ${lip}px 0 ${colors.edge}`,
                    pressedShadow: ring,
                    restY: inLibrary ? 2 : -1,
                    pressedY: SINK,
                }),
            }}
        >
            <Icon
                name={inLibrary ? "check" : "add"}
                size={18}
                color={inLibrary ? ADDED_CHECK : colors.ink}
                className="eip-add-key__icon"
            />
            <span className="eip-add-key__label" style={{ flex: 1, textAlign: "center" }}>
                {inLibrary ? "Added!" : "Add"}
            </span>
        </ButtonBase>
    );
};

export default EipAddKey;
