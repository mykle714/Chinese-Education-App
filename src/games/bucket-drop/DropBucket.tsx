import React, { useLayoutEffect, useRef } from "react";
import { Box, Typography } from "@mui/material";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { WEIGHT, LEADING } from "../../theme/scale";
import { SHADOW } from "../../theme/shadows";
import { WRONG_SHAKE_KEYFRAMES } from "../bubbles/constants";
import {
    BUCKET_ENTER_MS,
    BUCKET_EXIT_MS,
    BUCKET_FILL,
    BUCKET_RADIUS,
    BUCKET_WRONG_RING,
    GLOSS_MAX_FONT_PX,
    GLOSS_MIN_FONT_PX,
    GLOSS_FONT_STEP_PX,
    WRONG_SHAKE_MS,
} from "./constants";
import type { PerimeterSlot } from "./perimeterLayout";

/**
 * One perimeter bucket — a grey keycap-shaped HOLE holding one English dd
 * (docs/BUCKET_DROP_GAME.md § 4).
 *
 * The hole is the sort flow's bucket (SortCardsPage → `Bucket`), the app's one bucket
 * style: pressed INTO the panel with `SHADOW.recessedDeep`, edged with the standard
 * `1px COLORS.border` hairline. Two departures, both asked for: the fill is the
 * palette's inert grey rather than a collection hue, and the corner is a keycap's
 * (BUCKET_RADIUS) rather than a card's 12px.
 *
 * Presentation only. The stage owns hit-testing (against the slot GEOMETRY, not this
 * element's DOM rect). The one thing measured here is the gloss's own text, to fit it
 * (`FittedGloss`).
 *
 * States:
 *   hovered — the held word is over this bucket: the shared `COLORS.scrim` wash, the
 *             same "over a drop target" cue Bubble Match draws on a hovered bubble.
 *   wrong   — the outline goes red and the hole shakes (`bubbleShake`, shared with
 *             Bubble Match). `shakeKey` changes per wrong drop so a second wrong drop
 *             on the same bucket restarts the animation.
 *   leaving — the word fell in: the hole fades out (rendered by the stage as a ghost
 *             over the slot while the replacement fades in beneath it).
 *
 * A bucket mounting with a new word fades in after BUCKET_EXIT_MS, so the old hole has
 * gone before the new one appears.
 */
interface DropBucketProps {
    slot: PerimeterSlot;
    /** The English dd, already resolved through `resolveDisplayDefinition`. */
    text: string;
    hovered?: boolean;
    wrong?: boolean;
    /** Changes per wrong drop — restarts the shake. */
    shakeKey?: number;
    leaving?: boolean;
    /** Fade in on mount (a refill); off for the dealt board, which appears all at once. */
    enter?: boolean;
}

/**
 * The bucket's English gloss, FITTED to the hole: the largest font size at which the text
 * neither cuts a word off nor runs out of the bucket.
 *
 * Lines break ONLY AT SPACES (`word-break: normal`, `overflow-wrap: normal`) — a word is
 * never split. After layout, while any word is wider than the box (scrollWidth) or the
 * lines are taller than it (scrollHeight), the size steps down by GLOSS_FONT_STEP_PX from
 * GLOSS_MAX_FONT_PX, to GLOSS_MIN_FONT_PX. If a single word STILL does not fit at the
 * minimum (an unusually long compound), it is allowed to break mid-word as a last resort,
 * rather than be clipped.
 *
 * Written straight to `style` inside a layout effect, so the fitting passes happen before
 * paint and never show. It is its own component because its parent box remounts on every
 * wrong drop (the shake's `key`); a fresh mount simply re-fits. It re-fits once more when
 * web fonts finish loading, because text measured in the fallback face can be a different
 * width.
 *
 * Off the type scale on purpose: a fit needs fine steps, which SIZE's tokens do not have.
 */
