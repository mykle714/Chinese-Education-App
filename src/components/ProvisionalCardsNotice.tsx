import React from "react";
import { COLORS, FONTS, SIZE, WEIGHT } from "../theme";
import ForeignText from "./ForeignText";
import type { Language } from "../types";

/**
 * ProvisionalCardsNotice — the pre-round "we lent you some cards" popup.
 *
 * WHY IT EXISTS
 * Games and flp no longer refuse to start when the player's deck is too small; the
 * server quietly lends them cards to reach the surface's baseline
 * (docs/PROVISIONAL_CARDS.md). "Quietly" would be the wrong experience, though — the
 * player would see words they never sorted and assume the app was confused. So any
 * round that uses lent cards says so before it starts.
 *
 * ITEMIZED VS GENERIC
 * Where the played set is fixed and known up front (Bubble Match, Speed Reading, Word
 * Search) the notice LISTS the exact words, so the player knows what they're about to
 * meet. Where the surface streams cards continuously (Match Speed deals from a rolling
 * buffer, flp refills the working loop as you go) the set isn't known in advance, so
 * the notice just says temporary cards are in play. That policy is shared with the
 * server as `CARD_BASELINE_ITEMIZED` in server/contracts/wire.ts; callers pass the
 * resulting `words` list, or omit it for the generic form.
 *
 * This is a NOTICE, not a decision: there is one dismiss button and no way to refuse,
 * because refusing would mean not playing — the exact outcome the baseline rework
 * removed.
 *
 * Referenced by: BubbleMatchPage, MatchSpeedPage, SpeedReadingPage, WordSearchPage,
 * FlashcardsLearnPage.
 */
export interface ProvisionalCardsNoticeProps {
    /** Whether the notice is on screen. */
    open: boolean;
    /** Dismiss — the caller starts the round from here. */
    onDismiss: () => void;
    /** The surface's display name, e.g. "Bubble Match". Used in the copy. */
    surfaceName: string;
    /**
     * The lent words to list. Omit (or pass empty) for the generic notice used by the
     * streaming surfaces, which cannot name their set up front.
     */
    words?: string[];
    /** Language of `words`, so they render through ForeignText correctly. */
    language: Language;
}

const ProvisionalCardsNotice: React.FC<ProvisionalCardsNoticeProps> = ({
    open,
    onDismiss,
    surfaceName,
    words,
    language,
}) => {
    if (!open) return null;

    const itemized = Array.isArray(words) && words.length > 0;

    return (
        <div
            className="provisional-notice__backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="provisional-notice-title"
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 1400,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 24,
                background: "rgba(0, 0, 0, 0.45)",
                // The app shell never scrolls and components default to no touch
                // panning (CLAUDE.md § Touch & Scroll); the word list opts back in
                // on its own container below.
                touchAction: "none",
            }}
        >
            <div
                className="provisional-notice__card"
                style={{
                    width: "100%",
                    maxWidth: 380,
                    background: COLORS.infoCard,
                    borderRadius: 20,
                    padding: "24px 22px",
                    boxShadow: "0 12px 32px rgba(0, 0, 0, 0.22)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 14,
                }}
            >
                <h2
                    id="provisional-notice-title"
                    className="provisional-notice__title"
                    style={{
                        margin: 0,
                        fontFamily: FONTS.sans,
                        fontSize: SIZE.title,
                        fontWeight: WEIGHT.bold,
                        color: COLORS.onSurface,
                    }}
                >
                    Here are some cards to play with
                </h2>

                <p
                    className="provisional-notice__body"
                    style={{
                        margin: 0,
                        fontFamily: FONTS.sans,
                        fontSize: SIZE.bodyLg,
                        lineHeight: 1.45,
                        color: COLORS.textSecondary,
                    }}
                >
                    {itemized
                        ? `You didn't have enough cards for ${surfaceName}, so we've added these temporary ones to your round:`
                        : `You didn't have enough cards for ${surfaceName}, so we've added some temporary ones to your round.`}
                </p>

                {itemized && (
                    <div
                        className="provisional-notice__word-list"
                        style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 8,
                            // The list is the one scrollable region — a large lent set
                            // must not grow the dialog past the viewport.
                            maxHeight: 190,
                            overflowY: "auto",
                            touchAction: "pan-y",
                            padding: 2,
                        }}
                    >
                        {words!.map((word) => (
                            <span
                                key={word}
                                className="provisional-notice__word-chip"
                                style={{
                                    background: COLORS.iconBg,
                                    borderRadius: 999,
                                    padding: "6px 12px",
                                    display: "inline-flex",
                                    alignItems: "center",
                                }}
                            >
                                <ForeignText text={word} language={language} size="sm" />
                            </span>
                        ))}
                    </div>
                )}

                <p
                    className="provisional-notice__footnote"
                    style={{
                        margin: 0,
                        fontFamily: FONTS.sans,
                        fontSize: SIZE.body,
                        lineHeight: 1.4,
                        color: COLORS.textSecondary,
                    }}
                >
                    They're only borrowed for now — your progress on them is saved, and you
                    can keep the ones you like when the round ends.
                </p>

                <button
                    type="button"
                    className="provisional-notice__dismiss-button"
                    onClick={onDismiss}
                    style={{
                        marginTop: 4,
                        border: "none",
                        borderRadius: 14,
                        padding: "13px 18px",
                        background: COLORS.greenMain,
                        color: "#FFFFFF",
                        fontFamily: FONTS.sans,
                        fontSize: SIZE.bodyLg,
                        fontWeight: WEIGHT.bold,
                        cursor: "pointer",
                    }}
                >
                    Let's play
                </button>
            </div>
        </div>
    );
};

export default ProvisionalCardsNotice;
