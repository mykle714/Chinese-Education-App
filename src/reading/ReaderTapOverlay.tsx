import { useEffect, useRef } from "react";
import { Box, useMediaQuery, useTheme } from "@mui/material";
import { keyframes } from "@mui/material/styles";
import { COLORS } from "../theme/colors";
import { textareaOffsetAtPoint } from "./textSelectionUtils";
import { findAlternativeCellAt } from "./readerAlternatives";

/** The two tap zones: `left` = back (the left third), `right` = forward. */
export type TapZoneSide = "left" | "right";
/** A request to flash one zone; a new `id` replays the flash even for the same side. */
export interface TapZoneFlash {
    side: TapZoneSide;
    id: number;
}

interface ReaderTapOverlayProps {
    // The reading textarea: taps dispatch their synthetic arrow keys into it in BOTH
    // display modes (it is the one selection model — ReaderCpcdView's header).
    inputRef: React.RefObject<HTMLTextAreaElement | null>;
    // What a vertical drag scrolls. Defaults to the textarea; the Pinyin display mode
    // passes ReaderCpcdView's scroll box, since there the textarea is invisible.
    scrollRef?: { readonly current: HTMLElement | null };
    // Which display mode's words a long-press hit-tests (WORD JUMP below):
    //   "text"   — the textarea's characters, via a mirror (textSelectionUtils →
    //              `textareaOffsetAtPoint`), selected through `onSelectSpanAtOffset`;
    //   "pinyin" — the `[data-span-index]` cpcd words inside `scrollRef` (ReaderCpcdView →
    //              ReaderCpcdWord), clicked, which selects through the view's own click path.
    wordSource: "text" | "pinyin";
    // Text mode's WORD JUMP: select the gsa word containing a character offset
    // (useTextSelection → `selectSpanAtOffset`). Returns the span's start, or null.
    onSelectSpanAtOffset: (offset: number) => number | null;
    // A long-press on EMPTY SPACE (no word under the finger): back to the nothing-selected
    // state (useTextSelection → `clearSelection`), caret parked at the pressed character
    // when one is known.
    onClearSelection: (caretOffset?: number) => void;
    // SENTENCE PRESS (the long-press's second tier): the finger stayed still for
    // SENTENCE_PRESS_EXTRA_MS after WORD JUMP selected a word → widen that word to its
    // sentence (useTextSelection → `selectSentenceAtSelection`). Absent → no second tier.
    onSelectSentence?: () => void;
    // ZONE FLASH: set → flash that zone grey a couple of times over the reading box. Fired
    // when the learner taps the keycap's tap demo (ReaderTapHint → `onZoneTap`), to show
    // where the real zone is.
    flash?: TapZoneFlash | null;
    // The page's time-of-day look is night (useTier2Look → `dark`): flash light, not grey.
    night?: boolean;
    // Called when the flash animation finishes, so the owner clears `flash`. A request left
    // set would replay whenever this overlay REMOUNTS — it unmounts for edit mode, so
    // Cancel/Save used to re-flash the last-demoed zone (ReaderDocumentPage → TAP REGION).
    onFlashEnd?: () => void;
}

// Where a tap splits back from forward: a tap in the left third of the overlay (the
// screen's full width — ReaderDocumentPage → TAP REGION) moves the caret back,
// anywhere right of it moves forward. Also drawn as the dotted divide in the keycap's
// nothing-selected demo (ReaderTapHint), so the two never disagree.
export const TAP_LEFT_ZONE_FRACTION = 1 / 3;

// ZONE FLASH: two grey pulses. By day `COLORS.grey` drawn with `multiply`, so the text
// under it stays fully dark — the zone greys, the words do not wash out. At night (the
// Tier 2 look's slate reading card) multiply would darken a dark card by a few percent and
// vanish, so the zone LIFTS instead: a translucent white in normal blending, the same
// strength as the night look's outline (⚠️ off-framework — the framework has no night tier).
const FLASH_NIGHT_FILL = "rgba(255, 255, 255, 0.12)";
const FLASH_MS = 900;
const zoneFlashPulse = keyframes`
    0%   { opacity: 0; }
    15%  { opacity: 1; }
    40%  { opacity: 0; }
    60%  { opacity: 1; }
    100% { opacity: 0; }
`;

