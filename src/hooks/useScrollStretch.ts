import { useEffect, type RefObject } from "react";

/**
 * useScrollStretch — the cards lie on a sheet of elastic fabric that the scroll drags.
 *
 * ── The behaviour ─────────────────────────────────────────────────────────────
 * The sheet is PINNED at the trailing edge of travel — the edge cards are leaving by —
 * and the scroll draws the rest of it away from that pin, further the further from it a
 * card sits, so the visible cards lag behind the scroll rather than running ahead of it. Every neighbouring pair therefore moves APART: the gaps open out while the
 * list is moving, by more the faster it moves, and close back to their resting spacing
 * when it stops. Nothing about the cards' own size changes, only the space between them.
 *
 * The shape is two independent pieces, and keeping them independent is what makes it
 * behave the same scrolling up as scrolling down: `rubberBand(|drag|)` says HOW MUCH the
 * sheet is open in total (`maxStretchPx` at most, half of it at a drag of
 * `DRAG_AT_HALF_STRETCH_PX`), and `spreadProfile(distance from the pin)` says how that
 * total is distributed along it. The magnitude is direction-free; the profile carries the sign.
 *
 * ── Modelled on UIScrollView, deliberately ────────────────────────────────────
 * Three properties of Apple's scroll elasticity, each of which we got wrong in an
 * earlier version and each of which is load-bearing for whether this reads as native:
 *
 *   1. It is DISPLACEMENT-driven, never velocity-driven. The stretch is a function of
 *      how far the content has actually been dragged (`drag`, integrated from real
 *      per-frame scroll deltas), not of an estimated speed. This matters for feel — the
 *      fabric tracks the finger instead of reacting to it — and for smoothness, because
 *      a velocity estimate means dividing a position delta by a frame time, and both of
 *      those are spiky. Every jitter filter in the old version existed to hide that
 *      division; none of them are needed now that it is gone.
 *
 *   2. Resistance SATURATES, it does not clamp. Apple's rubber band is
 *      `b(x) = (1 − 1/(x·c/d + 1))·d/c` with `c = 0.55`, which is the hyperbola
 *      `b(x) = A·x/(x + A)` for an asymptote `A = d/c`, eased smoothly onto a ceiling it
 *      never reaches (we split `A` in two — see `rubberBand`). A hard cap (the old `SPAN_CAP`) puts a
 *      crease in the fabric — every card past the cap moves as one rigid block — and the
 *      crease travels through the list as you scroll. See `rubberBand`.
 *
 *   3. The return NEVER OVERSHOOTS. `drag` decays exponentially toward zero, which is
 *      monotone by construction, so the spacing eases shut and stops. The old release
 *      was an underdamped spring that sprang back past its resting value; nothing in
 *      iOS's scroll physics does that, and it reads as un-native however clean the
 *      interpolation is.
 *
 * ── Why the shift is a CONTINUOUS function of position ────────────────────────
 * A track's lag is computed from its distance to the anchor in PIXELS
 * (`(offset − anchorPos) / trackSpacing`), not from its index in the track array. The
 * index version was the real source of the jerky relax: it is an integer, so the anchor
 * advancing by one row — or the windowed grid rebuilding `tracks` so index `i` means a
 * different row — moved every card by a whole step in a single frame. A pixel distance
 * slides continuously and is stable across rebuilds, because a track's content offset is
 * a property of the layout rather than of the array it happens to sit in.
 *
 * The anchor itself is the one thing that still jumps: it sits at the top edge of the
 * viewport going forward and the bottom edge going back, so a reversal moves it by a
 * whole viewport. That is safe only because the switch is keyed on `sign(drag)`, and
 * `drag` is a continuous quantity that can only change sign by passing through zero —
 * where every shift is zero regardless of where the anchor is. The jump multiplies out.
 *
 * ── Why TRANSFORMS and not `gap` ──────────────────────────────────────────────
 * Animating the container's `gap` is the obvious implementation and it is the wrong
 * one here, for three separate reasons:
 *
 *   1. `MiniVocabCardGrid` is WINDOWED (useWindowedRows), and the window's spacer
 *      arithmetic is done against a CONSTANT row gap. A live gap would make the
 *      spacers lie by (rows above × stretch) px — a kilometre of drift on a large
 *      library — and the scroll would jump.
 *   2. A changing gap on a wrapping grid changes the container's height, which moves
 *      every sibling below it while the user is mid-scroll.
 *   3. It is a layout property: every frame of the animation costs a full relayout of
 *      the list, during a scroll, which is the one moment there is no budget for it.
 *
 * A `translate` is compositor-only: no layout, no height change, no windowing breakage.
 *
 * ── Tracks, not cards ─────────────────────────────────────────────────────────
 * The hook groups the container's children into TRACKS by their cross-axis offset:
 * on a wrapping grid a track is a row of three cards (they must move together or the
 * row shears), and on a horizontal strip every card is its own track. Grouping is
 * measured from the DOM rather than told to us, so a caller does not have to declare
 * its columns and a responsive grid stays correct.
 *
 * ── The frame budget (why this file is written the way it is) ─────────────────
 * This effect runs DURING a scroll, so every forced synchronous layout it causes is
 * a dropped frame the user feels as scroll lag. Four rules hold it to a compositor-
 * only cost, and each one is load-bearing — see the inline notes before changing any
 * of them:
 *
 *   A. The rAF loop performs NO DOM READS. Scroll position comes from the scroll
 *      event (`lastPos`) and the viewport size is cached, so the loop never reads
 *      `scrollTop`/`clientHeight` after having written transforms — which is the
 *      classic write-then-read layout thrash, once per frame, for the whole list.
 *   B. Only the tracks inside the VISIBLE BAND are written. Off-screen tracks cannot
 *      be seen moving, so writing them is pure paint cost that scales with the
 *      library rather than with the screen.
 *   C. A track whose shift has not changed by a visible amount is not written at all,
 *      and the whole frame is skipped when nothing moved by more than a subpixel.
 *   D. Re-measuring (`buildTracks`, which reads a rect per child) happens at most
 *      ONCE PER FRAME, in a read phase before any write, and never from inside the
 *      MutationObserver callback — a windowed grid mutates its children on nearly
 *      every scroll frame, and re-measuring from the observer put a forced layout
 *      between the browser's own scroll work and ours.
 *
 * ── Notes for callers ─────────────────────────────────────────────────────────
 * • The hook writes `style.transform` on the children directly (never through React,
 *   so a fling costs no re-render) and REMOVES it the moment the fabric settles.
 *   While it is active it therefore overrides a child's own transform — which in
 *   practice only collides with a card's entrance pop-in, and that animation happens
 *   at mount when the list is not moving and this hook is writing nothing.
 * • Children marked `aria-hidden` are ignored, so the windowing spacers don't count
 *   as tracks.
 * • Honours `prefers-reduced-motion`.
 *
 * Used by: `MiniVocabCardGrid`, `ProvisionalCardGrid`, `VocabEntryCards`,
 * `shelf/Shelf` (ShelfRow), `community/CommunityFeedRow`.
 * Docs: docs/UX_AND_NAVIGATION.md § "Scroll stretch".
 */

