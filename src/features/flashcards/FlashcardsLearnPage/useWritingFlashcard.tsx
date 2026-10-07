import { useEffect, useRef, useState } from "react";
import { Box, Dialog } from "@mui/material";
import { useAuth } from "../../../AuthContext";
import WritingStage from "../../../components/handwriting/WritingStage";
import WritingFocusEditor from "../../../components/handwriting/WritingFocusEditor";
import { levelPreview, WRITING_FOCUS_SIZE } from "../../../components/handwriting/levelBehavior";
import { recognizeHandwriting } from "../../../components/handwriting/recognize";
import type { Ink, WritingAttempt } from "../../../components/handwriting/types";
import { PHONE_OVERLAY_SX } from "../../../components/phoneGeometry";
import { modeOfLevel, writingLevelForMastery } from "../../../../server/contracts/writingLevels";
import type { VocabEntry } from "../../../types";
import { COLORS } from "../../../theme";
import WritingCardFace from "./WritingCardFace";
import type { WritingFaceRenderer } from "./FlashCardSection";

/**
 * useWritingFlashcard — the writing flp's per-card attempt (`?bar=writing`,
 * docs/WRITING_PRACTICE_REWORK.md § 3). The card is the ordinary flp card; this hook
 * owns what is drawn ON it and the two overlays it opens.
 *
 *   inks / locked / results / checking — the attempt on the FRONT card, reset whenever
 *       the front card changes.
 *   outgoing — a frozen copy of the attempt just dismissed, so the card flying out keeps
 *       showing its graded back face while the new front card starts clean.
 *
 * Flow: a cell tap opens WritingFocusEditor at the card's level
 * (`writingLevelForMastery(entry.writingMastery)`). There is no Submit button: a tap on
 * the card body (`handleCardClick`, wired to FlashCardSection.onCardClick) submits the
 * front — grading every character (top-1) and asking the page to `flip` — but only once
 * EVERY cell is filled; otherwise it bumps `shakeNonce` and the card wiggles (the same
 * `cardShake` the core flp plays) and its empty cells flash, to prompt the learner to
 * fill the rest. On the back, a
 * cell tap inspects it enlarged and a tap anywhere else dismisses the card — right only
 * when every character is correct. The learner never steers the card: a swipe ATTEMPT
 * on the graded back (`swipeHandlers`) is read as that same dismiss tap — the card goes
 * right/left by its grade, never by the swipe's direction — and FlashCardSection plays
 * its "grab and throw" fly-out (`writingThrowKeyframes`). A swipe on the front does nothing.
 *
 * Level 8: a character whose clock started is final once its editor closes (`locked`),
 * so closing and reopening cannot reset the clock. A locked cell counts as FILLED for the
 * submit gate even with no ink — it can never be reopened, so requiring ink there would
 * strand the card on its front face.
 *
 * Layer: flp page hook (client). Recognition goes through components/handwriting's
 * `recognizeHandwriting`; marks are written by the page's `dismiss` (useWorkingLoop's
 * handleCardDismiss), which fans the attempt out per character on the server.
 */
interface Attempt {
    entryId: number | null;
    inks: Ink[];
    locked: boolean[];
    results: boolean[] | null;
}

/** Pointer travel (px) past which a press is a swipe attempt, not a tap — useCardDrag's tap slop. */
const SWIPE_ATTEMPT_PX = 10;

const blankAttempt = (entry: VocabEntry | null): Attempt => {
    const n = entry ? [...entry.entryKey].length : 0;
    return {
        entryId: entry?.id ?? null,
        inks: Array.from({ length: n }, () => []),
        locked: Array.from({ length: n }, () => false),
        results: null,
    };
};

