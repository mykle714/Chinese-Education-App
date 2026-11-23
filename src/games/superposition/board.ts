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

/**
 * A tile: one or more strokes of a character. `z` is its place in the pile order: higher is on top.
 *
 * A tile is either IN THE TRAY (the band of mini slots under the grid, where every tile is
 * dealt) or ON THE BOARD at (x, y). A tray tile's x, y and z mean nothing: it is in no pile and
 * no stack (`stackKey` gives it a key of its own), and `tilesAt` never finds it.
 */
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
    /** Resting in its tray slot rather than on the board. A locked tile never is. */
    inTray: boolean;
    /** Its tray slot, 0..n-1: fixed for the run, so a returned tile always goes home to the same well. */
    slot: number;
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
        inTray: true,
        slot: id,
    }));
}

/**
 * Deal every tile into the tray, in shuffled slot order. The order is the deal's one secret:
 * slots grouped by character would give the stacks away. Slots stay fixed for the run.
 */
export function dealToTray(tiles: readonly Tile[], random: () => number = Math.random): Tile[] {
    const order = tiles.map((tile) => ({ id: tile.id, key: random() })).sort((a, b) => a.key - b.key);
    const slotOf = new Map(order.map(({ id }, slot) => [id, slot]));
    return tiles.map((tile) => ({ ...tile, inTray: true, slot: slotOf.get(tile.id)!, lock: null }));
}

/**
 * Put a loose tile back in its tray slot. A locked tile is refused (same array back): a
 * finished character stands for the run, so it cannot be taken apart into the tray.
 */
export function sendToTray(tiles: Tile[], tileId: number): Tile[] {
    const tile = tiles.find((candidate) => candidate.id === tileId);
    if (!tile || tile.lock || tile.inTray) return tiles;
    return tiles.map((candidate) => (candidate.id === tileId ? { ...candidate, inTray: true } : candidate));
}

/** The grid a tap-placed tray tile may land on, in grid units. */
export interface PlacementZone {
    cols: number;
    rows: number;
    tileUnits: number;
    /** Rows kept clear at the top (the word info), when the board has room. */
    topUnits: number;
    /** Clear space kept from the other edges, when the board has room. */
    marginUnits: number;
}

/**
 * Where a tapped tray tile lands: the position nearest the board's bottom centre (the edge
 * next to the tray, so the tile appears where the finger already is) whose box overlaps no
 * board tile. A full board settles for the nearest position no tile sits on EXACTLY, so a
 * tap never builds a stack: stacking stays a drop the learner makes.
 */
export function placementSpot(tiles: readonly Tile[], { cols, rows, tileUnits, topUnits, marginUnits }: PlacementZone): { x: number; y: number } {
    const lastX = Math.max(0, cols - tileUnits);
    const lastY = Math.max(0, rows - tileUnits);
    const insetX = Math.min(marginUnits, Math.floor(lastX / 2));
    const highY = lastY - Math.min(marginUnits, Math.floor(lastY / 2));
    const lowY = Math.min(Math.max(topUnits, 0), highY);
    const target = { x: Math.round(lastX / 2), y: highY };
    const onBoard = tiles.filter((tile) => !tile.inTray);
    let clear: { x: number; y: number; d: number } | null = null;
    let unstacked: { x: number; y: number; d: number } | null = null;
    for (let y = lowY; y <= highY; y++) {
        for (let x = insetX; x <= lastX - insetX; x++) {
            const d = Math.hypot(x - target.x, y - target.y);
            const overlaps = onBoard.some((tile) => Math.abs(tile.x - x) < tileUnits && Math.abs(tile.y - y) < tileUnits);
            if (!overlaps && (!clear || d < clear.d)) clear = { x, y, d };
            const exact = onBoard.some((tile) => tile.x === x && tile.y === y);
            if (!exact && (!unstacked || d < unstacked.d)) unstacked = { x, y, d };
        }
    }
    const spot = clear ?? unstacked ?? target;
    return { x: spot.x, y: spot.y };
}

/** Every tile whose box holds the grid point, topmost first. */
export function tilesAt(tiles: readonly Tile[], x: number, y: number, tileUnits: number): Tile[] {
    return tiles
        .filter((tile) => !tile.inTray && x >= tile.x && x < tile.x + tileUnits && y >= tile.y && y < tile.y + tileUnits)
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
 * Only loose tiles on the board are judged. A locked stack is already finished, and a loose tile lying on
 * its cell neither joins it nor spoils it. Every tile still counts towards its character's
 * size, or the rest of a character would read as a whole one.
 */
export function completedStacks(tiles: readonly Tile[]): Map<string, number> {
    const stacks = new Map<string, Tile[]>();
    const groupCounts: number[] = [];
    for (const tile of tiles) {
        groupCounts[tile.source.charIndex] = (groupCounts[tile.source.charIndex] ?? 0) + 1;
        // A tray tile is in no stack: it still counts towards its character's size, above.
        if (tile.lock || tile.inTray) continue;
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

/**
 * The cell a tile's stack is keyed on. A tray tile gets a key of its own, so it never stacks:
 * not with another tray tile, and not with a board tile that happens to share its stale x, y.
 */
export const stackKey = (tile: Pick<Tile, "x" | "y" | "inTray" | "id">): string =>
    tile.inTray ? `tray:${tile.id}` : `${tile.x},${tile.y}`;

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
 * the pile. A tray tile moved this way leaves the tray for the board. The moved tiles keep
 * their order among themselves, and z stays a compact 0..n-1. Returns the same array when
 * nothing moved.
 */
export function moveTile(tiles: Tile[], tileId: number, x: number, y: number): Tile[] {
    const moved = tiles.find((tile) => tile.id === tileId);
    if (!moved || (!moved.inTray && moved.x === x && moved.y === y)) return tiles;
    const moving = (tile: Tile) => (moved.lock ? tile.lock?.id === moved.lock.id : tile.id === moved.id);
    const order = [...tiles].sort((a, b) => a.z - b.z);
    const z = new Map([...order.filter((tile) => !moving(tile)), ...order.filter(moving)].map((tile, index) => [tile.id, index]));
    return tiles.map((tile) => (moving(tile) ? { ...tile, x, y, z: z.get(tile.id)!, inTray: false } : { ...tile, z: z.get(tile.id)! }));
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
 * Locked tiles never qualify. A tray tile counts as lying alone (its `stackKey` is its own). Two loose tiles lying alone are preferred (a locked stack on the
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
