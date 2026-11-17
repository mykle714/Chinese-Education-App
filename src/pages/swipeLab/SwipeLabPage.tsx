import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box } from "@mui/material";
import { useCardDrag } from "../../features/flashcards/FlashcardsLearnPage/useCardDrag";
import {
    CARD_FLY_OUT_MS,
    CARD_FLY_OUT_TRANSITION,
    CORRECT_WASH,
    FLP_CARD_ASPECT,
    FLY_OUT_ROTATION,
    FLY_OUT_X,
    INCORRECT_WASH,
    TOWER_CARD_FLIP_MS,
    CARD_DISMISS_THRESHOLD_VW,
    CARD_DRAG_SENSITIVITY,
} from "../../features/flashcards/constants";
import { useBlockEdgeSwipe } from "../../hooks/useBlockEdgeSwipe";
import { COLORS } from "../../theme/colors";
import { FONTS, DATA_TYPE } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { CARD_SURFACE } from "../../theme/surfaces";
import { roundedEdgeFilletDown, roundedEdgeRimLightTop } from "../../theme/roundedEdge";
import {
    isFlpRecordingOn,
    rectOf,
    sendGestureRecords,
    setFlpRecording,
    watchGestures,
    type RawGesture,
} from "../../utils/gestureRecorder";

/**
 * /swipe-lab — guided data collection for tuning the flp card's swipe/tap classifier.
 *
 * The tester is walked through a shuffled script of LABELED gestures ("flick right —
 * fast", "tap", "drag out and back") on a lab card. The card is driven by the PRODUCTION
 * hook (useCardDrag) — not a copy — so each record carries both what the finger did
 * (raw touch + coalesced pointer samples, src/utils/gestureRecorder.ts) and what the
 * shipped classifier decided about it. Comparing intent against verdict over a real
 * phone's input is the whole point: the thresholds can then be tuned offline against
 * the recorded samples rather than by feel.
 *
 * The page can also opt this DEVICE into recording the live flp (flpGestureProbe.ts):
 * unlabeled, but in real study conditions, plus the fly-out clip probe.
 *
 * Dev-only. Not linked from any menu; reachable by typing the URL. Plain shell (no
 * footer/header) so the card has the screen to itself, like the flp.
 * Sink: POST /api/diagnostics/gestures → client-gestures-YYYY-MM-DD.jsonl.
 * Docs: docs/SWIPE_LAB.md.
 */

/** What the tester was asked to do. `expect` is the verdict production SHOULD give. */
interface PromptSpec {
    intent: string;
    title: string;
    hint: string;
    /** The card state the prompt starts in: face-down (taps flip) or flipped (swipeable). */
    flipped: boolean;
    expect: Expectation;
    count: number;
}

type Expectation = "flip" | "tap" | "right" | "left" | "stay";

/** What the production hook actually did with the gesture. */
type Verdict = "flip" | "shake" | "dismiss-right" | "dismiss-left" | "snap-back";

const PROMPT_SPECS: readonly PromptSpec[] = [
    { intent: "tap-unflipped", title: "Tap", hint: "An ordinary tap to flip the card.", flipped: false, expect: "flip", count: 5 },
    { intent: "tap-flipped", title: "Tap", hint: "An ordinary tap — the card is already flipped.", flipped: true, expect: "tap", count: 5 },
    { intent: "swipe-right", title: "Swipe right", hint: "Your normal, relaxed swipe.", flipped: true, expect: "right", count: 4 },
    { intent: "swipe-left", title: "Swipe left", hint: "Your normal, relaxed swipe.", flipped: true, expect: "left", count: 4 },
    { intent: "flick-right", title: "Flick right, fast", hint: "A short, quick flick of the thumb.", flipped: true, expect: "right", count: 6 },
    { intent: "flick-left", title: "Flick left, fast", hint: "A short, quick flick of the thumb.", flipped: true, expect: "left", count: 6 },
    { intent: "flick-tiny-right", title: "Tiniest flick right", hint: "The smallest flick you'd still expect to count.", flipped: true, expect: "right", count: 3 },
    { intent: "flick-tiny-left", title: "Tiniest flick left", hint: "The smallest flick you'd still expect to count.", flipped: true, expect: "left", count: 3 },
    { intent: "cancel", title: "Drag out, then back", hint: "Pull the card well to one side, bring it back to the middle, let go.", flipped: true, expect: "stay", count: 4 },
    { intent: "nudge", title: "Nudge, then let go", hint: "Push it a little sideways, slowly — you changed your mind.", flipped: true, expect: "stay", count: 4 },
];

