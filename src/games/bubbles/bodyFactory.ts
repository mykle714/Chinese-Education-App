import type { VocabEntry } from "../../types";
import type { BubbleBody, BubbleKind } from "./types";
import { randRange } from "./physics";
import {
    WORD_RADIUS_MIN,
    WORD_RADIUS_MAX,
    WORD_LEN_MIN,
    WORD_LEN_MAX,
    WORD_RADIUS_JITTER,
    DEFINITION_RADIUS_MIN,
    DEFINITION_RADIUS_MAX,
    DEFINITION_LEN_MIN,
    DEFINITION_LEN_MAX,
    DEFINITION_RADIUS_JITTER,
    IDLE_SPEED,
    SPAWN_SEED_RADIUS,
    SCALE_IDLE,
} from "./constants";
import { resolveDisplayDefinition } from "../../utils/definitionUtils";

/**
 * Bubbles — constructing a body from a vocab entry.
 *
 * Lifted out of BubbleStage so a second game (Hydra Bubbles) builds bubbles that
 * are sized and seeded identically. A game decides WHICH entries become bubbles
 * and WHEN; this module only decides how big a bubble is and what state it
 * starts in.
 *
 * Referenced by: src/games/bubble-match/BubbleStage.tsx.
 * Docs: docs/GAMES_FEATURE.md, docs/HYDRA_BUBBLES.md.
 */

// Monotonic id source. Module-level (not per-stage) so ids stay unique across a
// remount — a stale DOM node from the previous run can never collide with a new
// body and have its transform written to the wrong element.
let bodySeq = 0;

/**
 * Map a text length onto a bubble radius so wordier content gets a roomier
 * circle. `len` is normalized across [lenMin, lenMax] (clamped at both ends),
 * then interpolated across the [radiusMin, radiusMax] band *inset* by `jitter`,
 * and finally a small ± jitter is added back so two same-length bubbles don't
 * render as identical circles. Insetting first guarantees the jitter always has
 * room and the final value stays in band — even the shortest and longest texts
 * keep some variance. Shared by both bubble kinds (English definitions and
 * foreign words) so they scale with their text the same way.
 */
export function lengthScaledRadius(
    len: number,
    lenMin: number,
    lenMax: number,
    radiusMin: number,
    radiusMax: number,
    jitter: number
): number {
    const t = Math.max(0, Math.min(1, (len - lenMin) / (lenMax - lenMin)));
    const lo = radiusMin + jitter;
    const hi = radiusMax - jitter;
    const base = lo + t * (hi - lo);
    return base + randRange(-jitter, jitter);
}

/** Radius for a definition bubble, scaled to the length of its English text. */
export function definitionRadius(entry: VocabEntry): number {
    // MUST match Bubble.tsx's defText transform — this length drives the bubble's radius,
    // so measuring a different string than the one rendered would mis-size the bubble.
    const len = resolveDisplayDefinition(entry).length;
    return lengthScaledRadius(
        len,
        DEFINITION_LEN_MIN,
        DEFINITION_LEN_MAX,
        DEFINITION_RADIUS_MIN,
        DEFINITION_RADIUS_MAX,
        DEFINITION_RADIUS_JITTER
    );
}

/** Radius for a word bubble, scaled to its foreign character count. */
export function wordRadius(entry: VocabEntry): number {
    // Count by code points so multi-byte CJK characters each count once.
    const len = [...(entry.entryKey ?? "")].length;
    return lengthScaledRadius(
        len,
        WORD_LEN_MIN,
        WORD_LEN_MAX,
        WORD_RADIUS_MIN,
        WORD_RADIUS_MAX,
        WORD_RADIUS_JITTER
    );
}

/**
 * Build one bubble body, off-field, at seed size. The caller positions it and
 * flips it to `growing` when it actually spawns (see planSpawn) — a body handed
 * back from here is inert and safe to hold in a queue.
 */
export function makeBody(
    pairId: string,
    kind: BubbleKind,
    entry: VocabEntry,
    radius: number
): BubbleBody {
    // Seed the drift in a random direction at the idle speed, so a bubble starts
    // floating the instant it finishes growing (physics ignores vx/vy until then).
    const heading = Math.random() * Math.PI * 2;
    return {
        id: `b${bodySeq++}`,
        pairId,
        kind,
        entry,
        x: 0,
        y: 0,
        vx: Math.cos(heading) * IDLE_SPEED,
        vy: Math.sin(heading) * IDLE_SPEED,
        // Start at the seed size; the bubble inflates to targetRadius once spawned.
        radius: SPAWN_SEED_RADIUS,
        targetRadius: radius,
        mass: radius * radius, // ∝ full-size area (π constant drops out)
        scale: SCALE_IDLE,
        targetScale: SCALE_IDLE,
        status: "idle",
    };
}

/**
 * The two bubbles for one vocab entry — the unit both games spawn in. `pairId`
 * is supplied by the caller because the two games disambiguate repeats
 * differently: Bubble Match indexes within a fixed pool, Hydra can re-lend the
 * same entry across a long endless run and needs a fresh pair identity each time.
 */
export function makePair(pairId: string, entry: VocabEntry): [BubbleBody, BubbleBody] {
    return [
        makeBody(pairId, "word", entry, wordRadius(entry)),
        makeBody(pairId, "definition", entry, definitionRadius(entry)),
    ];
}

/**
 * Put an inert body onto the field at (x, y): reset it to seed size and set it
 * growing, so it inflates in place and shoves its neighbors aside to make room
 * (see `stepPhysics`'s infinite-mass treatment of `growing`).
 *
 * Shared because BOTH games need the same three-line ritual and getting it wrong
 * is silent — a body pushed into `bodies` at full radius appears instantly and
 * skips the shove that makes space for it.
 */
export function launchBody(body: BubbleBody, x: number, y: number): void {
    body.x = x;
    body.y = y;
    body.radius = SPAWN_SEED_RADIUS;
    body.status = "growing";
}
