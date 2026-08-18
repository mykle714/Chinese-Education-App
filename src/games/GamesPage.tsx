import { Box, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import { useNavigate } from "react-router-dom";
import SportsEsportsIcon from "@mui/icons-material/SportsEsports";
import NodePage from "../components/NodePage";
import { FooterSpacer } from "../components/MobileFooter";
import { HubMenu, HubMenuRow, HubMenuArrayItem, HubMenuStatBadge } from "../components/HubMenu";
import TipBox from "../components/TipBox";
import MarkTypeChip from "../components/MarkTypeChip";
import { usePageTitle } from "../hooks/usePageTitle";
import { useGameWins } from "../hooks/useGameWins";
import { GAME_REGISTRY } from "../games/registry";
import { GAME_KEY as BUBBLE_MATCH_GAME_KEY, LEVEL_CONFIGS as BUBBLE_MATCH_LEVELS } from "../games/bubble-match/constants";
import { GAME_KEY as MATCH_SPEED_GAME_KEY } from "../games/match-speed/constants";
import WordSearchHubItem from "../games/word-search/WordSearchHubItem";
import GamesCollectionSelector from "./GamesCollectionSelector";
import { withCollectionParams } from "../features/flashcards/collectionRef";
import { useSelectedCollection } from "../features/flashcards/selectedCollection";
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
// level) instead of a single HubMenuRow — it has no in-game picker, so the hub
// is the only place to pick a level. This is special-cased here (not a generic
// `GameDef.levels` field) since it's the only game that fans out this way
// today; see docs/HUB_MENU_SYSTEM.md.
//
// Match Speed is a SINGLE row again: its Review / Challenge mode sub-cards were
// removed from the hub, so every launch from here carries no `state.mode` and
// the page falls back to Study Mix (DEFAULT_MODE_CONFIG in
// match-speed/constants.ts). The mode machinery itself is untouched — a run
// still resolves a ModeConfig — there is just no UI that picks a non-default one.
//
// The header also carries the COLLECTION SELECTOR (GamesCollectionSelector): the
// hub is where a learner picks which of their card sets every game here plays with.
// The choice lives in a session-only store (features/flashcards/selectedCollection.ts)
// and reaches a game the same way a launch from a collection page always has — this
// page wraps every card's `to` in withCollectionParams, so the game arrives with
// `?deck=` / `?collection=` and reads it back via useLaunchCollection. No game page
// changed. See docs/GAMES_FEATURE.md § "Collection selector".
//
// Every card also carries a MarkTypeChip naming the mastery track that game feeds
// (docs/MASTERY_REWORK.md), read from `GameDef.markType` — which each game sets
// from its own MARK_TYPE constant, the same one its mark call uses. Word Search is
// the exception: its two modes feed DIFFERENT tracks, so WordSearchHubItem labels
// each mode sub-card from its own mode config.

/** Persistent per-level background colors for the Bubble Match sub-cards,
    keyed by LEVEL_CONFIGS' level number — greener/calmer for easier levels,
    redder for harder ones. Hardcoded, not randomized. */
const BUBBLE_MATCH_LEVEL_COLORS: Record<number, string> = {
    1: COLORS.greenAccent,
    2: COLORS.yellowAccent,
    3: COLORS.redAccent,
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

/** Mark-type chip for a game's hub card, or null for a game whose track varies by
    mode (Word Search — its own hub item labels each sub-card). */
function resolveMarkChip(game: GameDef) {
    return game.markType ? <MarkTypeChip markType={game.markType} variant="edge" /> : null;
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
    // The card set every game link below is pointed at. Session-scoped, never
    // persisted; `all` (the default) adds no params, so an untouched hub behaves
    // exactly as it did before the selector existed.
    const selectedCollection = useSelectedCollection();
    /** A game's route carrying the currently-selected collection. */
    const launchPath = (route: string) => withCollectionParams(route, selectedCollection);
    // Match Speed is a single row, so only the GAME-WIDE ×N survives — it rides
    // the row's own corner badge instead of a strip header. No per-mode ⭐: with
    // the mode sub-cards gone there is no card for a per-mode star to sit on.
    const { totalWins: matchSpeedTotalWins } = useGameWins(MATCH_SPEED_GAME_KEY);
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
        // Collection gate: Memory Map cannot be scoped to a collection — the map IS
        // your library, drawn from every playable card you have not read-mastered, and
        // it ignores `?deck=` / `?collection=` entirely. So it is HIDDEN whenever the
        // selector is set to anything but All Cards, for the same reason the language
        // gate hides rather than blocks: a visible row that quietly ignored the
        // selector reads as a bug. See docs/MEMORY_MAP_GAME.md § 10 (Q21).
        if (g.gameId === "memory-map" && selectedCollection.kind !== "all") return false;
        return true;
    });

    return (
        <NodePage title="Games" activePage="home" onBack={() => navigate("/")} contentClassName="games-page__content">
                <HubMenu
                    className="games-page__menu"
                    header={
                        <>
                            <GamesCollectionSelector className="games-page__collection-selector" />
                            <TipBox className="games-page__tip-box" />
                        </>
                    }
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
                                        to: launchPath(game.route),
                                        state: { level: cfg.level },
                                        title: game.title,
                                        subtitle: cfg.label,
                                        icon: resolveGameIcon(game),
                                        bgColor: BUBBLE_MATCH_LEVEL_COLORS[cfg.level] ?? game.bgColor,
                                        chip: resolveMarkChip(game),
                                        // ⭐ only — the ×N moved up to the group
                                        // header as a game-wide aggregate.
                                        cornerBadge: <HubMenuStatBadge starred={clearedLevels.has(cfg.level)} />,
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
                                to={launchPath(game.route)}
                                className={`games-page__menu-item games-page__menu-item--${game.gameId}`}
                                title={game.title}
                                subtitle={game.subtitle}
                                icon={resolveGameIcon(game)}
                                bgColor={game.bgColor}
                                chip={resolveMarkChip(game)}
                                // Match Speed is the only single row with a stat
                                // today: its lifetime ×N, kept when the mode strip
                                // (which carried it on a group header) was removed.
                                cornerBadge={
                                    game.gameId === "match-speed" ? (
                                        <HubMenuStatBadge count={matchSpeedTotalWins} />
                                    ) : undefined
                                }
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
