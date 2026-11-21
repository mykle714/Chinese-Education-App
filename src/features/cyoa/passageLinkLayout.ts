import type { StoryPassageEdit } from "../../../server/contracts/stories";

/**
 * passageLinkLayout.ts — where the story editor's LINK LINES go (docs/CYOA_FEATURE.md
 * § 5.2). The passage list stays a list (§ 5: "a passage list, not a node map"); a gutter
 * on its right draws the story's links as merged lines — TRUNKS. A trunk leaves each of
 * its SOURCE passages at a dot, runs along its lane, and branches into each of its TARGET
 * passages with an arrowhead. Lines out of one passage merge (owner's call 2026-11-21:
 * "lines coming out of the same passage can be merged into one multi targeted line"), and
 * so do lines into one passage (owner's call 2026-11-21: "we should also support multiple
 * source arrows merged together"):
 *
 *   fan-out                         fan-in
 *   │ Passage 1   │●──┐             │ Passage 1   │●──┐
 *   │ The forest  │◀──┤             │ The forest  │●──┤
 *   │ Passage 3   │◀──┘             │ Passage 3   │◀──┘
 *
 * Pure: passages in, lanes and anchor slots out. The component (StoryPassageLinks.tsx)
 * turns slots into pixels from the measured rows. Unit-tested in
 * src/features/cyoa/__tests__/passageLinkLayout.test.ts.
 *
 * ── Trunks: every dot leads to every arrow ─────────────────────────────────────
 * The links are the DISTINCT (source → target) pairs: two choices into one passage are one
 * link; a targetless choice or a stale id is none; a choice back into its own passage is a
 * link whose dot and arrow sit on the same row (a small loop). A trunk is drawn as one
 * line, so it can only mean "each of these sources leads to each of these targets" — it
 * must be a COMPLETE source × target block of links, or the line would show links that
 * don't exist (a→x, a→y, b→x merged into one line would claim b→y). Each link belongs to
 * exactly one trunk.
 *
 * The blocks are chosen greedily: every passage proposes the largest block it anchors —
 * a source proposes its remaining targets with every source that still links to all of
 * them; a target proposes its remaining sources with every target they all still reach —
 * and the block covering the most links is taken, its links removed, and the proposals
 * redone until no link is left. Ties go to the block with FEWER sources (so a passage's own
 * choices stay together, the original fan-out), then to the one starting higher up. A pure
 * fan-out (one source) and a pure fan-in (one target) are the common cases; a passage may
 * end up with dots on more than one trunk.
 *
 * ── Lanes ─────────────────────────────────────────────────────────────────────
 * A trunk occupies the closed row interval from its highest to its lowest end (sources and
 * targets together). Two trunks whose intervals share any row need different lanes; trunks
 * that don't can share one. Trunks are placed SHORTEST FIRST, each into the lowest free
 * lane — short hops hug the rows, long jumps take the outer lanes. At most MAX_LINK_LANES
 * lanes (owner's call 2026-11-21: "layer up to 10"); a trunk that finds none free is
 * HIDDEN with all its links (`hiddenCount` counts the links).
 *
 * ── Anchor slots ──────────────────────────────────────────────────────────────
 * Every end (a dot, an arrowhead) gets its own slot on its row's right edge, spread evenly
 * down the row, so ends never share a point. Within a row, ends are grouped by where their
 * trunk runs from this row: trunks that run only UPWARD first (outer lane highest), then
 * trunks that run THROUGH or stay on the row, then trunks that run only DOWNWARD (outer
 * lane lowest). That keeps a row's stubs from crossing each other's lanes; one trunk's own
 * ends on a row keep dot-then-arrow order.
 *
 * Layer: feature model (src/features/cyoa). Depended on by: StoryPassageLinks.tsx,
 * StoryPassageList.tsx.
 */

