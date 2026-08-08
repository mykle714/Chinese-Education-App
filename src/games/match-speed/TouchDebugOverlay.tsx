import { useEffect, useRef, useState } from "react";
import { Box } from "@mui/material";

/**
 * TEMPORARY DIAGNOSTIC — live touch-layer readout for the iOS "second thumb does
 * nothing" bug in Match Speed. Delete once that bug is resolved.
 *
 * WHY THIS EXISTS. The telemetry in `src/utils/perfDiagnostics.ts` observes the
 * touch and pointer layers from inside JavaScript, which means it is blind by
 * construction to a contact iOS rejects *before* dispatching any event (palm
 * rejection, a system edge gesture, the OS merging two contacts). In the logs,
 * "the player pressed once" and "the player pressed twice and iOS ate one" are
 * literally the same bytes. No amount of post-hoc log analysis can separate them.
 *
 * This overlay closes that gap by putting the ground truth in front of the person
 * who knows how many fingers they actually used: press two thumbs, read the
 * number. If it says 2, the touches arrive and the game mishandles them (our
 * bug). If it says 1 while two fingers are down, the second contact never reached
 * the page at all (an OS/WebKit-layer problem, and a much bigger decision).
 *
 * CONSTRAINTS, both load-bearing:
 *  - Every listener is `passive: true`. A non-passive listener on these events can
 *    itself change WebKit's gesture arbitration, which would make the overlay
 *    alter the very behaviour it is measuring.
 *  - The overlay is `pointerEvents: "none"` and sits above the board, so it can
 *    never intercept a tap meant for a card.
 *
 * Enabled only by the `?touchdebug=1` query param (see MatchSpeedPage), so it is
 * invisible to every other player.
 */

/** One line in the display, newest first. A `separator` carries no event — it is
 *  the blank row inserted between bursts so one press can be told from the next. */
interface TouchLogEntry {
    /** Monotonic sequence number — cheaper to render as a key than a timestamp,
     *  and unambiguous when two events share a millisecond. */
    seq: number;
    /** ms since page load, i.e. the SAME clock as the `at` field on the telemetry
     *  records in perfDiagnostics. That is deliberate: a number read off the screen
     *  can then be looked up directly in the server-side JSONL. */
    at: number;
    label: string;
    separator?: boolean;
}

/** How many rows to keep on screen. Sized to hold several whole presses (a
 *  two-thumb press is 4 events) plus their separators, without covering the board. */
const LOG_LENGTH = 16;

/** A gap this long since the previous event means a new press is starting, so a
 *  separator goes in ahead of it. Chosen from the measured data: the two halves of
 *  one two-thumb press land 30–115ms apart, while consecutive presses are 450ms+
 *  apart — so anything past ~300ms is a burst boundary with wide margin on both
 *  sides. Grouping this way is what keeps a relevant burst legible instead of
 *  smeared into the noise around it. */
const BURST_GAP_MS = 300;

