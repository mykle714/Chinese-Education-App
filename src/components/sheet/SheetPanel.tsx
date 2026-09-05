import React, { useCallback, useRef, useState, useLayoutEffect, useEffect, useImperativeHandle, forwardRef } from "react";
import { createPortal } from "react-dom";
import { Box } from "@mui/material";
import { useDrag } from "@use-gesture/react";
import { EicScrim, InfoSheetContainer, InfoSheetGrabber, SheetMergeHeaderSlot } from "./sheetStyled";
import PageHeader from "../PageHeader";
import { SAFE_TOP } from "../../theme/safeArea";
import { useHideFooter } from "../../hooks/useHideFooter";
import { nearestOverlayHost } from "../overlayHost";

// Imperative handle exposing the gesture-root wrapper and the inner scrollable
// container of whatever body a SheetPanel renders. SheetPanel attaches its
// touch listeners to `root` (so swipes anywhere on the panel feed the
// resize/scroll coupling) and reads `scroll.scrollTop` to decide between
// growing the sheet and letting native scroll take over. `scroll` must carry
// `touch-action: pan-y` + `overscroll-behavior: contain`: SheetPanel cancels only
// the touchmoves it converts into a RESIZE, and leaves scroll gestures to the
// browser so they run on the compositor.
export interface SheetPanelBodyHandle {
    root: HTMLDivElement | null;
    scroll: HTMLDivElement | null;
}

// Imperative handle exposed by SheetPanel so the parent can read the panel's
// live height when opening a child panel that should match it.
export interface SheetPanelHandle {
    getCurrentHeight: () => number | null;
}

interface SheetPanelProps {
    // Called once the dismiss animation has finished, so the host can unmount
    // the panel. OPTIONAL: a PERSISTENT panel (minHeight > 0) never dismisses,
    // so it has nothing to report. See the minHeight prop below.
    onClose?: () => void;
    // Resting FLOOR height in px. 0 (default) = the modal eip behaviour: the
    // panel can be dragged all the way down and that dismisses it.
    // > 0 makes the panel PERSISTENT page furniture (the /decks sheet): it
    // opens at this height, can never be dragged below it, and never closes.
    // The two resting stops become {minHeight, max} — there is no middle stop,
    // because a permanent sheet's "closed" state IS its floor.
    minHeight?: number;
    // Render the dimming scrim behind the sheet (default true). A persistent
    // sheet passes false: it is always on screen, so a scrim would darken the
    // page permanently and would have nothing to dismiss to on tap.
    showScrim?: boolean;
    // When provided, panel animates 0 → initialHeight on open instead of
    // 0 → natural-content height. Used by child panels stacked on top of a
    // parent so they appear at the same vertical extent.
    initialHeight?: number | null;
    // Stack depth (0 = root panel). Bumps z-index so child panels and their
    // scrims render above their parent.
    depth?: number;
    // Ref attached to the body content; exposes the gesture root + scroll
    // element so SheetPanel can wire its resize/scroll coupling.
    bodyRef: React.RefObject<SheetPanelBodyHandle | null>;
    // Identity for whatever component is currently mounted inside `children`
    // (e.g. "info" vs "compare"). SheetPanel is a single persistent instance
    // that can host different body components across its lifetime without
    // remounting itself, so a plain empty-deps effect can't tell the root/scroll
    // DOM nodes behind bodyRef changed. Bump this whenever the mounted body
    // swaps so the scroll-coupling effect below re-binds to the new nodes.
    bodyKey?: string | number;
    // Children can be a plain node or a render function that receives the
    // header-drag binder so an inner element (e.g. the EIP entry header) can
    // share the grabber's drag-to-resize gesture. useDrag's filterTaps option
    // keeps proper taps on header icons working.
    children: React.ReactNode | ((api: { bindHeaderDrag: ReturnType<typeof useDrag> }) => React.ReactNode);
    // Where, between the lower stop and the max, a release stops springing back
    // up and collapses instead. 0.5 (default) = the midpoint rule: whichever
    // stop is nearer wins. A SMALLER value makes the panel collapse from a much
    // lower height — the sheet has to be pulled most of the way down before it
    // will spring back up, so a partial pull-down reads as "close it". Only the
    // {lower stop, max} choice is affected; a modal panel's dismiss floor (its
    // default height) is untouched.
    collapseThresholdRatio?: number;
    // Optional row rendered above the grabber (e.g. entry-tabs strip). Rendered
    // inside a drag-to-resize zone bound to bindHeaderDrag so a vertical drag
    // started on the entry tabs resizes the sheet just like the grabber/header
    // (this strip sits outside `root`, so the raw touch listeners don't reach
    // it — useDrag is the only path). useDrag's filterTaps keeps tab-selection
    // and the close-tab taps working.
    tabStrip?: React.ReactNode;
    // Title for the MERGE HEADER — the page-style header that grows in over the last
    // MERGE_ZONE_PX of travel, once the sheet is tall enough to have covered the host
    // page's own header. It is a real PageHeader (size "node", chevron-down), so a
    // merged sheet wears the app's one header rather than a lookalike, and its chevron
    // dismisses the sheet: at full height the scrim is completely covered, so the
    // tap-to-close target that used to live in the 8% gap has to come back somewhere.
    //
    // Omitting it is allowed but discouraged for a modal sheet — the sheet still grows
    // to full height, it just does so with no way out but a downward drag.
    title?: string;
    // How the `title` header behaves.
    //  • "merge" (default) — it is MERGE chrome: clipped to zero and interpolated in over
    //    the last MERGE_ZONE_PX, so it appears only as the sheet becomes the whole screen.
    //    Right for a sheet whose body carries its own identity (the eip's entry header
    //    names the word; the /decks sheet's body names the set).
    //  • "always" — the header is ordinary sheet furniture, at full height from the moment
    //    the sheet opens, and the merge stops touching it (only the corners, shadow and top
    //    padding still interpolate). Right for a sheet whose body has NO title row of its
    //    own — the compare sheet, whose first row is two word slots — because the sheet then
    //    says what it is and offers a labelled close at every height, not just at the top of
    //    its travel. The grabber stays above it, so the resize affordance is unchanged.
    headerMode?: "merge" | "always";
}

