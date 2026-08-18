import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Box, Button, Typography } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import NodePage from "../../components/NodePage";
import { FooterSpacer } from "../../components/MobileFooter";
import MiniVocabCardGrid from "../../components/MiniVocabCardGrid";
import {
    acceptChallenge,
    declineChallenge,
    fetchChallenge,
    fetchChallengeCandidates,
    issueChallenge,
    strikeChallengeWord,
} from "../../api/studyChallenges";
import type { ChallengeSummary } from "../../api/studyChallenges";
import type { ChallengeVariant, VocabEntry } from "../../types";
import { CHALLENGE_WORD_COUNT } from "../../types";
import { useAuth } from "../../AuthContext";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { acceptByLabel, challengeErrorMessage } from "./challengeLabels";
import { challengeCardSx, challengeMessageSx, challengeMutedSx, challengeWordCardHeight } from "./challengeStyles";
import ChallengeWordCard from "./ChallengeWordCard";
import { candidateToReviewWord, storedWordToReviewWord } from "./reviewWord";
import type { ChallengeReviewWord } from "./reviewWord";

/**
 * The word-set review flow (docs/STUDY_CHALLENGE.md § 3.2) — ONE screen for BOTH
 * sides, at different times:
 *
 *   challenger:  see 10 → strike any "I already know this" → replaced → Send
 *   challengee:  see the 10 → strike any → replaced → Accept
 *
 * Two routes land here. `/new/:friendUserId` builds a fresh set (the challenger);
 * `/review/:challengeId` reviews the set the challenger confirmed (the challengee).
 * The screen is the same because the DECISION is the same, and § 8.2 explicitly
 * permits presenting accept-then-pick this way: the challenge only becomes `accepted`
 * on the final confirm at the bottom of this page, so abandoning it leaves the
 * challenge exactly `pending` and the challengee can come back until their deadline.
 *
 * ⚠️ A STRIKE IS NOT A LOCAL UI GESTURE. "I already know this" writes Mastered to the
 * striker's OWN card immediately (through the same path discover's Already-Learned
 * sort uses), which removes the word from discover and from every future challenge —
 * permanently. That is why the copy says so plainly rather than looking like a filter.
 * It is also why there is NO CAP on strikes: the whole cost falls on the striker, so
 * the mechanism polices itself, and the honest guard is clear copy rather than a limit.
 */
