import React, { useCallback, useRef, useState, useLayoutEffect, useEffect, useImperativeHandle, forwardRef } from "react";
import { createPortal } from "react-dom";
import { Box } from "@mui/material";
import { useDrag } from "@use-gesture/react";
import { EicScrim, InfoSheetContainer, InfoSheetGrabber, SheetHeaderSlot } from "./sheetStyled";
import PageHeader from "../PageHeader";
import SheetCloseX from "./SheetCloseX";
import MinutePointsFireBadge from "../../minutePoints/MinutePointsFireBadge";
import { SAFE_TOP } from "../../theme/safeArea";
import { claimThemeColor } from "../../hooks/useThemeColor";
import { frameOverlayHost, nearestOverlayHost } from "../overlayHost";
import { useKeyboardInset } from "../../features/beginnerKeyboard/useKeyboardInset";

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

// The TELESCOPE (opt-in; the eip's upper panel — docs/EIP_SHEET_GESTURES.md § Telescope).
// A host passes a ref to these three nodes and SheetPanel drives `frame`'s height from the
// sheet's own height, on the same write and the same transition:
//
//   sheet h   0 ──────────────▶ default (open) height ──────────────▶ max
//   frame     0 ──── linear ───▶ rest              ──── linear ───▶ rest + extra
//
// where `rest` = content's natural height minus `extra`'s, i.e. the panel without the row
// that only a maximized sheet shows (the eip's "More Info" title). `frame` must clip
// (overflow hidden) and bottom-anchor `content` (flex-end), so a short frame shows the
// BOTTOM of the panel and growing reveals the top. Both heights are measured by a
// ResizeObserver, never read in the per-frame write.
//
// The same write publishes the reveal on `frame` as two CSS custom properties, for content
// that must CROSSFADE with the `extra` row rather than just be clipped by it (the eip's
// trail-row caret, which hands over to the title row's caret as the title arrives):
//   --sheet-telescope-t           0 at/below the open height → 1 at max (extra's reveal)
//   --sheet-telescope-transition  the write's own duration ("0ms" while dragging), so a
//                                 `transition: … var(--sheet-telescope-transition)` rides
//                                 the snap exactly and tracks the finger 1:1 otherwise.
export interface SheetTelescopeHandle {
    frame: HTMLElement | null;
    content: HTMLElement | null;
    extra: HTMLElement | null;
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
    // Open height as a FRACTION of the frame (default DEFAULT_HEIGHT_RATIO, 0.6). Unlike
    // `initialHeight` (a px value copied from a parent panel) this is a host's standing
    // choice of how tall its sheet opens — the Dictionary page opens at 0.8. It is also
    // the RESTING STOP: on the way down the sheet clips back to this height (release
    // snap, and a downward fling's momentum floor), and only a drag below it dismisses.
    // Ignored when `initialHeight` is given or the panel is persistent (minHeight > 0).
    defaultHeightRatio?: number;
    // Re-open ALREADY at this height, with no 0 → height animation and no scrim fade-in:
    // the sheet as it was when the learner left the page, for a Back restore
    // (src/features/flashcards/backRestore.ts). Unlike `initialHeight` it does NOT move the
    // resting stop — the default stop is still the usual fraction of the screen, so a
    // sheet restored at full height still collapses to the normal height, not to the
    // restored one. Read on MOUNT only; clamped to [default stop, max].
    restoreHeight?: number | null;
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
    // `requestClose` is the ✕'s own action (honours `onCloseX`, then dismisses) for a host
    // that draws its ✕ itself. `dismiss` closes the panel outright, skipping `onCloseX` —
    // the eip's down caret, which closes the whole panel rather than popping a word.
    children: React.ReactNode | ((api: {
        bindHeaderDrag: ReturnType<typeof useDrag>;
        requestClose: () => void;
        dismiss: () => void;
    }) => React.ReactNode);
    // Where, between the lower stop and the max, a release stops springing back
    // up and collapses instead. 0.5 (default) = the midpoint rule: whichever
    // stop is nearer wins. A SMALLER value makes the panel collapse from a much
    // lower height — the sheet has to be pulled most of the way down before it
    // will spring back up, so a partial pull-down reads as "close it". Only the
    // {lower stop, max} choice is affected; a modal panel's dismiss floor (its
    // default height) is untouched.
    collapseThresholdRatio?: number;
    // Tap handler for the sheet's ✕ (SheetCloseX, top-right of the chrome). Optional:
    // with nothing passed the ✕ simply dismisses the sheet.
    //
    // Return TRUE to say "handled — keep the sheet open". That is the eip's case: its ✕
    // pops the SHOWING WORD off the breadcrumb trail, and only popping the root ends the
    // panel, so the eip hosts return false at the root and SheetPanel dismisses exactly
    // when the trail ran out. Returning true/void from a handler that did nothing would strand the user
    // in a panel whose only close affordance no longer closes.
    onCloseX?: () => boolean | void;
    // Whether to draw the ✕ at all. Defaults to "yes, unless the panel is PERSISTENT" —
    // a panel with a floor (the /decks sheet) has no closed state to offer, and a ✕ that
    // collapses a sheet to its floor is not a close.
    showClose?: boolean;
    // Draw the minute-points flame to the LEFT of the ✕. Passed by the STUDY SURFACES
    // eip sheets (flp, scp, cdp — the minute-eligible pages of src/constants.ts) and
    // NEVER by pull-up dictionary flows (CompareSheet, NotebookWordPickerSheet), because a sheet
    // covers its page's header and takes the page's own flame with it: without this the
    // one indicator that says "your time is counting" disappears exactly while the
    // learner is reading a definition, which IS study time.
    //
    // ⚠️ It mounts a second `useMinutePoints` (one accrual tick per instance) alongside
    // the host page's header. That is the same cost the merge header used to pay for its
    // own flame — which is now off (PageHeader `showFlame={false}` below), so the count of
    // live flames on a study surface is unchanged. It cannot over-credit: the server
    // claims each increment atomically under a 59s cooldown (UserDAL.claimMinutePointIncrement).
    showMinutePoints?: boolean;
    // Title for the panel's HEADER — a real `PageHeader` (size "node"), present at every
    // height from the moment the sheet opens, so a panel says what it is whether it is a
    // 60% sheet or the whole screen. It also OWNS THE CLOSE CLUSTER (the ✕ and, on study
    // surfaces, the minute-points flame), which used to live in the grabber row above and
    // slide between rows as the sheet grew.
    //
    // It used to be MERGE chrome — clipped to zero and interpolated in over the last
    // MERGE_ZONE_PX, so it appeared only as the sheet became the whole screen, with a
    // `headerMode="always"` opt-out for panels whose body had no title row of their own.
    // Every call site ended up wanting it at every height, and a control that moves as you
    // drag is harder to hit than one that does not, so the opt-out became the only mode
    // (2026-09-05). The merge now touches only the container's corners, shadow and top
    // padding.
    //
    // Omitting it is allowed but discouraged for a modal sheet: with no header there is no
    // ✕ either, so the only way out is a downward drag.
    title?: string;
    // Opt-in telescope (see SheetTelescopeHandle). Today: the eip (InfoCardSection).
    telescopeRef?: React.RefObject<SheetTelescopeHandle | null>;
    // Override for the sheet's own background. The eip passes its time-of-day ground
    // (eipPalette.ts); every other sheet stays white.
    surface?: string;
    // Draw the top grabber row (default true). The eip turns it off (2026-10-29): its
    // whole upper panel is the resize handle, and the shelf carries its own small pill.
    // With it off there is also no untitled-panel ✕ fallback, so pass `showClose={false}`
    // and draw a ✕ yourself (the eip's is in its trail row).
    showGrabber?: boolean;
    // Keep the container's own 10px top / 18px bottom padding (default true). That
    // padding is breathing room around the grabber row and below a white body; a host
    // whose panels fill the sheet edge to edge turns it off, or the `surface` shows as a
    // band above and below them. The eip does (2026-10-29): its upper panel IS the top of
    // the sheet (and telescopes from there), and its white shelf runs to the bottom edge.
    // At full merge the top still gets the status-bar inset either way.
    edgePadding?: boolean;
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


// Right inset of the close cluster. Matches the tab strip's own 16px side padding, so
// the ✕ lands in exactly the same column whichever row it is currently sitting in —
// that is what makes the move between them read as ONE button descending rather than
// two buttons swapping.
const CLOSE_CLUSTER_RIGHT_PX = 16;

// Base stacking for the portaled scrim + sheet. Both are hosted at FRAME level now
// (see the portal note), so they no longer compete with their page's content area —
// they compete with the page's top-level layers, and those go high: the scp lifts its
// draggable cards to 1000 and its eip host to 1100. Chosen below MUI's modal layer
// (1300) so a real Dialog still covers the sheet.
const SCRIM_BASE_Z_INDEX = 1200;
const SHEET_BASE_Z_INDEX = 1201;

// Duration of every snap/dismiss animation.
const SNAP_DURATION_MS = 220;
// How far past the sheet's own height the open slide starts, px: the sheet's shadow
// reaches above its top edge, and must start out of view too.
const ENTRY_SLIDE_SHADOW_CLEARANCE_PX = 32;

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

// Module-level stack of the DISMISSIBLE (non-persistent) panels currently open, in mount
// order. Escape closes only the last entry — the panel the user opened most recently,
// which is the one on top. Kept separate from `mountedDepths` on purpose: that set is
// keyed by depth and includes persistent sheets (the /decks sheet), so two panels at the
// same depth, or a persistent sheet that owns no closed state, would make "topmost"
// ambiguous for a key press. A token per panel keeps the stack identity-exact.
const escapeStack: symbol[] = [];

const SheetPanel = forwardRef<SheetPanelHandle, SheetPanelProps>(({
    onClose,
    initialHeight,
    defaultHeightRatio = DEFAULT_HEIGHT_RATIO,
    restoreHeight,
    minHeight = 0,
    showScrim = true,
    depth = 0,
    bodyRef,
    bodyKey,
    collapseThresholdRatio = 0.5,
    children,
    title,
    onCloseX,
    showClose,
    showMinutePoints = false,
    telescopeRef,
    surface,
    showGrabber = true,
    edgePadding = true,
}, ref) => {
    const sheetContainerRef = useRef<HTMLDivElement | null>(null);
    const scrimRef = useRef<HTMLDivElement | null>(null);
    // Rendered IN PLACE (and never painted) purely so the host walk below has a node to
    // start from: both the scrim and the sheet are portaled away, so without it there
    // would be nothing of this component left in the page's DOM to locate.
    const anchorRef = useRef<HTMLDivElement | null>(null);
    // Wrapper around the panel header. Nothing is written to it imperatively any more —
    // it is permanent chrome — but SheetPanel still holds it for the drag binding.
    const headerRef = useRef<HTMLDivElement | null>(null);
    // Last merge ratio written, so a frame that does not change it writes no styles.
    const lastMergeRef = useRef(-1);
    // Release for the theme-colour claim held while fully merged (writeMergeChrome).
    const mergeClaimRef = useRef<(() => void) | null>(null);
    // The "unmerged" top padding, read through a ref so writeMergeChrome stays stable.
    const restTopPaddingRef = useRef(SHEET_TOP_PADDING_PX);
    restTopPaddingRef.current = edgePadding ? SHEET_TOP_PADDING_PX : 0;

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
    //
    // ---- Modal vs persistent host (2026-10-06) ----------------------------------
    // A MODAL sheet dims, and a dim must cover the ENTIRE screen, footer bar included
    // (src/components/overlayHost.ts § "THE RULE FOR A DIM"). The footer sits at z-index
    // 100 at FRAME level (FooterPresenter), so no host inside a page Surface can get above
    // it: a modal sheet therefore hosts at the frame itself (`frameOverlayHost`), where
    // SCRIM/SHEET_BASE_Z_INDEX (1200+) out-stack the bar. The footer no longer slides away
    // for a modal sheet — it stays put, dimmed by the scrim and covered by the risen sheet.
    // A PERSISTENT sheet (minHeight > 0 — no caller mounts one today) is page furniture the
    // footer is meant to float over, so it keeps `nearestOverlayHost` and stays under the bar.
    //
    // Resolved in a layout effect (the target is found by walking up from the mounted
    // sheet), so the scrim mounts on the commit after the sheet — still before paint.
    // ---- Where the SHEET mounts (2026-08-30) -------------------------------
    // The sheet is portaled to the SAME host as the scrim, and that is what lets it
    // reach full height. Rendered in place it is `absolute; bottom: 0` against the host
    // PAGE's content box — which starts BELOW the page header (flp's ContentArea, scp's
    // ContentArea) and is clipped by MobileTabScreen's ScrollArea — so `parentElement.
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
        setScrimHost(minHeight <= 0 ? frameOverlayHost(el) : nearestOverlayHost(el));
        // minHeight is fixed for a panel's lifetime (it decides modal vs persistent).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
    // Frozen at mount (see the `restoreHeight` prop): a restore describes how the panel
    // OPENS, so a host re-rendering with a different value later must change nothing.
    const [restoreAtMount] = useState(() => restoreHeight ?? null);

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
        // A fully merged sheet IS the page, so the status-bar fade takes the sheet's ground
        // rather than the host page's. Read from the element so a `surface` override and
        // the eip's time-of-day palette are both covered.
        if (t >= 1 && !mergeClaimRef.current) {
            mergeClaimRef.current = claimThemeColor(getComputedStyle(el).backgroundColor);
        } else if (t < 1 && mergeClaimRef.current) {
            mergeClaimRef.current();
            mergeClaimRef.current = null;
        }
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
        // Top padding interpolates from the sheet's own 10px (0 with `edgePadding` off) to the STATUS-BAR INSET,
        // not to 0. A fully merged sheet IS the page and reaches the top of the screen,
        // and since `viewport-fit=cover` the top of the screen is under the clock — so
        // at t=1 the grabber and the header below it need the same clearance every page
        // header gets (src/theme/safeArea.ts). `env()` cannot be interpolated in JS, so
        // the mix is expressed as a calc the browser evaluates: `SAFE_TOP * t`. On a
        // device with no inset it is 0px and this is exactly the old ramp to 0.
        el.style.paddingTop = `calc(${restTopPaddingRef.current * (1 - t)}px + ${SAFE_TOP} * ${t})`;
        // THE HEADER IS NOT MERGE CHROME. It is at full height from the moment the panel
        // opens and the merge must not touch it — only the container's own corners,
        // shadow and top padding interpolate. Until 2026-09-05 the header's height and
        // opacity were interpolated here too (with a `headerMode="always"` opt-out), and
        // the close cluster was re-measured against the moving row on every frame of the
        // ramp; both are gone with the header now fixed.
        return transition;
    }, []);

