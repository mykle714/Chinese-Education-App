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
    useMediaQuery,
    useTheme,
} from "@mui/material";
import { Logout, Visibility, VisibilityOff, Warning } from "@mui/icons-material";
import { styled } from "@mui/material/styles";
import MobileFooter from "../components/MobileFooter";
import MobileNavDrawer from "../components/MobileNavDrawer";
import { useAuth } from "../AuthContext";
import { useConfirmation } from "../contexts/ConfirmationContext";

// Design tokens from Figma
const COLORS = {
    background: "#F9F7F2",
    header: "#D7D7D4",
    onSurface: "#1D1B20",
    border: "#625F63",
};

// Styled Components
const IPhoneFrame = styled(Box)(() => ({
    backgroundColor: COLORS.background,
    borderRadius: 0,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    width: "100vw",
    height: "100vh",
}));

const Header = styled(Box)(() => ({
    backgroundColor: COLORS.header,
    minHeight: 96,
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    gap: 10,
}));

const Toolbar = styled(Box)(() => ({
    display: "flex",
    gap: 10,
    width: "100%",
    height: 47,
    alignItems: "center",
    padding: "0 12px 0 28px",
    position: "relative",
}));

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
    const { user, isLoading, changePassword, deleteAccount, logout } = useAuth();
    const { confirm } = useConfirmation();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down("md"));

    // On desktop the Layout wraps this page normally; restore the phone-frame look
    const desktopFrameSx = !isMobile ? {
        maxWidth: 393,
        width: "100%",
        borderRadius: "20px",
        margin: "0 auto",
        minHeight: "852px",
        maxHeight: "932px",
    } : {};

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

    // Handle logout with confirmation
    const handleLogout = async () => {
        const confirmed = await confirm("Are you sure you want to log out?");
        if (confirmed) {
            logout();
        }
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
        } catch (err: any) {
            setDeleteError(err.message || "Failed to delete account");
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
        } catch (err: any) {
            setError(err.message || "Failed to change password");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isLoading) {
        return (
            <IPhoneFrame className="account-page__frame" sx={desktopFrameSx}>
                <Header className="account-page__header">
                    <Toolbar className="account-page__toolbar">
                        <Box sx={{ width: 34 }} />
                        <Typography
                            className="account-page__title"
                            sx={{
                                flex: 1,
                                fontSize: 16,
                                fontWeight: 400,
                                color: COLORS.onSurface,
                                textAlign: "center",
                                lineHeight: 1.21,
                                fontFamily: '"Inter", sans-serif',
                            }}
                        >
                            Account
                        </Typography>
                        <MobileNavDrawer />
                    </Toolbar>
                </Header>
                <ContentArea className="account-page__content">
                    <CircularProgress className="account-page__spinner" />
                </ContentArea>
                <MobileFooter activePage="account" />
            </IPhoneFrame>
        );
    }

    if (!user) {
        return (
            <IPhoneFrame className="account-page__frame" sx={desktopFrameSx}>
                <Header className="account-page__header">
                    <Toolbar className="account-page__toolbar">
                        <Box sx={{ width: 34 }} />
                        <Typography
                            className="account-page__title"
                            sx={{
                                flex: 1,
                                fontSize: 16,
                                fontWeight: 400,
                                color: COLORS.onSurface,
                                textAlign: "center",
                                lineHeight: 1.21,
                                fontFamily: '"Inter", sans-serif',
                            }}
                        >
                            Account
                        </Typography>
                        <MobileNavDrawer />
                    </Toolbar>
                </Header>
                <ContentArea className="account-page__content">
                    <Typography className="account-page__no-user-text" sx={{ textAlign: "center", color: COLORS.onSurface }}>
                        Please log in to view your account
                    </Typography>
                </ContentArea>
                <MobileFooter activePage="account" />
            </IPhoneFrame>
        );
    }

    const userId = user.id;
    const userEmail = user.email;
    const userName = user.name;

    return (
        <>
        <IPhoneFrame className="account-page__frame">
            {/* Header */}
            <Header className="account-page__header">
                <Toolbar className="account-page__toolbar">
                    <Box sx={{ width: 34 }} />
                    <Typography
                        className="account-page__title"
                        sx={{
                            flex: 1,
                            fontSize: 16,
                            fontWeight: 400,
                            color: COLORS.onSurface,
                            textAlign: "center",
                            lineHeight: 1.21,
                            fontFamily: '"Inter", sans-serif',
                        }}
                    >
                        Account
                    </Typography>
                    <MobileNavDrawer />
                </Toolbar>
            </Header>

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
                                        fontSize: 20,
                                        fontWeight: 500,
                                    }}
                                >
                                    {userName.charAt(0).toUpperCase()}
                                </Avatar>
                                <Box className="account-page__user-text" sx={{ flex: 1 }}>
                                    <Typography
                                        className="account-page__user-name"
                                        sx={{
                                            fontSize: 14,
                                            fontWeight: 500,
                                            color: COLORS.onSurface,
                                            fontFamily: '"Inter", sans-serif',
                                        }}
                                    >
                                        {userName}
                                    </Typography>
                                    <Typography
                                        className="account-page__user-email"
                                        sx={{
                                            fontSize: 12,
                                            color: "#625F63",
                                            fontFamily: '"Inter", sans-serif',
                                        }}
                                    >
                                        {userEmail}
                                    </Typography>
                                </Box>
                            </UserInfoRow>
                            <Typography
                                className="account-page__user-id"
                                sx={{
                                    fontSize: 12,
                                    color: "#625F63",
                                    fontFamily: '"Inter", sans-serif',
                                }}
                            >
                                ID: {userId}
                            </Typography>
                        </UserInfoSection>

                        {/* Logout Button */}
                        <Button
                            className="account-page__logout-button"
                            fullWidth
                            variant="outlined"
                            color="primary"
                            startIcon={<Logout fontSize="small" />}
                            onClick={handleLogout}
                            size="small"
                        >
                            Log Out
                        </Button>

                        {/* Password Change Section */}
                        <FormSection className="account-page__password-section">
                            <Typography
                                className="account-page__section-title"
                                sx={{
                                    fontSize: 14,
                                    fontWeight: 500,
                                    color: COLORS.onSurface,
                                    fontFamily: '"Inter", sans-serif',
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
                                    fontSize: 14,
                                    fontWeight: 500,
                                    color: "#EF476F",
                                    fontFamily: '"Inter", sans-serif',
                                }}
                            >
                                Delete Account
                            </Typography>

                            <Alert className="account-page__warning-alert" severity="warning" icon={<Warning fontSize="small" />} sx={{ fontSize: 12 }}>
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
            </IPhoneFrame>

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
                    <DialogContentText className="account-page__dialog-content-text" sx={{ mb: 3, fontSize: 14 }}>
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
        </>
    );
}

export default AccountPage;
