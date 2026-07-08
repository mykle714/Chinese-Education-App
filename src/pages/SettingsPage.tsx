import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WEIGHT } from '../theme/scale';
import LeafPage from '../components/LeafPage';
import {
    Container,
    Paper,
    Typography,
    Box,
    FormControl,
    FormLabel,
    RadioGroup,
    FormControlLabel,
    Radio,
    Card,
    CardContent,
    Alert,
    Chip,
    Snackbar,
    Switch,
    TextField,
    Button,
    IconButton,
    InputAdornment,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions,
    CircularProgress,
} from '@mui/material';
import PaletteIcon from '@mui/icons-material/Palette';
import LanguageIcon from '@mui/icons-material/Language';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import LockIcon from '@mui/icons-material/Lock';
import { Visibility, VisibilityOff, Warning } from '@mui/icons-material';
import { useTheme, type ThemeMode } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import type { Language } from '../types';
import { usePageTitle } from '../hooks/usePageTitle';
import { useTTSSettings } from '../hooks/useTTSSettings';

function SettingsPage() {
    usePageTitle("Settings");
    const navigate = useNavigate();
    const { themeMode, setThemeMode, availableThemes } = useTheme();
    const { user, updateLanguage, changePassword, deleteAccount } = useAuth();
    const [languageSuccess, setLanguageSuccess] = useState(false);
    const [languageError, setLanguageError] = useState<string | null>(null);
    const { settings: ttsSettings, update: updateTTSSettings } = useTTSSettings();

    const handleThemeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setThemeMode(event.target.value as ThemeMode);
    };

    const handleLanguageChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const newLanguage = event.target.value as Language;
        try {
            await updateLanguage(newLanguage);
            setLanguageSuccess(true);
            setLanguageError(null);
        } catch (error: unknown) {
            setLanguageError(error instanceof Error ? error.message : 'Failed to update language preference');
            setLanguageSuccess(false);
        }
    };

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

    const availableLanguages: { value: Language; label: string; description: string }[] = [
        {
            value: 'zh',
            label: 'Chinese (Mandarin)',
            description: 'Learn simplified and traditional Chinese characters with pinyin pronunciation'
        },
        {
            value: 'es',
            label: 'Spanish',
            description: 'Learn Spanish vocabulary as plain text — no pronunciation overlay'
        },
    ];

    return (
        // Settings is a LEAF PAGE (see docs/LEAF_NODE_PAGES.md): no footer, DOWN
        // back arrow (→ Account, since it opens from the gear in the Account
        // header), slides up on enter / down on exit. Phone-frame sizing comes from
        // MobileDemoFrame via Layout.tsx (/settings is in MOBILE_DEMO_PATHS).
        <LeafPage title="Settings" onBack={() => navigate("/account")} className="settings-page">
            <Box className="settings-page__scroll" sx={{ flex: 1, overflowY: "auto" }}>
        <Container maxWidth="sm" sx={{ py: 4 }}>
            {/* Theme Settings Section */}
            <Paper elevation={2} sx={{ mb: 4 }}>
                <CardContent sx={{ p: 4 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
                        <PaletteIcon sx={{ mr: 2, color: 'primary.main' }} />
                        <Typography variant="h5" component="h2" fontWeight="bold">
                            Color Theme
                        </Typography>
                    </Box>

                    <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
                        Choose a color theme that suits your preference and learning environment.
                    </Typography>

                    <FormControl component="fieldset" sx={{ width: '100%' }}>
                        <FormLabel component="legend" sx={{ mb: 2, fontWeight: WEIGHT.bold }}>
                            Available Themes
                        </FormLabel>
                        <RadioGroup
                            value={themeMode}
                            onChange={handleThemeChange}
                            sx={{ gap: 2 }}
                        >
                            {availableThemes.map((theme) => (
                                <Card
                                    key={theme.value}
                                    variant="outlined"
                                    sx={{
                                        transition: 'all 0.2s ease-in-out',
                                        cursor: 'pointer',
                                        border: themeMode === theme.value ? 2 : 1,
                                        borderColor: themeMode === theme.value ? 'primary.main' : 'divider',
                                        backgroundColor: themeMode === theme.value ? 'action.selected' : 'background.paper',
                                        '&:hover': {
                                            borderColor: 'primary.main',
                                            backgroundColor: 'action.hover',
                                        },
                                    }}
                                    onClick={() => setThemeMode(theme.value)}
                                >
                                    <CardContent sx={{ py: 2 }}>
                                        <FormControlLabel
                                            value={theme.value}
                                            control={<Radio />}
                                            label={
                                                <Box sx={{ ml: 1 }}>
                                                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                                                        <Typography variant="h6" component="span" fontWeight="bold">
                                                            {theme.label}
                                                        </Typography>
                                                        {themeMode === theme.value && (
                                                            <Chip
                                                                label="Active"
                                                                size="small"
                                                                color="primary"
                                                                sx={{ ml: 2 }}
                                                            />
                                                        )}
                                                    </Box>
                                                    <Typography variant="body2" color="text.secondary">
                                                        {theme.description}
                                                    </Typography>
                                                </Box>
                                            }
                                            sx={{
                                                margin: 0,
                                                width: '100%',
                                                '& .MuiFormControlLabel-label': {
                                                    width: '100%',
                                                },
                                            }}
                                        />
                                    </CardContent>
                                </Card>
                            ))}
                        </RadioGroup>
                    </FormControl>

                    <Alert severity="info" sx={{ mt: 3 }}>
                        <Typography variant="body2">
                            Your theme preference is automatically saved and will be remembered when you return to the application.
                        </Typography>
                    </Alert>
                </CardContent>
            </Paper>

            {/* Language Selection Section */}
            <Paper elevation={2} sx={{ mb: 4 }}>
                <CardContent sx={{ p: 4 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
                        <LanguageIcon sx={{ mr: 2, color: 'primary.main' }} />
                        <Typography variant="h5" component="h2" fontWeight="bold">
                            Learning Language
                        </Typography>
                    </Box>

                    <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
                        Select the language you want to learn. This will filter your vocabulary entries and dictionary lookups.
                    </Typography>

                    <FormControl component="fieldset" sx={{ width: '100%' }}>
                        <FormLabel component="legend" sx={{ mb: 2, fontWeight: WEIGHT.bold }}>
                            Available Languages
                        </FormLabel>
                        <RadioGroup
                            value={user?.selectedLanguage || 'zh'}
                            onChange={handleLanguageChange}
                            sx={{ gap: 2 }}
                        >
                            {availableLanguages.map((lang) => {
                                const isActive = user?.selectedLanguage === lang.value;

                                return (
                                    <Card
                                        key={lang.value}
                                        variant="outlined"
                                        sx={{
                                            transition: 'all 0.2s ease-in-out',
                                            cursor: 'pointer',
                                            border: isActive ? 2 : 1,
                                            borderColor: isActive ? 'primary.main' : 'divider',
                                            backgroundColor: isActive ? 'action.selected' : 'background.paper',
                                            '&:hover': {
                                                borderColor: 'primary.main',
                                                backgroundColor: 'action.hover',
                                            },
                                        }}
                                        onClick={() => handleLanguageChange({ target: { value: lang.value } } as React.ChangeEvent<HTMLInputElement>)}
                                    >
                                        <CardContent sx={{ py: 2 }}>
                                            <FormControlLabel
                                                value={lang.value}
                                                control={<Radio />}
                                                label={
                                                    <Box sx={{ ml: 1 }}>
                                                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                                                            <Typography variant="h6" component="span" fontWeight="bold">
                                                                {lang.label}
                                                            </Typography>
                                                            {isActive && (
                                                                <Chip
                                                                    label="Active"
                                                                    size="small"
                                                                    color="primary"
                                                                    sx={{ ml: 2 }}
                                                                />
                                                            )}
                                                        </Box>
                                                        <Typography variant="body2" color="text.secondary">
                                                            {lang.description}
                                                        </Typography>
                                                    </Box>
                                                }
                                                sx={{
                                                    margin: 0,
                                                    width: '100%',
                                                    '& .MuiFormControlLabel-label': {
                                                        width: '100%',
                                                    },
                                                }}
                                            />
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </RadioGroup>
                    </FormControl>

                    <Alert severity="info" sx={{ mt: 3 }}>
                        <Typography variant="body2">
                            Currently available: Chinese and Spanish. More languages coming soon!
                        </Typography>
                    </Alert>
                </CardContent>
            </Paper>

            {/* Narration (TTS) Settings Section */}
            <Paper elevation={2} sx={{ mb: 4 }} className="narration-settings-section">
                <CardContent sx={{ p: 4 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
                        <VolumeUpIcon sx={{ mr: 2, color: 'primary.main' }} />
                        <Typography variant="h5" component="h2" fontWeight="bold">
                            Narration
                        </Typography>
                    </Box>

                    <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
                        Hear Chinese words read aloud as you flip through flashcards.
                    </Typography>

                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }} className="narration-enable-row">
                        <Box>
                            <Typography variant="body1" fontWeight="bold">Speak Chinese words aloud</Typography>
                            <Typography variant="body2" color="text.secondary">
                                Plays automatically when you flip a card, plus a speaker button on each card.
                            </Typography>
                        </Box>
                        <Switch
                            checked={ttsSettings.enabled}
                            onChange={(e) => updateTTSSettings({ enabled: e.target.checked })}
                            inputProps={{ 'aria-label': 'Enable narration' }}
                        />
                    </Box>
                </CardContent>
            </Paper>

            {/* Change Password Section */}
            <Paper elevation={2} sx={{ mb: 4 }} className="settings-page__password-section">
                <CardContent sx={{ p: 4 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
                        <LockIcon sx={{ mr: 2, color: 'primary.main' }} />
                        <Typography variant="h5" component="h2" fontWeight="bold">
                            Change Password
                        </Typography>
                    </Box>

                    {passwordSuccess && (
                        <Alert className="settings-page__password-success-alert" severity="success" sx={{ mb: 2 }}>
                            Password changed successfully!
                        </Alert>
                    )}

                    {passwordError && (
                        <Alert className="settings-page__password-error-alert" severity="error" sx={{ mb: 2 }}>
                            {passwordError}
                        </Alert>
                    )}

                    <Box className="settings-page__password-form" component="form" onSubmit={handleSubmitPasswordChange} noValidate>
                        <TextField
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

                        <TextField
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

                        <TextField
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
                            className="settings-page__password-submit-button"
                            type="submit"
                            fullWidth
                            variant="contained"
                            sx={{ mt: 2 }}
                            disabled={isSubmittingPassword}
                            size="small"
                        >
                            {isSubmittingPassword ? "Changing..." : "Change Password"}
                        </Button>
                    </Box>
                </CardContent>
            </Paper>

            {/* Delete Account Section */}
            <Paper elevation={2} sx={{ mb: 4 }} className="settings-page__delete-section">
                <CardContent sx={{ p: 4 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
                        <Warning sx={{ mr: 2, color: '#EF476F' }} />
                        <Typography variant="h5" component="h2" fontWeight="bold" sx={{ color: '#EF476F' }}>
                            Delete Account
                        </Typography>
                    </Box>

                    <Alert className="settings-page__delete-warning-alert" severity="warning" icon={<Warning fontSize="small" />} sx={{ mb: 3 }}>
                        This action is permanent and cannot be undone.
                    </Alert>

                    <Button
                        className="settings-page__delete-button"
                        fullWidth
                        variant="outlined"
                        color="error"
                        startIcon={<Warning fontSize="small" />}
                        onClick={handleOpenDeleteDialog}
                        size="small"
                    >
                        Delete My Account
                    </Button>
                </CardContent>
            </Paper>

            {/* Success/Error Snackbars */}
            <Snackbar
                open={languageSuccess}
                autoHideDuration={3000}
                onClose={() => setLanguageSuccess(false)}
                message="Language preference updated successfully!"
            />
            <Snackbar
                open={!!languageError}
                autoHideDuration={5000}
                onClose={() => setLanguageError(null)}
                message={languageError}
            />
        </Container>
            </Box>

            {/* Delete Account Confirmation Dialog */}
            <Dialog
                className="settings-page__delete-dialog"
                open={deleteDialogOpen}
                onClose={handleCloseDeleteDialog}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle className="settings-page__dialog-title" sx={{ color: 'error.main', display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Warning className="settings-page__dialog-warning-icon" /> Delete Account
                </DialogTitle>
                <DialogContent className="settings-page__dialog-content">
                    <DialogContentText className="settings-page__dialog-content-text" sx={{ mb: 3 }}>
                        Are you sure you want to delete your account? This action is permanent and cannot be undone.
                    </DialogContentText>

                    {deleteError && (
                        <Alert className="settings-page__dialog-error-alert" severity="error" sx={{ mb: 2 }}>
                            {deleteError}
                        </Alert>
                    )}

                    <TextField
                        className="settings-page__dialog-password-field"
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
                <DialogActions className="settings-page__dialog-actions" sx={{ px: 3, pb: 2 }}>
                    <Button className="settings-page__dialog-cancel-button" onClick={handleCloseDeleteDialog} disabled={isDeleting} size="small">
                        Cancel
                    </Button>
                    <Button
                        className="settings-page__dialog-delete-button"
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
        </LeafPage>
    );
}

export default SettingsPage;
