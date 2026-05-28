import React, { useState, useCallback, useRef, useLayoutEffect, useEffect, useImperativeHandle, forwardRef } from "react";
import { Box } from "@mui/material";
import { useDrag } from "@use-gesture/react";
import { EicScrim, InfoSheetContainer, InfoSheetGrabber } from "./styled";

// Imperative handle exposing the gesture-root wrapper and the inner scrollable
// container of whatever body a SheetPanel renders. SheetPanel attaches its
// touch listeners to `root` (so swipes anywhere on the panel feed the
// resize/scroll coupling) and reads `scroll.scrollTop` to decide between
// growing the sheet and letting native scroll take over.
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
    onClose: () => void;
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
    children: React.ReactNode;
    // Optional row rendered above the grabber (e.g. entry-tabs strip). Kept
    // outside the drag zone so taps on tabs aren't captured by useDrag.
    tabStrip?: React.ReactNode;
}

// Sheet snaps to one of three stops on drag release: max height, the initial
// (natural-content) height, or 0 height. Snapping to 0 dismisses after the
// shrink animation finishes.
const SNAP_DURATION_MS = 220;

// Approximate height of the sticky "header" inside the sheet (grabber + entry
// header row + tab strip). Hard-coded from a one-time measurement so the
// dismiss threshold doesn't depend on a runtime layout query. If the panel's
// height drops below this on release, snap to 0 instead of springing back to
// the natural height — at that point the entry/tabs are already clipped, so
// keeping the panel partially open looks broken.
const EIP_HEADER_HEIGHT = 174;

// Module-level set of currently mounted panel depths. The window-level wheel
// listener installed by each panel checks this set so only the top-most depth
// reacts to a given gesture (touch is already top-only via DOM hit-testing).
const mountedDepths = new Set<number>();

