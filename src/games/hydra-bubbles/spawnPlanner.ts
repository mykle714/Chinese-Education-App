import type { BubbleKind } from "../bubbles/types";
import { HYDRA_COLORS, type HydraColor } from "./types";
import { DRAIN_ONLY_FILL, rollColor, spawnWeightsAt, type Rng } from "./spawnTable";
import { COLOR_NEED_TIEBREAK_FILL, NEW_CARD_SHARES, SHARES_PER_UNMATCHED_ROUND } from "./constants";

/**
 * Hydra Bubbles — the spawn algorithm (docs/HYDRA_BUBBLES.md § 4).
 *
 * A pure planner: it decides WHAT to spawn, never where or from which cards. The
 * stage turns each action into bubbles by drawing from the color buffers (§ 6.2b)
 * and placing them with the shared `planSpawn`. Keeping it pure is what makes the
 * invariants in § 4.3 unit-testable without a DOM, a network, or a rAF loop.
 *
 * A SLOT IS ONE BUBBLE. A payout of `k` buys `k` bubbles, so a whole new card
 * (word + definition) costs two slots — which is why a drain clear (payout 1) can never
 * open with a fresh matched pair, while a bloom one (payout 3) buys a pair and has a
 * slot left over.
 *
 * Referenced by: HydraStage.tsx, src/__tests__/hydraSpawnPlanner.test.ts.
 */

/** One card's presence on the board. A card contributes at most one of each kind (§ 4.4). */
export interface HydraBoardPair {
    pairId: string;
    /** The color this card is being played at — fixed for the run (§ 5). */
    color: HydraColor;
    hasWord: boolean;
    hasDefinition: boolean;
    /**
     * Spawn rounds this card has spent as a STRAY (one half showing). Zero for a live
     * match and for a card that has just arrived. Drives the aging lottery in
     * `rollStrayOrComplete` (§ 4.2c); the stage owns the counter because only it knows
     * when a round has elapsed.
     */
    unmatchedRounds: number;
}

/** Everything the planner needs to know about the board. */
export interface HydraBoardView {
    /** Occupied-area ratio — the SAME number the overflow loss reads (§ 3.1). */
    fill: number;
    pairs: HydraBoardPair[];
}

/**
 * One thing to spawn.
 * - `newPair`   — a card new to the board, both halves. Costs 2 slots, and is
 *                 instantly a live match.
 * - `newStray`  — one half of a card new to the board. Costs 1 slot.
 * - `complete`  — the missing half of a card ALREADY on the board, turning a stray
 *                 into a live match. Costs 1 slot and draws no new card, so it is
 *                 the cheapest way to satisfy the live-match invariant.
 */
export type HydraSpawnAction =
    | { type: "newPair"; color: HydraColor; plannedId: string }
    | { type: "newStray"; color: HydraColor; kind: BubbleKind; plannedId: string }
    | { type: "complete"; pairId: string; kind: BubbleKind };

/**
 * `plannedId` exists because a later slot in the SAME batch can complete a stray an
 * earlier slot just planned. The planner has no idea which card the stage will draw,
 * so it labels each card it plans and refers back to that label; the stage keeps a
 * planned-id → real-pair-id map as it executes the batch in order. Without this the
 * `complete` action could name a pair that does not exist yet on the board.
 */

/**
 * A card whose partner is also on the board — the thing the player can actually match.
 *
 * `color` narrows the question to "is there a live match THAT PAYS THIS RATE", which is
 * what the per-color guarantee (§ 4.3 invariant 3) is built on. Omitted, it is the
 * original color-agnostic anti-zero question.
 */
export function hasLiveMatch(pairs: readonly HydraBoardPair[], color?: HydraColor): boolean {
    return pairs.some((p) => p.hasWord && p.hasDefinition && (color === undefined || p.color === color));
}

