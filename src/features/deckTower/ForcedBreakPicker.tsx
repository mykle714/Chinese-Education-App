import React, { useMemo } from "react";
import TesterChipRow, { type TesterChipOption } from "./TesterChipRow";
import { flpBreakSuiteFor } from "../../games/flpBreak";
import { setForcedBreak, useForcedBreak } from "../flashcards/FlashcardsLearnPage/gameBreak/forcedBreak";
import type { FlpWorld } from "../../../server/contracts/studyMode";
import type { Language } from "../../types";

/**
 * ForcedBreakPicker — the FEATURE-TESTER row of chips under the time-of-day row that pins
 * this world's next card to one game: Auto · <the world's suite>
 * (docs/DECK_TOWER.md § "Forced game breaks", docs/FLP_GAME_BREAKS.md § 10).
 *
 * Layer: page-private component (feature module `src/features/deckTower`). The pin lives in
 * forcedBreak.ts, one per world; this row shows the pin of the world on screen. A game in
 * the world's suite with no break adapter yet stays on the row, disabled, and turns on by
 * itself when its adapter lands.
 *
 * Depends on: TesterChipRow.tsx, src/games/flpBreak (`flpBreakSuiteFor`), forcedBreak.ts.
 * Depended on by: DeckTowerPage.tsx, which mounts it only for `users.isFeatureTester`.
 */

/** The chip for no pin. A candidate key always holds a ":", so it cannot collide. */
const AUTO = "auto";

interface ForcedBreakPickerProps {
    world: FlpWorld;
    language: Language;
}

const ForcedBreakPicker: React.FC<ForcedBreakPickerProps> = ({ world, language }) => {
    const pin = useForcedBreak(world, true);
    const options = useMemo<TesterChipOption<string>[]>(
        () => [
            { value: AUTO, label: "Auto" },
            ...flpBreakSuiteFor(world, language).map(({ candidate, playable }) => ({
                value: candidate.key,
                label: candidate.game.title,
                disabled: !playable,
            })),
        ],
        [world, language]
    );
    // A pin this suite cannot play (it was set in another language) reads as Auto, which
    // is also how useGameBreak treats it.
    const value = options.some((o) => o.value === pin && !o.disabled) ? (pin as string) : AUTO;

    return (
        <TesterChipRow
            classBase="deck-tower-page__forced-break"
            ariaLabel="Force the next card's game (feature testing)"
            options={options}
            value={value}
            onChange={(next) => setForcedBreak(world, next === AUTO ? null : next)}
        />
    );
};

export default ForcedBreakPicker;
