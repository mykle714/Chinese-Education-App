import type { VocabEntry } from "../types";
import type { MarkType, SideOneLanguage } from "../features/flashcards/types";
import { positiveCount } from "./masteryCompute";

/**
 * flpFaceSteering — which face an flp card opens on, and which mark that face writes.
 *
 * The two functions here are exact inverses (`markTypeForSideOne(sideOneForCard(c))` is
 * the track the face exercises), which is why they live in one module: a change to the
 * side ↔ track mapping that touched only one of them would deal a face that writes the
 * wrong track.
 *
 * ── THE KNOW MERGE (2026-09-25, docs/MASTERY_REWORK.md § 6) ─────────────────────
 * The flp's two faces write the two KNOW tracks, which now rest on one shared clock.
 * The server therefore decides only WHETHER a card is dealt (its know clock has run
 * out); WHICH face it opens on is decided here, from the card's own history, by a
 * fixed rule — the track with FEWER positive marks, recognition on a tie. There is no
 * longer a cooldown to steer around (both faces share one clock) and no coin flip.
 *
 * Layer: pure client util — no fetching, no clock, no randomness. Extracted out of
 * `useWorkingLoop` (the page hook still owns WHEN a face is chosen; this owns WHICH).
 *
 * Referenced by docs/MASTERY_REWORK.md § 6.
 */

/**
 * Which mark type a flp review produces: an English-first prompt asks the learner to
 * PRODUCE the foreign word; a foreign-first prompt asks them to RECOGNIZE it.
 *
 * Always a know track. "Show pinyin" off no longer turns the foreign-first face into a
 * READING review (it did until 2026-09-25) — reading marks will come from a dedicated
 * reading flp instead, so this session's marks stay on the know bar either way.
 */
export const markTypeForSideOne = (sideOne: SideOneLanguage): MarkType =>
    sideOne === "en" ? "production" : "recognition";

/**
 * Choose which language shows on a card's Side 1: the face for whichever know track
 * holds FEWER positive marks — the positive count is the pbh input, so it is literally
 * what the mastery bar moves on — and the recognition (foreign-first) face on a tie.
 *
 * WHY THE WEAKER TRACK. pbh is `min(6, max(rec, pro)) + min(rec, pro) / 3`
 * (`server/contracts/mastery.ts`): once the stronger track reaches 6 it contributes
 * nothing more, so a mark on the weaker one is the only mark that still moves the bar.
 * Past core pbh 6 the flp is the ONLY surface whose know marks count at all
 * (`isFlpOnlyMark`), so dealing the weaker face there is what lets a card finish.
 *
 * WHY RECOGNITION ON A TIE. It is the gentler prompt (recall is harder than
 * recognition), so a card with no history — or an evenly drilled one — opens on it.
 *
 * Deterministic on purpose, and a deliberate reversal of the 2026-08-29 weighted flip,
 * which was kept a bias so a session would not be predictable. The trade was made
 * knowingly: the weaker track is now always the one drilled.
 */
export const sideOneForCard = (card: VocabEntry | null | undefined): SideOneLanguage => {
    const history = card?.typedMarkHistory;
    const recognition = positiveCount(history?.recognition);
    const production = positiveCount(history?.production);
    return production < recognition ? "en" : "zh";
};
