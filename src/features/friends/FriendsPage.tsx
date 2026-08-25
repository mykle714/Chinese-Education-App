import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Chip, Typography } from "@mui/material";
import NodePage from "../../components/NodePage";
import { FooterSpacer } from "../../components/MobileFooter";
import { Bento, BentoTile } from "../../components/bento";
import { Label, SectionCard, SectionHeader } from "../../components/primitives";
import Icon from "../../components/Icon";
import FriendPersonRow from "./FriendPersonRow";
import { fetchFriendsLeaderboard, fetchIncomingRequests } from "../../api/friends";
import { fetchChallengeBadge } from "../../api/studyChallenges";
import type { FriendLeaderboardEntry } from "../../api/friends";
import { useAuth } from "../../AuthContext";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { COLORS, RAMP, type RampHue } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { WEIGHT } from "../../theme/scale";
import { friendErrorMessage, netMinutesLabel } from "./friendLabels";
import { messageSx, mutedTextSx } from "./friendStyles";

/**
 * The rank chip left of the avatar (`.rw .av` at 28px, artboard 8).
 *
 * The top three get the podium accents so the head of the board is readable at a glance;
 * everyone else gets the neutral grey, because tinting all rows would make the tint
 * meaningless. The hues are the ramp's — gold-ish org, silver-ish blue, bronze-ish red —
 * which is what the artboard draws and also what this component already chose before the
 * redesign, so the podium did not have to move.
 *
 * ⚠️ THE INSET RING IS NOT OPTIONAL. A 28px pastel chip is small and unoccupied — the
 * fill-vs-ink rule's exception (large AND occupied) does not apply — so without the ring
 * it sits at ~1.15:1 on white and simply is not a shape (docs/SHELF_REDESIGN.md § D2).
 * It also does the work in the one collision the podium creates: the viewer's own row is
 * filled with the SAME org pastel that rank 1's chip wears, so a rank-1 viewer would
 * otherwise see their chip dissolve into their row.
 */
const PODIUM_HUES: Record<number, RampHue> = { 1: "org", 2: "blu", 3: "red" };

