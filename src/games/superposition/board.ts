import { resampleStroke, type Point } from "../../components/handwriting/inkGeometry";

/**
 * Superposition's board rules (docs/SUPERPOSITION_GAME.md) — pure, no React.
 *
 * Tiles live on a grid of whole units. A STACK is the tiles sharing one exact position, and
 * a stack is a finished character only when it holds that character's tiles and nothing
 * else. A tile carries a natural part, or strokes merged by ink. Overlapping at an offset is not a stack.
 */

/** A character as the game reads it: each stroke's outline and centreline. */
export interface BoardCharacter {
    char: string;
    strokes: string[];
    medians: number[][][];
    /** Stroke indices of its natural parts (strokeParts.json). Each part keeps a tile of its own. */
    parts?: readonly (readonly number[])[];
}

/** One tile's worth of a character: the `groupIndex`th group of its strokes. */
export interface GroupRef {
    charIndex: number;
    groupIndex: number;
}

/** A tile: one or more strokes of a character. `z` is its place in the pile order: higher is on top. */
export interface Tile {
    id: number;
    /** The outlines to draw. */
    paths: string[];
    /** The group it was cut from. */
    source: GroupRef;
    /** Every group this tile may stand in for: its source and its lookalikes. */
    accepts: GroupRef[];
    x: number;
    y: number;
    z: number;
}

const COMPARE_POINTS = 24;
/** Line segments per curve when measuring a stroke's outline. */
const CURVE_SEGMENTS = 8;
/** Points each outline command reads. The hanzi-writer data uses only these, absolute. */
const COMMAND_POINTS: Record<string, number> = { M: 1, L: 1, Q: 2, C: 3 };

type Coordinate = [number, number];

/** A point along a Bézier curve of any order (de Casteljau). */
function bezierAt(points: readonly Coordinate[], t: number): Coordinate {
    if (points.length === 1) return points[0];
    const next = points.slice(1).map((point, i): Coordinate => [
        points[i][0] + (point[0] - points[i][0]) * t,
        points[i][1] + (point[1] - points[i][1]) * t,
    ]);
    return bezierAt(next, t);
}

/**
 * A stroke's ink: the area of its outline in square glyph units. Curves are flattened into
 * short segments and the polygon is measured with the shoelace formula.
 */
export function strokeInk(path: string): number {
    const tokens = path.match(/[A-Z]|-?\d*\.?\d+/g) ?? [];
    const outline: Coordinate[] = [];
    let i = 0;
    while (i < tokens.length) {
        const pointCount = COMMAND_POINTS[tokens[i++]];
        if (!pointCount) continue;
        const points: Coordinate[] = [];
        for (let p = 0; p < pointCount; p++) {
            points.push([Number(tokens[i]), Number(tokens[i + 1])]);
            i += 2;
        }
        if (pointCount === 1) {
            outline.push(points[0]);
        } else {
            const curve = [outline[outline.length - 1] ?? points[0], ...points];
            for (let k = 1; k <= CURVE_SEGMENTS; k++) outline.push(bezierAt(curve, k / CURVE_SEGMENTS));
        }
    }
    const doubled = outline.reduce((sum, [x, y], index) => {
        const [nextX, nextY] = outline[(index + 1) % outline.length];
        return sum + x * nextY - nextX * y;
    }, 0);
    return Math.abs(doubled) / 2;
}

/**
 * Group a character's strokes into tiles by ink. Strokes go smallest first into the open
 * group, and a group closes once its ink reaches the threshold, so small strokes pool
 * together and a big stroke stands alone. A character that would collapse into one tile
 * loses its largest stroke to a second tile: a lone tile is already a finished stack.
 * Returns stroke indices per group.
 */
export function groupStrokesByInk(paths: readonly string[], inkThreshold: number): number[][] {
    const groups = mergeByInk(paths.map((_, strokeIndex) => strokeIndex), paths, inkThreshold);
    if (groups.length === 1 && groups[0].length > 1) {
        const largest = groups[0].pop()!;
        groups.push([largest]);
    }
    return groups;
}

