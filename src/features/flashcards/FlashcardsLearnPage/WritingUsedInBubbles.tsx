import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Box } from "@mui/material";
import ForeignText from "../../../components/ForeignText";
import HintBubbleSurface, { HINT_BUBBLE_TAIL_SIZE } from "../../../components/hintBubble/HintBubbleSurface";
import { HINT_MOTION } from "../../../components/hintBubble/hintMotion";
import { useHintBubblePresence, type PresenceItem } from "../../../components/hintBubble/useHintBubblePresence";
import type { UsedInItem, VocabEntry } from "../../../types";
import { COLORS } from "../../../theme";
import { SIZE } from "../../../theme/scale";
import { placeBubble, type BubblePlacement } from "./writingBubblePlacement";
import { previewShowsWholeCharacter } from "../../../components/handwriting/levelBehavior";
import { modeOfLevel, writingLevelForMastery } from "../../../../server/contracts/writingLevels";

/**
 * WritingUsedInBubbles — the writing flp's used-in hint bubbles (`?bar=writing`,
 * docs/WRITING_PRACTICE_REWORK.md § 3b "Used-in hint bubbles").
 *
 * Floating on the writing card's TOP EDGE, up to 2 bubbles show words that contain the card's character — the learner's own
 * saved words first, then everyday dictionary words — each with its pinyin, its dd and
 * the word itself, with the character being written drawn as a circled ? (ForeignText `maskChar`; 你们 → (?)们). A
 * context hint: "you know this character from these words". At levels 1–3 the card front
 * already shows the whole outline, so the bubbles show the real character instead
 * (`previewShowsWholeCharacter`).
 *
 * Data: `entry.writingUsedIn` (OnDeckVocabService.enrichWithUsedIn, writing bar only,
 * from VocabEntryDAL.findWritingUsedInForCharacter) — used-in pass 1 (the learner's
 * sorted vet words, no frequency gate) followed by pass 2 (dictionary words at
 * frequencyScore 4–5), single-character zh cards only. Multi-character cards and
 * cards with no qualifying words show an empty band. Saved and dictionary words are
 * drawn identically.
 *
 * Placement (writingBubblePlacement.ts → placeBubble): every bubble sits on one level,
 * its tail touching the card's top edge, at a random x drawn uniformly from the spots
 * that don't overlap a bubble already placed. A placement is computed
 * ONCE, when the bubble is first measured, in card-relative coordinates, so it never
 * jumps afterwards — a re-layout of the card just carries it along.
 *
 * Geometry: the bubbles live in an overlay (`position: absolute; inset: 0`) over the
 * flp's ContentArea, NOT in the flex column — ContentArea centres its children
 * (`alignItems: center`), which collapsed an in-flow, absolutely-filled band to 0px
 * wide. The card's box is read through the offsetLeft/offsetTop chain, which ignores
 * transforms, so the flip's rotateY never narrows the measured card mid-turn.
 * `WritingUsedInBand` is the separate in-flow spacer that keeps room above the card.
 *
 * Width: a bubble hugs its content — the wider of the word and its dd — capped at
 * MAX_BUBBLE_WIDTH, where the dd truncates with an ellipsis.
 *
 * Motion: the bk's hint-bubble look and timing (shared HintBubbleSurface +
 * useHintBubblePresence + HINT_MOTION). Bubbles are keyed by card id + word, so when
 * the front card changes the old set pops and the new set grows in, staggered, after
 * HINT_MOTION.enterDelayMs (which also lets the incoming card settle first).
 *
 * The bubbles are INERT (decided 2026-10-04): the eip is gated until submit on the
 * writing flp, so a tap must not open the word.
 *
 * Layer: flp page presentation (client). Pure render of the entry it is given.
 */
interface WritingUsedInBubblesProps {
    /** The ACTIVE FRONT card, or null (empty loop / loading). */
    entry: VocabEntry | null;
    /** The front card's element (FlashCardSection's `cardRef`) — the bubbles sit on its top edge. */
    cardRef: RefObject<HTMLElement | null>;
}

