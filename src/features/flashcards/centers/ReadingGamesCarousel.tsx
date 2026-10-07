import { useCallback, useMemo } from "react";
import { useAuth } from "../../../AuthContext";
import { useSlideNavigate } from "../../../hooks/useSlideNavigate";
import { useGameWins } from "../../../hooks/useGameWins";
import { GAME_REGISTRY, isGameAvailable } from "../../../games/registry";
import { GAME_KEY as BUBBLE_MATCH_GAME_KEY } from "../../../games/bubble-match/constants";
import { buildBubbleMatchCard } from "../../../games/bubble-match/bubbleMatchCard";
import type { GameCardData } from "../../../games/shared/GameCard";
import { GAME_KEY as SPEED_READING_GAME_KEY } from "../../../games/speed-reading/constants";
import { GAME_ID as BUCKET_DROP_GAME_ID, GAME_KEY as BUCKET_DROP_GAME_KEY } from "../../../games/bucket-drop/constants";
import { buildPlayCard } from "../../../games/shared/gameCards";
import { useWordSearchLauncher } from "../../../games/word-search/useWordSearchLauncher";
import type { GameExit } from "../../../games/runtime/gameExit";
import type { GameDef } from "../../../games/types";
import { MASTERY_CENTER_PATHS, MASTERY_CENTER_TITLES } from "../masteryCenters";
import GamesBelt from "./GamesBelt";

/**
 * The Reading Center's games carousel — every game that can deal a READING board, as a
 * swipeable, looping row of 300px cards with page dots (design frames r1 / r2,
 * docs/READING_WRITING_CENTERS.md § Phase 1).
 *
 * ── Which games, and how each is pinned to reading ───────────────────────────
 *   Bubble Match  — a card per level; launched with `state.showPinyin: false`, which
 *                   pins the run's track to reading whatever the learner's shared
 *                   pinyin setting says (BubbleMatchPage → `pinnedShowPinyin`).
 *   Word Search   — the No Pinyin mode only (it marks reading; Pinyin marks
 *                   production). No Pinyin has its OWN save slot, separate from the
 *                   Games hub's Pinyin board (gameStateStorage), so this card resumes
 *                   and starts only its own board. Resume box → restore it; play →
 *                   ALWAYS a new board, behind the shared clobber confirm
 *                   (`NewGameConfirmDialog`) when one is parked.
 *   Speed Reading — reading by construction; zh only (its registry `languages`).
 *   Memory Map    — reading by construction (its MARK_TYPE). Play-only, and wins no
 *                   pill: the game logs no wins. Its run resumes on its own (the map
 *                   and run live server-side / in runStorage), so Play IS resume.
 *   Bucket Drop   — the No Pinyin mode only (`state.mode: "no-pinyin"`, which marks
 *                   reading; the hub tile is the Pinyin mode). Play-only. zh ONLY, gated
 *                   here rather than by the registry's `languages`, because the game's
 *                   Pinyin mode is playable in es from the hub — and an es "no pinyin"
 *                   run would mark production (bucket-drop/constants.ts → runTrackFor), which has no place
 *                   on a reading page.
 *
 * Every launch carries `state.exitTo` (`readingCenterExit`), so the game's Back and
 * "Back to …" buttons return here rather than to the Games hub (games/runtime/gameExit),
 * and the carousel reopens parked on that game's card (`focusGameId`).
 *
 * The belt never labels a card "pinyin off" / "no pinyin" — every game here is pinned
 * to reading, so the label restated what the Reading Center already says. A card's
 * header carries only its lifetime win count, as a pill badge (`WinCountPill`).
 *
 * Every card reads its title, glyph, route and gating from GAME_REGISTRY, so a game
 * switched off by a GAME_FLAG simply drops out of the carousel. Level labels come from
 * Bubble Match's own LEVEL_CONFIGS (the design's "Gentle / Brisk / Relentless" is an
 * open flag in the doc, not restated here).
 *
 * The belt itself (looping, one card per swipe, desktop drag, dots) is `GamesBelt`.
 *
 * Layer: feature component (src/features/flashcards/centers).
 */

/**
 * Where a game launched from here exits to (games/runtime/gameExit → useGameExit).
 * The exit carries `returnedFromGame` back, so the Reading Center reopens scrolled to
 * this carousel (MasteryCenterPage → usePinScrollBottom) with `gameId`'s card parked
 * in view (`focusGameId`).
 */
