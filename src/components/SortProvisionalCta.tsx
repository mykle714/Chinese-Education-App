import React from "react";
import { useNavigate } from "react-router-dom";
import { COLORS, FONTS, SIZE, WEIGHT } from "../theme";
import type { Language } from "../types";

/**
 * SortProvisionalCta — the end-of-round "keep the cards you played" button.
 *
 * A round that was topped up with temporary cards (docs/PROVISIONAL_CARDS.md) ends
 * with an offer rather than a silent cleanup: the player just spent a game with those
 * words, which is the best possible moment to ask whether they want to keep them.
 * Tapping it opens the sort flow in SET MODE, seeded with exactly the words this round
 * used — see `?set=provisional` in SortCardsPage.
 *
 * Nothing is lost by ignoring it. The temporary cards stay, marks earned on them stay,
 * and the same offer appears after the next round; sorting later still preserves the
 * progress (StarterPacksService.sortCard promotes the row in place).
 *
 * Renders nothing when the round used no temporary cards, so callers can mount it
 * unconditionally on their completion screen.
 *
 * Referenced by: BubbleMatchPage, MatchSpeedPage, SpeedReadingPage, WordSearchPage,
 * FlashcardsLearnPage.
 */
export interface SortProvisionalCtaProps {
    /** The temporary words this round used (from `provisionalWords(cards)`). */
    words: string[];
    /** Study language — selects which sort flow to open. */
    language: Language;
    /** Optional override for the button label. */
    label?: string;
    /** Called just before navigating, e.g. to tear down a game loop. */
    onNavigate?: () => void;
}

const SortProvisionalCta: React.FC<SortProvisionalCtaProps> = ({
    words,
    language,
    label,
    onNavigate,
}) => {
    const navigate = useNavigate();

    if (!words || words.length === 0) return null;

    const handleClick = (): void => {
        onNavigate?.();
        // Set mode + the exact word list. SortCardsPage intersects this against what the
        // server still holds as provisional, so a stale list can only shrink the set.
        navigate(
            `/discover/sort/${language}?set=provisional&words=${encodeURIComponent(words.join(","))}`
        );
    };

    return (
        <button
            type="button"
            className="sort-provisional-cta__button"
            onClick={handleClick}
            style={{
                border: "none",
                borderRadius: 14,
                padding: "13px 20px",
                background: COLORS.blueMain,
                color: "#FFFFFF",
                fontFamily: FONTS.sans,
                fontSize: SIZE.bodyLg,
                fontWeight: WEIGHT.bold,
                cursor: "pointer",
            }}
        >
            {label ?? `Keep ${words.length === 1 ? "this card" : `these ${words.length} cards`}`}
        </button>
    );
};

export default SortProvisionalCta;
