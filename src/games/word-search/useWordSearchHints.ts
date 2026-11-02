import { useCallback, useEffect, useRef, useState } from "react";
import { HINT_BAR_UNITS, HINT_COST } from "./constants";
import { countComponentUnits } from "./componentUnits";
import type { SavedWordSearchState } from "./gameStateStorage";
import { countPinyinRevealSteps } from "./pinyinUnits";
import type { BonusWord, PlacedWord, WordSearchResponse } from "./types";

/** The hint state a saved board carries (gameStateStorage.ts). */
export type HintSnapshot = Pick<
    SavedWordSearchState,
    "hintUnits" | "hintEntryKey" | "hintRevealCount" | "hintLocationRevealed" | "rewardedBonusWords" | "hintedWords"
>;

/**
 * useWordSearchHints — the hint meter and what it buys (docs/WORD_SEARCH_GAME.md §5a).
 *
 * Each successful find adds a unit (capped at HINT_BAR_UNITS); a hint is spendable once
 * >= HINT_COST units are banked. The hint row is BLANK until the first spend.
 * `entryKey` is the one word currently being hinted (or null); `revealCount` is how many
 * reveal steps of that word have been bought, hangman-style — on the Pinyin board the
 * first steps buy each character's letter count in turn and the rest buy phonetic units
 * (see pinyinUnits.ts / WordSearchHintRow's buildMask) — each further hint buys another
 * step of the SAME word until it's found (row clears) or fully spelled out. Once fully
 * spelled out, pressing hint again doesn't move on to a different word: it flips
 * `locationRevealed` (the word's actual grid cells show in yellow, persistently, until
 * it's found) and bumps `shakeNonce` to re-shake those cells.
 *
 * Layer: game hook. Depended on by: WordSearchStage.tsx.
 */