export function TouchDebugOverlay(): React.ReactElement {
    // Live finger count, straight from TouchEvent.touches.length.
    const [active, setActive] = useState(0);
    // High-water mark across the whole session. This is the single most important
    // number: if it never reaches 2, the page never saw two simultaneous fingers.
    const [maxConcurrent, setMaxConcurrent] = useState(0);
    const [starts, setStarts] = useState(0);
    const [pointerDowns, setPointerDowns] = useState(0);
    const [log, setLog] = useState<TouchLogEntry[]>([]);

    // Sequence counter in a ref: bumping it must not itself trigger a render, and
    // it must survive the state updates below without going through the batching.
    const seqRef = useRef(0);
    /** performance.now() of the previous logged event, for burst detection. */
    const lastAtRef = useRef(0);

    useEffect(() => {
        const push = (label: string) => {
            const at = performance.now();
            // Burst boundary: a long quiet stretch means the previous press is
            // over. Computed from the ref (not from `log`) so this stays correct
            // regardless of when React flushes the state update.
            const gap = at - lastAtRef.current;
            const wantSeparator = lastAtRef.current > 0 && gap >= BURST_GAP_MS;
            lastAtRef.current = at;

            setLog((prev) => {
                const next = [{ seq: (seqRef.current += 1), at, label }, ...prev];
                // Never two separators in a row: a run of them would push real
                // events off the screen, which is exactly what the separator is
                // meant to prevent. `prev[0]` is the newest existing row.
                if (wantSeparator && !prev[0]?.separator) {
                    next.splice(1, 0, {
                        seq: (seqRef.current += 1),
                        at,
                        label: "",
                        separator: true,
                    });
                }
                return next.slice(0, LOG_LENGTH);
            });
        };

        const onStart = (e: TouchEvent) => {
            const n = e.touches.length;
            setActive(n);
            setMaxConcurrent((m) => Math.max(m, n));
            setStarts((s) => s + 1);
            push(`down  touches=${n} changed=${e.changedTouches.length}`);
        };
        const onEnd = (e: TouchEvent) => {
            const n = e.touches.length;
            setActive(n);
            push(`${e.type === "touchcancel" ? "CANCEL" : "up"}    touches=${n}`);
        };
        const onPointerDown = () => setPointerDowns((p) => p + 1);
        // Fires when WebKit claims two fingers as a page gesture — the moment a
        // second contact would go missing if gesture arbitration were the cause.
        const onGesture = () => push("gesturestart (WebKit)");

        const opts = { capture: true, passive: true } as const;
        window.addEventListener("touchstart", onStart, opts);
        window.addEventListener("touchend", onEnd, opts);
        window.addEventListener("touchcancel", onEnd, opts);
        window.addEventListener("pointerdown", onPointerDown, opts);
        window.addEventListener("gesturestart", onGesture, opts);
        return () => {
            window.removeEventListener("touchstart", onStart, opts);
            window.removeEventListener("touchend", onEnd, opts);
            window.removeEventListener("touchcancel", onEnd, opts);
            window.removeEventListener("pointerdown", onPointerDown, opts);
            window.removeEventListener("gesturestart", onGesture, opts);
        };
    }, []);

    return (
        <Box
            className="match-speed__touch-debug"
            sx={{
                position: "fixed",
                top: 8,
                left: 8,
                right: 8,
                // Above the board and the countdown overlay (zIndex 5), but inert.
                zIndex: 2000,
                pointerEvents: "none",
                bgcolor: "rgba(0,0,0,0.82)",
                color: "#fff",
                borderRadius: 1,
                px: 1.25,
                py: 0.75,
                fontFamily: "monospace",
                fontSize: 12,
                lineHeight: 1.45,
            }}
        >
            <Box
                className="match-speed__touch-debug-headline"
                sx={{
                    fontSize: 22,
                    fontWeight: 700,
                    // Green the instant the page has proven it can see two fingers.
                    color: maxConcurrent >= 2 ? "#5dff9b" : "#ff8a8a",
                }}
            >
                fingers: {active} &nbsp; max: {maxConcurrent}
            </Box>
            <Box className="match-speed__touch-debug-counts">
                touchstart {starts} &nbsp;|&nbsp; pointerdown {pointerDowns}
            </Box>
            {log.map((entry) =>
                entry.separator ? (
                    // Blank spacer row: visually separates one press from the next.
                    <Box
                        key={entry.seq}
                        className="match-speed__touch-debug-separator"
                        sx={{
                            height: 8,
                            borderTop: "1px solid rgba(255,255,255,0.28)",
                            mt: 0.5,
                        }}
                    />
                ) : (
                    <Box key={entry.seq} className="match-speed__touch-debug-line">
                        {/* Seconds since page load to 3dp — the same clock as the
                            `at` field in the server-side telemetry, so a timestamp
                            read off the screen can be grepped straight out of the
                            JSONL (12.345 here = at:12345 there). */}
                        <Box
                            component="span"
                            className="match-speed__touch-debug-time"
                            sx={{ color: "#9fd0ff", mr: 1 }}
                        >
                            {(entry.at / 1000).toFixed(3)}
                        </Box>
                        {entry.label}
                    </Box>
                )
            )}
        </Box>
    );
}
