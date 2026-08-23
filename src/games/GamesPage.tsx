import { Box, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import { useNavigate } from "react-router-dom";
import NodePage from "../components/NodePage";
import { FooterSpacer, ScrollPastSpacer } from "../components/MobileFooter";
import { Bento, BentoTile, BentoStrip, BentoSubTile } from "../components/bento";
import TipBox from "../components/TipBox";
import { usePageTitle } from "../hooks/usePageTitle";
import { useGameWins } from "../hooks/useGameWins";
import { GAME_REGISTRY } from "../games/registry";
import { GAME_KEY as BUBBLE_MATCH_GAME_KEY, LEVEL_CONFIGS as BUBBLE_MATCH_LEVELS } from "../games/bubble-match/constants";
import BubbleMatchTrackToggle from "../games/bubble-match/BubbleMatchTrackToggle";
import { GAME_KEY as MATCH_SPEED_GAME_KEY } from "../games/match-speed/constants";
import WordSearchHubItem from "../games/word-search/WordSearchHubItem";
import GamesCollectionSelector from "./GamesCollectionSelector";
import { withCollectionParams } from "../features/flashcards/collectionRef";
import { useSelectedCollection } from "../features/flashcards/selectedCollection";
import { useAuth } from "../AuthContext";
import type { GameDef } from "../games/types";
import type { Language } from "../types";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { SIZE, WEIGHT } from "../theme/scale";
// The user-facing name of each mastery track ("Recognition"), shared with the flp and
// Word Search's hub strip so every surface names a track the same way.
import { MARK_TYPE_LABELS } from "../utils/masteryCompute";

// Games is a NODE PAGE (see docs/LEAF_NODE_PAGES.md): it keeps the footer and
// uses the LEFT back arrow + horizontal slide. Phone-frame sizing comes from
// MobileDemoFrame via Layout.tsx; the scroll-away header + floating footer +
// scroll behavior come from MobileTabScreen (wrapped by NodePage, which adds the
// slide-in-from-right / slide-out-to-right-on-arrow transition); the row list
// grid comes from the shared BENTO primitive (docs/SHELF_REDESIGN.md § A4, entry
// 4) — this page owns game gating, the empty state, and the tip-box / spacer.
//
// Bubble Match renders as a BentoStrip (one sub-tile per difficulty level) instead
// of a single tile — it has no in-game picker, so the hub is the only place to pick
// a level. This is special-cased here (not a generic `GameDef.levels` field) since
// it and Word Search are the only games that fan out this way today.
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
// THE MASTERY TRACK RIDES THE SUBTITLE (it used to be a `MarkTypeChip`, a component
// that has since been deleted for want of a caller).
// Every hub card once carried that chip naming the mastery track the game feeds
// (docs/MASTERY_REWORK.md), read from `GameDef.markType`. The artboard draws no chip,
// and a bento tile has no edge slot to hang one in: its two text slots are the title
// and a short subtitle. So the track moved INTO the subtitle rather than being lost —
// `tileSubtitle()` below composes "Recognition · 30-second clock" from the game's own
// `markType` plus its blurb. Word Search already worked this way (its two modes feed
// DIFFERENT tracks, so each sub-tile's subtitle is its track name); this makes the
// plain tiles agree with it.
//
// DERIVED, NOT RESTATED: the label is read from the same `GameDef.markType` the game's
// page marks with, so a tile cannot claim a track the game does not emit. Never
// hand-write a track name into `GameDef.subtitle`.
//
// Bubble Match took the strip header instead. It fans out into per-LEVEL sub-tiles
// whose subtitles are already the level labels ("6 pairs"), so there was nowhere for a
// track name to go without displacing them — and its track is not fixed anyway: it is
// Recognition or Reading depending on the pinyin setting (docs/MASTERY_REWORK.md § 1a).
// So its strip header carries `BubbleMatchTrackToggle`, which both NAMES the two
// tracks and is the control that picks between them. That control has to live here
// rather than in the game because the choice is made before the board is dealt.

/** Per-level ramp hues for the Bubble Match sub-tiles, keyed by LEVEL_CONFIGS' level
    number — a difficulty ramp, calm green through to red. Hardcoded, not randomized.
    This is why Bubble Match's own `GameDef.hue` is only a fallback. */
const BUBBLE_MATCH_LEVEL_HUES: Record<number, "grn" | "org" | "red"> = {
    1: "grn",
    2: "org",
    3: "red",
};

// Word Search also fans out into a strip of sub-tiles (Pinyin / No Pinyin), plus a
// leading resume tile when a saved board exists — but its mode tiles need custom
// click handling (confirm-before-clobber) and its own saved-state read, so the whole
// strip is owned by WordSearchHubItem. See docs/WORD_SEARCH_GAME.md §3.

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

/**
 * A plain tile's subtitle: the mastery track this game feeds, then its own blurb
 * ("Recognition · 30-second clock").
 *
 * The track comes from `GameDef.markType` — the same field the game page passes to
 * /api/flashcards/mark — so the hub can never advertise a track the game does not
 * write. A game with no `markType` (Word Search, whose track is per mode) falls back
 * to the bare blurb; its own strip labels each mode instead.
 */
function tileSubtitle(game: GameDef): string | undefined {
    const track = game.markType ? MARK_TYPE_LABELS[game.markType] : undefined;
    if (!track) return game.subtitle;
    return game.subtitle ? `${track} · ${game.subtitle}` : track;
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
        <NodePage title="Games" onBack={() => navigate("/")} contentClassName="games-page__content">
                <GamesCollectionSelector className="games-page__collection-selector" />
                <TipBox className="games-page__tip-box" />
                <Bento className="games-page__bento">
                    {visibleGames.map((game: GameDef) => {
                        // Bubble Match and Word Search both fan out into a strip of
                        // sub-tiles (one per level / pinyin mode) instead of a single
                        // tile — each sub-tile keeps the game's single route and passes
                        // its choice via nav state. Special-cased here (not a generic
                        // `GameDef.levels` field) since they are the only fan-out games.
                        if (game.gameId === "bubble-match") {
                            return (
                                <BentoStrip
                                    key={game.gameId}
                                    className="games-page__strip games-page__strip--bubble-match"
                                    label={game.title}
                                    // The pinyin switch sits ON THE HUB because it
                                    // picks the run's mastery track (Recognition ⇄
                                    // Reading) and the pool is bucketed on that track
                                    // at deal time — see BubbleMatchTrackToggle.
                                    control={
                                        <BubbleMatchTrackToggle
                                            className="games-page__track-toggle"
                                            language={(user?.selectedLanguage ?? "zh") as Language}
                                        />
                                    }
                                    meta={`×${bubbleMatchTotalWins} wins`}
                                >
                                    {BUBBLE_MATCH_LEVELS.map((cfg) => (
                                        <BentoSubTile
                                            key={`${game.gameId}-${cfg.level}`}
                                            className={`games-page__level games-page__level--${cfg.level}`}
                                            to={launchPath(game.route)}
                                            state={{ level: cfg.level }}
                                            hue={BUBBLE_MATCH_LEVEL_HUES[cfg.level] ?? game.hue}
                                            icon={game.glyph}
                                            title={`Level ${cfg.level}`}
                                            subtitle={cfg.label}
                                            // ⭐ only — the ×N is on the strip header as
                                            // a game-wide aggregate. A star means "you
                                            // cleared THIS level this week".
                                            star={clearedLevels.has(cfg.level) ? "⭐" : undefined}
                                        />
                                    ))}
                                </BentoStrip>
                            );
                        }
                        if (game.gameId === "word-search") {
                            return (
                                <WordSearchHubItem
                                    key={game.gameId}
                                    className="games-page__strip games-page__strip--word-search"
                                    game={game}
                                />
                            );
                        }
                        return (
                            <BentoTile
                                key={game.gameId}
                                to={launchPath(game.route)}
                                className={`games-page__tile games-page__tile--${game.gameId}`}
                                title={game.title}
                                subtitle={tileSubtitle(game)}
                                hue={game.hue}
                                icon={game.glyph}
                                // Match Speed is the only single tile with a stat today:
                                // its lifetime ×N, kept when the mode strip (which
                                // carried it on a group header) was removed.
                                pin={game.gameId === "match-speed" ? `×${matchSpeedTotalWins}` : undefined}
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