    // ---- Telescope ---------------------------------------------------------
    // Natural heights of the telescope's content and its max-only row, kept current by the
    // ResizeObserver below. -1 = not measured yet (measured synchronously on first use).
    const telescopeFullRef = useRef(-1);
    const telescopeExtraRef = useRef(-1);
    const measureTelescope = useCallback(() => {
        const tel = telescopeRef?.current;
        telescopeFullRef.current = tel?.content?.offsetHeight ?? 0;
        telescopeExtraRef.current = tel?.extra?.offsetHeight ?? 0;
    }, [telescopeRef]);

    // The frame's height for a sheet height `h` — piecewise linear, see SheetTelescopeHandle.
    const writeTelescope = useCallback((h: number, animate: boolean) => {
        const frame = telescopeRef?.current?.frame;
        if (!frame) return;
        if (telescopeFullRef.current < 0) measureTelescope();
        const extra = telescopeExtraRef.current;
        const rest = Math.max(0, telescopeFullRef.current - extra);
        const openH = defaultHeightRef.current;
        const maxH = parentHeightRef.current * MAX_HEIGHT_RATIO;
        const reveal = h <= openH ? 0 : (maxH > openH ? clamp((h - openH) / (maxH - openH), 0, 1) : 1);
        const frameH = h <= openH
            ? (openH > 0 ? rest * (h / openH) : 0)
            : rest + extra * reveal;
        frame.style.transition = animate ? `height ${SNAP_DURATION_MS}ms ease-out` : "none";
        frame.style.height = `${frameH}px`;
        frame.style.setProperty("--sheet-telescope-t", String(reveal));
        frame.style.setProperty("--sheet-telescope-transition", animate ? `${SNAP_DURATION_MS}ms` : "0ms");
    }, [telescopeRef, measureTelescope]);

