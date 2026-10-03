import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from "@mui/material";
import { useAuth } from "../../../AuthContext";
import { useSlideNavigate } from "../../../hooks/useSlideNavigate";
import { useGameWins } from "../../../hooks/useGameWins";
import Icon from "../../../components/Icon";
import { GAME_REGISTRY } from "../../../games/registry";
import { GAME_KEY as BUBBLE_MATCH_GAME_KEY, LEVEL_CONFIGS, LEVEL_HUES } from "../../../games/bubble-match/constants";
import { GAME_KEY as WORD_SEARCH_GAME_KEY } from "../../../games/word-search/constants";
import { loadGameState, clearGameState, type SavedWordSearchState } from "../../../games/word-search/gameStateStorage";
import type { GameDef } from "../../../games/types";
import { COLORS, RAMP } from "../../../theme/colors";
import { FONTS } from "../../../theme/fonts";
import { SIZE, WEIGHT, TRACKING } from "../../../theme/scale";
import { SHADOW } from "../../../theme/shadows";

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
 *                   production). A parked board is offered as Resume only when it is a
 *                   No Pinyin board — a parked Pinyin board is not this page's skill.
 *   Speed Reading — reading by construction; zh only (its registry `languages`).
 * Memory Map also marks reading but is not in the design's carousel — left out.
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
 * Layer: feature component (src/features/flashcards/centers).
 */

/** The design's `.gc` width and the row's gap / side gutter. */
const CARD_WIDTH = 300;
const CARD_GAP = 10;
const SIDE_GUTTER = 22;
/** How long the scroller must be still before the loop re-centres it. */
const SETTLE_MS = 120;

/** One launch target inside a game card — the design's `.gopts > div`. */
interface GameOption {
    key: string;
    title: string;
    subtitle: string;
    /** A filled ground (a level's hue). Absent → the translucent white default. */
    ground?: string;
    /** The design's `.res`: white with an inset ink ring — "this is the thing to tap". */
    primary?: boolean;
    star?: boolean;
    onSelect: () => void;
}

interface GameCard {
    gameId: string;
    title: string;
    meta: string;
    glyph: string;
    ground: string;
    options: GameOption[];
}

