import { describe, expect, it } from "vitest";
import { clampCameraToMap } from "../games/memory-map/cameraBounds";
import { PAN_EDGE_FRACTION, PIXELS_PER_WORLD_UNIT } from "../games/memory-map/constants";

/**
 * The pan limit (docs/MEMORY_MAP_GAME.md § 6): at the furthest pan in any direction the
 * map's outermost edge sits on the PAN_EDGE_FRACTION line of the viewport.
 */
const viewport = { width: 400, height: 800 };
const bounds = { minX: -10, minY: -20, maxX: 10, maxY: 20 };

/** Where a world point lands on screen under a camera — the inverse of the clamp. */
const screenX = (wx: number, cam: { x: number; zoom: number }) =>
    (wx - cam.x) * cam.zoom * PIXELS_PER_WORLD_UNIT + viewport.width / 2;
const screenY = (wy: number, cam: { y: number; zoom: number }) =>
    (wy - cam.y) * cam.zoom * PIXELS_PER_WORLD_UNIT + viewport.height / 2;

describe("clampCameraToMap", () => {
    it("leaves an in-range camera untouched (same object)", () => {
        const cam = { x: 0, y: 0, zoom: 1 };
        expect(clampCameraToMap(cam, bounds, viewport)).toBe(cam);
    });

    it.each([0.5, 1, 2])("stops each coast on the edge line at zoom %s", (zoom) => {
        const far = 1e6;
        const right = clampCameraToMap({ x: far, y: 0, zoom }, bounds, viewport);
        expect(screenX(bounds.maxX, right)).toBeCloseTo(PAN_EDGE_FRACTION * viewport.width);
        const left = clampCameraToMap({ x: -far, y: 0, zoom }, bounds, viewport);
        expect(screenX(bounds.minX, left)).toBeCloseTo((1 - PAN_EDGE_FRACTION) * viewport.width);
        const down = clampCameraToMap({ x: 0, y: far, zoom }, bounds, viewport);
        expect(screenY(bounds.maxY, down)).toBeCloseTo(PAN_EDGE_FRACTION * viewport.height);
        const up = clampCameraToMap({ x: 0, y: -far, zoom }, bounds, viewport);
        expect(screenY(bounds.minY, up)).toBeCloseTo((1 - PAN_EDGE_FRACTION) * viewport.height);
    });

    it("lets a map smaller than the screen drift but never leave", () => {
        const tiny = { minX: -0.5, minY: -0.5, maxX: 0.5, maxY: 0.5 };
        const cam = clampCameraToMap({ x: 999, y: -999, zoom: 1 }, tiny, viewport);
        expect(screenX(tiny.maxX, cam)).toBeCloseTo(PAN_EDGE_FRACTION * viewport.width);
        expect(screenY(tiny.minY, cam)).toBeCloseTo((1 - PAN_EDGE_FRACTION) * viewport.height);
    });

    it("passes through when there is nothing to anchor to", () => {
        const cam = { x: 50, y: 50, zoom: 1 };
        expect(clampCameraToMap(cam, null, viewport)).toBe(cam);
        expect(clampCameraToMap(cam, bounds, { width: 0, height: 0 })).toBe(cam);
    });
});
