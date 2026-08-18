import { memo } from "react";
import { Box, Button, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ForeignText from "../../components/ForeignText";
import { iconImageUrl } from "../../cardIcons/cardIconLayout";
import { stripParentheses } from "../../utils/definitionUtils";
import { COLORS } from "../../theme/colors";
import { SIZE, WEIGHT } from "../../theme/scale";
import {
    CHALLENGE_WORD_CARD_WIDTH,
    CHALLENGE_WORD_THUMBNAIL_HEIGHT as THUMBNAIL_HEIGHT,
} from "./challengeStyles";
import type { ChallengeReviewWord } from "./reviewWord";

interface ChallengeWordCardProps {
    word: ChallengeReviewWord;
    /**
     * Omit to draw the card with NO button — the read-only use (the detail page's
     * word set, where the ten are settled and nothing about them can change).
     */
    onStrike?: (word: ChallengeReviewWord) => void;
    disabled?: boolean;
    /** Staggered pop-in on mount — the grid passes index * step; see MiniVocabCard. */
    animationDelayMs?: number;
}

/**
 * One word in the challenge review flow (docs/STUDY_CHALLENGE.md § 3.2), drawn as
 * the app's mini preview card with its strike button BELOW it.
 *
 * ⚠️ THE BUTTON IS DELIBERATELY NOT ON THE CARD, and the card itself is deliberately
 * not tappable. Quick Mark's card cycles a mark by tapping the thumbnail because
 * that mark is provisional until Save; a strike here writes Mastered to the user's
 * own card IMMEDIATELY and permanently, so it gets an explicit labelled control that
 * cannot be hit by a mis-aimed tap on the word.
 *
 * The 92×132 thumbnail matches MiniVocabCard and QuickMarkCard exactly, so all three
 * drop into the shared MiniVocabCardGrid and read as one family. It is driven by a
 * ChallengeReviewWord rather than a VocabEntry because a challenge word is not a card
 * yet — it becomes a vet row only on accept (§ 3.3).
 */
const ChallengeWordCardComponent: React.FC<ChallengeWordCardProps> = ({
    word,
    onStrike,
    disabled = false,
    animationDelayMs,
}) => {
    return (
        <Box
            className="challenge-word-card"
            sx={{
                width: CHALLENGE_WORD_CARD_WIDTH,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 0.5,
                ...(typeof animationDelayMs === "number" && {
                    animation: `cardPopIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) ${animationDelayMs}ms backwards`,
                }),
            }}
        >
            <Box
                className="challenge-word-card__thumbnail"
                sx={{
                    width: CHALLENGE_WORD_CARD_WIDTH,
                    height: THUMBNAIL_HEIGHT,
                    backgroundColor: COLORS.card,
                    borderRadius: "12px",
                    boxShadow: "2px 4px 4px rgba(0, 0, 0, 0.25)",
                    position: "relative",
                    overflow: "hidden",
                    // Ten cards at most, but the containment costs nothing and keeps
                    // the geometry identical to the other two mini cards.
                    contentVisibility: "auto",
                    containIntrinsicSize: `${CHALLENGE_WORD_CARD_WIDTH}px ${THUMBNAIL_HEIGHT}px`,
                }}
            >
                {/* Conversation-frequency badge — top-left, the same 18px circular tag
                    Sort Cards and Quick Mark use (1 = almost never spoken … 5 = constant
                    in daily speech). It is real information for this decision: a rare
                    word is a fair thing to strike. */}
                {word.frequencyScore != null && (
                    <Box
                        className="challenge-word-card__frequency-badge"
                        aria-label={`conversation frequency ${word.frequencyScore} of 5`}
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
                        {word.frequencyScore}
                    </Box>
                )}

                {/* Icon slot — fixed height so every card reserves identical vertical space. */}
                <Box
                    className="challenge-word-card__icon-slot"
                    sx={{ position: "absolute", top: 14, left: 8, right: 8, height: 26, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1 }}
                >
                    {word.iconId && (
                        <Box
                            component="img"
                            className="challenge-word-card__icon"
                            src={iconImageUrl(word.iconId)}
                            alt=""
                            draggable={false}
                            sx={{ width: 26, height: 26, objectFit: "contain", userSelect: "none" }}
                        />
                    )}
                </Box>

                {/* Word + pronunciation. Foreign text ALWAYS goes through ForeignText — it
                    is the public container that decides cpcd vs plain Latin text per
                    language. Never render a foreign word directly. */}
                <Box
                    className="challenge-word-card__key-wrapper"
                    sx={{ position: "absolute", top: 46, left: 8, right: 8, display: "flex", alignItems: "center", justifyContent: "center", minWidth: 0, zIndex: 1 }}
                >
                    <ForeignText
                        className="challenge-word-card__entry-key"
                        language={word.language}
                        size="xs"
                        bold
                        flexWrap="wrap"
                        justifyContent="center"
                        text={word.word1}
                        pronunciation={word.pronunciation}
                    />
                </Box>

                {/* The English — anchored to the bottom, clamped to 2 lines.
                    WITHOUT IT THE DECISION IS UNANSWERABLE: "do I already know this
                    word" cannot be judged from the characters alone, since the reviewer
                    may know a different sense of a word they recognise. */}
                <Typography
                    className="challenge-word-card__definition"
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
                    {stripParentheses(word.definition ?? "")}
                </Typography>
            </Box>

            {onStrike && (
                <Button
                    className="challenge-word-card__strike"
                    onClick={() => onStrike(word)}
                    disabled={disabled}
                    startIcon={<CloseIcon sx={{ fontSize: 12 }} />}
                    sx={{
                        minWidth: 0,
                        width: "100%",
                        height: 26,
                        p: 0,
                        textTransform: "none",
                        fontFamily: "inherit",
                        fontSize: SIZE.micro,
                        color: COLORS.textSecondary,
                        // The icon's default 8px right margin eats a third of a 92px button.
                        "& .MuiButton-startIcon": { mr: 0.25, ml: 0 },
                    }}
                >
                    I know it
                </Button>
            )}
        </Box>
    );
};

// Memoized: striking one word replaces exactly one entry in the list, and the other
// nine cards must not re-render. `onStrike` is a useCallback in the page.
const ChallengeWordCard = memo(ChallengeWordCardComponent);

export default ChallengeWordCard;