/** One run's script: every spec repeated `count` times, Fisher–Yates shuffled so the
 *  tester can't settle into a rhythm that a real study session wouldn't have. */
function buildScript(): PromptSpec[] {
    const list = PROMPT_SPECS.flatMap((p) => Array.from({ length: p.count }, () => p));
    for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
}

function matches(expect: Expectation, verdict: Verdict): boolean {
    switch (expect) {
        case "flip": return verdict === "flip";
        case "tap": return verdict === "shake";
        case "right": return verdict === "dismiss-right";
        case "left": return verdict === "dismiss-left";
        case "stay": return verdict === "snap-back";
    }
}

const VERDICT_COPY: Record<Verdict, string> = {
    flip: "flipped",
    shake: "read as a tap",
    "dismiss-right": "swiped right",
    "dismiss-left": "swiped left",
    "snap-back": "snapped back",
};

/** How long after the last finger lifts before the verdict is read. The hook decides
 *  inside touchend, but its effects (shake/flip) only commit on the next render. */
const VERDICT_SETTLE_MS = 160;
/** Pause on a non-dismiss result so the tester sees it before the next prompt. */
const RESULT_HOLD_MS = 420;

type Phase = "intro" | "run" | "done";

interface ResultLine {
    seq: number;
    intent: string;
    expect: Expectation;
    verdict: Verdict;
    ok: boolean;
}

