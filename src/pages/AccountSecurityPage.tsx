import { useState } from "react";
import {
    Box,
    Typography,
    Alert,
    TextField,
    Button,
    IconButton,
    InputAdornment,
    Dialog,
    DialogContent,
    CircularProgress,
} from "@mui/material";
import LeafPage from "../components/LeafPage";
import Icon from "../components/Icon";
import MinutePointsFireBadge from "../minutePoints/MinutePointsFireBadge";
import { SettingsSection } from "../components/primitives";
import { useAuth } from "../AuthContext";
import { usePageTitle } from "../hooks/usePageTitle";
import { useSlideNavigate } from "../hooks/useSlideNavigate";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";

/**
 * Settings · account & security (`/settings/account`) — artboard 11b of the shelf
 * redesign (docs/SHELF_REDESIGN.md entry 11b).
 *
 * The WRITE-heavy half of settings, split off `/settings` so the read-heavy half
 * (theme, language, narration, display) is a page you can skim. Holds exactly two
 * sections: the three-field password form, and the red-boxed danger zone with its
 * password-confirmed delete dialog.
 *
 * Reached only from the chevron row at the foot of `SettingsPage`. It is a LEAF page
 * like its parent — down arrow, no footer — declared as such in
 * `src/routes/routeMeta.ts`, which is what tells `pageTransition` and
 * `FooterPresenter` how it behaves. Declaring it in the page instead would give it a
 * footer.
 *
 * Depended on by: docs/SHELF_REDESIGN.md entry 11b, docs/LEAF_NODE_PAGES.md,
 * docs/UX_AND_NAVIGATION.md.
 */

/** A visibility toggle for one password field. Three fields here plus one in the
 *  dialog were each re-declaring this same eight-line adornment. */
const revealAdornment = (shown: boolean, onToggle: () => void, label: string) => ({
    endAdornment: (
        <InputAdornment position="end">
            <IconButton aria-label={label} onClick={onToggle} edge="end" size="small">
                <Icon name={shown ? "visibility_off" : "visibility"} size={18} color={COLORS.textSecondary} />
            </IconButton>
        </InputAdornment>
    ),
});

