import React from "react";
import { Box, Typography } from "@mui/material";
import ForeignText from "../../components/ForeignText";
import { resolveDisplayDefinition, resolveDisplayPronunciation } from "../../utils/definitionUtils";
import { FONTS } from "../../theme/fonts";
import { API_BASE_URL } from "../../constants";
import type { BubbleBody, BubbleFill, BubbleStatus } from "./types";
import {
    CORRECT_BUBBLE_BG,
    CORRECT_BUBBLE_BORDER,
    WRONG_BUBBLE_BG,
    NOMATCH_BUBBLE_BG,
    NOMATCH_BUBBLE_BORDER,
    POP_DURATION_MS,
    WRONG_FEEDBACK_MS,
} from "./constants";

interface BubbleProps {
    body: BubbleBody;
    /** Passed as a primitive (not read off `body`) so React.memo can detect
        status transitions — the loop mutates `body` in place, so prev/next.body
        are the same object and body.status comparisons would always tie. */
    status: BubbleStatus;
    /** This bubble's BASE (idle) colors, chosen by the game — Bubble Match keys
        them on `kind`, Hydra Bubbles on the card's lend/mastery tier. Feedback
        statuses (correct/wrong/revealed/nomatch) override it; see below. */
    fill: BubbleFill;
    showPinyin: boolean;
    showPinyinColor: boolean;
    /** Registers the outer node so the rAF loop can write its transform. */
    registerNode: (id: string, el: HTMLDivElement | null) => void;
    onPointerDown: (id: string, e: React.PointerEvent) => void;
}

// Length-based font scale for the definition text, similar in spirit to the
// flashcard's englishFontSize but tuned to the smaller circular area.
const definitionFontSize = (text: string, radius: number): number => {
    const base = radius < 50 ? 13 : 14.5;
    if (text.length > 42) return base - 3;
    if (text.length > 26) return base - 1.5;
    return base;
};

/**
 * Text ink for a given bubble body — white on a dark body, near-ink on a light one.
 *
 * A RULE, NOT A KNOB, and deliberately so. Every game supplies only `fill` colors, and
 * whether those colors need light text is a fact ABOUT them, not a separate decision a
 * game should be able to get wrong. Deriving it here means a palette change can never
 * leave dark text stranded on a dark bubble — which is exactly what would have happened
 * when Hydra's drain tier went to the saturated `bluA` (docs/HYDRA_BUBBLES.md § 2.2).
 *
 * The threshold is WCAG relative luminance at **0.26**, which is the DERIVED crossover
 * rather than a guess: white and `#3a3a3a` score equally against a body of luminance L
 * when (L + 0.05)² = 1.05 × (0.0423 + 0.05), i.e. L ≈ 0.261. Below it white wins, above
 * it dark does.
 *
 * ⚠️ It was 0.42 for one revision, on the hand-waved reasoning that "#3a3a3a keeps
 * winning past the midpoint". It does — but only to 0.26, not 0.42, so the band between
 * the two forced WHITE text onto bodies where black was measurably more legible (a
 * luminance-0.32 blue: white 2.86:1, dark 3.97:1). If this constant is ever retuned,
 * re-derive it from the formula above rather than eyeballing it.
 *
 * It also subsumes the old hardcoded special case: the strong red `wrong` flash sits at
 * luminance 0.21 and has always wanted white text.
 *
 * ⚠️ IT DOES NOT REACH THE PINYIN. `ForeignText.characterColor` is documented to leave
 * the tone overlay alone, and `TONE_COLORS` are design-owned literals, so tone-colored
 * pinyin on a dark bubble keeps whatever contrast the hue happens to give it. That is a
 * real constraint on how dark any WORD bubble's fill may go — see the palette note in
 * HydraStage.
 */
const LIGHT_INK = "#FFFFFF";
const DARK_INK = "#3a3a3a";
const inkOnFill = (hex: string): string => {
    const h = hex.replace("#", "");
    if (h.length !== 6) return DARK_INK; // non-hex fill (rgba etc.) — assume light body
    const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const [r, g, b] = [0, 2, 4].map((i) => lin(parseInt(h.slice(i, i + 2), 16) / 255));
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance < 0.26 ? LIGHT_INK : DARK_INK;
};