// ── Gutter geometry (px). Kept here, beside the lanes it spaces, so the list can size
// the gutter without importing from a component file (react-refresh). ──
/** x of lane 0's vertical, from the rows' right edge. */
export const FIRST_LANE_X = 10;
/** Spacing between lane verticals. */
export const LANE_GAP = 7;
/** Room past the outermost lane. */
const GUTTER_TAIL = 5;

/** Gutter width for `laneCount` lanes (0 → no gutter: the rows keep their full width). */
export function linkGutterWidth(laneCount: number): number {
    return laneCount === 0 ? 0 : FIRST_LANE_X + (laneCount - 1) * LANE_GAP + GUTTER_TAIL;
}

/** A measured passage row, px from the top of the list. */
export interface RowBox {
    top: number;
    height: number;
}

/** Most lanes the gutter draws; links beyond it are not shown. */
export const MAX_LINK_LANES = 10;

/** One end of a trunk — a source's dot or a target's arrowhead. */
export interface TrunkEnd {
    row: number;
    /** This end's slot on its row, 0-based, out of `slotCounts[row]`. */
    slot: number;
}

/** One drawn trunk: every source leads to every target. Rows index the passage list. */
export interface PassageTrunk {
    lane: number;
    /** Dots, in list order (≥ 1). */
    sources: TrunkEnd[];
    /** Arrowheads, in list order (≥ 1). */
    targets: TrunkEnd[];
}

export interface PassageLinkLayout {
    trunks: PassageTrunk[];
    /** row → how many trunk ends sit on it (the slot denominator). */
    slotCounts: number[];
    /** Lanes in use (0…MAX_LINK_LANES) — sizes the gutter. */
    laneCount: number;
    /** Links (passage → passage) of the trunks that found no lane. */
    hiddenCount: number;
}

/** A trunk end awaiting its slot. */
interface PendingEnd {
    trunk: PassageTrunk;
    end: TrunkEnd;
    isDot: boolean;
    /** Where the trunk runs from this row: −1 only up, 0 through / stays, +1 only down. */
    direction: number;
}

/** A candidate trunk: a complete block of links, sources × targets (sorted rows). */
interface LinkBlock {
    sources: number[];
    targets: number[];
}

const ascending = (a: number, b: number) => a - b;
const containsAll = (set: Set<number> | undefined, rows: number[]) => !!set && rows.every((row) => set.has(row));

/**
 * Cover every link with complete source × target blocks, greedily (see header, "Trunks").
 * `outgoing`: source row → the target rows it links to.
 */
function mergeLinks(outgoing: Map<number, Set<number>>): LinkBlock[] {
    const out = new Map([...outgoing].map(([source, targets]) => [source, new Set(targets)]));
    const incoming = new Map<number, Set<number>>();
    for (const [source, targets] of out) {
        for (const target of targets) {
            if (!incoming.has(target)) incoming.set(target, new Set());
            incoming.get(target)!.add(source);
        }
    }
    const blocks: LinkBlock[] = [];
    for (;;) {
        let best: LinkBlock | null = null;
        const better = (block: LinkBlock) => {
            if (!best) return true;
            const size = block.sources.length * block.targets.length;
            const bestSize = best.sources.length * best.targets.length;
            if (size !== bestSize) return size > bestSize;
            if (block.sources.length !== best.sources.length) return block.sources.length < best.sources.length;
            return Math.min(block.sources[0], block.targets[0]) < Math.min(best.sources[0], best.targets[0]);
        };
        // A source's proposal: its targets, with every source that reaches them all.
        for (const targetSet of out.values()) {
            if (targetSet.size === 0) continue;
            const targets = [...targetSet].sort(ascending);
            const sources = [...out.keys()].filter((s) => containsAll(out.get(s), targets)).sort(ascending);
            const block = { sources, targets };
            if (better(block)) best = block;
        }
        // A target's proposal: its sources, with every target they all reach.
        for (const sourceSet of incoming.values()) {
            if (sourceSet.size === 0) continue;
            const sources = [...sourceSet].sort(ascending);
            const targets = [...incoming.keys()].filter((t) => containsAll(incoming.get(t), sources)).sort(ascending);
            const block = { sources, targets };
            if (better(block)) best = block;
        }
        if (!best) return blocks;
        const taken: LinkBlock = best;
        blocks.push(taken);
        for (const source of taken.sources) {
            for (const target of taken.targets) {
                out.get(source)!.delete(target);
                incoming.get(target)!.delete(source);
            }
        }
    }
}

