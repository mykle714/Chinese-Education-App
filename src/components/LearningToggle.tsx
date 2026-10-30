import { ButtonBase, IconButton } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { COLORS, FONTS, SIZE, WEIGHT } from "../theme";
import {
    lowSupplyGlowKeyframes,
    lowSupplyGlowPeak,
    LOW_SUPPLY_GLOW_NUDGE,
    LOW_SUPPLY_GLOW_PULSE_MS,
} from "../theme/lowSupplyGlow";
import { SPEAKER_BUTTON_SIZE } from "./SpeakerButton";
import type { LearningToggleState } from "../hooks/useLearningToggle";

/**
 * The compact "+ to Learning" ⇄ "Added!" toggle that sits UNDER the speaker in the eip
 * entry header's vertical action stack (EipEntryHeader). Driven by `useLearningToggle`.
 * Today only the dictionary cdp's inline panel shows it; the Dictionary page's eip draws
 * the same state as the raised `EipAddKey` in its trail row (2026-10-29).
 *
 *   • Not in Learning → a small round "+" breathing the soft green halo
 *     (theme/lowSupplyGlow.ts, LOW_SUPPLY_GLOW_NUDGE) — the same "add more cards" nudge
 *     the fdp's Sort Cards tile wears. Static at the peak under reduced motion.
 *   • In Learning → a small greyed "Added!" pill. Still a button: tap = remove, no
 *     confirmation (removal demotes to 'provisional'; see the hook). No glow.
 *     Flips the instant it is tapped — the hook is optimistic, so there is no
 *     in-flight state to draw.
 *   • Status unknown (still loading) or entry ineligible → renders nothing.
 *
 * Sized to the speaker's column: the "+" is 24px against the speaker's 30px hit target (SPEAKER_BUTTON_SIZE),
 * so the stack reads as speaker first, add second. The "Added!" pill is pinned to the
 * same 24px height (TOGGLE_HEIGHT) so toggling never resizes the stack.
 *
 * Taps stop propagation (the SpeakerButton pattern) so they never reach a flip/drag
 * handler on a wrapping surface.
 *
 * Docs: docs/LEAF_NODE_PAGES.md § "Read-only dictionary cdp".
 */

const addGlow = lowSupplyGlowKeyframes(LOW_SUPPLY_GLOW_NUDGE);

// Both states occupy the SAME height. The header centers its action stack vertically
// (InfoSheetEntryHeader `alignItems: center`), so if "Added!" were shorter than the "+"
// the stack would shrink on toggle and the speaker above it would visibly jump.
const TOGGLE_HEIGHT = 24;

// The action stack is left-justified (EipEntryHeader), so the 24px "+" is inset by half
// the size difference to put its center exactly under the speaker's center. Read from
// SpeakerButton's own pinned size so the two can never drift apart again.
const ADD_INSET = (SPEAKER_BUTTON_SIZE - TOGGLE_HEIGHT) / 2;

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

const LearningToggle: React.FC<{ state: LearningToggleState }> = ({ state }) => {
    const { available, inLibrary, toggle } = state;
    if (!available || inLibrary === undefined) return null;

    return inLibrary ? (
        <ButtonBase
            className="learning-toggle learning-toggle--added"
            aria-label="Added to Learning — tap to remove"
            onClick={(e) => { stop(e); toggle(); }}
            onMouseDown={stop}
            onTouchStart={stop}
            onTouchEnd={stop}
            sx={{
                boxSizing: "border-box",
                height: TOGGLE_HEIGHT,
                padding: "0 7px",
                borderRadius: "999px",
                border: `1px solid ${COLORS.border}`,
                backgroundColor: COLORS.grey,
                fontFamily: FONTS.sans,
                fontSize: SIZE.micro,
                fontWeight: WEIGHT.semibold,
                lineHeight: 1.4,
                color: COLORS.textFaint,
                whiteSpace: "nowrap",
            }}
        >
            Added!
        </ButtonBase>
    ) : (
        <IconButton
            className="learning-toggle learning-toggle--add"
            aria-label="Add to Learning"
            onClick={(e) => { stop(e); toggle(); }}
            onMouseDown={stop}
            onTouchStart={stop}
            onTouchEnd={stop}
            sx={{
                width: TOGGLE_HEIGHT,
                height: TOGGLE_HEIGHT,
                mx: `${ADD_INSET}px`,
                padding: 0,
                color: COLORS.onSurface,
                animation: `${addGlow} ${LOW_SUPPLY_GLOW_PULSE_MS}ms ease-in-out infinite`,
                "@media (prefers-reduced-motion: reduce)": {
                    animation: "none",
                    boxShadow: lowSupplyGlowPeak(LOW_SUPPLY_GLOW_NUDGE),
                },
            }}
        >
            <AddIcon sx={{ fontSize: 16 }} />
        </IconButton>
    );
};

export default LearningToggle;
