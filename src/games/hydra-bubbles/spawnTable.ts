import type { HydraColor } from "./types";

/**
 * Hydra Bubbles — the spawn table (docs/HYDRA_BUBBLES.md § 3).
 *
 * THE CENTRAL DESIGN DECISION: this economy is deliberately NOT self-stabilizing.
 * Expected payout stays ABOVE 2 at every point in the growth zone, so a board left
 * to itself always creeps upward. Holding it back is the player's job, and the only
 * way to do it is to clear RED bubbles — which are, by construction, the words they
 * know least well and are most likely to get wrong.
 *
 *   > Safe matches grow the board. Risky matches shrink it. That trade IS the game.
 *
 * KEYED ON FILL RATIO, NOT BUBBLE COUNT. The lookup reads the same occupied-area
 * number the overflow loss reads (`fillRatio` / `LOSE_FILL_RATIO`,
 * src/games/bubbles/). Two systems that disagree about how full a board is would
 * make the drain-only squeeze reachable on a phone and unreachable on a tablet; one
 * number makes it reachable by construction on any screen.
 *
 * NO DRIFT WITH PROGRESS. An identical board rolls an identical distribution no
 * matter how long the run has gone. Hydra is pure endurance, not an escalating curve.
 *
 * Referenced by: spawnPlanner.ts, src/__tests__/hydraSpawnTable.test.ts.
 */

/**
 * Bubbles spawned when a bubble of this color is cleared (§ 2).
 *
 * TWO COLORS, ONE STEP EITHER SIDE OF BREAK-EVEN (2026-08-21). A match always
 * removes 2 bubbles, so:
 *
 *     drain  spawns 1  →  net −1   (the only lever that shrinks the board)
 *     bloom spawns 3  →  net +1   (the only thing that grows it)
 *
 * This replaces the four-step 1/2/3/4 ladder (red/yellow/green/blue). The four steps
 * asked the player to read a payout off a hue mid-drag and hold a mental table of
 * what each one pays; two steps ask them to read ONE bit — does clearing this cost
 * me space or buy me space — which is the only question § 3's trade actually turns
 * on. The two middle rungs were the ones carrying the least information: yellow was
 * break-even (clearing it changed nothing) and green was a weaker blue.
 *
 * ⚠️ THE MIX HAD TO INVERT WITH IT, and this is the non-obvious consequence. With
 * two symmetric colors, net growth per match is exactly `2·bloomShare − 1`, so THE
 * BOARD ONLY GROWS IF BLUE IS OVER HALF OF EVERY ROLL. The old steady state put 65%
 * of rolls on the two hard colors; carried over verbatim that would be −0.30 per
 * match — a board that drains on its own, i.e. precisely the self-stabilizing economy
 * § 3 exists to reject. See HYDRA_SPAWN_ANCHORS for where the points went.
 */
export const PAYOUT_BY_COLOR: Record<HydraColor, number> = {
    drain: 1,
    bloom: 3,
};

/** Bubbles removed by one match — both halves of the cleared pair. */
export const BUBBLES_PER_MATCH = 2;

/**
 * One anchor row of the § 3.1 table: the spawn distribution at a given fill ratio.
 * Values are percentages and must sum to 100 in every row.
 */
export interface SpawnAnchor {
    fill: number;
    weights: Record<HydraColor, number>;
}

/**
 * The anchor table. Rows are interpolated LINEARLY between neighbours; below the
 * first anchor and above the last, the end row is used unchanged.
 *
 * TWO ANCHORS, NOT FIVE (simplified 2026-08-18). An earlier table carried rows at
 * 0.10 / 0.25 / 0.45 / 0.60 whose weights drifted by only a few points each — four
 * breakpoints describing a change no player could perceive, and four more numbers for
 * a tuning pass to keep consistent. The shape that was actually doing the work is
 * just three states:
 *
 *     opening (bloom only)  →  steady state  →  squeeze (drain only)
 *
 * Difficulty in Hydra comes from the BOARD FILLING UP and from the 0.75 step, not
 * from a slow drift in the mix. Flattening the middle also removed the thin-margin
 * problem the drift had introduced: growth is uniform everywhere in the steady state,
 * instead of decaying near the squeeze where a skilled player could have hovered
 * indefinitely.
 *
 * ⚠️ THESE NUMBERS ARE A TUNING, NOT A MEASUREMENT (§ 11 O1). E[payout] is 3.00 on an
 * empty board and a flat 2.10 through the steady state (+0.10 bubbles per match).
 * Whether that FEELS like a slow squeeze or an unwinnable flood is not knowable on
 * paper. The 0.75 drain-only floor and the steady-state row are the first things to move.
 */
export const HYDRA_SPAWN_ANCHORS: readonly SpawnAnchor[] = [
    // 1. THE OPENING — bloom only. An empty board rolls nothing but the safe,
    //    board-growing color, so a run starts on words the player certainly knows and
    //    has to earn its way into risk. It also makes the opening board's composition
    //    a consequence of the table rather than a hard-coded exception beside it
    //    (HydraStage seeds with `rollColor(0)`).
    //
    //    E[payout] here is 3.00 — the steepest growth in the game sits at the emptiest
    //    board, which is precisely where the player has the most room to absorb it.
    { fill: 0.0, weights: { bloom: 100, drain: 0 } },
    // 2. THE STEADY STATE — one mix, held from the first tenth all the way to the
    //    squeeze.
    //
    //    55/45 IS A DELIBERATELY THIN MARGIN (2026-08-21). Under the two-color ladder
    //    growth is `2·bloom − 1`, so this is +0.10 bubbles per match: the board still
    //    creeps upward on its own (§ 3 holds), but barely. The alternative considered
    //    was 62/38, which reproduces the old +0.25 exactly — it was rejected because
    //    it would have put nearly two thirds of every roll on words the player already
    //    knows, turning a recognition DRILL into a victory lap. 45% drain keeps the
    //    board weighted toward the words that need the practice, and pays for it with
    //    a slower creep and therefore longer runs.
    //
    //    THE KNOWN COST of a thin margin, and the first thing to watch in playtest: a
    //    player who clears drain selectively can hover near the fill they like almost
    //    indefinitely, because only 0.10 bubbles per match are pushing them upward.
    //    If runs never end, this row is what to move — every point taken off drain buys
    //    +0.02 growth per match.
    { fill: 0.1, weights: { bloom: 55, drain: 45 } },
];

