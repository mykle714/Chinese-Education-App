import { useState } from "react";
import {
    Box,
    Typography,
    Avatar,
    CircularProgress,
    TextField,
    Button,
    Alert,
    IconButton,
    InputAdornment,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions,
    Snackbar,
} from "@mui/material";
import { Visibility, VisibilityOff, Warning, ContentCopy } from "@mui/icons-material";
import { styled } from "@mui/material/styles";
import MobileDemoHeader from "../components/MobileDemoHeader";
import MobileFooter from "../components/MobileFooter";
import DeckBuckets from "../components/DeckBuckets";
import { useAuth } from "../AuthContext";
import { usePageTitle } from "../hooks/usePageTitle";
import { useCategoryCounts } from "../hooks/useCategoryCounts";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { SIZE, WEIGHT } from "../theme/scale";

// Styled Components — phone-frame sizing comes from MobileDemoFrame via Layout.tsx
const ContentArea = styled(Box)(() => ({
    flex: 1,
    overflowY: "auto",
    overflowX: "hidden",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "20px",
}));

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

const FormField = styled(TextField)(() => ({
    width: "100%",
}));

const DeleteButton = styled(Button)(() => ({
    marginTop: 8,
}));

function AccountPage() {
    usePageTitle("Account");
    const { user, isLoading, changePassword, deleteAccount } = useAuth();
    // Per-category library card counts, shown as a display-only stat block.
    const { counts: categoryCounts, loaded: countsLoaded } = useCategoryCounts();
    // Password form state
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");

    // Form submission state
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Delete account state
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [deletePassword, setDeletePassword] = useState("");
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [showDeletePassword, setShowDeletePassword] = useState(false);

    // Password visibility state
    const [showCurrentPassword, setShowCurrentPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

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

    // Form validation
    const validateForm = () => {
        if (!currentPassword) {
            setError("Current password is required");
            return false;
        }

        if (!newPassword) {
            setError("New password is required");
            return false;
        }

        if (newPassword !== confirmPassword) {
            setError("New passwords do not match");
            return false;
        }

        return true;
    };

    // Handle delete account dialog
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

    // Handle form submission
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Reset states
        setError(null);
        setSuccess(false);

        // Validate form
        if (!validateForm()) {
            return;
        }

        setIsSubmitting(true);

        try {
            await changePassword(currentPassword, newPassword);
            setSuccess(true);

            // Reset form
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Failed to change password");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isLoading) {
        return (
            <>
                <MobileDemoHeader title="Account" activePage="account" />
                <ContentArea className="account-page__content">
                    <CircularProgress className="account-page__spinner" />
                </ContentArea>
                <MobileFooter activePage="account" />
            </>
        );
    }

    if (!user) {
        return (
            <>
                <MobileDemoHeader title="Account" activePage="account" />
                <ContentArea className="account-page__content">
                    <Typography className="account-page__no-user-text" sx={{ textAlign: "center", color: COLORS.onSurface }}>
                        Please log in to view your account
                    </Typography>
                </ContentArea>
                <MobileFooter activePage="account" />
            </>
        );
    }

    const userId = user.id;
    const userEmail = user.email;
    const userName = user.name;

    return (
        <>
            {/* Header */}
            <MobileDemoHeader title="Account" activePage="account" />

                {/* Content Area */}
                <ContentArea className="account-page__content">
                    <AccountSection className="account-page__account-section">
                        {/* User Info Section */}
                        <UserInfoSection className="account-page__user-info-section">
                            <UserInfoRow className="account-page__user-info-row">
                                <Avatar
                                    className="account-page__avatar"
                                    sx={{
                                        width: 56,
                                        height: 56,
                                        bgcolor: "#779BE7",
                                        fontSize: SIZE.title,
                                        fontWeight: WEIGHT.medium,
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
                                            color: "#5C5C66",
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
                                        color: "#5C5C66",
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
                                    sx={{ color: "#5C5C66", padding: "2px" }}
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

                        {/* Password Change Section */}
                        <FormSection className="account-page__password-section">
                            <Typography
                                className="account-page__section-title"
                                sx={{
                                    fontSize: SIZE.body,
                                    fontWeight: WEIGHT.medium,
                                    color: COLORS.onSurface,
                                    fontFamily: FONTS.sans,
                                }}
                            >
                                Change Password
                            </Typography>

                            {success && (
                                <Alert className="account-page__success-alert" severity="success" sx={{ mb: 2 }}>
                                    Password changed successfully!
                                </Alert>
                            )}

                            {error && (
                                <Alert className="account-page__error-alert" severity="error" sx={{ mb: 2 }}>
                                    {error}
                                </Alert>
                            )}

                            <Box className="account-page__password-form" component="form" onSubmit={handleSubmit} noValidate sx={{ mt: 1 }}>
                                <FormField
                                    margin="normal"
                                    required
                                    fullWidth
                                    name="currentPassword"
                                    label="Current Password"
                                    type={showCurrentPassword ? "text" : "password"}
                                    id="currentPassword"
                                    autoComplete="current-password"
                                    value={currentPassword}
                                    onChange={(e) => setCurrentPassword(e.target.value)}
                                    size="small"
                                    InputProps={{
                                        endAdornment: (
                                            <InputAdornment position="end">
                                                <IconButton
                                                    aria-label="toggle password visibility"
                                                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                                                    edge="end"
                                                    size="small"
                                                >
                                                    {showCurrentPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                                                </IconButton>
                                            </InputAdornment>
                                        )
                                    }}
                                />

                                <FormField
                                    margin="normal"
                                    required
                                    fullWidth
                                    name="newPassword"
                                    label="New Password"
                                    type={showNewPassword ? "text" : "password"}
                                    id="newPassword"
                                    autoComplete="new-password"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    size="small"
                                    InputProps={{
                                        endAdornment: (
                                            <InputAdornment position="end">
                                                <IconButton
                                                    aria-label="toggle password visibility"
                                                    onClick={() => setShowNewPassword(!showNewPassword)}
                                                    edge="end"
                                                    size="small"
                                                >
                                                    {showNewPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                                                </IconButton>
                                            </InputAdornment>
                                        )
                                    }}
                                />

                                <FormField
                                    margin="normal"
                                    required
                                    fullWidth
                                    name="confirmPassword"
                                    label="Confirm New Password"
                                    type={showConfirmPassword ? "text" : "password"}
                                    id="confirmPassword"
                                    autoComplete="new-password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    size="small"
                                    InputProps={{
                                        endAdornment: (
                                            <InputAdornment position="end">
                                                <IconButton
                                                    aria-label="toggle password visibility"
                                                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                                    edge="end"
                                                    size="small"
                                                >
                                                    {showConfirmPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                                                </IconButton>
                                            </InputAdornment>
                                        )
                                    }}
                                />

                                <Button
                                    className="account-page__submit-button"
                                    type="submit"
                                    fullWidth
                                    variant="contained"
                                    sx={{ mt: 2 }}
                                    disabled={isSubmitting}
                                    size="small"
                                >
                                    {isSubmitting ? "Changing..." : "Change Password"}
                                </Button>
                            </Box>
                        </FormSection>

                        {/* Delete Account Section */}
                        <FormSection className="account-page__delete-section">
                            <Typography
                                className="account-page__delete-section-title"
                                sx={{
                                    fontSize: SIZE.body,
                                    fontWeight: WEIGHT.medium,
                                    color: "#EF476F",
                                    fontFamily: FONTS.sans,
                                }}
                            >
                                Delete Account
                            </Typography>

                            <Alert className="account-page__warning-alert" severity="warning" icon={<Warning fontSize="small" />} sx={{ fontSize: SIZE.caption }}>
                                This action is permanent and cannot be undone.
                            </Alert>

                            <DeleteButton
                                className="account-page__delete-button"
                                fullWidth
                                variant="outlined"
                                color="error"
                                startIcon={<Warning fontSize="small" />}
                                onClick={handleOpenDeleteDialog}
                                size="small"
                            >
                                Delete My Account
                            </DeleteButton>
                        </FormSection>
                    </AccountSection>
                </ContentArea>

                {/* Footer */}
                <MobileFooter activePage="account" />

            {/* Delete Account Confirmation Dialog */}
            <Dialog
                className="account-page__delete-dialog"
                open={deleteDialogOpen}
                onClose={handleCloseDeleteDialog}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle className="account-page__dialog-title" sx={{ color: 'error.main', display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Warning className="account-page__dialog-warning-icon" /> Delete Account
                </DialogTitle>
                <DialogContent className="account-page__dialog-content">
                    <DialogContentText className="account-page__dialog-content-text" sx={{ mb: 3, fontSize: SIZE.body }}>
                        Are you sure you want to delete your account? This action is permanent and cannot be undone.
                    </DialogContentText>

                    {deleteError && (
                        <Alert className="account-page__dialog-error-alert" severity="error" sx={{ mb: 2 }}>
                            {deleteError}
                        </Alert>
                    )}

                    <TextField
                        className="account-page__dialog-password-field"
                        autoFocus
                        margin="dense"
                        label="Enter your password to confirm"
                        type={showDeletePassword ? "text" : "password"}
                        autoComplete="current-password"
                        fullWidth
                        variant="outlined"
                        value={deletePassword}
                        onChange={(e) => setDeletePassword(e.target.value)}
                        size="small"
                        InputProps={{
                            endAdornment: (
                                <InputAdornment position="end">
                                    <IconButton
                                        aria-label="toggle password visibility"
                                        onClick={() => setShowDeletePassword(!showDeletePassword)}
                                        edge="end"
                                        size="small"
                                    >
                                        {showDeletePassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                                    </IconButton>
                                </InputAdornment>
                            )
                        }}
                    />
                </DialogContent>
                <DialogActions className="account-page__dialog-actions" sx={{ px: 3, pb: 2 }}>
                    <Button className="account-page__dialog-cancel-button" onClick={handleCloseDeleteDialog} disabled={isDeleting} size="small">
                        Cancel
                    </Button>
                    <Button
                        className="account-page__dialog-delete-button"
                        onClick={handleDeleteAccount}
                        color="error"
                        variant="contained"
                        disabled={isDeleting}
                        startIcon={isDeleting ? <CircularProgress size={16} /> : <Warning fontSize="small" />}
                        size="small"
                    >
                        {isDeleting ? "Deleting..." : "Delete"}
                    </Button>
                </DialogActions>
            </Dialog>

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