function readingCenterExit(gameId: string): GameExit {
    return {
        path: MASTERY_CENTER_PATHS.reading,
        label: MASTERY_CENTER_TITLES.reading,
        state: { returnedFromGame: gameId },
    };
}

/** The game a Reading Center visit is returning from, or null for an ordinary visit. */
export function readReturnedGame(state: unknown): string | null {
    const gameId = (state as { returnedFromGame?: unknown } | null)?.returnedFromGame;
    return typeof gameId === "string" ? gameId : null;
}

interface ReadingGamesCarouselProps {
    className?: string;
    /** Open parked on this game's card (returning from it) instead of the first. */
    focusGameId?: string | null;
}

const ReadingGamesCarousel: React.FC<ReadingGamesCarouselProps> = ({ className, focusGameId }) => {
    const { user, isAuthenticated } = useAuth();
    const slideNavigate = useSlideNavigate();
    const { clearedLevels, totalWins: bubbleWins } = useGameWins(BUBBLE_MATCH_GAME_KEY);
    // Speed Reading logs a win per MEDALLED run (SpeedReadingPage → recordWin).
    const { totalWins: speedReadingWins } = useGameWins(SPEED_READING_GAME_KEY);
    // Bucket Drop logs a win per MEDALLED run, across both modes (BucketDropPage).
    const { totalWins: bucketDropWins } = useGameWins(BUCKET_DROP_GAME_KEY);

    // Same gating as the Games hub (`isGameAvailable`): auth-only games hide from
    // public accounts, language-scoped games hide from other languages.
    const gameById = useCallback((gameId: string): GameDef | undefined => {
        const g = GAME_REGISTRY.find((def) => def.gameId === gameId);
        return g && isGameAvailable(g, user, isAuthenticated) ? g : undefined;
    }, [isAuthenticated, user]);

    // Word Search: the No Pinyin mode only (it marks reading), from its OWN save slot.
    // Save slot, resume, erase and the confirm-before-clobber are all the shared
    // launcher (also the Games hub's); this surface adds only the exit back here.
    // Memoized so the launcher's card is not rebuilt every render.
    const wordSearchLaunchState = useMemo(() => ({ exitTo: readingCenterExit("word-search") }), []);
    const wordSearch = useWordSearchLauncher({
        game: gameById("word-search"),
        mode: "no-pinyin",
        classPrefix: "reading-games-carousel",
        launchState: wordSearchLaunchState,
    });

    const cards: GameCardData[] = useMemo(() => {
        const out: GameCardData[] = [];

        const bubble = gameById("bubble-match");
        if (bubble) {
            // The shared Bubble Match card (also the Games hub's), pinned to reading.
            out.push(buildBubbleMatchCard(bubble, bubbleWins, clearedLevels, (level) =>
                slideNavigate(bubble.route, {
                    state: { level, showPinyin: false, exitTo: readingCenterExit(bubble.gameId) },
                })
            ));
        }

        if (wordSearch.card) out.push(wordSearch.card);

        const speed = gameById("speed-reading");
        if (speed) {
            // Play-only: Speed Reading has no levels and no resumable board.
            out.push(buildPlayCard(speed, speedReadingWins, () =>
                slideNavigate(speed.route, { state: { exitTo: readingCenterExit(speed.gameId) } })
            ));
        }

        const bucketDrop = gameById(BUCKET_DROP_GAME_ID);
        if (bucketDrop && user?.selectedLanguage === "zh") {
            out.push(buildPlayCard(bucketDrop, bucketDropWins, () =>
                slideNavigate(bucketDrop.route, {
                    state: { mode: "no-pinyin", exitTo: readingCenterExit(bucketDrop.gameId) },
                })
            ));
        }

        const memoryMap = gameById("memory-map");
        if (memoryMap) {
            // No `wins`: Memory Map records none, so its card carries no win pill.
            out.push(buildPlayCard(memoryMap, undefined, () =>
                slideNavigate(memoryMap.route, { state: { exitTo: readingCenterExit(memoryMap.gameId) } })
            ));
        }
        return out;
    }, [gameById, bubbleWins, speedReadingWins, bucketDropWins, clearedLevels, wordSearch.card, slideNavigate, user?.selectedLanguage]);

    return (
        <GamesBelt cards={cards} classPrefix="reading-games-carousel" className={className} focusGameId={focusGameId}>
            {wordSearch.confirmDialog}
        </GamesBelt>
    );
};

export default ReadingGamesCarousel;