/** Total spread of the sheet at full stretch, in px: the furthest any card can be moved
 *  from its resting place, however hard the fling.
 *
 *  This is NOT the distance between two neighbours — it is the whole sheet's opening,
 *  shared out along it by `spreadProfile`. The widest a single GAP gets is
 *
 *      maxStretchPx / (SPREAD_ROWS + 1)
 *
 *  at the pin, and less for every gap after that. So the two ways to put more air between
 *  two cards are to raise this or to lower SPREAD_ROWS, and that formula says exactly what
 *  each one buys. */
const DEFAULT_MAX_STRETCH_PX = 200;

/** Drag at which the sheet is HALF open, in px — how hard you must fling to get half of
 *  `maxStretchPx`.
 *
 *  ⚠️ This exists because it used to BE the asymptote, the same single number serving as
 *  both, which is what made the asymptote useless as a knob: raising it also pushed the
 *  curve out, so the extra range was never reached and the stretch barely moved (40 → 80
 *  bought 2px of gap). Held separate, `maxStretchPx` scales the opening linearly, which
 *  is what a maximum should do. Keep this near the drag a firm fling actually produces
 *  (`DRAG_GAIN · r/(1−r)` × px-per-frame ≈ 60) so a real fling lands in the middle of the
 *  curve rather than out on one of its flat ends. */
const DRAG_AT_HALF_STRETCH_PX = 40;

