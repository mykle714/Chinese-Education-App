import { Box, Typography } from "@mui/material";
import LibraryShelfPanel from "../../components/velocity/LibraryShelfPanel";
import FireCount from "../../minutePoints/FireCount";
import type { FriendProfileState } from "./useFriendProfiles";
import { formatMinutesAsDuration } from "../../utils/formatDuration";
import { LANGUAGE_FLAGS, LANGUAGE_NAMES, languageRegionCode } from "../../types";
import type { Language } from "../../types";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { LEADING, SIZE, WEIGHT } from "../../theme/scale";

/**
 * FriendExpandedDetail — what a leaderboard row shows when it is expanded in place
 * (docs/FRIENDS_FEATURE.md § "Expand in place"). Replaced the `/users/:userId` profile page,
 * deleted 2026-11-13. It is ONE progress panel (`LibraryShelfPanel`) for the friend's ACTIVE language —
 * the language the row is ranked in, unboxed: its flag-over-name title, the
 * banked-minutes flame in the corner, the spines, and the Velocity card under them.
 *
 * The old page header's lines (@handle, "Studying 🇨🇳 CN · friends since …") were dropped
 * 2026-11-22: the handle moved up into the row's always-visible subtitle, and the
 * studying language already reads off the panel's flag title.
 *
 * NOT shown, by decision (2026-11-13): the "friends since" date (2026-11-22), the Reading / Writing goal badges, every
 * relationship control (unfriending lives behind the Remove tile), the Study Challenge
 * block toggle (dropped — docs/DEFERRED_WORK.md), and the community designs grid.
 *
 * ⚠️ EVERY NUMBER HERE IS IN THE FRIEND'S OWN LANGUAGE, never the viewer's. The flag
 * title is what says so.
 *
 * ── DATA ──
 * Presentational: the host passes the friend's profile read in. FriendsBody PREFETCHES
 * every friend's `GET /api/users/:userId/profile` as soon as the board loads
 * (`useFriendProfiles`), so a row normally opens with its data already here; "Loading…"
 * shows only when a row is opened before its read lands.
 *
 * Layer: feature view (src/features/friends). Rendered by FriendsBody through
 * FriendPersonRow's `detail` slot.
 */

/** Small muted line — the loading / error / no-stats states. */
const metaSx = {
    fontFamily: FONTS.sans,
    fontSize: SIZE.micro,
    color: COLORS.textSecondary,
} as const;

interface FriendExpandedDetailProps {
    /** The language the row is ranked in — the friend's active language. */
    language: string;
    /** This friend's profile read (`useFriendProfiles`); undefined before it has started. */
    profileState: FriendProfileState | undefined;
}

function FriendExpandedDetail({ language, profileState }: FriendExpandedDetailProps) {
    if (profileState?.status === "error") {
        return <Typography className="friend-expanded-detail__error" sx={{ ...metaSx, color: COLORS.dangerInk }}>{profileState.message}</Typography>;
    }
    if (profileState?.status !== "ready") {
        return <Typography className="friend-expanded-detail__loading" sx={metaSx}>Loading…</Typography>;
    }
    const { profile } = profileState;

    // The ranked language's stats. The server sends exactly one entry (the selected
    // language — docs/USER_PROFILE_PAGE.md § Stats); matching on `language` rather than
    // taking [0] keeps the panel honest if the friend switched language between the
    // leaderboard read and this one — then no panel is better than the wrong language's.
    const stats = profile.stats.languages.find((l) => l.language === language) ?? null;
    const flag = LANGUAGE_FLAGS[language as Language] ?? "";
    const code = languageRegionCode(language as Language) || language.toUpperCase();
    const languageName = LANGUAGE_NAMES[language as Language] ?? code;

    return (
        <Box className="friend-expanded-detail" sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {stats ? (
                <LibraryShelfPanel
                    className={`friend-expanded-detail__panel friend-expanded-detail__panel--${stats.language}`}
                    // The row's own padding already insets the panel.
                    sx={{ m: 0 }}
                    counts={stats.bandCounts}
                    velocity={{
                        velocity: stats.velocity,
                        windowDays: profile.stats.velocityWindowDays,
                        boundaryCounts: stats.velocityBoundaryCounts,
                    }}
                    /* The banked wallet as the app's flame readout, pinned top-right out of
                       flow. Flat — no gauge: a part-full gauge would invite watching a
                       number that is somebody else's and cannot move here. */
                    corner={
                        <FireCount
                            className="friend-expanded-detail__minutes"
                            value={formatMinutesAsDuration(stats.netMinutes, { weeks: true })}
                            countFontSize={SIZE.caption}
                            title={`${stats.netMinutes} minute points banked in ${languageName}`}
                        />
                    }
                    /* Flag over language name, centred. The name is not decoration:
                       Windows draws regional-indicator pairs as letters ("CN"), so the
                       flag must never be the only carrier of the language. */
                    header={
                        <>
                            <Typography
                                className="friend-expanded-detail__flag"
                                aria-hidden
                                sx={{ fontSize: SIZE.display, lineHeight: LEADING.none }}
                            >
                                {flag}
                            </Typography>
                            <Typography
                                className="friend-expanded-detail__language-name"
                                sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, fontWeight: WEIGHT.semibold, color: COLORS.onSurface }}
                            >
                                {languageName}
                            </Typography>
                        </>
                    }
                />
            ) : (
                <Typography className="friend-expanded-detail__no-stats" sx={metaSx}>
                    No progress to show in {languageName} yet.
                </Typography>
            )}
        </Box>
    );
}

export default FriendExpandedDetail;
