import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import UndoIcon from "@mui/icons-material/Undo";
import VerifiedIcon from "@mui/icons-material/Verified";
import ScheduleIcon from "@mui/icons-material/Schedule";
import MiniVocabCardGrid from "../../components/MiniVocabCardGrid";
import {
    acceptChallenge,
    declineChallenge,
    fetchChallenge,
    fetchChallengeCandidates,
    issueChallenge,
    strikeChallengeWord,
    withdrawChallenge,
} from "../../api/studyChallenges";
import type { ChallengeSummary } from "../../api/studyChallenges";
import type { ChallengeVariant, VocabEntry } from "../../types";
import { useAuth } from "../../AuthContext";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { challengeErrorMessage, deadlineLabel } from "./challengeLabels";
import { CHALLENGE_STRIKE_FADE_MS, challengeMessageSx, challengeWordCardHeight } from "./challengeStyles";
import ChallengeSheet from "./ChallengeSheet";
import type { ChallengeSheetTone } from "./ChallengeSheet";
import ChallengeWordCard from "./ChallengeWordCard";
import { candidateToReviewWord, storedWordToReviewWord } from "./reviewWord";
import type { ChallengeReviewWord } from "./reviewWord";

/**
 * Which pre-play state the sheet is showing. It is derived by the CALLER from the
 * row's `challengeAction`, so the panel never re-derives the lifecycle and cannot
 * disagree with the pill that opened it.
 */
export type ChallengePanelMode = "issue" | "waiting" | "incoming";

export interface ChallengePanelTarget {
    mode: ChallengePanelMode;
    /** The friend this sheet is about — always known, in every mode. */
    friendUserId: string;
    friendName: string;
    /** Absent in `issue` mode: there is no challenge yet. */
    challengeId?: string;
}

interface ChallengePanelProps {
    target: ChallengePanelTarget | null;
    onClose: () => void;
    /** Fired after any mutation that changes the row — the list refetches. */
    onChanged: () => void;
}

/** Header copy, chip text and chip ink for each mode (design F6, F8, F9). */
const MODE_CHROME: Record<ChallengePanelMode, { title: string; state: string; tone: ChallengeSheetTone }> = {
    issue: { title: "Create Challenge", state: "not sent", tone: "neutral" },
    waiting: { title: "Waiting for Response", state: "waiting", tone: "orange" },
    incoming: { title: "Incoming Challenge", state: "incoming", tone: "green" },
};

/**
 * The pre-play challenge sheet (docs/STUDY_CHALLENGE.md § 3, design F6–F9) — ONE
 * component for all three states, because all three are the same screen with a
 * different action bar:
 *
 *   issue     ·  build a set → strike what you know → Send challenge
 *   waiting   ·  the set is final and sent → Withdraw challenge
 *   incoming  ·  their set → strike what you know → Accept / Decline
 *
 * ⚠️ THE SET IS EDITABLE IN TWO OF THE THREE. `waiting` draws the identical grid with
 * NO strike affordance: the words have already been sent, so striking one would change
 * a set the other player may already be looking at. That is the only difference in the
 * body, and it is expressed as "pass no `onStrike`" rather than as a second layout.
 *
 * ⚠️ A STRIKE IS NOT A LOCAL UI GESTURE. "Mark as known" writes Mastered to the
 * striker's OWN card immediately (the same path discover's Already-Learned sort uses),
 * which removes the word from discover and from every future challenge — permanently.
 * That is why it takes two taps (see ChallengeWordCard) and why the struck card fades
 * out before its replacement lands — the exchange has to be legible as an exchange. It
 * is also why there is NO CAP: the whole cost falls on the striker, so the mechanism
 * polices itself.
 *
 * Replaced `ChallengeReviewPage` and its two routes (`/friends/challenges/new/:friendUserId`,
 * `/friends/challenges/review/:challengeId`), both deleted — see ChallengeSheet for why
 * these states stopped being pages.
 */
