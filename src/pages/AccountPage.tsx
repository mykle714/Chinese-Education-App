import { useState } from "react";
import {
    Box,
    Typography,
    Avatar,
    Button,
    IconButton,
    Snackbar,
    Checkbox,
    FormControlLabel,
    FormGroup,
} from "@mui/material";
import { ContentCopy } from "@mui/icons-material";
import SettingsIcon from "@mui/icons-material/Settings";
import LogoutIcon from "@mui/icons-material/Logout";
import { useNavigate } from "react-router-dom";
import { useSlideNavigate } from "../hooks/useSlideNavigate";
import DelayedCircularProgress from "../components/DelayedCircularProgress";
import { styled } from "@mui/material/styles";
import MobileTabScreen from "../components/MobileTabScreen";
import DeckBuckets from "../components/DeckBuckets";
import IconPickerDialog from "../components/IconPickerDialog";
import { API_BASE_URL } from "../constants";
import { useAuth } from "../AuthContext";
import { useConfirmation } from "../contexts/ConfirmationContext";
import { usePageTitle } from "../hooks/usePageTitle";
import { useCategoryCounts } from "../hooks/useCategoryCounts";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { SIZE, WEIGHT } from "../theme/scale";

// Styled Components — phone-frame sizing comes from MobileDemoFrame via Layout.tsx;
// the scroll-away header + floating footer + scroll behavior come from
// MobileTabScreen. Content centering/padding is passed to it via `contentSx`.
const CONTENT_SX = {
    alignItems: "center",
    padding: "20px",
} as const;

const AccountSection = styled(Box)(() => ({
    width: "100%",
    maxWidth: 350,
    display: "flex",
    flexDirection: "column",
    gap: 24,
}));

const UserInfoSection = styled(Box)(() => ({
    display: "flex",
    flexDirection: "column",
    gap: 12,
    paddingBottom: 16,
    borderBottom: `1px solid ${COLORS.border}`,
}));

const UserInfoRow = styled(Box)(() => ({
    display: "flex",
    alignItems: "center",
    gap: 12,
}));

const FormSection = styled(Box)(() => ({
    display: "flex",
    flexDirection: "column",
    gap: 12,
}));