function ChallengeReviewPage() {
    const { friendUserId, challengeId } = useParams<{ friendUserId?: string; challengeId?: string }>();
    const isIssuing = !!friendUserId;
    usePageTitle(isIssuing ? "New Challenge" : "Review Words");

    const slideNavigate = useSlideNavigate();
    const { isAuthenticated } = useAuth();

    const [challenge, setChallenge] = useState<ChallengeSummary | null>(null);
    /**
     * The list the page draws — ONE state for both flows, and the only source the
     * tiles read.
     *
     * It is loaded once and then edited IN PLACE by `handleStrike`: a strike swaps
     * exactly the struck tile for the replacement the server just named. The list is
     * never re-fetched on a strike, because a reload would re-render all ten rows and
     * could reorder the untouched nine under the reviewer's thumb.
     */
    const [words, setWords] = useState<ChallengeReviewWord[]>([]);
    const [struck, setStruck] = useState<string[]>([]);
    /**
     * The replacements the server handed back, in the order it handed them back.
     *
     * Reviewing only: the accept call echoes these so the set that is COMMITTED is
     * the set that was on screen. Issuing does not need them — the issue call rebuilds
     * the same ranked prefix from `struck` alone.
     */
    const [replacements, setReplacements] = useState<string[]>([]);
    const [variant] = useState<ChallengeVariant>("same_word");
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /**
     * Load the initial ten.
     *
     * Issuing reads CANDIDATES (there is no challenge yet); reviewing reads the
     * challenge's own stored words — which is the rule from § 9, Q55: the LIST always
     * comes from the challenge, never from a vet or deck query. That is what guarantees
     * both players see the same ten regardless of the state of anyone's library.
     *
     * Keyed on isAuthenticated + the route ids, never on `token` — and NEVER on
     * `struck`, which is what used to make a strike reload the whole list.
     */
    useEffect(() => {
        let cancelled = false;
        setLoading(true);

        const load = isIssuing
            ? fetchChallengeCandidates(friendUserId!, variant).then((list) => {
                if (!cancelled) setWords(list.map(candidateToReviewWord));
            })
            : fetchChallenge(challengeId!).then((result) => {
                if (cancelled) return;
                setChallenge(result);
                // The challenge stores identity only (Q49); the server resolves the det
                // display fields on the way out, so a stored word carries the same
                // pinyin, English, frequency and icon a candidate does and draws through
                // the same card.
                setWords(result.words.map(storedWordToReviewWord));
            });

        load
            .then(() => { if (!cancelled) setError(null); })
            .catch((err: unknown) => {
                if (!cancelled) setError(challengeErrorMessage(err, "Could not load the challenge words"));
            })
            .finally(() => { if (!cancelled) setLoading(false); });

        return () => { cancelled = true; };
    }, [isAuthenticated, isIssuing, friendUserId, challengeId, variant]);

    /**
     * Strike a word — IDENTICAL ON BOTH SIDES (§ 3.2).
     *
     * One round trip does two things in a fixed order: it writes Mastered to the
     * striker's own card, and only then draws the replacement — drawing first would
     * rank the very word being struck straight back in. The response is that one
     * replacement, which is spliced into the struck word's slot so the other nine
     * tiles never move.
     *
     * The exclusion set is everything currently on screen plus everything struck this
     * session, so a replacement can never duplicate a visible word.
     */
    const handleStrike = useCallback(async (word: ChallengeReviewWord) => {
        if (busy) return;
        setBusy(true);
        try {
            const exclude = [...words.map((w) => w.word1), ...struck];
            // Pass whichever handle this side holds: the challenger has the candidate's
            // det id, the challengee has only the stored word. The server resolves the
            // latter, so BOTH sides can strike.
            const replacement = await strikeChallengeWord(
                word.dictionaryEntryId
                    ? { dictionaryEntryId: word.dictionaryEntryId }
                    : { word1: word.word1 },
                isIssuing
                    ? { friendUserId, variant, exclude }
                    : { challengeId, exclude }
            );

            setStruck((prev) => [...prev, word.word1]);
            setWords((prev) => {
                const index = prev.findIndex((w) => w.word1 === word.word1);
                if (index < 0) return prev;
                // No replacement means the discoverable supply is exhausted — the slot
                // is dropped and the set ships short, which § 3.1 prefers to refusing.
                if (!replacement) return prev.filter((_, i) => i !== index);
                const next = [...prev];
                next[index] = candidateToReviewWord(replacement);
                return next;
            });
            if (replacement) setReplacements((prev) => [...prev, replacement.word1]);
            setError(null);
        } catch (err: unknown) {
            setError(challengeErrorMessage(err, "Could not mark that word as known"));
        } finally {
            setBusy(false);
        }
    }, [busy, words, struck, isIssuing, friendUserId, challengeId, variant]);

    /**
     * The final confirm — the tap that actually creates or accepts the challenge.
     *
     * ONLY THE ACCEPT ECHOES ITS REPLACEMENTS. Issuing does not need to: the
     * candidate query is a deterministic ranking (both-chose, then frequency, then
     * det id), so "the top ten excluding what I struck" — what `issueChallenge`
     * rebuilds from `struck` alone — is exactly the list on screen. A stored set has
     * no such ranking to rebuild from, so the challengee's replacements travel with
     * the accept.
     */
    const handleConfirm = useCallback(async () => {
        if (busy) return;
        setBusy(true);
        try {
            if (isIssuing) {
                await issueChallenge(friendUserId!, variant, struck);
            } else {
                await acceptChallenge(challengeId!, struck, replacements);
            }
            slideNavigate("/friends/challenges");
        } catch (err: unknown) {
            setError(challengeErrorMessage(err, isIssuing ? "Could not send the challenge" : "Could not accept the challenge"));
        } finally {
            setBusy(false);
        }
    }, [busy, isIssuing, friendUserId, challengeId, variant, struck, replacements, slideNavigate]);

    /**
     * Decline (challengee only). Ends the invitation explicitly rather than letting it
     * lapse — and blocks a new challenge with this friend until the next Monday, since
     * the declined row keeps the pair's week. Any Mastered writes made while reviewing
     * persist: they were real statements about the learner's own knowledge.
     */
    const handleDecline = useCallback(async () => {
        if (busy || !challengeId) return;
        setBusy(true);
        try {
            await declineChallenge(challengeId);
            slideNavigate("/friends/challenges");
        } catch (err: unknown) {
            setError(challengeErrorMessage(err, "Could not decline the challenge"));
        } finally {
            setBusy(false);
        }
    }, [busy, challengeId, slideNavigate]);

    /**
     * MiniVocabCardGrid takes VocabEntry[] and hands each entry back to `renderCard`.
     * A challenge word is NOT a vet row (it becomes one only on accept, § 3.3), so —
     * exactly as Quick Mark does with a DiscoverCard — the list is cast for the grid
     * and the real word is looked up by `word1` in `renderCard`.
     *
     * `id` is the det id where there is one, falling back to the word's index: the
     * grid only uses it as a React key, and a word whose det row has gone away still
     * has to draw.
     */
    const gridEntries = useMemo(
        () => words.map((w, index) => ({
            id: w.dictionaryEntryId ?? index,
            entryKey: w.word1,
        })) as unknown as VocabEntry[],
        [words]
    );

    const renderCard = useCallback(
        (entry: VocabEntry, _index: number, animationDelayMs?: number) => {
            const word = words.find((w) => w.word1 === entry.entryKey);
            if (!word) return null;
            return (
                <ChallengeWordCard
                    key={word.word1}
                    word={word}
                    onStrike={handleStrike}
                    disabled={busy}
                    animationDelayMs={animationDelayMs}
                />
            );
        },
        [words, handleStrike, busy]
    );

    const title = isIssuing ? "New Challenge" : "Review Words";

    return (
        <NodePage
            title={title}
            activePage="home"
            onBack={() => slideNavigate("/friends/challenges")}
            contentClassName="challenge-review-page__content"
        >
            <Box className="challenge-review-page" sx={{ display: "flex", flexDirection: "column", gap: 2, px: 2, pt: 1 }}>

                <Box className="challenge-review-page__intro" sx={challengeCardSx}>
                    <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, fontWeight: WEIGHT.semibold, color: COLORS.onSurface }}>
                        {isIssuing
                            ? `These ${CHALLENGE_WORD_COUNT} words are the challenge`
                            : `${challenge?.opponent.name || "Your friend"} challenged you`}
                    </Typography>
                    {/* The format IS disclosed — the words and the variant. The GAMES are
                        not, and are not knowable until Friday (§ 5.1b), so the copy does
                        not promise them. */}
                    <Typography sx={{ ...challengeMutedSx, mt: 0.5 }}>
                        You both study them all week, then play the same games against them on Friday.
                    </Typography>
                    {!isIssuing && challenge && (
                        <Typography sx={{ ...challengeMutedSx, mt: 0.5 }}>{acceptByLabel(challenge)}</Typography>
                    )}
                </Box>

                {error && (
                    <Typography className="challenge-review-page__error" sx={challengeMessageSx}>{error}</Typography>
                )}

                <MiniVocabCardGrid
                    containerClassName="challenge-review-page__words"
                    classPrefix="challenge-review-page"
                    loading={loading}
                    entries={gridEntries}
                    emptyMessage="No words are available for this challenge right now."
                    onCardClick={() => {}}
                    renderCard={renderCard}
                    cardHeightPx={challengeWordCardHeight(true)}
                    // The list is exactly ten, so there is nothing to pace: render them
                    // all and let the first cards fan in.
                    staggerReveal
                />

                {/* The consequence of a strike, stated at the moment it can be tapped.
                    § 3.2 flags exactly this as the thing to watch after launch: the
                    gesture is one tap and its effect (permanent Mastered) is otherwise
                    invisible. If mastery data starts looking inflated, this copy is the
                    fix — not a cap. */}
                <Typography className="challenge-review-page__strike-note" sx={{ ...challengeMutedSx, fontSize: SIZE.micro }}>
                    "I know it" marks that word Mastered on your own cards and swaps in another word.
                </Typography>

                <Box className="challenge-review-page__actions" sx={{ display: "flex", gap: 1 }}>
                    <Button
                        className="challenge-review-page__confirm"
                        onClick={handleConfirm}
                        disabled={busy || loading || words.length === 0}
                        startIcon={<CheckIcon />}
                        sx={{
                            flex: 1,
                            textTransform: "none",
                            fontFamily: FONTS.sans,
                            fontSize: SIZE.body,
                            fontWeight: WEIGHT.semibold,
                            color: COLORS.onSurface,
                            backgroundColor: COLORS.greenAccent,
                            borderRadius: 3,
                            py: 1,
                        }}
                    >
                        {isIssuing ? "Send challenge" : "Accept challenge"}
                    </Button>
                    {!isIssuing && (
                        <Button
                            className="challenge-review-page__decline"
                            onClick={handleDecline}
                            disabled={busy}
                            sx={{
                                textTransform: "none",
                                fontFamily: FONTS.sans,
                                fontSize: SIZE.body,
                                fontWeight: WEIGHT.semibold,
                                color: COLORS.redMain,
                                backgroundColor: COLORS.sectionCard,
                                borderRadius: 3,
                                px: 2,
                            }}
                        >
                            Decline
                        </Button>
                    )}
                </Box>

                <FooterSpacer />
            </Box>
        </NodePage>
    );
}

export default ChallengeReviewPage;