/** Most bubbles shown — matches the server's writingUsedIn limit (decided 2026-10-04). */
const MAX_BUBBLES = 2;
/** Widest a bubble may grow before its dd truncates, px. */
const MAX_BUBBLE_WIDTH = 140;
/**
 * The spacer's fixed height, px. Reserved on EVERY writing card — with or without
 * bubbles — so the card slot below never resizes from one card to the next. Holds the
 * single level of bubbles.
 */
const WRITING_USED_IN_BAND_HEIGHT = 92;
/**
 * The body's bottom edge sits this far above the card's top edge, so the tail's tip
 * just touches the card (the tail reaches ~TAIL/2 + 1 below the body).
 */
const BASE_BOTTOM = HINT_BUBBLE_TAIL_SIZE / 2 + 2;

interface BubbleValue {
    item: UsedInItem;
    /**
     * The card's character, drawn masked wherever it appears in the word — or undefined
     * at levels 1–3, whose card front already shows the whole outline (no mask needed).
     */
    maskChar: string | undefined;
}

/** The card's box in the overlay's coordinates. */
interface CardBox {
    left: number;
    top: number;
    width: number;
}

/**
 * `el`'s layout box relative to `container`, from the offsetLeft/offsetTop chain —
 * transforms are ignored (the flip's rotateY, the shake), which is the point.
 * Falls back to bounding rects if `container` is not on the offsetParent chain.
 */
function offsetBoxWithin(el: HTMLElement, container: HTMLElement): CardBox {
    let left = 0;
    let top = 0;
    let node: HTMLElement | null = el;
    while (node && node !== container) {
        left += node.offsetLeft;
        top += node.offsetTop;
        node = node.offsetParent as HTMLElement | null;
    }
    if (node === container) return { left, top, width: el.offsetWidth };
    const a = el.getBoundingClientRect();
    const b = container.getBoundingClientRect();
    return { left: a.left - b.left, top: a.top - b.top, width: el.offsetWidth };
}

/**
 * Tracks the front card's box. Re-measured when the front card changes (`cardKey` —
 * the ref's element swaps without a render of its own), on a frame after that (the
 * new front card mounts in the same commit), and whenever the card or the overlay
 * resizes (viewport, the slot's padding transition).
 */
function useCardBox(cardRef: RefObject<HTMLElement | null>, layerRef: RefObject<HTMLElement | null>, cardKey: number | null): CardBox | null {
    const [box, setBox] = useState<CardBox | null>(null);
    useLayoutEffect(() => {
        const layer = layerRef.current;
        if (!layer) return;
        const measure = () => {
            const card = cardRef.current;
            if (!card || card.offsetWidth === 0) return setBox(null);
            const next = offsetBoxWithin(card, layer);
            setBox((prev) => (prev && prev.left === next.left && prev.top === next.top && prev.width === next.width ? prev : next));
        };
        measure();
        const raf = requestAnimationFrame(measure);
        const ro = new ResizeObserver(measure);
        ro.observe(layer);
        if (cardRef.current) ro.observe(cardRef.current);
        return () => {
            cancelAnimationFrame(raf);
            ro.disconnect();
        };
    }, [cardRef, layerRef, cardKey]);
    return box;
}

/** The in-flow spacer above the writing card (see WRITING_USED_IN_BAND_HEIGHT). */
export function WritingUsedInBand() {
    return <Box className="writing-used-in-band" aria-hidden sx={{ flexShrink: 0, height: WRITING_USED_IN_BAND_HEIGHT }} />;
}

