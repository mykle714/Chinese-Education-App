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
    InputAdornment
} from "@mui/material";
import { Visibility, VisibilityOff } from "@mui/icons-material";
import { useAuth } from "../AuthContext";

function ProfilePage() {
    const { user, isLoading, changePassword } = useAuth();

    // Password form state
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");

    // Form submission state
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);

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
            </Paper>
        </Container>
    );
}

export default ProfilePage;
