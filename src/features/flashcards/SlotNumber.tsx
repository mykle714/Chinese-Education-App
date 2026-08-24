import { useEffect, useState } from "react";
import { Box } from "@mui/material";

/**
 * `SlotNumber` — a figure that spins as a blurred slot-machine reel until it is known,
 * then lands on the answer.
 *
 * ── Why a reel and not a placeholder glyph ────────────────────────────────────
 * The three cards of `StudyHand` exist to show three sizes. A figure still in flight used
 * to print an em dash, and three dashes side by side read as *this page has nothing* —
 * the opposite of what the hand is for. A spinning reel says the same thing (no number
 * yet) while reading as a number about to arrive, and the landing gives the arrival a
 * moment of its own rather than swapping a character in silence.
 *
 * ── How the motion works: two animations, no JS per frame ─────────────────────
 * Each digit column is a strip of 0–9 REPEATED TWICE, inside a one-digit window. Two CSS
 * animations run on that strip and the browser owns every frame:
 *
 *   `slotSpin`  — `translateY(0 → -50%)`, linear, infinite. -50% of a doubled strip is
 *                 exactly one revolution, so the loop is seamless. A negative per-reel
 *                 delay desyncs the columns; without it three reels tick as one block.
 *   `slotLand`  — `translateY(0 → var(--slot-land))` on a decelerating curve, where the
 *                 variable is one full extra revolution PLUS the target digit. It is
 *                 listed second and carries a per-reel delay, so during that delay only
 *                 `slotSpin` is active (the reel keeps spinning) and the moment it starts
 *                 it wins the cascade. `forwards` holds the landed digit afterwards.
 *
 * The jump from wherever the spin happened to be to `slotLand`'s `translateY(0)` start is
 * a real discontinuity, and it is invisible: at spin speed under `SPIN_BLUR_PX` of blur
 * there is no legible digit to see jump. That discontinuity is what buys the whole effect
 * without a rAF loop — position never has to be read back out of the compositor.
 *
 * ── It never shows a number it does not have ──────────────────────────────────
 * The reels are decoration; the value is only ever rendered once `value` is defined. The
 * landing is triggered BY the arrival, so it cannot delay the truth — the settled figure
 * is on screen at the end of one short animation, not after a fabricated wind-down.
 *
 * Reduced motion skips the reels entirely: nothing shows until the value arrives. That is
 * the same contract the corner tags keep, and it is honest — blank means "not yet".
 *
 * Layer: presentational component (src/features/flashcards). Referenced by
 * docs/DECKS_FEATURE.md § "The card hand".
 */

/** 0–9 twice, so a one-revolution translate lands back where it started. */
const STRIP = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/** Reels shown while the value is unknown. Fixed, so the spin does not jitter the layout. */
const SPINNING_REELS = 2;

/** One full 0–9 revolution. Fast enough that no digit is individually legible. */
const SPIN_MS = 260;
/** Per-reel spin desync, applied as a NEGATIVE delay so no reel waits to start. */
const SPIN_DESYNC_MS = 70;
/** A single reel's decelerating landing. */
const LAND_MS = 560;
/** Left-to-right landing stagger — reels stopping in order is what reads as a slot machine. */
const LAND_STAGGER_MS = 90;
/** Motion blur on the moving strip. Isotropic (`blur()`), which at this radius reads fine. */
const SPIN_BLUR_PX = 2.6;

/**
 * Line box of one digit, in `em`, and therefore the height of the reel window.
 *
 * EXPORTED because the host must set the SAME `line-height` on the text around it: the
 * reels are swapped for a plain settled numeral at the end, and a different line box would
 * change the figure's height at that swap.
 */
export const SLOT_LINE_HEIGHT = 0.85;

export interface SlotNumberProps {
    /** The figure. `undefined` means "not known yet" and is what starts the reels. */
    value: number | undefined;
    className?: string;
}

/**
 * Whether this visitor has asked for less motion. Read once per mount rather than
 * subscribed to: the reels only live for the length of one fetch, so a preference changed
 * mid-spin is not worth a listener.
 *
 * This is the app's FIRST reduced-motion guard, and the exception is narrow on purpose: a
 * numeral strobing where the answer is about to appear is a different class of thing from
 * the slides and pulses elsewhere, because it is the one animation a reader cannot look
 * away from while waiting for it.
 */
