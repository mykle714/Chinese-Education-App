import { Box } from "@mui/material";
import Icon from "../../components/Icon";
import type { Tier2Look } from "../../timeOfDay/tier2Look";
import { storyKeyShadow } from "./cyoaStyles";

/**
 * StoryEdgeTab — the chevron tab that shows / hides the choice stack, which slides out of
 * the screen's bottom edge (docs/CYOA_FEATURE.md § 3.4 Show / hide toggles). (The rdb had a
 * top-edge twin until 2026-11-23; it became the story toolbar's fold key.)
 *
 * A small tab standing on the stack's upper edge, so it slides with the stack (on the
 * screen's foot when folded). The parent places it before the stack's Collapse; the fold's
 * height animation carries it. The chevron points the way the stack WILL move and flips
 * with it: open ▾ (tap to fold down) · closed ▴ (tap to rise up).
 * Tap only, no drag, so it stays clear of the reading pane's own gestures. It stays
 * visible while the panel is hidden — always a way back.
 *
 * Tappable, so it carries the 1px outline and the rounded edge (CLAUDE.md § Buttons &
 * cards); only the top corners are rounded, so it reads as attached.
 *
 * Layer: feature presentation (src/features/cyoa). Stateless. Rendered by StoryPlayPage.
 */

const TAB_WIDTH_PX = 52;
const TAB_HEIGHT_PX = 20;
const TAB_RADIUS_PX = 10;

interface StoryEdgeTabProps {
    look: Tier2Look;
    /** Whether the panel this tab controls is showing. */
    open: boolean;
    onToggle: () => void;
    /** What the panel is, for the accessible label ("dictionary card", "choices"). */
    panelName: string;
    className?: string;
}

function StoryEdgeTab({ look, open, onToggle, panelName, className }: StoryEdgeTabProps) {

    return (
        <Box
            component="button"
            type="button"
            className={`story-edge-tab${className ? ` ${className}` : ""}`}
            aria-label={`${open ? "Hide" : "Show"} ${panelName}`}
            aria-expanded={open}
            onClick={onToggle}
            sx={{
                alignSelf: "center",
                flexShrink: 0,
                width: TAB_WIDTH_PX,
                height: TAB_HEIGHT_PX,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 0,
                backgroundColor: look.surface,
                border: `1px solid ${look.outline}`,
                // The side touching the edge has no outline: the tab grows out of it.
                borderBottom: "none",
                borderRadius: `${TAB_RADIUS_PX}px ${TAB_RADIUS_PX}px 0 0`,
                // Rim light only — no lip on a tab flush with its edge.
                boxShadow: storyKeyShadow(look, 0),
                cursor: "pointer",
                touchAction: "manipulation",
            }}
        >
            {/* Points where the stack goes next: open → down, folded → up. */}
            <Icon name={open ? "expand_more" : "expand_less"} size={18} color={look.ink2} />
        </Box>
    );
}

export default StoryEdgeTab;
