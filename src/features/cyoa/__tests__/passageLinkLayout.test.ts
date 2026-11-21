import { describe, expect, it } from "vitest";
import { layoutPassageLinks } from "../passageLinkLayout";

/** Tests for the story editor's link-gutter layout (src/features/cyoa/passageLinkLayout.ts). */

/** A passage whose choices lead to `targets` (null = targetless). */
const p = (id: string, ...targets: Array<string | null>) => ({
    id,
    choices: targets.map((targetPassageId, i) => ({ id: `${id}${i}`, position: i + 1, label: "", targetPassageId })),
});

/** The trunk with a dot on `row` (the first, if several). */
const trunkFrom = (layout: ReturnType<typeof layoutPassageLinks>, row: number) =>
    layout.trunks.find((t) => t.sources.some((s) => s.row === row))!;
const rows = (ends: Array<{ row: number }>) => ends.map((e) => e.row);

describe("layoutPassageLinks", () => {
    it("merges a passage's choices into one trunk with distinct targets", () => {
        const layout = layoutPassageLinks([p("a", "c", "b", "b", null, "gone"), p("b"), p("c")]);
        expect(layout.trunks).toHaveLength(1);
        expect(layout.trunks[0].lane).toBe(0);
        expect(rows(layout.trunks[0].sources)).toEqual([0]);
        expect(rows(layout.trunks[0].targets)).toEqual([1, 2]);
        expect(layout.slotCounts).toEqual([1, 1, 1]);
    });

    it("merges the choices leading into one passage into one trunk with several dots", () => {
        const layout = layoutPassageLinks([p("a", "c"), p("b", "c"), p("c")]);
        expect(layout.trunks).toHaveLength(1);
        expect(rows(layout.trunks[0].sources)).toEqual([0, 1]);
        expect(rows(layout.trunks[0].targets)).toEqual([2]);
    });

    it("merges sources × targets only as a complete block, so no line claims a missing link", () => {
        // a→c, a→d, b→c: one line through all four would claim b→d. Two trunks instead,
        // a's own choices kept together (the tie goes to fewer dots).
        const layout = layoutPassageLinks([p("a", "c", "d"), p("b", "c"), p("c"), p("d")]);
        const links = layout.trunks.flatMap((t) => t.sources.flatMap((s) => t.targets.map((g) => `${s.row}→${g.row}`)));
        expect(links.sort()).toEqual(["0→2", "0→3", "1→2"]);
        expect(rows(trunkFrom(layout, 0).targets)).toEqual([2, 3]);
        // a, b → c, d where every pair is linked: one trunk.
        const full = layoutPassageLinks([p("a", "c", "d"), p("b", "d", "c"), p("c"), p("d")]);
        expect(full.trunks).toHaveLength(1);
    });

    it("puts short trunks inside long ones and lets disjoint trunks share a lane", () => {
        // a→b and c→d are disjoint (lane 0); e reaches back over all of them (lane 1).
        const layout = layoutPassageLinks([p("a", "b"), p("b"), p("c", "d"), p("d"), p("e", "a")]);
        expect([trunkFrom(layout, 0).lane, trunkFrom(layout, 2).lane, trunkFrom(layout, 4).lane]).toEqual([0, 0, 1]);
        expect(layout.laneCount).toBe(2);
    });

    it("hides the trunks that find no lane, counting their links", () => {
        // Three trunks all through row 1, two lanes: the longest (two links) drops out.
        const layout = layoutPassageLinks([p("a", "b"), p("b", "a"), p("c", "a", "b"), p("d")], 2);
        expect(layout.trunks.map((t) => t.sources[0].row).sort()).toEqual([0, 1]);
        expect(layout.hiddenCount).toBe(2);
    });

    it("orders a row's ends: only-up first, then only-down by lane, dot before self-arrow", () => {
        // b, c and e all lead into c → one fan-in trunk {b, c, e} → c (span 1–4, lane 1);
        // c also leads down to d (span 2–3, lane 0).
        const layout = layoutPassageLinks([p("a"), p("b", "c"), p("c", "c", "d"), p("d"), p("e", "c")]);
        const fanIn = layout.trunks.find((t) => t.sources.length === 3)!;
        const down = layout.trunks.find((t) => t !== fanIn)!;
        expect(rows(fanIn.targets)).toEqual([2]);
        expect([down.lane, fanIn.lane]).toEqual([0, 1]);
        expect(layout.slotCounts[2]).toBe(3);
        // Row 2: the fan-in runs through it (dot, then its self-arrow); c→d runs only down.
        const cDot = fanIn.sources.find((s) => s.row === 2)!;
        expect([cDot.slot, fanIn.targets[0].slot, down.sources[0].slot]).toEqual([0, 1, 2]);
    });
});