/** The ink pass over the given strokes: smallest first, a group closing at the threshold. */
function mergeByInk(strokeIndices: readonly number[], paths: readonly string[], inkThreshold: number): number[][] {
    const byInk = strokeIndices
        .map((strokeIndex) => ({ strokeIndex, ink: strokeInk(paths[strokeIndex]) }))
        .sort((a, b) => a.ink - b.ink);
    const groups: number[][] = [];
    let open: number[] = [];
    let openInk = 0;
    for (const { strokeIndex, ink } of byInk) {
        open.push(strokeIndex);
        openInk += ink;
        if (openInk >= inkThreshold) {
            groups.push(open);
            open = [];
            openInk = 0;
        }
    }
    if (open.length > 0) groups.push(open);
    return groups;
}

/**
 * A character's tiles: its natural parts first, each a closed group, then the strokes left
 * over merged by ink. Parts that do not fit the glyph are ignored, leaving the ink rule.
 */
export function groupStrokes(paths: readonly string[], parts: readonly (readonly number[])[], inkThreshold: number): number[][] {
    if (parts.length === 0 || parts.some((part) => part.some((stroke) => stroke >= paths.length))) {
        return groupStrokesByInk(paths, inkThreshold);
    }
    const claimed = new Set(parts.flat());
    const leftover = paths.map((_, strokeIndex) => strokeIndex).filter((strokeIndex) => !claimed.has(strokeIndex));
    return [...parts.map((part) => [...part]), ...mergeByInk(leftover, paths, inkThreshold)];
}

function worstGap(a: readonly Point[], b: readonly Point[]): number {
    let worst = 0;
    for (let i = 0; i < a.length && i < b.length; i++) {
        worst = Math.max(worst, Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]));
    }
    return worst;
}

/** Two groups look alike when they hold as many strokes and each pair, in ink order, does. */
function groupsLookAlike(a: readonly Point[][], b: readonly Point[][], toleranceUnits: number): boolean {
    return a.length === b.length && a.every((line, i) => worstGap(line, b[i]) <= toleranceUnits);
}

/** The board's tiles, unplaced (x, y and z are 0): one per stroke group, in reading order. */
export function buildTiles(characters: readonly BoardCharacter[], toleranceUnits: number, inkThreshold: number): Tile[] {
    const refs: (GroupRef & { lines: Point[][]; paths: string[] })[] = characters.flatMap((character, charIndex) =>
        groupStrokes(character.strokes, character.parts ?? [], inkThreshold).map((strokeIndices, groupIndex) => ({
            charIndex,
            groupIndex,
            paths: strokeIndices.map((strokeIndex) => character.strokes[strokeIndex]),
            lines: strokeIndices.map((strokeIndex) =>
                resampleStroke((character.medians[strokeIndex] ?? []).map(([x, y]): Point => [x, y]), COMPARE_POINTS)
            ),
        }))
    );
    return refs.map((ref, id) => ({
        id,
        paths: ref.paths,
        source: { charIndex: ref.charIndex, groupIndex: ref.groupIndex },
        accepts: refs
            .filter((other) => other === ref || groupsLookAlike(ref.lines, other.lines, toleranceUnits))
            .map(({ charIndex, groupIndex }) => ({ charIndex, groupIndex })),
        x: 0,
        y: 0,
        z: 0,
    }));
}

/** Where a deal may put tiles, in grid units. */
export interface SpawnZone {
    /** Clear space kept from every edge. */
    marginUnits: number;
    /** The top rows to keep clear as well, for what is drawn there. */
    topUnits: number;
    /** How far tile positions spread, on each axis, inside the bunch. */
    spreadUnits: number;
}

/**
 * Deal tiles in a tight bunch at the bottom centre of a cols × rows grid, in a random pile
 * order. Tiles overlap freely, but a position that would start as a stack is re-rolled: a
 * stack must be the player's move. A board too small for the zone gets what fits, and a tile
 * always stays on it.
 */
export function scatterTiles(
    tiles: readonly Tile[],
    cols: number,
    rows: number,
    tileUnits: number,
    { marginUnits, topUnits, spreadUnits }: SpawnZone,
    random: () => number = Math.random
): Tile[] {
    // The positions an axis allows before the bunch narrows them.
    const axisRange = (gridSize: number, leadUnits: number) => {
        const last = Math.max(0, gridSize - tileUnits);
        const inset = Math.min(marginUnits, Math.floor(last / 2));
        const high = last - inset;
        return { low: Math.min(Math.max(leadUnits, inset), high), high };
    };
    const across = axisRange(cols, 0);
    const down = axisRange(rows, topUnits);
    const middle = Math.round((across.low + across.high) / 2);
    const fromX = Math.max(across.low, middle - Math.floor(spreadUnits / 2));
    const toX = Math.min(across.high, middle + Math.ceil(spreadUnits / 2));
    const fromY = Math.max(down.low, down.high - spreadUnits);
    const roll = (from: number, to: number) => from + Math.floor(random() * (to - from + 1));
    const order = tiles.map((tile) => ({ tile, key: random() })).sort((a, b) => a.key - b.key);
    const taken = new Set<string>();
    return order.map(({ tile }, z) => {
        let x = 0;
        let y = 0;
        for (let attempt = 0; attempt < 64; attempt++) {
            x = roll(fromX, toX);
            y = roll(fromY, down.high);
            if (!taken.has(`${x},${y}`)) break;
        }
        taken.add(`${x},${y}`);
        return { ...tile, x, y, z };
    });
}

