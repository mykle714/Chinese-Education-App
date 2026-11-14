import { useState } from "react";
import { Box, Typography, Button, Switch } from "@mui/material";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import LibraryShelfPanel from "../../components/velocity/LibraryShelfPanel";
import IconPickerDialog from "../../components/IconPickerDialog";
import BankBanner from "../../minutePoints/BankBanner";
import Icon from "../../components/Icon";
import { Row, RowList, SectionRule } from "../../components/primitives";
import { API_BASE_URL } from "../../constants";
import { useAuth } from "../../AuthContext";
import { useConfirmation } from "../../contexts/ConfirmationContext";
import { useCategoryCounts } from "../../hooks/useCategoryCounts";
import { useVelocity } from "../../hooks/useVelocity";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { forgiveAutoFocusNotice, oweAutoFocusNotice } from "../../features/focusMode/autoFocusNotice";

/**
 * AccountPane — the AccountSheet's Account tab: artboard 5 of the shelf redesign
 * (docs/SHELF_REDESIGN.md entry 5).
 *
 * Assembled ENTIRELY from shelf-system primitives, in the artboard's order: the profile as
 * a `Row`, the minute bank as a two-column `SectionCard` (`BankBanner`, docs/DAILY_MINUTE_BANKING.md § 6 —
 * not on the artboard, added 2026-10-10), the four utcm bands and Velocity together in an
 * unboxed `LibraryShelfPanel` (the same panel a friend's row uses, without its header), the two mastery goals as `Row`s with switches,
 * and Log Out as the `.btn3` outlined block.
 *
 * ⚠️ THE PANE ITSELF HAS NO SIDE PADDING. Every primitive here carries its own page gutter
 * (`RowList` 16px, `SectionRule` 22px, `SectionCard` 18px) plus its own top margin,
 * because in the design those gutters differ per shape.
 *
 * LAYER: app-level page surface (src/pages). Data comes from AuthContext +
 * useCategoryCounts/useVelocity; no direct server calls.
 *
 * Depended on by: AccountSheet, docs/SHELF_REDESIGN.md entry 5, docs/VELOCITY.md,
 * docs/MASTERY_REWORK.md.
 */

interface AccountPaneProps {
    // Called immediately on logout, tearing the whole sheet down.
    onClose: () => void;
}