export default function WritingUsedInBubbles({ entry, cardRef }: WritingUsedInBubblesProps) {
    const layerRef = useRef<HTMLDivElement | null>(null);
    const card = useCardBox(cardRef, layerRef, entry?.id ?? null);

    const desired = useMemo<PresenceItem<BubbleValue>[]>(() => {
        if (!entry) return [];
        const character = entry.entryKey;
        // Levels 1–3 (Snap / Trace / Step Through) preview the whole character on the card
        // front, so the bubbles show it too; every other level masks it (decided 2026-10-04).
        const level = writingLevelForMastery(entry.writingMastery ?? 0);
        const maskChar = previewShowsWholeCharacter(modeOfLevel(level)) ? undefined : character;
        return (entry.writingUsedIn ?? []).slice(0, MAX_BUBBLES).map((item) => ({
            // Card id in the key: the same word on the next card still pops and regrows,
            // so the change of card always reads as a change of bubbles.
            key: `${entry.id}|${item.entryKey}`,
            value: { item, maskChar },
        }));
    }, [entry]);

    const bubbles = useHintBubblePresence(desired, {
        enterDelayMs: HINT_MOTION.enterDelayMs,
        staggerMs: HINT_MOTION.staggerMs,
        exitMs: HINT_MOTION.popMs,
    });

    // Each bubble's wrapper element, for measuring its natural size.
    const nodes = useRef(new Map<string, HTMLDivElement>());
    // Frozen per key at first measurement (see the header).
    const [placements, setPlacements] = useState<Record<string, BubblePlacement>>({});

    // Place newly mounted bubbles before paint. An unplaced bubble is mounted hidden
    // at the overlay's origin purely to be measured — it is inside its entrance delay
    // (transparent, scaled to a speck) either way, so nothing visible moves.
    useLayoutEffect(() => {
        if (!card) return;
        const live = new Set(bubbles.map((bubble) => bubble.key));
        const next: Record<string, BubblePlacement> = {};
        let changed = false;
        for (const [key, placement] of Object.entries(placements)) {
            if (live.has(key)) next[key] = placement;
            else changed = true;
        }
        // Only SHOWING bubbles are obstacles: a popping set is gone long before the
        // new set's entrance delay ends, so it must not crowd the newcomers' spots.
        const obstacles = bubbles.filter((b) => b.phase === "in" && next[b.key]).map((b) => next[b.key]);
        for (const bubble of bubbles) {
            if (bubble.phase !== "in" || next[bubble.key]) continue;
            const el = nodes.current.get(bubble.key);
            if (!el) continue;
            const placement = placeBubble({ w: el.offsetWidth, h: el.offsetHeight }, card.width, obstacles);
            next[bubble.key] = placement;
            obstacles.push(placement);
            changed = true;
        }
        if (changed) setPlacements(next);
    }, [bubbles, card, placements]);

    return (
        <Box
            ref={layerRef}
            className="writing-used-in-bubbles"
            aria-hidden
            sx={{
                position: "absolute",
                inset: 0,
                // Inert by design (decided 2026-10-04) — and the overlay must never
                // swallow a tap meant for the card beneath it.
                pointerEvents: "none",
            }}
        >
            {card && bubbles.map((bubble) => {
                const placement = placements[bubble.key];
                return (
                    <Box
                        key={bubble.key}
                        ref={(el: HTMLDivElement | null) => {
                            if (el) nodes.current.set(bubble.key, el);
                            else nodes.current.delete(bubble.key);
                        }}
                        className="writing-used-in-bubbles__slot"
                        sx={{
                            position: "absolute",
                            left: placement ? card.left + placement.x : 0,
                            top: placement ? card.top - BASE_BOTTOM - placement.h : 0,
                            // Hug the content (the wider of word and dd), up to the cap.
                            width: "max-content",
                            maxWidth: MAX_BUBBLE_WIDTH,
                            visibility: placement ? "visible" : "hidden",
                        }}
                    >
                        <HintBubbleSurface
                            phase={bubble.phase}
                            delayMs={bubble.delayMs}
                            className="writing-used-in-bubbles__bubble"
                        >
                            <ForeignText
                                className="writing-used-in-bubbles__word"
                                language="zh"
                                text={bubble.value.item.entryKey}
                                maskChar={bubble.value.maskChar}
                                pronunciation={bubble.value.item.pronunciation}
                                showPinyin={!!bubble.value.item.pronunciation}
                                size="sm"
                            />
                            {bubble.value.item.definition && (
                                <Box
                                    className="writing-used-in-bubbles__definition"
                                    sx={{
                                        maxWidth: "100%",
                                        px: 0.25,
                                        fontSize: SIZE.caption,
                                        color: COLORS.textSecondary,
                                        lineHeight: 1.3,
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                    }}
                                >
                                    {bubble.value.item.definition}
                                </Box>
                            )}
                        </HintBubbleSurface>
                    </Box>
                );
            })}
        </Box>
    );
}
