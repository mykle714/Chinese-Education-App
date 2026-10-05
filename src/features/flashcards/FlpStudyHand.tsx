import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Snackbar } from "@mui/material";
import StudyHand, { type StudyHandCard, type StudyModeId } from "./StudyHand";
import { useFlpReadyCounts } from "../../hooks/useFlpReadyCounts";
import { formatCooldownRemaining } from "../../utils/formatDuration";
import type { FlpBar } from "../../../server/contracts/studyMode";
import type { RampHue } from "../../theme/colors";

// ── What this is ──────────────────────────────────────────────────────────────
//
// The flp card HAND with its data: three fanned cards — Challenge, Review, Study Mix —
// each showing how many cards that session could deal right now, one played forward,
// tapping it opens the flp in that mode. `StudyHand` is the pixels; this is everything
// around it (the figures, the Review gate, the "resting" toast, the launch URL).
//
// Three hosts, one component, so they cannot drift:
//   fdp (/flashcards/decks)        — bar `core`: the know flp.
//   Reading Center (/flashcards/reading) — bar `reading`: the READING flp in the same
//       three modes (`?bar=reading`, docs/READING_WRITING_CENTERS.md § Phase 4).
//   Writing Center (/flashcards/writing) — bar `writing`: the WRITING flp
//       (`?bar=writing`, docs/WRITING_PRACTICE_REWORK.md § 3), compact like Reading's.
// Extracted from FlashcardsDecksPage on 2026-10-03 when the Reading Center adopted it.
//
// SIZING is the host's: StudyHand fills its container (`flex: 1 1 0`, container-query
// sized), so the fdp lets it stretch over the study area and the Reading Center gives
// it a fixed-height box.
//
// Layer: feature component (src/features/flashcards). Docs: docs/DECKS_FEATURE.md
// § "The card hand".

/**
 * Corner-tag copy for a mode whose zero means "there is nothing ready to draw" rather
 * than "you finished". Shared by Challenge and Study Mix, which empty for the same
 * reason; Review's zero gets its own sentence below.
 */
const ZERO_MESSAGE_MORE_CARDS = "Add more cards!";

// The hand's three modes, in FAN_ORDER. Fill hues are the artboard's: Challenge red (the
// difficulty end), Review blue, Study Mix the gold `--yel` this design added for exactly
// this card.
const HAND_HUES: Record<StudyModeId, RampHue> = {
    challenge: "red",
    review: "blu",
    mix: "yel",
};

/**
 * Card names and glyphs per bar. The fdp's know hand keeps its established names; the
 * Reading Center's compact hand names the skill on every card, since its cards carry no
 * figure and the name is the only thing saying what each one starts.
 */
const HAND_LABELS: Record<FlpBar, Record<StudyModeId, string>> = {
    core: { challenge: "Challenge Mix", review: "Review Mix", mix: "Study Mix" },
    reading: { challenge: "Reading Challenge", review: "Reading Review", mix: "Reading Mix" },
    writing: { challenge: "Writing Challenge", review: "Writing Review", mix: "Writing Mix" },
};
/** Glyphs for the compact face (the full face draws none). */
const HAND_GLYPHS: Record<StudyModeId, string> = {
    challenge: "local_fire_department",
    review: "history",
    mix: "menu_book",
};

interface FlpStudyHandProps {
    /** Which track the sessions exercise — and so which bar the figures are read off. */
    bar: FlpBar;
    /** `compact` (Reading Center): the old stack's look, no figures — StudyHand docblock. */
    variant?: "full" | "compact";
    className?: string;
}

