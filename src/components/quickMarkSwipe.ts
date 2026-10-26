// Quick Mark's swipe vocabulary (docs/QUICK_MARK.md § 3): which bucket each swipe
// direction sorts a card into, its colour, and the per-frame drag painter. Shared by the
// card, the page (legend + undo toast) and the drag, so they can never disagree about
// what "left" means.
//
// Kept in its own module (not QuickMarkCard.tsx) so the card file only exports a
// component — otherwise Vite fast-refresh disables HMR for it.
import type { SwipeDirection } from "../hooks/useSwipeCommit";
import { LEARNING_COLORS, MASTERY_BAR_COLORS } from "../utils/categoryColors";

// The server bucket each direction commits. The values ARE `StarterPacksService.sortCard`
// bucket ids: right = "I already know it" (8/8 core history → Mastered), left = "Add to
// Learning" (empty history → Unfamiliar). Right = known mirrors the Reading Center's
// right = "I could read it".
export const QUICK_MARK_BUCKET: Record<SwipeDirection, "library" | "already-learned"> = {
    left: "library",
    right: "already-learned",
};

// Each direction is painted with the colour of the COLLECTION the card joins — the same
// surface the fdp draws that collection's card with: Learning gold (`LEARNING_COLORS`)
// and the core bar's Mastered blue (`MASTERY_BAR_COLORS.core`). The card's own fill
// shifts to it as it is dragged (no overlay).
export const QUICK_MARK_COLOR: Record<SwipeDirection, string> = {
    left: LEARNING_COLORS.main,
    right: MASTERY_BAR_COLORS.core.main,
};

// User-facing names ("Learning" is the library bucket's front-end name — CLAUDE.md).
export const QUICK_MARK_LABEL: Record<SwipeDirection, string> = {
    left: "Learning",
    right: "Mastered",
};

/** Horizontal travel (px) that commits a swipe — ~two-thirds of the 92px card. */
export const QUICK_MARK_COMMIT_PX = 60;

// Class hooks the painter finds inside a card (set by QuickMarkCard).
export const QUICK_MARK_SWIPE_LAYER_CLASS = "quick-mark-card__swipe-layer";
export const QUICK_MARK_FACE_CLASS = "quick-mark-card__face";

/**
 * `useSwipeCommit`'s imperative `paint` for a Quick Mark card: written straight to the
 * DOM, once per frame, so a drag never re-renders the grid. Moves the swipe layer with
 * the finger (transition off) and blends the card's own fill toward the destination
 * colour as the drag approaches the commit distance. `dx === null` (release) drops every
 * inline style, handing back to the card's React styles — the snap-back transition, or
 * the committed fly-off, which also paints the face in full.
 */
export function paintQuickMarkDrag(card: HTMLElement, dx: number | null): void {
    const layer = card.querySelector<HTMLElement>(`.${QUICK_MARK_SWIPE_LAYER_CLASS}`);
    const face = card.querySelector<HTMLElement>(`.${QUICK_MARK_FACE_CLASS}`);
    if (!layer || !face) return;
    if (dx === null) {
        layer.style.transform = "";
        layer.style.transition = "";
        face.style.backgroundColor = "";
        card.style.zIndex = "";
        return;
    }
    card.style.zIndex = "3"; // over its neighbours while dragged
    delete layer.dataset.slotSlide; // a drag takes over from any gap-fill slide
    layer.style.transition = "none";
    layer.style.transform = `translateX(${dx}px) rotate(${dx / 24}deg)`;
    const progress = Math.min(Math.abs(dx) / QUICK_MARK_COMMIT_PX, 1);
    const target = QUICK_MARK_COLOR[dx >= 0 ? "right" : "left"];
    // The card's resting fill, read once per card (its class style; no inline set yet).
    const base = (face.dataset.restingFill ??= getComputedStyle(face).backgroundColor);
    face.style.backgroundColor = `color-mix(in srgb, ${target} ${Math.round(progress * 100)}%, ${base})`;
}

// ── Gap fill: cards SLIDE into the hole a swipe leaves (FLIP) ────────────────────────
//
// When a card leaves (or an Undo puts one back), every card after it changes slot. The
// grid is a plain flex-wrap, so React's re-render would JUMP them; instead the page
// snapshots each card's slot just before the list changes (`snapshotCardSlots`) and,
// after the commit, plays each card from its old slot to its new one
// (`playCardSlotSlide`). Written straight to the DOM — no re-render per frame. The
// cards that come up from below the fold are already drawn (the draw window below keeps
// two rows past the screen painted), so nothing ever appears or fades in mid-slide.
//
// Positions are read with offsetLeft/offsetTop (LAYOUT boxes), on purpose: the outer
// card carries `useScrollStretch`'s transform and the swipe layer may carry a drag, and
// neither may leak into the measurement. The slide itself is drawn on the swipe layer,
// the one element whose transform this file already owns.

/** Duration of the gap-fill slide, ms. */
const SLOT_SLIDE_MS = 260;