function AccountPage() {
    usePageTitle("Account");
    const navigate = useNavigate();
    // Settings is a leaf page: slideNavigate plays the slide-up enter transition.
    const slideNavigate = useSlideNavigate();
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
            await updateGoals(which === "reading" ? { readingGoal: next } : { writingGoal: next });
        } catch {
            /* AuthContext surfaces the error; local switch reverts via user state */
        } finally {
            setGoalSaving(null);
        }
    };

    // Avatar picker (modal) open state.
    const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);

    // Settings moved out of the (now-removed) hamburger into a gear in this page's
    // header. Logout likewise moved here from the drawer.
    const handleLogout = async () => {
        const confirmed = await confirm("Are you sure you want to log out?");
        if (confirmed) {
            logout();
            navigate("/");
        }
    };

    // Gear button rendered in the header's right slot → opens the Settings page.
    const settingsAction = (
        <IconButton
            className="account-page__settings-button"
            aria-label="Open settings"
            size="small"
            onClick={() => slideNavigate("/settings")}
            sx={{ color: COLORS.onSurface }}
        >
            <SettingsIcon />
        </IconButton>
    );
    // Per-category library card counts, shown as a display-only stat block.
    const { counts: categoryCounts, loaded: countsLoaded } = useCategoryCounts();

    // "Copied to clipboard" toast for the user-ID copy button
    const [copiedToastOpen, setCopiedToastOpen] = useState(false);

    // Copy the user ID to the clipboard, then surface a confirmation toast.
    // Falls back silently if the Clipboard API is unavailable (e.g. insecure context).
    const handleCopyUserId = async (id: string) => {
        try {
            await navigator.clipboard.writeText(id);
            setCopiedToastOpen(true);
        } catch {
            // Clipboard unavailable (non-HTTPS / unsupported) — no-op rather than crash.
        }
    };

    if (isLoading) {
        return (
            <MobileTabScreen title="Account" activePage="account" contentClassName="account-page__content" contentSx={CONTENT_SX}>
                <DelayedCircularProgress className="account-page__spinner" />
            </MobileTabScreen>
        );
    }

    if (!user) {
        return (
            <MobileTabScreen title="Account" activePage="account" contentClassName="account-page__content" contentSx={CONTENT_SX}>
                <Typography className="account-page__no-user-text" sx={{ textAlign: "center", color: COLORS.onSurface }}>
                    Please log in to view your account
                </Typography>
            </MobileTabScreen>
        );
    }

    const userId = user.id;
    const userEmail = user.email;
    const userName = user.name;

    return (
        <>
            <MobileTabScreen title="Account" activePage="account" contentClassName="account-page__content" contentSx={CONTENT_SX} headerExtraActions={settingsAction}>
                    <AccountSection className="account-page__account-section">
                        {/* User Info Section */}
                        <UserInfoSection className="account-page__user-info-section">
                            <UserInfoRow className="account-page__user-info-row">
                                {/* Tappable avatar → opens the icon picker. Renders the
                                    chosen icons8 icon when set (src), otherwise MUI falls
                                    back to the name-initial child. */}
                                <Avatar
                                    className="account-page__avatar"
                                    role="button"
                                    aria-label="Change avatar"
                                    onClick={() => setAvatarPickerOpen(true)}
                                    src={
                                        user.avatarIconId
                                            ? `${API_BASE_URL}/api/icons8/${encodeURIComponent(user.avatarIconId)}/image`
                                            : undefined
                                    }
                                    imgProps={{ sx: { objectFit: "contain", p: 0.75 } }}
                                    sx={{
                                        width: 56,
                                        height: 56,
                                        bgcolor: COLORS.hskChip,
                                        fontSize: SIZE.title,
                                        fontWeight: WEIGHT.medium,
                                        cursor: "pointer",
                                    }}
                                >
                                    {userName.charAt(0).toUpperCase()}
                                </Avatar>
                                <Box className="account-page__user-text" sx={{ flex: 1 }}>
                                    <Typography
                                        className="account-page__user-name"
                                        sx={{
                                            fontSize: SIZE.body,
                                            fontWeight: WEIGHT.medium,
                                            color: COLORS.onSurface,
                                            fontFamily: FONTS.sans,
                                        }}
                                    >
                                        {userName}
                                    </Typography>
                                    <Typography
                                        className="account-page__user-email"
                                        sx={{
                                            fontSize: SIZE.caption,
                                            color: COLORS.textSecondary,
                                            fontFamily: FONTS.sans,
                                        }}
                                    >
                                        {userEmail}
                                    </Typography>
                                </Box>
                            </UserInfoRow>
                            <Box
                                className="account-page__user-id-row"
                                sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
                            >
                                <Typography
                                    className="account-page__user-id"
                                    sx={{
                                        fontSize: SIZE.caption,
                                        color: COLORS.textSecondary,
                                        fontFamily: FONTS.sans,
                                    }}
                                >
                                    ID: {userId}
                                </Typography>
                                <IconButton
                                    className="account-page__copy-user-id-button"
                                    aria-label="Copy user ID"
                                    size="small"
                                    onClick={() => handleCopyUserId(String(userId))}
                                    sx={{ color: COLORS.textSecondary, padding: "2px" }}
                                >
                                    <ContentCopy sx={{ fontSize: SIZE.body }} />
                                </IconButton>
                            </Box>
                        </UserInfoSection>

                        {/* Deck stats — display-only bucket counts (no navigation).
                            The buckets are withheld until the counts finish loading, then
                            mount with a staggered pop-in animation (see DeckBuckets). The
                            wrapper reserves the row's height up front so the form below
                            doesn't shift down when the cards appear. */}
                        <Box className="account-page__deck-stats" sx={{ minHeight: 150 }}>
                            {countsLoaded && <DeckBuckets counts={categoryCounts} variant="display" />}
                        </Box>

                        {/* Goals Section — opt into the Reading / Writing mastery goals
                            (docs/MASTERY_REWORK.md). Recognition + Production are always
                            pursued and aren't shown here. Hidden for Spanish accounts. */}
                        {showGoals && (
                            <FormSection className="account-page__goals-section">
                                <Typography
                                    className="account-page__section-title"
                                    sx={{
                                        fontSize: SIZE.body,
                                        fontWeight: WEIGHT.medium,
                                        color: COLORS.onSurface,
                                        fontFamily: FONTS.sans,
                                    }}
                                >
                                    Goals
                                </Typography>
                                <Typography
                                    className="account-page__goals-description"
                                    sx={{
                                        fontSize: SIZE.caption,
                                        color: COLORS.textSecondary,
                                        fontFamily: FONTS.sans,
                                        mt: 0.5,
                                        mb: 1,
                                    }}
                                >
                                    Turning a goal on may demote some mastered cards back to
                                    comfortable — you&apos;ll need to train reading and writing
                                    to promote them back to mastered.
                                </Typography>
                                <FormGroup className="account-page__goals-group">
                                    <FormControlLabel
                                        className="account-page__goal-reading"
                                        control={
                                            <Checkbox
                                                checked={user?.readingGoal === true}
                                                disabled={goalSaving !== null}
                                                onChange={(e) => handleToggleGoal("reading", e.target.checked)}
                                            />
                                        }
                                        label="I want to learn reading"
                                        sx={{ "& .MuiFormControlLabel-label": { fontSize: SIZE.body, fontFamily: FONTS.sans, color: COLORS.onSurface } }}
                                    />
                                    <FormControlLabel
                                        className="account-page__goal-writing"
                                        control={
                                            <Checkbox
                                                checked={user?.writingGoal === true}
                                                disabled={goalSaving !== null}
                                                onChange={(e) => handleToggleGoal("writing", e.target.checked)}
                                            />
                                        }
                                        label="I want to learn writing"
                                        sx={{ "& .MuiFormControlLabel-label": { fontSize: SIZE.body, fontFamily: FONTS.sans, color: COLORS.onSurface } }}
                                    />
                                </FormGroup>
                            </FormSection>
                        )}

                        {/* Logout Section — moved here from the removed hamburger drawer. */}
                        <FormSection className="account-page__logout-section">
                            <Button
                                className="account-page__logout-button"
                                fullWidth
                                variant="outlined"
                                color="primary"
                                startIcon={<LogoutIcon fontSize="small" />}
                                onClick={handleLogout}
                                size="small"
                            >
                                Log Out
                            </Button>
                        </FormSection>
                    </AccountSection>
            </MobileTabScreen>

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

            {/* "Copied to clipboard" confirmation for the user-ID copy button */}
            <Snackbar
                className="account-page__copy-toast"
                open={copiedToastOpen}
                autoHideDuration={2000}
                onClose={() => setCopiedToastOpen(false)}
                message="Copied to clipboard"
                anchorOrigin={{ vertical: "top", horizontal: "center" }}
            />
        </>
    );
}

export default AccountPage;
