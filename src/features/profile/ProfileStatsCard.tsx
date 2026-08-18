import { Box, Typography } from "@mui/material";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import DrawIcon from "@mui/icons-material/Draw";
import BoltIcon from "@mui/icons-material/Bolt";
import ScheduleIcon from "@mui/icons-material/Schedule";
import DeckBuckets from "../../components/DeckBuckets";
import { formatMinutesAsDuration } from "../../utils/formatDuration";
import type { ProfileIdentity, ProfileLanguageStats, ProfileStats } from "../../api/userProfile";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, TRACKING, WEIGHT } from "../../theme/scale";
import { profileCardSx, profileMutedSx, profileSectionTitleSx } from "./profileStyles";

/**
 * One headline figure — velocity or net minutes. Two of these sit side by side above
 * the band counts, so they share a component rather than being written twice with
 * their paddings drifting apart.
 */
function StatFigure({
    className,
    icon,
    label,
    value,
    caption,
}: {
    className: string;
    icon: React.ReactNode;
    label: string;
    value: string;
    caption: string;
}) {
    return (
        <Box
            className={className}
            sx={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 0.25,
                p: 1,
                borderRadius: 2,
                backgroundColor: COLORS.infoCard,
            }}
        >
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, color: COLORS.textSecondary }}>
                {icon}
                <Typography
                    sx={{
                        fontFamily: FONTS.sans,
                        fontSize: SIZE.micro,
                        fontWeight: WEIGHT.semibold,
                        letterSpacing: TRACKING.caps,
                        textTransform: "uppercase",
                    }}
                >
                    {label}
                </Typography>
            </Box>
            <Typography
                sx={{
                    fontFamily: FONTS.sans,
                    fontSize: SIZE.subtitle,
                    fontWeight: WEIGHT.bold,
                    color: COLORS.onSurface,
                    textAlign: "center",
                }}
            >
                {value}
            </Typography>
            <Typography sx={{ ...profileMutedSx, fontSize: SIZE.micro, textAlign: "center" }}>
                {caption}
            </Typography>
        </Box>
    );
}

/**
 * One goal badge. Rendered for BOTH states rather than only when the goal is on: a
 * missing badge and an off badge look identical to a reader who does not know the
 * feature exists, so an explicitly greyed "Reading" says something a blank space
 * cannot. See docs/MASTERY_REWORK.md for what the goals do.
 */
function GoalBadge({ label, icon, on }: { label: string; icon: React.ReactNode; on: boolean }) {
    return (
        <Box
            className={`profile-stats__goal-badge profile-stats__goal-badge--${label.toLowerCase()} ${
                on ? "is-on" : "is-off"
            }`}
            sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                px: 1,
                py: 0.4,
                borderRadius: 999,
                backgroundColor: on ? COLORS.greenAccent : COLORS.iconBg,
                color: on ? COLORS.onSurface : COLORS.textSecondary,
                border: `1px solid ${on ? "transparent" : COLORS.rowBorder}`,
                opacity: on ? 1 : 0.75,
            }}
        >
            {icon}
            <Typography
                sx={{
                    fontFamily: FONTS.sans,
                    fontSize: SIZE.micro,
                    fontWeight: WEIGHT.semibold,
                }}
            >
                {label}
            </Typography>
        </Box>
    );
}

/**
 * One language's panel: which language, the two headline figures, and the four utcm
 * band counts (docs/USER_PROFILE_PAGE.md § Stats).
 *
 * ⚠️ EVERY FIGURE HERE IS IN `stats.language` — the PROFILED person's language, not the
 * viewer's. The flag in the panel header and the caption under each figure exist for
 * exactly that reason; without them a viewer would reasonably read these as numbers in
 * their own language, and with several panels stacked the ambiguity compounds.
 *
 * The band counts reuse `DeckBuckets`, the same display-only row the Account page draws
 * for the signed-in user, so a profile and your own account present progress
 * identically.
 */
