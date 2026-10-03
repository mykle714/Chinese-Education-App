import React from "react";
import { withCollectionParams } from "../../features/flashcards/collectionRef";
import { useSelectedCollection } from "../../features/flashcards/selectedCollection";
import GameCard from "../shared/GameCard";
import type { GameDef } from "../types";
import type { WordSearchMode } from "./constants";
import { useWordSearchLauncher } from "./useWordSearchLauncher";

/**
 * The Games hub only offers PINYIN. No Pinyin is a reading drill and is launched
 * from the Reading Center's games carousel instead (ReadingGamesCarousel), with its
 * own save slot — see gameStateStorage. Removed from the hub 2026-10-03. This one
 * mode is both what the card launches and the save slot it resumes.
 */
const HUB_MODE: WordSearchMode = "pinyin";

/**
 * Word Search's Games-hub entry — the SAME card the Reading Center's carousel shows,
 * spanning the hub's full grid row like Bubble Match's card above it. All save-slot,
 * confirm-before-clobber and navigation behaviour is `useWordSearchLauncher` (shared
 * with the carousel); this component only picks the hub's slot (Pinyin) and points a
 * NEW game at the collection chosen in the hub's chip. See docs/WORD_SEARCH_GAME.md §3.
 *
 * Layer: feature component (src/games/word-search) built on the shared GameCard.
 */

interface WordSearchHubItemProps {
    game: GameDef;
}

const WordSearchHubItem: React.FC<WordSearchHubItemProps> = ({ game }) => {
    // The collection chosen in the hub's chip. This card navigates imperatively (to
    // confirm before clobbering a save), so it has to apply the params itself.
    const selectedCollection = useSelectedCollection();
    const { card, confirmDialog } = useWordSearchLauncher({
        game,
        mode: HUB_MODE,
        classPrefix: "games-page",
        newGamePath: withCollectionParams(game.route, selectedCollection),
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