function AccountPane({ onClose }: AccountPaneProps) {
    const { confirm } = useConfirmation();
    const { user, isLoading, logout, updateAvatar, updateGoals } = useAuth();

    // Goal toggles (docs/MASTERY_REWORK.md). Optimistic local state; a failed PUT
    // reverts. Reading/Writing are only meaningful where those marks can be earned
    // (zh games), so the section is hidden for Spanish accounts.
    const [goalSaving, setGoalSaving] = useState<null | "reading" | "writing">(null);
    const showGoals = user?.selectedLanguage !== "es";
    const handleToggleGoal = async (which: "reading" | "writing", next: boolean) => {
        setGoalSaving(which);
        try {
            const focusAutoEnabled = await updateGoals(which === "reading" ? { readingGoal: next } : { writingGoal: next });
            // A goal turned on may have opened a crowded world with focus mode switched on
            // for the learner; its explaining popup is owed until their first visit there.
            // Turning the goal back off forgives an unshown one (docs/FOCUS_MODE.md § 1a).
            if (user?.selectedLanguage) {
                if (next) oweAutoFocusNotice(user.id, user.selectedLanguage, focusAutoEnabled);
                else forgiveAutoFocusNotice(user.id, user.selectedLanguage, which);
            }
        } catch {
            /* AuthContext surfaces the error; local switch reverts via user state */
        } finally {
            setGoalSaving(null);
        }
    };

    // Avatar picker (modal) open state.
    const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);

    // Logging out tears the sheet down at once (no dismiss animation) — the host page
    // is about to lose its signed-in state, so there is nothing to slide back to.
    const handleLogout = async () => {
        const confirmed = await confirm("Are you sure you want to log out?");
        if (confirmed) {
            onClose();
            logout();
        }
    };

    // Per-category library card counts, shown as the shelf's spine heights.
    const { counts: categoryCounts, loaded: countsLoaded } = useCategoryCounts();

    // Velocity — mastery band-steps climbed in the sliding 7-day window for the
    // account's selected language (docs/VELOCITY.md). Display-only.
    const { velocity, windowDays, boundaryCounts, loaded: velocityLoaded } = useVelocity();

    // Loading / signed-out are edge states: the host only offers the avatar button while
    // a user is loaded. They still render so the pane never opens blank.
    if (isLoading || !user) {
        return isLoading ? (
            <DelayedCircularProgress className="account-sheet__spinner" />
        ) : (
            <Typography
                className="account-sheet__no-user-text"
                sx={{ textAlign: "center", padding: "20px", color: COLORS.onSurface, fontFamily: FONTS.sans }}
            >
                Please log in to view your account
            </Typography>
        );
    }

    // Header identity: the username is the title (`@`-prefixed, like FriendPersonRow's
    // title) and the optional display name (migration 188, docs/LOGIN_REWORK.md Q19) is
    // the subtitle, omitted when unset. Email/phone are deliberately NOT shown here
    // (user, 2026-11-14) — contact details stay off the account header.
    const profileTitle = `@${user.username}`;
    const profileSubtitle = user.name || undefined;

    // The avatar OWNS the whole 48px slot (Row's `avatar` escape hatch) because it is
    // tappable and the styled 36px box the primitive draws for `icon`/`initials` is
    // neither the right size nor focusable. It is a real <button>, so the picker is
    // reachable by keyboard — the old MUI Avatar carried role="button" on a div.
    const avatarButton = (
        <Box
            className="account-sheet__avatar"
            component="button"
            type="button"
            aria-label="Change avatar"
            onClick={() => setAvatarPickerOpen(true)}
            sx={{
                width: 48,
                height: 48,
                borderRadius: "15px",
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                border: "none",
                padding: 0,
                cursor: "pointer",
                // Artboard 5's avatar: `--bluK` (= the blue MID tier) with an ink initial.
                backgroundColor: COLORS.bluM,
                color: COLORS.onSurface,
                boxShadow: `inset 0 0 0 1px ${COLORS.markOutline}`,
                fontFamily: FONTS.sans,
                fontSize: 17,
                fontWeight: 600,
            }}
        >
            {user.avatarIconId ? (
                <Box
                    component="img"
                    className="account-sheet__avatar-image"
                    src={`${API_BASE_URL}/api/icons8/${encodeURIComponent(user.avatarIconId)}/image`}
                    alt=""
                    sx={{ width: "100%", height: "100%", objectFit: "contain", padding: "6px" }}
                />
            ) : (
                (user.name || user.username).charAt(0).toUpperCase()
            )}
        </Box>
    );

    return (
        <>
                    {/* Profile — one Row: avatar, @username, name. No email/phone. No user ID: the copyable ID
                        lives on the Friends tab, the one place a learner hands it out
                        (user, 2026-11-13). */}
                    <RowList className="account-sheet__profile">
                        <Row
                            className="account-sheet__profile-row"
                            avatar={avatarButton}
                            title={profileTitle}
                            subtitle={profileSubtitle}
                        />
                    </RowList>

                    {/* The minute bank — NET through yesterday, with today's minutes in
                        a right-hand column. Directly under the profile row, tying it to the
                        avatar the td banking embers fly into (Q4). */}
                    <BankBanner className="account-sheet__bank-banner" />

                    {/* The library, unboxed on the page (user, 2026-11-14): one spine per
                        utcm band (height encodes its count), then the Velocity card
                        whose U-arrows join neighbouring spines with the cards that climbed
                        between them in the last 7 days (docs/VELOCITY.md). The same `LibraryShelfPanel` a friend's profile
                        draws per language, minus its flag/name header and minutes flame —
                        this sheet is already one language, and BankBanner above already
                        shows the minutes. No "Your library" header either (user,
                        2026-11-13). The panel holds each half
                        back until it loads and reserves its height, so nothing below
                        shifts. The panel's default `14px 18px 0` margin lines it up
                        with BankBanner's card directly above. */}
                    <LibraryShelfPanel
                        className="account-sheet__library"
                        counts={countsLoaded ? categoryCounts : null}
                        velocity={velocityLoaded ? { velocity, windowDays, boundaryCounts } : null}
                    />

                {/* Goals — opt into the Reading / Writing mastery goals
                    (docs/MASTERY_REWORK.md). Recognition + Production are always pursued
                    and aren't shown. Hidden for Spanish accounts. Title-only rows: the
                    per-row "Adds a reading/writing bar to every card" subtitles were
                    dropped (user, 2026-11-14). */}
                {showGoals && (
                    <>
                        {/* A SectionRule (overline + hairline), not a SectionHeader: the
                            header shape is only for an overline with a tappable action,
                            and Goals has none (src/components/primitives/Label.tsx). */}
                        <SectionRule className="account-sheet__goals-header" label="Goals" />
                        <RowList className="account-sheet__goals">
                            <Row
                                className="account-sheet__goal-reading"
                                icon="menu_book"
                                hue="red"
                                title="Learn reading"
                                trailing={
                                    <Switch
                                        className="account-sheet__goal-reading-switch"
                                        sx={goalSwitchOnSx(COLORS.redMk)}
                                        inputProps={{ "aria-label": "Learn reading" }}
                                        checked={user.readingGoal === true}
                                        disabled={goalSaving !== null}
                                        onChange={(e) => handleToggleGoal("reading", e.target.checked)}
                                    />
                                }
                            />
                            <Row
                                className="account-sheet__goal-writing"
                                icon="edit"
                                hue="org"
                                title="Learn writing"
                                trailing={
                                    <Switch
                                        className="account-sheet__goal-writing-switch"
                                        sx={goalSwitchOnSx(COLORS.orgMk)}
                                        inputProps={{ "aria-label": "Learn writing" }}
                                        checked={user.writingGoal === true}
                                        disabled={goalSaving !== null}
                                        onChange={(e) => handleToggleGoal("writing", e.target.checked)}
                                    />
                                }
                            />
                        </RowList>
                    </>
                )}

                {/* Log Out — the `.btn3` outlined block. Its own RowList rather than the
                    goals' one (where the artboard draws it) so it survives the Spanish
                    case, which hides the goals section entirely. */}
                <RowList className="account-sheet__logout">
                    <Button
                        className="account-sheet__logout-button"
                        fullWidth
                        variant="outlined"
                        color="primary"
                        startIcon={<Icon name="logout" size={17} color="inherit" />}
                        onClick={handleLogout}
                    >
                        Log Out
                    </Button>
                </RowList>

            {/* Avatar icon picker — shared icon search/browser. Empty query browses all
                downloaded icons; typing searches icons8 (download-on-select). */}
            <IconPickerDialog
                open={avatarPickerOpen}
                onClose={() => setAvatarPickerOpen(false)}
                title="Choose your avatar"
                currentIconId={user.avatarIconId ?? null}
                onPick={(id) => updateAvatar(id)}
                onRemove={() => updateAvatar(null)}
                removeLabel="Remove avatar"
            />
        </>
    );
}

/**
 * "On" track colour for a goal switch: each one takes its row's ramp Mark tier
 * (Reading → `redMk`, Writing → `orgMk`, matching the row icon's hue). Only the TRACK
 * is recoloured — the knob keeps the theme's app-wide ink from the `MuiSwitch`
 * override (ThemeContext), per the user (2026-11-14).
 */
const goalSwitchOnSx = (onColor: string) => ({
    "& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track": { backgroundColor: onColor },
});

export default AccountPane;