const ReadingGamesCarousel: React.FC<{ className?: string }> = ({ className }) => {
    const { user, isAuthenticated } = useAuth();
    const userId = user?.id;
    const slideNavigate = useSlideNavigate();
    const { clearedLevels, totalWins: bubbleWins } = useGameWins(BUBBLE_MATCH_GAME_KEY);
    const { totalWins: wordSearchWins } = useGameWins(WORD_SEARCH_GAME_KEY);

    // Word Search's single parked board (both modes share one slot), read once.
    const [savedWordSearch, setSavedWordSearch] = useState<SavedWordSearchState | null>(() =>
        userId ? loadGameState(userId) : null
    );
    // A new board would clobber the parked one, so it is confirmed first — the same rule
    // the Games hub's WordSearchHubItem enforces. ⚠️ Duplicated from that component's
    // dialog; tracked in docs/READING_WRITING_CENTERS.md to extract once its in-flight
    // edits land.
    const [confirmNewBoard, setConfirmNewBoard] = useState(false);

    // Same gating as the Games hub (GamesPage `visibleGames`): auth-only games hide from
    // public accounts, language-scoped games hide from other languages.
    const gameById = useCallback((gameId: string): GameDef | undefined => {
        const g = GAME_REGISTRY.find((def) => def.gameId === gameId);
        if (!g) return undefined;
        if (g.requiresAuth && (!isAuthenticated || user?.isPublic)) return undefined;
        if (g.languages && user?.selectedLanguage && !g.languages.includes(user.selectedLanguage)) return undefined;
        return g;
    }, [isAuthenticated, user?.isPublic, user?.selectedLanguage]);

    const startNoPinyinBoard = useCallback((route: string) => {
        slideNavigate(route, { state: { mode: "no-pinyin", resume: false } });
    }, [slideNavigate]);

    const cards: GameCard[] = useMemo(() => {
        const out: GameCard[] = [];

        const bubble = gameById("bubble-match");
        if (bubble) {
            out.push({
                gameId: bubble.gameId,
                title: bubble.title,
                meta: `pinyin off · ×${bubbleWins}`,
                glyph: bubble.glyph,
                // White, not the game hue: its options carry the level hues, and a hued
                // card under hued options reads as one undifferentiated block.
                ground: COLORS.white,
                options: LEVEL_CONFIGS.map((cfg) => ({
                    key: `level-${cfg.level}`,
                    title: `Level ${cfg.level}`,
                    subtitle: cfg.label,
                    ground: RAMP[LEVEL_HUES[cfg.level] ?? bubble.hue].mid,
                    star: clearedLevels.has(cfg.level),
                    onSelect: () => slideNavigate(bubble.route, { state: { level: cfg.level, showPinyin: false } }),
                })),
            });
        }

        const wordSearch = gameById("word-search");
        if (wordSearch) {
            const resumable = savedWordSearch?.mode === "no-pinyin" ? savedWordSearch : null;
            const options: GameOption[] = [];
            if (resumable) {
                options.push({
                    key: "resume",
                    title: "Resume",
                    subtitle: `${resumable.found.length} of ${resumable.data.words.length} found`,
                    primary: true,
                    // No collection params on a resume — the parked board was built from
                    // whatever set it was started with (same rule as WordSearchHubItem).
                    onSelect: () => slideNavigate(wordSearch.route, { state: { mode: "no-pinyin", resume: true } }),
                });
            }
            options.push({
                key: "new",
                title: "New board",
                subtitle: "Reading",
                primary: !resumable,
                onSelect: () => {
                    if (savedWordSearch) setConfirmNewBoard(true);
                    else startNoPinyinBoard(wordSearch.route);
                },
            });
            out.push({
                gameId: wordSearch.gameId,
                title: wordSearch.title,
                meta: `no pinyin · ×${wordSearchWins}`,
                glyph: wordSearch.glyph,
                ground: RAMP[wordSearch.hue].mid,
                options,
            });
        }

        const speed = gameById("speed-reading");
        if (speed) {
            out.push({
                gameId: speed.gameId,
                title: speed.title,
                meta: speed.subtitle ?? "",
                glyph: speed.glyph,
                ground: RAMP[speed.hue].mid,
                options: [{
                    key: "play",
                    title: "Play",
                    subtitle: "Reading",
                    primary: true,
                    onSelect: () => slideNavigate(speed.route),
                }],
            });
        }
        return out;
    }, [gameById, bubbleWins, wordSearchWins, clearedLevels, savedWordSearch, slideNavigate, startNoPinyinBoard]);

    // ── Looping scroller ────────────────────────────────────────────────────────
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const [activeDot, setActiveDot] = useState(0);
    const count = cards.length;
    // One card never loops — there is nothing to wrap to.
    const copies = count > 1 ? 3 : 1;
    const step = CARD_WIDTH + CARD_GAP;
    const copyWidth = step * count;

    // Park on the middle copy before first paint, so the first swipe can go either way.
    useLayoutEffect(() => {
        const el = scrollRef.current;
        if (el && copies === 3) el.scrollLeft = copyWidth;
    }, [copies, copyWidth]);

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
        settleTimer.current = window.setTimeout(() => {
            if (el.scrollLeft < copyWidth * 0.5) el.scrollLeft += copyWidth;
            else if (el.scrollLeft >= copyWidth * 1.5) el.scrollLeft -= copyWidth;
        }, SETTLE_MS);
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
                        <GameCardView key={`${copy}-${card.gameId}`} card={card} />
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

            <Dialog
                className="reading-games-carousel__confirm-dialog"
                open={confirmNewBoard}
                onClose={() => setConfirmNewBoard(false)}
                maxWidth="xs"
            >
                <DialogTitle sx={{ fontSize: SIZE.bodyLg, fontWeight: WEIGHT.bold }}>Start a new board?</DialogTitle>
                <DialogContent>
                    <DialogContentText sx={{ fontSize: SIZE.body }}>
                        Starting a new board will erase your saved Word Search game
                        {savedWordSearch ? ` (${savedWordSearch.found.length}/${savedWordSearch.data.words.length} found)` : ""}.
                        This can't be undone.
                    </DialogContentText>
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2 }}>
                    <Button className="reading-games-carousel__confirm-cancel" onClick={() => setConfirmNewBoard(false)} size="small">
                        Cancel
                    </Button>
                    <Button
                        className="reading-games-carousel__confirm-start"
                        variant="contained"
                        color="error"
                        size="small"
                        onClick={() => {
                            const wordSearch = gameById("word-search");
                            if (userId) clearGameState(userId);
                            setSavedWordSearch(null);
                            setConfirmNewBoard(false);
                            if (wordSearch) startNoPinyinBoard(wordSearch.route);
                        }}
                    >
                        Start new board
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

