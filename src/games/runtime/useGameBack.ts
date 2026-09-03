import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useConfirmation } from "../../contexts/ConfirmationContext";
import type { ChallengeRoundState } from "./useChallengeRound";

/**
 * The Back control of a game page: where it goes, and the one thing that may stop it.
 *
 * ── WHERE IT GOES ─────────────────────────────────────────────────────────────
 * Back lands where the player came FROM — the challenge they are mid-test in, or
 * the Games hub for an ordinary run. All four challenge-eligible games had this
 * same three-line ternary inlined in their `onBack`; it lives here now so the two
 * destinations are stated once.
 *
 * ── THE ONE THING THAT MAY STOP IT ────────────────────────────────────────────
 * Since the claim model (docs/STUDY_CHALLENGE.md § 5.1a), the first mark of a
 * challenge round SPENDS the attempt, and leaving finalises the round at whatever
 * score stands. That is the intended rule, but it is irreversible and invisible: a
 * player who taps Back to check something and comes straight back would find a
 * scored, unplayable round waiting. One tap must not be able to do that silently, so
 * an armed round confirms first.
 *
 * ⚠️ THE CONFIRM IS A COURTESY, NOT A LOCK. A footer tab, the browser's own back
 * gesture and a tab close cannot be intercepted by a promise-based confirm and are
 * not guarded — deliberately: the guard's job is to stop the DELIBERATE exit from
 * being an accident, not to make a round unleavable. Every one of those paths still
 * finalises the round correctly, because `useChallengeRound` does that on unmount
 * and on `pagehide` rather than here.
 *
 * Referenced by: BubbleMatchPage, HydraBubblesPage, MatchSpeedPage, WordSearchPage.
 * Referenced by docs: STUDY_CHALLENGE.md § 5.1a, GAMES_FEATURE.md.
 */
export function useGameBack(challengeRound: ChallengeRoundState): () => void {
    const navigate = useNavigate();
    const { confirm } = useConfirmation();
    const { challengeId, armed } = challengeRound;

    return useCallback(() => {
        const leave = () => navigate(challengeId ? `/friends/challenges/${challengeId}` : "/games");
        // Not in a challenge, or nothing marked yet: Back is just Back.
        if (!armed) { leave(); return; }
        void confirm(
            "You've already answered in this round, so leaving now ends it and banks the score you have. Rounds are one attempt each — you can't replay it.",
            { title: "Leave this round?", confirmText: "End round", cancelText: "Keep playing" }
        ).then((ok) => { if (ok) leave(); });
    }, [navigate, confirm, challengeId, armed]);
}
