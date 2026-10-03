import type { GameCardData } from "../shared/GameCard";
import { gameCardBase } from "../shared/gameCards";
import type { GameDef } from "../types";
import type { SavedWordSearchState } from "./gameStateStorage";
import WordSearchResumeTile from "./WordSearchResumeTile";

interface BuildWordSearchCardArgs {
    game: GameDef;
    /** Lifetime win count (useGameWins `totalWins`) for the header pill. */
    wins: number;
    /** The launching surface's parked board (its own save slot), or null. */
    saved: SavedWordSearchState | null;
    /** The device-local "show timer" preference — hides the parked time when off. */
    showTimer: boolean;
    /** BEM block for the resume tile's classes — the same prefix the host passes to
     *  `GameCard`, so the whole card shares one block. */
    classPrefix: string;
    /** The resume tile was tapped: restore `saved`. */
    onResume: () => void;
    /** The resume tile's ✕ → Delete went through: clear the host's save slot. */
    onErase: () => void;
    /** The play button was tapped: deal a NEW board (the host confirms first when one
     *  is parked, since the fresh game overwrites the slot). */
    onPlay: () => void;
}

/**
 * Word Search's `GameCard` data — an all-purple card whose only option is the shared
 * RESUME tile (kind "resume", one level slot wide) when a board is parked, plus the
 * corner play button. The ONE definition of the card; both surfaces reach it through
 * `useWordSearchLauncher`, so they can only differ in which mode/save slot they launch
 * and where the launch exits to.
 *
 * Its outer frame is NOT outlined (`outlined: false`, the CLAUDE.md § "Buttons &
 * cards" exception); the resume tile inside it keeps the outline.
 *
 * Referenced by: games/word-search/useWordSearchLauncher.
 * Docs: docs/WORD_SEARCH_GAME.md § 3, docs/READING_WRITING_CENTERS.md.
 */
export function buildWordSearchCard({
    game, wins, saved, showTimer, classPrefix, onResume, onErase, onPlay,
}: BuildWordSearchCardArgs): GameCardData {
    return {
        ...gameCardBase(game, wins),
        outlined: false,
        options: saved ? [{
            kind: "resume",
            key: "resume",
            node: (
                <WordSearchResumeTile
                    classPrefix={classPrefix}
                    saved={saved}
                    showTimer={showTimer}
                    onResume={onResume}
                    onErase={onErase}
                />
            ),
        }] : [],
        play: { ariaLabel: "Start a new Word Search", onSelect: onPlay },
    };
}