function ChallengePanel({ target, onClose, onChanged }: ChallengePanelProps) {
    const { isAuthenticated } = useAuth();

    const [challenge, setChallenge] = useState<ChallengeSummary | null>(null);
    /**
     * The list the sheet draws — the only source the tiles read.
     *
     * Loaded once and then edited IN PLACE by `handleStrike`: a strike swaps exactly
     * the struck tile for the replacement the server just named. The list is never
     * re-fetched on a strike, because a reload would re-render all nine tiles and could
     * reorder the untouched eight under the reviewer's thumb.
     */
    const [words, setWords] = useState<ChallengeReviewWord[]>([]);
    const [struck, setStruck] = useState<string[]>([]);
    /**
     * The replacements the server handed back, in the order it handed them back.
     *
     * `incoming` only: the accept call echoes these so the set that is COMMITTED is the
     * set that was on screen. `issue` does not need them — the issue call rebuilds the
     * same ranked prefix from `struck` alone.
     */
    const [replacements, setReplacements] = useState<string[]>([]);
    /** The tapped card, if any. One at a time — a second tap moves the selection. */
    const [selected, setSelected] = useState<string | null>(null);
    /**
     * The struck word that is currently fading out of its slot.
     *
     * Held here rather than in the card because the SWAP is the panel's decision: the
     * card only knows it is leaving, and the replacement cannot be spliced in until
     * both the fade and the server's answer are done.
     */
    const [fadingWord, setFadingWord] = useState<string | null>(null);
    const [variant] = useState<ChallengeVariant>("same_word");
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const mode = target?.mode ?? "issue";
    const editable = mode !== "waiting";

    /**
     * Load the set.
     *
     * `issue` reads CANDIDATES (there is no challenge yet); the other two read the
     * challenge's own stored words — the rule from § 9, Q55: the LIST always comes from
     * the challenge, never from a vet or deck query. That is what guarantees both
     * players see the same nine regardless of the state of anyone's library.
     *
     * Keyed on isAuthenticated + the target's ids, never on `token`
     * (CLAUDE.md "Never reload on token refresh") — and never on `struck`, which is
     * what would make a strike reload the whole list.
     */
    useEffect(() => {
        if (!target) return;
        let cancelled = false;
        setLoading(true);
        // A fresh open must not inherit the previous pair's selection or strikes.
        setStruck([]);
        setReplacements([]);
        setSelected(null);
        setFadingWord(null);

        const load = target.mode === "issue"
            ? fetchChallengeCandidates(target.friendUserId, variant).then((list) => {
                if (!cancelled) { setChallenge(null); setWords(list.map(candidateToReviewWord)); }
            })
            : fetchChallenge(target.challengeId!).then((result) => {
                if (cancelled) return;
                setChallenge(result);
                // The challenge stores identity only (Q49); the server resolves the det
                // display fields on the way out, so a stored word carries the same
                // pinyin, English, frequency and icon a candidate does.
                setWords(result.words.map(storedWordToReviewWord));
            });

        load
            .then(() => { if (!cancelled) setError(null); })
            .catch((err: unknown) => {
                if (!cancelled) setError(challengeErrorMessage(err, "Could not load the challenge words"));
            })
            .finally(() => { if (!cancelled) setLoading(false); });

        return () => { cancelled = true; };
    }, [isAuthenticated, target, variant]);

    /**
     * Strike a word — IDENTICAL ON BOTH EDITABLE SIDES (§ 3.2).
     *
     * One round trip does two things in a fixed order: it writes Mastered to the
     * striker's own card, and only then draws the replacement — drawing first would
     * rank the very word being struck straight back in. The response is that one
     * replacement, spliced into the struck word's slot so the other eight never move.
     *
     * The exclusion set is everything currently on screen plus everything struck this
     * session, so a replacement can never duplicate a visible word.
     */
    const handleStrike = useCallback(async (word: ChallengeReviewWord) => {
        if (busy || !target) return;
        setBusy(true);
        // The card starts leaving on the tap, not on the response — the gesture has to
        // feel answered immediately, and the request is the slow half.
        setFadingWord(word.word1);
        // Started BEFORE the request, and awaited after it, so the fade and the round
        // trip overlap: a slow server adds nothing to the animation and a fast one
        // never cuts it short (CHALLENGE_STRIKE_FADE_MS).
        const faded = new Promise<void>((resolve) => setTimeout(resolve, CHALLENGE_STRIKE_FADE_MS));
        try {
            const exclude = [...words.map((w) => w.word1), ...struck];
            // Pass whichever handle this side holds: the challenger has the candidate's
            // det id, the challengee has only the stored word. The server resolves the
            // latter, so BOTH sides can strike.
            const replacement = await strikeChallengeWord(
                word.dictionaryEntryId
                    ? { dictionaryEntryId: word.dictionaryEntryId }
                    : { word1: word.word1 },
                target.mode === "issue"
                    ? { friendUserId: target.friendUserId, variant, exclude }
                    : { challengeId: target.challengeId, exclude }
            );
            await faded;

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
            // The struck card is gone; leaving it selected would raise the pill over
            // whatever word landed in that slot.
            setSelected(null);
            setError(null);
        } catch (err: unknown) {
            setError(challengeErrorMessage(err, "Could not mark that word as known"));
        } finally {
            // Cleared on BOTH paths: on success the card it named has already been
            // replaced (a new `word1`, so the fresh card mounts opaque and pops in),
            // and on failure the word is still there and must fade back in rather than
            // sit invisible in its slot.
            setFadingWord(null);
            setBusy(false);
        }
    }, [busy, target, words, struck, variant]);

    /**
     * A mutation that consumes the sheet: run it, tell the list to refetch, dismiss.
     *
     * Every terminal action in this sheet has that identical shape, and every one of
     * them must leave nothing behind — which is the sheet's advantage over the routed
     * page it replaced, where the same guarantee needed a history `replace`.
     */
    const runAndClose = useCallback(async (
        action: () => Promise<unknown>,
        failureMessage: string
    ) => {
        if (busy) return;
        setBusy(true);
        try {
            await action();
            onChanged();
            onClose();
        } catch (err: unknown) {
            setError(challengeErrorMessage(err, failureMessage));
        } finally {
            setBusy(false);
        }
    }, [busy, onChanged, onClose]);

    /**
     * Send (issue) / Accept (incoming).
     *
     * ONLY THE ACCEPT ECHOES ITS REPLACEMENTS. Issuing does not need to: the candidate
     * query is a deterministic ranking (both-chose, then frequency, then det id), so
     * "the top nine excluding what I struck" — what `issueChallenge` rebuilds from
     * `struck` alone — is exactly the list on screen. A stored set has no such ranking
     * to rebuild from, so the challengee's replacements travel with the accept.
     */
    const handleConfirm = useCallback(() => {
        if (!target) return;
        if (target.mode === "issue") {
            return runAndClose(
                () => issueChallenge(target.friendUserId, variant, struck),
                "Could not send the challenge"
            );
        }
        return runAndClose(
            () => acceptChallenge(target.challengeId!, struck, replacements),
            "Could not accept the challenge"
        );
    }, [target, variant, struck, replacements, runAndClose]);

    /**
     * Decline (incoming only). Ends the invitation explicitly rather than letting it
     * lapse — and blocks a new challenge with this friend until the next Monday, since
     * the declined row keeps the pair's week. Any Mastered writes made while reviewing
     * persist: they were real statements about the learner's own knowledge.
     *
     * ⚠️ DISMISSING THE SHEET IS NOT DECLINING. Closing leaves the invitation exactly
     * pending until its deadline; only this button ends it.
     */
    const handleDecline = useCallback(() => {
        if (!target?.challengeId) return;
        return runAndClose(() => declineChallenge(target.challengeId!), "Could not decline the challenge");
    }, [target, runAndClose]);

    /**
     * Withdraw (waiting only) — the challenger's ONE lever, and it exists for a
     * mis-sent challenge. It deletes the row, which frees the pair's week immediately
     * (unlike a decline, which keeps it).
     */
    const handleWithdraw = useCallback(() => {
        if (!target?.challengeId) return;
        return runAndClose(() => withdrawChallenge(target.challengeId!), "Could not withdraw the challenge");
    }, [target, runAndClose]);

    /**
     * MiniVocabCardGrid takes VocabEntry[] and hands each entry back to `renderCard`.
     * A challenge word is NOT a vet row (it becomes one only on accept, § 3.3), so —
     * exactly as Quick Mark does with a DiscoverCard — the list is cast for the grid
     * and the real word is looked up by `word1` in `renderCard`.
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
            // A REPLACEMENT POPS IN IMMEDIATELY. The grid's delay is `index * step`,
            // which is right for the opening fan-in and wrong here: a word landing in
            // slot 8 would leave its slot empty for a further ~280ms after the fade
            // has already emptied it. The delay staggers a set arriving together; one
            // card arriving alone has nothing to stagger against.
            const delayMs = replacements.includes(word.word1) ? 0 : animationDelayMs;
            return (
                <ChallengeWordCard
                    key={word.word1}
                    word={word}
                    // `waiting` passes neither, which is what makes the card inert.
                    onStrike={editable ? handleStrike : undefined}
                    onSelect={editable ? (w) => setSelected((prev) => (prev === w.word1 ? null : w.word1)) : undefined}
                    selected={selected === word.word1}
                    fading={fadingWord === word.word1}
                    disabled={busy}
                    animationDelayMs={delayMs}
                />
            );
        },
        [words, replacements, editable, handleStrike, selected, fadingWord, busy]
    );

    if (!target) return null;
    const chrome = MODE_CHROME[target.mode];

    return (
        <ChallengeSheet
            open
            title={chrome.title}
            subtitle={`vs ${target.friendName}`}
            state={chrome.state}
            tone={chrome.tone}
            onClose={onClose}
            actions={
                target.mode === "waiting" ? (
                    <Button
                        className="challenge-panel__withdraw"
                        onClick={handleWithdraw}
                        disabled={busy}
                        startIcon={<UndoIcon />}
                        sx={{ ...sheetActionSx, flex: 1, backgroundColor: COLORS.iconBg, color: COLORS.dangerInk }}
                    >
                        Withdraw challenge
                    </Button>
                ) : (
                    <>
                        <Button
                            className="challenge-panel__confirm"
                            onClick={handleConfirm}
                            disabled={busy || loading || words.length === 0}
                            startIcon={<CheckIcon />}
                            sx={{ ...sheetActionSx, flex: 1, backgroundColor: COLORS.grn }}
                        >
                            {target.mode === "issue" ? "Send challenge" : "Accept"}
                        </Button>
                        {target.mode === "incoming" && (
                            <Button
                                className="challenge-panel__decline"
                                onClick={handleDecline}
                                disabled={busy}
                                sx={{ ...sheetActionSx, px: 2.25, backgroundColor: COLORS.iconBg, color: COLORS.dangerInk }}
                            >
                                Decline
                            </Button>
                        )}
                    </>
                )
            }
        >
            {/* The banner names what this sheet's body affords — the strike on the two
                editable states, the deadline on the sent one. It is not decoration: on
                `waiting` it is the only place the accept deadline appears, since the row
                behind the sheet is covered. */}
            <Box
                className={`challenge-panel__banner challenge-panel__banner--${target.mode}`}
                sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    mx: 2.5,
                    mt: 1.4,
                    px: 1.5,
                    py: 1.1,
                    borderRadius: 2,
                    backgroundColor: editable ? COLORS.blu : COLORS.org,
                    fontFamily: FONTS.sans,
                    fontSize: SIZE.caption,
                    fontWeight: WEIGHT.semibold,
                    color: COLORS.onSurface,
                }}
            >
                {editable
                    ? <VerifiedIcon sx={{ fontSize: 16, color: COLORS.bluA }} />
                    : <ScheduleIcon sx={{ fontSize: 16, color: COLORS.orgA }} />}
                {editable
                    ? "Tap a card to mark it as known"
                    : `Expires ${deadlineLabel(challenge?.deadlines.acceptDeadline)}`}
            </Box>

            {/* `waiting` labels the set as settled — the counterpart to the strike
                banner above, so neither state leaves the reader guessing whether these
                nine can still change. */}
            {!editable && (
                <Box
                    className="challenge-panel__word-label"
                    sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 1.25, px: 2.5, pt: 1.6 }}
                >
                    <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, fontWeight: WEIGHT.semibold, color: COLORS.onSurface }}>
                        The {words.length} words
                    </Typography>
                    <Typography sx={{ fontFamily: FONTS.label, fontSize: SIZE.micro, letterSpacing: "0.12em", textTransform: "uppercase", color: COLORS.textFaint }}>
                        final
                    </Typography>
                </Box>
            )}

            {error && (
                <Typography className="challenge-panel__error" sx={{ ...challengeMessageSx, px: 2.5, pt: 1.5 }}>
                    {error}
                </Typography>
            )}

            <MiniVocabCardGrid
                containerClassName="challenge-panel__words"
                classPrefix="challenge-panel"
                loading={loading}
                entries={gridEntries}
                emptyMessage="No words are available for this challenge right now."
                onCardClick={() => {}}
                renderCard={renderCard}
                // Editable rows carry a pill that overhangs the card's bottom edge, so
                // they need the extra gutter; the settled set does not.
                cardHeightPx={challengeWordCardHeight(editable)}
                // The list is exactly nine, so there is nothing to pace: render them all
                // and let the first cards fan in.
                staggerReveal
            />
        </ChallengeSheet>
    );
}

/** The shared shape of every button in the sheet's pinned action bar. */
const sheetActionSx = {
    textTransform: "none",
    fontFamily: FONTS.sans,
    fontSize: SIZE.body,
    fontWeight: WEIGHT.semibold,
    color: COLORS.onSurface,
    borderRadius: 3,
    py: 1.3,
} as const;

export default ChallengePanel;