const FittedGloss: React.FC<{ text: string }> = ({ text }) => {
    const ref = useRef<HTMLElement | null>(null);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        let cancelled = false;
        const overflows = () => el.scrollWidth > el.clientWidth + 0.5 || el.scrollHeight > el.clientHeight + 0.5;
        const fit = () => {
            if (cancelled) return;
            el.style.overflowWrap = "normal";
            let size = GLOSS_MAX_FONT_PX;
            el.style.fontSize = `${size}px`;
            while (overflows() && size > GLOSS_MIN_FONT_PX) {
                size = Math.max(GLOSS_MIN_FONT_PX, size - GLOSS_FONT_STEP_PX);
                el.style.fontSize = `${size}px`;
            }
            // Last resort: a word too long even at the minimum may break rather than clip.
            if (overflows()) el.style.overflowWrap = "anywhere";
        };
        fit();
        // `fonts` is absent in some test environments; nothing to wait for there.
        document.fonts?.ready.then(fit).catch(() => undefined);
        return () => { cancelled = true; };
    }, [text]);

    return (
        <Typography
            ref={ref}
            component="span"
            className="bucket-drop__bucket-gloss"
            sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "100%",
                height: "100%",
                overflow: "hidden",
                fontFamily: FONTS.sans,
                fontSize: `${GLOSS_MAX_FONT_PX}px`,
                fontWeight: WEIGHT.medium,
                lineHeight: LEADING.tight,
                color: COLORS.onSurface,
                textAlign: "center",
                wordBreak: "normal",
                overflowWrap: "normal",
                hyphens: "manual",
            }}
        >
            {text}
        </Typography>
    );
};

const DropBucket: React.FC<DropBucketProps> = ({ slot, text, hovered = false, wrong = false, shakeKey = 0, leaving = false, enter = false }) => (
    <Box
        // Keyed by the stage on (slot, word); the inner key restarts the shake.
        className={`bucket-drop__bucket${wrong ? " bucket-drop__bucket--wrong" : ""}${leaving ? " bucket-drop__bucket--leaving" : ""}`}
        style={{ left: slot.x, top: slot.y, width: slot.width, height: slot.height }}
        sx={{
            position: "absolute",
            pointerEvents: "none",
            ...(leaving && {
                animation: `bucketDropBucketOut ${BUCKET_EXIT_MS}ms ease-in forwards`,
                "@keyframes bucketDropBucketOut": {
                    from: { opacity: 1, transform: "scale(1)" },
                    to: { opacity: 0, transform: "scale(0.9)" },
                },
            }),
            ...(enter && !leaving && {
                // `backwards` holds the 0% frame through the delay, so the new hole is
                // invisible until the old one has finished leaving.
                animation: `bucketDropBucketIn ${BUCKET_ENTER_MS}ms ease-out ${BUCKET_EXIT_MS}ms backwards`,
                "@keyframes bucketDropBucketIn": {
                    from: { opacity: 0, transform: "scale(0.9)" },
                    to: { opacity: 1, transform: "scale(1)" },
                },
            }),
        }}
    >
        <Box
            key={shakeKey}
            className="bucket-drop__bucket-hole"
            sx={{
                position: "relative",
                width: "100%",
                height: "100%",
                boxSizing: "border-box",
                borderRadius: `${BUCKET_RADIUS}px`,
                backgroundColor: BUCKET_FILL,
                // The 1px hairline stays 1px in every state — the wrong ring is an extra
                // OUTER box-shadow ring, so going red never shifts the gloss by a pixel.
                border: `1px solid ${wrong ? BUCKET_WRONG_RING : COLORS.border}`,
                boxShadow: wrong
                    ? `${SHADOW.recessedDeep}, 0 0 0 1.5px ${BUCKET_WRONG_RING}`
                    : SHADOW.recessedDeep,
                transition: "border-color 120ms ease, box-shadow 120ms ease",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "6px 8px",
                overflow: "hidden",
                ...(wrong && {
                    animation: `bubbleShake ${WRONG_SHAKE_MS}ms ease-in-out`,
                    ...WRONG_SHAKE_KEYFRAMES,
                }),
            }}
        >
            <FittedGloss text={text} />
            {hovered && (
                <Box
                    className="bucket-drop__bucket-wash"
                    sx={{ position: "absolute", inset: 0, backgroundColor: COLORS.scrim, borderRadius: "inherit" }}
                />
            )}
        </Box>
    </Box>
);

export default React.memo(DropBucket);
