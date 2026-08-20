import type { HydraColor } from "./types";

/**
 * Hydra Bubbles — the spawn table (docs/HYDRA_BUBBLES.md § 3).
 *
 * THE CENTRAL DESIGN DECISION: this economy is deliberately NOT self-stabilizing.
 * Expected payout stays ABOVE 2 at every point in the growth zone, so a board left
 * to itself always creeps upward. Holding it back is the player's job, and the only
 * way to do it is to clear yellow and red bubbles — which are, by construction, the
 * words they know least well and are most likely to get wrong.
 *
 *   > Safe matches grow the board. Risky matches shrink it. That trade IS the game.
 *
 * KEYED ON FILL RATIO, NOT BUBBLE COUNT. The lookup reads the same occupied-area
 * number the overflow loss reads (`fillRatio` / `LOSE_FILL_RATIO`,
 * src/games/bubbles/). Two systems that disagree about how full a board is would
 * make the red-only squeeze reachable on a phone and unreachable on a tablet; one
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
 * EVERY COLOR PAYS ONE MORE THAN IT USED TO (2026-08-19). The ladder was 0/1/2/3;
 * it is now 1/2/3/4, keeping the same one-bubble step between colors. Two things
 * follow, and both are deliberate:
 *
 *   * RED NO LONGER PAYS NOTHING. A red clear returns one bubble against the two it
 *     removed, so it is still the only lever that shrinks the board — just a gentler
 *     one (net −1 per match instead of −2). Digging out of the squeeze now takes
 *     twice as many correct hard clears.
 *   * THE MIX HAD TO MOVE WITH IT. Expected payout is `2 + (2·blue + green − red)/100`,
 *     so the +1 shifted break-even from `2b+g−r = 100` down to `2b+g−r = 0` — a full
 *     100 points of slack. Left alone, the old 48/20/24/8 row would have grown the
 *     board at +1.08 bubbles per match instead of +0.08. Spending that slack on
 *     yellow and red is what pays for the raise; see HYDRA_SPAWN_ANCHORS.
 */
