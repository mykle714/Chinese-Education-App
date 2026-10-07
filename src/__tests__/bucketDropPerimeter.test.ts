import { describe, it, expect } from "vitest";
import { layoutPerimeter, DEFAULT_PERIMETER_RULES } from "../games/bucket-drop/perimeterLayout";

const FIELDS = [[260, 480], [320, 480], [340, 520], [390, 700], [768, 900]];

describe("Bucket Drop bucket layout", () => {
    it("makes every bucket the same square, on every field", () => {
        const { size } = DEFAULT_PERIMETER_RULES;
        for (const [w, h] of FIELDS) {
            for (const s of layoutPerimeter(w, h).slots) {
                expect(s.width).toBe(size);
                expect(s.height).toBe(size);
            }
        }
    });

    it("puts every bucket in one row along the top", () => {
        for (const [w, h] of FIELDS) {
            const { slots } = layoutPerimeter(w, h);
            expect(slots.length).toBeGreaterThan(0);
            expect(new Set(slots.map((s) => s.y)).size).toBe(1);
            expect(slots[0].y).toBeLessThan(h / 2);
        }
    });

    it("fits three on a phone-sized field", () => {
        expect(layoutPerimeter(340, 520).slots).toHaveLength(3);
    });

    it("keeps every bucket inside the field, in left-to-right order", () => {
        for (const [w, h] of FIELDS) {
            const { slots } = layoutPerimeter(w, h);
            slots.forEach((s, i) => {
                expect(s.index).toBe(i);
                expect(s.x).toBeGreaterThanOrEqual(0);
                expect(s.x + s.width).toBeLessThanOrEqual(w + 1e-6);
                expect(s.y + s.height).toBeLessThanOrEqual(h + 1e-6);
                if (i > 0) expect(s.x).toBeGreaterThan(slots[i - 1].x + slots[i - 1].width);
            });
        }
    });

    it("spaces evenly: one gap between buckets, against the side edges, and against the top edge", () => {
        for (const [w] of FIELDS) {
            const { slots } = layoutPerimeter(w, 700);
            const gap = slots[0].x;
            expect(gap).toBeGreaterThanOrEqual(DEFAULT_PERIMETER_RULES.minGap);
            for (let i = 1; i < slots.length; i++) expect(slots[i].x - (slots[i - 1].x + slots[i - 1].width)).toBeCloseTo(gap);
            const last = slots[slots.length - 1];
            expect(w - (last.x + last.width)).toBeCloseTo(gap);
            // Phone and tablet widths never reach the inset ceiling.
            expect(gap).toBeLessThanOrEqual(DEFAULT_PERIMETER_RULES.maxEdgeInset);
            expect(slots[0].y).toBeCloseTo(gap);
        }
    });

    it("deals the pile below the row", () => {
        const { slots, stack } = layoutPerimeter(340, 520);
        expect(stack.y).toBeGreaterThan(slots[0].y + slots[0].height);
        expect(stack.height).toBeGreaterThan(0);
    });

    it("caps the count on a very wide field, clamping the top inset", () => {
        const { slots } = layoutPerimeter(3000, 900);
        expect(slots).toHaveLength(DEFAULT_PERIMETER_RULES.maxBuckets);
        expect(slots[0].y).toBe(DEFAULT_PERIMETER_RULES.maxEdgeInset);
    });

    it("returns no slots for an unmeasured field", () => {
        expect(layoutPerimeter(0, 0).slots).toEqual([]);
    });
});
