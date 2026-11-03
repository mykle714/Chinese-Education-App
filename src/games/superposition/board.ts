import { resampleStroke, type Point } from "../../components/handwriting/inkGeometry";
import { groupStrokes, isStrokePartition } from "../../../server/contracts/superpositionGroups";

/**
 * Superposition's board rules (docs/SUPERPOSITION_GAME.md) — pure, no React.
 *
 * Tiles live on a grid of whole units. A STACK is the tiles sharing one exact position, and
 * a stack is a finished character only when it holds that character's tiles and nothing
 * else. A tile carries a run of the character's strokes in writing order, natural parts kept
 * whole, grouped by ink (server/contracts/superpositionGroups.ts). Overlapping at an offset is not a stack.
 *
 * A finished stack LOCKS on the drop that finishes it (`lockFinishedStacks`): its tiles share
 * a `TileLock`, move as one (`moveTile`), select as one (`collapseLocked`) and are never judged
 * again, so a finished character cannot be pulled apart or spoiled by a loose tile on its cell.
 */

/** A character as the game reads it: each stroke's outline and centreline. */
export interface BoardCharacter {
    char: string;
    strokes: string[];
    medians: number[][][];
    /** Stroke indices of its natural parts (strokeParts.json). A part is never split across tiles. */
    parts?: readonly (readonly number[])[];
    /** Its stored stroke groups, when the deal sent them (`SuperpositionCharacter.strokeGroups`). */
    groups?: readonly (readonly number[])[];
}

/** One tile's worth of a character: the `groupIndex`th group of its strokes. */
export interface GroupRef {
    charIndex: number;
    groupIndex: number;
}

/** The fused stack a tile belongs to once its character is finished. */
export interface TileLock {
    /** The stack's id: the smallest tile id in it. Shared by every tile of the stack. */
    id: number;
    /** The character the stack finished. */
    charIndex: number;
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
    /** Set once the tile is part of a finished, fused stack; null while it is loose. */
    lock: TileLock | null;
}

const COMPARE_POINTS = 24;

/**
 * A character's tiles: the groups the deal sent (stored on its det row, while
 * `FEATURE_FLAGS.superpositionStoredGroups` is on) when they partition its strokes, else
 * computed here by the shared rule (server/contracts/superpositionGroups.ts → groupStrokes).
 * `dropRatio` is for tests; the game leaves it out and gets `DENSITY_DROP_RATIO`, the
 * same one the stored-groups backfill uses.
 */
export function characterGroups(character: BoardCharacter, dropRatio?: number): number[][] {
    if (character.groups && isStrokePartition(character.groups, character.strokes.length)) {
        return character.groups.map((group) => [...group]);
    }
    return groupStrokes(character.strokes, character.parts ?? [], dropRatio);
}

function worstGap(a: readonly Point[], b: readonly Point[]): number {
    let worst = 0;
    for (let i = 0; i < a.length && i < b.length; i++) {
        worst = Math.max(worst, Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]));
    }
    return worst;
}

/** Two groups look alike when they hold as many strokes and each pair, in stroke order, does. */
function groupsLookAlike(a: readonly Point[][], b: readonly Point[][], toleranceUnits: number): boolean {
    return a.length === b.length && a.every((line, i) => worstGap(line, b[i]) <= toleranceUnits);
}

