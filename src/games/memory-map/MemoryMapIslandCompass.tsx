import React from "react";
import { Box, Typography } from "@mui/material";
import NavigationIcon from "@mui/icons-material/Navigation";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";

/**
 * Edge markers pointing at islands that are entirely off screen
 * (docs/MEMORY_MAP_GAME.md § 6).
 *
 * The archipelago is deliberately larger than a phone screen, so a learner who pans
 * into a corner can end up looking at open water with no evidence that the rest of
 * their map exists. These are the evidence: one chevron pinned to the edge of the
 * viewport for each island that has no box on screen, rotated to point at it, with the
 * number of words waiting there.
 *
 * ── IT SAYS WHERE LAND IS, NOT WHERE THE ANSWER IS ───────────────────────────
 * This is navigation, not a hint. It marks every off-screen island identically whether
 * or not the current target sits on one, so it never narrows the search — the player
 * could reach the same conclusion by pinching out. Q17's rule (no directional aid
 * toward the TARGET) is untouched.
 *
 * Rendered in VIEWPORT space, outside the world layer's transform: a marker pinned to
 * the screen edge must not pan or scale with the map it is pointing at.
 */

export interface OffscreenIsland {
    /** Stable key — the smallest vet id in the island, so it survives a re-render. */
    key: number;
    /** Clamped position on the viewport edge, in screen px. */
    x: number;
    y: number;
    /** Radians from the viewport centre toward the island. */
    angle: number;
    /** How many words are over there. */
    count: number;
}

const MemoryMapIslandCompass: React.FC<{ islands: OffscreenIsland[] }> = ({ islands }) => (
    <>
        {islands.map((island) => (
            <Box
                key={island.key}
                className="memory-map-compass"
                sx={{
                    position: "absolute",
                    left: island.x,
                    top: island.y,
                    // Centre the marker on its clamped point.
                    transform: "translate(-50%, -50%)",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "8px",
                    borderRadius: "999px",
                    backgroundColor: COLORS.card,
                    opacity: 0.85,
                    // Never intercepts a pan: the whole viewport is the pan surface, and
                    // a marker that swallowed touches would create dead zones exactly
                    // where the player most wants to drag (the edges).
                    pointerEvents: "none",
                }}
            >
                <NavigationIcon
                    className="memory-map-compass__arrow"
                    sx={{
                        fontSize: 16,
                        color: COLORS.textSecondary,
                        // NavigationIcon points UP at rest, so it needs a quarter turn
                        // before the bearing (measured from +x) lines up.
                        transform: `rotate(${island.angle + Math.PI / 2}rad)`,
                    }}
                />
                <Typography
                    className="memory-map-compass__count"
                    sx={{
                        fontFamily: FONTS.sans,
                        fontSize: SIZE.micro,
                        fontWeight: WEIGHT.bold,
                        color: COLORS.textSecondary,
                        lineHeight: 1,
                    }}
                >
                    {island.count}
                </Typography>
            </Box>
        ))}
    </>
);

export default MemoryMapIslandCompass;
