import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

/**
 * Renders a game SIDEWAYS — landscape content inside a portrait app shell.
 *
 * ── Why this doesn't ask the phone about its orientation ────────────────────
 * The obvious approach is to read the device orientation and rotate when it is
 * portrait. This hook deliberately does NOT do that, because it doesn't need to:
 * it looks at the shape of its own container instead.
 *
 *     container taller than wide  →  rotate the stage 90°
 *     container wider than tall   →  render it straight
 *
 * That single rule makes device rotation a NON-EVENT. Consider both cases:
 *
 *   • Rotation lock ON. The phone turns, the browser does not. The container
 *     stays portrait, so the stage stays rotated, and the player — who has now
 *     physically turned the phone — sees an upright landscape game.
 *   • Rotation lock OFF. The phone turns and the browser turns with it. The
 *     container becomes wider than tall, so the stage stops rotating and lays
 *     out naturally. The player sees the same upright landscape game.
 *
 * Both paths converge on "sideways game", with no orientation API, no
 * `screen.orientation.lock()` (unavailable on iOS Safari without fullscreen, and
 * this app is not installed as a PWA), and no "please rotate your phone" nag.
 * A rotation mid-run is just a resize.
 *
 * It also means the desktop phone-card (`MobileDemoFrame`'s 393px surface) gets
 * a correctly rotated game for free — it is a tall container like any other,
 * and no orientation API would ever have reported anything useful about it.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *     const stage = useSidewaysStage();
 *     <Box ref={stage.outerRef} sx={{ position: "absolute", inset: 0, overflow: "hidden" }}>
 *         <Box style={stage.stageStyle}>{game}</Box>
 *     </Box>
 *
 * Anything that reads pointer coordinates MUST route them through
 * `toStageCoords` — see the note on that function.
 *
 * Documented in: docs/SPEED_READING_GAME.md § Sideways (landscape) rendering.
 */

/**
 * Rotation direction, in degrees. `90` puts the game's top edge along the
 * screen's RIGHT edge, so the player turns the phone counter-clockwise to read
 * it. Flip to -90 here (and only here — the inverse mapping below reads it) to
 * send them the other way.
 */
const ROTATION_DEG: 90 | -90 = 90;

export interface SidewaysStage {
    /** Attach to the NON-rotated container. Its shape decides the rotation. */
    outerRef: React.RefObject<HTMLDivElement | null>;
    /** Apply to the rotated child that holds the game. */
    stageStyle: CSSProperties;
    /** True while the stage is rotated (i.e. the container is portrait). */
    rotated: boolean;
    /** The stage's own width/height, in its own (post-rotation) coordinates. */
    stageWidth: number;
    stageHeight: number;
    /**
     * Convert a viewport point (a pointer event's clientX/clientY) into stage
     * coordinates.
     *
     * ⚠️ REQUIRED for anything positioned from a tap. `getBoundingClientRect()`
     * on a rotated element returns its AXIS-ALIGNED BOUNDING BOX in viewport
     * space, so the usual `clientX - rect.left` gives a value in the wrong
     * coordinate system entirely — off by a 90° rotation, not by an offset.
     */
    toStageCoords: (clientX: number, clientY: number) => { x: number; y: number };
}

export function useSidewaysStage(): SidewaysStage {
    const outerRef = useRef<HTMLDivElement | null>(null);
    /** Container size in viewport orientation — NOT the stage's own size. */
    const [box, setBox] = useState({ width: 0, height: 0 });

    // useLayoutEffect, not useEffect: the first measurement must land before the
    // browser paints, or the game shows one unrotated frame before snapping.
    useLayoutEffect(() => {
        const el = outerRef.current;
        if (!el) return;
        const measure = () => {
            const r = el.getBoundingClientRect();
            // Ignore transient zero measurements (e.g. mid-transition), which
            // would otherwise flip `rotated` to a meaningless value.
            if (r.width > 0 && r.height > 0) setBox({ width: r.width, height: r.height });
        };
        measure();
        // A rotation, a URL-bar collapse and a desktop window resize are all just
        // resizes here — this observer is the only thing that has to notice.
        if (typeof ResizeObserver === "undefined") return;
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const { width: W, height: H } = box;
    // The container's shape is the whole decision. Square counts as portrait; it
    // has to pick one, and a square container is never a real landscape phone.
    const rotated = H >= W;

    // Rotated, the stage's own width runs along the container's HEIGHT.
    const stageWidth = rotated ? H : W;
    const stageHeight = rotated ? W : H;

    /*
     * The transform, derived (origin top-left, so it composes predictably):
     *
     *   rotate(90deg):  (lx, ly) → (-ly, lx)      then translateX(W) → (W - ly, lx)
     *   rotate(-90deg): (lx, ly) → (ly, -lx)      then translateY(H) → (ly, H - lx)
     *
     * Either way the stage lands exactly on the container, which is why the
     * translate distance is the container's own width/height.
     */
    const stageStyle: CSSProperties = rotated
        ? {
            position: "absolute",
            top: 0,
            left: 0,
            width: stageWidth,
            height: stageHeight,
            transformOrigin: "top left",
            transform: ROTATION_DEG === 90
                ? `translateX(${W}px) rotate(90deg)`
                : `translateY(${H}px) rotate(-90deg)`,
            display: "flex",
            flexDirection: "column",
        }
        : { position: "absolute", inset: 0, display: "flex", flexDirection: "column" };

    const toStageCoords = useCallback(
        (clientX: number, clientY: number) => {
            const el = outerRef.current;
            if (!el) return { x: 0, y: 0 };
            // The CONTAINER is never rotated, so its rect is a true rect and this
            // subtraction is meaningful (unlike one taken on the stage itself).
            const r = el.getBoundingClientRect();
            const cx = clientX - r.left;
            const cy = clientY - r.top;
            if (!rotated) return { x: cx, y: cy };
            // Inverse of the transform above.
            return ROTATION_DEG === 90
                ? { x: cy, y: r.width - cx }
                : { x: r.height - cy, y: cx };
        },
        [rotated]
    );

    return { outerRef, stageStyle, rotated, stageWidth, stageHeight, toStageCoords };
}
