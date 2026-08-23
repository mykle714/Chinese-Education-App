import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Avatar, Box, Button, IconButton, Typography } from "@mui/material";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import PersonRemoveIcon from "@mui/icons-material/PersonRemove";
import CheckIcon from "@mui/icons-material/Check";
import UndoIcon from "@mui/icons-material/Undo";
import StorefrontIcon from "@mui/icons-material/Storefront";
import BlockIcon from "@mui/icons-material/Block";
import DoNotDisturbOnIcon from "@mui/icons-material/DoNotDisturbOn";
import NodePage from "../../components/NodePage";
import { FooterSpacer } from "../../components/MobileFooter";
import ProfileStatsCard from "./ProfileStatsCard";
import ProfileDesignGrid from "./ProfileDesignGrid";
import { fetchUserProfile } from "../../api/userProfile";
import type { UserProfile } from "../../api/userProfile";
import {
    acceptFriendRequest,
    deleteFriendRequest,
    removeFriend,
    sendFriendRequest,
} from "../../api/friends";
import { setChallengeBlock } from "../../api/studyChallenges";
import { friendErrorMessage } from "../friends/friendLabels";
import { LANGUAGE_FLAGS, languageRegionCode } from "../../types";
import type { Language } from "../../types";
import { useAuth } from "../../AuthContext";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { API_BASE_URL } from "../../constants";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { profileCardSx, profileErrorSx, profileHeaderIconSx, profileMutedSx } from "./profileStyles";

/** "🇨🇳 CN" — the same flag + region-code badge the friends leaderboard uses. */
function languageBadge(language: string): string {
    const flag = LANGUAGE_FLAGS[language as Language] ?? "";
    const code = languageRegionCode(language as Language) || language.toUpperCase();
    return `${flag}${flag ? " " : ""}${code}`;
}

/** "Learning since 3 Aug 2026", or null when the timestamp is missing/unparseable. */
function sinceLabel(iso: string | null | undefined, prefix: string): string | null {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return `${prefix} ${date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`;
}

/**
 * One user's profile (docs/USER_PROFILE_PAGE.md) — the app's only screen for looking
 * at somebody who is not you. Reachable for ANY account, friend or stranger, which is
 * what makes the Add-friend button meaningful.
 *
 * Layout, top to bottom: the page's grey top bar carrying EVERY relationship control
 * (add / accept / revoke / remove, plus the challenge block), an identity card, a Visit
 * night market button, the progress card, and their card designs as a paginated grid.
 *
 * ── THE CONTROLS LIVE IN THE TOP BAR ──────────────────────────────────────────
 * They go in `headerExtraActions` — the same slot the card detail and collection pages
 * put their per-subject actions in — rather than in the page body. Two reasons: they
 * are all answers to one question ("what is this person to me"), so splitting them
 * between a card and a toggle further down reads as a page SETTING rather than as part
 * of the relationship; and the bar is pinned, so the controls stay reachable however
 * far the designs grid has been scrolled.
 *
 * ── THE ONE INVARIANT ─────────────────────────────────────────────────────────
 * EVERY NUMBER ON THIS PAGE IS IN THE PROFILED PERSON'S OWN LANGUAGE, never the
 * viewer's — the server scopes them that way and the language badge in the stats card
 * says which. See the service for why.
 *
 * ── RELATIONSHIP IS A SERVER-OWNED ENUM ───────────────────────────────────────
 * The bar shows exactly one FRIEND action, chosen by `profile.relationship`, and after
 * any of them (the block toggle included) the page RE-FETCHES rather than patching its
 * own state. That costs one round
 * trip and buys correctness: a friend request can cross with one already in flight from
 * the other side (the server auto-accepts crossing requests), so a client that
 * optimistically drew "Request sent" would be wrong in exactly the case that matters.
 */
