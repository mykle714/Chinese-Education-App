import type { Language, MarkType } from "../../types";
import type { GameDef } from "../types";
import type { FlpWorld } from "../../../server/contracts/studyMode";
import { worldForMarkType } from "../../../server/contracts/mastery";
import type { FlpBreakCandidate } from "./types";

/**
 * Which games an flp break may offer (docs/FLP_GAME_BREAKS.md § 3) — DERIVED from the
 * registry, never hand-listed, so a game's flag, language gate and track decide it.
 *
 * Pure (registry + adapters are arguments) so it is testable without React.lazy pages.
 * Referenced by: features/flashcards/FlashcardsLearnPage/gameBreak/useGameBreak.ts.
 */

/** Pinyin on a break's board follows the flp bar: the reading flp hides it (§ 5a). */
export function breakShowsPinyin(world: FlpWorld): boolean {
    return world !== "reading";
}

/**
 * Every (game, mode) on the registry that marks a track on `bar`, is playable in
 * `language`, and has a break adapter.
 *
 *   - `hiddenFromHub` is IGNORED: Speed Reading / Memory Map / Writing Grid are hub-hidden
 *     but are exactly the reading and writing flps' games.
 *   - A moded game contributes one candidate per mode whose track is on `bar`.
 *   - A game whose track follows pinyin (`noPinyinMarkType`, Bubble Match) marks
 *     `noPinyinMarkType` on a zh board with pinyin hidden — i.e. on the reading flp.
 */
export function flpBreakCandidates(
    registry: readonly GameDef[],
    hasAdapter: (gameId: string) => boolean,
    world: FlpWorld,
    language: Language,
): FlpBreakCandidate[] {
    const showPinyin = breakShowsPinyin(world);
    const out: FlpBreakCandidate[] = [];
    const push = (game: GameDef, mode: string | null, markType: MarkType) => {
        if (worldForMarkType(markType) !== world) return;
        out.push({ game, mode, markType, showPinyin, key: `${game.gameId}:${mode ?? ""}` });
    };
    for (const game of registry) {
        if (!hasAdapter(game.gameId)) continue;
        if (game.languages && !game.languages.includes(language)) continue;
        if (game.modes && game.modes.length > 0) {
            for (const { mode, markType } of game.modes) push(game, mode, markType);
        } else if (game.markType) {
            const hidesPinyinOnZh = !showPinyin && language === "zh";
            push(game, null, hidesPinyinOnZh && game.noPinyinMarkType ? game.noPinyinMarkType : game.markType);
        }
    }
    return out;
}

/**
 * Uniform random pick that never repeats the previous break's (game, mode) unless it
 * is the only option (§ 3). Null when there is nothing to offer — the flp then simply
 * skips the break.
 */
export function pickBreakCandidate(
    candidates: readonly FlpBreakCandidate[],
    previousKey: string | null,
    rng: () => number = Math.random,
): FlpBreakCandidate | null {
    if (candidates.length === 0) return null;
    const fresh = candidates.filter((c) => c.key !== previousKey);
    const pool = fresh.length > 0 ? fresh : candidates;
    return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}
