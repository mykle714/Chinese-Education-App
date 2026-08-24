import React from "react";
import { COLORS, FONTS, SIZE, WEIGHT } from "../theme";
import ProvisionalCardGrid from "./ProvisionalCardGrid";
import { LentCardIcon } from "./LentCardBadge";
import { useProvisionalEntries } from "../hooks/useProvisionalEntries";
import type { Language, VocabEntry } from "../types";

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
 * Search) the notice ITEMIZES the exact cards — the app's real MiniVocabCard
 * thumbnails, two per row — so the player knows what they're about to meet, what it
 * means, and what the card will look like once it is theirs. Where the surface streams cards continuously (Match Speed
 * deals from a rolling buffer, flp refills the working loop as you go) the set isn't
 * known in advance, so the notice just says temporary cards are in play. That policy is shared with the server as `CARD_BASELINE_ITEMIZED` in
 * server/contracts/wire.ts; callers pass `rows` (or `words`), or omit both for the
 * generic form.
 *
 * TWO WAYS TO SUPPLY THE CARDS
 * A caller holding the served vet rows passes `entries={provisionalEntries(cards)}` —
 * no extra request. Word Search holds only the lent words (its payload carries
 * `provisionalWords`, not vet rows), so it passes `words` and the cards are fetched by
 * `useProvisionalEntries`. Until that lands the notice shows its generic copy rather
 * than a half-built grid.
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
     * The lent cards to preview, when the caller already holds the served vet rows
     * (`provisionalEntries(cards)`). Takes precedence over `words`.
     */
    entries?: VocabEntry[];
    /**
     * The lent words, for a caller that holds only the word list — the cards are
     * fetched from them. Omit both this and `entries` for the generic notice used by the
     * streaming surfaces, which cannot name their set up front.
     */
    words?: string[];
    /** Language of the cards, so they render through ForeignText correctly. */
    language: Language;
    /**
     * True when the surface marks its lent cards in-round with `LentCardBadge`, in
     * which case the footnote teaches the mark. Match Speed does; the surfaces that
     * itemize their set up front do not, and promising a badge they never show would
     * be worse than saying nothing.
     */
    badgedInRound?: boolean;
}

const ProvisionalCardsNotice: React.FC<ProvisionalCardsNoticeProps> = ({
    open,
    onDismiss,
    surfaceName,
    entries,
    words,
    language,
    badgedInRound = false,
}) => {
    // Hooks must run unconditionally, so the fetch is gated by `open` rather than by
    // an early return above it.
    const { entries: previewEntries } = useProvisionalEntries(language, words, entries, open);

    if (!open) return null;

    const itemized = previewEntries.length > 0;

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
                // panning (CLAUDE.md § Touch & Scroll); the card grid opts back in
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
                {/* The badge the learner will meet again in the top-right corner of
                    every borrowed card in the round (src/components/LentCardBadge.tsx).
                    Shown large here so the small in-round mark is already familiar —
                    that recognition is the whole reason both sites share one icon. */}
                <div
                    className="provisional-notice__heading"
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                >
                    <LentCardIcon size={30} className="provisional-notice__lent-icon" />
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
                </div>

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

                {itemized && <ProvisionalCardGrid entries={previewEntries} maxHeight={190} />}

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
                    {badgedInRound ? (
                        <>
                            They're only borrowed for now — look for the{' '}
                            <LentCardIcon size={15} className="provisional-notice__inline-icon" />{' '}
                            in the corner of each one. Your progress on them is saved, and
                            you can keep the ones you like when the round ends.
                        </>
                    ) : (
                        <>
                            They're only borrowed for now — your progress on them is saved,
                            and you can keep the ones you like when the round ends.
                        </>
                    )}
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
                        background: COLORS.successInk,
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
