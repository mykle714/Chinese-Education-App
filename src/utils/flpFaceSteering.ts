import type { VocabEntry } from "../types";
import type { MarkType, SideOneLanguage } from "../features/flashcards/types";
import type { FlpForeignTrack } from "../../server/contracts/wire";
import { positiveCount } from "./masteryCompute";

/**
 * flpFaceSteering — which face an flp card opens on, and which mark that face writes.
 *
 * The two functions here are exact inverses (`markTypeForSideOne(sideOneForCard(c))` is
 * the track the face exercises), which is why they live in one module: a change to the
 * side ↔ track mapping that touched only one of them would deal a face whose mark the
 * server then drops.
 *
 * Layer: pure client util — no fetching, no clock, and randomness is injected, so the
 * steering is testable. Extracted out of `useWorkingLoop` (the page hook still owns
 * WHEN a face is chosen; this owns WHICH).
 *
 * Referenced by docs/MASTERY_REWORK.md § Per-type cooldown.
 */

/**
 * Which mark type a flp review produces (docs/MASTERY_REWORK.md): an English-first
 * prompt asks the learner to PRODUCE the foreign word; a foreign-first prompt tests
 * the session's `foreignTrack` — RECOGNITION of the meaning when the phonetic aid is
 * there, READING when it isn't (zh with "Show pinyin" off). The session's track is
 * decided once, by the page (see UseWorkingLoopArgs.foreignTrack).
 */
export const markTypeForSideOne = (
    sideOne: SideOneLanguage,
    foreignTrack: FlpForeignTrack
): MarkType => (sideOne === "en" ? "production" : foreignTrack);

/**
 * Per-point bias toward the weaker track when BOTH faces are markable, and its cap.
 *
 * The gap is a difference of positive-mark counts, each 0..8, so the widest possible
 * gap (8) lands exactly on the cap — the cap is defensive, not a clamp the normal
 * range hits. A gap of 1 is a nudge (55/45); a learner who has drilled recognition to
 * 8 and never produced the word sees the English face 90% of the time.
 *
 * Deliberately a BIAS, not a rule: always dealing the weaker face makes a session
 * perfectly predictable (mark production, next card is recognition, …), which rewards
 * anticipating the prompt instead of knowing the word.
 */
export const FACE_BIAS_PER_MARK = 0.05;
export const FACE_BIAS_MAX = 0.9;

/**
 * How much progress one track holds, as the pair the tie-break compares:
 * `positives` first, `attempts` as the tie-break.
 *
 * `positives` is the real measure — it is literally the pbh input, so it is the number
 * the mastery bars move on. `attempts` (the track's rolling ≤8 window length) separates
 * two tracks that have earned the same amount from a different amount of work: 3/3 and
 * 3/8 are equal progress, but the 3/3 track is the one the learner has practiced less.
 */
const trackProgress = (
    entry: VocabEntry | null | undefined,
    type: MarkType
): { positives: number; attempts: number } => {
    const track = entry?.typedMarkHistory?.[type];
    return {
        positives: positiveCount(track),
        attempts: Array.isArray(track) ? track.length : 0,
    };
};

/**
 * Probability that `sideOneForCard` deals the ENGLISH (production) face when both
 * faces are off cooldown — the weaker-track bias, exported for tests and for any UI
 * that wants to explain the steering.
 *
 * WHY THE WEAKER TRACK. For the core bar the answer is arithmetic: pbh is
 * `min(6, max(rec, pro)) + min(rec, pro) / 3` (`server/contracts/mastery.ts`), whose
 * first term is capped — so past 6 the STRONGER track contributes literally nothing and
 * a mark on the weaker one is the only mark that can still move the bar. Below the cap
 * the two terms are equal-valued, so the bias costs nothing there and pays off later.
 *
 * A 'reading'-track session compares across two different bars (production feeds core,
 * reading feeds the reading bar). That is intentional and reads as the plainer version
 * of the same question — "which of these two have you done less of?" — since both
 * counts live on the same 0..8 scale.
 */
export const englishFirstProbability = (
    entry: VocabEntry | null | undefined,
    foreignTrack: FlpForeignTrack
): number => {
    const production = trackProgress(entry, "production");
    const foreign = trackProgress(entry, foreignTrack);

    // Positive (production is behind) ⇒ bias toward English-first, and vice versa.
    let gap = foreign.positives - production.positives;
    if (gap === 0) gap = foreign.attempts - production.attempts;
    if (gap === 0) return 0.5;

    const bias = Math.min(FACE_BIAS_MAX, 0.5 + FACE_BIAS_PER_MARK * Math.abs(gap));
    return gap > 0 ? bias : 1 - bias;
};

/**
 * Choose which language shows on a specific card's Side 1, honoring the server's
 * per-type cooldown steering (docs/MASTERY_REWORK.md § Per-type cooldown). The
 * card's `readyMarkTypes` lists the flp mark types currently off cooldown — stamped
 * by the server for THIS session's track pair, which is why the same `foreignTrack`
 * has to be sent on the fetch. We map production ↔ 'en' (English-first) and the
 * foreign track ↔ 'zh' (foreign-first), mirroring markTypeForSideOne:
 *   - only production ready    → English-first
 *   - only the foreign track   → foreign-first
 *   - both ready (or the field is absent, e.g. an older payload) → honor
 *     `preferEnglishFirst`, otherwise a WEIGHTED flip biased toward whichever track
 *     the learner has less progress in (`englishFirstProbability`).
 * Side 2 always shows both.
 *
 * Note the precedence: cooldown is a hard gate (dealing a cooling face means a mark the
 * server silently drops), the weakness bias only ever breaks a genuine tie.
 */
export const sideOneForCard = (
    card: VocabEntry | null | undefined,
    foreignTrack: FlpForeignTrack,
    preferEnglishFirst = false,
    random: () => number = Math.random
): SideOneLanguage => {
    const ready = card?.readyMarkTypes;
    const canProduction = !ready || ready.includes("production");
    const canForeign = !ready || ready.includes(foreignTrack);
    if (canProduction && !canForeign) return "en";
    if (canForeign && !canProduction) return "zh";
    if (preferEnglishFirst) return "en";
    return random() < englishFirstProbability(card, foreignTrack) ? "en" : "zh";
};