    // ---- Entry slide ---------------------------------------------------------
    // The OPEN animation is a transform, not a height: the sheet is laid out once at its
    // open height and slid up from below the frame (`translateY`, compositor-only), where
    // animating `height` from 0 re-laid-out the whole eip body on every frame of the
    // slide. Only the open uses it — drags, snaps and the dismiss stay on the height model.
    //
    // While the slide runs the sheet's visible height is `heightRef − translateY`, not
    // `heightRef`. Anything that writes a height mid-slide (a grab, a scrim-tap dismiss)
    // goes through writeHeight, which first hands the slide back to the height model at
    // exactly the visible height (`endEntrySlide`) — so the sheet never jumps.
    // The timer that ends a running slide; null = no slide in flight.
    const entrySlideTimerRef = useRef<number | null>(null);

    // The slide's current offset, px (0 when none is in flight).
    const entrySlideOffset = useCallback((): number => {
        const el = sheetContainerRef.current;
        if (!el || entrySlideTimerRef.current === null) return 0;
        const t = getComputedStyle(el).transform;
        return t && t !== "none" ? new DOMMatrixReadOnly(t).m42 : 0;
    }, []);

    // End a running slide. `convert`: mid-flight, so pin the height to what is on screen
    // first (the caller is about to write its own height from there). Not converting = the
    // slide finished; the transform is already 0 and just gets handed back.
    const endEntrySlide = useCallback((convert: boolean) => {
        const el = sheetContainerRef.current;
        if (!el || entrySlideTimerRef.current === null) return;
        const offset = convert ? entrySlideOffset() : 0;
        window.clearTimeout(entrySlideTimerRef.current);
        entrySlideTimerRef.current = null;
        el.style.transition = "none";
        el.style.transform = "";
        if (offset > 0) {
            const visible = Math.max(0, heightRef.current - offset);
            heightRef.current = visible;
            el.style.height = `${visible}px`;
            void el.offsetHeight; // flush, so the caller's animated write starts from here
        }
    }, [entrySlideOffset]);