const SwipeLabPage: React.FC = () => {
    // The lab card swipes near the screen edges; without this, iOS takes a flick that
    // starts there as "back".
    useBlockEdgeSwipe(true);

    const [phase, setPhase] = useState<Phase>("intro");
    const [script, setScript] = useState<PromptSpec[]>(() => buildScript());
    // Index into `script`; also the hook's resetKey, so every prompt is a fresh card.
    const [step, setStep] = useState(0);
    // Monotonic gesture number across redos/rounds — the key a discard record names.
    const seqRef = useRef(0);
    const [results, setResults] = useState<ResultLine[]>([]);
    const [uploads, setUploads] = useState({ ok: 0, failed: 0 });
    const [recordFlp, setRecordFlpState] = useState(isFlpRecordingOn);

    const [isAnimating, setIsAnimating] = useState(false);
    const [flyDir, setFlyDir] = useState<"left" | "right" | null>(null);
    // True between a gesture's end and the next prompt; gestures in that window are
    // neither recorded nor allowed to reach the card.
    const busyRef = useRef(false);

    const prompt: PromptSpec | undefined = script[step];

    // ── Verdict capture ────────────────────────────────────────────────────────────────
    // The hook reports a dismiss through onDismiss and a tap/flip only through state, so
    // the verdict is assembled from all three.
    const verdictRef = useRef<{ verdict: Verdict; at: number } | null>(null);
    // Open from a gesture's first touch until its verdict is read. State changes outside
    // that window are the lab's own doing (goTo restoring a flipped card) and must not be
    // mistaken for the hook's verdict.
    const armedRef = useRef(false);
    const onDismiss = useCallback((dir: "left" | "right") => {
        if (!armedRef.current) return;
        verdictRef.current = { verdict: dir === "right" ? "dismiss-right" : "dismiss-left", at: performance.now() };
        setIsAnimating(true);
        setFlyDir(dir);
    }, []);

    const card = useCardDrag(isAnimating, onDismiss, step, TOWER_CARD_FLIP_MS);

    useEffect(() => {
        if (armedRef.current && card.shakeNonce > 0 && !verdictRef.current) verdictRef.current = { verdict: "shake", at: performance.now() };
    }, [card.shakeNonce]);
    const prevFlippedRef = useRef(card.isFlipped);
    useEffect(() => {
        if (armedRef.current && card.isFlipped && !prevFlippedRef.current && !verdictRef.current) {
            verdictRef.current = { verdict: "flip", at: performance.now() };
        }
        prevFlippedRef.current = card.isFlipped;
    }, [card.isFlipped]);

    // Every dragPosition COMMIT, timestamped: compared against the raw samples it shows how
    // far behind the finger the state the hook classifies on actually is at release.
    const commitsRef = useRef<{ t: number; x: number; y: number }[]>([]);
    useEffect(() => {
        if (commitsRef.current.length < 300) {
            commitsRef.current.push({ t: Math.round(performance.now() * 10) / 10, x: Math.round(card.dragPosition.x), y: Math.round(card.dragPosition.y) });
        }
    }, [card.dragPosition]);

    // ── Advancing ──────────────────────────────────────────────────────────────────────
    // Put the hook's card in the state the NEXT prompt asks for, then move to it.
    const goTo = useCallback((next: number, list: PromptSpec[]) => {
        verdictRef.current = null;
        if (next >= list.length) {
            setPhase("done");
            busyRef.current = false;
            return;
        }
        // Always start from a clean card (a redo can re-use the same step, where the hook's
        // resetKey effect would not fire), then restoreFlipped keys the flip to the incoming
        // resetKey so the per-card reset lands on Side 2 for a "flipped" prompt.
        card.resetCard();
        if (list[next].flipped) card.restoreFlipped(next);
        setStep(next);
        busyRef.current = false;
    }, [card]);

    // The fly-out ends → clear the release offset and advance (mirrors the flp's own
    // CARD_FLY_OUT_MS timeout).
    useEffect(() => {
        if (!flyDir) return;
        const timer = window.setTimeout(() => {
            card.resetDragPosition();
            setFlyDir(null);
            setIsAnimating(false);
            goTo(step + 1, script);
        }, CARD_FLY_OUT_MS);
        return () => window.clearTimeout(timer);
        // Only the fly-out starting should arm this; step/script are read at fire time.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [flyDir]);

    // ── Recording ──────────────────────────────────────────────────────────────────────
    const frameRef = useRef<HTMLDivElement | null>(null);
    const cardElRef = card.cardRef;

    // Upload with one retry; the counters tell the tester whether data is landing.
    const ship = useCallback(async (records: unknown[]) => {
        const ok = (await sendGestureRecords(records)) || (await sendGestureRecords(records));
        setUploads((u) => (ok ? { ...u, ok: u.ok + 1 } : { ...u, failed: u.failed + 1 }));
    }, []);

    // The latest render's values for the watcher's callbacks, which are bound once.
    const liveRef = useRef({ prompt, step, script, phase });
    liveRef.current = { prompt, step, script, phase };

    useEffect(() => {
        const frame = frameRef.current;
        if (!frame) return;

        const onStart = () => {
            if (busyRef.current) return;
            commitsRef.current = [];
            verdictRef.current = null;
            armedRef.current = true;
        };
        const onEnd = (g: RawGesture) => {
            const live = liveRef.current;
            if (live.phase !== "run" || busyRef.current || !live.prompt) return;
            busyRef.current = true;
            window.setTimeout(() => {
                armedRef.current = false;
                const v = verdictRef.current?.verdict ?? "snap-back";
                const seq = ++seqRef.current;
                const p = live.prompt!;
                const cardEl = cardElRef.current;
                const cardWidth = cardEl?.offsetWidth ?? 0;
                void ship([{
                    kind: "lab-gesture",
                    seq,
                    intent: p.intent,
                    expect: p.expect,
                    verdict: v,
                    ok: matches(p.expect, v),
                    cardStartedFlipped: p.flipped,
                    verdictAt: verdictRef.current ? Math.round(verdictRef.current.at * 10) / 10 : null,
                    // The classifier's live constants, so a later tuning reads each record
                    // against the thresholds that judged it.
                    classifier: {
                        dismissThresholdFrac: CARD_DISMISS_THRESHOLD_VW,
                        sensitivity: CARD_DRAG_SENSITIVITY,
                        cardWidth,
                    },
                    cardRect: frame ? rectOf(frame) : null,
                    gesture: g,
                    commits: commitsRef.current,
                }]);
                const ok = matches(p.expect, v);
                setResults((r) => [...r, { seq, intent: p.intent, expect: p.expect, verdict: v, ok }]);
                // A dismiss advances when its fly-out ends (effect above); anything else
                // holds the result briefly, then moves on.
                if (v !== "dismiss-left" && v !== "dismiss-right") {
                    window.setTimeout(() => {
                        card.resetDragPosition();
                        goTo(live.step + 1, live.script);
                    }, RESULT_HOLD_MS);
                }
            }, VERDICT_SETTLE_MS);
        };
        return watchGestures(frame, onEnd, onStart);
        // Bound once per run: everything that changes is read through liveRef / refs.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase]);

    // ── Controls ───────────────────────────────────────────────────────────────────────
    const start = () => {
        const list = buildScript();
        setScript(list);
        setResults([]);
        setPhase("run");
        goTo(0, list);
    };

    // The tester fumbled the last gesture: tell the server to drop it, and ask for that
    // prompt again by inserting a copy right after the current step.
    const redoLast = () => {
        const last = results[results.length - 1];
        if (!last || busyRef.current) return;
        void ship([{ kind: "lab-discard", seq: last.seq }]);
        setResults((r) => r.slice(0, -1));
        const spec = PROMPT_SPECS.find((p) => p.intent === last.intent);
        if (!spec) return;
        const list = [...script.slice(0, step), spec, ...script.slice(step)];
        setScript(list);
        goTo(step, list);
    };

    const skip = () => {
        if (busyRef.current) return;
        goTo(step + 1, script);
    };

    const toggleFlp = () => {
        const next = !recordFlp;
        setFlpRecording(next);
        setRecordFlpState(next);
    };

    const last = results[results.length - 1];
    const correct = results.filter((r) => r.ok).length;

    // Per-intent tally for the done screen: where the shipped classifier goes wrong.
    const tally = useMemo(() => {
        const m = new Map<string, { ok: number; n: number; misses: Partial<Record<Verdict, number>> }>();
        for (const r of results) {
            const t = m.get(r.intent) ?? { ok: 0, n: 0, misses: {} };
            t.n++;
            if (r.ok) t.ok++;
            else t.misses[r.verdict] = (t.misses[r.verdict] ?? 0) + 1;
            m.set(r.intent, t);
        }
        return [...m.entries()];
    }, [results]);

    // ── Card pose (a cut-down FlashCardSection: follow the drag, fly out on dismiss) ──
    const { x, y } = card.dragPosition;
    const dismissThreshold = CARD_DISMISS_THRESHOLD_VW * (cardElRef.current?.offsetWidth ?? 300);
    let transform = `translate(${x}px, ${y}px) rotate(${x * 0.05}deg)`;
    let transition = card.isDragging ? "none" : CARD_FLY_OUT_TRANSITION;
    if (flyDir) {
        const sign = flyDir === "right" ? 1 : -1;
        transform = `translate(${sign * FLY_OUT_X}px, ${y}px) rotate(${sign * FLY_OUT_ROTATION}deg)`;
        transition = CARD_FLY_OUT_TRANSITION;
    }
    const wash = x > dismissThreshold ? CORRECT_WASH : x < -dismissThreshold ? INCORRECT_WASH : "transparent";

    return (
        <Box
            className="swipe-lab"
            sx={{
                height: "100dvh",
                width: "100%",
                overflow: "hidden",
                touchAction: "none",
                backgroundColor: COLORS.background,
                color: COLORS.onSurface,
                fontFamily: FONTS.sans,
                display: "flex",
                flexDirection: "column",
                paddingTop: "max(16px, env(safe-area-inset-top))",
                paddingBottom: "max(16px, env(safe-area-inset-bottom))",
                boxSizing: "border-box",
            }}
        >
            {/* ── Prompt band ── */}
            <Box className="swipe-lab__prompt" sx={{ padding: "0 20px", minHeight: 96 }}>
                <Box className="swipe-lab__overline" sx={{ ...DATA_TYPE, fontSize: SIZE.micro, letterSpacing: "0.12em", textTransform: "uppercase", color: COLORS.textFaint, display: "flex", justifyContent: "space-between" }}>
                    <span>Swipe lab{phase === "run" ? ` · ${Math.min(step + 1, script.length)} / ${script.length}` : ""}</span>
                    <span className="swipe-lab__uploads">
                        {uploads.ok} sent{uploads.failed > 0 ? ` · ${uploads.failed} failed` : ""}
                    </span>
                </Box>
                {phase === "run" && prompt && (
                    <>
                        <Box className="swipe-lab__title" sx={{ fontSize: SIZE.heading, fontWeight: WEIGHT.semibold, marginTop: "6px", lineHeight: 1.15 }}>
                            {prompt.title}
                        </Box>
                        <Box className="swipe-lab__hint" sx={{ fontSize: SIZE.body, color: COLORS.textSecondary, marginTop: "4px" }}>
                            {prompt.hint}
                        </Box>
                    </>
                )}
                {phase === "intro" && (
                    <>
                        <Box className="swipe-lab__title" sx={{ fontSize: SIZE.heading, fontWeight: WEIGHT.semibold, marginTop: "6px" }}>
                            Swipe &amp; tap tuning
                        </Box>
                        <Box className="swipe-lab__hint" sx={{ fontSize: SIZE.body, color: COLORS.textSecondary, marginTop: "4px", lineHeight: 1.5 }}>
                            {script.length} short prompts. Hold the phone the way you study and do what each one
                            says. Each gesture is sent as you go. Fumbled one? Tap Redo.
                        </Box>
                    </>
                )}
                {phase === "done" && (
                    <>
                        <Box className="swipe-lab__title" sx={{ fontSize: SIZE.heading, fontWeight: WEIGHT.semibold, marginTop: "6px" }}>
                            Done: {correct} / {results.length} read right
                        </Box>
                        <Box className="swipe-lab__hint" sx={{ fontSize: SIZE.body, color: COLORS.textSecondary, marginTop: "4px" }}>
                            That's the app's current classifier. The raw data is on the server.
                        </Box>
                    </>
                )}
            </Box>

            {/* ── Stage ── */}
            <Box className="swipe-lab__stage" sx={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", padding: "12px 0" }}>
                {phase === "done" ? (
                    <Box className="swipe-lab__tally" sx={{ width: "100%", maxWidth: 420, padding: "0 20px", overflowY: "auto", maxHeight: "100%", touchAction: "pan-y" }}>
                        {tally.map(([intent, t]) => (
                            <Box key={intent} className="swipe-lab__tally-row" sx={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${COLORS.rowBorder}`, fontSize: SIZE.body }}>
                                <span>{intent}</span>
                                <Box component="span" sx={{ ...DATA_TYPE, color: t.ok === t.n ? COLORS.textSecondary : COLORS.onSurface, fontWeight: t.ok === t.n ? WEIGHT.regular : WEIGHT.semibold }}>
                                    {t.ok}/{t.n}
                                    {Object.entries(t.misses).map(([v, n]) => ` · ${n}× ${VERDICT_COPY[v as Verdict]}`).join("")}
                                </Box>
                            </Box>
                        ))}
                    </Box>
                ) : (
                    // The frame is the recorder's target and stays mounted across the card's
                    // shake remounts (the card itself is keyed on shakeNonce, as in the flp).
                    <Box
                        ref={frameRef}
                        className="swipe-lab__card-frame"
                        sx={{
                            height: "100%",
                            maxHeight: 460,
                            maxWidth: "78vw",
                            aspectRatio: `${FLP_CARD_ASPECT.width} / ${FLP_CARD_ASPECT.height}`,
                            position: "relative",
                            // An intro card is inert: the run hasn't started.
                            pointerEvents: phase === "run" ? undefined : "none",
                            opacity: phase === "run" ? 1 : 0.5,
                        }}
                    >
                        <Box
                            key={`card-${card.shakeNonce}`}
                            ref={cardElRef}
                            className="swipe-lab__card"
                            onTouchStart={card.handlers.onTouchStart}
                            onTouchEnd={card.handlers.onTouchEnd}
                            onMouseDown={card.handlers.onMouseDown}
                            sx={{
                                position: "absolute",
                                inset: 0,
                                ...CARD_SURFACE,
                                borderRadius: "18px",
                                backgroundColor: card.isFlipped ? COLORS.white : COLORS.cardFace,
                                transform,
                                transition,
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: "10px",
                                overflow: "hidden",
                                ...(card.shakeNonce > 0 && !card.isDragging && !flyDir ? {
                                    animation: "swipeLabShake 0.42s ease-in-out",
                                    "@keyframes swipeLabShake": {
                                        "0%, 100%": { transform: "translate(0px, 0px)" },
                                        "25%": { transform: "translate(-9px, 0)" },
                                        "50%": { transform: "translate(9px, 0)" },
                                        "75%": { transform: "translate(-5px, 0)" },
                                    },
                                } : {}),
                            }}
                        >
                            <Box className="swipe-lab__card-wash" sx={{ position: "absolute", inset: 0, backgroundColor: wash, opacity: Math.min(Math.abs(x) / (dismissThreshold * 3), 0.35), pointerEvents: "none" }} />
                            <Box className="swipe-lab__card-glyph" sx={{ fontFamily: FONTS.cjk, fontSize: SIZE.display, color: COLORS.onSurface, position: "relative" }}>
                                卡片
                            </Box>
                            <Box className="swipe-lab__card-side" sx={{ ...DATA_TYPE, fontSize: SIZE.micro, letterSpacing: "0.12em", textTransform: "uppercase", color: COLORS.textFaint, position: "relative" }}>
                                {card.isFlipped ? "Side 2 · swipeable" : "Side 1 · tap to flip"}
                            </Box>
                        </Box>
                    </Box>
                )}
            </Box>

            {/* ── Result + controls ── */}
            <Box className="swipe-lab__footer" sx={{ padding: "0 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
                {phase === "run" && (
                    <Box className="swipe-lab__result" sx={{ minHeight: 22, fontSize: SIZE.body, textAlign: "center", color: COLORS.textSecondary }}>
                        {last && (
                            <>
                                <Box component="span" sx={{ fontWeight: WEIGHT.semibold, color: last.ok ? COLORS.onSurface : COLORS.keywordInk }}>
                                    {last.ok ? "✓" : "✗"}
                                </Box>
                                {` ${PROMPT_SPECS.find((p) => p.intent === last.intent)?.title.toLowerCase()} → ${VERDICT_COPY[last.verdict]}`}
                            </>
                        )}
                    </Box>
                )}
                <Box className="swipe-lab__buttons" sx={{ display: "flex", gap: "10px" }}>
                    {phase === "run" ? (
                        <>
                            <LabButton className="swipe-lab__redo" onClick={redoLast} disabled={!last}>Redo last</LabButton>
                            <LabButton className="swipe-lab__skip" onClick={skip}>Skip</LabButton>
                        </>
                    ) : (
                        <LabButton className="swipe-lab__start" onClick={start} primary>
                            {phase === "intro" ? "Start" : "Another round"}
                        </LabButton>
                    )}
                </Box>
                {phase !== "run" && (
                    <Box
                        component="label"
                        className="swipe-lab__flp-toggle"
                        sx={{ display: "flex", alignItems: "center", gap: "10px", fontSize: SIZE.caption, color: COLORS.textSecondary, lineHeight: 1.4 }}
                    >
                        <input type="checkbox" checked={recordFlp} onChange={toggleFlp} className="swipe-lab__flp-checkbox" />
                        Also record my real flashcard sessions on this phone (swipes + fly-out clipping)
                    </Box>
                )}
            </Box>
        </Box>
    );
};

/** The lab's one button: outlined, straight-lip keycap with the rounded edge. */
const LabButton: React.FC<{
    className: string;
    onClick: () => void;
    disabled?: boolean;
    primary?: boolean;
    children: React.ReactNode;
}> = ({ className, onClick, disabled, primary, children }) => {
    const face = primary ? COLORS.gld : COLORS.white;
    const wall = primary ? COLORS.gldFrame : COLORS.greyA;
    return (
        <Box
            component="button"
            className={className}
            onClick={onClick}
            disabled={disabled}
            sx={{
                flex: 1,
                height: 48,
                border: `1px solid ${COLORS.border}`,
                borderRadius: "12px",
                backgroundColor: face,
                color: COLORS.onSurface,
                fontFamily: FONTS.sans,
                fontSize: SIZE.bodyLg,
                fontWeight: WEIGHT.semibold,
                boxShadow: `${roundedEdgeFilletDown(face, wall)}, 0 3px 0 ${wall}, ${roundedEdgeRimLightTop(face)}`,
                opacity: disabled ? 0.4 : 1,
                cursor: disabled ? "default" : "pointer",
                "&:active:not(:disabled)": { transform: "translateY(2px)", boxShadow: `0 1px 0 ${wall}` },
            }}
        >
            {children}
        </Box>
    );
};

export default SwipeLabPage;