// ---------------------------------------------------------------------------
// Geometry + motion constants
// ---------------------------------------------------------------------------

// Sheet height as a fraction of the parent (the FRAME — see the portal note in the
// component: the sheet is hosted at frame level, not inside the page's content area).
//
// The cap is 1: a fully-grown sheet is exactly as tall as the screen. It used to be
// 0.92, and that 8% strip of visible scrim was doing two jobs — it said "there is a
// page behind this" and it was the tap-to-dismiss target. At 1 both are gone, which is
// why growing into the last MERGE_ZONE_PX also MERGES the sheet's chrome into the
// page's: the corners flatten, the shadow drops and a real header (title + close
// chevron) grows in, so a maxed sheet reads as the whole screen rather than as a sheet
// whose top edge fell off. See writeMergeChrome.
const MAX_HEIGHT_RATIO = 1;
const DEFAULT_HEIGHT_RATIO = 0.6;

// The last slice of travel below the cap, over which the sheet stops looking like a
// sheet and starts looking like a page. Everything in writeMergeChrome interpolates
// linearly across it, so the merge is a continuous function of the finger's position —
// not a state flip at a threshold, which would pop mid-drag.
const MERGE_ZONE_PX = 64;
// Chrome the merge dissolves. Both MUST match InfoSheetContainer's own values in
// styled.ts — they are the "unmerged" end of the interpolation.
const SHEET_CORNER_RADIUS_PX = 20;
const SHEET_TOP_PADDING_PX = 10;
// Fallback for the merge header's height, used only if it cannot be measured on mount.
const MERGE_HEADER_FALLBACK_PX = 52;

// Base stacking for the portaled scrim + sheet. Both are hosted at FRAME level now
// (see the portal note), so they no longer compete with their page's content area —
// they compete with the page's top-level layers, and those go high: the scp lifts its
// draggable cards to 1000 and its eip host to 1100. Chosen below MUI's modal layer
// (1300) so a real Dialog still covers the sheet.
const SCRIM_BASE_Z_INDEX = 1200;
const SHEET_BASE_Z_INDEX = 1201;

// Duration of every snap/dismiss animation.
const SNAP_DURATION_MS = 220;

// Scrim fade. IN is a mount-time keyframe on EicScrim itself (`eicScrimIn`); OUT is
// driven from here, because only this component knows a dismiss has begun. The out
// duration matches the sheet's own shrink so the dim and the sheet leave together —
// the scrim used to stay fully lit for the whole shrink and then vanish in one frame.
const SCRIM_FADE_OUT_MS = SNAP_DURATION_MS;

// Multiplier applied to every vertical delta that resizes the sheet (grabber /
// tab-strip drag, touch resize, wheel resize, and release momentum — which
// inherits the scaling through applyResize). >1 makes the panel travel further
// than the finger for the same gesture; 1 is 1:1 tracking. Content scrolling is
// deliberately NOT scaled — only the resize path — so scrolling still feels
// native.
const RESIZE_SENSITIVITY = 1.1;

// Release velocity is measured over the most recent slice of the gesture, not
// over its whole life, so a slow drag that ends in a quick flick still flings.
// A release that lands more than this long after the last move is treated as a
// stationary release (velocity 0) — the finger was resting when it lifted.
const VELOCITY_WINDOW_MS = 90;

// Below this release speed (px/ms) there is no fling — the sheet just snaps.
const FLING_MIN_VELOCITY = 0.05;
// Momentum ends once it decays below this speed (px/ms).
const MOMENTUM_MIN_VELOCITY = 0.02;
// Per-frame decay, expressed at 60fps and rescaled by the real frame time.
const MOMENTUM_DECAY_PER_FRAME = 0.95;
// Frame-time cap for momentum integration. A long frame (GC, a heavy re-render,
// an app switch) must not teleport the sheet or nuke the velocity in one step —
// which is exactly how a fling used to "lose its momentum" on a janky frame.
const MOMENTUM_MAX_FRAME_MS = 32;

