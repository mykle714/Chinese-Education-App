import React, { useState } from 'react';
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
    Divider,
    Alert,
    Chip,
    Snackbar,
} from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import PaletteIcon from '@mui/icons-material/Palette';
import LanguageIcon from '@mui/icons-material/Language';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { LANGUAGE_NAMES } from '../types';
import type { Language } from '../types';

function SettingsPage() {
    const { themeMode, setThemeMode, availableThemes } = useTheme();
    const { user, updateLanguage } = useAuth();
    const [languageSuccess, setLanguageSuccess] = useState(false);
    const [languageError, setLanguageError] = useState<string | null>(null);

    const handleThemeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setThemeMode(event.target.value as any);
    };

    const handleLanguageChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const newLanguage = event.target.value as Language;
        try {
            await updateLanguage(newLanguage);
            setLanguageSuccess(true);
            setLanguageError(null);
        } catch (error: any) {
            setLanguageError(error.message || 'Failed to update language preference');
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
            value: 'ja',
            label: 'Japanese',
            description: 'Study kanji, hiragana, and katakana with romaji transliteration'
        },
        {
            value: 'ko',
            label: 'Korean',
            description: 'Master Hangul script and Korean vocabulary with 117k+ entries'
        },
        {
            value: 'vi',
            label: 'Vietnamese',
            description: 'Learn Vietnamese with tone markers and 42k+ dictionary entries'
        },
    ];

    return (
        <Container maxWidth="md" sx={{ py: 4 }}>
            {/* Page Header */}
            <Box sx={{ mb: 4, textAlign: 'center' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 2 }}>
                    <SettingsIcon sx={{ fontSize: 40, mr: 2, color: 'primary.main' }} />
                    <Typography variant="h3" component="h1" fontWeight="bold">
                        Settings
                    </Typography>
                </Box>
                <Typography variant="h6" color="text.secondary">
                    Customize your vocabulary learning experience
                </Typography>
            </Box>

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
                        <FormLabel component="legend" sx={{ mb: 2, fontWeight: 'bold' }}>
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
                        <FormLabel component="legend" sx={{ mb: 2, fontWeight: 'bold' }}>
                            Available Languages
                        </FormLabel>
                        <RadioGroup
                            value={user?.selectedLanguage || 'zh'}
                            onChange={handleLanguageChange}
                            sx={{ gap: 2 }}
                        >
                            {availableLanguages.map((lang) => {
                                const isAvailable = lang.value === 'zh' || lang.value === 'ja' || lang.value === 'ko' || lang.value === 'vi';
                                const isActive = user?.selectedLanguage === lang.value;

                                return (
                                    <Card
                                        key={lang.value}
                                        variant="outlined"
                                        sx={{
                                            transition: 'all 0.2s ease-in-out',
                                            cursor: isAvailable ? 'pointer' : 'not-allowed',
                                            border: isActive ? 2 : 1,
                                            borderColor: isActive ? 'primary.main' : 'divider',
                                            backgroundColor: isActive ? 'action.selected' : 'background.paper',
                                            opacity: isAvailable ? 1 : 0.5,
                                            '&:hover': isAvailable ? {
                                                borderColor: 'primary.main',
                                                backgroundColor: 'action.hover',
                                            } : {},
                                        }}
                                        onClick={() => isAvailable && handleLanguageChange({ target: { value: lang.value } } as any)}
                                    >
                                        <CardContent sx={{ py: 2 }}>
                                            <FormControlLabel
                                                value={lang.value}
                                                control={<Radio disabled={!isAvailable} />}
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
                                                            {!isAvailable && (
                                                                <Chip
                                                                    label="Coming Soon"
                                                                    size="small"
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
                            Currently available: Chinese (124k entries), Japanese (173k entries), Korean (117k entries), and Vietnamese (42k entries)!
                        </Typography>
                    </Alert>
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
    );
}

export default SettingsPage;