export function useWordSearchHints(args: {
    data: WordSearchResponse | null;
    found: Set<string>;
    showPinyin: boolean;
    /** A hint that cost units was spent; a free re-shake does not call this. */
    onSpend: () => void;
}) {
    const { data, found, showPinyin, onSpend } = args;
    const onSpendRef = useRef(onSpend);
    onSpendRef.current = onSpend;

    const [units, setUnits] = useState(0);
    const [entryKey, setEntryKey] = useState<string | null>(null);
    const [revealCount, setRevealCount] = useState(0);
    const [locationRevealed, setLocationRevealed] = useState(false);
    const [shakeNonce, setShakeNonce] = useState(0);
    // Each DISTINCT "blue match" (multi-character bonus word, see WordSearchGrid's
    // onBonusFound) awards one hint unit the first time it's traced. Tracked by entryKey
    // so re-tracing the SAME bonus word again (its popup has no auto-dismiss, so it's easy
    // to re-trigger) doesn't re-award — a different bonus word still grants its own unit.
    const rewardedBonusWordsRef = useRef<Set<string>>(new Set());
    // Every word that has EVER received a hint on this board (any reveal step —
    // pinyin/component units OR the yellow location reveal). Finding one of these does NOT
    // emit a flashcard mark: the player was shown part of the answer, so it isn't evidence
    // of recall and would inflate mastery. A ref, not state, because nothing renders from it.
    const hintedWordsRef = useRef<Set<string>>(new Set());

    // Read by `snapshot`, which runs from listeners outside React's render.
    const latestRef = useRef({ units, entryKey, revealCount, locationRevealed });
    useEffect(() => {
        latestRef.current = { units, entryKey, revealCount, locationRevealed };
    });

    /** The meter and every hint on the board, cleared for a new board. */
    const reset = useCallback(() => {
        setUnits(0);
        setEntryKey(null);
        setRevealCount(0);
        setLocationRevealed(false);
        setShakeNonce(0);
        rewardedBonusWordsRef.current = new Set();
        hintedWordsRef.current = new Set();
    }, []);

    const restore = useCallback((saved: HintSnapshot) => {
        setUnits(saved.hintUnits);
        setEntryKey(saved.hintEntryKey);
        setRevealCount(saved.hintRevealCount);
        setLocationRevealed(saved.hintLocationRevealed);
        setShakeNonce(0);
        rewardedBonusWordsRef.current = new Set(saved.rewardedBonusWords);
        // Older snapshots predate hint-tracking — treat them as "nothing hinted".
        hintedWordsRef.current = new Set(saved.hintedWords ?? []);
    }, []);

    const snapshot = useCallback((): HintSnapshot => {
        const s = latestRef.current;
        return {
            hintUnits: s.units,
            hintEntryKey: s.entryKey,
            hintRevealCount: s.revealCount,
            hintLocationRevealed: s.locationRevealed,
            rewardedBonusWords: [...rewardedBonusWordsRef.current],
            hintedWords: [...hintedWordsRef.current],
        };
    }, []);

    const isHinted = useCallback((key: string) => hintedWordsRef.current.has(key), []);

    /** A find: rewards one unit, and clears the row if it was the hinted word. */
    const noteFound = useCallback((word: PlacedWord) => {
        setUnits((u) => Math.min(HINT_BAR_UNITS, u + 1));
        if (entryKey === word.entryKey) {
            setEntryKey(null);
            setRevealCount(0);
            setLocationRevealed(false);
        }
    }, [entryKey]);

    /** The first trace of each bonus word awards one unit. */
    const noteBonus = useCallback((bonus: BonusWord) => {
        if (rewardedBonusWordsRef.current.has(bonus.entryKey)) return;
        rewardedBonusWordsRef.current.add(bonus.entryKey);
        setUnits((u) => Math.min(HINT_BAR_UNITS, u + 1));
    }, []);

    // Pressing hint is "usable" if the currently-hinted word's location is already
    // revealed (re-shaking it is FREE — see `spend`), or if there are spare units and any
    // word is still unfound.
    const canUse = useCallback((): boolean => {
        if (!data) return false;
        const current = data.words.find((w) => w.entryKey === entryKey);
        if (locationRevealed && current && !found.has(current.entryKey)) return true;
        if (units < HINT_COST) return false;
        return data.words.some((w) => !found.has(w.entryKey));
    }, [data, entryKey, locationRevealed, units, found]);

    // How many reveals the hinted word offers before its location is the only thing left
    // to give. The two boards spend DIFFERENT currencies for the same ladder: the Pinyin
    // board buys each character's letter count first and then spells out phonetic units
    // (countPinyinRevealSteps = chars + units), while the No Pinyin board — which exists
    // to hide exactly that — reveals sub-character component glyphs and then the character
    // itself, per character (see componentUnits.ts). Everything after "fully revealed"
    // (location reveal, then the free re-shake) is shared.
    const totalRevealUnits = useCallback(
        (word: PlacedWord): number =>
            showPinyin
                ? countPinyinRevealSteps(word.pinyin)
                : countComponentUnits(word.entryKey, word.charComponents),
        [showPinyin]
    );

    // Spend a hint:
    // - Current hinted word already has its LOCATION revealed (fully spelled out and
    //   nagged once before): re-shake it for FREE, no unit cost — the player has already
    //   paid for this reveal, so repeat presses are just a "where was that again?" nudge.
    // - Current hinted word still unfound, reveal units left: drain HINT_COST and reveal
    //   one more.
    // - Current hinted word still unfound, fully spelled out for the first time: drain
    //   HINT_COST, lock onto it, and reveal its actual grid location in yellow (persists
    //   until found).
    // - No active hint, or the active word was just found: drain HINT_COST, pick a new
    //   random unfound word, and reveal its first unit.
    const spend = useCallback(() => {
        if (!data) return;
        const current = data.words.find((w) => w.entryKey === entryKey);
        if (current && !found.has(current.entryKey)) {
            if (locationRevealed) {
                setShakeNonce((n) => n + 1);
                return;
            }
            if (units < HINT_COST) return;
            hintedWordsRef.current.add(current.entryKey);
            if (revealCount < totalRevealUnits(current)) {
                setRevealCount((c) => c + 1);
            } else {
                setLocationRevealed(true);
                setShakeNonce((n) => n + 1);
            }
            setUnits((u) => u - HINT_COST);
            onSpendRef.current();
            return;
        }
        if (units < HINT_COST) return;
        const unfound = data.words.filter((w) => !found.has(w.entryKey));
        if (unfound.length === 0) return;
        const pick = unfound[Math.floor(Math.random() * unfound.length)];
        hintedWordsRef.current.add(pick.entryKey);
        setEntryKey(pick.entryKey);
        setRevealCount(1);
        setLocationRevealed(false);
        setUnits((u) => u - HINT_COST);
        onSpendRef.current();
    }, [data, units, entryKey, revealCount, locationRevealed, found, totalRevealUnits]);

    return {
        units, entryKey, revealCount, locationRevealed, shakeNonce,
        canUse, spend, noteFound, noteBonus, isHinted, reset, restore, snapshot,
    };
}