// Word bubbles shrink their cpcd row to fit longer words inside the circle.
const wordContentScale = (charCount: number, radius: number): number => {
    const innerWidth = radius * 2 * 0.82; // usable width inside the circle
    const approxContentWidth = charCount * 30; // ~30px per char at cpcd "sm"
    return Math.min(1, innerWidth / approxContentWidth);
};

/**
 * A single floating bubble — shared by every bubble game.
 *
 * Two layers by design:
 *  - The outer node carries the physics transform (translate + scale) written
 *    every frame by the rAF loop — React never touches it per-frame.
 *  - The inner node carries status-driven CSS feedback (green pop / red shake).
 *    Using a separate element keeps these transforms from fighting the loop's.
 *
 * ⚠️ The inner node's `key` is deliberately NOT `status`. It only distinguishes the
 * two ANIMATED statuses (`correct`/`wrong`) from everything else, because a key
 * change remounts the whole subtree — and that subtree contains a CPCDRow, whose
 * `useLayoutEffect` runs a forced-layout pinyin measuring pass on mount, plus (on a
 * definition bubble) an `<img>` that has to be re-fetched and re-decoded. Keying on
 * the raw status paid that cost on every *pickup*, every hover change and every
 * release, which is exactly the grab lag it caused. The pop/shake animations still
 * start correctly without a remount: they are reached from `idle`, so the animation
 * property goes absent → present and the browser starts them fresh.
 */
