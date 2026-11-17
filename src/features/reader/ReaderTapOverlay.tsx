import { useRef } from "react";
import { Box, useMediaQuery, useTheme } from "@mui/material";
import { keyframes } from "@mui/material/styles";
import { COLORS } from "../../theme/colors";

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
    // Whether a long-press / horizontal drag may hand off to the textarea's NATIVE text
    // selection (the passthrough below). True in the text mode; false in the Pinyin mode,
    // where the textarea is invisible and a native selection would be an unseen one.
    // Instead the Pinyin mode does its own "tap and hold to jump": the word drawn under
    // the finger (a `[data-span-index]` cpcd word inside `scrollRef` — ReaderCpcdView →
    // ReaderCpcdWord) is clicked, which selects it through the view's own click path,
    // and it keeps following the finger until release (WORD JUMP below). Default true.
    nativeSelection?: boolean;
    // ZONE FLASH: set → flash that zone grey a couple of times over the reading box. Fired
    // when the learner taps the keycap's tap demo (ReaderTapHint → `onZoneTap`), to show
    // where the real zone is.
    flash?: TapZoneFlash | null;
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

// ZONE FLASH: two grey pulses. `COLORS.grey` drawn with `multiply`, so the text under it
// stays fully dark — the zone greys, the words do not wash out.
const FLASH_MS = 900;
const zoneFlashPulse = keyframes`
    0%   { opacity: 0; }
    15%  { opacity: 1; }
    40%  { opacity: 0; }
    60%  { opacity: 1; }
    100% { opacity: 0; }
`;

const LONG_PRESS_MS = 500;
const MOVE_THRESHOLD_PX = 10;

