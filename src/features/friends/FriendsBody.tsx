import { displayName } from "../../utils/displayName";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, IconButton, Typography, useMediaQuery } from "@mui/material";
import { keyframes } from "@mui/material/styles";
import { Bento, BentoTile } from "../../components/bento";
import { SectionCard } from "../../components/primitives";
import { formatFriendCode } from "../../../server/contracts/wire";
import Icon from "../../components/Icon";
import FriendPersonRow from "./FriendPersonRow";
import FriendActionTiles from "./FriendActionTiles";
import FriendExpandedDetail from "./FriendExpandedDetail";
import SentRequestsBody from "./SentRequestsBody";
import IncomingRequestsBody from "./IncomingRequestsBody";
import RemoveFriendsBody from "./RemoveFriendsBody";
import { FRIENDS_VIEW_ORDER, type FriendsView } from "./friendsView";
import { useFriendProfiles } from "./useFriendProfiles";
import { fetchFriendsLeaderboard, fetchIncomingRequests } from "../../api/friends";
import { fetchChallengeBadge } from "../../api/studyChallenges";
import { isFeatureEnabled } from "../../../server/contracts/featureFlags";
import type { FriendLeaderboardEntry } from "../../api/friends";
import { useAuth } from "../../AuthContext";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { COLORS, RAMP, type RampHue } from "../../theme/colors";
import { FONTS, DATA_TYPE } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { friendErrorMessage, netMinutesLabel } from "./friendLabels";
import { BAND_HUES } from "../../utils/categoryColors";
import { messageSx, mutedTextSx, sectionHeadingSx } from "./friendStyles";

/**
 * The rank is the row's whole LEFT SECTION (FriendPersonRow's `leading` + `leadingFill`):
 * a full-height column divided from the person by one hairline (user, 2026-11-13; it was
 * a 28px chip left of the avatar, `.rw .av` on artboard 8).
 *
 * The top FOUR sections are tinted in the utcm band colours at the MID tier, best band
 * for the best rank — 1 Mastered (blue), 2 Comfortable (green), 3 Target (yellow),
 * 4 Unfamiliar (red) — read from `BAND_HUES` (src/utils/categoryColors.ts) so a ramp
 * repaint carries the podium with the bands. Four because there are four bands (owner,
 * 2026-11-13). Everyone below 4th gets the ramp's achromatic `grey` at the same MID
 * tier (`NON_PODIUM_HUE`; user, 2026-11-14 — it was white): every row now has a visible
 * rank tab, and the inert grey keeps the four band hues meaning "podium".
 *
 * No `markOutline` ring any more: that was mandatory for a small, unoccupied 28px chip
 * (docs/SHELF_REDESIGN.md § D2). The section is bounded by the row's outline and the
 * divider, so its edge is already drawn.
 */
const PODIUM_HUES: Record<number, RampHue> = {
    1: BAND_HUES.Mastered,
    2: BAND_HUES.Comfortable,
    3: BAND_HUES.Target,
    4: BAND_HUES.Unfamiliar,
};

/** The rank tab's hue below the podium (5th and lower): the ramp's inert grey rung. */
const NON_PODIUM_HUE: RampHue = "grey";

/** The view swap's slide (docs/FRIENDS_FEATURE.md § "The action tiles"). */
const VIEW_SLIDE_MS = 280;
const VIEW_SLIDE_EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";
/** The incoming view enters from the RIGHT (moving forward in tile order)… */
const slideInFromRight = keyframes`from { transform: translateX(100%); } to { transform: translateX(0); }`;
/** …or from the LEFT (moving back toward the leaderboard, position 0). */
const slideInFromLeft = keyframes`from { transform: translateX(-100%); } to { transform: translateX(0); }`;

/** The section's ground: the podium band's MID tier, or the grey MID tier below 4th. */
function rankFill(rank: number): string {
    return RAMP[PODIUM_HUES[rank] ?? NON_PODIUM_HUE].mid;
}

/** The rank numeral inside the section. Ink on every fill, the mid tier's text pairing. */
function RankNumeral({ rank }: { rank: number }) {
    return (
        <Box
            component="span"
            className={`friends-page__rank friends-page__rank--${rank}`}
            sx={{ ...DATA_TYPE, fontSize: 17, fontWeight: WEIGHT.bold, color: COLORS.onSurface }}
        >
            {rank}
        </Box>
    );
}

