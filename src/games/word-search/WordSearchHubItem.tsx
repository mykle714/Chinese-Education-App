import React from "react";
import GameCard from "../shared/GameCard";
import type { GameDef } from "../types";
import type { WordSearchMode } from "./constants";
import { useWordSearchLauncher } from "./useWordSearchLauncher";

/**
 * The Games hub only offers PINYIN (No Pinyin left the hub 2026-10-03; it is played only
 * as a reading-flp game break now, which never saves a board). This one mode is both
 * what the card launches and the save slot it resumes.
 */
const HUB_MODE: WordSearchMode = "pinyin";

/**
 * Word Search's Games-hub entry — a shared GameCard spanning the hub's full grid row
 * like Bubble Match's card above it. All save-slot, confirm-before-clobber and
 * navigation behaviour is `useWordSearchLauncher`; this component only picks the hub's
 * slot (Pinyin).
 * See docs/WORD_SEARCH_GAME.md §3.
 *
 * Layer: feature component (src/games/word-search) built on the shared GameCard.
 */

interface WordSearchHubItemProps {
    game: GameDef;
}

const WordSearchHubItem: React.FC<WordSearchHubItemProps> = ({ game }) => {
    const { card, confirmDialog } = useWordSearchLauncher({
        game,
        mode: HUB_MODE,
        classPrefix: "games-page",
    });

    return (
        <>
            {/* Full grid row, exactly as GamesPage sizes Bubble Match's card. */}
            {card && <GameCard card={card} classPrefix="games-page" sx={{ gridColumn: "1 / -1" }} />}
            {confirmDialog}
        </>
    );
};

export default WordSearchHubItem;