export function useWritingFlashcard({ enabled, entry, isFlipped, isAnimating, flip, dismiss }: {
    /** False on every bar but writing — the hook then renders nothing. */
    enabled: boolean;
    /** The ACTIVE FRONT card. */
    entry: VocabEntry | null;
    isFlipped: boolean;
    isAnimating: boolean;
    /** Turn the front card to its back face (useCardDrag's setIsFlipped(true)). */
    flip: () => void;
    /** Send the front card off and write the marks (useWorkingLoop.handleCardDismiss). */
    dismiss: (direction: "left" | "right", attempt: WritingAttempt) => void;
}) {
    const { token } = useAuth();
    const [attempt, setAttempt] = useState<Attempt>(() => blankAttempt(entry));
    const [outgoing, setOutgoing] = useState<Attempt | null>(null);
    const [checking, setChecking] = useState(false);
    const [editing, setEditing] = useState<number | null>(null);
    // The cell being written — the focus editor grows out of it and shrinks back into it.
    const [editingOrigin, setEditingOrigin] = useState<HTMLElement | null>(null);
    const [inspecting, setInspecting] = useState<number | null>(null);
    // Bumped on a tap that tries to submit an incompletely-written front. Fed to
    // FlashCardSection's `shakeNonce` in place of useCardDrag's (the writing card is never
    // dragged, so that one never moves); reset per card, like useCardDrag's, so a stale
    // nonce does not replay the wiggle on the newly promoted front card.
    const [shakeNonce, setShakeNonce] = useState(0);

    // A new front card starts a clean attempt (a dismiss, an undo-free refill, a refetch).
    const entryId = entry?.id ?? null;
    useEffect(() => {
        setAttempt(blankAttempt(entry));
        setChecking(false);
        setEditing(null);
        setInspecting(null);
        setShakeNonce(0);
        // Keyed on the id: the page's entry object can change identity every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [entryId]);

    const level = entry ? writingLevelForMastery(entry.writingMastery ?? 0) : 1;
    // The state belongs to the card it was made on — ignore it for one render after a
    // card change, before the reset effect has run.
    const live = attempt.entryId === entryId ? attempt : blankAttempt(entry);

    const handleEditorDone = (index: number, ink: Ink, meta: { clockStarted: boolean }) => {
        setEditing(null);
        setAttempt((prev) => ({
            ...prev,
            inks: prev.inks.map((old, i) => (i === index ? ink : old)),
            locked: meta.clockStarted ? prev.locked.map((v, i) => v || i === index) : prev.locked,
        }));
    };

    // Every cell is written (or locked by its level-8 clock — see the header).
    const allFilled = live.inks.length > 0 && live.inks.every((ink, i) => ink.length > 0 || live.locked[i]);

    const handleSubmit = async () => {
        if (!entry || checking || !allFilled) return;
        const chars = [...entry.entryKey];
        const submittedFor = entry.id;
        setChecking(true);
        const perChar = await Promise.all(
            chars.map(async (ch, i) => {
                const ink = live.inks[i] ?? [];
                if (ink.length === 0) return false;
                try {
                    const { top1 } = await recognizeHandwriting(ink, WRITING_FOCUS_SIZE, WRITING_FOCUS_SIZE, token);
                    return top1 === ch;
                } catch (err) {
                    // An unreachable recognizer grades the character wrong rather than
                    // stranding the card on its front face.
                    console.warn("[WritingFlp] verify failed", err);
                    return false;
                }
            }),
        );
        setChecking(false);
        // The card changed under the request (e.g. a refetch) — drop the stale verdict.
        setAttempt((prev) => (prev.entryId === submittedFor ? { ...prev, results: perChar } : prev));
        flip();
    };

    // Send the graded front card off — right only when every character is correct.
    // Shared by the dismiss tap and a swipe attempt. Returns false when there is nothing
    // to send (front face, ungraded, or a fly-out already running).
    const sendOff = (): boolean => {
        if (!enabled || isAnimating || !isFlipped || !live.results) return false;
        const direction = live.results.every(Boolean) ? "right" : "left";
        setOutgoing(live);
        // Reset the wiggle nonce in the SAME batch as the dismiss: the front wrapper is
        // keyed `front-${shakeNonce}`, so a reset left to the per-card effect would re-key
        // (remount) the promoted card a frame later and restart its grow-in animation.
        setShakeNonce(0);
        dismiss(direction, { level, perChar: live.results });
        return true;
    };

    /**
     * A tap on the card body (cells stop their own taps). Front: submit when every cell
     * is filled, else wiggle the card. Back (graded): send the card off.
     */
    const handleCardClick = () => {
        if (!enabled || isAnimating) return;
        if (!isFlipped) {
            if (checking) return;
            if (allFilled) void handleSubmit();
            else setShakeNonce((n) => n + 1);
            return;
        }
        sendOff();
    };

    /**
     * Swipe-attempt detection, in place of useCardDrag's handlers. The card never follows
     * the finger; a press that travels past SWIPE_ATTEMPT_PX on the graded back is a
     * dismiss, exactly as if tapped. Only start/end matter, so no move listener.
     *
     * The tap that would otherwise follow is swallowed so it cannot dismiss twice or
     * open a cell's inspect view under the departing card (a swipe that STARTED on a
     * cell still bubbles here): touch via preventDefault on touchend (React's touchend
     * listener is not passive), mouse via a one-shot capture-phase click blocker —
     * a mouse click fires after mouseup however far the pointer moved.
     */
    const pressStart = useRef<{ x: number; y: number } | null>(null);
    const travelled = (x: number, y: number) =>
        !!pressStart.current && Math.hypot(x - pressStart.current.x, y - pressStart.current.y) >= SWIPE_ATTEMPT_PX;
    const swallowNextClick = () => {
        const block = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); };
        window.addEventListener("click", block, { capture: true, once: true });
        // No click followed (pointer released off the card) — drop the blocker.
        window.setTimeout(() => window.removeEventListener("click", block, { capture: true }), 0);
    };
    const swipeHandlers = {
        onTouchStart: (e: React.TouchEvent) => {
            const t = e.touches[0];
            pressStart.current = t ? { x: t.clientX, y: t.clientY } : null;
        },
        onTouchEnd: (e: React.TouchEvent) => {
            const t = e.changedTouches[0];
            const swiped = !!t && travelled(t.clientX, t.clientY);
            pressStart.current = null;
            if (swiped && sendOff()) e.preventDefault();
        },
        onMouseDown: (e: React.MouseEvent) => {
            pressStart.current = { x: e.clientX, y: e.clientY };
            // mouseup on the document: the release may land off the card.
            const onUp = (up: MouseEvent) => {
                const swiped = travelled(up.clientX, up.clientY);
                pressStart.current = null;
                if (swiped && sendOff()) swallowNextClick();
            };
            document.addEventListener("mouseup", onUp, { once: true });
        },
    };

    const renderFace: WritingFaceRenderer = (cardEntry, side, role) => {
        const state =
            role === "front" ? live
                : role === "flying" && outgoing?.entryId === cardEntry.id ? outgoing
                    : blankAttempt(cardEntry);
        // The back face is only ever SEEN once graded; skip drawing it before then.
        if (side === "back" && !state.results) return null;
        return (
            <WritingCardFace
                entry={cardEntry}
                side={side}
                level={writingLevelForMastery(cardEntry.writingMastery ?? 0)}
                inks={state.inks}
                locked={state.locked}
                results={state.results}
                checking={role === "front" && checking}
                interactive={role === "front" && !isAnimating}
                onOpenCell={(index, el) => {
                    setEditingOrigin(el);
                    setEditing(index);
                }}
                onInspectCell={setInspecting}
                flashNonce={role === "front" ? shakeNonce : 0}
            />
        );
    };

    const chars = entry ? [...entry.entryKey] : [];
    const overlays = enabled ? (
        <>
            {/* Writing one character, at the card's level. Closed only by tapping out.
                No backdrop and no Fade: the editor brings its own scrim and morphs out of
                the tapped cell (WritingPanel), which a Dialog fade would wash out. */}
            <Dialog
                open={editing !== null}
                hideBackdrop
                transitionDuration={0}
                PaperProps={{ elevation: 0, sx: PHONE_OVERLAY_SX }}
                onClose={() => {}}
            >
                {editing !== null && chars[editing] && (
                    <Box sx={{ position: "relative", height: "100%" }}>
                        <WritingFocusEditor
                            char={chars[editing]}
                            pinyin={null}
                            level={level}
                            initialInk={live.inks[editing] ?? []}
                            origin={editingOrigin}
                            onDone={(ink, meta) => handleEditorDone(editing, ink, meta)}
                        />
                    </Box>
                )}
            </Dialog>

            {/* Back face: one character enlarged, the learner's ink over the outline.
                The dim is the Dialog's own backdrop (the theme's `COLORS.modalScrim`); this
                full-paper box is only the tap-anywhere-to-close target. It used to paint a
                second modalScrim over the backdrop, dimming the screen twice. */}
            <Dialog open={inspecting !== null} onClose={() => setInspecting(null)} PaperProps={{ elevation: 0, sx: PHONE_OVERLAY_SX }}>
                {inspecting !== null && chars[inspecting] && (
                    <Box
                        className="writing-flashcard__inspect"
                        onClick={() => setInspecting(null)}
                        sx={{ position: "relative", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}
                    >
                        <Box sx={{ position: "relative", width: WRITING_FOCUS_SIZE, height: WRITING_FOCUS_SIZE, bgcolor: COLORS.white, borderRadius: 3, border: `1px solid ${COLORS.border}`, overflow: "hidden" }}>
                            <WritingStage
                                character={chars[inspecting]}
                                size={WRITING_FOCUS_SIZE}
                                drawable={false}
                                showGuide
                                guideVisible
                                loopAnimation={false}
                                // Snap ink is snapped strokes: paint them as printed shapes.
                                snap={levelPreview(modeOfLevel(level)).snap}
                                initialInk={live.inks[inspecting] ?? []}
                                result={live.results ? (live.results[inspecting] ? "correct" : "wrong") : "idle"}
                            />
                        </Box>
                    </Box>
                )}
            </Dialog>
        </>
    ) : null;

    return { renderFace, handleCardClick, swipeHandlers, shakeNonce, overlays };
}
