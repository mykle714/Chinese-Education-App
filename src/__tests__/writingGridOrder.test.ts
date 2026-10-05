import { describe, expect, it } from "vitest";
import { moveItem } from "../games/writing-grid/gridOrder";

describe("moveItem (Writing Grid Phase 1)", () => {
    const eight = ["a", "b", "c", "d", "e", "f", "g", "h"];
    it("moves (1,1) to (4,2) by shifting everything back one place, not swapping", () => {
        expect(moveItem(eight, 0, 7)).toEqual(["b", "c", "d", "e", "f", "g", "h", "a"]);
    });
    it("moves backwards too", () => {
        expect(moveItem(eight, 6, 1)).toEqual(["a", "g", "b", "c", "d", "e", "f", "h"]);
    });
    it("is a no-op for from === to", () => {
        expect(moveItem(eight, 3, 3)).toEqual(eight);
    });
});