    // The single writer for the sheet's height. `animate` turns the CSS height
    // transition on for this write and off for every other one — so grabbing a
    // snapping sheet mid-animation immediately returns to 1:1 finger tracking
    // instead of trailing the finger by the snap duration.
    const writeHeight = useCallback((h: number, animate = false) => {
        // A write during the open slide takes over from it (see "Entry slide").
        endEntrySlide(true);
        heightRef.current = h;
        const el = sheetContainerRef.current;
        if (!el) return;
        writeTelescope(h, animate);
        // The merge chrome rides the SAME transition as the height, so the corners,
        // the shadow and the header arrive exactly when the sheet reaches its stop
        // rather than snapping ahead of it.
        const chromeTransition = writeMergeChrome(h, animate);
        el.style.transition = animate
            ? `height ${SNAP_DURATION_MS}ms ease-out${chromeTransition ? `, ${chromeTransition}` : ""}`
            : "none";
        el.style.height = `${h}px`;
    }, [writeMergeChrome, writeTelescope, endEntrySlide]);

    // Lay the sheet out at `h` at once and slide it up into place.
    const playEntrySlide = useCallback((h: number) => {
        const el = sheetContainerRef.current;
        if (!el) return;
        writeHeight(h);
        // Past the frame by the sheet's height plus room for its upward shadow.
        el.style.transition = "none";
        el.style.transform = `translateY(${h + ENTRY_SLIDE_SHADOW_CLEARANCE_PX}px)`;
        entrySlideTimerRef.current = window.setTimeout(() => endEntrySlide(false), SNAP_DURATION_MS + 20);
        requestAnimationFrame(() => {
            if (entrySlideTimerRef.current === null) return; // already ended by a gesture
            el.style.transition = `transform ${SNAP_DURATION_MS}ms ease-out`;
            el.style.transform = "translateY(0px)";
        });
    }, [writeHeight, endEntrySlide]);

