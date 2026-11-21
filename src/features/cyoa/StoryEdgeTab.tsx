import { Box } from "@mui/material";
import Icon from "../../components/Icon";
import type { Tier2Look } from "../../timeOfDay/tier2Look";
import { storyKeyShadow } from "./cyoaStyles";

/**
 * StoryEdgeTab — the chevron tab that shows / hides a panel sliding out of a screen edge
 * (docs/CYOA_FEATURE.md § 3.4 Show / hide toggles).
 *
 * A small tab riding the panel's leading edge, so it slides with the panel: `edge="top"`
 * hangs from the rdb's lower edge (under the header when folded), `edge="bottom"` stands on
 * the choice stack's upper edge (on the screen's foot when folded). The parent places it
 * after / before the panel's Collapse; the fold's height animation carries it.
 * The chevron points the way the panel WILL move and flips with it:
 *   top    — open ▴ (tap to fold up) · closed ▾ (tap to drop down)
 *   bottom — open ▾ (tap to fold down) · closed ▴ (tap to rise up)
 * Tap only, no drag, so it stays clear of the reading pane's own gestures. It stays
 * visible while the panel is hidden — always a way back.
 *
 * Tappable, so it carries the 1px outline and the rounded edge (CLAUDE.md § Buttons &
 * cards); only the corners away from the edge are rounded, so it reads as attached.
 *
 * Layer: feature presentation (src/features/cyoa). Stateless. Rendered by StoryPlayPage.
 */

const TAB_WIDTH_PX = 52;
const TAB_HEIGHT_PX = 20;
const TAB_RADIUS_PX = 10;

interface StoryEdgeTabProps {
    look: Tier2Look;
    edge: "top" | "bottom";
    /** Whether the panel this tab controls is showing. */
    open: boolean;
    onToggle: () => void;
    /** What the panel is, for the accessible label ("dictionary card", "choices"). */
    panelName: string;
    className?: string;
}

function StoryEdgeTab({ look, edge, open, onToggle, panelName, className }: StoryEdgeTabProps) {
    // Points where the panel goes next: up = expand_less, down = expand_more.
    const pointsUp = edge === "top" ? open : !open;
    const radius = edge === "top"
        ? `0 0 ${TAB_RADIUS_PX}px ${TAB_RADIUS_PX}px`
        : `${TAB_RADIUS_PX}px ${TAB_RADIUS_PX}px 0 0`;

    return (
        <Box
            component="button"
            type="button"
            className={`story-edge-tab story-edge-tab--${edge}${className ? ` ${className}` : ""}`}
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
                ...(edge === "top" ? { borderTop: "none" } : { borderBottom: "none" }),
                borderRadius: radius,
                // Rim light only — no lip on a tab flush with its edge.
                boxShadow: storyKeyShadow(look, 0),
                cursor: "pointer",
                touchAction: "manipulation",
            }}
        >
            <Icon name={pointsUp ? "expand_less" : "expand_more"} size={18} color={look.ink2} />
        </Box>
    );
}

export default StoryEdgeTab;