/** Every tile whose box holds the grid point, topmost first. */
export function tilesAt(tiles: readonly Tile[], x: number, y: number, tileUnits: number): Tile[] {
    return tiles
        .filter((tile) => x >= tile.x && x < tile.x + tileUnits && y >= tile.y && y < tile.y + tileUnits)
        .sort((a, b) => b.z - a.z);
}

/**
 * What a tap selects, the card icon editor's rule (CardIconCanvas → `pickTapTarget`): a tap
 * on a fresh pile takes its top tile, and a repeat tap steps to the tile behind the current
 * selection, wrapping back to the top. Null when the tap hit no tile.
 */
export function nextTapSelection(hits: readonly Tile[], selectedId: number | null): number | null {
    if (hits.length === 0) return null;
    const position = hits.findIndex((tile) => tile.id === selectedId);
    return hits[position === -1 ? 0 : (position + 1) % hits.length].id;
}

/** What a drag from a pile lifts: the selected tile if it is in the pile, else the top one. */
export function dragTarget(hits: readonly Tile[], selectedId: number | null): number | null {
    if (hits.length === 0) return null;
    return hits.some((tile) => tile.id === selectedId) ? selectedId : hits[0].id;
}

/**
 * Can every tile in `stack` take a different group of `charIndex`, covering them all?
 * A matching rather than a simple check, because lookalikes are not transitive: a group
 * can sit within tolerance of two others that are outside it of each other.
 */
function stackFillsCharacter(stack: readonly Tile[], charIndex: number, groupCount: number): boolean {
    if (stack.length !== groupCount) return false;
    const owner = new Array<number>(groupCount).fill(-1);
    const seat = (tileIndex: number, visited: boolean[]): boolean => {
        for (const { charIndex: c, groupIndex } of stack[tileIndex].accepts) {
            if (c !== charIndex || visited[groupIndex]) continue;
            visited[groupIndex] = true;
            if (owner[groupIndex] === -1 || seat(owner[groupIndex], visited)) {
                owner[groupIndex] = tileIndex;
                return true;
            }
        }
        return false;
    };
    return stack.every((_, tileIndex) => seat(tileIndex, new Array<boolean>(groupCount).fill(false)));
}

/**
 * The finished stacks: `${x},${y}` → the character index that stack completes.
 *
 * A tile held in a drag (`liftedId`) sits in no stack, so passing over a position finishes
 * nothing and lifting a tile out unfinishes its stack at once. It still counts towards its
 * character's size, or the rest of that character would read as a whole one.
 */
export function completedStacks(tiles: readonly Tile[], liftedId: number | null = null): Map<string, number> {
    const stacks = new Map<string, Tile[]>();
    const groupCounts: number[] = [];
    for (const tile of tiles) {
        groupCounts[tile.source.charIndex] = (groupCounts[tile.source.charIndex] ?? 0) + 1;
        if (tile.id === liftedId) continue;
        const key = stackKey(tile);
        stacks.set(key, [...(stacks.get(key) ?? []), tile]);
    }
    const done = new Map<string, number>();
    stacks.forEach((stack, key) => {
        const charIndex = groupCounts.findIndex((count, index) => stackFillsCharacter(stack, index, count));
        if (charIndex !== -1) done.set(key, charIndex);
    });
    return done;
}

export const stackKey = (tile: Pick<Tile, "x" | "y">): string => `${tile.x},${tile.y}`;

/** Snap a pixel offset to the nearest unit, keeping a whole tile on the board. */
export function snapToGrid(px: number, unitPx: number, gridSize: number, tileUnits: number): number {
    return Math.max(0, Math.min(Math.max(0, gridSize - tileUnits), Math.round(px / unitPx)));
}
