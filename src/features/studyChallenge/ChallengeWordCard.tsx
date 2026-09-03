import { memo } from "react";
import { Box, ButtonBase, Typography, useTheme } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import ForeignText from "../../components/ForeignText";
import { iconImageUrl } from "../../cardIcons/cardIconLayout";
import { stripParentheses } from "../../utils/definitionUtils";
import { COLORS } from "../../theme/colors";
import { SIZE, WEIGHT } from "../../theme/scale";
import {
    CHALLENGE_STRIKE_FADE_MS,
    CHALLENGE_WORD_CARD_WIDTH,
} from "./challengeStyles";
import type { ChallengeReviewWord } from "./reviewWord";
import { SHADOW } from "../../theme/shadows";
import { miniCardFaceSx, MINI_CARD_RING } from "../../components/miniCardFace";

interface ChallengeWordCardProps {
    word: ChallengeReviewWord;
    /**
     * Omit to draw the card with NO strike affordance — the read-only use (the detail
     * page's word set, where the nine are settled and nothing about them can change).
     */
    onStrike?: (word: ChallengeReviewWord) => void;
    /** Is this the card the user has tapped? The panel owns the selection, not the card. */
    selected?: boolean;
    /** Tapping the thumbnail — selects, it does not strike. */
    onSelect?: (word: ChallengeReviewWord) => void;
    /**
     * This card has been struck and is on its way out — fade and shrink it, then the
     * panel swaps the replacement into the slot once the fade has run
     * (CHALLENGE_STRIKE_FADE_MS). The card only ANIMATES; it never decides when it is
     * replaced, because the swap also waits on the server's answer.
     */
    fading?: boolean;
    disabled?: boolean;
    /** Staggered pop-in on mount — the grid passes index * step; see MiniVocabCard. */
    animationDelayMs?: number;
}

/**
 * One word in the challenge word set (docs/STUDY_CHALLENGE.md § 3.2), drawn as the
 * app's mini preview card.
 *
 * ⚠️ STRIKING IS TWO TAPS, AND THAT IS THE WHOLE POINT. A strike writes Mastered to
 * the user's own card IMMEDIATELY and permanently, so it must not be reachable by a
 * single mis-aimed tap on a 92px thumbnail. The first tap only SELECTS: the card fills
 * with the mastered blue and raises one labelled pill over its bottom edge. The second
 * tap, on that pill, is the one that commits.
 *
 * This replaced a permanently-visible "I know it" button under every card. The button
 * was safe for the same reason, but it printed the strike affordance nine times on a
 * screen whose subject is the words, and it forced every grid row to reserve 32px it
 * only needed while the set was still editable. The pill costs no layout at all —
 * it is absolutely positioned over the card it belongs to.
 *
 * The 92×132 thumbnail matches MiniVocabCard and QuickMarkCard exactly, so all three
 * drop into the shared MiniVocabCardGrid and read as one family. It is driven by a
 * ChallengeReviewWord rather than a VocabEntry because a challenge word is not a card
 * yet — it becomes a vet row only on accept (§ 3.3).
 */
const ChallengeWordCardComponent: React.FC<ChallengeWordCardProps> = ({
    word,
    onStrike,
    selected = false,
    onSelect,
    fading = false,
    disabled = false,
    animationDelayMs,
}) => {
    const fc = useTheme().palette.flashcard;
    // Selectable only while the set is still editable — the read-only use passes no
    // `onStrike`, and then the card is inert rather than tappable-but-pointless.
    const strikeable = !!onStrike && !!onSelect;
    return (
        <Box
            className="challenge-word-card"
            sx={{
                width: CHALLENGE_WORD_CARD_WIDTH,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 0.5,
                // The confirm pill hangs over the card's bottom edge, so the card must
                // not clip it. The grid reserves no space for it (see
                // `challengeWordCardHeight`) — a pill is transient, a gap is not.
                position: "relative",
                // Exit animation. It sits on the OUTER box so the confirm pill leaves
                // with the card it belongs to rather than hanging over the empty slot.
                opacity: fading ? 0 : 1,
                transform: fading ? "scale(0.86)" : "scale(1)",
                transition: `opacity ${CHALLENGE_STRIKE_FADE_MS}ms ease, transform ${CHALLENGE_STRIKE_FADE_MS}ms ease`,
                // A fading card is mid-commit: nothing on it should still be tappable.
                pointerEvents: fading ? "none" : "auto",
                ...(typeof animationDelayMs === "number" && {
                    animation: `cardPopIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) ${animationDelayMs}ms backwards`,
                }),
            }}
        >
            <Box
                component={strikeable ? ButtonBase : "div"}
                className={`challenge-word-card__thumbnail${selected ? " challenge-word-card__thumbnail--selected" : ""}`}
                onClick={strikeable && !disabled ? () => onSelect!(word) : undefined}
                disabled={strikeable ? disabled : undefined}
                aria-pressed={strikeable ? selected : undefined}
                sx={{
                    // The shared face (src/components/miniCardFace.ts) — the SAME tile
                    // MiniVocabCard draws on the fdp and QuickMarkCard draws in triage.
                    // It used to re-declare the geometry with a comment promising it
                    // matched them, and had already lost the hairline ring.
                    //
                    // Selected fills with the mastered blue — the same ink the app uses
                    // for a comfortable/mastered card everywhere else, which is exactly
                    // the claim the strike is about to make.
                    ...miniCardFaceSx({ background: selected ? COLORS.blu : fc.flashCard }),
                    // A ButtonBase defaults to centred flow content; everything inside
                    // this card is absolutely positioned, so the display must stay block
                    // or the icon slot and the gloss both drift.
                    display: "block",
                    textAlign: "initial",
                    // Selection adds an OUTER 2px ring on top of the face's hairline —
                    // composed rather than replacing it, so a selected card is still the
                    // same tile with a mark on it.
                    ...(selected && {
                        boxShadow: `0 0 0 2px ${COLORS.bluA}, ${MINI_CARD_RING}, ${SHADOW.raised}`,
                    }),
                    transition: "background-color 140ms ease, box-shadow 140ms ease",
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
                            boxShadow: SHADOW.rest,
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

            {/* The confirm pill — the SECOND tap, and the only one that writes anything.
                It straddles the card's bottom edge so it reads as belonging to this card
                and to no other, and it exists only while this card is selected. */}
            {strikeable && selected && (
                <ButtonBase
                    className="challenge-word-card__confirm-strike"
                    onClick={() => onStrike!(word)}
                    disabled={disabled}
                    sx={{
                        position: "absolute",
                        left: "50%",
                        bottom: 0,
                        transform: "translate(-50%, 50%)",
                        zIndex: 3,
                        display: "flex",
                        alignItems: "center",
                        gap: 0.5,
                        whiteSpace: "nowrap",
                        backgroundColor: COLORS.bluA,
                        color: "#fff",
                        borderRadius: "999px",
                        px: 1.4,
                        py: 0.75,
                        fontSize: SIZE.micro,
                        fontWeight: WEIGHT.semibold,
                        boxShadow: SHADOW.raised,
                    }}
                >
                    <CheckIcon sx={{ fontSize: 12 }} />
                    Mark as known
                </ButtonBase>
            )}
        </Box>
    );
};

// Memoized: striking one word replaces exactly one entry in the list, and the other
// nine cards must not re-render. `onStrike` is a useCallback in the page.
const ChallengeWordCard = memo(ChallengeWordCardComponent);

export default ChallengeWordCard;