function RankBadge({ rank }: { rank: number }) {
    const { fill, ink } = RAMP[PODIUM_HUES[rank] ?? "grey"];
    return (
        <Box
            className={`friends-page__rank friends-page__rank--${rank}`}
            sx={{
                flexShrink: 0,
                minWidth: 28,
                height: 28,
                px: 0.5,
                borderRadius: "14px",
                backgroundColor: fill,
                boxShadow: `inset 0 0 0 1px ${COLORS.markOutline}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: FONTS.mono,
                fontSize: 12,
                fontWeight: WEIGHT.bold,
                color: ink,
            }}
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
                    fontSize: 17,
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
 * Friends page (docs/FRIENDS_FEATURE.md) — a Home-hub drill-in (NodePage) showing
 * the viewer and their accepted friends as a LEADERBOARD ranked by velocity
 * (utcm band-steps climbed in the last 7 days; see docs/VELOCITY.md).
 *
 * Every row is scored in THAT person's own selected language, so each carries its
 * language's flag + name; the subtitle is that same language's net minute-point
 * wallet. The server owns the ranking — this page never re-sorts, so what it draws
 * is always the ranks the server assigned.
 *
 * The board itself is READ-ONLY. Three tiles across the top lead to the three
 * action screens — "Send" (compose + outgoing pending, revocable), "Accept"
 * (incoming, with a count badge so the user knows to look) and "Remove" (unfriend)
 * — so no mutation sits on a ranking row.
 *
 * The viewer's own user ID is shown here with a copy button because the ID *is*
 * the friend handle — there is no username column, so the only way for someone to
 * friend you is for you to hand them this string.
 *
 * ── THE ACTIONS ARE A BENTO NOW, NOT A ROW OF BUTTONS (SHELF_REDESIGN entry 8) ───────
 * They were three MUI `Button`s with the count badge overhanging the corner. The
 * artboard makes them a 3-up bento of `compact` tiles, and the change is more than a
 * skin: a tile has a ghost glyph and room for a real label, so the icon can carry the
 * meaning the one-word name compresses INSIDE the target rather than crammed into a
 * `startIcon`. It also puts the count where every other count in the app lives (the
 * tile `pin`) instead of on a bespoke `cornerBadgeSx` that only this page had — that
 * fragment and `navButtonSx` are both deleted with this conversion.
 *
 * Colour still carries the ACTION's valence, as it did before and as the request rows
 * already do (Accept green / Decline red on IncomingRequestsPage): green for the
 * affirmative one, red for the destructive one, neutral blue for the rest.
 */
function FriendsPage() {
    usePageTitle("Friends");
    const navigate = useNavigate();
    const slideNavigate = useSlideNavigate();
    const { user, isAuthenticated } = useAuth();

    const [entries, setEntries] = useState<FriendLeaderboardEntry[]>([]);
    const [incomingCount, setIncomingCount] = useState(0);
    const [challengeCount, setChallengeCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    // Keyed on isAuthenticated, never on `token`: a silent 15-minute refresh must
    // not re-fetch and flash the list (CLAUDE.md "Never reload on token refresh").
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        Promise.all([
            fetchFriendsLeaderboard(),
            fetchIncomingRequests(),
            // The challenge badge must not be able to fail the whole page: it is the
            // newest of the three reads and the least important to the screen's purpose,
            // so it degrades to 0 rather than replacing the leaderboard with an error.
            fetchChallengeBadge().catch(() => ({ count: 0 })),
        ])
            .then(([board, incoming, badge]) => {
                if (cancelled) return;
                setEntries(board.entries);
                setIncomingCount(incoming.length);
                setChallengeCount(badge.count);
                setError(null);
            })
            .catch((err: unknown) => {
                if (!cancelled) setError(friendErrorMessage(err, "Could not load your friends"));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [isAuthenticated]);

    const handleCopyId = useCallback(async () => {
        if (!user?.id) return;
        try {
            await navigator.clipboard.writeText(user.id);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch {
            // Clipboard access can be denied (insecure origin / permission). The ID
            // is rendered in full above, so the user can still select it manually.
            setCopied(false);
        }
    }, [user?.id]);

    /**
     * A tile that is a real anchor AND slides.
     *
     * `to` gives it the link affordances every Bento tile in the app has — middle-click,
     * open-in-new-tab, a status-bar URL, keyboard focus — while the intercepted click
     * runs the drill-in slide transition these four destinations have always used. A
     * modified click (⌘/ctrl/middle) never reaches `preventDefault`, so it still opens a
     * tab the way a link should.
     */
    const slideTo = (path: string) => (e: React.MouseEvent) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        slideNavigate(path);
    };

    return (
        <NodePage title="Friends" onBack={() => navigate("/")} contentClassName="friends-page__content">
            <Box className="friends-page">

                {/* The three action screens. This board is READ-ONLY — every mutation
                    (send a request, answer one, unfriend) lives behind one of these
                    tiles, so no destructive control sits on a ranking row where it can
                    be mis-tapped while reading scores. Equal thirds, all thumb-reachable. */}
                <Bento className="friends-page__actions" columns={3}>
                    <BentoTile
                        className="friends-page__send-tile"
                        title="Send"
                        hue="blu"
                        icon="send"
                        variant="compact"
                        to="/friends/sent"
                        onClick={slideTo("/friends/sent")}
                    />
                    <BentoTile
                        className="friends-page__accept-tile"
                        title="Accept"
                        hue="grn"
                        icon="mark_email_unread"
                        variant="compact"
                        pin={incomingCount > 0 ? incomingCount : undefined}
                        pinTone="alert"
                        to="/friends/requests"
                        onClick={slideTo("/friends/requests")}
                    />
                    <BentoTile
                        className="friends-page__remove-tile"
                        title="Remove"
                        hue="red"
                        icon="person_remove"
                        variant="compact"
                        to="/friends/remove"
                        onClick={slideTo("/friends/remove")}
                    />

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
                    <BentoTile
                        className="friends-page__challenges-tile"
                        title="Challenges"
                        subtitle="The only place a challenge is announced"
                        hue="org"
                        icon="emoji_events"
                        variant="low"
                        fullWidth
                        pin={challengeCount > 0 ? challengeCount : undefined}
                        pinTone="alert"
                        to="/friends/challenges"
                        onClick={slideTo("/friends/challenges")}
                    />
                </Bento>

                {/* Your own ID — the shareable friend handle. */}
                <SectionCard className="friends-page__my-id">
                    <Label sx={{ letterSpacing: "0.04em", textTransform: "none", fontSize: 11.5 }}>
                        Your friend ID — share this so others can add you
                    </Label>
                    <Box sx={{ display: "flex", alignItems: "center", gap: "10px", mt: "6px" }}>
                        <Typography
                            className="friends-page__my-id-value"
                            sx={{
                                flex: 1,
                                minWidth: 0,
                                fontFamily: FONTS.mono,
                                fontSize: 12,
                                color: COLORS.onSurface,
                                wordBreak: "break-all",
                                // The ID is meant to be copied by hand when the clipboard
                                // API is unavailable, so this one string opts out of the
                                // app-wide user-select:none (CLAUDE.md § Touch & Scroll).
                                userSelect: "text",
                            }}
                        >
                            {user?.id ?? "—"}
                        </Typography>
                        {/* The artboard's control here is a `.chip`, and in this codebase
                            that is MUI's `Chip` — the theme skins outlined chips as the
                            design's resting pill (see ThemeContext, MuiChip). Deliberately
                            NOT an outlined `Button`: the theme maps that to `.btn3`, a
                            13px-padded radius-14 BLOCK action, which beside a one-line ID
                            would be three times the height of the text it acts on. */}
                        <Chip
                            className="friends-page__copy-id-chip"
                            variant="outlined"
                            clickable
                            onClick={handleCopyId}
                            icon={<Icon name={copied ? "check" : "content_copy"} size={14} />}
                            label={copied ? "Copied" : "Copy"}
                            sx={{ flexShrink: 0 }}
                        />
                    </Box>
                </SectionCard>

                {error && (
                    <Typography className="friends-page__error" sx={{ ...messageSx, px: "22px", pt: 1.5 }}>
                        {error}
                    </Typography>
                )}

                <SectionHeader
                    className="friends-page__leaderboard-header"
                    label="Leaderboard · velocity"
                    meta="last 7 days"
                />

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
                        sx={{ display: "flex", flexDirection: "column", gap: "6px", padding: "9px 16px 0" }}
                    >
                        {entries.map((entry) => (
                            <FriendPersonRow
                                key={entry.userId}
                                className={`friends-page__friend${entry.isCurrentUser ? " friends-page__friend--self" : ""}`}
                                name={entry.isCurrentUser ? `${entry.name || entry.email} (you)` : entry.name}
                                email={entry.email}
                                avatarIconId={entry.avatarIconId}
                                highlighted={entry.isCurrentUser}
                                secondary={netMinutesLabel(entry.netMinutes, entry.language)}
                                leading={<RankBadge rank={entry.rank} />}
                                onPersonPress={() => slideNavigate(`/users/${entry.userId}`)}
                                // The board is read-only: the row's only right-hand
                                // element is the score it is ranked on. Unfriending
                                // moved to /friends/remove.
                                actions={<VelocityStat velocity={entry.velocity} />}
                            />
                        ))}
                        {/* A friendless board still draws — the viewer's own row is always
                            present, so the board is never blank; it just has one row, which
                            is also what it looks like the moment a first friend is added.
                            The hint sits UNDER that row rather than replacing it, so the
                            empty state teaches the next step without hiding the ranking. */}
                        {entries.length <= 1 && (
                            <Typography className="friends-page__empty" sx={mutedTextSx}>
                                No friends yet. Tap <strong>Send</strong> to add someone by their friend ID.
                            </Typography>
                        )}
                    </Box>
                )}

                <FooterSpacer />
            </Box>
        </NodePage>
    );
}

export default FriendsPage;