/** How much of each frame's scroll displacement is fed into the drag.
 *
 *  ⚠️ Tune this together with DRAG_RELAX_PER_STEP, never alone: the two are coupled, and
 *  the equilibrium stretch at a given scroll speed is their product `gain · r/(1−r)` ×
 *  px-per-frame. It is ≈ 1.5× at these values, so a firm fling (~40 px/frame) sits around
 *  60px of raw drag — well into the rubber band's saturating region — and a slow drag
 *  stays in its linear 1:1 region. Changing the relax alone silently changes how far the
 *  sheet opens as well as how fast it shuts; hold `gain · r/(1−r)` fixed to move one
 *  without the other. */
const DRAG_GAIN = 0.51;

/** Fraction of the drag surviving each fixed step. Exponential, therefore MONOTONE:
 *  this is what guarantees the return cannot overshoot (property 3 above). ≈58ms time
 *  constant, so the sheet is visibly shut about a third of a second after a firm fling —
 *  quick enough to feel like a snap rather than a settle. `DRAG_GAIN` above carries the
 *  matching correction that keeps the open stretch unchanged. */
const DRAG_RELAX_PER_STEP = 0.75;

/** The drag is integrated in FIXED steps of this many ms, however long the real frame
 *  was. Decaying once per rAF instead makes the relax literally twice as fast on a
 *  120 Hz screen and stutter whenever a frame runs long — which is exactly when the
 *  release is happening, right after a fling. */
const RELAX_STEP_MS = 1000 / 60;

/** Longest real frame the accumulator will believe. A backgrounded tab or a GC pause can
 *  hand us a gap of seconds; without this the drain loop would run hundreds of steps and
 *  collapse the drag instantly (or lock the main thread doing it). */
const MAX_FRAME_MS = 64;

/** Below this much drag the fabric is at rest: transforms come off and the loop parks.
 *  Deliberately small — settling IS a discontinuity (every transform goes to zero at
 *  once), so the threshold has to be low enough that the jump it causes is under a
 *  pixel for the furthest-lagging card. */
const SETTLE_DRAG_PX = 0.2;

/** How far past the viewport a track is still written (rule B above). Generous enough
 *  that a track flung into view already carries the right shift, and that the band
 *  survives a frame in which the position moved a long way. */
const BAND_OVERSCAN_PX = 600;

/** A shift closer than this to the one already on the element is not worth a style
 *  write; and a frame in which the drag moved less than this is not worth a write at
 *  all (rule C). */
const WRITE_EPS_PX = 0.05;

/** How many cards away from the anchor the stretch is spread over, i.e. where the
 *  profile below reaches half of its total. This is what keeps the sheet reading as
 *  FABRIC rather than as a tear: at 1 the whole stretch lands in the single gap next to
 *  the anchor and everything past it moves as a rigid block; at 4 the opening decays
 *  over the height of a viewport, which is what an elastic sheet actually does. */
const SPREAD_ROWS = 4;

/** Fallback spacing when a list is too short to measure one (a single track). Only ever
 *  scales the lag of a list that has no second row to lag behind it, so the exact value
 *  is immaterial; it exists to keep a division safe. */
const FALLBACK_TRACK_SPACING_PX = 120;

/**
 * How the stretch is DISTRIBUTED along the sheet: 0 at the anchor, easing onto 1 far
 * from it, odd-symmetric so both sides of the anchor spread AWAY from it.
 *
 * ⚠️ The one property that must not be broken: this is strictly INCREASING in `u`. The
 * gap between two neighbours is `spacing + (shift of the further − shift of the nearer)`,
 * so a profile that increases opens the gaps and one that decreases closes them. An
 * earlier version took `|u|` in order to make the two scroll directions symmetric, which
 * makes the profile decrease on one side of the anchor — and that side became a SQUEEZE.
 * Symmetry belongs in the magnitude (`|drag|`), never in the profile.
 */
const spreadProfile = (u: number): number => u / (Math.abs(u) + SPREAD_ROWS);

