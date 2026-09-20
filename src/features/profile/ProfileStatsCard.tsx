import { Box, Typography } from "@mui/material";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import DrawIcon from "@mui/icons-material/Draw";
import DeckBuckets from "../../components/DeckBuckets";
import VelocityStatCard from "../../components/VelocityStatCard";
import FireCount from "../../minutePoints/FireCount";
import { formatMinutesAsDuration } from "../../utils/formatDuration";
import type { ProfileIdentity, ProfileLanguageStats, ProfileStats } from "../../api/userProfile";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { LEADING, SIZE, WEIGHT } from "../../theme/scale";
import { profileCardSx, profileSectionTitleSx } from "./profileStyles";

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
 * viewer's. The flag heading the panel and the caption under each figure exist for
 * exactly that reason; without them a viewer would reasonably read these as numbers in
 * their own language, and with several panels stacked the ambiguity compounds.
 *
 * ── THE FLAG IS THE PANEL'S TITLE ─────────────────────────────────────────────
 * It is a centred 40px emoji with the language NAME under it, not the inline
 * "🇨🇳 CN" badge used elsewhere, because this is the one place a language labels a
 * whole BLOCK rather than annotating a line of text. At that size it is legible as
 * the panel's identity from across the card, which is what makes two stacked panels
 * tell themselves apart at a glance.
 *
 * The name under it is **not decoration**: `LANGUAGE_FLAGS` warns that Windows does
 * not render regional-indicator pairs as flags (it shows "CN"), so a flag must never
 * be the only carrier of meaning. Here the name below is that guarantee — which is
 * also why it is the full "Mandarin" rather than the compact region code the inline
 * badge uses.
 *
 * The band counts reuse `DeckBuckets`, the same display-only row the Account page draws
 * for the signed-in user, so a profile and your own account present progress
 * identically.
 */
function LanguagePanel({
    stats,
    velocityWindowDays,
    flag,
    languageName,
}: {
    stats: ProfileLanguageStats;
    velocityWindowDays: number;
    /** The language's flag emoji — the panel's title. */
    flag: string;
    /** The language's display name, e.g. "Mandarin". */
    languageName: string;
}) {
    return (
        <Box
            className={`profile-stats__panel profile-stats__panel--${stats.language}${
                stats.isSelected ? " is-selected" : ""
            }`}
            // `position: relative` is load-bearing — the minutes flame is pinned to
            // this box's top-right corner. See its comment below.
            sx={{ ...profileCardSx, position: "relative", display: "flex", flexDirection: "column", gap: 1.25 }}
        >
            {/* The banked wallet balance, as the app's flame readout, pinned to the
                panel's top-right corner.

                ABSOLUTE, not a flex sibling of the title: the title block is CENTRED on
                the panel, and a figure sharing its row would push the flag off-centre by
                half the figure's width — by a DIFFERENT amount per panel, since
                "2w 3d" and "41m" are not the same length. Taking it out of flow keeps
                every panel's flag on the same axis whatever the balance reads.

                It is a flat flame with no fill level: `FireCount` draws a gauge only
                when given one, and a part-full gauge here would invite the reader to
                watch a number that is somebody else's and cannot move on this screen. */}
            <FireCount
                className="profile-stats__panel-minutes"
                value={formatMinutesAsDuration(stats.netMinutes, { weeks: true })}
                countFontSize={SIZE.caption}
                title={`${stats.netMinutes} minute points banked in ${languageName}`}
                sx={{ position: "absolute", top: 10, right: 12 }}
            />

            {/* The panel's title block: flag over name, centred. There is no
                "Currently studying" chip — the selected language is identified on the
                identity card at the top of the page instead, and leads this list. */}
            <Box
                className="profile-stats__panel-language"
                sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.25 }}
            >
                <Typography
                    className="profile-stats__panel-flag"
                    // Decorative here: the name below carries the same fact to a
                    // screen reader, and an emoji read aloud as "flag of China" beside
                    // "Mandarin" is a duplicate, not a clarification.
                    aria-hidden
                    sx={{ fontSize: SIZE.display, lineHeight: LEADING.none }}
                >
                    {flag}
                </Typography>
                <Typography className="profile-stats__panel-language-name" sx={profileSectionTitleSx}>
                    {languageName}
                </Typography>
            </Box>

            {/* `gutter={false}`: the panel already pads itself, so the shelf's own
                22px page gutter would be a second indent and would push the spines out
                of line with the panel heading above them. The spines also narrow to fit
                this container — see `useFittedSpineWidth` in components/DeckBuckets. */}
            <Box className="profile-stats__buckets" sx={{ minHeight: 150 }}>
                <DeckBuckets counts={stats.bandCounts} gutter={false} />
            </Box>

            {/* Velocity sits BELOW the shelf, in the Account page's order: the library
                is the state and velocity is the rate of change, so the reader meets the
                thing before the thing's derivative. `mx: 0` because `SectionCard`
                carries an 18px page gutter for a card sitting directly in a scroll
                column, and this one is already inset by the panel. */}
            <VelocityStatCard
                className="profile-stats__velocity"
                velocity={stats.velocity}
                windowDays={velocityWindowDays}
                boundaryCounts={stats.velocityBoundaryCounts}
                sx={{ mx: 0, mt: 0, textAlign: "center" }}
            />
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
    /**
     * How a language is presented — its flag emoji, its compact region code and its
     * display name. Injected rather than looked up here so the page owns the one
     * mapping and its identity line and its panels cannot drift apart.
     */
    languageDisplay: (language: string) => { flag: string; code: string; name: string };
}> = ({ identity, stats, languageDisplay }) => (
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
                flag={languageDisplay(languageStats.language).flag}
                languageName={languageDisplay(languageStats.language).name}
            />
        ))}
    </Box>
);

export default ProfileStatsCard;
