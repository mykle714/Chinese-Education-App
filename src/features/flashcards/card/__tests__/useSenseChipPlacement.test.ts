import { describe, expect, it } from "vitest";
import { senseChipFitsRight } from "../useSenseChipPlacement";

// Docs: docs/CARD_ICON_LAYOUT.md "Movable text".
describe("senseChipFitsRight", () => {
    const base = { centerX: 150, chipWidth: 44, gap: 8, scale: 1, boundaryRight: 270 };

    it("fits when the chip ends exactly at the boundary", () => {
        expect(senseChipFitsRight({ ...base, textWidth: 136 })).toBe(true);
    });

    it("does not fit one pixel past the boundary", () => {
        expect(senseChipFitsRight({ ...base, textWidth: 138 })).toBe(false);
    });

    it("counts the block's scale", () => {
        expect(senseChipFitsRight({ ...base, textWidth: 100, scale: 1.5 })).toBe(false);
    });

    it("counts a block placed off-center", () => {
        expect(senseChipFitsRight({ ...base, textWidth: 100, centerX: 200 })).toBe(false);
    });
});