/**
 * Which color the board is MISSING a live match of — the per-color guarantee of § 4.3.
 *
 * WHY THIS EXISTS. `hasLiveMatch` alone only promises the board is not a dead end; it
 * says nothing about what the available match PAYS. A board can sit at a perfect § 3.1
 * color mix with every drain card a stray and only bloom cards completable, and then the
 * player's only legal move is the one that grows the board — the shrink lever § 3 says
 * the game is about has quietly been taken away. `pickBalancedColor` does not cover
 * this: it balances the colors of the cards ON the board, not the colors that are
 * MATCHABLE.
 *
 * WITHIN BUDGET ONLY. Unlike anti-zero this never buys a slot the payout did not pay
 * for — it only steers a slot the batch was going to spend anyway (a `complete` and a
 * `newStray` cost the same one slot, § 4.2c), so the economy is untouched. The direct
 * consequence is that it is a BEST-EFFORT guarantee, not an absolute one: a drain clear
 * buys exactly one slot, so a board missing both colors can only be given one of them
 * back per match.
 *
 * THE TIEBREAK IS FILL. When both colors are missing, the board's own fullness decides
 * which one the player gets: below `COLOR_NEED_TIEBREAK_FILL` there is room to spare
 * and the growth move is the one worth having, at or above it the shrink move is. Note
 * this makes the guarantee mildly STABILIZING at the margin — the one place in Hydra
 * where that is accepted, because it is about the player having a choice at all rather
 * than about what the choice costs.
 *
 * BLOOM IS NEVER NEEDED INSIDE THE SQUEEZE. At and above `DRAIN_ONLY_FILL` the table
 * spawns drain only (§ 3.1); handing the player a guaranteed +1 escape there would
 * dismantle the one state overflow loss depends on. Bloom cards already on the board
 * stay matchable — the guarantee simply stops manufacturing them.
 */
export function neededColor(pairs: readonly HydraBoardPair[], fill: number): HydraColor | null {
    const bloomEligible = fill < DRAIN_ONLY_FILL;
    const missingDrain = !hasLiveMatch(pairs, "drain");
    const missingBloom = bloomEligible && !hasLiveMatch(pairs, "bloom");

    if (missingDrain && missingBloom) return fill >= COLOR_NEED_TIEBREAK_FILL ? "drain" : "bloom";
    if (missingDrain) return "drain";
    if (missingBloom) return "bloom";
    return null;
}

/**
 * The stray of `color` that has waited longest — the cheapest way to satisfy the
 * per-color guarantee, since completing it costs one slot and draws no new card.
 *
 * OLDEST-FIRST rather than the share-weighted lottery of `rollStrayOrComplete`: the
 * candidate set is already narrowed to one color, so the aging lottery's job (stopping a
 * backlog of orphans from being ignored) is being done by the filter, and a
 * deterministic pick makes the guarantee testable. Ties are broken randomly so a
 * symmetric board does not produce a fixed cycle.
 */
function oldestStrayOf(pairs: readonly HydraBoardPair[], color: HydraColor, rng: Rng): HydraBoardPair | null {
    const strays = straysOf(pairs).filter((p) => p.color === color);
    if (strays.length === 0) return null;
    let best = -Infinity;
    let tied: HydraBoardPair[] = [];
    for (const stray of strays) {
        if (stray.unmatchedRounds > best) {
            best = stray.unmatchedRounds;
            tied = [stray];
        } else if (stray.unmatchedRounds === best) {
            tied.push(stray);
        }
    }
    return tied[Math.floor(rng() * tied.length)];
}

/** The `complete` action that turns a given stray into a live match. */
function completionOf(stray: HydraBoardPair): HydraSpawnAction {
    return { type: "complete", pairId: stray.pairId, kind: stray.hasWord ? "definition" : "word" };
}

/** Cards showing exactly one half — the completion candidates. */
export function straysOf(pairs: readonly HydraBoardPair[]): HydraBoardPair[] {
    return pairs.filter((p) => p.hasWord !== p.hasDefinition);
}

/**
 * Which kind the next single bubble should be (§ 4.2).
 *
 * The board targets 50/50 and carries the ODD ONE AS ENGLISH, so a definition wins
 * every tie. Evaluated against the POST-spawn total, which is what makes an empty
 * board open with an English bubble rather than a Chinese one.
 */
