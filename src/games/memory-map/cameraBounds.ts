import type { Camera } from "./types";
import { PAN_EDGE_FRACTION, PIXELS_PER_WORLD_UNIT } from "./constants";

/** A world-unit rect, as returned by `mapBounds` (server/services/memoryMapLayout.ts). */
interface WorldBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/**
 * Keep the camera from panning off into open water (docs/MEMORY_MAP_GAME.md § 6).
 *
 * The rule is stated on the GAME VIEWPORT, not in world units: at the furthest pan in
 * any direction, the map's outermost edge sits at the `PAN_EDGE_FRACTION` line of the
 * viewport. Dragging the map left, for example, stops once its right coast reaches 25%
 * of the viewport width from the left — the remaining 75% is the most water the player
 * can ever face.
 *
 * "Viewport" is the `.memory-map-world` node (`MemoryMapWorld` → `viewportRef`) — the
 * blue water panel inside the GameFrame, BELOW the prompt bar — never the window. The
 * header, prompt and frame inset are therefore already excluded; pass that node's
 * measured size, not `window.innerWidth/Height`.
 *
 * Why viewport-relative: the allowed overscroll is `fraction × viewport / scale` world
 * units, so the water margin shrinks as the player zooms in and grows as they zoom out,
 * and a small map and a large one both stop the same distance from their coast in the
 * viewport. A fixed world-unit margin would be a sliver at fit zoom and a desert at max.
 *
 * Derivation (x axis; y is identical with height): a world x lands in the viewport at
 * `(x − cx)·scale + W/2`. Requiring the right edge at ≥ f·W gives
 * `cx ≤ maxX + (½ − f)·W/scale`; requiring the left edge at ≤ (1 − f)·W gives
 * `cx ≥ minX − (½ − f)·W/scale`. The interval is never empty, so even a map smaller
 * than the viewport can drift a little but never leave.
 *
 * Bounds are the map's bounding RECT, so a diagonal corner pan can frame the rect's
 * empty corner if no word sits there; along either axis alone the edge is always a word.
 *
 * Pure — no React — so it is shared by every camera write in `MemoryMapWorld` and
 * unit-tested in `src/__tests__/memoryMapCameraBounds.test.ts`.
 */
export function clampCameraToMap(
    camera: Camera,
    bounds: WorldBounds | null,
    viewport: { width: number; height: number }
): Camera {
    // Nothing to anchor to yet (empty map, unmeasured viewport): leave the camera be.
    if (!bounds || viewport.width === 0 || viewport.height === 0) return camera;

    const scale = camera.zoom * PIXELS_PER_WORLD_UNIT;
    const slackX = ((0.5 - PAN_EDGE_FRACTION) * viewport.width) / scale;
    const slackY = ((0.5 - PAN_EDGE_FRACTION) * viewport.height) / scale;

    const x = Math.min(bounds.maxX + slackX, Math.max(bounds.minX - slackX, camera.x));
    const y = Math.min(bounds.maxY + slackY, Math.max(bounds.minY - slackY, camera.y));

    // Return the SAME object when nothing moved, so callers can cheaply skip a commit.
    return x === camera.x && y === camera.y ? camera : { ...camera, x, y };
}
