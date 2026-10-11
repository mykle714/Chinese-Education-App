import { ButtonBase, CircularProgress, IconButton } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { COLORS, FONTS, SIZE, WEIGHT } from "../theme";
import {
    lowSupplyGlowKeyframes,
    lowSupplyGlowPeak,
    LOW_SUPPLY_GLOW_NUDGE,
    LOW_SUPPLY_GLOW_PULSE_MS,
} from "../theme/lowSupplyGlow";
import { SPEAKER_BUTTON_SIZE } from "./SpeakerButton";
import type { LearnNowToggleState } from "../hooks/useLearnNowToggle";

/**
 * The compact "+ to Learn Now" ⇄ "Added!" toggle that sits UNDER the speaker in the eip
 * entry header's vertical action stack (EipEntryHeader). Driven by `useLearnNowToggle`.
 *
 *   • Not in Learn Now → a small round "+" breathing the soft green halo
 *     (theme/lowSupplyGlow.ts, LOW_SUPPLY_GLOW_NUDGE) — the same "add more cards" nudge
 *     the fdp's Sort Cards tile wears. Static at the peak under reduced motion.
 *   • In Learn Now → a small greyed "Added!" pill. Still a button: tap = remove, no
 *     confirmation (removal demotes to 'provisional'; see the hook). No glow.
 *     While the add is in flight (`pending`) the "+" glyph becomes a small spinner.
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

const LearnNowToggle: React.FC<{ state: LearnNowToggleState }> = ({ state }) => {
    const { available, inLibrary, pending, toggle } = state;
    if (!available || inLibrary === undefined) return null;

    return inLibrary ? (
        <ButtonBase
            className="learn-now-toggle learn-now-toggle--added"
            aria-label="Added to Learn Now — tap to remove"
            onClick={(e) => { stop(e); void toggle(); }}
            onMouseDown={stop}
            onTouchStart={stop}
            onTouchEnd={stop}
            disabled={pending}
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
            className="learn-now-toggle learn-now-toggle--add"
            aria-label="Add to Learn Now"
            onClick={(e) => { stop(e); void toggle(); }}
            onMouseDown={stop}
            onTouchStart={stop}
            onTouchEnd={stop}
            disabled={pending}
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
            {/* While the add request is in flight the "+" glyph is swapped for a spinner
                of the same 16px footprint, so the button keeps its size and the stack
                doesn't shift. Colored explicitly: the button is `disabled` while
                pending, and MUI greys a disabled IconButton's inherited color. */}
            {pending ? (
                <CircularProgress
                    className="learn-now-toggle__spinner"
                    size={14}
                    thickness={5}
                    sx={{ color: COLORS.onSurface }}
                />
            ) : (
                <AddIcon sx={{ fontSize: 16 }} />
            )}
        </IconButton>
    );
};

export default LearnNowToggle;