// How long a still finger must stay down to become a long-press (WORD JUMP).
const LONG_PRESS_MS = 400;
const MOVE_THRESHOLD_PX = 10;
// SENTENCE PRESS: how much LONGER the finger must stay still after WORD JUMP fired for the
// press to widen to the whole sentence (≈ 1 s in all). Docs:
// docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Sentence Explain".
const SENTENCE_PRESS_EXTRA_MS = 600;

// MOMENTUM (the overlay drives scrolling by hand, so the browser adds no fling of its own):
// the release velocity is averaged over the drag's last VELOCITY_WINDOW_MS, a release
// slower than MIN_FLING_PX_PER_MS just stops, and a fling decays exponentially with time
// constant DECAY_TAU_MS (iOS-like: the coast runs ~velocity × τ px) until it drops under
// STOP_PX_PER_MS or hits the end of the scroll range.
const VELOCITY_WINDOW_MS = 100;
const MIN_FLING_PX_PER_MS = 0.15;
const DECAY_TAU_MS = 325;
const STOP_PX_PER_MS = 0.02;

function ReaderTapOverlay({ inputRef, scrollRef, wordSource, onSelectSpanAtOffset, onClearSelection, onSelectSentence, flash, onFlashEnd, night = false }: ReaderTapOverlayProps) {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down("md"));

    // Per-gesture state lives in refs so we don't re-render mid-touch.
    const gestureRef = useRef<{
        startX: number;
        startY: number;
        startTime: number;
        longPressTimer: number | null;
        // SENTENCE PRESS: armed when a still long-press engaged WORD JUMP on a word;
        // cleared by any move past MOVE_THRESHOLD_PX, a release, or a cancel.
        sentenceTimer: number | null;
        // Set once SENTENCE PRESS fired: the gesture is finished — further moves must not
        // re-run WORD JUMP (finger jitter would snap the selection back to one word).
        sentenceSelected: boolean;
        // Set once the gesture became a WORD JUMP (long-press, or a horizontal drag);
        // pointerup then takes no tap step.
        jumping: boolean;
        // Set once a drag is recognised as a vertical scroll. The overlay then
        // proxies the gesture: it scrolls the textarea beneath it by hand
        // (the textarea is a sibling, not an ancestor, so the browser would
        // otherwise have nothing in the overlay's scroll chain to scroll).
        scrolling: boolean;
        lastY: number;
        // MOMENTUM: recent (time, clientY) samples of the scroll drag.
        samples: Array<{ t: number; y: number }>;
        // This touch landed on a running fling and stopped it — like a native scroller,
        // that touch is not also a tap.
        stoppedFling: boolean;
        // WORD JUMP: what this gesture last selected (a cpcd word element, or a text
        // span's start), so a held finger does not re-run the selection on every move.
        jumpedKey: HTMLElement | number | null;
    } | null>(null);
    const overlayRef = useRef<HTMLDivElement | null>(null);
    // MOMENTUM: the running fling's animation frame, or null.
    const flingFrameRef = useRef<number | null>(null);

    const stopFling = (): boolean => {
        if (flingFrameRef.current === null) return false;
        cancelAnimationFrame(flingFrameRef.current);
        flingFrameRef.current = null;
        return true;
    };
    // A fling must not outlive the overlay (edit mode unmounts it).
    useEffect(() => () => {
        if (flingFrameRef.current !== null) cancelAnimationFrame(flingFrameRef.current);
    }, []);

    if (!isMobile) return null;

    // The element a vertical drag scrolls: the cpcd view's box in the Pinyin mode, the
    // textarea otherwise.
    const scrollTarget = (): HTMLElement | null => scrollRef?.current ?? inputRef.current;

    const clearLongPressTimer = () => {
        const g = gestureRef.current;
        if (g && g.longPressTimer !== null) {
            window.clearTimeout(g.longPressTimer);
            g.longPressTimer = null;
        }
    };
    const clearSentenceTimer = () => {
        const g = gestureRef.current;
        if (g && g.sentenceTimer !== null) {
            window.clearTimeout(g.sentenceTimer);
            g.sentenceTimer = null;
        }
    };

    // Scroll by a finger's movement and record the sample for the release velocity.
    const dragScroll = (clientY: number) => {
        const g = gestureRef.current;
        if (!g) return;
        const scroller = scrollTarget();
        if (scroller) scroller.scrollTop -= clientY - g.lastY;
        g.lastY = clientY;
        const now = performance.now();
        g.samples.push({ t: now, y: clientY });
        while (g.samples.length > 2 && now - g.samples[0].t > VELOCITY_WINDOW_MS) g.samples.shift();
    };

    // MOMENTUM: coast on from the release velocity, decaying each frame.
    const startFling = (samples: Array<{ t: number; y: number }>) => {
        const scroller = scrollTarget();
        if (!scroller || samples.length < 2) return;
        const first = samples[0];
        const last = samples[samples.length - 1];
        // A finger that stopped before lifting carries no momentum.
        if (performance.now() - last.t > VELOCITY_WINDOW_MS) return;
        const dt = last.t - first.t;
        if (dt <= 0) return;
        // px/ms in scrollTop terms: a finger moving UP (y falling) scrolls DOWN.
        let velocity = -(last.y - first.y) / dt;
        if (Math.abs(velocity) < MIN_FLING_PX_PER_MS) return;
        let prev = performance.now();
        const step = (now: number) => {
            const elapsed = Math.max(0, now - prev);
            prev = now;
            const before = scroller.scrollTop;
            scroller.scrollTop = before + velocity * elapsed;
            velocity *= Math.exp(-elapsed / DECAY_TAU_MS);
            // Stop when slow, or when the scroll range's end held the position.
            if (Math.abs(velocity) < STOP_PX_PER_MS || (elapsed > 0 && scroller.scrollTop === before)) {
                flingFrameRef.current = null;
                return;
            }
            flingFrameRef.current = requestAnimationFrame(step);
        };
        flingFrameRef.current = requestAnimationFrame(step);
    };

    // WORD JUMP: select the word drawn under the point. Returns false when the point is
    // over empty space (a gap, punctuation, past a line's end, a blank line) — the
    // caller decides whether that clears the selection. `caretOffset` (text mode only) is
    // the character under the point, even when it is not part of a word.
    const selectWordAt = (clientX: number, clientY: number): { hit: boolean; caretOffset?: number } => {
        const g = gestureRef.current;
        if (wordSource === "pinyin") {
            // The overlay sits on top, so look through it with `elementsFromPoint` and
            // take the first word inside the cpcd scroll box. The click runs
            // ReaderCpcdWord's `onClick` → `selectRange`, the same path a desktop click takes.
            const box = scrollRef?.current;
            if (!box) return { hit: false };
            for (const el of document.elementsFromPoint(clientX, clientY)) {
                const word = el.closest<HTMLElement>("[data-span-index]");
                if (word && box.contains(word)) {
                    if (!g || g.jumpedKey !== word) {
                        if (g) g.jumpedKey = word;
                        word.click();
                    }
                    return { hit: true };
                }
            }
            return { hit: false };
        }
        // Text mode: the textarea draws its own glyphs, so resolve the point to a
        // character with the mirror technique, then to its gsa word.
        const textarea = inputRef.current;
        if (!textarea) return { hit: false };
        const offset = textareaOffsetAtPoint(textarea, clientX, clientY);
        if (offset === null) return { hit: false };
        if (g && typeof g.jumpedKey === "number") {
            // Still inside the word already jumped to → nothing to do.
            const { selectionStart, selectionEnd } = textarea;
            if (g.jumpedKey === selectionStart && offset >= selectionStart && offset < selectionEnd) {
                return { hit: true, caretOffset: offset };
            }
        }
        const spanStart = onSelectSpanAtOffset(offset);
        if (spanStart === null) return { hit: false, caretOffset: offset };
        if (g) g.jumpedKey = spanStart;
        return { hit: true, caretOffset: offset };
    };

    // A long-press (or horizontal drag) engages WORD JUMP: the word under the finger is
    // selected and follows the finger until release. A press over EMPTY SPACE instead
    // returns the reader to the nothing-selected state (owner's call 2026-11-17); after
    // that, sliding onto a word still selects it.
    //
    // SENTENCE PRESS: a STILL long-press (`fromHold` — the timer, not a horizontal drag) that
    // landed on a word arms the second tier; if the finger is still down and has not moved
    // when it fires, the selected word widens to its sentence. A press on empty space never
    // arms it (there is no word to widen).
    const engageWordJump = (clientX: number, clientY: number, fromHold = false) => {
        const g = gestureRef.current;
        if (!g || g.jumping) return;
        g.jumping = true;
        const result = selectWordAt(clientX, clientY);
        if (!result.hit) {
            onClearSelection(result.caretOffset);
            return;
        }
        if (fromHold && onSelectSentence) {
            g.sentenceTimer = window.setTimeout(() => {
                const current = gestureRef.current;
                if (!current) return;
                current.sentenceTimer = null;
                current.sentenceSelected = true;
                onSelectSentence();
            }, SENTENCE_PRESS_EXTRA_MS);
        }
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        // Keep the textarea focused so useTextSelection's blur handler doesn't
        // race in and snap the caret back to lastSelectionRef before our
        // pointerup runs selectRelativeSpan (via the synthetic arrow keydown).
        e.preventDefault();
        const stoppedFling = stopFling();
        gestureRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            startTime: performance.now(),
            longPressTimer: null,
            sentenceTimer: null,
            sentenceSelected: false,
            jumping: false,
            scrolling: false,
            lastY: e.clientY,
            samples: [{ t: performance.now(), y: e.clientY }],
            stoppedFling,
            jumpedKey: null,
        };
        const startX = e.clientX;
        const startY = e.clientY;
        gestureRef.current.longPressTimer = window.setTimeout(() => {
            engageWordJump(startX, startY, true);
        }, LONG_PRESS_MS);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        const g = gestureRef.current;
        if (!g) return;
        if (g.sentenceSelected) return;
        if (g.jumping) {
            // A finger that wanders off the pressed spot is choosing a word, not holding for
            // the sentence: disarm SENTENCE PRESS.
            if (g.sentenceTimer !== null && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > MOVE_THRESHOLD_PX) {
                clearSentenceTimer();
            }
            // WORD JUMP follows the finger, the way a native selection handle would.
            // Gaps crossed on the way keep the last word (only the initial press clears).
            selectWordAt(e.clientX, e.clientY);
            return;
        }

        // Once in scroll mode, keep proxying the drag to the scroll target's scrollTop.
        if (g.scrolling) {
            dragScroll(e.clientY);
            return;
        }

        const dx = e.clientX - g.startX;
        const dy = e.clientY - g.startY;
        if (Math.hypot(dx, dy) > MOVE_THRESHOLD_PX) {
            clearLongPressTimer();
            // A vertical-dominant drag is a scroll: proxy it to the scroll target.
            // A horizontal-dominant drag jumps to the word under the finger.
            if (Math.abs(dy) > Math.abs(dx)) {
                g.scrolling = true;
                dragScroll(e.clientY);
            } else {
                engageWordJump(e.clientX, e.clientY);
            }
        }
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        const g = gestureRef.current;
        if (!g) return;
        clearLongPressTimer();
        clearSentenceTimer();
        gestureRef.current = null;

        // A scroll drag coasts on (MOMENTUM); a jump or a fling-stopping touch has no
        // tap follow-up.
        if (g.scrolling) {
            startFling(g.samples);
            return;
        }
        if (g.jumping || g.stoppedFling) return;

        const elapsed = performance.now() - g.startTime;
        const moved = Math.hypot(e.clientX - g.startX, e.clientY - g.startY);

        if (elapsed >= LONG_PRESS_MS || moved >= MOVE_THRESHOLD_PX) return;

        const textarea = inputRef.current;
        if (!textarea) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const relativeX = e.clientX - rect.left;
        const zone = relativeX / rect.width;

        e.preventDefault();
        e.stopPropagation();

        // TIEBREAK ALTERNATIVE (Pinyin mode): a tap anywhere inside a yellow box (glyph,
        // pinyin band, or the cell it shares with the selected word) switches the selection
        // to that word — the ONE tap that overrides the left/right zone step. Clicking the
        // cell runs ReaderCpcdView's click-capture, the same path a desktop click takes.
        // Exact box bounds only, so a forward tap beside the selection is not swallowed.
        const box = wordSource === "pinyin" ? scrollRef?.current : null;
        const alternativeCell = box ? findAlternativeCellAt(box, e.clientX, e.clientY) : null;
        if (alternativeCell) {
            alternativeCell.click();
            return;
        }

        // Reuse the existing keyboard navigation: dispatch the same Arrow
        // keydown the textarea's onKeyDown handler already processes. That
        // handler correctly distinguishes collapsed-caret vs selected-word
        // cases and respects the autoSelectEnabled setting. The trailing
        // keyup is what makes React's onSelect polyfill notice the selection
        // change and re-run the auto-highlight expansion.
        const key = zone < TAP_LEFT_ZONE_FRACTION ? "ArrowLeft" : "ArrowRight";
        textarea.dispatchEvent(new KeyboardEvent("keydown", {
            key,
            bubbles: true,
            cancelable: true,
        }));
        textarea.dispatchEvent(new KeyboardEvent("keyup", {
            key,
            bubbles: true,
            cancelable: true,
        }));
    };

    const handlePointerCancel = () => {
        clearLongPressTimer();
        clearSentenceTimer();
        gestureRef.current = null;
    };

    return (
        <Box
            ref={overlayRef}
            className="reader-page-tap-overlay"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            // A touch long-press also makes the browser fire `contextmenu` (a "right
            // click": Chrome's link/image menu, or devtools' touch emulation opening the
            // page menu). The overlay owns the long-press (WORD JUMP), so
            // the browser's own menu is suppressed here.
            onContextMenu={(event) => event.preventDefault()}
            sx={{
                position: "absolute",
                inset: 0,
                zIndex: 2,
                backgroundColor: "transparent",
                // Explicit: the page's TAP REGION frame around it is pointer-inert.
                pointerEvents: "auto",
                // The overlay proxies scrolling itself (see handlePointerMove, and
                // MOMENTUM for the fling after release), so suppress the browser's own touch gestures to receive the
                // full pointer stream — otherwise a vertical pan is swallowed
                // with nothing in the overlay's scroll chain to move.
                touchAction: "none",
            }}
        >
            {/* ZONE FLASH, over the overlay's whole area (the screen below the display
                strip). `key` restarts the animation on every request. Inert to pointers so
                it never intercepts a gesture. */}
            {flash && (
                <Box
                    className="reader-page-tap-overlay__flash-frame"
                    aria-hidden
                    sx={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}
                >
                    <Box
                        key={flash.id}
                        className={`reader-page-tap-overlay__flash reader-page-tap-overlay__flash--${flash.side}`}
                        sx={{
                            position: "absolute",
                            top: 0,
                            bottom: 0,
                            left: flash.side === "left" ? 0 : `${TAP_LEFT_ZONE_FRACTION * 100}%`,
                            right: flash.side === "left" ? `${(1 - TAP_LEFT_ZONE_FRACTION) * 100}%` : 0,
                            backgroundColor: night ? FLASH_NIGHT_FILL : COLORS.grey,
                            mixBlendMode: night ? "normal" : "multiply",
                            opacity: 0,
                            animation: `${zoneFlashPulse} ${FLASH_MS}ms ease-in-out`,
                        }}
                        onAnimationEnd={onFlashEnd}
                    />
                </Box>
            )}
        </Box>
    );
}

export default ReaderTapOverlay;