const SheetPanel = forwardRef<SheetPanelHandle, SheetPanelProps>(({
    onClose,
    initialHeight,
    depth = 0,
    bodyRef,
    children,
    tabStrip,
}, ref) => {
    const sheetContainerRef = useRef<HTMLDivElement | null>(null);
    // Sheet height in px. null until measured after first render.
    const [sheetHeight, setSheetHeight] = useState<number | null>(null);
    // Ref kept in sync with state so the drag handler always reads the latest value.
    const sheetHeightRef = useRef<number | null>(null);
    const dragStartHeightRef = useRef<number>(0);
    // Parent container height used as the cap for resize drags.
    const parentHeightRef = useRef<number>(0);
    // Natural content height measured on first paint — one of the snap stops.
    const initialHeightRef = useRef<number>(0);
    // True only while a release-snap animation is playing.
    const [isSnapping, setIsSnapping] = useState(false);
    // Flag set when the chosen snap target is 0; the transitionend handler
    // reads this to know it should call handleClose after the shrink finishes.
    const pendingDismissRef = useRef(false);

    // Measure the sheet's natural height on first render, then play an open
    // animation from 0 → measured height. Mirrors the previous InfoCardSection
    // open behavior verbatim.
    useLayoutEffect(() => {
        if (!sheetContainerRef.current) return;
        const measured = sheetContainerRef.current.offsetHeight;
        const parentH = sheetContainerRef.current.parentElement?.clientHeight ?? window.innerHeight;
        parentHeightRef.current = parentH;
        initialHeightRef.current = measured;
        const targetHeight = initialHeight != null ? Math.min(initialHeight, parentH * 0.92) : measured;
        sheetHeightRef.current = 0;
        setSheetHeight(0);
        requestAnimationFrame(() => {
            setIsSnapping(true);
            sheetHeightRef.current = targetHeight;
            setSheetHeight(targetHeight);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useImperativeHandle(ref, () => ({
        getCurrentHeight: () => sheetHeightRef.current,
    }), []);

    const handleClose = useCallback(() => {
        onClose();
    }, [onClose]);

    // Drag the grabber to resize the sheet. Snap-on-release to {0, initial, max}.
    const bindHeaderDrag = useDrag(
        ({ first, last, movement: [, my] }) => {
            if (first) {
                dragStartHeightRef.current = sheetHeightRef.current ?? 0;
                setIsSnapping(false);
            }
            const maxH = parentHeightRef.current * 0.92;
            const newH = dragStartHeightRef.current - my;
            const clampedH = Math.max(0, Math.min(maxH, newH));
            if (!last) {
                sheetHeightRef.current = clampedH;
                setSheetHeight(clampedH);
                return;
            }
            // Below header height → commit to dismiss. Otherwise snap to the
            // nearest of {initial, max}; 0 is only reachable via the header
            // cutoff, not by being marginally closer to 0 than to initial.
            let target: number;
            if (clampedH < EIP_HEADER_HEIGHT) {
                target = 0;
            } else {
                const stops = [initialHeightRef.current, maxH];
                target = stops.reduce((best, s) =>
                    Math.abs(s - clampedH) < Math.abs(best - clampedH) ? s : best
                );
            }
            if (target === 0) pendingDismissRef.current = true;
            setIsSnapping(true);
            sheetHeightRef.current = target;
            setSheetHeight(target);
        },
        { axis: "y", filterTaps: true }
    );

    // After a snap-to-0, dismiss the sheet once the height transition ends.
    useEffect(() => {
        if (!isSnapping) return;
        const el = sheetContainerRef.current;
        if (!el) return;
        const finish = () => {
            setIsSnapping(false);
            if (pendingDismissRef.current) {
                pendingDismissRef.current = false;
                handleClose();
            }
        };
        const onEnd = (e: TransitionEvent) => {
            if (e.propertyName !== "height") return;
            finish();
        };
        el.addEventListener("transitionend", onEnd);
        const timeout = window.setTimeout(finish, SNAP_DURATION_MS + 80);
        return () => {
            el.removeEventListener("transitionend", onEnd);
            window.clearTimeout(timeout);
        };
    }, [isSnapping, handleClose]);

    // Couple content scroll to sheet resize. See InfoCardSection's prior
    // implementation comments — behavior is preserved exactly here.
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

        const applyDelta = (dy: number): boolean => {
            const maxH = parentHeightRef.current * 0.92;
            const h = sheetHeightRef.current ?? 0;
            const st = scrollEl.scrollTop;
            if (dy > 0) {
                if (h < maxH) {
                    const next = Math.min(h + dy, maxH);
                    sheetHeightRef.current = next;
                    setSheetHeight(next);
                    return true;
                }
                return false;
            }
            if (dy < 0) {
                if (st > 0) return false;
                if (h > 0) {
                    const next = Math.max(h + dy, 0);
                    sheetHeightRef.current = next;
                    setSheetHeight(next);
                    return true;
                }
            }
            return false;
        };

        const onWheel = (e: WheelEvent) => {
            if (!isTopmost()) return;
            if (pendingDismissRef.current) {
                e.preventDefault();
                return;
            }
            const dy = e.deltaY;
            if (dy < 0) {
                const st = scrollEl.scrollTop;
                const h = sheetHeightRef.current ?? 0;
                if (st === 0 && h > 0) {
                    const next = Math.max(h + dy, 0);
                    const dismissThreshold = EIP_HEADER_HEIGHT;
                    if (next < dismissThreshold) {
                        sheetHeightRef.current = 0;
                        setSheetHeight(0);
                        pendingDismissRef.current = true;
                        setIsSnapping(true);
                        e.preventDefault();
                        return;
                    }
                    sheetHeightRef.current = next;
                    setSheetHeight(next);
                    e.preventDefault();
                    return;
                }
                return;
            }
            if (applyDelta(dy)) e.preventDefault();
        };

        let lastTouchY: number | null = null;
        let lastTouchTime = 0;
        let velocity = 0;
        let touchConsumedAny = false;
        let momentumRaf: number | null = null;

        const stopMomentum = () => {
            if (momentumRaf !== null) {
                cancelAnimationFrame(momentumRaf);
                momentumRaf = null;
            }
        };

        const onTouchStart = (e: TouchEvent) => {
            if (e.touches.length !== 1) return;
            stopMomentum();
            lastTouchY = e.touches[0].clientY;
            lastTouchTime = e.timeStamp;
            velocity = 0;
            touchConsumedAny = false;
        };
        const onTouchMove = (e: TouchEvent) => {
            if (lastTouchY === null || e.touches.length !== 1) return;
            const y = e.touches[0].clientY;
            const t = e.timeStamp;
            const dy = lastTouchY - y;
            const dt = t - lastTouchTime;
            if (dt > 0) {
                const inst = dy / dt;
                velocity = velocity * 0.6 + inst * 0.4;
            }
            lastTouchY = y;
            lastTouchTime = t;
            if (applyDelta(dy)) {
                touchConsumedAny = true;
                e.preventDefault();
            } else {
                scrollEl.scrollTop += dy;
                e.preventDefault();
            }
        };
        const onTouchEnd = () => {
            lastTouchY = null;
            const hOnRelease = sheetHeightRef.current ?? 0;
            if (touchConsumedAny && hOnRelease < EIP_HEADER_HEIGHT) {
                // Below header height on release → animate to 0 and dismiss,
                // mirroring the grabber-drag snap rule.
                sheetHeightRef.current = 0;
                setSheetHeight(0);
                pendingDismissRef.current = true;
                setIsSnapping(true);
                velocity = 0;
                touchConsumedAny = false;
                return;
            }
            touchConsumedAny = false;
            if (Math.abs(velocity) < 0.05) {
                velocity = 0;
                return;
            }
            let v = velocity;
            let lastFrame = performance.now();
            // Lock momentum to whichever mode the gesture is currently in:
            // - "resize": panel is growing/shrinking. Stop momentum if applyDelta
            //   stops consuming (panel hit max or top of content), instead of
            //   transferring inertia into native scroll.
            // - "scroll": content is scrolling. Stop momentum if scrollTop hits
            //   the top boundary, instead of transferring inertia into a panel
            //   shrink. The user must initiate a fresh gesture to cross over.
            const maxH = parentHeightRef.current * 0.92;
            const h0 = sheetHeightRef.current ?? 0;
            const st0 = scrollEl.scrollTop;
            let momentumMode: "resize" | "scroll" | null = null;
            if (v > 0) {
                momentumMode = h0 < maxH ? "resize" : "scroll";
            } else if (v < 0) {
                momentumMode = st0 > 0 ? "scroll" : (h0 > 0 ? "resize" : null);
            }
            if (momentumMode === null) {
                velocity = 0;
                return;
            }
            const step = (now: number) => {
                const dt = now - lastFrame;
                lastFrame = now;
                const dy = v * dt;
                if (momentumMode === "resize") {
                    if (!applyDelta(dy)) {
                        // Hit the resize boundary — pause inertia here.
                        momentumRaf = null;
                        return;
                    }
                } else {
                    // Scroll-mode momentum: never resize the panel; stop at the
                    // content-top boundary.
                    if (v < 0 && scrollEl.scrollTop <= 0) {
                        momentumRaf = null;
                        return;
                    }
                    scrollEl.scrollTop += dy;
                    if (v < 0 && scrollEl.scrollTop <= 0) {
                        scrollEl.scrollTop = 0;
                        momentumRaf = null;
                        return;
                    }
                }
                if ((sheetHeightRef.current ?? 0) < EIP_HEADER_HEIGHT && v < 0) {
                    sheetHeightRef.current = 0;
                    setSheetHeight(0);
                    pendingDismissRef.current = true;
                    setIsSnapping(true);
                    momentumRaf = null;
                    return;
                }
                v *= Math.pow(0.95, dt / 16);
                if (Math.abs(v) < 0.02) {
                    momentumRaf = null;
                    return;
                }
                momentumRaf = requestAnimationFrame(step);
            };
            momentumRaf = requestAnimationFrame(step);
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const stackZ = depth * 2;
    const scrimStyle: React.CSSProperties = depth > 0 ? { zIndex: 10 + stackZ } : {};
    const sheetStyle: React.CSSProperties = sheetHeight !== null
        ? {
            height: sheetHeight,
            transition: isSnapping ? `height ${SNAP_DURATION_MS}ms ease-out` : "none",
            ...(depth > 0 ? { zIndex: 11 + stackZ } : {}),
        }
        : (depth > 0 ? { zIndex: 11 + stackZ } : {});

    return (
        <>
            <EicScrim
                className="mobile-demo-eic-scrim"
                onClick={handleClose}
                style={scrimStyle}
            />
            <InfoSheetContainer
                ref={sheetContainerRef}
                className="mobile-demo-eic-sheet"
                style={sheetStyle}
            >
                {/* Draggable zone: grabber pill only. Header/tabs are outside
                    this zone so taps on header icons aren't captured by useDrag. */}
                <Box
                    className="mobile-demo-eic-drag-zone"
                    {...bindHeaderDrag()}
                    sx={{ touchAction: "none", userSelect: "none", display: "flex", justifyContent: "center", padding: "4px 0 8px" }}
                >
                    <InfoSheetGrabber className="mobile-demo-drag-handle" />
                </Box>
                {/* Entry-tabs strip (optional) sits between the grabber and the
                    entry header so it reads as part of the panel chrome. */}
                {tabStrip}
                {children}
            </InfoSheetContainer>
        </>
    );
});

SheetPanel.displayName = "SheetPanel";

export default SheetPanel;
