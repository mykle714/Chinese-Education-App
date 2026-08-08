import { Box, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import { useNavigate } from "react-router-dom";
import SportsEsportsIcon from "@mui/icons-material/SportsEsports";
import NodePage from "../components/NodePage";
import { FooterSpacer } from "../components/MobileFooter";
import { HubMenu, HubMenuRow, HubMenuArrayItem, HubMenuStatBadge } from "../components/HubMenu";
import TipBox from "../components/TipBox";
import { usePageTitle } from "../hooks/usePageTitle";
import { useGameWins } from "../hooks/useGameWins";
import { GAME_REGISTRY } from "../games/registry";
import { GAME_KEY as BUBBLE_MATCH_GAME_KEY, LEVEL_CONFIGS as BUBBLE_MATCH_LEVELS } from "../games/bubble-match/constants";
import { GAME_KEY as MATCH_SPEED_GAME_KEY, MODE_CONFIGS as MATCH_SPEED_MODES } from "../games/match-speed/constants";
import type { MatchSpeedMode } from "../games/match-speed/types";
import WordSearchHubItem from "../games/word-search/WordSearchHubItem";
import { useAuth } from "../AuthContext";
import type { GameDef } from "../games/types";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { SIZE, WEIGHT } from "../theme/scale";

// Games is a NODE PAGE (see docs/LEAF_NODE_PAGES.md): it keeps the footer and
// uses the LEFT back arrow + horizontal slide. Phone-frame sizing comes from
// MobileDemoFrame via Layout.tsx; the scroll-away header + floating footer +
// scroll behavior come from MobileTabScreen (wrapped by NodePage, which adds the
// slide-in-from-right / slide-out-to-right-on-arrow transition); the row list
// comes from the shared HubMenu (also used by the Discover hub) — this page
// owns game gating, the empty state, and the tip-box header / spacer footer
// (see docs/HUB_MENU_SYSTEM.md).
//
// Bubble Match and Match Speed each render as a HubMenuArrayItem (one sub-card
// per difficulty level / mode) instead of a single HubMenuRow — neither has an
// in-game picker, so the hub is the only place to pick one. These are
// special-cased here (not a generic `GameDef.levels` field) since they are the
// only games that fan out today; see docs/HUB_MENU_SYSTEM.md.

/** Persistent per-level background colors for the Bubble Match sub-cards,
    keyed by LEVEL_CONFIGS' level number — greener/calmer for easier levels,
    redder for harder ones. Hardcoded, not randomized. */
const BUBBLE_MATCH_LEVEL_COLORS: Record<number, string> = {
    1: COLORS.greenAccent,
    2: COLORS.yellowAccent,
    3: COLORS.redAccent,
};

/** Persistent per-mode background colors for the Match Speed sub-cards, keyed by
    MODE_CONFIGS' mode. Deliberately the SAME palette as the /decks study buttons
    (FlashcardsDecksPage.tsx: neutral header surface for Study Mix, blueAccent for
    Review, redAccent for Challenge) — the modes use the identical bucket rule, so they should
    read as the same concept in both places. Hardcoded, not randomized. */
const MATCH_SPEED_MODE_COLORS: Record<MatchSpeedMode, string> = {
    mixed: COLORS.header,
    review: COLORS.blueAccent,
    challenge: COLORS.redAccent,
};

// Word Search also fans out into a strip of hub sub-cards (Pinyin / No Pinyin),
// plus a leading resume card when a saved board exists — but its mode buttons
// need custom click handling (confirm-before-clobber) and its own saved-state
// read, so the whole strip is owned by WordSearchHubItem rather than a generic
// HubMenuArrayItem. See docs/WORD_SEARCH_GAME.md §3.

const EmptyState = styled(Box)(() => ({
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "32px 24px",
    textAlign: "center",
    gap: 8,
}));

/** Resolved icon node for a game's hub tile: its image asset (Vite-imported
    URL) if it has one, else the generic controller glyph. Shared by the
    single-row rendering and every Bubble Match level sub-card. */
function resolveGameIcon(game: GameDef) {
    return game.iconAsset ? (
        <Box component="img" src={game.iconAsset} alt="" sx={{ width: "100%", height: "100%", objectFit: "cover" }} />
    ) : (
        <SportsEsportsIcon sx={{ color: COLORS.textSecondary }} />
    );
}

const GamesPage: React.FC = () => {
    usePageTitle("Games");
    const navigate = useNavigate();
    const { user, isAuthenticated } = useAuth();
    // Bubble Match win badges, from the same `wins` table BubbleMatchPage itself
    // reads. Two granularities on purpose: the ×N count is GAME-WIDE and lives on
    // the strip's group header, while the weekly ⭐ stays per level sub-card
    // (a star means "you cleared THIS level this week").
    const { clearedLevels, totalWins: bubbleMatchTotalWins } = useGameWins(BUBBLE_MATCH_GAME_KEY);
    // Same two granularities for Match Speed's mode strip: ⭐ per mode (a gold run
    // on THAT mode this week) on each sub-card, ×N game-wide on the group header.
    const { clearedLevels: matchSpeedClearedModes, totalWins: matchSpeedTotalWins } =
        useGameWins(MATCH_SPEED_GAME_KEY);
    // Apply registry-level gating: `requiresAuth` hides games from public/demo
    // accounts; `unlock.minVocabEntries` is reserved for future gating once a
    // vocab count is available client-side.
    const visibleGames = GAME_REGISTRY.filter((g) => {
        if (g.requiresAuth && (!isAuthenticated || user?.isPublic)) return false;
        // Language gate: a game that declares `languages` is HIDDEN from learners
        // of any other language, rather than shown and blocked on entry — a
        // visible row that dead-ends reads as a bug. Speed Reading is the only
        // such game today (zh-only; it substitutes single characters).
        if (g.languages && user?.selectedLanguage && !g.languages.includes(user.selectedLanguage)) return false;
        return true;
    });

    return (
        <NodePage title="Games" activePage="home" onBack={() => navigate("/")} contentClassName="games-page__content">
                <HubMenu
                    className="games-page__menu"
                    header={<TipBox className="games-page__tip-box" />}
                    footer={<FooterSpacer />}
                >
                    {visibleGames.map((game: GameDef) => {
                        // Bubble Match and Word Search both fan out into a
                        // horizontal strip of sub-cards (one per level / pinyin
                        // mode) instead of a single row — each sub-card keeps the
                        // game's single route and passes its choice via nav state.
                        // These are special-cased here (not a generic
                        // `GameDef.levels` field) since they're the only fan-out
                        // games today; see docs/HUB_MENU_SYSTEM.md.
                        if (game.gameId === "bubble-match") {
                            return (
                                <HubMenuArrayItem
                                    key={game.gameId}
                                    className="games-page__menu-item games-page__menu-item--bubble-match"
                                    headerTitle={game.title}
                                    headerStat={<HubMenuStatBadge variant="header" count={bubbleMatchTotalWins} />}
                                    items={BUBBLE_MATCH_LEVELS.map((cfg) => ({
                                        key: `${game.gameId}-${cfg.level}`,
                                        to: game.route,
                                        state: { level: cfg.level },
                                        title: game.title,
                                        subtitle: cfg.label,
                                        icon: resolveGameIcon(game),
                                        bgColor: BUBBLE_MATCH_LEVEL_COLORS[cfg.level] ?? game.bgColor,
                                        // ⭐ only — the ×N moved up to the group
                                        // header as a game-wide aggregate.
                                        cornerBadge: <HubMenuStatBadge starred={clearedLevels.has(cfg.level)} />,
                                    }))}
                                />
                            );
                        }
                        if (game.gameId === "match-speed") {
                            return (
                                <HubMenuArrayItem
                                    key={game.gameId}
                                    className="games-page__menu-item games-page__menu-item--match-speed"
                                    headerTitle={game.title}
                                    headerStat={<HubMenuStatBadge variant="header" count={matchSpeedTotalWins} />}
                                    items={MATCH_SPEED_MODES.map((cfg) => ({
                                        key: `${game.gameId}-${cfg.mode}`,
                                        to: game.route,
                                        // The page reads `state.mode` and falls back
                                        // to Mix if it's missing (direct URL).
                                        state: { mode: cfg.mode },
                                        title: game.title,
                                        subtitle: cfg.label,
                                        icon: resolveGameIcon(game),
                                        bgColor: MATCH_SPEED_MODE_COLORS[cfg.mode] ?? game.bgColor,
                                        // ⭐ only — the ×N lives on the group header.
                                        cornerBadge: (
                                            <HubMenuStatBadge starred={matchSpeedClearedModes.has(cfg.winLevel)} />
                                        ),
                                    }))}
                                />
                            );
                        }
                        if (game.gameId === "word-search") {
                            return (
                                <WordSearchHubItem
                                    key={game.gameId}
                                    className="games-page__menu-item games-page__menu-item--word-search"
                                    game={game}
                                    icon={resolveGameIcon(game)}
                                />
                            );
                        }
                        return (
                            <HubMenuRow
                                key={game.gameId}
                                to={game.route}
                                className={`games-page__menu-item games-page__menu-item--${game.gameId}`}
                                title={game.title}
                                subtitle={game.subtitle}
                                icon={resolveGameIcon(game)}
                                bgColor={game.bgColor}
                            />
                        );
                    })}
                </HubMenu>

                {/* Empty state until the first game ships (or all games are gated out). */}
                {visibleGames.length === 0 && (
                    <EmptyState className="games-page__empty">
                        <Typography
                            className="games-page__empty-title"
                            sx={{
                                fontSize: SIZE.subtitle,
                                fontWeight: WEIGHT.medium,
                                color: COLORS.onSurface,
                                fontFamily: FONTS.sans,
                            }}
                        >
                            No games yet
                        </Typography>
                        <Typography
                            className="games-page__empty-subtitle"
                            sx={{
                                fontSize: SIZE.body,
                                color: COLORS.textSecondary,
                                fontFamily: FONTS.sans,
                            }}
                        >
                            Games will appear here as we build them.
                        </Typography>
                    </EmptyState>
                )}
        </NodePage>
    );
};

export default GamesPage;
