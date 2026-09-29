import { memo } from "react";
import { Box } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import MiniCard, { MiniCardFrequencyBadge } from "./MiniCard";
import { stripParentheses } from "../utils/definitionUtils";
import type { DiscoverCard } from "../types";
import type { QuickMarkState } from "./quickMarkState";
import { COLORS } from "../theme/colors";
import { SIZE, WEIGHT } from "../theme/scale";
import { SHADOW } from "../theme/shadows";

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
// footprint of the frequency badge so the two corners read as a matched pair.
const StateIndicator: React.FC<{ state: QuickMarkState }> = ({ state }) => {
    const base = {
        width: 18,
        height: 18,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: SHADOW.rest,
    } as const;

    if (state === "library") {
        return (
            <Box className="quick-mark-card__state-indicator quick-mark-card__state-indicator--library" sx={{ ...base, backgroundColor: COLORS.successInk }}>
                <CheckIcon sx={{ fontSize: 13, color: COLORS.white }} />
            </Box>
        );
    }
    if (state === "already-learned") {
        return (
            <Box
                className="quick-mark-card__state-indicator quick-mark-card__state-indicator--mastered"
                sx={{ ...base, backgroundColor: COLORS.infoInk, color: COLORS.white, fontSize: SIZE.micro, fontWeight: WEIGHT.bold }}
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

// A Quick Mark triage card: the shared MiniCard (src/components/MiniCard.tsx), driven by
// a raw DiscoverCard (not a saved VocabEntry), with two corner overlays — the conversation
// frequency (top-left) and the tappable 3-state mark indicator (top-right). No mastery
// strip: these words aren't the learner's cards yet. Tapping cycles the mark; nothing
// persists until the page's Save (docs/QUICK_MARK.md).
const QuickMarkCardComponent: React.FC<QuickMarkCardProps> = ({ card, state, onCycle, animationDelayMs }) => (
    <MiniCard
        className="quick-mark-card"
        onClick={() => onCycle(card.id)}
        language={card.language}
        entryKey={card.entryKey}
        pronunciation={card.pronunciation}
        definition={stripParentheses(card.definition ?? "")}
        iconId={card.iconId}
        // NO `hoverLift`, on purpose: tapping a Quick Mark card cycles its mark in place,
        // so it must not read as a tile that will take you somewhere.
        animationDelayMs={animationDelayMs}
        sx={{ cursor: "pointer" }}
    >
        <MiniCardFrequencyBadge score={card.frequencyScore} className="quick-mark-card__frequency-badge" />
        {/* 3-state mark indicator — top-right. */}
        <Box className="quick-mark-card__state-slot" sx={{ position: "absolute", top: 8, right: 8, zIndex: 2 }}>
            <StateIndicator state={state} />
        </Box>
    </MiniCard>
);

// Memoized so tapping one card (which changes only that card's `state`) doesn't
// re-render the whole grid. `card` is referentially stable per fetch and `onCycle`
// is a stable useCallback in the page.
const QuickMarkCard = memo(QuickMarkCardComponent);

export default QuickMarkCard;