export function nextKindByRatio(words: number, definitions: number): BubbleKind {
    const postTotal = words + definitions + 1;
    const targetDefinitions = Math.ceil(postTotal / 2);
    return definitions < targetDefinitions ? "definition" : "word";
}

/** Mutable tally the planner walks forward as it commits actions. */
interface Sim {
    fill: number;
    words: number;
    definitions: number;
    pairs: HydraBoardPair[];
}

function tally(board: HydraBoardView): Sim {
    return {
        fill: board.fill,
        words: board.pairs.filter((p) => p.hasWord).length,
        definitions: board.pairs.filter((p) => p.hasDefinition).length,
        // Cloned: the planner mutates presence flags as it commits, and the caller's
        // board view must survive the call unchanged.
        pairs: board.pairs.map((p) => ({ ...p })),
    };
}

/** Apply an action to the running tally so later slots see the earlier ones. */
function commit(sim: Sim, action: HydraSpawnAction): void {
    if (action.type === "newPair") {
        sim.words += 1;
        sim.definitions += 1;
        // A synthetic id: the planner never learns the real card, and nothing
        // downstream reads this — it exists so a second slot in the same batch sees
        // the pair as live rather than re-forcing a completion.
        sim.pairs.push({
            pairId: action.plannedId,
            color: action.color,
            hasWord: true,
            hasDefinition: true,
            unmatchedRounds: 0,
        });
        return;
    }
    if (action.type === "newStray") {
        if (action.kind === "word") sim.words += 1;
        else sim.definitions += 1;
        sim.pairs.push({
            pairId: action.plannedId,
            color: action.color,
            hasWord: action.kind === "word",
            hasDefinition: action.kind === "definition",
            unmatchedRounds: 0,
        });
        return;
    }
    const target = sim.pairs.find((p) => p.pairId === action.pairId);
    if (target) {
        if (action.kind === "word") {
            target.hasWord = true;
            sim.words += 1;
        } else {
            target.hasDefinition = true;
            sim.definitions += 1;
        }
    }
}

/**
 * Force a live match into existence — step 3 of § 4.1, and the anti-zero guarantee
 * of § 4.3.
 *
 * Completing an existing stray is preferred: it costs one slot, draws no card, and
 * respects the board's own composition. Only a board with no strays at all (in
 * practice, an empty one) falls through to a fresh pair.
 *
 * WHAT THE ANTI-ZERO OVERRIDE ACTUALLY OVERRIDES, since § 4.3 has described this
 * loosely: it is not the drain-only WEIGHTS — the color below is still rolled from the
 * table, so inside the squeeze this spawns a DRAIN pair. It is the BUDGET. Called from
 * step 3 of `planSpawnBatch` it spends slots the payout did not buy, so a drain clear
 * that would otherwise strand the board pays out 2 bubbles against the 2 it removed
 * instead of 1. That is the economy being suspended, and it is worth it: a board with
 * no possible match is a dead end, and a dead end is worse than a free bubble.
 */
function forceLiveMatch(sim: Sim, rng: Rng, plannedId: string): HydraSpawnAction {
    // The board has no live match at all, so BOTH colors are missing one and
    // `neededColor` is answering the § 4.3 tiebreak: below the tiebreak fill the forced
    // match is bloom, at or above it drain. Free — the slot is spent either way, only
    // the choice of stray changes.
    const needed = neededColor(sim.pairs, sim.fill);
    const preferred = needed ? oldestStrayOf(sim.pairs, needed, rng) : null;
    if (preferred) return completionOf(preferred);

    const strays = straysOf(sim.pairs);
    if (strays.length > 0) return completionOf(strays[Math.floor(rng() * strays.length)]);

    // No stray to complete. Roll a color anyway so the fresh pair still follows the
    // table where the table has an opinion; at drain-only fill this deliberately
    // yields a drain pair, which is a legal match and still honors anti-zero.
    return { type: "newPair", color: rollColor(sim.fill, rng), plannedId };
}