const Bubble: React.FC<BubbleProps> = ({
    body,
    status,
    fill,
    showPinyin,
    showPinyinColor,
    registerNode,
    onPointerDown,
}) => {
    const { id, kind, entry, radius, targetRadius } = body;
    const isWord = kind === "word";
    // "I am under the pointer" — either the held bubble or the bubble it is
    // hovering over. Drawn as a grey wash (see the overlay at the bottom).
    const cued = status === "held" || status === "hovered";
    // Only promote a bubble to its own compositor layer while it's actually
    // moving (being dragged, the drop-target growing, or inflating in). A
    // permanent `willChange: transform` on all ~40 bubbles keeps 40 GPU layers
    // alive at once, which thrashes the mobile compositor and shows up as input
    // lag (taps/drags register a beat late). Idle bubbles don't animate, so they
    // get `auto` and stay off their own layer.
    const animating = status === "held" || status === "hovered" || status === "growing" || status === "nomatch";

    let bg: string;
    let border: string;
    if (status === "correct" || status === "revealed") {
        // Light green: a match pop, or the cleanup-mode partner drop hint.
        bg = CORRECT_BUBBLE_BG;
        border = CORRECT_BUBBLE_BORDER;
    } else if (status === "nomatch") {
        // Light red: a cleanup-mode bubble with no partner on the field.
        bg = NOMATCH_BUBBLE_BG;
        border = NOMATCH_BUBBLE_BORDER;
    } else if (status === "wrong") {
        bg = WRONG_BUBBLE_BG;
        border = WRONG_BUBBLE_BG;
    } else {
        // No feedback status — the game's own base color for this bubble.
        bg = fill.bg;
        border = fill.border;
    }

    // Text ink follows the resolved body — feedback fills included, since `wrong` is a
    // strong red and `nomatch` a light one.
    const ink = inkOnFill(bg);

    // Lay text out for the bubble's FINAL size; the grow-in is a CSS scale on the
    // outer node, so the content scales with it rather than re-flowing each frame.
    const contentScale = wordContentScale([...entry.entryKey].length, targetRadius);

    // The definition bubble is a dd surface: it must read exactly like the flashcard
    // face for the same card, so it resolves through the shared resolver (chosen sense).
    const defText = resolveDisplayDefinition(entry);
    // Definition bubbles show the entry's representative icons8 icon (same one as
    // the flashcard faces) stacked above the text. Absent icon -> text only, no
    // reserved space (a bubble has no fixed image slot like the card does).
    const hasIcon = !isWord && !!entry.iconId;

    return (
        <Box
            ref={(el: HTMLDivElement | null) => registerNode(id, el)}
            className={`bubble bubble--${kind} bubble--${status}`}
            onPointerDown={(e) => onPointerDown(id, e)}
            sx={{
                position: "absolute",
                top: 0,
                left: 0,
                width: targetRadius * 2,
                height: targetRadius * 2,
                // Initial transform; the rAF loop overwrites this each frame. The
                // node is laid out at full size, so growth shows as a scale and the
                // translate offset is by targetRadius (see writeTransform).
                transform: `translate(${body.x - targetRadius}px, ${body.y - targetRadius}px) scale(${(targetRadius > 0 ? radius / targetRadius : 1) * body.scale})`,
                willChange: animating ? "transform" : "auto",
                touchAction: "none", // pointer events drive dragging, not scrolling
                cursor: "grab",
                zIndex: status === "held" || status === "nomatch" ? 30 : status === "hovered" ? 20 : status === "revealed" ? 15 : 10,
            }}
        >
            <Box
                // See the ⚠️ note in the component doc: only correct/wrong remount.
                key={status === "correct" || status === "wrong" ? status : "base"}
                className="bubble__inner"
                sx={{
                    width: "100%",
                    height: "100%",
                    // `.bub` is a SOFT SQUARE, not a disc (border-radius 40% — see
                    // docs/SHELF_REDESIGN.md § 12). The physics body is still a circle,
                    // so the four corners reach ~8% of a radius past the collision
                    // boundary; that is inside the overlap the field already tolerates
                    // (planSpawn's SPAWN_OVERLAP_FRACTION lets a new bubble penetrate a
                    // neighbour by 20% of its DIAMETER), so nothing about the shape is
                    // load-bearing for the simulation. The keycap read is: a bubble is a
                    // thing you press, and a squircle packs into the field with far less
                    // dead space between neighbours than a disc.
                    borderRadius: "40%",
                    backgroundColor: bg,
                    // ONE ring weight for every bubble in every game, feedback status
                    // included. The design's `.bub` has no ring at all — its edge comes
                    // from the inset gloss below — so 2px is a geometry constant, not a
                    // channel: it keeps a bubble's border box the same size whether its
                    // border color matches its body (which it now always does) or not.
                    border: `2px solid ${border}`,
                    // `.bub` (docs/SHELF_REDESIGN.md § 12). Three shadows, and each does
                    // a different job: a white inset along the top edge and a dark inset
                    // along the bottom give the disc its convex, physical read — which is
                    // what lets the ring be dropped entirely on a game that has nothing to
                    // encode in it — and a tight, offset drop shadow lifts it off the
                    // field without the wide soft halo that used to blur the boundary
                    // between two touching bubbles.
                    boxShadow:
                        "inset 0 1px 0 rgba(255,255,255,0.88), inset 0 -3px 0 rgba(23,22,26,0.13), 0 3px 6px -3px rgba(20,18,26,0.28)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                    boxSizing: "border-box",
                    padding: "6px",
                    position: "relative",
                    transition: "background-color 0.15s ease, border-color 0.15s ease",
                    ...(status === "correct" && {
                        animation: `bubblePop ${POP_DURATION_MS}ms ease-out forwards`,
                        "@keyframes bubblePop": {
                            "0%": { transform: "scale(1)", opacity: 1 },
                            "45%": { transform: "scale(1.25)", opacity: 1 },
                            "100%": { transform: "scale(0.2)", opacity: 0 },
                        },
                    }),
                    ...(status === "wrong" && {
                        animation: `bubbleShake ${WRONG_FEEDBACK_MS}ms ease-in-out`,
                        "@keyframes bubbleShake": {
                            "0%, 100%": { transform: "translateX(0)" },
                            "20%": { transform: "translateX(-6px)" },
                            "40%": { transform: "translateX(6px)" },
                            "60%": { transform: "translateX(-4px)" },
                            "80%": { transform: "translateX(4px)" },
                        },
                    }),
                }}
            >
                {isWord ? (
                    <Box
                        className="bubble__word"
                        sx={{
                            transform: `scale(${contentScale})`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        <ForeignText
                            size="sm"
                            justifyContent="center"
                            text={entry.entryKey}
                            // Sense-resolved, matching the gloss on the paired bubble.
                            pronunciation={resolveDisplayPronunciation(entry)}
                            showPinyin={showPinyin}
                            useToneColor={showPinyinColor}
                            // Override the glyph color ONLY on a dark body. Passing
                            // the light-body ink here instead would silently lighten
                            // every word bubble in both games from the theme's primary
                            // ink (#17161A) to #3a3a3a — the definition text's color,
                            // which is a different job. undefined = theme default.
                            //
                            // The pinyin overlay is unaffected either way: ForeignText
                            // leaves tone colors alone by design.
                            characterColor={ink === LIGHT_INK ? LIGHT_INK : undefined}
                            // Match flp example sentences: nudge long pinyin syllables apart.
                            pinyinShift
                        />
                    </Box>
                ) : (
                    <Box
                        className="bubble__definition-stack"
                        sx={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "3px",
                        }}
                    >
                        {hasIcon && (
                            <Box
                                component="img"
                                className="bubble__definition-icon"
                                src={`${API_BASE_URL}/api/icons8/${encodeURIComponent(entry.iconId!)}/image`}
                                alt=""
                                // Decorative: not draggable / no pointer events so it
                                // doesn't fight the bubble drag gesture.
                                draggable={false}
                                sx={{ width: 28, height: 28, objectFit: "contain", flexShrink: 0, pointerEvents: "none" }}
                            />
                        )}
                        <Typography
                            className="bubble__definition"
                            sx={{
                                fontSize: definitionFontSize(defText, targetRadius),
                                // 1.3 (was 1.15) so the last clamped line's descenders
                                // (q/g/y/p) aren't clipped by the -webkit-box overflow.
                                lineHeight: 1.3,
                                fontWeight: 500,
                                fontFamily: FONTS.cjk,
                                // Follows the body, so a dark fill (Hydra's drain tier,
                                // the strong-red wrong flash) gets white text and every
                                // light one keeps near-ink. See inkOnFill.
                                color: ink,
                                textAlign: "center",
                                // Clamp very long definitions so they never overflow the
                                // circle. One line fewer when the icon is taking up room.
                                display: "-webkit-box",
                                WebkitLineClamp: hasIcon ? 3 : 4,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                            }}
                        >
                            {defText}
                        </Typography>
                    </Box>
                )}

                {/* Pickup / drop-target cue: a grey wash, shared by every bubble
                    game. It is a pure overlay — it does not change the bubble's own
                    colors, so a tier-colored bubble still reads as its tier while it
                    is being dragged.

                    Hydra Bubbles used to draw a contrast RING here instead, on the
                    grounds that grey was its English-bubble color and a grey wash
                    would read as a card color. That stopped being true when the
                    English bubble moved to pure white (HYDRA_BUBBLES.md § 5.1), and
                    the two games are now deliberately one bubble with two palettes. */}
                {cued && (
                    <Box
                        className="bubble__dim"
                        sx={{
                            position: "absolute",
                            inset: 0,
                            // Matches the bubble's own squircle — a circular veil inside
                            // a soft square leaves four unlit corners.
                            borderRadius: "40%",
                            backgroundColor: "rgba(90,90,90,0.32)",
                            pointerEvents: "none",
                        }}
                    />
                )}
            </Box>
        </Box>
    );
};

// Re-render only when something the React layer cares about changes. Position
// lives in a ref and is written straight to the DOM, so x/y/scale changes must
// NOT trigger re-renders — only status and identity do.
export default React.memo(Bubble, (prev, next) => {
    return (
        prev.body.id === next.body.id &&
        prev.status === next.status &&
        // Compared field-by-field: the stage builds a fresh object each render,
        // so an identity check would defeat the memo entirely.
        prev.fill.bg === next.fill.bg &&
        prev.fill.border === next.fill.border &&
        prev.showPinyin === next.showPinyin &&
        prev.showPinyinColor === next.showPinyinColor
    );
});
