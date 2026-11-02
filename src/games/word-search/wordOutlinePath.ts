import type { Coord } from "./types";

/**
 * SVG path data for one continuous outline around a set of grid cells — the shape
 * the reviewing state draws around a found word (or the drill rung of it).
 *
 * Pure grid arithmetic, no DOM measurement: every board tile is a square `cellSide`
 * track separated by `gap`, so a cell's position follows from its row and column.
 * (The removed selection "stadium" had to measure the board because it was anchored
 * to character centers; this is anchored to tile edges, which never move.)
 *
 * The cells are treated as a SET, not as the word's path: a word that doubles back
 * on itself (a U, a 2×2 block) encloses its inner gutter instead of tracing it, and a
 * word that closes a ring around a foreign cell yields a second loop for the hole.
 *
 * Referenced by docs/WORD_SEARCH_GAME.md § The selection system.
 */
export interface OutlineGeometry {
    /** Tile side (px). */
    cellSide: number;
    /** Gutter between tiles (px). */
    gap: number;
    /** Distance (px) from the grid's padding box to tile (0,0). */
    origin: number;
    /** How far (px) the line sits OUTSIDE the tile edge, into the gutter. */
    outset: number;
    /** Radius (px) of the line's outer turns, around the word's own tiles. */
    radius: number;
    /** Radius (px) of its inner turns, around a neighbouring tile's corner. */
    concaveRadius: number;
}

/** Clockwise order, so `dir + 1` is a right turn: the interior is always on the right. */
const EAST = 0;
const SOUTH = 1;
const WEST = 2;
const NORTH = 3;
const STEP: readonly Coord[] = [[0, 1], [1, 0], [0, -1], [-1, 0]]; // [row, col] per direction

/** One boundary segment between two lattice corners of the board. */
interface Edge {
    row: number; // start corner
    col: number;
    dir: number;
    used: boolean;
}

/** The boundary line of an edge, in px, on its fixed axis (y for E/W, x for N/S). */
function lineOf(edge: Edge, g: OutlineGeometry): number {
    const pitch = g.cellSide + g.gap;
    switch (edge.dir) {
        case EAST: // a tile's top: its corner row IS the tile's row
            return g.origin + edge.row * pitch - g.outset;
        case SOUTH: // a tile's right: the corner column is one past the tile
            return g.origin + (edge.col - 1) * pitch + g.cellSide + g.outset;
        case WEST: // a tile's bottom: the corner row is one past the tile
            return g.origin + (edge.row - 1) * pitch + g.cellSide + g.outset;
        default: // NORTH — a tile's left
            return g.origin + edge.col * pitch - g.outset;
    }
}

/** Every tile side that does not face another tile of the set, directed clockwise. */
function boundaryEdges(cells: Coord[]): Map<string, Edge[]> {
    const members = new Set(cells.map(([r, c]) => `${r},${c}`));
    const edges = new Map<string, Edge[]>();
    const add = (row: number, col: number, dir: number) => {
        const k = `${row},${col}`;
        const edge: Edge = { row, col, dir, used: false };
        const atCorner = edges.get(k);
        if (atCorner) atCorner.push(edge);
        else edges.set(k, [edge]);
    };
    for (const k of members) {
        const [r, c] = k.split(",").map(Number);
        if (!members.has(`${r - 1},${c}`)) add(r, c, EAST);
        if (!members.has(`${r},${c + 1}`)) add(r, c + 1, SOUTH);
        if (!members.has(`${r + 1},${c}`)) add(r + 1, c + 1, WEST);
        if (!members.has(`${r},${c - 1}`)) add(r + 1, c, NORTH);
    }
    return edges;
}

/**
 * Walk one closed loop from `start`, returning one edge per straight run.
 * At a pinch (two tiles touching only at a corner) two edges leave the same lattice
 * corner; preferring the right turn keeps each loop hugging its own tile.
 */
function walkLoop(start: Edge, edges: Map<string, Edge[]>): Edge[] {
    const runs: Edge[] = [];
    let current: Edge | undefined = start;
    while (current) {
        current.used = true;
        if (runs[runs.length - 1]?.dir !== current.dir) runs.push(current);
        const edge: Edge = current;
        const atEnd = edges.get(`${edge.row + STEP[edge.dir][0]},${edge.col + STEP[edge.dir][1]}`) ?? [];
        current = [edge.dir + 1, edge.dir, edge.dir + 3]
            .map((dir) => atEnd.find((e) => !e.used && e.dir === dir % 4))
            .find(Boolean);
    }
    // A loop that began mid-run ends on that run's other half.
    if (runs.length > 1 && runs[0].dir === runs[runs.length - 1].dir) runs.pop();
    return runs;
}

/** Rounded-corner path data for one loop. */
function loopToPath(runs: Edge[], g: OutlineGeometry): string {
    const n = runs.length;
    // Corner i joins run i to run i+1: one run fixes its y, the other its x.
    const corners = runs.map((run, i) => {
        const next = runs[(i + 1) % n];
        const horizontal = run.dir === EAST || run.dir === WEST ? run : next;
        const vertical = horizontal === run ? next : run;
        return { x: lineOf(vertical, g), y: lineOf(horizontal, g), inDir: run.dir, outDir: next.dir };
    });
    const round = (v: number) => Math.round(v * 100) / 100;
    const parts: string[] = [];
    corners.forEach(({ x, y, inDir, outDir }, i) => {
        const [inDy, inDx] = STEP[inDir];
        const [outDy, outDx] = STEP[outDir];
        const rightTurn = (outDir - inDir + 4) % 4 === 1;
        const r = rightTurn ? g.radius : g.concaveRadius;
        const entry = `${round(x - inDx * r)} ${round(y - inDy * r)}`;
        parts.push(`${i === 0 ? "M" : "L"}${entry}`);
        const sweep = rightTurn ? 1 : 0; // the interior is on the right, so right = outer turn
        parts.push(`A${r} ${r} 0 0 ${sweep} ${round(x + outDx * r)} ${round(y + outDy * r)}`);
    });
    return `${parts.join(" ")} Z`;
}

/** `d` for an SVG path outlining `cells`; empty when there are none. */
export function wordOutlinePath(cells: Coord[], geometry: OutlineGeometry): string {
    const edges = boundaryEdges(cells);
    const loops: string[] = [];
    for (const atCorner of edges.values()) {
        for (const edge of atCorner) {
            if (!edge.used) loops.push(loopToPath(walkLoop(edge, edges), geometry));
        }
    }
    return loops.join(" ");
}