/**
 * Apple's rubber band, generalised by one parameter.
 *
 * `b(x) = (1 − 1/(x·c/d + 1))·d/c` with `c = 0.55` and `d` the viewport dimension is
 * algebraically `A·x/(x + A)` where `A = d/c` — a hyperbola whose asymptote and whose
 * half-way point are forced to be the SAME number. That coupling is right for overscroll,
 * where `d` is a real physical distance and the 1:1-at-the-origin behaviour it produces
 * is the entire point. It is wrong here, where the input is an internally scaled `drag`
 * rather than a real pull, and where it made the asymptote unusable as a knob.
 *
 * Splitting them into `A·x/(x + half)` keeps the shape exactly — same curve, same
 * saturation, same absence of a crease — while letting `asymptote` mean the maximum and
 * `half` mean how fast you reach it. Takes a NON-NEGATIVE `x`: the sign of the motion
 * lives in `spreadProfile`, never here.
 */
const rubberBand = (x: number, asymptote: number, half: number): number =>
    (asymptote * x) / (x + half);

export interface ScrollStretchOptions {
    /** Scroll axis of the list. `"y"` for a wrapping grid on a scrolling page,
     *  `"x"` for a horizontal strip. Default `"y"`. */
    axis?: "x" | "y";
    /** Total spread of the sheet at full stretch, in px. The widest single gap it
     *  produces is `maxStretchPx / (SPREAD_ROWS + 1)`. */
    maxStretchPx?: number;
    /** Turn the effect off without changing the call site's shape. */
    enabled?: boolean;
}

/** One row (vertical) or one card (horizontal): the elements that must move together. */
interface Track {
    /** Offset along the scroll axis, in the scroller's content coordinates. */
    offset: number;
    els: HTMLElement[];
    /** Last shift written to this track's elements, so an unchanged frame writes
     *  nothing. `NaN` after a rebuild — the first frame then always writes. */
    written: number;
}

/** Tracks plus the typical distance between two of them, which is what turns a pixel
 *  distance into a "how many cards along am I" number without hard-coding a card size. */
interface TrackSet {
    tracks: Track[];
    spacing: number;
}

/** The scrollable ancestor a list actually moves inside, or `window` when the page
 *  itself is the scroller. Mirrors what useWindowedRows measures against. */
type Scroller = HTMLElement | Window;

/**
 * Whether an element is DECLARED scrollable on the axis.
 *
 * ⚠️ Deliberately a style-only test, with NO `scrollHeight > clientHeight` check. Card
 * lists are filled asynchronously, so at the moment this effect runs the real scroller
 * is usually still shorter than its content will be — the decks sheet in particular
 * mounts empty and collapsed. An overflow test at mount therefore walks straight past
 * the true scroller and lands on `window`, which on a `scrollable={false}` shell never
 * scrolls at all, and the effect is silently dead for the life of the list. Declared
 * overflow is a property of the layout, not of the data, so it is true from mount.
 * An `auto` ancestor that never actually overflows just means a listener that never
 * fires, which costs nothing.
 */
const isScrollableOn = (el: HTMLElement, axis: "x" | "y"): boolean => {
    const style = getComputedStyle(el);
    const overflow = axis === "y" ? style.overflowY : style.overflowX;
    return /(auto|scroll|overlay)/.test(overflow);
};

/**
 * Walk up from the list to the thing that scrolls it. The list itself counts — a
 * horizontal strip is usually its own scroller.
 *
 * ⚠️ `getComputedStyle` per ancestor: this is a style-recalc flush and must never be
 * called on a per-mutation or per-frame path. It runs at mount, on a window resize,
 * and once after the fabric settles (see `resolveScroller` below).
 */
const findScroller = (list: HTMLElement, axis: "x" | "y"): Scroller => {
    let el: HTMLElement | null = list;
    while (el && el !== document.body) {
        if (isScrollableOn(el, axis)) return el;
        el = el.parentElement;
    }
    return window;
};

const scrollPosOf = (scroller: Scroller, axis: "x" | "y"): number =>
    scroller === window
        ? axis === "y"
            ? window.scrollY
            : window.scrollX
        : axis === "y"
          ? (scroller as HTMLElement).scrollTop
          : (scroller as HTMLElement).scrollLeft;

const viewportOf = (scroller: Scroller, axis: "x" | "y"): number =>
    scroller === window
        ? axis === "y"
            ? window.innerHeight
            : window.innerWidth
        : axis === "y"
          ? (scroller as HTMLElement).clientHeight
          : (scroller as HTMLElement).clientWidth;

