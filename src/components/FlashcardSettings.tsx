import { Box, Typography, FormControlLabel, Checkbox, IconButton } from "@mui/material";
import { Settings as SettingsIcon, ChevronRight as ChevronRightIcon } from "@mui/icons-material";

interface FlashcardSettingsProps {
    showPronunciation: boolean;
    onShowPronunciationChange: (enabled: boolean) => void;
    settingsOpen: boolean;
    onSettingsToggle: () => void;
}

function FlashcardSettings({
    showPronunciation,
    onShowPronunciationChange,
    settingsOpen,
    onSettingsToggle
}: FlashcardSettingsProps) {
    if (!settingsOpen) return null;

    return (
        <Box>
            {/* Header */}
            <Box
                className="flashcards-page-settings-header"
                sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}
            >
                <Box className="flashcards-page-settings-header-title-wrapper">
                    <Typography
                        className="flashcards-page-settings-title"
                        variant="h6"
                        sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}
                    >
                        <SettingsIcon className="flashcards-page-settings-title-icon" fontSize="small" />
                        Settings
                    </Typography>
                </Box>
                <IconButton
                    className="flashcards-page-settings-close-button"
                    onClick={onSettingsToggle}
                    size="small"
                    sx={{ color: 'text.secondary' }}
                >
                    <ChevronRightIcon className="flashcards-page-settings-close-icon" />
                </IconButton>
            </Box>

            {/* Settings content */}
            <Box className="flashcards-page-settings-content">
                <Typography
                    className="flashcards-page-settings-section-title"
                    variant="subtitle2"
                    sx={{ mb: 2, fontWeight: 'medium', color: 'text.primary' }}
                >
                    Card Display
                </Typography>

                <FormControlLabel
                    className="flashcards-page-show-pronunciation-control"
                    control={
                        <Checkbox
                            className="flashcards-page-show-pronunciation-checkbox"
                            checked={showPronunciation}
                            onChange={(e) => onShowPronunciationChange(e.target.checked)}
                            size="small"
                            color="primary"
                        />
                    }
                    label={
                        <Box className="flashcards-page-show-pronunciation-label">
                            <Typography
                                className="flashcards-page-show-pronunciation-label-title"
                                variant="body2"
                                sx={{ fontWeight: 'medium' }}
                            >
                                Show pronunciation
                            </Typography>
                            <Typography
                                className="flashcards-page-show-pronunciation-label-description"
                                variant="caption"
                                color="text.secondary"
                            >
                                Display pronunciation (pinyin/romaji/etc.) on the front of cards
                            </Typography>
                        </Box>
                    }
                    sx={{
                        alignItems: 'flex-start',
                        mb: 3,
                        ml: 0,
                        '& .MuiFormControlLabel-label': {
                            ml: 1
                        }
                    }}
                />
            </Box>
        </Box>
    );
}

export default FlashcardSettings;
