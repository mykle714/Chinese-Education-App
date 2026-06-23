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
} from '@mui/material';
import PaletteIcon from '@mui/icons-material/Palette';
import LanguageIcon from '@mui/icons-material/Language';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import { useTheme, type ThemeMode } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import type { Language } from '../types';
import { usePageTitle } from '../hooks/usePageTitle';
import { useTTSSettings } from '../hooks/useTTSSettings';

function SettingsPage() {
    usePageTitle("Settings");
    const navigate = useNavigate();
    const { themeMode, setThemeMode, availableThemes } = useTheme();
    const { user, updateLanguage } = useAuth();
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
        </LeafPage>
    );
}

export default SettingsPage;