export const PAYOUT_BY_COLOR: Record<HydraColor, number> = {
    Unfamiliar: 1, // red
    Target: 2, // yellow
    Comfortable: 3, // green
    Mastered: 4, // blue
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
 * 0.10 / 0.25 / 0.45 / 0.60 whose weights drifted by only a few points each while red
 * stayed flat — four breakpoints describing a change no player could perceive, and
 * four more numbers for a tuning pass to keep consistent. The shape that was actually
 * doing the work is just three states:
 *
 *     opening (blue only)  →  steady state  →  squeeze (red only)
 *
 * Difficulty in Hydra comes from the BOARD FILLING UP and from the 0.75 step, not
 * from a slow drift in the mix. Flattening the middle also removed the thin-margin
 * problem the drift had introduced: growth is uniform everywhere in the steady state,
 * instead of decaying near the squeeze where a skilled player could have hovered
 * indefinitely.
 *
 * ⚠️ THESE NUMBERS ARE A TUNING, NOT A MEASUREMENT (§ 11 O1). E[payout] is 4.00 on an
 * empty board and a flat 2.25 through the steady state (+0.25 bubbles per match).
 * Whether that FEELS like a slow squeeze or an unwinnable flood is not knowable on
 * paper. The 0.75 red-only floor and the steady-state row are the first things to move.
 *
 * Yellow's 30% share is deliberately above what an economy-only tuning would
 * pick, and it is raised in ALL modes — challenge words ride the yellow slot
 * (§ 7.5), and free-play Hydra must roll the same table as challenge Hydra or
 * players would practice a different game from the one they compete in.
 */
export const HYDRA_SPAWN_ANCHORS: readonly SpawnAnchor[] = [
    // THE OPENING IS PURE BLUE (2026-08-18). An empty board rolls nothing but the
    // safest, highest-paying color, and the other three ramp in as the board fills.
    // This is a deliberate departure from the original 55/20/25/0 row: a run should
    // open on words the player certainly knows, and earn its way into risk. It also
    // makes the opening board's composition a consequence of the table rather than a
    // hard-coded exception beside it (HydraStage seeds with `rollColor(0)`).
    //
    // E[payout] here is 4.00 — the steepest growth in the game sits at the emptiest
    // board, which is precisely where the player has the most room to absorb it.
    // 1. THE OPENING — blue only. An empty board rolls nothing but the safest,
    //    highest-paying color, so a run starts on words the player certainly knows.
    { fill: 0.0, weights: { Mastered: 100, Comfortable: 0, Target: 0, Unfamiliar: 0 } },
    // 2. THE STEADY STATE — one mix, held from the first tenth all the way to the
    //    squeeze. Red is a flat 35% throughout: it used to be 0% below fill 0.45,
    //    which meant the player's ONLY way to shrink the board was withheld until the
    //    board was already half full — the risky clear that § 3 calls "the game" was
    //    not on offer during the half of a run where they most want to practise it.
    //
    //    REWEIGHTED 2026-08-19, TOGETHER WITH THE +1 PAYOUT LADDER. Was
    //    48/20/24/8 (blue/green/yellow/red). Blue and green come down, yellow and red
    //    go up, which is only affordable because the +1 ladder moved break-even (see
    //    PAYOUT_BY_COLOR). E[payout] = 2 + (2·48 + 20 − 8)/100 = 3.08 under the new
    //    ladder — far too fast — against 2 + (2·25 + 10 − 35)/100 = 2.25 here, which
    //    holds roughly the run length the old +0.08 economy produced while putting
    //    two thirds of every roll on words the player knows least well.
    { fill: 0.1, weights: { Mastered: 25, Comfortable: 10, Target: 30, Unfamiliar: 35 } },
];

/**
 * THE SQUEEZE. At and above this fill nothing but red spawns, each paying 1 against
 * the 2 a match removes, so the board can only shrink — and the player has to clear
 * their hardest words to climb back out, every one of which is a chance to lose. It
 * sits well below the 0.94 loss line so the zone is a real, playable band rather than
 * a death sentence.
 *
 * THE SQUEEZE IS HALF AS STEEP AS IT WAS (2026-08-19). Red used to pay 0, so a match
 * inside the zone was worth −2 bubbles; under the +1 ladder it is worth −1. Escaping
 * takes twice as many consecutive correct clears of the player's hardest words, which
 * is the intended cost of making red a payable color everywhere else.
 *
 * ⚠️ A HARD STEP, NOT AN ANCHOR — and this is load-bearing. § 3.1 lists red-only as a
 * fifth anchor row at 0.75, but an INTERPOLATED fifth row silently breaks the two
 * things the section promises. Interpolating from the steady-state row (E[payout]
 * 2.25) down to 1.00 drags expected payout below the break-even 2 from about
 * **fill 0.23** — the reweighted table made this WORSE, not better, because the
 * steady state now sits closer to break-even. So:
 *
 *   * "below 0.75 every point on the curve is net-positive" becomes false over most
 *     of the range, and the board starts quietly shrinking on its own — which is
 *     exactly the self-stabilizing economy § 3 was written to reject; and
 *   * the board is already rolling mostly red well before the HUD's "red only"
 *     warning comes on, so the interface misdescribes the game.
 *
 * § 3.1's own wording is "at 0.75 and above the table SWITCHES to red-only", which is
 * a step. Implemented as one here, and the doc's table was corrected to match.
 * `src/__tests__/hydraSpawnTable.test.ts` pins both signs so a tuning pass can move
 * every number freely but cannot flip them back by accident.
 */
export const RED_ONLY_FILL = 0.75;

/** The distribution at and above RED_ONLY_FILL. */
export const RED_ONLY_WEIGHTS: Record<HydraColor, number> = {
    Mastered: 0,
    Comfortable: 0,
    Target: 0,
    Unfamiliar: 100,
};

/**
 * The spawn weights at a given fill ratio: the anchor row when `fill` lands on one,
 * otherwise a linear blend of the two rows it sits between — except at and above
 * RED_ONLY_FILL, which is a step to the red-only row.
 *
 * Clamped at both ends, so no fill value is undefined.
 */
export function spawnWeightsAt(fill: number): Record<HydraColor, number> {
    // The squeeze is a step (see RED_ONLY_FILL), so it is checked before any blending.
    if (fill >= RED_ONLY_FILL) return { ...RED_ONLY_WEIGHTS };

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
    if (total <= 0) return "Unfamiliar"; // malformed row — fail toward the safe end

    let roll = rng() * total;
    for (const color of colors) {
        roll -= weights[color];
        if (roll < 0) return color;
    }
    return colors[colors.length - 1];
}
