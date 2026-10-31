import { describe, expect, it } from "vitest";
import { clampTextCenterFully, textBlockMaxWidth } from "../cardTextLayout";

// Docs: docs/CARD_ICON_LAYOUT.md "Movable text", docs/TOWER_STYLE_SHIFT.md § "Card stock".
describe("clampTextCenterFully", () => {
    it("keeps the card-edge bounds when no inset is given", () => {
        expect(clampTextCenterFully(0, 1, 0.2, 0.1)).toEqual({ x: 0.2, y: 0.9 });
    });

    it("pulls the block in by the panel inset", () => {
        const { x, y } = clampTextCenterFully(0, 1, 0.2, 0.1, 0.07, 0.05);
        expect(x).toBeCloseTo(0.27);
        expect(y).toBeCloseTo(0.85);
    });

    it("centers a block too wide for the inset area", () => {
        expect(clampTextCenterFully(0.2, 0.5, 0.45, 0.1, 0.07).x).toBe(0.5);
    });
});

describe("textBlockMaxWidth", () => {
    it("divides the panel width by the block's scale", () => {
        expect(textBlockMaxWidth(2)).toBe("min(92%, calc(var(--card-panel-width, 10000%) / 2))");
    });

    it("falls back to scale 1 for an invalid saved scale", () => {
        expect(textBlockMaxWidth(0)).toBe(textBlockMaxWidth(1));
    });
});