const FlpStudyHand: React.FC<FlpStudyHandProps> = ({ bar, variant = "full", className }) => {
    const navigate = useNavigate();
    // Toast shown when a greyed Review card is tapped (no eligible cards yet).
    const [markMoreSnackOpen, setMarkMoreSnackOpen] = useState(false);

    // ── The three modes' figures ─────────────────────────────────────────────
    //
    // Each figure is the number of cards THAT MODE COULD DEAL RIGHT NOW: its bands,
    // counted over the library, minus everything still on cooldown — both read off the
    // session's BAR (core on the fdp, reading on the Reading Center).
    //
    //   Challenge   — Unfamiliar + Target      ┐ the two partition the four bands, so
    //   Review      — Comfortable + Mastered   ┘ Challenge + Review == Study Mix
    //   Study Mix   — all four
    //
    // The identity is the point: the hand shows one pool split two ways, and a learner
    // can read the split off the three cards.
    //
    // READINESS IS THE flp'S RULE, not this component's: `flpReadyCountsByBand`
    // (server/contracts/flpReadiness.ts) restates `rankFlpEligible`'s eligibility test for
    // the same bar, computed server-side against a narrow `{ id, typedMarkHistory }` read
    // (`/api/onDeck/flpReadyCounts[?bar=reading]`), so the figures land long before any
    // full card-library fetch and cannot claim a card the flp would not deal.
    const { counts: readyCounts, reviewNextReadyMs, loaded: figuresLoaded } = useFlpReadyCounts(bar);
    const ready = useCallback((name: string): number => readyCounts[name] || 0, [readyCounts]);
    const challengePool = figuresLoaded ? ready("Unfamiliar") + ready("Target") : undefined;
    const reviewPool = figuresLoaded ? ready("Comfortable") + ready("Mastered") : undefined;
    const inRotation = figuresLoaded ? (challengePool ?? 0) + (reviewPool ?? 0) : undefined;

    // REVIEW is gated on its READY count: with every Comfortable/Mastered card resting
    // there is nothing to review, and the flp cannot lend its way out of that — a lent
    // card has an empty mark history, so it bands Unfamiliar and can never satisfy a
    // Review pool (docs/PROVISIONAL_CARDS.md). CHALLENGE and STUDY MIX have no gate: the
    // working-loop endpoint lends to reach the flp baseline.
    //
    // TRI-STATE, and the third state is the point: `undefined` means "not counted yet",
    // which StudyHand renders exactly like an eligible card (it tests `eligible === false`
    // strictly) — a zero this component has not earned yet must not reach the UI, as a
    // number or as a colour.
    const reviewEligible = reviewPool === undefined ? undefined : reviewPool > 0;

    const skill = bar === "core" ? "" : `${bar} `;
    const labels = HAND_LABELS[bar];
    const handCards: StudyHandCard[] = useMemo(() => [
        // ⚠️ `label` is DISPLAY TEXT ONLY. The ids stay `challenge` / `review` — they are
        // the `?mode=` query param the flp parses and the server's own `MODE_CONFIGS` keys.
        // Same split the "Learn Now" rename made (CLAUDE.md § Terminology).
        //
        // `zeroMessage` is what the FRONT card's corner tag says when its pool lands on 0.
        // Review's zero is an achievement (everything is resting); Challenge/Mix's is a
        // prompt to go get more.
        { id: "challenge", label: labels.challenge, figure: challengePool, figureCaption: "Cards", zeroMessage: ZERO_MESSAGE_MORE_CARDS, hue: HAND_HUES.challenge, glyph: HAND_GLYPHS.challenge },
        { id: "review", label: labels.review, figure: reviewPool, figureCaption: "Cards", zeroMessage: "All caught up!", hue: HAND_HUES.review, eligible: reviewEligible, glyph: HAND_GLYPHS.review },
        { id: "mix", label: labels.mix, figure: inRotation, figureCaption: "Cards", zeroMessage: ZERO_MESSAGE_MORE_CARDS, hue: HAND_HUES.mix, glyph: HAND_GLYPHS.mix },
    ], [challengePool, reviewPool, inRotation, reviewEligible, labels]);

    // ONE commit handler for all three cards. Mode and bar are query params on the same
    // route (server/contracts/studyMode.ts), so the branch is only about the Review gate.
    const handleStudy = useCallback((id: StudyModeId) => {
        // Only a KNOWN-empty Review pool is refused. While the count is still in flight
        // the tap goes through: the flp does its own provisioning and gating.
        if (id === "review" && reviewEligible === false) { setMarkMoreSnackOpen(true); return; }
        const params = new URLSearchParams();
        if (id !== "mix") params.set("mode", id);
        if (bar !== "core") params.set("bar", bar);
        const query = params.toString();
        navigate(query ? `/flashcards/learn?${query}` : "/flashcards/learn");
    }, [navigate, reviewEligible, bar]);

    return (
        <>
            <StudyHand className={className} cards={handCards} onStudy={handleStudy} variant={variant} />

            {/* Toast: greyed Review tapped. TWO reasons the figure can be 0, and they call
                for opposite advice — go earn some cards, or come back later — so the
                message branches on whether anything is merely resting. */}
            <Snackbar
                className="flp-study-hand__mark-more-snackbar"
                open={markMoreSnackOpen}
                autoHideDuration={5000}
                onClose={() => setMarkMoreSnackOpen(false)}
                anchorOrigin={{ vertical: "top", horizontal: "center" }}
                sx={{ zIndex: 2000 }}
            >
                <Alert
                    className="flp-study-hand__mark-more-alert"
                    severity="info"
                    variant="filled"
                    onClose={() => setMarkMoreSnackOpen(false)}
                >
                    {reviewNextReadyMs === null
                        ? `Mark more cards in ${bar === "reading" ? "Study Mix here" : "Study Mix"} to unlock this deck.`
                        : `All your ${skill}review cards are resting. Next ready in ${formatCooldownRemaining(reviewNextReadyMs)}.`}
                </Alert>
            </Snackbar>
        </>
    );
};

export default FlpStudyHand;