/**
 * Group the list's children into tracks, in the scroller's content coordinates.
 *
 * Measured once per scroll burst rather than per frame: the hook only ever writes
 * transforms, which do not move an element's layout box, so the offsets it caches
 * stay true for as long as the DOM does. A childList/resize mutation marks the cache
 * dirty and the NEXT FRAME rebuilds it (rule D) — the observers themselves never
 * measure.
 *
 * Reads are batched deliberately: one rect read flushes layout, and the rest are then
 * served from the same clean layout, so the cost is one flush regardless of the child
 * count.
 */
const buildTracks = (list: HTMLElement, scroller: Scroller, axis: "x" | "y"): TrackSet => {
    const base =
        scroller === window
            ? 0
            : axis === "y"
              ? (scroller as HTMLElement).getBoundingClientRect().top
              : (scroller as HTMLElement).getBoundingClientRect().left;
    const scrolled = scrollPosOf(scroller, axis);

    const byOffset = new Map<number, HTMLElement[]>();
    for (const child of Array.from(list.children)) {
        if (!(child instanceof HTMLElement)) continue;
        // Windowing spacers and other decorative fillers are layout, not cards.
        if (child.getAttribute("aria-hidden") === "true") continue;
        const rect = child.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        const raw = (axis === "y" ? rect.top : rect.left) - base + scrolled;
        // Rounded to 2px so sub-pixel differences inside one row don't split it into
        // two tracks, which would shear the row apart under the stretch.
        const key = Math.round(raw / 2) * 2;
        const existing = byOffset.get(key);
        if (existing) existing.push(child);
        else byOffset.set(key, [child]);
    }

    const tracks = Array.from(byOffset.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([offset, els]) => ({ offset, els, written: Number.NaN }));

    // Mean gap between tracks — derived rather than configured, so one constant serves a
    // three-column grid of tall cards and a horizontal strip of narrow spines alike, and
    // a responsive breakpoint needs no retuning.
    const spacing =
        tracks.length > 1
            ? (tracks[tracks.length - 1].offset - tracks[0].offset) / (tracks.length - 1)
            : FALLBACK_TRACK_SPACING_PX;

    return { tracks, spacing: spacing > 0 ? spacing : FALLBACK_TRACK_SPACING_PX };
};

/**
 * Index of the last track whose offset is < `limit`, or 0 when none is.
 *
 * Binary search rather than the obvious scan: this runs on every scroll event, and a
 * mastered library is hundreds of tracks long. Offsets are sorted by construction.
 */