function usePrefersReducedMotion(): boolean {
    const [reduced] = useState(
        () => typeof window !== "undefined"
            && typeof window.matchMedia === "function"
            && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
    return reduced;
}

export const SlotNumber: React.FC<SlotNumberProps> = ({ value, className }) => {
    const reducedMotion = usePrefersReducedMotion();

    // `landed` gates the swap from reels to plain text. It starts true when the value was
    // already known at mount, so a re-render (a promotion, a resize) never re-spins a
    // figure the learner has already read.
    const [landed, setLanded] = useState(value !== undefined);

    // The settled string, grouped: "1,204". Digits become reels; anything else (a comma)
    // rides along as a static character so no separator pops in at the swap.
    const target = value === undefined ? "" : value.toLocaleString();

    useEffect(() => {
        if (value === undefined) {
            setLanded(false);
            return;
        }
        if (reducedMotion) {
            setLanded(true);
            return;
        }
        // Wait out the last reel: its delay plus its own duration. Timing the swap rather
        // than listening for `animationend` keeps it to one timer regardless of reel count,
        // and a few ms of overlap is invisible because the reel is already holding the
        // landed digit by then (`forwards`).
        const reels = target.replace(/\D/g, "").length;
        const id = window.setTimeout(
            () => setLanded(true),
            LAND_MS + LAND_STAGGER_MS * Math.max(0, reels - 1)
        );
        return () => window.clearTimeout(id);
    }, [value, reducedMotion, target]);

    // Settled: plain text, so the figure is real text for selection, screen readers and
    // `tabular-nums` — and so nothing is animating on a page at rest.
    if (landed) {
        return (
            <Box component="span" className={className ? `slot-number ${className}` : "slot-number"}>
                {target}
            </Box>
        );
    }

    // Reduced motion, or waiting with the reels suppressed: hold the line box open with a
    // non-breaking space so the hairline beneath the figure does not creep upward, and show
    // nothing. Blank means "not yet", the same as the corner tags.
    if (reducedMotion) {
        return (
            <Box component="span" className="slot-number slot-number--blank">{"\u00A0"}</Box>
        );
    }

    const landing = value !== undefined;
    // While the value is unknown the reels are pure decoration, so their count is fixed;
    // once it arrives each digit of the answer gets its own reel.
    const cells = landing ? target.split("") : Array.from({ length: SPINNING_REELS }, () => "0");

    return (
        <Box
            component="span"
            className={className ? `slot-number slot-number--spinning ${className}` : "slot-number slot-number--spinning"}
            // The reels spell nothing true yet, so they are hidden from assistive tech
            // outright rather than announced as a number.
            aria-hidden
            sx={{
                display: "inline-flex",
                // Keyframes are document-global once emitted, so both live here on the
                // wrapper rather than being re-declared on every reel.
                "@keyframes slotSpin": {
                    from: { transform: "translateY(0)" },
                    // Half of a doubled 0–9 strip — exactly one revolution.
                    to: { transform: "translateY(-50%)" },
                },
                "@keyframes slotLand": {
                    from: { transform: "translateY(0)", filter: `blur(${SPIN_BLUR_PX}px)` },
                    to: { transform: "var(--slot-land)", filter: "blur(0px)" },
                },
            }}
        >
            {cells.map((char, index) => {
                const digit = Number(char);
                if (!/\d/.test(char)) {
                    // A grouping separator: static, and already in place so the settled
                    // string does not reflow when the reels are swapped out.
                    return (
                        <Box component="span" key={`sep-${index}`} className="slot-number__separator">
                            {char}
                        </Box>
                    );
                }
                // One extra revolution (10 cells) past the top, then the digit itself.
                const landOffset = ((10 + digit) / STRIP.length) * 100;
                return (
                    <Box
                        component="span"
                        key={`reel-${index}`}
                        className="slot-number__reel"
                        sx={{
                            display: "inline-block",
                            height: `${SLOT_LINE_HEIGHT}em`,
                            overflow: "hidden",
                            verticalAlign: "top",
                        }}
                    >
                        <Box
                            className="slot-number__strip"
                            sx={{
                                display: "flex",
                                flexDirection: "column",
                                filter: `blur(${SPIN_BLUR_PX}px)`,
                                // Read by `slotLand`'s `to` frame. Per reel, so one shared
                                // keyframe serves every digit.
                                "--slot-land": `translateY(-${landOffset}%)`,
                                animation: landing
                                    ? `slotSpin ${SPIN_MS}ms linear ${-index * SPIN_DESYNC_MS}ms infinite, `
                                        + `slotLand ${LAND_MS}ms cubic-bezier(0.13, 0.72, 0.19, 1) `
                                        + `${index * LAND_STAGGER_MS}ms forwards`
                                    : `slotSpin ${SPIN_MS}ms linear ${-index * SPIN_DESYNC_MS}ms infinite`,
                            }}
                        >
                            {STRIP.map((n, cell) => (
                                <Box
                                    component="span"
                                    key={cell}
                                    sx={{ height: `${SLOT_LINE_HEIGHT}em`, lineHeight: SLOT_LINE_HEIGHT }}
                                >
                                    {n}
                                </Box>
                            ))}
                        </Box>
                    </Box>
                );
            })}
        </Box>
    );
};

export default SlotNumber;