/**
 * The ranked metric as one unit: the number large, the word "velocity" small beneath,
 * the two CENTRED ON EACH OTHER so the pair reads as a single stacked stat rather than
 * as two independently aligned lines (the number's width swings from 1 to 3 digits,
 * which a shared edge alignment makes look ragged).
 *
 * A zero is drawn muted rather than hidden — "0 this week" is information, and a
 * blank space would read as a rendering bug.
 */
function VelocityStat({ velocity }: { velocity: number }) {
    return (
        <Box
            className="friends-page__velocity"
            sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                textAlign: "center",
                lineHeight: 1.1,
            }}
        >
            <Typography
                className="friends-page__velocity-value"
                sx={{
                    fontFamily: FONTS.sans,
                    // 20px (17 until 2026-11-14, user): the ranked score is the row's
                    // loudest figure, a step above the 17px rank numeral on the left.
                    fontSize: 20,
                    fontWeight: WEIGHT.bold,
                    color: velocity > 0 ? COLORS.onSurface : COLORS.textSecondary,
                    lineHeight: 1.1,
                }}
            >
                {velocity.toLocaleString()}
            </Typography>
            <Typography
                className="friends-page__velocity-unit"
                sx={{ fontFamily: FONTS.sans, fontSize: 10, color: COLORS.textSecondary }}
            >
                velocity
            </Typography>
        </Box>
    );
}

/**
 * FriendsBody (docs/FRIENDS_FEATURE.md) — the Friends surface with no page shell, shown by
 * the `/friends` NodePage (FriendsPage) and the AccountSheet's Friends tab. It shows
 * the viewer and their accepted friends as a LEADERBOARD ranked by velocity
 * (utcm band-steps climbed in the last 7 days; see docs/VELOCITY.md).
 *
 * Every row is scored in THAT person's own selected language, so each carries its
 * language's flag + name; the subtitle is that same language's net minute-point
 * wallet. The server owns the ranking — this page never re-sorts, so what it draws
 * is always the ranks the server assigned.
 *
 * The board itself is READ-ONLY. Three tiles across the top (FriendActionTiles — a toggle
 * group; the selected tile wears an ink ring) swap the area below them for one of the
 * three action bodies — "Send" (compose + outgoing pending, revocable),
 * "Accept" (incoming, with a count pin so the user knows to look) and "Remove"
 * (unfriend) — so no mutation sits on a ranking row. No tile selected = the leaderboard.
 *
 * ── THE SWAP SLIDES BY TILE ORDER ─────────────────────────────────────────────
 * The four views sit on a carousel: leaderboard 0, Send 1, Accept 2, Remove 3
 * (`FRIENDS_VIEW_ORDER`). The incoming view slides in from the right when it is further
 * along than the outgoing one, from the left when it is nearer the start — so deselecting
 * a tile always brings the leaderboard back from the left. Only the incoming view animates
 * (the outgoing one is simply replaced), and reduced-motion skips the slide.
 *
 * ── A ROW EXPANDS IN PLACE ────────────────────────────────────────────────────
 * Tapping a friend's row opens FriendExpandedDetail inside it (one row at a time; your own
 * row stays inert), animating open and closed. This replaced the `/users/:userId` profile
 * page, deleted 2026-11-13. Every friend's profile is PREFETCHED the moment the board
 * loads (`useFriendProfiles`), so a row opens with its panel already filled.
 *
 * The viewer's own friend code (migration 187) is shown here with a copy icon: it is one of
 * the two handles someone can friend you by — the other is your username (migration 188,
 * docs/LOGIN_REWORK.md Q20).
 *
 * ── THE ACTIONS ARE A BENTO (SHELF_REDESIGN entry 8) ─────────────────────────────────
 * They were three MUI `Button`s, then a 3-up bento of `compact` tiles that navigated to
 * three NodePages; since 2026-11-13 the same tiles select an in-place body instead. The
 * face is unchanged: ghost glyph, one-word label, and the count in the tile `pin`.
 *
 * Colour still carries the ACTION's valence, as it did before and as the request rows
 * already do (Accept green / Decline red on IncomingRequestsBody): green for the
 * affirmative one, red for the destructive one, neutral blue for the rest.
 */