const lastTrackBefore = (tracks: Track[], limit: number): number => {
    let lo = 0;
    let hi = tracks.length - 1;
    let found = 0;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (tracks[mid].offset < limit) {
            found = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return found;
};

export function useScrollStretch(
    listRef: RefObject<HTMLElement | null>,
    options: ScrollStretchOptions = {},
): void {
    const { axis = "y", maxStretchPx = DEFAULT_MAX_STRETCH_PX, enabled = true } = options;

    useEffect(() => {
        const list = listRef.current;
        if (!list || !enabled) return;
        if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

        let scroller = findScroller(list, axis);
        let viewport = viewportOf(scroller, axis); // cached: never read inside a frame

        let tracks: Track[] | null = null;
        let trackSpacing = FALLBACK_TRACK_SPACING_PX;
        let tracksDirty = true; // a rebuild is owed to the next frame (rule D)

        let lastPos = scrollPosOf(scroller, axis); // written by the scroll event only
        /** Scroll position as of the last frame; `lastPos − dragPos` is the frame's real
         *  displacement. Aggregates however many scroll events fired in between. */
        let dragPos = lastPos;

        /** How far the fabric is currently pulled, in px, SIGNED by travel direction.
         *  The single piece of state the whole effect is derived from. */
        let drag = 0;
        let appliedDrag = Number.NaN; // `drag` at the last write
        let appliedPos = Number.NaN; // `lastPos` at the last write

        let relaxAcc = 0; // unspent real time owed to the fixed-step decay
        let lastFrameTs = performance.now();
        let rafId: number | null = null;

        /** Elements currently carrying one of our transforms. Kept as a set of
         *  ELEMENTS rather than an index range so it survives a track rebuild, after
         *  which indices mean something different but the DOM nodes do not. */
        const painted = new Set<HTMLElement>();

        /** Drop our transform (and the compositor hint) from one element. */
        const unpaint = (el: HTMLElement) => {
            el.style.transform = "";
            el.style.willChange = "";
        };

        const clearTransforms = () => {
            for (const el of painted) unpaint(el);
            painted.clear();
        };

        /** Re-resolve the scroller. Costs a `getComputedStyle` walk, so it is only
         *  called off the hot path: at mount, on a window resize, and once the fabric
         *  has settled — a list can be re-parented between scrollers (the decks body
         *  renders in both a page and a sheet variant), and a container that only
         *  becomes a scroller later must still be picked up. */
        const resolveScroller = () => {
            const next = findScroller(list, axis);
            if (next !== scroller) {
                scroller.removeEventListener("scroll", onScroll);
                scroller = next;
                scroller.addEventListener("scroll", onScroll, { passive: true });
                lastPos = scrollPosOf(scroller, axis);
                dragPos = lastPos; // the old delta is in the old scroller's coordinates
                tracksDirty = true; // and so are the offsets
            }
            viewport = viewportOf(scroller, axis);
        };

        const apply = (anchorPos: number) => {
            if (!tracks || tracks.length === 0) return;

            // Rule B — only the band that can actually be seen is written. The band is
            // derived from the CACHED position and viewport, so this costs no DOM read.
            const first = lastTrackBefore(tracks, lastPos - BAND_OVERSCAN_PX);
            const last = lastTrackBefore(tracks, lastPos + viewport + BAND_OVERSCAN_PX);

            // How far the sheet is opened in total, in px: the rubber band applied to the
            // drag. Direction-free — the SHAPE below decides which way each card moves —
            // which is what makes the two scroll directions behave identically instead of
            // one stretching and the other squeezing.
            const amount = rubberBand(Math.abs(drag), maxStretchPx, DRAG_AT_HALF_STRETCH_PX);

            for (let i = first; i <= last; i++) {
                const track = tracks[i];
                // Signed distance from the anchor, in cards. Continuous in the track's own
                // layout offset, so it slides rather than stepping and is unchanged by a
                // rebuild that renumbers the array.
                const along = (track.offset - anchorPos) / trackSpacing;
                // Monotone in `along` by construction, so EVERY neighbouring pair moves
                // apart: the sheet is pinned at the anchor and spreads away from it on
                // both sides. No fold, no direction case.
                const shift = amount * spreadProfile(along);
                // Rule C — an invisible delta is not worth a style write.
                if (Math.abs(shift - track.written) < WRITE_EPS_PX) continue;
                track.written = shift;
                const transform =
                    axis === "y"
                        ? `translate3d(0, ${shift.toFixed(2)}px, 0)`
                        : `translate3d(${shift.toFixed(2)}px, 0, 0)`;
                for (const el of track.els) {
                    if (!painted.has(el)) {
                        // Promote only while the element is in the band and moving. The
                        // band is a handful of rows, so this stays a bounded number of
                        // layers rather than one per card in the library.
                        el.style.willChange = "transform";
                        painted.add(el);
                    }
                    el.style.transform = transform;
                }
            }
        };

        /**
         * Clear every element that our band no longer covers.
         *
         * Split out of `apply` and run only when the band's edges MOVE (a scroll), not
         * on every relax frame: while the fabric is closing the band is stationary and
         * there is nothing to evict, so the common case costs one integer comparison.
         */
        let paintedFirst = -1;
        let paintedLast = -1;
        const evictOutsideBand = () => {
            if (!tracks || tracks.length === 0) return;
            const first = lastTrackBefore(tracks, lastPos - BAND_OVERSCAN_PX);
            const last = lastTrackBefore(tracks, lastPos + viewport + BAND_OVERSCAN_PX);
            if (first === paintedFirst && last === paintedLast) return;
            const keep = new Set<HTMLElement>();
            for (let i = first; i <= last; i++) for (const el of tracks[i].els) keep.add(el);
            for (const el of painted) {
                if (keep.has(el)) continue;
                unpaint(el);
                painted.delete(el);
            }
            paintedFirst = first;
            paintedLast = last;
        };

        const frame = () => {
            const now = performance.now();

            // ── The drag. Real displacement in, exponential decay out; no differentiation
            // anywhere, which is why this needs no smoothing and has no idle threshold.
            drag += (lastPos - dragPos) * DRAG_GAIN;
            dragPos = lastPos;
            relaxAcc = Math.min(relaxAcc + (now - lastFrameTs), MAX_FRAME_MS);
            lastFrameTs = now;
            while (relaxAcc >= RELAX_STEP_MS) {
                drag *= DRAG_RELAX_PER_STEP;
                relaxAcc -= RELAX_STEP_MS;
            }

            // ── Read phase (rule D): the ONE place per frame that may touch layout,
            // and only when the DOM actually changed under us.
            if (tracksDirty) {
                const built = buildTracks(list, scroller, axis);
                tracks = built.tracks;
                trackSpacing = built.spacing;
                tracksDirty = false;
                paintedFirst = paintedLast = -1; // band indices refer to the old tracks
                // Elements that survived the rebuild keep their transform (no flicker);
                // ones that did not are detached and cost nothing. `painted` is pruned
                // by the eviction pass below. Their shifts do not jump, because `along`
                // is measured in layout coordinates rather than array indices.
            }

            // The held point: the TRAILING edge of travel — the top/left of the viewport
            // when scrolling forward, the bottom/right when scrolling back. Keyed on the
            // sign of `drag` rather than on an instantaneous scroll direction, so the
            // switch can only happen at the moment every shift is zero (see the header).
            const anchorPos = drag >= 0 ? lastPos : lastPos + viewport;

            // ── Write phase. Skipped entirely when neither the drag nor the scroll
            // position moved enough to be seen (rule C).
            if (Math.abs(drag - appliedDrag) >= WRITE_EPS_PX || lastPos !== appliedPos) {
                evictOutsideBand();
                apply(anchorPos);
                appliedDrag = drag;
                appliedPos = lastPos;
            }

            if (Math.abs(drag) < SETTLE_DRAG_PX) {
                drag = 0;
                appliedDrag = Number.NaN;
                appliedPos = Number.NaN;
                clearTransforms();
                if (tracks) for (const t of tracks) t.written = Number.NaN;
                paintedFirst = paintedLast = -1;
                rafId = null;
                // The scroll is over, so a style flush is free now. This is where a
                // re-parented list picks up its new scroller.
                resolveScroller();
                return;
            }
            rafId = requestAnimationFrame(frame);
        };

        const start = () => {
            if (rafId === null) {
                // The loop parks when the fabric settles, so `lastFrameTs` can be minutes
                // stale; restarting from it would hand the decay one huge step. `dragPos`
                // is deliberately NOT reset — the movement that woke us is real drag.
                lastFrameTs = performance.now();
                relaxAcc = 0;
                rafId = requestAnimationFrame(frame);
            }
        };

        function onScroll() {
            // Cheap read, and the ONLY scroll-position read in the hook: every later
            // consumer (band, anchor, drag) uses this cached value instead of asking the
            // DOM again after we have written transforms (rule A).
            lastPos = scrollPosOf(scroller, axis);
            start();
        }

        scroller.addEventListener("scroll", onScroll, { passive: true });

        // The cached offsets survive our own writes (transforms don't relayout) but not
        // a real DOM change: windowed rows swapping in, a page of results appending, or
        // the grid being resized all invalidate them.
        //
        // ⚠️ These callbacks only set a FLAG. They must not measure, must not clear
        // transforms, and must not re-resolve the scroller: a windowed grid fires a
        // childList mutation on nearly every scroll frame, and doing any of that here
        // put a forced style/layout flush directly in the scroll path (rule D).
        const invalidate = () => {
            tracksDirty = true;
            start(); // a mutation while idle still needs one frame to re-measure
        };
        const mutationObserver = new MutationObserver(invalidate);
        mutationObserver.observe(list, { childList: true });
        const resizeObserver = new ResizeObserver(invalidate);
        resizeObserver.observe(list);

        // A window resize changes the viewport we cache and can change which ancestor
        // scrolls; it never happens mid-fling, so the style flush is affordable.
        const onResize = () => {
            resolveScroller();
            tracksDirty = true;
        };
        window.addEventListener("resize", onResize);

        return () => {
            scroller.removeEventListener("scroll", onScroll);
            window.removeEventListener("resize", onResize);
            mutationObserver.disconnect();
            resizeObserver.disconnect();
            if (rafId !== null) cancelAnimationFrame(rafId);
            clearTransforms();
        };
    }, [listRef, axis, maxStretchPx, enabled]);
}

export default useScrollStretch;
