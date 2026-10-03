import { Box, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import { useNavigate } from "react-router-dom";
import NodePage from "../components/NodePage";
import { FooterSpacer, ScrollPastSpacer } from "../components/MobileFooter";
import { Bento } from "../components/bento";
import TipBox from "../components/TipBox";
import { usePageTitle } from "../hooks/usePageTitle";
import { useGameWins } from "../hooks/useGameWins";
import { GAME_REGISTRY, isGameAvailable } from "../games/registry";
import { GAME_KEY as BUBBLE_MATCH_GAME_KEY } from "../games/bubble-match/constants";
import { buildBubbleMatchCard } from "../games/bubble-match/bubbleMatchCard";
import GameCard from "../games/shared/GameCard";
import { buildTileCard } from "../games/shared/gameCards";
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
// grid comes from the shared BENTO primitive (docs/SHELF_REDESIGN.md § A4, entry
// 4) — this page owns game gating, the empty state, and the tip-box / spacer.
//
// EVERY game here is a `GameCard` (games/shared/GameCard), in one of its two Bento-
// family variants: `card` (full row, with launch options) for Bubble Match and Word
// Search, `tile` (half width, the whole tile launches) for every other game.
//
// Bubble Match renders as the SAME level card the Reading Center's games carousel
// uses (games/shared/GameCard + bubble-match/bubbleMatchCard), spanning the Bento's
// full row, instead of a single tile — it has no in-game picker, so the hub is the
// only place to pick a level. Special-cased here (not a generic `GameDef.levels`
// field) since it is the only game that fans out this way today. The card's level
// tiles read only "Level N" (no Chill/Hustle/Torture subtitle since 2026-10-03), so
// they follow the name-only rule below like every other tile.
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
// NAME-ONLY TILES (2026-10-03). Every hub tile and sub-tile shows only its name — no
// subtitle. The tiles used to carry the mastery track plus a short blurb
// ("Recognition · 30-second clock", and Bubble Match's "Chill"/"Hustle"/"Torture"
// level labels); all of it was dropped so the hub reads as a plain list of names.
// The track a game feeds is still `GameDef.markType`, which its page marks with —
// it is just no longer advertised here.
//
// Bubble Match is PINNED TO RECOGNITION here. Its track follows pinyin (shown ⇒
// Recognition, hidden ⇒ Reading — docs/MASTERY_REWORK.md § 1a), and the hub used to
// carry a Recognition ⇄ Reading toggle on the strip header. Since 2026-10-03 the
// Reading half lives in the Reading Center's games carousel (which pins
// `showPinyin: false`), so every hub level launches with `state.showPinyin: true` —
// pinning it the same way rather than leaving the run to the shared flp pinyin
// setting, which would otherwise silently put a hub run on the Reading track.

// Word Search is likewise the Reading Center's card (games/shared/GameCard +
// word-search/wordSearchCard), full row, with its parked board's resume tile inside
// it — but its play button needs confirm-before-clobber handling and its own
// saved-state read, so the whole entry is owned by WordSearchHubItem. See
// docs/WORD_SEARCH_GAME.md §3.

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

const GamesPage: React.FC = () => {
    usePageTitle("Games");
    const navigate = useNavigate();
    const { user, isAuthenticated } = useAuth();
    // Bubble Match win badges, from the same `wins` table BubbleMatchPage itself
    // reads. Two granularities on purpose: the lifetime count is GAME-WIDE and rides
    // the card header's win pill, while the weekly ⭐ stays per level tile
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
        // Auth + language gates, shared with the Reading Center carousel.
        if (!isGameAvailable(g, user, isAuthenticated)) return false;
        // Hub-hidden games (Speed Reading) launch from elsewhere — GameDef.hiddenFromHub.
        if (g.hiddenFromHub) return false;
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
        <NodePage title="Games" onBack={() => navigate("/")} contentClassName="games-page__content">
                <TipBox className="games-page__tip-box" />
                <GamesCollectionSelector className="games-page__collection-selector" />
                <Bento className="games-page__bento">
                    {visibleGames.map((game: GameDef) => {
                        // Bubble Match is the shared level card (GameCard) spanning the
                        // full row — each level tile keeps the game's single route and
                        // passes its level via nav state. Word Search is the same shared
                        // card, owned by WordSearchHubItem (it holds the saved board). Both special-cased here rather than as
                        // generic `GameDef` fields.
                        if (game.gameId === "bubble-match") {
                            return (
                                <GameCard
                                    key={game.gameId}
                                    classPrefix="games-page"
                                    card={buildBubbleMatchCard(game, bubbleMatchTotalWins, clearedLevels, (level) =>
                                        // Pinned to Recognition — see the header note.
                                        navigate(launchPath(game.route), { state: { level, showPinyin: true } })
                                    )}
                                    sx={{ gridColumn: "1 / -1" }}
                                />
                            );
                        }
                        if (game.gameId === "word-search") {
                            return (
                                <WordSearchHubItem key={game.gameId} game={game} />
                            );
                        }
                        // Match Speed is the only tile with a stat today: its lifetime
                        // win count. Other tiles pass no `wins`, so they wear no pill.
                        return (
                            <GameCard
                                key={game.gameId}
                                variant="tile"
                                classPrefix="games-page"
                                card={buildTileCard(
                                    game,
                                    launchPath(game.route),
                                    game.gameId === "match-speed" ? matchSpeedTotalWins : undefined,
                                )}
                            />
                        );
                    })}
                </Bento>

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

                {/* Bottom spacing goes LAST so it sits below the empty state too — an
                    empty hub must clear the footer exactly as a full one does. */}
                <FooterSpacer />
                <ScrollPastSpacer />
        </NodePage>
    );
};

export default GamesPage;
