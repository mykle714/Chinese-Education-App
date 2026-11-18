import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Box, Typography, useMediaQuery } from "@mui/material";
import Icon from "../../components/Icon";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE } from "../../theme/scale";
import { TAP_LEFT_ZONE_FRACTION, type TapZoneSide } from "./ReaderTapOverlay";

/**
 * ReaderTapHint — the dictionary keycap's NOTHING-SELECTED face (VocabDisplayCard →
 * `idleHint`), filling the whole keycap face: the face becomes the reading box in
 * miniature, split by a dotted line where ReaderTapOverlay divides back-taps from
 * forward-taps (`TAP_LEFT_ZONE_FRACTION`, the left third). Two sentences sit in the
 * right zone only: the tap hint along its top, the tap-and-hold hint along its bottom.
 *
 * DEMO LOOP: a `touch_app` finger starts at its right-zone tap position, then plays DEMO_CYCLES rounds of
 * "glide to the left zone → tap → glide to the right zone → tap" and
 * comes back to rest there (`home`), on the row midway between the two sentences. A zone fills `COLORS.grey` (hover)
 * the moment the finger's centre crosses into it — tracked per animation frame from the
 * finger's real position (FINGER TRACKING), not when the glide ends — and `COLORS.greyA`
 * for the tap (the finger shrinks with it), back to the hover grey on release. Under `prefers-reduced-motion`,
 * or with `playDemo` false (the hint shown again after a long-press on empty space), the
 * loop never starts and the diagram stays in its resting state.
 *
 * TAP-TO-LOCATE: tapping the face itself reports which side was hit (`onZoneTap`), and
 * the page flashes that REAL zone over the reading box (ReaderTapOverlay → `flash`).
 *
 * The page stops rendering this as soon as the learner's first word is selected, so the
 * loop's timers are cleaned up on unmount.
 *
 * Layer: feature component (src/features/reader). Depended on by ReaderDocumentPage.
 * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § Look (Nothing-selected mode).
 */

// What the hint sentence says (formerly the `reader-tap-hint` notification's copy).
export const READER_NAVIGATION_HINT = "Tap the left or right side of the screen to move the cursor.";
// The second line, along the bottom of the right zone: the long-press jump
// (ReaderTapOverlay → engagePassthrough hands a long-press to native selection).
export const READER_JUMP_HINT = "Tap and hold on a word to jump to it.";

const DEMO_CYCLES = 2;
// Until the two sentences are measured (first layout only), the finger's vertical centre.
const FINGER_TOP_FALLBACK = "50%";
// The sentences' inset from the face's top / bottom edge, px.
const TEXT_EDGE_PX = 14;
// The sentence's side inset inside the right zone, px.
const TEXT_INSET_PX = 12;
// How far the dotted divide stops short of the face's top and bottom edges, px.
const DIVIDE_INSET_PX = 10;
const ICON_SIZE_PX = 28;
// How long the finger takes to glide between positions; the fills fade faster so the
// zone reads as reacting to the finger rather than travelling with it.
const GLIDE_MS = 550;
const FILL_FADE_MS = 160;
const GLIDE_EASING = "cubic-bezier(0.45, 0, 0.25, 1)";

// `home` is the finger's resting place, before and after the demo: exactly where it taps
// the right zone (owner's call 2026-11-17) — same x, same row — but it is not a zone beat,
// so the zone never fills while it rests there.
type FingerSpot = "home" | "left" | "right";
type ZoneState = "idle" | "hover" | "pressed";
interface DemoFrame {
    spot: FingerSpot;
    zone: ZoneState;
    // How long this frame holds before the next one, ms.
    holdMs: number;
}

// The finger's x position on the face, % of its width: each zone's centre (home = the
// right zone's, where the sentence is centred).
const RIGHT_ZONE_CENTRE_PERCENT = (TAP_LEFT_ZONE_FRACTION + (1 - TAP_LEFT_ZONE_FRACTION) / 2) * 100;
const SPOT_X_PERCENT: Record<FingerSpot, number> = {
    home: RIGHT_ZONE_CENTRE_PERCENT,
    left: (TAP_LEFT_ZONE_FRACTION / 2) * 100,
    right: RIGHT_ZONE_CENTRE_PERCENT,
};

const REST_FRAME: DemoFrame = { spot: "home", zone: "idle", holdMs: 0 };

/** One side's beat: glide over (hovering from the moment it crosses in), dwell, tap,
 *  release back to hover. */