// Tolerance (px) for "the sheet is already at its maximum height". The height
// we write is fractional (parentHeight * MAX_HEIGHT_RATIO) and the height we
// read back via getBoundingClientRect() is snapped to the device pixel grid, so
// a maxed sheet routinely measures a hundredth of a pixel SHORT of the cap. An
// exact `h < maxHeight()` test therefore reads that as "still room to grow" and
// locks the gesture into "resize" — where the first move is instantly absorbed
// by the boundary and, because the mode lock is deliberately one-way, the
// content can never be scrolled again once the sheet is maxed. Comparing with
// this slack keeps a genuinely-maxed sheet in "scroll".
const AT_MAX_EPSILON_PX = 1;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Shared snap rule used by every release path (grabber drag, touch release,
// momentum decay): below default → dismiss (0); at or above it → the lower
// stop if the sheet sits below `collapseRatio` of the way up to the max,
// otherwise the max. The default height is the floor — there is no resting
// stop between 0 and it.
//
// `collapseRatio` of 0.5 is the plain nearest-stop rule; anything smaller moves
// the collapse point DOWN, so the sheet keeps springing open until it has been
// pulled well past halfway.
//
// A PERSISTENT panel (minH > 0) has no dismiss stop at all: `defaultH` IS
// `minH`, nothing can go below it, so the rule degrades to "collapse to minH or
// grow to max" via the same comparison.
function computeSnapTarget(h: number, defaultH: number, maxH: number, minH: number, collapseRatio: number): number {
    if (h < defaultH && minH === 0) return 0;
    const collapseBelow = defaultH + (maxH - defaultH) * collapseRatio;
    return h < collapseBelow ? defaultH : maxH;
}

// Module-level set of currently mounted panel depths. The window-level wheel
// listener installed by each panel checks this set so only the top-most depth
// reacts to a given gesture (touch is already top-only via DOM hit-testing).
const mountedDepths = new Set<number>();

const SheetPanel = forwardRef<SheetPanelHandle, SheetPanelProps>(({
    onClose,
    initialHeight,
    minHeight = 0,
    showScrim = true,
    depth = 0,
    bodyRef,
    bodyKey,
    collapseThresholdRatio = 0.5,
    children,
    tabStrip,
    title,
    headerMode = "merge",
}, ref) => {
    const sheetContainerRef = useRef<HTMLDivElement | null>(null);
    const scrimRef = useRef<HTMLDivElement | null>(null);
    // Rendered IN PLACE (and never painted) purely so the host walk below has a node to
    // start from: both the scrim and the sheet are portaled away, so without it there
    // would be nothing of this component left in the page's DOM to locate.
    const anchorRef = useRef<HTMLDivElement | null>(null);
    // Wrapper around the merge header. Its height/opacity are written imperatively for
    // the same reason the sheet's height is (see the height-model note) — one style
    // write per frame instead of a re-render of the whole body.
    const mergeHeaderRef = useRef<HTMLDivElement | null>(null);
    const mergeHeaderHeightRef = useRef(MERGE_HEADER_FALLBACK_PX);
    // Last merge ratio written, so a frame that does not change it writes no styles.
    const lastMergeRef = useRef(-1);

    // ---- Where the scrim mounts -------------------------------------------
    // The scrim is `position: absolute; inset: 0`, so it dims exactly its nearest
    // positioned ancestor — which, rendered in place, is the HOST PAGE's content area
    // (flp's `ContentArea`). That left the page's own header (and anything else outside
    // the content area) undimmed, so a modal sheet only darkened part of the screen.
    //
    // So it is PORTALED out — but NOT unconditionally to the phone frame. It goes to
    // `nearestOverlayHost` (src/components/overlayHost.ts): the nearest ancestor that both fills the screen and
    // shares the SHEET's stacking context. Getting that wrong inverts the paint order,
    // and the scrim ends up dimming the sheet it is supposed to be behind — which is
    // exactly what happened on the cdp, whose `NodePage` `Surface` carries the page-slide
    // `transform` (see the helper's comment for the mechanism).
    //
    // Whatever host is chosen fills the frame, so the dim still covers the page header.
    // The footer sits at z-index 100 at frame level (FooterPresenter) and stays ABOVE the
    // scrim when the scrim is hosted by the frame — deliberately: it is the frame's
    // furniture, not the page's. Inside a slid page Surface the footer is a sibling of
    // that Surface, so it stays undimmed there too.
    //
    // Resolved in a layout effect (the target is found by walking up from the mounted
    // sheet), so the scrim mounts on the commit after the sheet — still before paint.
    // ---- Where the SHEET mounts (2026-08-30) -------------------------------
    // The sheet is portaled to the SAME host as the scrim, and that is what lets it
    // reach full height. Rendered in place it is `absolute; bottom: 0` against the host
    // PAGE's content box — which starts BELOW the page header (flp's ContentArea, scp's
    // EipHost) and is clipped by MobileTabScreen's ScrollArea — so `parentElement.
    // clientHeight` could never include the header and growing past it would just be
    // cut off. Hosted at frame level, `bottom: 0` is the real bottom edge (scp no
    // longer needs its negative-bottom FOOTER_CLEARANCE trick for this) and
    // `parentHeight` is the whole screen, so MAX_HEIGHT_RATIO = 1 covers everything.
    //
    // The cost is that both layers leave their page's stacking context and now sort
    // against the page's top-level layers — hence SCRIM/SHEET_BASE_Z_INDEX above.
    const [scrimHost, setScrimHost] = useState<HTMLElement | null>(null);
    useLayoutEffect(() => {
        const el = anchorRef.current;
        if (!el) return;
        // A state write in a LAYOUT effect is flushed before paint, so the sheet still
        // mounts in the same frame the host does — no flash of an unportaled sheet.
        setScrimHost(nearestOverlayHost(el));
    }, []);

    // A modal sheet owns the screen for its lifetime, so the floating footer pill —
    // rendered at frame level (FooterPresenter, z-index 100) and outside every page's
    // DOM — must slide away. This used to be each host page's job (scp and cdp both
    // called useHideFooter themselves, and flp/decks had simply never noticed the
    // overlap); now that a sheet can cover the entire screen it is the sheet's own
    // business, and one hold here covers every host. A persistent sheet keeps the
    // footer: it is page furniture that the pill is meant to float over.
    useHideFooter(minHeight <= 0);

    // ---- Height model -----------------------------------------------------
    // The sheet's height is driven IMPERATIVELY (heightRef + a direct write to
    // element.style.height), never through React state. Two reasons:
    //  1. Perf: callers pass `children` as a render function (see
    //     InfoCardSection), so a state update here re-renders the entire eip
    //     body — every touchmove and every momentum frame. Those long frames
    //     were what made flings stutter and die early.
    //  2. Correctness: only one code path owns the height, so a re-render can
    //     never resurrect a stale height mid-gesture.
    // `height` is deliberately absent from the JSX style prop, so React has no
    // record of it and will never overwrite what we write here.
    const heightRef = useRef(0);
    // Height the current grabber drag started from; null until that drag makes
    // its first real movement (see bindHeaderDrag).
    const dragStartHeightRef = useRef<number | null>(null);
    // Parent container height; the cap and the default stop derive from it.
    const parentHeightRef = useRef(0);
    // The height the sheet opens to. Doubles as the middle snap stop and the
    // dismiss floor: any release below this height snaps to 0 instead of
    // springing back up.
    const defaultHeightRef = useRef(0);
    const momentumRafRef = useRef<number | null>(null);
    const dismissTimerRef = useRef<number | null>(null);
    // True from the moment a dismiss animation starts; makes dismiss idempotent
    // and lets input handlers ignore events while the sheet is on its way out.
    const dismissingRef = useRef(false);
    // Latest onClose, read from timers without re-binding them.
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    // A panel with a floor is persistent: it cannot be dismissed, and every
    // path that would have shrunk it to 0 stops at the floor instead.
    const persistent = minHeight > 0;
    const maxHeight = useCallback(() => parentHeightRef.current * MAX_HEIGHT_RATIO, []);
    // Read from gesture handlers bound once per bodyKey, so the live value is
    // used rather than the one captured at bind time.
    const minHeightRef = useRef(minHeight);
    minHeightRef.current = minHeight;
    // Read from settle() without re-binding it when the prop changes.
    const collapseRatioRef = useRef(collapseThresholdRatio);
    collapseRatioRef.current = collapseThresholdRatio;
    // Read through a ref for the same reason as collapseThresholdRatio: writeMergeChrome is
    // a stable callback called from touchmove/momentum frames, so it must not be rebuilt
    // (and its listeners re-bound) just because a prop identity changed.
    const headerModeRef = useRef(headerMode);
    headerModeRef.current = headerMode;

    // Paint the "merging into the page" chrome for a given sheet height. `t` runs 0 → 1
    // across the last MERGE_ZONE_PX below the cap: 0 is a sheet (rounded, shadowed, no
    // header), 1 is a page (square, flat, headed). Everything here is a direct style
    // write, never React state — this runs on every touchmove and every momentum frame,
    // and a re-render at that rate is exactly what the height model exists to avoid.
    const writeMergeChrome = useCallback((h: number, animate: boolean) => {
        const el = sheetContainerRef.current;
        if (!el) return;
        const maxH = parentHeightRef.current * MAX_HEIGHT_RATIO;
        const t = clamp((h - (maxH - MERGE_ZONE_PX)) / MERGE_ZONE_PX, 0, 1);
        // Nothing to paint if the ratio has not moved — and nothing to animate either,
        // so this early-out is safe on the animated path too. It keeps every drag below
        // the merge zone (t stays 0) down to a single style write per frame.
        if (t === lastMergeRef.current) return;
        lastMergeRef.current = t;
        const transition = animate
            ? `border-radius ${SNAP_DURATION_MS}ms ease-out, padding-top ${SNAP_DURATION_MS}ms ease-out`
            : "none";
        const radius = SHEET_CORNER_RADIUS_PX * (1 - t);
        el.style.borderTopLeftRadius = `${radius}px`;
        el.style.borderTopRightRadius = `${radius}px`;
        // "" (not a value) hands the property back to the stylesheet, so the sheet's
        // real shadow token is restored rather than a copy of it frozen here. The
        // shadow is what makes a sheet read as a surface sitting ON the page; a merged
        // sheet IS the page, so it must not cast one.
        el.style.boxShadow = t >= 1 ? "none" : "";
        // Top padding interpolates from the sheet's own 10px to the STATUS-BAR INSET,
        // not to 0. A fully merged sheet IS the page and reaches the top of the screen,
        // and since `viewport-fit=cover` the top of the screen is under the clock — so
        // at t=1 the grabber and the header below it need the same clearance every page
        // header gets (src/theme/safeArea.ts). `env()` cannot be interpolated in JS, so
        // the mix is expressed as a calc the browser evaluates: `SAFE_TOP * t`. On a
        // device with no inset it is 0px and this is exactly the old ramp to 0.
        el.style.paddingTop = `calc(${SHEET_TOP_PADDING_PX * (1 - t)}px + ${SAFE_TOP} * ${t})`;
        // In "always" mode the header is not merge chrome — it is at full height from the
        // start and the merge must not touch it. Only the container's own corners/shadow/
        // padding above still interpolate.
        const header = headerModeRef.current === "always" ? null : mergeHeaderRef.current;
        if (header) {
            header.style.transition = animate
                ? `height ${SNAP_DURATION_MS}ms ease-out, opacity ${SNAP_DURATION_MS}ms ease-out`
                : "none";
            header.style.height = `${mergeHeaderHeightRef.current * t}px`;
            header.style.opacity = `${t}`;
            // Only takes taps once it is fully there: a half-faded close chevron that
            // already swallows taps is worse than one that is not there yet.
            header.style.pointerEvents = t >= 1 ? "auto" : "none";
        }
        return transition;
    }, []);

    // The single writer for the sheet's height. `animate` turns the CSS height
    // transition on for this write and off for every other one — so grabbing a
    // snapping sheet mid-animation immediately returns to 1:1 finger tracking
    // instead of trailing the finger by the snap duration.
    const writeHeight = useCallback((h: number, animate = false) => {
        heightRef.current = h;
        const el = sheetContainerRef.current;
        if (!el) return;
        // The merge chrome rides the SAME transition as the height, so the corners,
        // the shadow and the header arrive exactly when the sheet reaches its stop
        // rather than snapping ahead of it.
        const chromeTransition = writeMergeChrome(h, animate);
        el.style.transition = animate
            ? `height ${SNAP_DURATION_MS}ms ease-out${chromeTransition ? `, ${chromeTransition}` : ""}`
            : "none";
        el.style.height = `${h}px`;
    }, [writeMergeChrome]);

    // Stop any in-flight height animation at exactly the height that is on
    // screen right now, and return it. A gesture must take over from what the
    // user sees, not from an animation's not-yet-reached target. Called on a
    // gesture's first real movement rather than at touch-down, so a plain tap
    // never interrupts the open animation.
    const freezeHeight = useCallback(() => {
        const el = sheetContainerRef.current;
        const h = el ? el.getBoundingClientRect().height : heightRef.current;
        writeHeight(h);
        return h;
    }, [writeHeight]);

    const stopMomentum = useCallback(() => {
        if (momentumRafRef.current !== null) {
            cancelAnimationFrame(momentumRafRef.current);
            momentumRafRef.current = null;
        }
    }, []);

    // Shrink to 0, then unmount. The close fires on a timer rather than
    // transitionend: the duration is ours, and a timer can't be missed if the
    // element is interrupted or the transition never fires.
    const dismiss = useCallback(() => {
        // A persistent panel has no closed state — every would-be dismiss snaps
        // back to the floor instead. This is a safety net: the gesture paths
        // below already refuse to dismiss when `persistent`.
        if (persistent) {
            writeHeight(minHeightRef.current, true);
            return;
        }
        if (dismissingRef.current) return;
        dismissingRef.current = true;
        stopMomentum();
        writeHeight(0, true);
        // Fade the dim out alongside the shrink. Imperative for the same reason the
        // height is (see the height-model note): a state flag here would re-render the
        // entire sheet body — via the `children` render function — on the way out.
        // Killing the mount-time `eicScrimIn` animation first is what lets a transition
        // own the opacity; the element has no opacity of its own, so the computed value
        // falls back to 1 and the transition has a real starting point.
        const scrim = scrimRef.current;
        if (scrim) {
            scrim.style.animation = "none";
            void scrim.offsetWidth; // flush, so the transition starts from 1 rather than coalescing
            scrim.style.transition = `opacity ${SCRIM_FADE_OUT_MS}ms ease-out`;
            scrim.style.opacity = "0";
        }
        dismissTimerRef.current = window.setTimeout(() => {
            dismissTimerRef.current = null;
            onCloseRef.current?.();
        }, SNAP_DURATION_MS + 20);
    }, [persistent, stopMomentum, writeHeight]);

    // The one release rule, shared by every path that ends a gesture (grabber
    // drag release, touch release, momentum decay, momentum hitting a stop).
    const settle = useCallback(() => {
        const target = computeSnapTarget(
            heightRef.current,
            defaultHeightRef.current,
            maxHeight(),
            minHeightRef.current,
            collapseRatioRef.current,
        );
        if (target === 0) {
            dismiss();
            return;
        }
        if (target !== heightRef.current) writeHeight(target, true);
    }, [dismiss, maxHeight, writeHeight]);

    // Grow/shrink by a raw gesture delta (positive = grow). `minH` is the floor
    // for THIS caller: a live finger may drag all the way to 0 (that's how you
    // dismiss), while momentum floors at the default height so a fling can
    // never close the panel on its own. Returns false when the delta was fully
    // absorbed by a boundary, which every caller treats as a hard stop.
    const applyResize = useCallback((rawDy: number, minH: number): boolean => {
        const h = heightRef.current;
        const next = clamp(h + rawDy * RESIZE_SENSITIVITY, minH, maxHeight());
        if (next === h) return false;
        writeHeight(next);
        return true;
    }, [maxHeight, writeHeight]);

    // Play the open animation from 0 → target height on first render. The
    // panel's own open height is a fixed fraction of the parent (screen) height
    // rather than content-measured, so it's consistent across all eip tabs
    // regardless of how much content a given tab renders. Child panels that
    // pass initialHeight still match the parent panel's live height instead.
    useLayoutEffect(() => {
        if (!sheetContainerRef.current) return;
        const parentH = sheetContainerRef.current.parentElement?.clientHeight ?? window.innerHeight;
        parentHeightRef.current = parentH;
        // Measure the merge header's NATURAL height once, from the header element
        // itself rather than its wrapper: the wrapper is clipped to 0 from the first
        // paint, but its child still lays out at full size inside it. Measured rather
        // than hard-coded so the header can change size (PageHeader's title scales,
        // and its padding is a design token) without the merge clipping it.
        const headerEl = mergeHeaderRef.current?.firstElementChild as HTMLElement | null;
        const measured = headerEl?.getBoundingClientRect().height ?? 0;
        if (measured > 0) mergeHeaderHeightRef.current = measured;
        // Resting height on mount, in priority order:
        //   1. explicit initialHeight (a child panel matching its parent's extent)
        //   2. the floor, for a persistent panel — it is already "closed", so
        //      there is no open animation to play and no default stop to grow to
        //   3. the modal default fraction of the screen
        const targetHeight = initialHeight != null
            ? Math.min(initialHeight, parentH * MAX_HEIGHT_RATIO)
            : persistent
                ? Math.min(minHeight, parentH * MAX_HEIGHT_RATIO)
                : parentH * DEFAULT_HEIGHT_RATIO;
        defaultHeightRef.current = targetHeight;
        if (persistent) {
            // Sits at its floor from the first paint — no 0 → height slide.
            writeHeight(targetHeight);
            return;
        }
        // Written before paint, so the sheet never flashes at its natural height.
        writeHeight(0);
        requestAnimationFrame(() => writeHeight(targetHeight, true));
        // Keyed on scrimHost, NOT []: the sheet is portaled, so it is not in the DOM on
        // this component's first commit — it mounts on the commit that resolves the
        // host, and that is the one whose layout can be measured. The guard above makes
        // the first pass a no-op.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scrimHost]);

    // Cancel in-flight work if the panel is unmounted from the outside (e.g.
    // scrim tap, parent state change) while a fling or dismiss is running.
    useEffect(() => () => {
        stopMomentum();
        if (dismissTimerRef.current !== null) window.clearTimeout(dismissTimerRef.current);
    }, [stopMomentum]);

    useImperativeHandle(ref, () => ({
        getCurrentHeight: () => heightRef.current,
    }), []);

    // Drag the grabber / tab strip / entry header to resize the sheet.
    const bindHeaderDrag = useDrag(
        ({ first, last, tap, movement: [, my] }) => {
            // A tap on the header is not a resize gesture — skip the
            // snap-on-release logic so clicking the EIP header doesn't
            // collapse an expanded sheet back to its initial height.
            if (tap || dismissingRef.current) return;
            if (first) {
                stopMomentum();
                dragStartHeightRef.current = null;
            }
            if (dragStartHeightRef.current === null) {
                // Nothing has moved yet — leave any open/snap animation alone.
                if (my === 0) return;
                dragStartHeightRef.current = freezeHeight();
            }
            // Absolute tracking from the gesture's start height (useDrag gives
            // cumulative movement), so the sheet can't drift over a long drag.
            writeHeight(clamp(dragStartHeightRef.current - my * RESIZE_SENSITIVITY, minHeightRef.current, maxHeight()));
            if (last) {
                dragStartHeightRef.current = null;
                settle();
            }
        },
        { axis: "y", filterTaps: true }
    );

    // Couple content scroll to sheet resize, for both wheel (desktop) and touch.
    // Depends on bodyKey so that swapping the mounted body (e.g. info ↔ compare
    // tab) re-binds these listeners to the new root/scroll nodes instead of
    // staying attached to the unmounted previous body.
    useEffect(() => {
        const root = bodyRef.current?.root ?? null;
        const scrollEl = bodyRef.current?.scroll ?? null;
        if (!root || !scrollEl) return;

        mountedDepths.add(depth);
        const isTopmost = () => {
            let max = -Infinity;
            mountedDepths.forEach(d => { if (d > max) max = d; });
            return depth === max;
        };

        // --- Wheel (desktop) ------------------------------------------------
        // deltaY > 0 (scroll down) grows the sheet; deltaY < 0 shrinks it once
        // the content is scrolled to its top. A wheel gesture has no release,
        // so crossing below the default height dismisses immediately rather
        // than waiting for a snap decision.
        const onWheel = (e: WheelEvent) => {
            if (!isTopmost()) return;
            if (dismissingRef.current) {
                e.preventDefault();
                return;
            }
            const dy = e.deltaY;
            // Shrinking is only allowed from the top of the content; otherwise
            // let the content scroll normally.
            if (dy < 0 && scrollEl.scrollTop > 0) return;
            if (!applyResize(dy, minHeightRef.current)) return;
            e.preventDefault();
            if (!persistent && heightRef.current < defaultHeightRef.current) dismiss();
        };

        // --- Touch ----------------------------------------------------------
        // Recent (y, t) samples, trimmed to VELOCITY_WINDOW_MS, used to measure
        // release velocity. Sampling a short window (instead of smoothing the
        // whole gesture) is what makes a quick flick at the end of a slow drag
        // actually fling — the old exponential average dragged the flick's
        // speed down toward the slow motion that preceded it.
        let samples: { y: number; t: number }[] = [];
        let lastTouchY: number | null = null;
        // The mode this gesture is locked into on its first committed move.
        // Once set, the gesture cannot cross over between resizing the panel
        // and scrolling the content — a resize that reaches a boundary is a
        // hard stop; the user must lift and start a fresh gesture to scroll.
        // The release momentum inherits this lock.
        let gestureMode: "resize" | "scroll" | null = null;

        // Signed release speed in px/ms (positive = swipe up = grow), measured
        // across the retained sample window. Returns 0 if the finger was
        // effectively parked when it lifted.
        const releaseVelocity = (endTime: number): number => {
            if (samples.length < 2) return 0;
            const last = samples[samples.length - 1];
            if (endTime - last.t > VELOCITY_WINDOW_MS) return 0;
            const first = samples[0];
            const dt = last.t - first.t;
            if (dt <= 0) return 0;
            return (first.y - last.y) / dt;
        };

        const onTouchStart = (e: TouchEvent) => {
            if (e.touches.length !== 1) return;
            stopMomentum();
            lastTouchY = e.touches[0].clientY;
            samples = [{ y: lastTouchY, t: e.timeStamp }];
            gestureMode = null;
        };

        const onTouchMove = (e: TouchEvent) => {
            if (lastTouchY === null || e.touches.length !== 1 || dismissingRef.current) return;
            const y = e.touches[0].clientY;
            const dy = lastTouchY - y; // positive = finger moved up
            lastTouchY = y;
            samples.push({ y, t: e.timeStamp });
            // Keep the window, but always keep enough samples to measure with.
            while (samples.length > 2 && e.timeStamp - samples[1].t > VELOCITY_WINDOW_MS) samples.shift();

            // Lock the gesture to a single mode on its first committed move:
            // an upward pull grows the sheet while there's room to grow, and
            // only scrolls once the sheet is maxed; a downward pull scrolls
            // while the content is off its top, and only shrinks at the top.
            if (gestureMode === null && dy !== 0) {
                // Take over from the height that is actually on screen — the
                // sheet may still be mid open/snap animation.
                const h = freezeHeight();
                if (dy > 0) gestureMode = h < maxHeight() - AT_MAX_EPSILON_PX ? "resize" : "scroll";
                else gestureMode = scrollEl.scrollTop > 0 ? "scroll" : "resize";
            }
            if (gestureMode === "scroll") {
                // NATIVE SCROLL. We do NOT preventDefault and we do NOT write
                // scrollTop: the body's scroller carries `touch-action: pan-y`, so
                // once this gesture is locked to "scroll" the browser pans it on the
                // COMPOSITOR and gives it a native fling on release.
                //
                // It used to be `scrollEl.scrollTop += dy` inside this non-passive
                // handler, which put the scroll on the main thread — so every frame
                // of it waited on whatever React/layout work the body was doing, and
                // a heavy body (the decks panel: ~470 mini cards, each with a cpcd
                // row that re-measures itself) stuttered badly. The identical card
                // grid on CollectionViewPage never did, because that page scrolls
                // natively. Handing the scroll back is what closes that gap.
                return;
            } else {
                // A live finger may drag all the way down to the floor — 0 for a
                // modal panel (that is the dismiss gesture), the resting height
                // for a persistent one. Hitting a boundary swallows the delta
                // rather than spilling over into a content scroll.
                applyResize(dy, minHeightRef.current);
            }
            e.preventDefault();
        };

        const onTouchEnd = (e: TouchEvent) => {
            // Ignore the lift of a second finger; only the last one releases.
            if (e.touches.length > 0) return;
            const mode = gestureMode;
            const velocity = releaseVelocity(e.timeStamp);
            lastTouchY = null;
            samples = [];
            gestureMode = null;
            if (mode === null || dismissingRef.current) return;

            if (!persistent && mode === "resize" && heightRef.current < defaultHeightRef.current) {
                // Dragged below the default height and released → dismiss.
                // This is the ONLY way a swipe closes the panel; momentum never
                // carries it below the default height (see startMomentum).
                dismiss();
                return;
            }
            // A "scroll" gesture is the browser's now, fling included — running our
            // own rAF momentum on top of a native fling would double-scroll.
            if (mode === "scroll") return;
            if (Math.abs(velocity) < FLING_MIN_VELOCITY) {
                settle();
                return;
            }
            startMomentum(velocity);
        };

        // Release momentum for a RESIZE fling only — the panel keeps growing or
        // shrinking, floored at the DEFAULT height, so a downward fling coasts to
        // the default height and stops there rather than running on into a dismiss;
        // growing stops dead at the max.
        //
        // There is no "scroll" arm any more: a scroll gesture is native (see
        // onTouchMove), so the browser owns its inertia too. Inertia still cannot
        // cross between the two, because the gesture's mode is locked on its first
        // committed move and only the resize arm reaches this function.
        const startMomentum = (initialVelocity: number) => {
            let v = initialVelocity;
            let lastFrame = performance.now();
            const step = (now: number) => {
                momentumRafRef.current = null;
                // Cap the integration step so one janky frame can't teleport the
                // sheet or wipe out the whole fling.
                const dt = Math.min(now - lastFrame, MOMENTUM_MAX_FRAME_MS);
                lastFrame = now;
                const dy = v * dt;
                // Momentum floors at the default height — the fling stops there
                // instead of running on into a dismiss.
                if (!applyResize(dy, defaultHeightRef.current)) {
                    settle();
                    return;
                }
                v *= Math.pow(MOMENTUM_DECAY_PER_FRAME, dt / 16);
                if (Math.abs(v) < MOMENTUM_MIN_VELOCITY) {
                    settle();
                    return;
                }
                momentumRafRef.current = requestAnimationFrame(step);
            };
            momentumRafRef.current = requestAnimationFrame(step);
        };

        window.addEventListener("wheel", onWheel, { passive: false });
        root.addEventListener("touchstart", onTouchStart, { passive: false });
        root.addEventListener("touchmove", onTouchMove, { passive: false });
        root.addEventListener("touchend", onTouchEnd);
        root.addEventListener("touchcancel", onTouchEnd);
        return () => {
            stopMomentum();
            mountedDepths.delete(depth);
            window.removeEventListener("wheel", onWheel);
            root.removeEventListener("touchstart", onTouchStart);
            root.removeEventListener("touchmove", onTouchMove);
            root.removeEventListener("touchend", onTouchEnd);
            root.removeEventListener("touchcancel", onTouchEnd);
        };
        // `scrimHost` is in the deps alongside bodyKey, and it is load-bearing: the
        // sheet (and therefore the body behind bodyRef) is portaled, so it does not
        // exist on this component's first commit — this effect would find a null root,
        // bail, and never run again, leaving the panel with no touch handlers at all.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bodyKey, scrimHost]);

    // Both layers are portaled to the frame-level host, so their z-indexes are always
    // stated here (the stylesheet's 10/11 only ever applied while they were rendered
    // inside their page). `depth * 2` keeps a stacked child panel and its scrim above
    // their parent's pair.
    const stackZ = depth * 2;
    const scrimStyle: React.CSSProperties = { zIndex: SCRIM_BASE_Z_INDEX + stackZ };
    // NOTE: no `height` key here on purpose — height is owned imperatively by
    // writeHeight (see the height-model comment above). Same for the merge chrome
    // (border radius, top padding, shadow) — writeMergeChrome owns those.
    const sheetStyle: React.CSSProperties = { zIndex: SHEET_BASE_Z_INDEX + stackZ };

    return (
        <>
            {/* Never painted — see anchorRef. */}
            <Box ref={anchorRef} className="mobile-demo-eic-anchor" sx={{ display: "none" }} />
            {showScrim && scrimHost && createPortal(
                <EicScrim
                    ref={scrimRef}
                    className="mobile-demo-eic-scrim"
                    // Routed through `dismiss` rather than straight to `onClose`: the tap
                    // now plays the same shrink-and-fade every other close path plays,
                    // instead of making the sheet and its dim disappear in one frame.
                    onClick={dismiss}
                    style={scrimStyle}
                />,
                scrimHost,
            )}
            {scrimHost && createPortal(
            <InfoSheetContainer
                ref={sheetContainerRef}
                className="mobile-demo-eic-sheet"
                style={sheetStyle}
            >
                {/* Draggable zone: grabber pill only. Header/tabs are outside
                    this zone so taps on header icons aren't captured by useDrag.

                    FIRST flex child, above the merge header: while the sheet is
                    unmerged the header slot is clipped to zero height, so the pill
                    reads as the sheet's top edge either way — but once the sheet
                    merges, the grabber stays above the page header instead of being
                    pushed under it, keeping the resize affordance at the very top of
                    a maximized panel. */}
                <Box
                    className="mobile-demo-eic-drag-zone"
                    {...bindHeaderDrag()}
                    sx={{ touchAction: "none", userSelect: "none", display: "flex", justifyContent: "center", padding: "4px 0 8px" }}
                >
                    <InfoSheetGrabber className="mobile-demo-drag-handle" />
                </Box>
                {/* MERGE HEADER — the app's real PageHeader, clipped to zero height
                    until the sheet grows into the merge zone and then interpolated in
                    by writeMergeChrome. It sits under the grabber, so everything below
                    it is pushed down by exactly as much header as is currently showing;
                    nothing has to reserve space for it.

                    Chevron DOWN, not a back arrow: this dismisses the sheet in the
                    direction a drag would, and it is the only close affordance left
                    once the sheet covers the scrim.

                    `headerMode="always"` opts out of the clipping entirely (see the prop):
                    the header is then ordinary sheet furniture at every height.

                    ⚠️ This is a REAL PageHeader, and PageHeader renders the minute-points
                    flame unconditionally — which runs a 1-second accrual tick. An open
                    titled sheet therefore adds a second tick on top of its page's own
                    header. It cannot over-credit (the server claims a 59-second cooldown
                    atomically, UserDAL.claimMinutePointIncrement), but see PageHeader's
                    "exactly one PageHeader on an earning page" note before adding more. */}
                {title && (
                    <SheetMergeHeaderSlot
                        ref={mergeHeaderRef}
                        className="mobile-demo-eic-merge-header"
                        // "always": undo the slot's clipped-to-zero resting state right here
                        // rather than by writing styles after mount — the header must be
                        // there on the FIRST paint, and writeMergeChrome's early-out (`t`
                        // unchanged) means the first write at t=0 does nothing at all.
                        style={
                            headerMode === "always"
                                ? { height: "auto", opacity: 1, pointerEvents: "auto" }
                                : undefined
                        }
                    >
                        <PageHeader
                            title={title}
                            size="node"
                            arrowDirection="down"
                            onBack={dismiss}
                            // The status-bar clearance is carried by the SHEET's own
                            // top padding (writeMergeChrome), which ramps it in with
                            // the merge — the header must not add it a second time.
                            // It also keeps the measured `mergeHeaderHeightRef` a
                            // plain px number, free of any `env()` term.
                            safeAreaTop={false}
                        />
                    </SheetMergeHeaderSlot>
                )}
                {/* Entry-tabs strip (optional) sits between the grabber and the
                    entry header so it reads as part of the panel chrome. Wrapped
                    in a drag zone so vertical drags started on the entry tabs
                    resize the sheet; filterTaps keeps tab taps working. */}
                {tabStrip && (
                    <Box
                        className="mobile-demo-eic-tabstrip-drag-zone"
                        {...bindHeaderDrag()}
                        sx={{ touchAction: "none" }}
                    >
                        {tabStrip}
                    </Box>
                )}
                {typeof children === "function" ? children({ bindHeaderDrag }) : children}
            </InfoSheetContainer>,
            scrimHost,
            )}
        </>
    );
});

SheetPanel.displayName = "SheetPanel";

export default SheetPanel;
