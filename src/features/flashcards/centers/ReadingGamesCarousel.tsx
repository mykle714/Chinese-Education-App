import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box } from "@mui/material";
import { useAuth } from "../../../AuthContext";
import { useSlideNavigate } from "../../../hooks/useSlideNavigate";
import { useGameWins } from "../../../hooks/useGameWins";
import { useDragScroll } from "../../../hooks/useDragScroll";
import { GAME_REGISTRY, isGameAvailable } from "../../../games/registry";
import { GAME_KEY as BUBBLE_MATCH_GAME_KEY } from "../../../games/bubble-match/constants";
import { buildBubbleMatchCard } from "../../../games/bubble-match/bubbleMatchCard";
import GameCard, { type GameCardData } from "../../../games/shared/GameCard";
import { GAME_KEY as SPEED_READING_GAME_KEY } from "../../../games/speed-reading/constants";
import { buildPlayCard } from "../../../games/shared/gameCards";
import { useWordSearchLauncher } from "../../../games/word-search/useWordSearchLauncher";
import type { GameExit } from "../../../games/runtime/gameExit";
import type { GameDef } from "../../../games/types";
import { COLORS } from "../../../theme/colors";
import { MASTERY_CENTER_PATHS, MASTERY_CENTER_TITLES } from "../masteryCenters";

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
 * Memory Map also marks reading but is not in the design's carousel — left out.
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
 * ── The loop ──────────────────────────────────────────────────────────────────
 * The design's carousel wraps: it renders the cards three times, parks the scroller on
 * the middle copy, and after each swipe settles silently jumps back by one copy-width
 * when it has drifted into an outer copy. Snap points make the jump invisible (it lands
 * on the identical card). The dots read `index % count`.
 *
 * ── No momentum ───────────────────────────────────────────────────────────────
 * The belt moves one game per swipe, however big the swipe. Touch flings are held by
 * `scroll-snap-stop: always` on every card (the browser may not coast past a snap
 * point); mouse drags by `useDragScroll`'s paged mode, which caps a drag at one page.
 *
 * ── Desktop drag ──────────────────────────────────────────────────────────────
 * Mouse click-and-drag pans the track via `useDragScroll` in paged mode, one page per
 * card step, so a release settles on the neighbouring card the way a touch swipe snaps
 * to one. While
 * that drag is in flight the hook parks `scroll-snap-type` at "none"; the loop's
 * re-centre waits it out, because jumping `scrollLeft` mid-drag would fight the hook's
 * `startScrollLeft - delta` arithmetic.
 *
 * Layer: feature component (src/features/flashcards/centers).
 */

/** The design's `.gc` width and the row's gap / side gutter. */
const CARD_WIDTH = 300;
const CARD_GAP = 10;
const SIDE_GUTTER = 22;
/** How long the scroller must be still before the loop re-centres it. */
const SETTLE_MS = 120;

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
        return out;
    }, [gameById, bubbleWins, speedReadingWins, clearedLevels, wordSearch.card, slideNavigate]);

    // ── Looping scroller ────────────────────────────────────────────────────────
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const count = cards.length;
    // The card to open on: the game just returned from, else the first. Read once —
    // after mount the learner owns the position.
    const [focusIndex] = useState(() => Math.max(0, cards.findIndex((c) => c.gameId === focusGameId)));
    const [activeDot, setActiveDot] = useState(focusIndex);
    // One card never loops — there is nothing to wrap to.
    const copies = count > 1 ? 3 : 1;
    const step = CARD_WIDTH + CARD_GAP;
    const copyWidth = step * count;

    // Desktop click-and-drag (touch already pans natively). See "Desktop drag" above.
    useDragScroll(scrollRef, { paged: true, pageWidth: step });

    // Park on the middle copy before first paint, so the first swipe can go either way —
    // on the focused card's snap point within it (`focusIndex`; snap points are one
    // `step` apart from the copy's start). A lone card has no copies to centre in.
    useLayoutEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const index = Math.min(focusIndex, Math.max(0, count - 1));
        el.scrollLeft = (copies === 3 ? copyWidth : 0) + index * step;
    }, [copies, copyWidth, count, step, focusIndex]);

    const settleTimer = useRef<number | null>(null);
    useEffect(() => () => { if (settleTimer.current) window.clearTimeout(settleTimer.current); }, []);

    const handleScroll = () => {
        const el = scrollRef.current;
        if (!el || count === 0) return;
        setActiveDot(((Math.round(el.scrollLeft / step) % count) + count) % count);
        if (copies !== 3) return;
        if (settleTimer.current) window.clearTimeout(settleTimer.current);
        // Once the swipe has settled, jump back into the middle copy if it drifted into
        // an outer one. The jump lands on the identical card, so it is invisible.
        const recentre = () => {
            // A mouse drag (or its release scroll) is still in flight — try again later.
            if (el.style.scrollSnapType === "none") {
                settleTimer.current = window.setTimeout(recentre, SETTLE_MS);
                return;
            }
            if (el.scrollLeft < copyWidth * 0.5) el.scrollLeft += copyWidth;
            else if (el.scrollLeft >= copyWidth * 1.5) el.scrollLeft -= copyWidth;
        };
        settleTimer.current = window.setTimeout(recentre, SETTLE_MS);
    };

    if (count === 0) return null;

    return (
        <Box className={`reading-games-carousel${className ? ` ${className}` : ""}`} sx={{ alignSelf: "stretch", marginTop: "16px" }}>
            <Box
                ref={scrollRef}
                className="reading-games-carousel__track"
                onScroll={handleScroll}
                sx={{
                    display: "flex",
                    gap: `${CARD_GAP}px`,
                    overflowX: "auto",
                    scrollSnapType: "x mandatory",
                    padding: `0 ${SIDE_GUTTER}px 4px`,
                    scrollPadding: `0 ${SIDE_GUTTER}px`,
                    scrollbarWidth: "none",
                    "&::-webkit-scrollbar": { display: "none" },
                    // Sideways scroller inside a vertically-scrolling page: both pans are
                    // opt-in here (CLAUDE.md "Touch & Scroll"); the page passes
                    // `horizontalPan` so its scroll area does not cap this.
                    touchAction: "pan-x pan-y",
                }}
            >
                {Array.from({ length: copies }, (_, copy) =>
                    cards.map((card) => (
                        <GameCard
                            key={`${copy}-${card.gameId}`}
                            card={card}
                            classPrefix="reading-games-carousel"
                            sx={{
                                flex: `0 0 ${CARD_WIDTH}px`,
                                scrollSnapAlign: "start",
                                // No momentum: a fling, however hard, stops at the very next
                                // card rather than coasting past several (see "No momentum"
                                // in the header comment).
                                scrollSnapStop: "always",
                            }}
                        />
                    ))
                )}
            </Box>

            {count > 1 && (
                <Box className="reading-games-carousel__dots" sx={{ display: "flex", justifyContent: "center", gap: "5px", paddingTop: "9px" }}>
                    {cards.map((card, i) => (
                        <Box
                            key={card.gameId}
                            component="i"
                            className={`reading-games-carousel__dot${i === activeDot ? " reading-games-carousel__dot--active" : ""}`}
                            sx={{
                                display: "block",
                                height: 5,
                                width: i === activeDot ? 14 : 5,
                                borderRadius: "3px",
                                backgroundColor: i === activeDot ? COLORS.onSurface : COLORS.border,
                                transition: "width 160ms ease",
                            }}
                        />
                    ))}
                </Box>
            )}

            {wordSearch.confirmDialog}
        </Box>
    );
};

export default ReadingGamesCarousel;