function sideBeat(spot: TapZoneSide): DemoFrame[] {
    return [
        { spot, zone: "hover", holdMs: GLIDE_MS },
        { spot, zone: "hover", holdMs: 350 },
        { spot, zone: "pressed", holdMs: 200 },
        { spot, zone: "hover", holdMs: 450 },
    ];
}

// The whole demo: a beat before it starts (so the face has settled), DEMO_CYCLES
// left/right rounds, then back home above the sentence.
const DEMO_FRAMES: DemoFrame[] = [
    { ...REST_FRAME, holdMs: 700 },
    ...Array.from({ length: DEMO_CYCLES }, () => [...sideBeat("left"), ...sideBeat("right")]).flat(),
    REST_FRAME,
];

const ZONE_FILL: Record<ZoneState, string> = {
    idle: "transparent",
    hover: COLORS.grey,
    pressed: COLORS.greyA,
};

interface ReaderTapHintProps {
    text?: string;
    holdText?: string;
    // Tapping the face → which side of the divide was hit (TAP-TO-LOCATE).
    onZoneTap?: (side: TapZoneSide) => void;
    // False → skip the DEMO LOOP and show the resting diagram (the page passes false once
    // the demo has played: the hint returning after a long-press on empty space).
    playDemo?: boolean;
}

