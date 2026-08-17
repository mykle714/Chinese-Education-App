import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Box, Button, Typography } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import NodePage from "../../components/NodePage";
import { FooterSpacer } from "../../components/MobileFooter";
import ForeignText from "../../components/ForeignText";
import {
    acceptChallenge,
    declineChallenge,
    fetchChallenge,
    fetchChallengeCandidates,
    issueChallenge,
    strikeChallengeWord,
} from "../../api/studyChallenges";
import type { ChallengeCandidate, ChallengeSummary } from "../../api/studyChallenges";
import type { ChallengeVariant, Language } from "../../types";
import { CHALLENGE_WORD_COUNT } from "../../types";
import { useAuth } from "../../AuthContext";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { acceptByLabel, challengeErrorMessage } from "./challengeLabels";
import { challengeCardSx, challengeMessageSx, challengeMutedSx, wordTileSx } from "./challengeStyles";

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
    const [candidates, setCandidates] = useState<ChallengeCandidate[]>([]);
    const [struck, setStruck] = useState<string[]>([]);
    const [variant] = useState<ChallengeVariant>("same_word");
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /**
     * The word list the page draws.
     *
     * Issuing reads CANDIDATES (there is no challenge yet); reviewing reads the
     * challenge's own stored words — which is the rule from § 9, Q55: the LIST always
     * comes from the challenge, never from a vet or deck query. That is what guarantees
     * both players see the same ten regardless of the state of anyone's library.
     */
    const words: { word1: string; language: Language; pronunciation: string | null; definition: string | null; dictionaryEntryId: number | null }[] =
        isIssuing
            ? candidates.map((c) => ({ ...c, dictionaryEntryId: c.dictionaryEntryId }))
            : (challenge?.words ?? [])
                // WHEN REPLACEMENTS APPEAR DIFFERS BETWEEN THE TWO FLOWS, and the UI
                // must not pretend otherwise. Issuing re-asks the server per strike, so
                // a replacement slides in immediately. Reviewing cannot: the server
                // computes the challengee's replacements inside the ACCEPT transaction
                // (§ 3.3), so here a struck word simply disappears and the count below
                // says how many will be drawn. Faking a replacement client-side would
                // show a word the server may not choose.
                .filter((w) => !struck.includes(w.word1))
                .map((w) => ({
                    word1: w.word1,
                    language: w.language,
                    // A stored challenge word carries no pronunciation or gloss — the
                    // challenge stores identity only (Q49). The tile renders the word
                    // itself, which is what the reviewer is judging.
                    pronunciation: null,
                    definition: null,
                    dictionaryEntryId: null,
                }));

    /** How many words the accept will replace — reviewing only (see the filter above). */
    const pendingReplacements = isIssuing ? 0 : struck.length;

    // Keyed on isAuthenticated + the route ids, never on `token`.
    useEffect(() => {
        let cancelled = false;
        setLoading(true);

        const load = isIssuing
            ? fetchChallengeCandidates(friendUserId!, variant, struck).then((list) => {
                if (!cancelled) setCandidates(list);
            })
            : fetchChallenge(challengeId!).then((result) => {
                if (!cancelled) setChallenge(result);
            });

        load
            .then(() => { if (!cancelled) setError(null); })
            .catch((err: unknown) => {
                if (!cancelled) setError(challengeErrorMessage(err, "Could not load the challenge words"));
            })
            .finally(() => { if (!cancelled) setLoading(false); });

        return () => { cancelled = true; };
        // `struck` is a dependency on purpose for the issuing case: each strike re-asks
        // the server for a replacement, which is the § 3.2 replacement loop. It is a
        // cheap, paged query rather than a re-rank of the whole pool.
    }, [isAuthenticated, isIssuing, friendUserId, challengeId, variant, struck]);

    /**
     * Strike a word. Two writes, in this order, and the order matters: the Mastered
     * write must land BEFORE the replacement is requested, or the server would rank
     * the same word straight back in.
     */
    const handleStrike = useCallback(async (word: { word1: string; dictionaryEntryId: number | null }) => {
        if (busy) return;
        setBusy(true);
        try {
            // Pass whichever handle this side holds: the challenger has the candidate's
            // det id, the challengee has only the stored word. The server resolves the
            // latter, so BOTH sides can strike (§ 3.2).
            await strikeChallengeWord(
                word.dictionaryEntryId
                    ? { dictionaryEntryId: word.dictionaryEntryId }
                    : { word1: word.word1 }
            );
            // Adding to `struck` re-runs the load effect, which asks for a replacement
            // excluding everything already shown or struck.
            setStruck((prev) => [...prev, word.word1]);
            setError(null);
        } catch (err: unknown) {
            setError(challengeErrorMessage(err, "Could not mark that word as known"));
        } finally {
            setBusy(false);
        }
    }, [busy]);

    /** The final confirm — the tap that actually creates or accepts the challenge. */
    const handleConfirm = useCallback(async () => {
        if (busy) return;
        setBusy(true);
        try {
            if (isIssuing) {
                await issueChallenge(friendUserId!, variant, struck);
            } else {
                await acceptChallenge(challengeId!, struck);
            }
            slideNavigate("/friends/challenges");
        } catch (err: unknown) {
            setError(challengeErrorMessage(err, isIssuing ? "Could not send the challenge" : "Could not accept the challenge"));
        } finally {
            setBusy(false);
        }
    }, [busy, isIssuing, friendUserId, challengeId, variant, struck, slideNavigate]);

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

                {loading ? (
                    <Typography className="challenge-review-page__loading" sx={challengeMutedSx}>Loading…</Typography>
                ) : (
                    <Box className="challenge-review-page__words" sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
                        {words.map((word, index) => (
                            <Box key={`${word.word1}-${index}`} className="challenge-review-page__word" sx={wordTileSx}>
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                    {/* Foreign text ALWAYS goes through ForeignText — it is the
                                        public container that decides cpcd vs plain Latin text
                                        per language. Never render a foreign word directly. */}
                                    <ForeignText
                                        text={word.word1}
                                        pronunciation={word.pronunciation}
                                        language={word.language}
                                        size="sm"
                                    />
                                    {word.definition && (
                                        <Typography sx={{ ...challengeMutedSx, fontSize: SIZE.micro }}>
                                            {word.definition}
                                        </Typography>
                                    )}
                                </Box>
                                <Button
                                    className="challenge-review-page__strike"
                                    onClick={() => handleStrike({ word1: word.word1, dictionaryEntryId: word.dictionaryEntryId })}
                                    disabled={busy}
                                    startIcon={<CloseIcon sx={{ fontSize: 16 }} />}
                                    sx={{
                                        textTransform: "none",
                                        fontFamily: FONTS.sans,
                                        fontSize: SIZE.micro,
                                        color: COLORS.textSecondary,
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    I know this
                                </Button>
                            </Box>
                        ))}
                    </Box>
                )}

                {/* The consequence of a strike, stated at the moment it can be tapped.
                    § 3.2 flags exactly this as the thing to watch after launch: the
                    gesture is one tap and its effect (permanent Mastered) is otherwise
                    invisible. If mastery data starts looking inflated, this copy is the
                    fix — not a cap. */}
                <Typography className="challenge-review-page__strike-note" sx={{ ...challengeMutedSx, fontSize: SIZE.micro }}>
                    "I know this" marks the word Mastered on your own cards and swaps in another word.
                </Typography>

                {pendingReplacements > 0 && (
                    <Typography className="challenge-review-page__pending-replacements" sx={{ ...challengeMutedSx, fontSize: SIZE.micro }}>
                        {pendingReplacements === 1
                            ? "1 replacement word will be drawn when you accept."
                            : `${pendingReplacements} replacement words will be drawn when you accept.`}
                    </Typography>
                )}

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
