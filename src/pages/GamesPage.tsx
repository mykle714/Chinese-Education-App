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
import { MODE_CONFIGS as WORD_SEARCH_MODES, type WordSearchMode } from "../games/word-search/constants";
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
// Bubble Match renders as a HubMenuArrayItem (one sub-card per difficulty
// level) instead of a single HubMenuRow — the in-game "start" level picker was
// removed, so the hub is now the only place to pick a level. This is
// special-cased here (not a generic `GameDef.levels` field) since it's the
// only game that fans out today; see docs/HUB_MENU_SYSTEM.md.

/** Persistent per-level background colors for the Bubble Match sub-cards,
    keyed by LEVEL_CONFIGS' level number — greener/calmer for easier levels,
    redder for harder ones. Hardcoded, not randomized. */
const BUBBLE_MATCH_LEVEL_COLORS: Record<number, string> = {
    1: COLORS.greenAccent,
    2: COLORS.yellowAccent,
    3: COLORS.redAccent,
};

/** Persistent per-mode background colors for the Word Search sub-cards. Like
    Bubble Match, Word Search fans out into several hub sub-cards (Pinyin /
    No Pinyin) instead of a single row — see docs/WORD_SEARCH_GAME.md §3. */
const WORD_SEARCH_MODE_COLORS: Record<WordSearchMode, string> = {
    "pinyin": COLORS.purpleAccent,
    "no-pinyin": COLORS.blueAccent,
};

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
    // Weekly ⭐ + lifetime win-count badges for the Bubble Match level
    // sub-cards, from the same `wins` table BubbleMatchPage itself reads.
    const { clearedLevels, lifetimeWins } = useGameWins(BUBBLE_MATCH_GAME_KEY);

    // Apply registry-level gating: `requiresAuth` hides games from public/demo
    // accounts; `unlock.minVocabEntries` is reserved for future gating once a
    // vocab count is available client-side.
    const visibleGames = GAME_REGISTRY.filter((g) => {
        if (g.requiresAuth && (!isAuthenticated || user?.isPublic)) return false;
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
                                    items={BUBBLE_MATCH_LEVELS.map((cfg) => ({
                                        key: `${game.gameId}-${cfg.level}`,
                                        to: game.route,
                                        state: { level: cfg.level },
                                        title: game.title,
                                        subtitle: cfg.label,
                                        icon: resolveGameIcon(game),
                                        bgColor: BUBBLE_MATCH_LEVEL_COLORS[cfg.level] ?? game.bgColor,
                                        cornerBadge: (
                                            <HubMenuStatBadge
                                                starred={clearedLevels.has(cfg.level)}
                                                count={lifetimeWins[cfg.level]}
                                            />
                                        ),
                                    }))}
                                />
                            );
                        }
                        if (game.gameId === "word-search") {
                            return (
                                <HubMenuArrayItem
                                    key={game.gameId}
                                    className="games-page__menu-item games-page__menu-item--word-search"
                                    items={WORD_SEARCH_MODES.map((cfg) => ({
                                        key: `${game.gameId}-${cfg.mode}`,
                                        to: game.route,
                                        // Word Search keeps a single route; the tapped
                                        // pinyin mode is passed via nav state, and each
                                        // mode has its own saved board.
                                        state: { mode: cfg.mode },
                                        title: game.title,
                                        subtitle: cfg.label,
                                        icon: resolveGameIcon(game),
                                        bgColor: WORD_SEARCH_MODE_COLORS[cfg.mode] ?? game.bgColor,
                                    }))}
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