/** One game card — the design's `.gc`: ghost glyph, header row, option tiles. */
const GameCardView: React.FC<{ card: GameCard }> = ({ card }) => (
    <Box
        className={`reading-games-carousel__card reading-games-carousel__card--${card.gameId}`}
        sx={{
            position: "relative",
            flex: `0 0 ${CARD_WIDTH}px`,
            scrollSnapAlign: "start",
            borderRadius: "19px",
            border: `1px solid ${COLORS.border}`,
            padding: "13px",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            backgroundColor: card.ground,
            boxShadow: SHADOW.rest,
        }}
    >
        {/* Ghost glyph — the bento tiles' corner watermark at the card's scale. */}
        <Icon
            name={card.glyph}
            size={96}
            sx={{ position: "absolute", top: -16, right: -10, opacity: 0.15, pointerEvents: "none" }}
        />
        <Box className="reading-games-carousel__card-header" sx={{ position: "relative", display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px", padding: "0 2px" }}>
            <Box component="b" sx={{ fontFamily: FONTS.sans, fontSize: 16, fontWeight: WEIGHT.bold, letterSpacing: "-0.022em", color: COLORS.onSurface }}>
                {card.title}
            </Box>
            <Box component="span" sx={{ fontFamily: FONTS.label, fontSize: 10, letterSpacing: TRACKING.caps, textTransform: "uppercase", color: COLORS.iconColor, whiteSpace: "nowrap" }}>
                {card.meta}
            </Box>
        </Box>
        <Box className="reading-games-carousel__options" sx={{ position: "relative", display: "flex", gap: "7px" }}>
            {card.options.map((opt) => (
                <Box
                    key={opt.key}
                    component="button"
                    type="button"
                    className={`reading-games-carousel__option reading-games-carousel__option--${opt.key}`}
                    onClick={opt.onSelect}
                    sx={{
                        position: "relative",
                        flex: 1,
                        minWidth: 0,
                        minHeight: 62,
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "flex-end",
                        alignItems: "flex-start",
                        textAlign: "left",
                        borderRadius: "13px",
                        padding: "9px 10px",
                        cursor: "pointer",
                        // `.gopts > div` default is a translucent white over the card;
                        // `.res` is solid white carrying an inset ink ring instead of a
                        // hairline; a level option is filled with its hue's MID tier.
                        border: opt.primary ? "1px solid transparent" : `1px solid ${COLORS.border}`,
                        boxShadow: opt.primary ? `inset 0 0 0 1.5px ${COLORS.onSurface}` : "none",
                        backgroundColor: opt.primary ? COLORS.white : opt.ground ?? COLORS.frost,
                    }}
                >
                    {opt.star && (
                        <Box component="span" className="reading-games-carousel__option-star" sx={{ position: "absolute", top: 7, right: 8, fontSize: 11 }}>
                            ⭐
                        </Box>
                    )}
                    <Box component="b" sx={{ fontFamily: FONTS.sans, fontSize: 12.5, fontWeight: WEIGHT.bold, letterSpacing: "-0.018em", color: COLORS.onSurface }}>
                        {opt.title}
                    </Box>
                    <Box component="small" sx={{ fontFamily: FONTS.sans, fontSize: 10.5, color: COLORS.textSecondary }}>
                        {opt.subtitle}
                    </Box>
                </Box>
            ))}
        </Box>
    </Box>
);

export default ReadingGamesCarousel;
