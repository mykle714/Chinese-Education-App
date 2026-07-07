import { memo } from "react";
import { Box, Typography } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import ForeignText from "./ForeignText";
import { iconImageUrl } from "../cardIcons/cardIconLayout";
import { stripParentheses } from "../utils/definitionUtils";
import type { DiscoverCard } from "../types";
import type { QuickMarkState } from "./quickMarkState";
import { COLORS } from "../theme/colors";
import { SIZE, WEIGHT } from "../theme/scale";

interface QuickMarkCardProps {
    card: DiscoverCard;
    state: QuickMarkState;
    onCycle: (cardId: number) => void;
    // Optional staggered pop-in on mount (see MiniVocabCard) — the grid passes
    // index * step for the first CASCADE_LIMIT cards, undefined thereafter.
    animationDelayMs?: number;
}

// The top-right 3-state indicator. Empty = hollow ring; library = green check;
// already-learned = solid blue disc with a white "M". Shares the 18px circular
// footprint of the vernacular badge so the two corners read as a matched pair.
const StateIndicator: React.FC<{ state: QuickMarkState }> = ({ state }) => {
    const base = {
        width: 18,
        height: 18,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 1px 2px rgba(0, 0, 0, 0.3)",
    } as const;

    if (state === "library") {
        return (
            <Box className="quick-mark-card__state-indicator quick-mark-card__state-indicator--library" sx={{ ...base, backgroundColor: COLORS.greenMain }}>
                <CheckIcon sx={{ fontSize: 13, color: "white" }} />
            </Box>
        );
    }
    if (state === "already-learned") {
        return (
            <Box
                className="quick-mark-card__state-indicator quick-mark-card__state-indicator--mastered"
                sx={{ ...base, backgroundColor: COLORS.blueMain, color: "white", fontSize: SIZE.micro, fontWeight: WEIGHT.bold }}
            >
                M
            </Box>
        );
    }
    // Empty: a hollow ring on the card surface (no fill, no shadow) so it reads as
    // "unset" rather than a colored state.
    return (
        <Box
            className="quick-mark-card__state-indicator quick-mark-card__state-indicator--empty"
            sx={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${COLORS.border}`, backgroundColor: "transparent" }}
        />
    );
};

// A Quick Mark triage card. Mirrors MiniVocabCard's 92×132 thumbnail geometry so it
// drops into the shared MiniVocabCardGrid, but is driven by a raw DiscoverCard (not a
// saved VocabEntry) and carries two corner badges: the vernacular register (top-left,
// same as Sort Cards) and the tappable 3-state mark indicator (top-right). Tapping the
// card cycles the mark; nothing persists until the page's Save (docs/QUICK_MARK.md).
const QuickMarkCardComponent: React.FC<QuickMarkCardProps> = ({ card, state, onCycle, animationDelayMs }) => {
    return (
        <Box
            className="quick-mark-card"
            onClick={() => onCycle(card.id)}
            sx={{
                width: 92,
                height: 132,
                backgroundColor: COLORS.card,
                borderRadius: "12px",
                boxShadow: "2px 4px 4px rgba(0, 0, 0, 0.25)",
                cursor: "pointer",
                // Same offscreen-skipping containment MiniVocabCard uses — a level can
                // hold hundreds of cards once pages accumulate.
                contentVisibility: "auto",
                containIntrinsicSize: "92px 132px",
                ...(typeof animationDelayMs === "number" && {
                    animation: `cardPopIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) ${animationDelayMs}ms backwards`,
                }),
                position: "relative",
                overflow: "hidden",
                // Intentionally NO hover lift/shadow change: tapping a Quick Mark card
                // cycles its mark, so it should not read as a "raised" interactive tile.
            }}
        >
            {/* Vernacular-register badge — top-left circular tag (1 = literary … 5 =
                natural colloquial), matching the Sort Cards / mini-card badge. */}
            {card.vernacularScore != null && (
                <Box
                    className="quick-mark-card__vernacular-badge"
                    aria-label={`vernacular register ${card.vernacularScore} of 5`}
                    sx={{
                        position: "absolute",
                        top: 8,
                        left: 8,
                        zIndex: 2,
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        backgroundColor: COLORS.onSurface,
                        color: "white",
                        fontSize: SIZE.micro,
                        fontWeight: WEIGHT.bold,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        boxShadow: "0 1px 2px rgba(0, 0, 0, 0.3)",
                    }}
                >
                    {card.vernacularScore}
                </Box>
            )}

            {/* 3-state mark indicator — top-right. */}
            <Box className="quick-mark-card__state-slot" sx={{ position: "absolute", top: 8, right: 8, zIndex: 2 }}>
                <StateIndicator state={state} />
            </Box>

            {/* Icon slot — fixed height so every card reserves identical vertical space. */}
            <Box
                className="quick-mark-card__icon-slot"
                sx={{ position: "absolute", top: 14, left: 8, right: 8, height: 26, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1 }}
            >
                {card.iconId && (
                    <Box
                        component="img"
                        className="quick-mark-card__icon"
                        src={iconImageUrl(card.iconId)}
                        alt=""
                        draggable={false}
                        sx={{ width: 26, height: 26, objectFit: "contain", userSelect: "none" }}
                    />
                )}
            </Box>

            {/* Word + pronunciation via cpcd (ForeignText); plain text for es. */}
            <Box
                className="quick-mark-card__key-wrapper"
                sx={{ position: "absolute", top: 46, left: 8, right: 8, display: "flex", alignItems: "center", justifyContent: "center", minWidth: 0, zIndex: 1 }}
            >
                <ForeignText
                    className="quick-mark-card__entry-key"
                    language={card.language}
                    size="xs"
                    bold
                    flexWrap="wrap"
                    justifyContent="center"
                    text={card.entryKey}
                    pronunciation={card.pronunciation}
                />
            </Box>

            {/* Definition — anchored to the bottom, clamped to 2 lines. */}
            <Typography
                className="quick-mark-card__entry-value"
                sx={{
                    position: "absolute",
                    bottom: 8,
                    left: 8,
                    right: 8,
                    fontSize: SIZE.caption,
                    color: COLORS.textSecondary,
                    textAlign: "center",
                    lineHeight: 1.2,
                    overflow: "hidden",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    minHeight: 24,
                    zIndex: 1,
                }}
            >
                {stripParentheses(card.definition ?? "")}
            </Typography>
        </Box>
    );
};

// Memoized so tapping one card (which changes only that card's `state`) doesn't
// re-render the whole grid. `card` is referentially stable per fetch and `onCycle`
// is a stable useCallback in the page.
const QuickMarkCard = memo(QuickMarkCardComponent);

export default QuickMarkCard;
