import { useCallback, useState } from "react";
import { Box, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import { TIPS } from "../data/tips";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { SIZE, LEADING } from "../theme/scale";

/** Picks a random tip index, excluding `exclude` when there's more than one
    tip to pick from (so a re-roll never repeats what's already shown). */
function randomTipIndex(exclude?: number): number {
    if (TIPS.length <= 1) return 0;
    let idx = Math.floor(Math.random() * TIPS.length);
    while (idx === exclude) idx = Math.floor(Math.random() * TIPS.length);
    return idx;
}

const TipCard = styled(Box)(() => ({
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: "80%",
    margin: "0 auto",
    padding: "16px 20px",
    borderRadius: "20px",
    backgroundColor: COLORS.infoCard,
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
            <Typography component="span" aria-hidden sx={{ fontSize: 20, flexShrink: 0 }}>
                💡
            </Typography>
            <Typography
                className="tip-box__text"
                sx={{ fontSize: SIZE.body, color: COLORS.onSurface, fontFamily: FONTS.sans, lineHeight: LEADING.normal }}
            >
                {TIPS[index]}
            </Typography>
        </TipCard>
    );
};

export default TipBox;
