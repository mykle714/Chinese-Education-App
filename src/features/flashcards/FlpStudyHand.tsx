import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Snackbar } from "@mui/material";
import StudyHand, { type HandOrder, type StudyHandCard, type StudyModeId } from "./StudyHand";
import { useFlpReadyCounts } from "../../hooks/useFlpReadyCounts";
import { formatCooldownRemaining } from "../../utils/formatDuration";
import type { FlpWorld } from "../../../server/contracts/studyMode";
import type { RampHue } from "../../theme/colors";
import { handLaunchRequest } from "./flpLaunch";
import type { WorkingLoopRequest } from "../../api/workingLoop";
import { useSoftIntro } from "../../softIntro/useSoftIntro";

// ── What this is ──────────────────────────────────────────────────────────────
//
// The flp card HAND with its data: three fanned cards — Challenge, Review, Study Mix —
// each showing how many cards that session could deal right now, one played forward,
// tapping it opens the flp in that mode. `StudyHand` is the pixels; this is everything
// around it (the figures, the Review gate, the "resting" toast, the launch URL).
//
// Three hosts, one component, so they cannot drift:
//   fdp (/, the Home tab)           — bar `core`: the know flp.
//   Reading Center (/flashcards/reading) — bar `reading`: the READING flp in the same
//       three modes (`?world=reading`, docs/READING_WRITING_CENTERS.md § Phase 4).
//   Writing Center (/flashcards/writing) — bar `writing`: the WRITING flp
//       (`?world=writing`, docs/WRITING_PRACTICE_REWORK.md § 3), compact like Reading's.
// Extracted from FlashcardsDecksPage on 2026-10-03 when the Reading Center adopted it.
//
// LAUNCH is the host's too, when it wants one: the fdp passes `onLaunch` (+ `shaking`)
// so a commit loads the session while the hand shakes and plays the fdp → flp
// choreography (flpLaunch.ts). The Centers pass neither and navigate directly.
//
// SIZING is the host's: StudyHand fills its container (`flex: 1 1 0`, container-query
// sized), so the fdp lets it stretch over the study area and the Reading Center gives
// it a fixed-height box.
//
// Layer: feature component (src/features/flashcards). Docs: docs/DECKS_FEATURE.md
// § "Launching the flp from the hand", and
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
const HAND_LABELS: Record<FlpWorld, Record<StudyModeId, string>> = {
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

/**
 * The fan each bar's hand was in when the learner last STARTED a session from it. Coming
 * back from the flp (Back arrow, footer tab, anything that remounts the host) the hand
 * reopens in that arrangement, so the card they were playing is still forward instead of
 * snapping back to Study Mix. Module memory, not storage: it lasts for the app session
 * and a reload opens on the default fan. Recorded only on a launch that actually goes —
 * a refused Review tap leaves it alone. Per bar, because the Reading/Writing Centers'
 * hands are separate stacks from Home's.
 */
const rememberedHandOrder: Partial<Record<FlpWorld, HandOrder>> = {};

interface FlpStudyHandProps {
    /** Which track the sessions exercise — and so which bar the figures are read off. */
    world: FlpWorld;
    /** `compact` (Reading Center): the old stack's look, no figures — StudyHand docblock. */
    variant?: "full" | "compact";
    className?: string;
    /**
     * Take over the launch instead of navigating straight to the flp. The fdp passes its
     * `useFlpLaunch().launch`, which loads the session while the hand shakes and then plays
     * the fdp → flp choreography (flpLaunch.ts). `request` is the flp's initial deal, built
     * here because this is where mode and bar are decided. Omitted (the Centers): navigate.
     */
    onLaunch?: (path: string, request: WorkingLoopRequest) => void;
    /** Shake the hand's cards — the host's "session loading" state (StudyHand `shaking`). */
    shaking?: boolean;
}

const FlpStudyHand: React.FC<FlpStudyHandProps> = ({ world, variant = "full", className, onLaunch, shaking = false }) => {
    const navigate = useNavigate();
    // The mark under the big numeral is a soft introduction (docs/SOFT_INTRODUCTION.md):
    // "cards" until the learner has met the hand enough to know what the number counts,
    // then the design's hairline. Only the FULL hand draws a numeral, so only it counts
    // as a visit — the Centers' compact hands must not graduate it unseen.
    const figureMark = useSoftIntro("handCardCount", { enabled: variant === "full" }) === "intro" ? "label" : "rule";
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
    // (`/api/onDeck/flpReadyCounts[?world=reading]`), so the figures land long before any
    // full card-library fetch and cannot claim a card the flp would not deal.
    const { counts: readyCounts, reviewNextReadyMs, loaded: figuresLoaded } = useFlpReadyCounts(world);
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

    const skill = world === "core" ? "" : `${world} `;
    const labels = HAND_LABELS[world];
    const handCards: StudyHandCard[] = useMemo(() => [
        // ⚠️ `label` is DISPLAY TEXT ONLY. The ids stay `challenge` / `review` — they are
        // the `?mode=` query param the flp parses and the server's own `MODE_CONFIGS` keys.
        // Same split the "Learning" (née "Library") rename made (CLAUDE.md § Terminology).
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
    const handleStudy = useCallback((id: StudyModeId, order: HandOrder) => {
        // Only a KNOWN-empty Review pool is refused. While the count is still in flight
        // the tap goes through: the flp does its own provisioning and gating.
        if (id === "review" && reviewEligible === false) { setMarkMoreSnackOpen(true); return; }
        rememberedHandOrder[world] = order;
        const params = new URLSearchParams();
        if (id !== "mix") params.set("mode", id);
        if (world !== "core") params.set("world", world);
        const query = params.toString();
        const path = query ? `/flashcards/learn?${query}` : "/flashcards/learn";
        if (onLaunch) {
            onLaunch(path, handLaunchRequest(id, world));
            return;
        }
        navigate(path);
    }, [navigate, reviewEligible, world, onLaunch]);

    return (
        <>
            <StudyHand className={className} cards={handCards} initialOrder={rememberedHandOrder[world]} onStudy={handleStudy} variant={variant} shaking={shaking} figureMark={figureMark} />

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
                        ? `Mark more cards in ${world === "reading" ? "Study Mix here" : "Study Mix"} to unlock this deck.`
                        : `All your ${skill}review cards are resting. Next ready in ${formatCooldownRemaining(reviewNextReadyMs)}.`}
                </Alert>
            </Snackbar>
        </>
    );
};

export default FlpStudyHand;