/**
 * The color for a new stray — chosen to CLOSE THE GAP between the board's actual
 * color mix and the § 3.1 target mix, rather than rolled independently (§ 4.2b).
 *
 * WHY NOT JUST ROLL. An independent roll per spawn is correct on average but noisy in
 * the short run, and the player does not experience the average — they experience the
 * board in front of them right now. Five independent rolls at the steady-state mix
 * land all-bloom often enough to matter, and a board with no drain on it offers the
 * player no way to shrink it, which is the one move § 3 says the game is about. This
 * makes color availability *predictable*: whatever is scarcest relative to target is
 * what comes next.
 *
 * IT MATTERS MORE UNDER TWO TIERS, not less. A four-color board that came up short on
 * its cheapest color still had the next one up — a below-average clear the player could
 * reach for. With two tiers an all-bloom board offers NO way to shrink at all, so the
 * balancer is the only thing standing between a run of lucky rolls and a board the
 * player cannot act on.
 *
 * WHY IT DOES NOT CHANGE THE ECONOMY. The target IS the § 3.1 table — this only
 * reduces variance around it, it does not move it. Long-run color frequencies still
 * converge on the table's weights, so `E[payout]` is untouched at 2.10. That is the
 * whole reason the target is the table rather than a flat 50/50: an even split would
 * average (1+3)/2 = 2 payout against 2 removed per match — exactly break-even, i.e.
 * the self-stabilizing economy § 3 exists to reject.
 *
 * Deficits are measured in ABSOLUTE cards, not proportionally, which is what makes the
 * long-run frequencies match the weights exactly. Measured against the POST-spawn
 * total, mirroring `nextKindByRatio`. Ties are broken randomly so a symmetric board
 * does not produce a fixed cycle.
 *
 * An EMPTY board has no mix to balance, so it falls back to a plain roll — which is
 * also what keeps the bloom-only opening (§ 3.1) intact.
 */
export function pickBalancedColor(
    pairs: readonly HydraBoardPair[],
    fill: number,
    rng: Rng = Math.random
): HydraColor {
    if (pairs.length === 0) return rollColor(fill, rng);

    const weights = spawnWeightsAt(fill);
    const actual: Record<HydraColor, number> = { drain: 0, bloom: 0 };
    for (const pair of pairs) actual[pair.color] += 1;

    const postTotal = pairs.length + 1;
    let best: HydraColor[] = [];
    let bestDeficit = -Infinity;
    for (const color of HYDRA_COLORS) {
        const deficit = (weights[color] / 100) * postTotal - actual[color];
        // Float tolerance: the deficits are fractions, and an exact === would make
        // tie-breaking depend on binary rounding rather than on the board.
        if (deficit > bestDeficit + 1e-9) {
            bestDeficit = deficit;
            best = [color];
        } else if (Math.abs(deficit - bestDeficit) <= 1e-9) {
            best.push(color);
        }
    }
    return best[Math.floor(rng() * best.length)];
}

/**
 * One slot spent by the ratio rule (§ 4.2) — EITHER a card new to the board, or the
 * missing half of a stray that has been waiting (§ 4.2c).
 *
 * A weighted lottery: `NEW_CARD_SHARES` for "something new", plus
 * `SHARES_PER_UNMATCHED_ROUND` per round each stray has gone uncompleted. Shares sum
 * across strays, so a backlog of orphans crowds out new cards until it is cleared,
 * while a single fresh stray barely shifts the odds.
 *
 * The new-card option is drawn LAST so that a board with no aged strays — every share
 * at zero — always falls through to it rather than depending on float comparisons.
 */