/** Every Quick Mark card's layout slot, keyed by `data-swipe-id`. */
export type CardSlots = Map<string, { x: number; y: number }>;

/** The card elements inside a grid root. */
const cardsIn = (root: ParentNode): HTMLElement[] =>
    Array.from(root.querySelectorAll<HTMLElement>(".quick-mark-card[data-swipe-id]"));

export function snapshotCardSlots(root: ParentNode): CardSlots {
    const slots: CardSlots = new Map();
    for (const el of cardsIn(root)) {
        let x = el.offsetLeft;
        let y = el.offsetTop;
        // A card still mid-slide (back-to-back swipes) is SEEN between slots: start the
        // next slide from where it is, not from its layout slot, or it would jump.
        const layer = el.querySelector<HTMLElement>(`.${QUICK_MARK_SWIPE_LAYER_CLASS}`);
        if (layer?.dataset.slotSlide) {
            const m = new DOMMatrixReadOnly(getComputedStyle(layer).transform);
            x += m.m41;
            y += m.m42;
        }
        slots.set(el.dataset.swipeId!, { x, y });
    }
    return slots;
}

let slideSeq = 0;

export function playCardSlotSlide(root: ParentNode, before: CardSlots): void {
    const token = String(++slideSeq);
    const moved: HTMLElement[] = [];
    // FIRST/LAST/INVERT: put each moved card back at its old slot, untransitioned.
    for (const el of cardsIn(root)) {
        const prev = before.get(el.dataset.swipeId!);
        if (!prev) continue; // newly mounted (an Undo's card): it pops in instead
        const dx = prev.x - el.offsetLeft;
        const dy = prev.y - el.offsetTop;
        if (dx === 0 && dy === 0) continue;
        const layer = el.querySelector<HTMLElement>(`.${QUICK_MARK_SWIPE_LAYER_CLASS}`);
        if (!layer || layer.style.transition === "none") continue; // under a finger: leave it
        layer.dataset.slotSlide = token;
        layer.style.transition = "none";
        layer.style.transform = `translate(${dx}px, ${dy}px)`;
        moved.push(layer);
    }
    if (moved.length === 0) return;
    // Commit the inverted state BEFORE releasing it. A rAF would not do: the slide is
    // triggered from a timer / click, so a rAF callback runs before the next style recalc
    // and the browser would never see the old slot — the cards would just jump.
    void moved[0].offsetWidth; // forced style flush
    // PLAY: release them to their new slots.
    for (const layer of moved) {
        layer.style.transition = `transform ${SLOT_SLIDE_MS}ms ease`;
        layer.style.transform = "";
    }
    window.setTimeout(() => {
        for (const layer of moved) {
            if (layer.dataset.slotSlide !== token) continue; // a drag / newer slide took it over
            layer.style.transition = "";
            delete layer.dataset.slotSlide;
        }
    }, SLOT_SLIDE_MS);
}

// ── Draw window: only cards near the screen are painted ──────────────────────────────
//
// A card must already be painted when it slides into view (§ gap fill above), but the
// grid holds every loaded page (~100 cards each, growing with infinite scroll), and
// painting all of them is wasted work. So cards inside a band around the visible area
// are drawn and everything beyond it skips layout/paint (`content-visibility: hidden`;
// the face's `contain-intrinsic-size` keeps its footprint, so the grid and the FLIP
// slot measurements are unaffected).
//
// The band is an explicit IntersectionObserver margin rather than the browser's own
// `content-visibility: auto`, whose margin each engine picks for itself.
//
// Band = 2 rows each way: a one-at-a-time swipe pulls cards up at most ONE row (148px),
// and the second row absorbs the observer's one-frame lag during a fast scroll, so a
// card never scrolls in blank. Up as well as down, because the learner scrolls both ways.

/** One grid row: the 132px card + the 16px row gap (MiniVocabCardGrid). */
const GRID_ROW_PX = 148;
/** How far beyond the visible area cards stay drawn, px. */
const DRAW_MARGIN_PX = 2 * GRID_ROW_PX;

/**
 * Start painting only the cards within DRAW_MARGIN_PX of `scroller`'s viewport; returns
 * a disposer. Re-run it whenever the card list changes (mounts / removals): it rebuilds
 * the observer over the current cards, whose initial callback settles every card's state.
 * Cards default to DRAWN (QuickMarkCard's `contentVisibility: "visible"`), so a card the
 * observer hasn't reported yet is never blank — only cards confirmed far away are hidden.
 */
export function observeCardDrawWindow(root: ParentNode, scroller: Element | null): () => void {
    const observer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                const face = (entry.target as HTMLElement).querySelector<HTMLElement>(`.${QUICK_MARK_FACE_CLASS}`);
                // Inline `hidden` when far; clearing it falls back to the card's `visible`.
                if (face) face.style.contentVisibility = entry.isIntersecting ? "" : "hidden";
            }
        },
        { root: scroller, rootMargin: `${DRAW_MARGIN_PX}px 0px` },
    );
    for (const el of cardsIn(root)) observer.observe(el);
    return () => observer.disconnect();
}
