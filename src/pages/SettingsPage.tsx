import React from 'react';
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
} from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import PaletteIcon from '@mui/icons-material/Palette';
import { useTheme } from '../contexts/ThemeContext';

function SettingsPage() {
    const { themeMode, setThemeMode, availableThemes } = useTheme();

    const handleThemeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setThemeMode(event.target.value as any);
    };

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

            {/* Future Settings Placeholder */}
            <Paper elevation={2} sx={{ mb: 4 }}>
                <CardContent sx={{ p: 4 }}>
                    <Typography variant="h5" component="h2" fontWeight="bold" sx={{ mb: 2 }}>
                        More Settings Coming Soon
                    </Typography>
                    <Divider sx={{ mb: 3 }} />
                    <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
                        We're working on adding more customization options to enhance your learning experience:
                    </Typography>
                    <Box component="ul" sx={{ pl: 3, color: 'text.secondary' }}>
                        <Typography component="li" variant="body2" sx={{ mb: 1 }}>
                            Study session preferences and timing
                        </Typography>
                        <Typography component="li" variant="body2" sx={{ mb: 1 }}>
                            Notification settings for study reminders
                        </Typography>
                        <Typography component="li" variant="body2" sx={{ mb: 1 }}>
                            Language learning goals and progress tracking
                        </Typography>
                        <Typography component="li" variant="body2" sx={{ mb: 1 }}>
                            Export and import options for vocabulary data
                        </Typography>
                        <Typography component="li" variant="body2">
                            Accessibility and display preferences
                        </Typography>
                    </Box>
                </CardContent>
            </Paper>
        </Container>
    );
}

export default SettingsPage;
