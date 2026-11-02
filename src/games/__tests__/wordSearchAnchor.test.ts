import { describe, expect, it } from "vitest";
import { anchoredBandHeight } from "../word-search/useGridScreenAnchor";

describe("anchoredBandHeight", () => {
    it("centres the board on the anchor line when it fits", () => {
        // panel 700, hint 60, board 300, line at 400: the board spans 250–550
        expect(anchoredBandHeight(400, 700, 60, 300)).toBe(250);
    });

    it("stops the board against the hint row", () => {
        // the line alone would end the board at 700, past the row's top at 640
        expect(anchoredBandHeight(550, 700, 60, 300)).toBe(340);
    });

    it("never goes negative on a board taller than the panel's room", () => {
        expect(anchoredBandHeight(100, 300, 60, 400)).toBe(0);
    });
});