    // Stop any in-flight height animation at exactly the height that is on
    // screen right now, and return it. A gesture must take over from what the
    // user sees, not from an animation's not-yet-reached target. Called on a
    // gesture's first real movement rather than at touch-down, so a plain tap
    // never interrupts the open animation.
    const freezeHeight = useCallback(() => {
        const el = sheetContainerRef.current;
        // Minus any open slide's offset: mid-slide, part of the laid-out sheet is still
        // below the frame (the rect's height does not see a transform's travel).
        const h = el ? el.getBoundingClientRect().height - entrySlideOffset() : heightRef.current;
        writeHeight(h);
        return h;
    }, [writeHeight, entrySlideOffset]);

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

    // Latest onCloseX, read by the Escape listener without re-binding it.
    const onCloseXRef = useRef(onCloseX);
    onCloseXRef.current = onCloseX;

    // The ✕'s close request, shared by the ✕ tap and the Escape key so keyboard and
    // pointer behave identically. `onCloseX` returning TRUE means the host handled it
    // (the eip dropped a word off its trail) and the panel stays; otherwise dismiss.
    const requestClose = useCallback(() => {
        if (onCloseXRef.current?.() === true) return;
        dismiss();
    }, [dismiss]);

    // Escape = the ✕ (desktop). Only the most recently opened dismissible panel reacts
    // (see `escapeStack`), and a persistent panel never registers — it has no closed
    // state. Deliberately fires even while focus is in a text field inside the sheet
    // (the Compare tab's search box): one press closes, as in most web modals.
    // Skipped when:
    //   - the key is auto-repeating — holding Escape would otherwise strip the eip's
    //     whole word trail in a blink;
    //   - an IME composition is in progress — Escape there cancels the composition;
    //   - the event comes from inside an MUI Modal/Dialog (z 1300, above every sheet),
    //     which owns its own Escape-to-close. MUI does not stop propagation, so without
    //     this a single press would close the dialog AND the sheet beneath it.
    // Docs: docs/EIP_SHEET_GESTURES.md § Escape key (desktop).
    useEffect(() => {
        if (persistent) return;
        const token = Symbol("sheet-panel");
        escapeStack.push(token);
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Escape" || e.repeat || e.isComposing) return;
            if (escapeStack[escapeStack.length - 1] !== token) return;
            if (dismissingRef.current) return;
            if ((e.target as Element | null)?.closest?.(".MuiModal-root")) return;
            e.preventDefault();
            requestClose();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            const i = escapeStack.indexOf(token);
            if (i !== -1) escapeStack.splice(i, 1);
        };
    }, [persistent, requestClose]);

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
        // Mid open-slide, take over at the VISIBLE height (heightRef is still the target).
        endEntrySlide(true);
        const h = heightRef.current;
        const next = clamp(h + rawDy * RESIZE_SENSITIVITY, minH, maxHeight());
        if (next === h) return false;
        writeHeight(next);
        return true;
    }, [maxHeight, writeHeight, endEntrySlide]);

    // Play the open animation from 0 → target height on first render. The
    // panel's own open height is a fixed fraction of the parent (screen) height
    // rather than content-measured, so it's consistent across all eip tabs
    // regardless of how much content a given tab renders. Child panels that
    // pass initialHeight still match the parent panel's live height instead.
    useLayoutEffect(() => {
        if (!sheetContainerRef.current) return;
        const parentH = sheetContainerRef.current.parentElement?.clientHeight ?? window.innerHeight;
        parentHeightRef.current = parentH;
        // Resting height on mount, in priority order:
        //   1. explicit initialHeight (a child panel matching its parent's extent)
        //   2. the floor, for a persistent panel — it is already "closed", so
        //      there is no open animation to play and no default stop to grow to
        //   3. the modal default fraction of the screen (the host's `defaultHeightRatio`)
        const targetHeight = initialHeight != null
            ? Math.min(initialHeight, parentH * MAX_HEIGHT_RATIO)
            : persistent
                ? Math.min(minHeight, parentH * MAX_HEIGHT_RATIO)
                : parentH * clamp(defaultHeightRatio, 0, MAX_HEIGHT_RATIO);
        defaultHeightRef.current = targetHeight;
        if (restoreAtMount !== null && !persistent) {
            // A Back restore: already at the height the learner left it, from the first
            // paint. The resting stop stays `targetHeight` (set just above).
            writeHeight(clamp(restoreAtMount, targetHeight, parentH * MAX_HEIGHT_RATIO));
            return;
        }
        if (persistent) {
            // Sits at its floor from the first paint — no 0 → height slide.
            writeHeight(targetHeight);
            return;
        }
        // Laid out at its open height and slid up from below the frame, before paint — so
        // the sheet never flashes at its natural height (see "Entry slide").
        playEntrySlide(targetHeight);
        // Keyed on scrimHost, NOT []: the sheet is portaled, so it is not in the DOM on
        // this component's first commit — it mounts on the commit that resolves the
        // host, and that is the one whose layout can be measured. The guard above makes
        // the first pass a no-op.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scrimHost]);

    // Cancel in-flight work if the panel is unmounted from the outside (e.g.
    // scrim tap, parent state change) while a fling or dismiss is running.
    // Unmounting while merged must not strand the claim.
    useEffect(() => () => {
        mergeClaimRef.current?.();
        mergeClaimRef.current = null;
    }, []);

    useEffect(() => () => {
        stopMomentum();
        if (dismissTimerRef.current !== null) window.clearTimeout(dismissTimerRef.current);
        if (entrySlideTimerRef.current !== null) window.clearTimeout(entrySlideTimerRef.current);
    }, [stopMomentum]);

    useImperativeHandle(ref, () => ({
        getCurrentHeight: () => heightRef.current,
    }), []);

    // The telescope's content changes height (a gloss wrapping to two lines on the next
    // word, the Compare tab swapping in): re-measure and re-place the frame at the CURRENT
    // sheet height, so the bottom of the panel never drifts off the frame's bottom edge.
    useEffect(() => {
        const tel = telescopeRef?.current;
        if (!tel?.content) return;
        const ro = new ResizeObserver(() => {
            measureTelescope();
            if (!dismissingRef.current) writeTelescope(heightRef.current, false);
        });
        ro.observe(tel.content);
        if (tel.extra) ro.observe(tel.extra);
        return () => ro.disconnect();
        // Keyed on scrimHost: the sheet (and the telescope inside it) is portaled, so it
        // only exists once the host resolves — same reason as the open-animation effect.
    }, [scrimHost, telescopeRef, measureTelescope, writeTelescope]);

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

    // ---- Keyboard clearance (2026-10-03) -----------------------------------
    // A keyboard (ours or the OS's — useKeyboardInset unions them) covers the bottom
    // `keyboardInset` px of the frame, and the sheet is pinned to that same bottom edge,
    // so the last rows of the body would sit under the keyboard with no way to scroll
    // them out. Rather than lifting the whole sheet (decided against: the height/drag
    // machinery above is all relative to `bottom: 0`), the body's SCROLL element gets
    // extra bottom padding equal to the inset — the scroll range grows by exactly the
    // covered band, so every row can be brought above the keyboard. The sheet itself
    // never moves. Motivating cases: the decks-sheet search (DecksPanelBody) and the
    // compare slot-B search (CompareWorkspace), whose results run under the keyboard.
    //
    // Imperative, on the element behind bodyRef, so it applies to every body without
    // each one opting in. The body's own padding is read back from computed style
    // (after clearing ours) and the inset ADDED to it, so a body's designed bottom
    // breathing room survives. ⚠️ That only works because no sheet body sets its
    // scroll padding through an inline `style` — this would overwrite it. Bodies use
    // `sx`/styled (class-based), which an inline value layers over and then hands back.
    //
    // No transition: the padding is invisible spacing below the content, so there is
    // nothing on screen for it to animate.
    // Docs: docs/UX_AND_NAVIGATION.md § Keyboard and popups.
    const keyboardInset = useKeyboardInset();
    useLayoutEffect(() => {
        const scrollEl = bodyRef.current?.scroll ?? null;
        if (!scrollEl || keyboardInset <= 0) return;
        const designedPadding = parseFloat(getComputedStyle(scrollEl).paddingBottom) || 0;
        scrollEl.style.paddingBottom = `${designedPadding + keyboardInset}px`;
        return () => {
            scrollEl.style.removeProperty("padding-bottom");
        };
        // Same bodyKey/scrimHost re-bind reasoning as the scroll-coupling effect above:
        // the body is portaled and can swap, so the scroll element behind bodyRef changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [keyboardInset, bodyKey, scrimHost]);

    // ---- Maximize when a dictionary search takes focus (2026-10-06) ----------
    // Focusing a search field raises a keyboard (the OS's, or the beginner keyboard),
    // which covers the bottom of the sheet — a 60% sheet would be left showing little
    // more than the field. So any field inside an element marked
    // `data-sheet-maximize-on-focus` animates the sheet to its max on focus, the same
    // snap a drag to the top would end in. The marker lives on the FIELD's side
    // (DictionaryWordSearch carries it), not as a SheetPanel prop, so every sheet that
    // hosts a dictionary search — CompareSheet, the eip's Compare tab, the notebook's
    // word picker — gets it without opting in, and a sheet's other inputs do not.
    //
    // A focusin, not the keyboard inset: it fires on the tap itself, so the sheet grows
    // alongside the keyboard rather than after it. A plain tap is never a resize gesture
    // (onTouchEnd ignores a gesture with no mode), so no release snap undoes this.
    // Docs: docs/UX_AND_NAVIGATION.md § Keyboard and popups.
    useEffect(() => {
        const el = sheetContainerRef.current;
        if (!el) return;
        const onFocusIn = (e: FocusEvent) => {
            const target = e.target as HTMLElement | null;
            if (!target?.closest?.("[data-sheet-maximize-on-focus]")) return;
            if (dismissingRef.current) return;
            const max = maxHeight();
            if (heightRef.current >= max - AT_MAX_EPSILON_PX) return;
            stopMomentum();
            writeHeight(max, true);
        };
        el.addEventListener("focusin", onFocusIn);
        return () => el.removeEventListener("focusin", onFocusIn);
        // Keyed on scrimHost: the sheet is portaled, so its container exists only once
        // the host resolves (same reason as the open-animation effect).
    }, [scrimHost, maxHeight, stopMomentum, writeHeight]);

    // Both layers are portaled to the frame-level host, so their z-indexes are always
    // stated here (the stylesheet's 10/11 only ever applied while they were rendered
    // inside their page). `depth * 2` keeps a stacked child panel and its scrim above
    // their parent's pair.
    const stackZ = depth * 2;
    const scrimStyle: React.CSSProperties = {
        zIndex: SCRIM_BASE_Z_INDEX + stackZ,
        // A restored sheet was already dimmed when the learner left; fading the scrim in
        // again would flash the page behind it. `dismiss` still owns the fade OUT.
        ...(restoreAtMount !== null && { animation: "none" }),
    };
    // NOTE: no `height` key here on purpose — height is owned imperatively by
    // writeHeight (see the height-model comment above). Same for the merge chrome
    // (border radius, top padding, shadow) — writeMergeChrome owns those.
    const sheetStyle: React.CSSProperties = {
        zIndex: SHEET_BASE_Z_INDEX + stackZ,
        ...(surface && { background: surface }),
        // Top padding is written inline by writeMergeChrome (from restTopPaddingRef).
        ...(!edgePadding && { paddingBottom: 0 }),
    };

    // A persistent panel has no closed state, so it gets no ✕ unless a caller insists.
    const closeVisible = showClose ?? !persistent;

    // The panel's permanent controls, in the order they read from the left: the flame
    // (study surfaces only) then the ✕, so the ✕ is the corner control on every panel.
    // Only the ROOT panel carries the flame — a stacked child (the compare sheet raised
    // from the eip) covers its parent completely, so a second flame would be one
    // indicator behind another, and a third `useMinutePoints` tick.
    const closeCluster = (
        <>
            {showMinutePoints && depth === 0 && <MinutePointsFireBadge />}
            <SheetCloseX onClick={requestClose} />
        </>
    );

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
                {/* Draggable zone: the grabber pill, alone. The header below carries the
                    ✕ and the flame now, so this row is back to being exactly what it
                    looks like — the resize affordance, and nothing else.

                    FIRST flex child, above the header: the grabber stays at the very top
                    of the panel at every height, including a maximized one, rather than
                    being pushed under the page header. */}
                {showGrabber && (
                <Box
                    className="mobile-demo-eic-drag-zone"
                    {...bindHeaderDrag()}
                    sx={{
                        // Positioning context for the untitled-panel fallback cluster below.
                        position: "relative",
                        touchAction: "none",
                        userSelect: "none",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        // Sized for the pill it holds. It used to reserve
                        // CHROME_ROW_HEIGHT_PX for the ✕ that lived here.
                        padding: "4px 0 8px",
                    }}
                >
                    <InfoSheetGrabber className="mobile-demo-drag-handle" />
                    {/* No title = no header = nowhere for the close cluster to live, so it
                        falls back into this row. Discouraged (see the `title` prop) and
                        used by nothing today; it exists so an untitled panel degrades to
                        the old layout rather than losing its ✕ entirely. */}
                    {closeVisible && !title && (
                        <Box
                            className="mobile-demo-eic-close-cluster"
                            sx={{
                                position: "absolute",
                                top: 0,
                                bottom: 0,
                                right: `${CLOSE_CLUSTER_RIGHT_PX}px`,
                                display: "flex",
                                alignItems: "center",
                                gap: "10px",
                            }}
                        >
                            {closeCluster}
                        </Box>
                    )}
                </Box>
                )}
                {/* PANEL HEADER — the app's real PageHeader, at full height from the
                    moment the panel opens (it was merge chrome until 2026-09-05; see the
                    `title` prop for why that changed). It sits under the grabber, so the
                    body below is pushed down by exactly one header, and the header holds
                    still while the panel is dragged.

                    IT CARRIES THE CLOSE CLUSTER in its right slot — the ✕ and, on study
                    surfaces, the minute-points flame. They used to sit in the grabber row
                    and slide down into whichever row was below as the panel grew, which
                    made the panel's one permanent control a moving target.

                    ⚠️ This is a REAL PageHeader, and an open titled panel therefore adds a
                    second minute-points tick on top of its host page's own header IF the
                    flame is on. It cannot over-credit (the server claims a 59-second
                    cooldown atomically, UserDAL.claimMinutePointIncrement), but see
                    PageHeader's "exactly one PageHeader on an earning page" note. */}
                {title && (
                    <SheetHeaderSlot
                        ref={headerRef}
                        className="mobile-demo-eic-header"
                        // THE WHOLE HEADER RESIZES THE PANEL. The top edge is where a hand
                        // reaches to pull a sheet back down; before this only the 44px pill
                        // above it did anything, so a drag on the header title simply did
                        // nothing. filterTaps keeps the ✕ inside it tappable.
                        {...bindHeaderDrag()}
                    >
                        <PageHeader
                            title={title}
                            size="node"
                            // NO CHEVRON — the ✕ in the right slot is the close, and a
                            // chevron beside it would be a second close button one row away
                            // doing the same thing.
                            showBack={false}
                            // NO PageHeader FLAME — the cluster below supplies its own, so
                            // that PageHeader's flame-last rule does not put the flame
                            // outboard of the ✕ (the ✕ is the corner control here).
                            showFlame={false}
                            rightContent={closeVisible ? closeCluster : undefined}
                            // The status-bar clearance is carried by the PANEL's own top
                            // padding (writeMergeChrome), which ramps it in with the merge —
                            // the header must not add it a second time.
                            safeAreaTop={false}
                        />
                    </SheetHeaderSlot>
                )}
                {typeof children === "function" ? children({ bindHeaderDrag, requestClose, dismiss }) : children}
            </InfoSheetContainer>,
            scrimHost,
            )}
        </>
    );
});

SheetPanel.displayName = "SheetPanel";

export default SheetPanel;