function rollStrayOrComplete(sim: Sim, rng: Rng, plannedId: string): HydraSpawnAction {
    // THE PER-COLOR GUARANTEE TAKES THIS SLOT FIRST (§ 4.3 invariant 3). It never adds
    // a slot, it only decides how this one is spent, so the aging lottery below simply
    // does not run on the rounds the guarantee is active. Two ways to spend it:
    //
    //   * a stray of the needed color exists  →  complete it, and the guarantee is met
    //     this instant at zero cost to the board's composition;
    //   * none exists  →  spawn a stray of that color instead of the balanced one, so a
    //     later slot HAS something to complete. One slot cannot do better: a `newPair`
    //     (the only single action that creates a live match out of nothing) costs two,
    //     and buying it here would be exactly the budget override § 4.3 reserves for
    //     anti-zero.
    const needed = neededColor(sim.pairs, sim.fill);
    if (needed) {
        const stray = oldestStrayOf(sim.pairs, needed, rng);
        if (stray) return completionOf(stray);
        return {
            type: "newStray",
            color: needed,
            kind: nextKindByRatio(sim.words, sim.definitions),
            plannedId,
        };
    }

    const strays = straysOf(sim.pairs);
    const shares = strays.map((s) => Math.max(0, s.unmatchedRounds) * SHARES_PER_UNMATCHED_ROUND);
    const totalShares = shares.reduce((sum, n) => sum + n, 0) + NEW_CARD_SHARES;

    let roll = rng() * totalShares;
    for (let i = 0; i < strays.length; i++) {
        roll -= shares[i];
        if (roll < 0) {
            const stray = strays[i];
            return {
                type: "complete",
                pairId: stray.pairId,
                kind: stray.hasWord ? "definition" : "word",
            };
        }
    }

    return {
        type: "newStray",
        // Balanced rather than rolled — see pickBalancedColor. `sim.pairs` already
        // carries anything committed earlier in this batch, so two strays in one
        // batch balance against each other rather than both chasing the same gap.
        color: pickBalancedColor(sim.pairs, sim.fill, rng),
        kind: nextKindByRatio(sim.words, sim.definitions),
        plannedId,
    };
}

/**
 * Plan the spawns owed for one cleared pair.
 *
 * @param board   the board AFTER the matched pair has been removed
 * @param payout  1 (drain) or 3 (bloom), from PAYOUT_BY_COLOR for the color cleared
 *
 * Order of operations (§ 4.1):
 *   1. `payout - 1` slots by the ratio rule, preferring a fresh matched PAIR while
 *      two or more of them remain.
 *   2. the last slot goes to the ratio rule if a live match already exists, and is
 *      forced to create one if it does not.
 *   3. ANTI-ZERO (§ 4.3, highest priority): if the board would still be left with no
 *      live match, force one anyway. Drain pays 1, so step 2 always runs and this is a
 *      pure backstop for boards a single stray cannot pair. Purely REACTIVE: there is
 *      no floor count below which the board is topped up regardless, because a floor
 *      would quietly re-stabilize the economy at the low end and player control of
 *      board size is the entire point of § 3.
 */
export function planSpawnBatch(
    board: HydraBoardView,
    payout: number,
    rng: Rng = Math.random
): HydraSpawnAction[] {
    const sim = tally(board);
    const actions: HydraSpawnAction[] = [];
    // Labels for cards planned in THIS batch, so a later slot can complete one.
    let plannedSeq = 0;
    const nextPlannedId = () => `planned-${plannedSeq++}`;

    // 1. The ratio phase.
    let remaining = Math.max(0, Math.floor(payout) - 1);
    while (remaining > 0) {
        // A fresh matched pair is preferred over two strays while there is room for
        // it: it hands the player something to do immediately and is ratio-neutral
        // (one of each kind), so it can never skew the 50/50 target.
        const action: HydraSpawnAction =
            remaining >= 2
                ? { type: "newPair", color: rollColor(sim.fill, rng), plannedId: nextPlannedId() }
                : rollStrayOrComplete(sim, rng, nextPlannedId());
        commit(sim, action);
        actions.push(action);
        remaining -= action.type === "newPair" ? 2 : 1;
    }

    // 2. The last slot.
    if (payout >= 1) {
        const action = hasLiveMatch(sim.pairs)
            ? rollStrayOrComplete(sim, rng, nextPlannedId())
            : forceLiveMatch(sim, rng, nextPlannedId());
        commit(sim, action);
        actions.push(action);
    }

    // 3. Anti-zero.
    if (!hasLiveMatch(sim.pairs)) {
        const action = forceLiveMatch(sim, rng, nextPlannedId());
        commit(sim, action);
        actions.push(action);
    }

    return actions;
}