function FriendsBody() {
    const slideNavigate = useSlideNavigate();
    const { user, isAuthenticated } = useAuth();

    const [entries, setEntries] = useState<FriendLeaderboardEntry[]>([]);
    const [incomingCount, setIncomingCount] = useState(0);
    const [challengeCount, setChallengeCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    // Which view is below the tiles, and where the previous one sat on the carousel — the
    // slide direction is the sign of the move (see the header).
    const [view, setView] = useState<FriendsView>("board");
    const [slideFrom, setSlideFrom] = useState<"left" | "right" | null>(null);
    const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

    // The one expanded leaderboard row (accordion).
    const [expandedId, setExpandedId] = useState<string | null>(null);

    // Bumped by an action body after a mutation, to re-read the board and the Accept pin.
    const [reloadTick, setReloadTick] = useState(0);
    const handleFriendsChanged = useCallback(() => setReloadTick((t) => t + 1), []);
    // Skips the "Loading…" swap on a reload: the board is hidden while a body is up, and
    // when it comes back it should show the fresh rows, not flash a placeholder.
    const hasLoadedRef = useRef(false);

    // Keyed on isAuthenticated, never on `token`: a silent 15-minute refresh must
    // not re-fetch and flash the list (CLAUDE.md "Never reload on token refresh").
    useEffect(() => {
        let cancelled = false;
        if (!hasLoadedRef.current) setLoading(true);
        Promise.all([
            fetchFriendsLeaderboard(),
            fetchIncomingRequests(),
            // The challenge badge must not be able to fail the whole page: it is the
            // newest of the three reads and the least important to the screen's purpose,
            // so it degrades to 0 rather than replacing the leaderboard with an error.
            // Skipped entirely when the Study Challenge flag is off
            // (server/contracts/featureFlags.ts): the endpoint is not mounted, so the
            // request would 404 into the .catch above and cost a round trip to learn 0.
            isFeatureEnabled("studyChallenge")
                ? fetchChallengeBadge().catch(() => ({ count: 0 }))
                : Promise.resolve({ count: 0 }),
        ])
            .then(([board, incoming, badge]) => {
                if (cancelled) return;
                setEntries(board.entries);
                setIncomingCount(incoming.length);
                setChallengeCount(badge.count);
                setError(null);
                hasLoadedRef.current = true;
            })
            .catch((err: unknown) => {
                if (!cancelled) setError(friendErrorMessage(err, "Could not load your friends"));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [isAuthenticated, reloadTick]);

    // Every friend's profile, read as soon as the board lands (not on first expand), so
    // opening a row never waits on the network. Your own row never expands, so it is
    // never read.
    const friendIds = useMemo(
        () => entries.filter((entry) => !entry.isCurrentUser).map((entry) => entry.userId),
        [entries],
    );
    const { profiles: friendProfiles, retry: retryFriendProfile } = useFriendProfiles(friendIds);

    /** Open a friend's row (closing any other), or close it if it is the open one. A row
     *  whose prefetch failed re-reads on open, so the error is not permanent. */
    const toggleFriendRow = useCallback((userId: string) => {
        setExpandedId((open) => (open === userId ? null : userId));
        retryFriendProfile(userId);
    }, [retryFriendProfile]);

    /** Select a tile (or deselect the selected one), choosing the slide direction from the move. */
    const toggleView = useCallback((next: Exclude<FriendsView, "board">) => {
        setView((current) => {
            const target: FriendsView = current === next ? "board" : next;
            setSlideFrom(FRIENDS_VIEW_ORDER[target] > FRIENDS_VIEW_ORDER[current] ? "right" : "left");
            return target;
        });
    }, []);

    // The viewer's friend code (migration 187), hyphenated for display AND for the clipboard
    // — the pasted form is the one people see, and the server ignores the hyphen anyway.
    const myFriendCode = user?.friendCode ? formatFriendCode(user.friendCode) : null;

    const handleCopyId = useCallback(async () => {
        if (!myFriendCode) return;
        try {
            await navigator.clipboard.writeText(myFriendCode);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch {
            // Clipboard access can be denied (insecure origin / permission). The code
            // is rendered in full above, so the user can still read it out or select it.
            setCopied(false);
        }
    }, [myFriendCode]);

    /**
     * A tile that is a real anchor AND slides — the Challenges tile, the one remaining
     * drill-in here (the other three select in-place bodies now).
     *
     * `to` gives it the link affordances every Bento tile in the app has — middle-click,
     * open-in-new-tab, a status-bar URL, keyboard focus — while the intercepted click
     * runs the drill-in slide transition. A
     * modified click (⌘/ctrl/middle) never reaches `preventDefault`, so it still opens a
     * tab the way a link should.
     */
    const slideTo = (path: string) => (e: React.MouseEvent) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        slideNavigate(path);
    };

    return (
            <Box className="friends-page">

                {/* The three action tiles. This board is READ-ONLY — every mutation (send a
                    request, answer one, unfriend) lives in the body a tile slides in, so no
                    destructive control sits on a ranking row where it can be mis-tapped
                    while reading scores. Equal thirds, all thumb-reachable. */}
                <Bento className="friends-page__actions" columns={3}>
                    <FriendActionTiles view={view} onToggle={toggleView} incomingCount={incomingCount} />

                    {/* Study Challenges (docs/STUDY_CHALLENGE.md § 1) — a fourth drill-in,
                        on its own full-width row rather than as a fourth equal quarter,
                        because it is a FEATURE rather than one of the three friend-list
                        actions, and squeezing it into that row would make all four labels
                        unreadable. Its own row is also what buys it a subtitle.

                        ⚠️ THE BADGE IS THE ONLY WAY A CHALLENGE IS EVER ANNOUNCED. There
                        are no notifications of any kind — no push, no email, no native
                        badge — so this pin, and the row's own dot inside it, are the
                        entire discovery mechanism (Q48). Hence `pinTone="alert"`: a count
                        that blends into its tile is a notification nobody sees. The count
                        is deliberately LANGUAGE-BLIND — a challenge in a language the
                        viewer is not currently studying is invisible on the challenges
                        page itself, and this pin is the one thread back to it. */}
                    {isFeatureEnabled("studyChallenge") && <BentoTile
                        className="friends-page__challenges-tile"
                        title="Challenges"
                        // The subtitle says what the feature IS, not what this tile is for.
                        // A learner who has never tapped it cannot act on "the only place a
                        // challenge is announced" — that is a fact about the badge, and the
                        // badge is already doing the announcing.
                        subtitle="A nine-word head-to-head, issued Monday, played Friday"
                        hue="org"
                        icon="swords"
                        variant="low"
                        fullWidth
                        pin={challengeCount > 0 ? challengeCount : undefined}
                        pinTone="alert"
                        to="/friends/challenges"
                        onClick={slideTo("/friends/challenges")}
                    />}
                </Bento>

                {/* The swapped area. `key={view}` remounts the incoming view so its slide
                    plays; `overflow: hidden` keeps it from painting over the tiles while it
                    is still off to one side. */}
                <Box className="friends-page__view-viewport" sx={{ overflow: "hidden" }}>
                    <Box
                        key={view}
                        className={`friends-page__view friends-page__view--${view}`}
                        sx={slideFrom && !reduceMotion
                            ? {
                                animation: `${slideFrom === "right" ? slideInFromRight : slideInFromLeft} ${VIEW_SLIDE_MS}ms ${VIEW_SLIDE_EASING}`,
                            }
                            : undefined}
                    >
                        {view === "send" && <SentRequestsBody onChanged={handleFriendsChanged} />}
                        {view === "accept" && <IncomingRequestsBody onChanged={handleFriendsChanged} />}
                        {view === "remove" && <RemoveFriendsBody onChanged={handleFriendsChanged} />}
                        {view === "board" && <>
                            {/* Your own ID — the shareable friend handle. */}
                            <SectionCard className="friends-page__my-id">
                                {/* Same header as SentRequestsBody's "Add a friend", centred. */}
                                <Typography component="h2" className="friends-page__my-id-heading" sx={{ ...sectionHeadingSx, textAlign: "center" }}>
                                    Your friend code
                                </Typography>
                                {/* The CODE ALONE is centred under the centred header; its copy icon
                                    hangs off the code's right edge out of flow (user, 2026-11-13), so
                                    the icon never pulls the code left of the heading's axis — the
                                    Velocity label's ⓘ does the same (VelocityStatCard). Body size,
                                    lightly tracked so the 9 characters separate when read aloud. */}
                                <Box className="friends-page__my-id-row" sx={{ display: "flex", justifyContent: "center", mt: 1 }}>
                                    <Box className="friends-page__my-id-anchor" sx={{ position: "relative" }}>
                                    <Typography
                                        className="friends-page__my-id-value"
                                        sx={{
                                            ...DATA_TYPE,
                                            fontSize: SIZE.body,
                                            fontWeight: WEIGHT.semibold,
                                            letterSpacing: "0.06em",
                                            color: COLORS.onSurface,
                                            // Copyable by hand when the clipboard API is unavailable,
                                            // so this one string opts out of the app-wide
                                            // user-select:none (CLAUDE.md § Touch & Scroll).
                                            userSelect: "text",
                                        }}
                                    >
                                        {myFriendCode ?? "—"}
                                    </Typography>
                                    {/* Just the glyph, no pill (user, 2026-11-13): sitting right beside
                                        the code, the icon alone says what it copies. It swaps to a
                                        check for 1.5s as the only confirmation, so the label carries
                                        the state for screen readers. Muted ink at rest, matching the
                                        app's other bare icon buttons. */}
                                    <IconButton
                                        className="friends-page__copy-id-button"
                                        size="small"
                                        onClick={handleCopyId}
                                        aria-label={copied ? "Friend code copied" : "Copy friend code"}
                                        sx={{
                                            position: "absolute",
                                            left: "100%",
                                            top: "50%",
                                            transform: "translateY(-50%)",
                                            ml: 0.5,
                                            color: copied ? COLORS.onSurface : COLORS.textSecondary,
                                        }}
                                    >
                                        <Icon name={copied ? "check" : "content_copy"} size={18} />
                                    </IconButton>
                                    </Box>
                                </Box>
                            </SectionCard>

                            {error && (
                                <Typography className="friends-page__error" sx={{ ...messageSx, px: "22px", pt: 1.5 }}>
                                    {error}
                                </Typography>
                            )}

                            {/* List / empty / loading. Loading text rather than a spinner: the list is
                                one small query and a spinner flashes more than it informs. */}
                            {loading ? (
                                <Typography className="friends-page__loading" sx={mutedTextSx}>Loading…</Typography>
                            ) : (
                                <Box
                                    className="friends-page__leaderboard"
                                    // 6px, not the `RowList` 8px: the artboard tightens the gap on this
                                    // one list because a RANKING is a sequence — rows spaced like
                                    // independent cards stop reading as positions against each other.
                                    sx={{ display: "flex", flexDirection: "column", gap: "6px", padding: "19px 16px 0" }}
                                >
                                    {entries.map((entry) => (
                                        <FriendPersonRow
                                            key={entry.userId}
                                            className={`friends-page__friend${entry.isCurrentUser ? " friends-page__friend--self" : ""}`}
                                            name={entry.isCurrentUser ? `${displayName(entry)} (you)` : entry.name}
                                            username={entry.username}
                                            avatarIconId={entry.avatarIconId}
                                            secondary={netMinutesLabel(entry.netMinutes, entry.language)}
                                            leading={<RankNumeral rank={entry.rank} />}
                                            leadingFill={rankFill(entry.rank)}
                                            // A friend's row expands in place (one at a time); tapping the
                                            // open row closes it. The viewer's own row is inert — FriendPersonRow
                                            // drops the cursor/press affordance when `onPersonPress` is
                                            // omitted (docs/FRIENDS_FEATURE.md § "Expand in place").
                                            onPersonPress={entry.isCurrentUser
                                                ? undefined
                                                : () => toggleFriendRow(entry.userId)}
                                            expanded={entry.isCurrentUser ? undefined : expandedId === entry.userId}
                                            // Passed open or closed: the row animates it in and
                                            // out, and mounts it only while open or animating.
                                            detail={entry.isCurrentUser
                                                ? undefined
                                                : <FriendExpandedDetail language={entry.language} profileState={friendProfiles[entry.userId]} />}
                                            // The board is read-only: the row's only right-hand
                                            // element is the score it is ranked on. Unfriending
                                            // lives behind the Remove tile.
                                            actions={<VelocityStat velocity={entry.velocity} />}
                                        />
                                    ))}
                                    {/* A friendless board still draws — the viewer's own row is always
                                        present, so the board is never blank; it just has one row, which
                                        is also what it looks like the moment a first friend is added.
                                        The line sits UNDER that row rather than replacing it, so the
                                        empty state never hides the ranking. A friendly aside rather
                                        than an instruction (user, 2026-11-13): the Send tile directly
                                        above already says how to add someone. */}
                                    {entries.length <= 1 && (
                                        <Typography className="friends-page__empty" sx={mutedTextSx}>
                                            No friends yet. It's okay, I'll be your friend :)
                                        </Typography>
                                    )}
                                </Box>
                            )}
                        </>}
                    </Box>
                </Box>
            </Box>
    );
}

export default FriendsBody;
