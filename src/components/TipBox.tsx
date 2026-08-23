import { useCallback, useState } from "react";
import { Box, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import { TIPS } from "../data/tips";
import Icon from "./Icon";
import { COLORS, RAMP } from "../theme/colors";
import { FONTS } from "../theme/fonts";

/** Picks a random tip index, excluding `exclude` when there's more than one
    tip to pick from (so a re-roll never repeats what's already shown). */
function randomTipIndex(exclude?: number): number {
    if (TIPS.length <= 1) return 0;
    let idx = Math.floor(Math.random() * TIPS.length);
    while (idx === exclude) idx = Math.floor(Math.random() * TIPS.length);
    return idx;
}

/**
 * `.tip` (docs/SHELF_REDESIGN.md § A5) — the advisory box.
 *
 * The 16px TOP margin is load-bearing and was the bug that prompted this restyle:
 * the box used to be a hub-menu HEADER, where the menu below supplied the gap, so it
 * shipped with `margin: 0 auto`. The bento grid ends with `padding-bottom: 0` (a grid
 * owns the space between its own rows, not below itself), so once the tip moved BELOW
 * the grid it sat flush against the last tile. Neither side was wrong on its own —
 * the gap simply had no owner once the order flipped. It belongs to the tip.
 *
 * `alignItems: flex-start` because the text wraps to 2–3 lines and a centred icon
 * drifts to the middle of the paragraph instead of marking its first line.
 */
const TipCard = styled(Box)(() => ({
    display: "flex",
    alignItems: "flex-start",
    gap: 11,
    margin: "16px 18px 0",
    padding: "13px 15px",
    borderRadius: "16px",
    // A pastel fill with its OWN ink on it — the ramp's canonical "icon on a coloured
    // ground" pair. Large and occupied, so no `markOutline` (see BentoTile).
    backgroundColor: RAMP.org.fill,
    cursor: "pointer",
    userSelect: "none",
    transition: "filter 120ms ease",
    "&:hover": {
        filter: "brightness(0.97)",
    },
    "&:active": {
        transform: "scale(0.98)",
    },
}));

/**
 * Tappable tip card drawing from a hardcoded, frontend-shipped pool
 * (src/data/tips.ts) — not a database table. Picks a random tip on mount and
 * re-rolls (excluding the currently-shown tip) on tap. The same component is
 * reused as-is across the Home/Games/Discover hub headers/footers so every
 * hub draws from one shared pool.
 */
const TipBox: React.FC<{ className?: string }> = ({ className }) => {
    const [index, setIndex] = useState(() => randomTipIndex());

    const reroll = useCallback(() => {
        setIndex((prev) => randomTipIndex(prev));
    }, []);

    return (
        <TipCard
            className={className ?? "tip-box"}
            onClick={reroll}
            role="button"
            aria-label="Show another tip"
        >
            {/* Was a 💡 emoji, which renders in the platform's own colours and clashes
                with a flat pastel ground. The ramp's orange ink keeps it in-palette. */}
            <Icon name="lightbulb" size={18} color={RAMP.org.ink} sx={{ flexShrink: 0, marginTop: "1px" }} />
            <Typography
                className="tip-box__text"
                sx={{ fontSize: 12.5, color: COLORS.iconColor, fontFamily: FONTS.sans, lineHeight: 1.45 }}
            >
                {TIPS[index]}
            </Typography>
        </TipCard>
    );
};

export default TipBox;