/** The board's tiles, unplaced (x, y and z are 0): one per stroke group, in reading order. */
export function buildTiles(characters: readonly BoardCharacter[], toleranceUnits: number, dropRatio?: number): Tile[] {
    const refs: (GroupRef & { lines: Point[][]; paths: string[] })[] = characters.flatMap((character, charIndex) =>
        characterGroups(character, dropRatio).map((strokeIndices, groupIndex) => ({
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
        lock: null,
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
 * The loose stacks that now finish a character: `${x},${y}` → the character index.
 *
 * Only loose tiles are judged. A locked stack is already finished, and a loose tile lying on
 * its cell neither joins it nor spoils it. Every tile still counts towards its character's
 * size, or the rest of a character would read as a whole one.
 */
export function completedStacks(tiles: readonly Tile[]): Map<string, number> {
    const stacks = new Map<string, Tile[]>();
    const groupCounts: number[] = [];
    for (const tile of tiles) {
        groupCounts[tile.source.charIndex] = (groupCounts[tile.source.charIndex] ?? 0) + 1;
        if (tile.lock) continue;
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

/**
 * Fuse every loose stack that now finishes a character. Run on a drop, the one moment a
 * stack can change. Returns the same array when nothing finished, so a no-op drop does not
 * re-render the board.
 */
export function lockFinishedStacks(tiles: Tile[]): Tile[] {
    const finished = completedStacks(tiles);
    if (finished.size === 0) return tiles;
    const locks = new Map<string, TileLock>();
    finished.forEach((charIndex, key) => {
        const ids = tiles.filter((tile) => !tile.lock && stackKey(tile) === key).map((tile) => tile.id);
        locks.set(key, { id: Math.min(...ids), charIndex });
    });
    return tiles.map((tile) => {
        const lock = tile.lock ? undefined : locks.get(stackKey(tile));
        return lock ? { ...tile, lock } : tile;
    });
}

/**
 * Move a tile — with its whole locked stack, if it has one — to (x, y) and onto the top of
 * the pile. The moved tiles keep their order among themselves, and z stays a compact 0..n-1.
 * Returns the same array when nothing moved.
 */
export function moveTile(tiles: Tile[], tileId: number, x: number, y: number): Tile[] {
    const moved = tiles.find((tile) => tile.id === tileId);
    if (!moved || (moved.x === x && moved.y === y)) return tiles;
    const moving = (tile: Tile) => (moved.lock ? tile.lock?.id === moved.lock.id : tile.id === moved.id);
    const order = [...tiles].sort((a, b) => a.z - b.z);
    const z = new Map([...order.filter((tile) => !moving(tile)), ...order.filter(moving)].map((tile, index) => [tile.id, index]));
    return tiles.map((tile) => (moving(tile) ? { ...tile, x, y, z: z.get(tile.id)! } : { ...tile, z: z.get(tile.id)! }));
}

/**
 * A pile with each locked stack folded to its topmost tile, topmost first. A locked stack is
 * one thing to the finger: one tap selects it and one drag lifts it, rather than the tap
 * cycle stepping through tiles that can no longer part.
 */
export function collapseLocked(hits: readonly Tile[]): Tile[] {
    const seen = new Set<number>();
    return hits.filter((tile) => {
        if (!tile.lock) return true;
        if (seen.has(tile.lock.id)) return false;
        seen.add(tile.lock.id);
        return true;
    });
}

/** Can these two tiles fill two different groups of one character? Reads `accepts`, so a lookalike swap counts. */
function belongTogether(a: Tile, b: Tile): boolean {
    return a.accepts.some((first) =>
        b.accepts.some((second) => first.charIndex === second.charIndex && first.groupIndex !== second.groupIndex)
    );
}

/**
 * Two tiles the hint should point at: they belong in one stack and are not in one yet.
 * Locked tiles never qualify. Two loose tiles lying alone are preferred (a locked stack on the
 * same cell does not count against "alone"). When no such
 * pair exists (say, one tile left to add to a partial stack) any unfinished tile counts, so a
 * hint is only unavailable when no two tiles are left to join. Returns tile ids, or null.
 */
export function pickHintPair(tiles: readonly Tile[], random: () => number = Math.random): [number, number] | null {
    const open = tiles.filter((tile) => !tile.lock);
    const countAt = new Map<string, number>();
    open.forEach((tile) => countAt.set(stackKey(tile), (countAt.get(stackKey(tile)) ?? 0) + 1));
    const pairsAmong = (pool: readonly Tile[]) =>
        pool.flatMap((a, index) =>
            pool
                .slice(index + 1)
                .filter((b) => stackKey(a) !== stackKey(b) && belongTogether(a, b))
                .map((b): [number, number] => [a.id, b.id])
        );
    const alone = pairsAmong(open.filter((tile) => countAt.get(stackKey(tile)) === 1));
    const pairs = alone.length > 0 ? alone : pairsAmong(open);
    return pairs.length > 0 ? pairs[Math.floor(random() * pairs.length)] : null;
}

/** Snap a pixel offset to the nearest unit, keeping a whole tile on the board. */
export function snapToGrid(px: number, unitPx: number, gridSize: number, tileUnits: number): number {
    return Math.max(0, Math.min(Math.max(0, gridSize - tileUnits), Math.round(px / unitPx)));
}