function LanguagePanel({
    stats,
    velocityWindowDays,
    languageBadge,
}: {
    stats: ProfileLanguageStats;
    velocityWindowDays: number;
    languageBadge: string;
}) {
    return (
        <Box
            className={`profile-stats__panel profile-stats__panel--${stats.language}${
                stats.isSelected ? " is-selected" : ""
            }`}
            sx={{ ...profileCardSx, display: "flex", flexDirection: "column", gap: 1.25 }}
        >
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                <Typography className="profile-stats__panel-language" sx={profileSectionTitleSx}>
                    {languageBadge}
                </Typography>
                {/* The selected language leads the list, but ORDER alone does not say why
                    it leads — a reader seeing two panels cannot tell "first" from
                    "current". The chip says it outright. */}
                {stats.isSelected && (
                    <Typography
                        className="profile-stats__panel-active-chip"
                        sx={{
                            fontFamily: FONTS.sans,
                            fontSize: SIZE.micro,
                            fontWeight: WEIGHT.semibold,
                            color: COLORS.textSecondary,
                            backgroundColor: COLORS.iconBg,
                            border: `1px solid ${COLORS.rowBorder}`,
                            borderRadius: 999,
                            px: 0.75,
                            py: 0.15,
                        }}
                    >
                        Currently studying
                    </Typography>
                )}
            </Box>

            <Box className="profile-stats__figures" sx={{ display: "flex", gap: 1 }}>
                <StatFigure
                    className="profile-stats__velocity"
                    icon={<BoltIcon sx={{ fontSize: 14 }} />}
                    label="Velocity"
                    value={String(stats.velocity)}
                    caption={`bands in ${velocityWindowDays}d`}
                />
                <StatFigure
                    className="profile-stats__minutes"
                    icon={<ScheduleIcon sx={{ fontSize: 14 }} />}
                    label="Studied"
                    value={formatMinutesAsDuration(stats.netMinutes, { weeks: true })}
                    caption="current balance"
                />
            </Box>

            <Box className="profile-stats__buckets" sx={{ minHeight: 150 }}>
                <DeckBuckets counts={stats.bandCounts} />
            </Box>
        </Box>
    );
}

/**
 * The profile's progress block: the two account-wide goal badges, then ONE PANEL PER
 * LANGUAGE the account is learning.
 *
 * ── THE ORDER IS THE SERVER'S ─────────────────────────────────────────────────
 * `stats.languages` is rendered as received and deliberately NOT re-sorted here: the
 * selected language leads, the rest follow by wallet descending, and languages with a
 * zero balance are already gone. Sorting it again on the client would put the rule in
 * two places, and the client cannot see the tie-breaks the server used.
 *
 * The goal badges sit ABOVE the panels rather than inside each one because
 * reading/writing goals are ACCOUNT-wide opt-ins (`users.readingGoal` / `writingGoal`),
 * not per-language — repeating them in every panel would imply the learner could pursue
 * writing in one language and not another.
 */
const ProfileStatsCard: React.FC<{
    identity: ProfileIdentity;
    stats: ProfileStats;
    /** Flag + region code for a language, e.g. "🇨🇳 CN". */
    languageBadge: (language: string) => string;
}> = ({ identity, stats, languageBadge }) => (
    <Box className="profile-stats" sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <Box
            className="profile-stats__heading"
            sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, flexWrap: "wrap" }}
        >
            <Typography className="profile-stats__title" sx={profileSectionTitleSx}>
                Progress
            </Typography>
            <Box className="profile-stats__goals" sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
                <GoalBadge label="Reading" icon={<MenuBookIcon sx={{ fontSize: 13 }} />} on={identity.readingGoal} />
                <GoalBadge label="Writing" icon={<DrawIcon sx={{ fontSize: 13 }} />} on={identity.writingGoal} />
            </Box>
        </Box>

        {stats.languages.map((languageStats) => (
            <LanguagePanel
                key={languageStats.language}
                stats={languageStats}
                velocityWindowDays={stats.velocityWindowDays}
                languageBadge={languageBadge(languageStats.language)}
            />
        ))}
    </Box>
);

export default ProfileStatsCard;
