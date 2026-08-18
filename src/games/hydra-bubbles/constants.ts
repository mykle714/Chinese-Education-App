import type { MarkType } from "../../types";
import type { HydraColor } from "./types";

/**
 * Hydra Bubbles — tunable constants (docs/HYDRA_BUBBLES.md).
 *
 * The FIELD constants (sizing, drift, spawn placement, `LOSE_FILL_RATIO`, the
 * status feedback palette) are shared and live in src/games/bubbles/constants.ts.
 * What is here is Hydra's own.
 */

/**
 * The mastery track this game feeds (docs/MASTERY_REWORK.md). Hydra is a
 * recognition drill (foreign → meaning), so every mark it writes is a RECOGNITION
 * mark and its card pool must be bucketed/cooled by that same track.
 *
 * Single source of truth for the `?markType=` pool query, the /api/flashcards/mark
 * call, and the Games hub's mark-type chip (via GAME_REGISTRY's `markType`).
 */
export const MARK_TYPE: MarkType = "recognition";

/**
 * The surface id sent as `?surface=`. It is NOT in `CARD_BASELINES` — Hydra
 * declares no baseline at all (§ 6.5) — but it IS in `ROLLING_SUPPLY_SURFACES`
 * (server/contracts/wire.ts), which is what lets a mid-run refill lend.
 */
export const SURFACE = "hydra-bubbles";

/** The run opens with one live pair and one stray: 1 Chinese + 2 English (§ 1). */
export const OPENING_WORD_BUBBLES = 1;
export const OPENING_DEFINITION_BUBBLES = 2;

/** Score awarded per match — both halves of the cleared pair (§ 7.2). */
export const SCORE_PER_MATCH = 2;

/**
 * The difficulty tier each color lends at, as an OFFSET from the learner's estimated
 * level `L` (§ 6.2):
 *
 *     red = L,  yellow = L-1,  green = L-2,  blue = L-3
 *
 * Sent to the server as `?lendLevelOffset=`, which resolves it against `L` and
 * clamps into 1..6 (`ProvisionalCardService.resolveLendLevel`). The client owns
 * these offsets — they are Hydra's payout design — and the server owns `L`, which is
 * never exposed to the client. Neither half is meaningful without the other, and
 * splitting them this way is what avoids an endpoint whose only purpose would be to
 * ship `L` out so the client could send a level back.
 *
 * The server-side clamp is also the "floored at L <= 4" rule: at L = 4 these offsets
 * already land on 4/3/2/1, and below that the clamp holds them there.
 */
export const TIER_OFFSET_BY_COLOR: Record<HydraColor, number> = {
    Unfamiliar: 0, // red
    Target: -1, // yellow
    Comfortable: -2, // green
    Mastered: -3, // blue
};

/**
 * How many cards each color buffer tries to hold (§ 6.2b).
 *
 * Small on purpose. A buffer is a latency hedge, not a reservoir: every card sitting
 * in one is a card the server has already committed to this run, and for a
 * provisional card that means a row that has already been minted. Four is roughly
 * two matches' worth of one color, which covers the round trip without pre-lending a
 * stack of words the run may never reach.
 */
export const BUFFER_TARGET = 4;

/** Refill a buffer once it drops to this. Below the target so top-ups overlap play. */
export const BUFFER_LOW_WATER = 2;

/**
 * Cap on the `avoid` id list sent with a refill. The list grows all run and rides in
 * the query string, so it needs a ceiling; only the most recently cleared ids are
 * sent, and older ones aging out of the soft cooldown is the intended behavior.
 */
export const MAX_AVOID_IDS = 200;

/**
 * Bubbles cleared before the mid-run lend notice may fire, so a brand-new learner's
 * very first refill does not open with a modal. It fires at most once per run either
 * way (§ 6.4).
 */
export const LEND_NOTICE_MIN_SCORE = 4;

/**
 * STRAY AGING (§ 4.2c). Every slot that would spawn a stray instead runs a small
 * lottery: either a brand-new card, or the missing half of a stray already sitting on
 * the board. Each stray accrues `SHARES_PER_UNMATCHED_ROUND` per spawn round it goes
 * without being completed, so the longer a bubble has been stranded the likelier it is
 * to finally get its partner.
 *
 * WHY. Nothing previously guaranteed a stray would EVER be completed — `complete` was
 * only reached through `forceLiveMatch`, i.e. when the board had no live match at all.
 * A board could therefore silt up with orphans the player could never act on: the fill
 * ratio climbs toward the loss line while the number of things they can actually match
 * stays flat. That is a bad way to lose, because it is not a decision the player made.
 *
 * The lottery is self-limiting, which is why it needs no cap: shares SUM across
 * strays, so a board carrying many old orphans overwhelms `NEW_CARD_SHARES` and spends
 * nearly every slot clearing the backlog, while a board with one fresh stray barely
 * notices it.
 *
 * IT DOES NOT TOUCH THE ECONOMY. A `complete` costs the same one slot and puts the
 * same one bubble on the board as a `newStray`; only WHICH bubble differs. E[payout]
 * is untouched.
 *
 * NEW_CARD_SHARES is the half-life knob: at 6, a stray that has waited 6 rounds is as
 * likely to be completed as a new card is to spawn.
 */
export const NEW_CARD_SHARES = 6;
export const SHARES_PER_UNMATCHED_ROUND = 1;