/**
 * THE SQUEEZE. At and above this fill nothing but drain spawns, each paying 1 against
 * the 2 a match removes, so the board can only shrink — at −1 per match — and the
 * player has to clear their hardest words to climb back out, every one of which is a
 * chance to lose. It sits well below the 0.94 loss line so the zone is a real,
 * playable band rather than a death sentence.
 *
 * ⚠️ A HARD STEP, NOT AN ANCHOR — and this is load-bearing. § 3.1 lists drain-only as a
 * third row at 0.75, but an INTERPOLATED third row silently breaks the two things the
 * section promises. Interpolating from the steady-state row (E[payout] 2.10) down to
 * 1.00 drags expected payout below the break-even 2 from about **fill 0.15** — and
 * the thinner the steady-state margin, the earlier that crossing lands, so the
 * two-color reweight made this failure mode worse, not better. So:
 *
 *   * "below 0.75 every point on the curve is net-positive" becomes false over almost
 *     the whole range, and the board starts quietly shrinking on its own — which is
 *     exactly the self-stabilizing economy § 3 was written to reject; and
 *   * the board is already rolling mostly drain well before the HUD's "drain only"
 *     warning comes on, so the interface misdescribes the game.
 *
 * § 3.1's own wording is "at 0.75 and above the table SWITCHES to drain-only", which is
 * a step. Implemented as one here, and the doc's table was corrected to match.
 * `src/__tests__/hydraSpawnTable.test.ts` pins both signs so a tuning pass can move
 * every number freely but cannot flip them back by accident.
 */
export const DRAIN_ONLY_FILL = 0.75;

/** The distribution at and above DRAIN_ONLY_FILL. */
export const DRAIN_ONLY_WEIGHTS: Record<HydraColor, number> = {
    drain: 100,
    bloom: 0,
};

/**
 * The spawn weights at a given fill ratio: the anchor row when `fill` lands on one,
 * otherwise a linear blend of the two rows it sits between — except at and above
 * DRAIN_ONLY_FILL, which is a step to the drain-only row.
 *
 * Clamped at both ends, so no fill value is undefined.
 */
export function spawnWeightsAt(fill: number): Record<HydraColor, number> {
    // The squeeze is a step (see DRAIN_ONLY_FILL), so it is checked before any blending.
    if (fill >= DRAIN_ONLY_FILL) return { ...DRAIN_ONLY_WEIGHTS };

    const anchors = HYDRA_SPAWN_ANCHORS;
    if (fill <= anchors[0].fill) return { ...anchors[0].weights };
    const last = anchors[anchors.length - 1];
    // Between the last growth anchor and the squeeze the distribution HOLDS. That
    // plateau is what keeps every point below 0.75 net-positive.
    if (fill >= last.fill) return { ...last.weights };

    for (let i = 0; i < anchors.length - 1; i++) {
        const lo = anchors[i];
        const hi = anchors[i + 1];
        if (fill > hi.fill) continue;
        const span = hi.fill - lo.fill;
        // span is never 0 for a well-formed table (anchors are strictly increasing),
        // but guard anyway so a mis-edited table degrades to the lower row rather
        // than producing NaN weights that would make every roll fall through.
        const t = span > 0 ? (fill - lo.fill) / span : 0;
        const blended = {} as Record<HydraColor, number>;
        for (const color of Object.keys(lo.weights) as HydraColor[]) {
            blended[color] = lo.weights[color] + (hi.weights[color] - lo.weights[color]) * t;
        }
        return blended;
    }
    return { ...last.weights };
}

/** Expected bubbles spawned per match at a given fill. > 2 ⇒ the board grows. */
export function expectedPayoutAt(fill: number): number {
    const weights = spawnWeightsAt(fill);
    let total = 0;
    let sum = 0;
    for (const color of Object.keys(weights) as HydraColor[]) {
        total += weights[color];
        sum += weights[color] * PAYOUT_BY_COLOR[color];
    }
    return total > 0 ? sum / total : 0;
}

export type Rng = () => number;

/**
 * Roll one color for one spawn slot at the given fill ratio.
 *
 * `rng` is injectable (defaults to Math.random) so the distribution is
 * deterministically testable. The cumulative walk uses the row's own total rather
 * than assuming 100, so an interpolated row with float drift still rolls a valid
 * color instead of occasionally falling off the end.
 */
export function rollColor(fill: number, rng: Rng = Math.random): HydraColor {
    const weights = spawnWeightsAt(fill);
    const colors = Object.keys(weights) as HydraColor[];
    let total = 0;
    for (const color of colors) total += weights[color];
    if (total <= 0) return "drain"; // malformed row — fail toward the safe end

    let roll = rng() * total;
    for (const color of colors) {
        roll -= weights[color];
        if (roll < 0) return color;
    }
    return colors[colors.length - 1];
}