function UserProfilePage() {
    const { userId } = useParams<{ userId: string }>();
    usePageTitle("Profile");

    const slideNavigate = useSlideNavigate();
    // Plain navigate for the back arrow only: a profile is reached from several places
    // (friends list, leaderboard, challenges), so "back" means the actual history entry
    // rather than a fixed parent route. `useSlideNavigate` only takes paths.
    const navigate = useNavigate();
    const { isAuthenticated } = useAuth();

    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!userId) return;
        const result = await fetchUserProfile(userId);
        setProfile(result);
    }, [userId]);

    // Keyed on isAuthenticated + the id, never on `token` (CLAUDE.md).
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        load()
            .then(() => { if (!cancelled) setError(null); })
            .catch((err: unknown) => {
                if (!cancelled) setError(friendErrorMessage(err, "Could not load that profile"));
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [isAuthenticated, load]);

    /** Run one relationship mutation, then re-read the profile (see the header note). */
    const runAction = async (action: () => Promise<unknown>, failure: string) => {
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
            await action();
            await load();
        } catch (err: unknown) {
            setError(friendErrorMessage(err, failure));
        } finally {
            setBusy(false);
        }
    };

    const toggleBlock = async (blocked: boolean) => {
        if (!profile) return;
        await runAction(
            () => setChallengeBlock(profile.identity.userId, blocked),
            "Could not update that setting",
        );
    };

    const displayName = profile ? profile.identity.name || profile.identity.email : "";

    /**
     * The single friend action for the viewer's relationship, as a top-bar icon.
     * Returns null for `self` — there is no action a person takes on their own profile
     * from here — and the caller relies on that null to decide whether the bar has any
     * actions at all.
     */
    const renderFriendAction = () => {
        if (!profile) return null;
        switch (profile.relationship) {
            case "none":
                return (
                    <IconButton
                        className="user-profile-page__add-friend"
                        aria-label="Add friend"
                        title="Add friend"
                        disabled={busy}
                        onClick={() => runAction(
                            () => sendFriendRequest(profile.identity.userId),
                            "Could not send that request",
                        )}
                        sx={profileHeaderIconSx(COLORS.successInk)}
                    >
                        <PersonAddIcon />
                    </IconButton>
                );
            case "request_sent":
                return (
                    <IconButton
                        className="user-profile-page__revoke-request"
                        aria-label="Revoke friend request"
                        title="Friend request sent — tap to revoke"
                        disabled={busy || !profile.requestId}
                        onClick={() => runAction(
                            () => deleteFriendRequest(profile.requestId!),
                            "Could not revoke that request",
                        )}
                        sx={profileHeaderIconSx(COLORS.infoInk)}
                    >
                        <UndoIcon />
                    </IconButton>
                );
            case "request_received":
                return (
                    <IconButton
                        className="user-profile-page__accept-request"
                        aria-label="Accept friend request"
                        title="Accept friend request"
                        disabled={busy || !profile.requestId}
                        onClick={() => runAction(
                            () => acceptFriendRequest(profile.requestId!),
                            "Could not accept that request",
                        )}
                        sx={profileHeaderIconSx(COLORS.successInk)}
                    >
                        <CheckIcon />
                    </IconButton>
                );
            case "friends":
                return (
                    <IconButton
                        className="user-profile-page__remove-friend"
                        aria-label="Remove friend"
                        title="Remove friend"
                        disabled={busy}
                        onClick={() => runAction(
                            () => removeFriend(profile.identity.userId),
                            "Could not remove that friend",
                        )}
                        sx={profileHeaderIconSx(COLORS.dangerInk)}
                    >
                        <PersonRemoveIcon />
                    </IconButton>
                );
            case "self":
            default:
                return null;
        }
    };

    /**
     * The per-pair challenge opt-out, as a top-bar toggle.
     *
     * Friends only, because the flags live ON the friendship row; the server sends
     * `challengeBlock: null` for everyone else and there is simply nothing to draw.
     *
     * It is a TOGGLE, not a command, so it renders its own STATE the way a favourite
     * star does — filled and red when blocked, outline and muted when not. Colour alone
     * would not survive a colourblind viewer, hence the fill change; `aria-pressed`
     * carries the same fact to assistive tech, which no icon can.
     *
     * The tooltip states the SYMMETRY plainly. Setting this stops the viewer's own
     * outgoing challenges too, and a control that silently did that would be a trap. The
     * other half — that the block is never disclosed to the other person — is
     * deliberately NOT said: it is a promise made to them, not to the viewer.
     */
    const renderBlockToggle = () => {
        if (!profile?.challengeBlock) return null;
        const blocked = profile.challengeBlock.viewerBlocked;
        return (
            <IconButton
                className="user-profile-page__challenge-block-button"
                aria-label={blocked ? "Unblock study challenges" : "Block study challenges"}
                aria-pressed={blocked}
                title={
                    blocked
                        ? `Study challenges with ${displayName} are blocked, in both directions — tap to allow them`
                        : `Block study challenges with ${displayName}, in both directions`
                }
                disabled={busy}
                onClick={() => toggleBlock(!blocked)}
                sx={profileHeaderIconSx(blocked ? COLORS.dangerInk : COLORS.textSecondary)}
            >
                {blocked ? <DoNotDisturbOnIcon /> : <BlockIcon />}
            </IconButton>
        );
    };

    return (
        <NodePage
            title="Profile"
            onBack={() => navigate(-1)}
            contentClassName="user-profile-page__content"
            headerExtraActions={
                <Box className="user-profile-page__header-actions" sx={{ display: "flex", alignItems: "center" }}>
                    {renderFriendAction()}
                    {renderBlockToggle()}
                </Box>
            }
        >
            <Box className="user-profile-page" sx={{ display: "flex", flexDirection: "column", gap: 1.5, px: 2, py: 1 }}>
                {loading && <Typography sx={{ ...profileMutedSx, textAlign: "center", py: 3 }}>Loading…</Typography>}

                {error && <Typography className="user-profile-page__error" sx={profileErrorSx}>{error}</Typography>}

                {profile && (
                    <>
                        {/* ── Identity ──
                            Identity only: every relationship control lives in the page's
                            top bar instead (see the component header). */}
                        <Box
                            className="user-profile-page__header"
                            sx={{ ...profileCardSx, display: "flex", alignItems: "center", gap: 1.5 }}
                        >
                            <Avatar
                                className="user-profile-page__avatar"
                                src={
                                    profile.identity.avatarIconId
                                        ? `${API_BASE_URL}/api/icons8/${encodeURIComponent(profile.identity.avatarIconId)}/image`
                                        : undefined
                                }
                                imgProps={{ sx: { objectFit: "contain", p: 0.5 } }}
                                sx={{ width: 56, height: 56, bgcolor: COLORS.iconBg, color: COLORS.onSurface }}
                            >
                                {displayName.charAt(0).toUpperCase()}
                            </Avatar>

                            <Box className="user-profile-page__identity" sx={{ flex: 1, minWidth: 0 }}>
                                <Typography
                                    className="user-profile-page__name"
                                    title={profile.identity.email}
                                    noWrap
                                    sx={{ fontFamily: FONTS.sans, fontSize: SIZE.subtitle, fontWeight: WEIGHT.bold, color: COLORS.onSurface }}
                                >
                                    {displayName}
                                </Typography>
                                <Typography className="user-profile-page__email" noWrap sx={{ ...profileMutedSx, fontSize: SIZE.micro }}>
                                    {profile.identity.email}
                                </Typography>
                                <Typography className="user-profile-page__since" sx={{ ...profileMutedSx, fontSize: SIZE.micro }}>
                                    {[
                                        `Studying ${languageBadge(profile.identity.language)}`,
                                        profile.relationship === "friends"
                                            ? sinceLabel(profile.friendsSince, "· friends since")
                                            : sinceLabel(profile.identity.createdAt, "· joined"),
                                    ]
                                        .filter(Boolean)
                                        .join(" ")}
                                </Typography>
                            </Box>
                        </Box>

                        {/* ── Visit their night market ──
                            Read-only: the visit endpoint suppresses the hub seeding a first
                            load would otherwise perform, so opening someone's market never
                            writes to their account. */}
                        <Button
                            className="user-profile-page__night-market-button"
                            onClick={() => slideNavigate(`/night-market/user/${profile.identity.userId}`)}
                            startIcon={<StorefrontIcon />}
                            sx={{
                                alignSelf: "flex-start",
                                textTransform: "none",
                                fontFamily: FONTS.sans,
                                fontSize: SIZE.body,
                                fontWeight: WEIGHT.semibold,
                                color: COLORS.onSurface,
                                backgroundColor: COLORS.purpleAccent,
                                borderRadius: 3,
                                px: 2,
                                py: 0.75,
                            }}
                        >
                            {profile.relationship === "self" ? "Visit your night market" : "Visit their night market"}
                        </Button>

                        <ProfileStatsCard
                            identity={profile.identity}
                            stats={profile.stats}
                            languageBadge={languageBadge}
                        />

                        <ProfileDesignGrid
                            userId={profile.identity.userId}
                            language={profile.identity.language as Language}
                            displayName={displayName}
                            isSelf={profile.relationship === "self"}
                        />
                    </>
                )}

                <FooterSpacer />
            </Box>
        </NodePage>
    );
}

export default UserProfilePage;