function ReaderTapOverlay({ inputRef, scrollRef, nativeSelection = true, flash, onFlashEnd }: ReaderTapOverlayProps) {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down("md"));

    // Per-gesture state lives in refs so we don't re-render mid-touch.
    const gestureRef = useRef<{
        startX: number;
        startY: number;
        startTime: number;
        longPressTimer: number | null;
        passthrough: boolean;
        // Set once a drag is recognised as a vertical scroll. The overlay then
        // proxies the gesture: it scrolls the textarea beneath it by hand
        // (the textarea is a sibling, not an ancestor, so the browser would
        // otherwise have nothing in the overlay's scroll chain to scroll).
        scrolling: boolean;
        lastY: number;
        // WORD JUMP: the cpcd word last selected by this gesture's long-press.
        jumpedWord: HTMLElement | null;
    } | null>(null);
    const overlayRef = useRef<HTMLDivElement | null>(null);

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

    // WORD JUMP (Pinyin mode's long-press): click the cpcd word drawn under the point.
    // The overlay sits on top, so look through it with `elementsFromPoint` and take the
    // first word inside the cpcd scroll box. Points over a gap / punctuation mark /
    // blank line select nothing, leaving the current word as it was. The click runs
    // ReaderCpcdWord's `onClick` → `selectRange`, the same path a desktop click takes.
    const selectWordAt = (clientX: number, clientY: number) => {
        const box = scrollRef?.current;
        if (!box) return;
        for (const el of document.elementsFromPoint(clientX, clientY)) {
            const word = el.closest<HTMLElement>("[data-span-index]");
            if (word && box.contains(word)) {
                // Skip the click when the finger is still on the same word, so a held
                // finger does not re-run the selection (and its lookup) on every move.
                const g = gestureRef.current;
                if (g && g.jumpedWord === word) return;
                if (g) g.jumpedWord = word;
                word.click();
                return;
            }
        }
    };

    // Engage native textarea selection: hide the overlay from pointer events and
    // synthesize a pointerdown on whatever sits beneath the finger so iOS/Android
    // start their native selection gesture without the user lifting.
    const engagePassthrough = (clientX: number, clientY: number) => {
        const g = gestureRef.current;
        if (!g || g.passthrough) return;
        g.passthrough = true;
        // No native selection to hand off to (Pinyin mode): jump to the word under the
        // finger instead. `passthrough` stays set, so pointerup takes no tap step; the
        // move handler keeps re-selecting under the finger (WORD JUMP).
        if (!nativeSelection) {
            selectWordAt(clientX, clientY);
            return;
        }

        const overlay = overlayRef.current;
        if (overlay) overlay.style.pointerEvents = "none";

        const target = document.elementFromPoint(clientX, clientY);
        if (target) {
            const synth = new PointerEvent("pointerdown", {
                bubbles: true,
                cancelable: true,
                clientX,
                clientY,
                pointerType: "touch",
                isPrimary: true,
            });
            target.dispatchEvent(synth);
        }

        // Restore pointer-events on the next pointerup anywhere in the window.
        const restore = () => {
            if (overlay) overlay.style.pointerEvents = "auto";
            window.removeEventListener("pointerup", restore);
            window.removeEventListener("pointercancel", restore);
        };
        window.addEventListener("pointerup", restore);
        window.addEventListener("pointercancel", restore);
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        // Keep the textarea focused so useTextSelection's blur handler doesn't
        // race in and snap the caret back to lastSelectionRef before our
        // pointerup runs selectRelativeSpan (via the synthetic arrow keydown).
        e.preventDefault();
        gestureRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            startTime: performance.now(),
            longPressTimer: null,
            passthrough: false,
            scrolling: false,
            lastY: e.clientY,
            jumpedWord: null,
        };
        const startX = e.clientX;
        const startY = e.clientY;
        gestureRef.current.longPressTimer = window.setTimeout(() => {
            engagePassthrough(startX, startY);
        }, LONG_PRESS_MS);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        const g = gestureRef.current;
        if (!g) return;
        if (g.passthrough) {
            // WORD JUMP: an engaged long-press in the Pinyin mode follows the finger,
            // the way a native selection handle does in the text mode.
            if (!nativeSelection) selectWordAt(e.clientX, e.clientY);
            return;
        }

        // Once in scroll mode, keep proxying the drag to the scroll target's scrollTop.
        if (g.scrolling) {
            const scroller = scrollTarget();
            if (scroller) scroller.scrollTop -= e.clientY - g.lastY;
            g.lastY = e.clientY;
            return;
        }

        const dx = e.clientX - g.startX;
        const dy = e.clientY - g.startY;
        if (Math.hypot(dx, dy) > MOVE_THRESHOLD_PX) {
            clearLongPressTimer();
            // A vertical-dominant drag is a scroll: proxy it to the textarea.
            // A horizontal-dominant drag hands off to native text selection.
            if (Math.abs(dy) > Math.abs(dx)) {
                g.scrolling = true;
                const scroller = scrollTarget();
                if (scroller) scroller.scrollTop -= e.clientY - g.lastY;
                g.lastY = e.clientY;
            } else {
                engagePassthrough(e.clientX, e.clientY);
            }
        }
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        const g = gestureRef.current;
        if (!g) return;
        clearLongPressTimer();

        // A scroll drag has no tap/selection follow-up — just end the gesture.
        if (g.passthrough || g.scrolling) {
            gestureRef.current = null;
            return;
        }

        const elapsed = performance.now() - g.startTime;
        const moved = Math.hypot(e.clientX - g.startX, e.clientY - g.startY);
        gestureRef.current = null;

        if (elapsed >= LONG_PRESS_MS || moved >= MOVE_THRESHOLD_PX) return;

        const textarea = inputRef.current;
        if (!textarea) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const relativeX = e.clientX - rect.left;
        const zone = relativeX / rect.width;

        e.preventDefault();
        e.stopPropagation();

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
            // page menu). The overlay owns the long-press (passthrough / WORD JUMP), so
            // the browser's own menu is suppressed here.
            onContextMenu={(event) => event.preventDefault()}
            sx={{
                position: "absolute",
                inset: 0,
                zIndex: 2,
                backgroundColor: "transparent",
                // Explicit: the page's TAP REGION frame around it is pointer-inert.
                pointerEvents: "auto",
                // The overlay proxies scrolling itself (see handlePointerMove),
                // so suppress the browser's own touch gestures to receive the
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
                            backgroundColor: COLORS.grey,
                            mixBlendMode: "multiply",
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