export default function ReaderTapHint({ text = READER_NAVIGATION_HINT, holdText = READER_JUMP_HINT, onZoneTap, playDemo = true }: ReaderTapHintProps) {
    const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
    const lastIndex = DEMO_FRAMES.length - 1;
    // Index into DEMO_FRAMES; each frame schedules the next until the last (rest) frame.
    // Without the demo it starts (and stays) on that rest frame.
    const [frameIndex, setFrameIndex] = useState(() => (playDemo ? 0 : lastIndex));

    useEffect(() => {
        if (reducedMotion || frameIndex >= lastIndex) return;
        const timer = window.setTimeout(() => setFrameIndex((i) => i + 1), DEMO_FRAMES[frameIndex].holdMs);
        return () => window.clearTimeout(timer);
    }, [frameIndex, lastIndex, reducedMotion]);

    // FINGER ROW: both sentences wrap to however many lines the right zone's width
    // allows, so their edges are measured (ResizeObserver: the card's width, font load).
    // The finger's one row (demo and home alike) is the middle of the band between them.
    // Null until the first layout (FINGER_TOP_FALLBACK).
    const topTextRef = useRef<HTMLParagraphElement>(null);
    const bottomTextRef = useRef<HTMLParagraphElement>(null);
    const [demoRowPx, setDemoRowPx] = useState<number | null>(null);
    useLayoutEffect(() => {
        const top = topTextRef.current;
        const bottom = bottomTextRef.current;
        if (!top || !bottom) return;
        const measure = () => {
            setDemoRowPx((top.offsetTop + top.offsetHeight + bottom.offsetTop) / 2);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(top);
        observer.observe(bottom);
        return () => observer.disconnect();
    }, []);

    // FINGER TRACKING: which side of the divide the finger's centre is over right now,
    // read from its real (mid-transition) position every animation frame while the demo
    // runs, so a zone lights the instant the finger crosses into it. React bails out of
    // the setState when the side has not changed, so this re-renders only on a crossing.
    const rootRef = useRef<HTMLDivElement>(null);
    const fingerRef = useRef<HTMLDivElement>(null);
    const [fingerSide, setFingerSide] = useState<TapZoneSide>("right");
    const animating = !reducedMotion && frameIndex < lastIndex;
    useEffect(() => {
        if (!animating) return;
        let raf = 0;
        const track = () => {
            const root = rootRef.current?.getBoundingClientRect();
            const finger = fingerRef.current?.getBoundingClientRect();
            if (root && finger && root.width > 0) {
                const centreX = finger.left + finger.width / 2 - root.left;
                setFingerSide(centreX < root.width * TAP_LEFT_ZONE_FRACTION ? "left" : "right");
            }
            raf = requestAnimationFrame(track);
        };
        raf = requestAnimationFrame(track);
        return () => cancelAnimationFrame(raf);
    }, [animating]);

    const frame = reducedMotion ? REST_FRAME : DEMO_FRAMES[frameIndex];
    // The previous frame's spot: during a glide the zone being LEFT keeps its grey until
    // the finger crosses out of it. Leaving home lights nothing — home is not a zone beat.
    const prevSpot: FingerSpot = !reducedMotion && frameIndex > 0 ? DEMO_FRAMES[frameIndex - 1].spot : "home";
    // The finger's vertical centre (`translate(-50%)` centres the icon on this point).
    const fingerTop = demoRowPx === null ? FINGER_TOP_FALLBACK : `${demoRowPx}px`;
    // A zone fills while the finger is over it AND it is this beat's zone or the one the
    // finger is gliding out of. At home nothing fills.
    const fillFor = (side: TapZoneSide) =>
        frame.spot !== "home" && fingerSide === side && (frame.spot === side || prevSpot === side)
            ? ZONE_FILL[frame.zone]
            : "transparent";
    // TAP-TO-LOCATE: which side of the face's divide a tap landed on.
    const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
        if (!onZoneTap) return;
        const rect = event.currentTarget.getBoundingClientRect();
        onZoneTap(event.clientX - rect.left < rect.width * TAP_LEFT_ZONE_FRACTION ? "left" : "right");
    };
    const zoneSx = { height: "100%", transition: `background-color ${FILL_FADE_MS}ms ease-out` };
    const textSx = {
        position: "absolute",
        left: `calc(${TAP_LEFT_ZONE_FRACTION * 100}% + ${TEXT_INSET_PX}px)`,
        right: TEXT_INSET_PX,
        fontFamily: FONTS.sans,
        fontSize: SIZE.body,
        color: COLORS.iconColor,
        textAlign: "center",
        pointerEvents: "none",
    } as const;

    return (
        // Fills its parent edge to edge — VocabDisplayCard's full-face idle layer — so the
        // keycap itself is the reading box in miniature.
        <Box
            ref={rootRef}
            className="reader-tap-hint"
            onClick={handleClick}
            sx={{ position: "absolute", inset: 0, cursor: onZoneTap ? "pointer" : undefined }}
        >
            {/* The two zones, split at the real tap divide. Purely illustrative — the
                sentences carry the meaning for screen readers. */}
            <Box className="reader-tap-hint__zones" aria-hidden sx={{ position: "absolute", inset: 0, display: "flex" }}>
                <Box
                    className="reader-tap-hint__zone reader-tap-hint__zone--back"
                    sx={{ ...zoneSx, flex: `0 0 ${TAP_LEFT_ZONE_FRACTION * 100}%`, backgroundColor: fillFor("left") }}
                />
                <Box
                    className="reader-tap-hint__zone reader-tap-hint__zone--forward"
                    sx={{ ...zoneSx, flex: "1 1 auto", backgroundColor: fillFor("right") }}
                />
            </Box>
            {/* The dotted divide, full height bar a small inset, over the zones so a
                filled zone never hides it. */}
            <Box
                className="reader-tap-hint__divide"
                aria-hidden
                sx={{
                    position: "absolute",
                    top: DIVIDE_INSET_PX,
                    bottom: DIVIDE_INSET_PX,
                    left: `${TAP_LEFT_ZONE_FRACTION * 100}%`,
                    borderLeft: `2px dotted ${COLORS.greyA}`,
                    transform: "translateX(-1px)",
                }}
            />
            {/* The finger. `left` glides between spots; the scale is the tap. */}
            <Box
                ref={fingerRef}
                className="reader-tap-hint__finger"
                aria-hidden
                sx={{
                    position: "absolute",
                    top: fingerTop,
                    left: `${SPOT_X_PERCENT[frame.spot]}%`,
                    display: "flex",
                    transform: `translate(-50%, -50%) scale(${frame.zone === "pressed" ? 0.82 : 1})`,
                    transition: `left ${GLIDE_MS}ms ${GLIDE_EASING}, transform 120ms ease-out`,
                }}
            >
                <Icon className="reader-tap-hint__finger-icon" name="touch_app" size={ICON_SIZE_PX} color={COLORS.iconColor} />
            </Box>
            {/* The two sentences sit in the RIGHT (forward) zone only, so no dotted line
                runs through them (owner's calls 2026-11-17): the tap hint on top, the
                tap-and-hold hint at the bottom. `iconColor` (--ink2), not `textSecondary`:
                they must stay readable over the tap's `greyA` fill. */}
            <Typography ref={topTextRef} className="reader-tap-hint__text reader-tap-hint__text--tap" sx={{ ...textSx, top: TEXT_EDGE_PX }}>
                {text}
            </Typography>
            <Typography ref={bottomTextRef} className="reader-tap-hint__text reader-tap-hint__text--hold" sx={{ ...textSx, bottom: TEXT_EDGE_PX }}>
                {holdText}
            </Typography>
        </Box>
    );
}
