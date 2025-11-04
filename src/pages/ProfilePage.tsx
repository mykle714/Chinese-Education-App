import { useState } from "react";
import {
    Container,
    Typography,
    Paper,
    Box,
    Avatar,
    CircularProgress,
    TextField,
    Button,
    Alert,
    Divider,
    IconButton,
    InputAdornment,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions
} from "@mui/material";
import { Visibility, VisibilityOff, Warning } from "@mui/icons-material";
import { useAuth } from "../AuthContext";

function ProfilePage() {
    const { user, isLoading, changePassword, deleteAccount } = useAuth();

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

    // Toggle password visibility
    const toggleCurrentPasswordVisibility = () => {
        setShowCurrentPassword(!showCurrentPassword);
    };

    const toggleNewPasswordVisibility = () => {
        setShowNewPassword(!showNewPassword);
    };

    const toggleConfirmPasswordVisibility = () => {
        setShowConfirmPassword(!showConfirmPassword);
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
            <Container maxWidth="lg" sx={{ py: 4, display: 'flex', justifyContent: 'center' }}>
                <CircularProgress />
            </Container>
        );
    }

    if (!user) {
        return (
            <Container maxWidth="lg" sx={{ py: 4 }}>
                <Typography variant="h5" component="h1" align="center">
                    Please log in to view your profile
                </Typography>
            </Container>
        );
    }

    const userId = user.id;
    const userEmail = user.email;
    const userName = user.name;

    return (
        <Container maxWidth="lg" sx={{ py: 4 }}>
            <Typography variant="h3" component="h1" align="center" gutterBottom sx={{ mb: 4 }}>
                User Profile
            </Typography>

            <Paper elevation={3} sx={{ p: 4, maxWidth: 600, mx: "auto" }}>
                <Box sx={{ display: "flex", alignItems: "center", mb: 3 }}>
                    <Avatar sx={{ width: 80, height: 80, mr: 3, bgcolor: "primary.main" }}>
                        {userName.charAt(0)}
                    </Avatar>
                    <Box>
                        <Typography variant="h5" component="h2" gutterBottom>
                            {userName}
                        </Typography>
                        <Typography variant="body1" color="text.secondary">
                            {userEmail}
                        </Typography>
                    </Box>
                </Box>

                <Typography variant="body2" color="text.secondary" paragraph>
                    User ID: {userId}
                </Typography>

                <Divider sx={{ my: 3 }} />

                <Typography variant="h6" component="h3" gutterBottom>
                    Change Password
                </Typography>

                {success && (
                    <Alert severity="success" sx={{ mb: 2 }}>
                        Password changed successfully!
                    </Alert>
                )}

                {error && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                        {error}
                    </Alert>
                )}

                <Box component="form" onSubmit={handleSubmit} noValidate sx={{ mt: 2 }}>
                    <TextField
                        margin="normal"
                        required
                        fullWidth
                        name="currentPassword"
                        label="Current Password"
                        type={showCurrentPassword ? "text" : "password"}
                        id="currentPassword"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        InputProps={{
                            endAdornment: (
                                <InputAdornment position="end">
                                    <IconButton
                                        aria-label="toggle password visibility"
                                        onClick={toggleCurrentPasswordVisibility}
                                        edge="end"
                                    >
                                        {showCurrentPassword ? <VisibilityOff /> : <Visibility />}
                                    </IconButton>
                                </InputAdornment>
                            )
                        }}
                    />

                    <TextField
                        margin="normal"
                        required
                        fullWidth
                        name="newPassword"
                        label="New Password"
                        type={showNewPassword ? "text" : "password"}
                        id="newPassword"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        InputProps={{
                            endAdornment: (
                                <InputAdornment position="end">
                                    <IconButton
                                        aria-label="toggle password visibility"
                                        onClick={toggleNewPasswordVisibility}
                                        edge="end"
                                    >
                                        {showNewPassword ? <VisibilityOff /> : <Visibility />}
                                    </IconButton>
                                </InputAdornment>
                            )
                        }}
                    />

                    <TextField
                        margin="normal"
                        required
                        fullWidth
                        name="confirmPassword"
                        label="Confirm New Password"
                        type={showConfirmPassword ? "text" : "password"}
                        id="confirmPassword"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        InputProps={{
                            endAdornment: (
                                <InputAdornment position="end">
                                    <IconButton
                                        aria-label="toggle password visibility"
                                        onClick={toggleConfirmPasswordVisibility}
                                        edge="end"
                                    >
                                        {showConfirmPassword ? <VisibilityOff /> : <Visibility />}
                                    </IconButton>
                                </InputAdornment>
                            )
                        }}
                    />

                    <Button
                        type="submit"
                        fullWidth
                        variant="contained"
                        sx={{ mt: 3, mb: 2 }}
                        disabled={isSubmitting}
                    >
                        {isSubmitting ? "Changing Password..." : "Change Password"}
                    </Button>
                </Box>

                <Divider sx={{ my: 4 }} />

                <Typography variant="h6" component="h3" gutterBottom color="error">
                    Delete Account
                </Typography>

                <Alert severity="warning" icon={<Warning />} sx={{ mb: 2 }}>
                    This action is permanent and cannot be undone. All your data including vocabulary entries, work points, and study history will be permanently deleted.
                </Alert>

                <Button
                    fullWidth
                    variant="outlined"
                    color="error"
                    startIcon={<Warning />}
                    onClick={handleOpenDeleteDialog}
                    sx={{ mt: 2 }}
                >
                    Delete My Account
                </Button>
            </Paper>

            {/* Delete Account Confirmation Dialog */}
            <Dialog
                open={deleteDialogOpen}
                onClose={handleCloseDeleteDialog}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle sx={{ color: 'error.main', display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Warning /> Delete Account
                </DialogTitle>
                <DialogContent>
                    <DialogContentText sx={{ mb: 3 }}>
                        Are you sure you want to delete your account? This action is permanent and cannot be undone.
                    </DialogContentText>

                    <DialogContentText sx={{ mb: 2, fontWeight: 'bold' }}>
                        All of the following will be permanently deleted:
                    </DialogContentText>

                    <DialogContentText component="ul" sx={{ mb: 3, pl: 2 }}>
                        <li>Your profile and account information</li>
                        <li>All vocabulary entries you've created</li>
                        <li>Your work points and study history</li>
                        <li>All study deck configurations</li>
                        <li>Any texts you've saved</li>
                    </DialogContentText>

                    {deleteError && (
                        <Alert severity="error" sx={{ mb: 2 }}>
                            {deleteError}
                        </Alert>
                    )}

                    <TextField
                        autoFocus
                        margin="dense"
                        label="Enter your password to confirm"
                        type={showDeletePassword ? "text" : "password"}
                        fullWidth
                        variant="outlined"
                        value={deletePassword}
                        onChange={(e) => setDeletePassword(e.target.value)}
                        InputProps={{
                            endAdornment: (
                                <InputAdornment position="end">
                                    <IconButton
                                        aria-label="toggle password visibility"
                                        onClick={() => setShowDeletePassword(!showDeletePassword)}
                                        edge="end"
                                    >
                                        {showDeletePassword ? <VisibilityOff /> : <Visibility />}
                                    </IconButton>
                                </InputAdornment>
                            )
                        }}
                    />
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2 }}>
                    <Button onClick={handleCloseDeleteDialog} disabled={isDeleting}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleDeleteAccount}
                        color="error"
                        variant="contained"
                        disabled={isDeleting}
                        startIcon={isDeleting ? <CircularProgress size={20} /> : <Warning />}
                    >
                        {isDeleting ? "Deleting..." : "Delete My Account"}
                    </Button>
                </DialogActions>
            </Dialog>
        </Container>
    );
}

export default ProfilePage;