export function layoutPassageLinks(passages: Array<Pick<StoryPassageEdit, "id" | "choices">>, maxLanes: number = MAX_LINK_LANES): PassageLinkLayout {
    const rowOf = new Map(passages.map((passage, index) => [passage.id, index]));

    // 1. The distinct links, then merged into complete blocks.
    const outgoing = new Map<number, Set<number>>();
    passages.forEach((passage, fromRow) => {
        for (const choice of passage.choices) {
            const toRow = choice.targetPassageId ? rowOf.get(choice.targetPassageId) : undefined;
            if (toRow === undefined) continue; // targetless or stale id
            if (!outgoing.has(fromRow)) outgoing.set(fromRow, new Set());
            outgoing.get(fromRow)!.add(toRow);
        }
    });
    const candidates = mergeLinks(outgoing).map((block) => {
        const rows = [...block.sources, ...block.targets];
        return { ...block, lo: Math.min(...rows), hi: Math.max(...rows) };
    });

    // 2. Lanes: shortest span first (ties: higher up first), lowest free lane.
    const ordered = [...candidates].sort((a, b) => (a.hi - a.lo) - (b.hi - b.lo) || a.lo - b.lo);
    const occupied: Array<Array<[number, number]>> = Array.from({ length: maxLanes }, () => []);
    const placed: Array<{ trunk: PassageTrunk; lo: number; hi: number }> = [];
    let hiddenCount = 0;
    for (const { sources, targets, lo, hi } of ordered) {
        const lane = occupied.findIndex((intervals) => intervals.every(([a, b]) => hi < a || lo > b));
        if (lane === -1) {
            hiddenCount += sources.length * targets.length;
            continue;
        }
        occupied[lane].push([lo, hi]);
        const toEnds = (rows: number[]) => rows.map((row) => ({ row, slot: 0 }));
        placed.push({ trunk: { lane, sources: toEnds(sources), targets: toEnds(targets) }, lo, hi });
    }

    // 3. Slots: gather each row's trunk ends, order them (see header), number them.
    const ends: PendingEnd[][] = passages.map(() => []);
    for (const { trunk, lo, hi } of placed) {
        const directionAt = (row: number) => (row === hi && row > lo ? -1 : row === lo && row < hi ? 1 : 0);
        for (const end of trunk.sources) ends[end.row].push({ trunk, end, isDot: true, direction: directionAt(end.row) });
        for (const end of trunk.targets) ends[end.row].push({ trunk, end, isDot: false, direction: directionAt(end.row) });
    }
    const slotCounts = ends.map((rowEnds) => {
        rowEnds.sort((a, b) => {
            if (a.direction !== b.direction) return a.direction - b.direction;
            if (a.trunk !== b.trunk) {
                // Only up: outer lane first. Only down: outer lane last. Through: inner first.
                return a.direction < 0 ? b.trunk.lane - a.trunk.lane : a.trunk.lane - b.trunk.lane;
            }
            return Number(b.isDot) - Number(a.isDot); // the dot, then its self-arrow
        });
        rowEnds.forEach((pending, slot) => {
            pending.end.slot = slot;
        });
        return rowEnds.length;
    });

    const trunks = placed.map((entry) => entry.trunk);
    const laneCount = trunks.reduce((most, trunk) => Math.max(most, trunk.lane + 1), 0);
    return { trunks, slotCounts, laneCount, hiddenCount };
}