function AccountSecurityPage() {
    usePageTitle("Account & security");
    const slideNavigate = useSlideNavigate();
    const { changePassword, deleteAccount } = useAuth();

    // Password change form state
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [isSubmittingPassword, setIsSubmittingPassword] = useState(false);
    const [passwordSuccess, setPasswordSuccess] = useState(false);
    const [passwordError, setPasswordError] = useState<string | null>(null);
    const [showCurrentPassword, setShowCurrentPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    const validatePasswordForm = () => {
        if (!currentPassword) {
            setPasswordError("Current password is required");
            return false;
        }
        if (!newPassword) {
            setPasswordError("New password is required");
            return false;
        }
        if (newPassword !== confirmPassword) {
            setPasswordError("New passwords do not match");
            return false;
        }
        return true;
    };

    const handleSubmitPasswordChange = async (e: React.FormEvent) => {
        e.preventDefault();
        setPasswordError(null);
        setPasswordSuccess(false);
        if (!validatePasswordForm()) {
            return;
        }
        setIsSubmittingPassword(true);
        try {
            await changePassword(currentPassword, newPassword);
            setPasswordSuccess(true);
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
        } catch (err: unknown) {
            setPasswordError(err instanceof Error ? err.message : "Failed to change password");
        } finally {
            setIsSubmittingPassword(false);
        }
    };

    // Delete account dialog state
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [deletePassword, setDeletePassword] = useState("");
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [showDeletePassword, setShowDeletePassword] = useState(false);

    const handleOpenDeleteDialog = () => {
        setDeleteDialogOpen(true);
        setDeletePassword("");
        setDeleteError(null);
    };

    const handleCloseDeleteDialog = () => {
        setDeleteDialogOpen(false);
        setDeletePassword("");
        setDeleteError(null);
    };

    const handleDeleteAccount = async () => {
        setDeleteError(null);
        if (!deletePassword) {
            setDeleteError("Password is required to delete your account");
            return;
        }
        setIsDeleting(true);
        try {
            await deleteAccount(deletePassword);
            // Navigation to login is handled in the deleteAccount function
        } catch (err: unknown) {
            setDeleteError(err instanceof Error ? err.message : "Failed to delete account");
            setIsDeleting(false);
        }
    };

    return (
        <LeafPage
            title="Account & security"
            onBack={() => slideNavigate("/settings")}
            rightContent={<MinutePointsFireBadge />}
            className="account-security-page"
        >
            <Box className="account-security-page__scroll" sx={{ flex: 1, overflowY: "auto" }}>
                {/* ── Change password ────────────────────────────────────────────── */}
                <SettingsSection className="account-security-page__password-section" icon="lock" title="Change Password">
                    {passwordSuccess && (
                        <Alert className="account-security-page__password-success-alert" severity="success" sx={{ mt: 1.5 }}>
                            Password changed successfully!
                        </Alert>
                    )}
                    {passwordError && (
                        <Alert className="account-security-page__password-error-alert" severity="error" sx={{ mt: 1.5 }}>
                            {passwordError}
                        </Alert>
                    )}

                    <Box
                        className="account-security-page__password-form"
                        component="form"
                        onSubmit={handleSubmitPasswordChange}
                        noValidate
                    >
                        <TextField
                            margin="normal"
                            required
                            fullWidth
                            name="currentPassword"
                            label="Current password"
                            type={showCurrentPassword ? "text" : "password"}
                            id="currentPassword"
                            autoComplete="current-password"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            InputProps={revealAdornment(
                                showCurrentPassword,
                                () => setShowCurrentPassword(!showCurrentPassword),
                                "Show current password",
                            )}
                        />
                        <TextField
                            margin="normal"
                            required
                            fullWidth
                            name="newPassword"
                            label="New password"
                            type={showNewPassword ? "text" : "password"}
                            id="newPassword"
                            autoComplete="new-password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            InputProps={revealAdornment(
                                showNewPassword,
                                () => setShowNewPassword(!showNewPassword),
                                "Show new password",
                            )}
                        />
                        <TextField
                            margin="normal"
                            required
                            fullWidth
                            name="confirmPassword"
                            label="Confirm new password"
                            type={showConfirmPassword ? "text" : "password"}
                            id="confirmPassword"
                            autoComplete="new-password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            InputProps={revealAdornment(
                                showConfirmPassword,
                                () => setShowConfirmPassword(!showConfirmPassword),
                                "Show confirmed password",
                            )}
                        />
                        {/* `contained` — the artboard fills this one, unlike the outlined
                            `.btn3`s around it, because it is the section's own commit. */}
                        <Button
                            className="account-security-page__password-submit-button"
                            type="submit"
                            fullWidth
                            variant="contained"
                            sx={{ mt: 1.5, borderRadius: "14px" }}
                            disabled={isSubmittingPassword}
                        >
                            {isSubmittingPassword ? "Changing..." : "Change Password"}
                        </Button>
                    </Box>
                </SettingsSection>

                {/* ── Danger zone ────────────────────────────────────────────────── */}
                <SettingsSection
                    className="account-security-page__delete-section"
                    icon="warning"
                    title="Delete Account"
                    tone="danger"
                    description="This action is permanent and cannot be undone."
                >
                    {/* `color="error"` rather than the theme's primary ink: the shape
                        override applies to every colour, but the ink only lands on the
                        `*Primary` slots, so this keeps its red. */}
                    <Button
                        className="account-security-page__delete-button"
                        fullWidth
                        variant="outlined"
                        color="error"
                        onClick={handleOpenDeleteDialog}
                        sx={{ mt: 1.5 }}
                    >
                        Delete My Account
                    </Button>
                </SettingsSection>

                <Box className="account-security-page__bottom-clearance" sx={{ height: 28 }} />
            </Box>

            {/* Delete confirmation — the artboard's bottom-anchored `.modal .cd`, which
                is why it is `fullScreen`-width at the bottom rather than a centred MUI
                dialog: the confirm needs a thumb-reachable pair of buttons. */}
            <Dialog
                className="account-security-page__delete-dialog"
                open={deleteDialogOpen}
                onClose={handleCloseDeleteDialog}
                fullWidth
                maxWidth="sm"
                slotProps={{
                    paper: {
                        sx: {
                            margin: "18px",
                            width: "calc(100% - 36px)",
                            borderRadius: "18px",
                            backgroundColor: COLORS.white,
                        },
                    },
                }}
            >
                <DialogContent className="account-security-page__dialog-content" sx={{ padding: "20px" }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: "9px" }}>
                        <Icon name="warning" size={19} color={COLORS.dangerInk} />
                        <Typography
                            className="account-security-page__dialog-title"
                            component="h2"
                            sx={{ fontFamily: FONTS.sans, fontSize: 16, fontWeight: 700, color: COLORS.dangerInk }}
                        >
                            Delete Account
                        </Typography>
                    </Box>
                    <Typography
                        className="account-security-page__dialog-text"
                        sx={{
                            fontFamily: FONTS.sans,
                            fontSize: 12.5,
                            lineHeight: 1.5,
                            color: COLORS.iconColor,
                            marginTop: "8px",
                        }}
                    >
                        Are you sure? This action is permanent and cannot be undone.
                    </Typography>

                    {deleteError && (
                        <Alert className="account-security-page__dialog-error-alert" severity="error" sx={{ mt: 2 }}>
                            {deleteError}
                        </Alert>
                    )}

                    <TextField
                        className="account-security-page__dialog-password-field"
                        autoFocus
                        margin="normal"
                        label="Enter your password to confirm"
                        type={showDeletePassword ? "text" : "password"}
                        autoComplete="current-password"
                        fullWidth
                        value={deletePassword}
                        onChange={(e) => setDeletePassword(e.target.value)}
                        InputProps={revealAdornment(
                            showDeletePassword,
                            () => setShowDeletePassword(!showDeletePassword),
                            "Show password",
                        )}
                    />

                    <Box sx={{ display: "flex", gap: "9px", marginTop: "13px" }}>
                        <Button
                            className="account-security-page__dialog-cancel-button"
                            variant="outlined"
                            onClick={handleCloseDeleteDialog}
                            disabled={isDeleting}
                            sx={{ flex: 1 }}
                        >
                            Cancel
                        </Button>
                        <Button
                            className="account-security-page__dialog-delete-button"
                            variant="contained"
                            color="error"
                            onClick={handleDeleteAccount}
                            disabled={isDeleting}
                            startIcon={isDeleting ? <CircularProgress size={16} color="inherit" /> : undefined}
                            sx={{ flex: 1, borderRadius: "14px" }}
                        >
                            {isDeleting ? "Deleting..." : "Delete"}
                        </Button>
                    </Box>
                </DialogContent>
            </Dialog>
        </LeafPage>
    );
}

export default AccountSecurityPage;
