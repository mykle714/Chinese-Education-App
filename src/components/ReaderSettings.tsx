import { Box, Typography, FormControlLabel, Checkbox, IconButton } from "@mui/material";
import { Settings as SettingsIcon, ChevronRight as ChevronRightIcon } from "@mui/icons-material";

interface ReaderSettingsProps {
    autoSelectEnabled: boolean;
    onAutoSelectChange: (enabled: boolean) => void;
    settingsOpen: boolean;
    onSettingsToggle: () => void;
}

function ReaderSettings({
    autoSelectEnabled,
    onAutoSelectChange,
    settingsOpen,
    onSettingsToggle
}: ReaderSettingsProps) {
    if (!settingsOpen) return null;

    return (
        <Box>
            {/* Header */}
            <Box
                className="reader-page-settings-header"
                sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}
            >
                <Box className="reader-page-settings-header-title-wrapper">
                    <Typography
                        className="reader-page-settings-title"
                        variant="h6"
                        sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}
                    >
                        <SettingsIcon className="reader-page-settings-title-icon" fontSize="small" />
                        Settings
                    </Typography>
                </Box>
                <IconButton
                    className="reader-page-settings-close-button"
                    onClick={onSettingsToggle}
                    size="small"
                    sx={{ color: 'text.secondary' }}
                >
                    <ChevronRightIcon className="reader-page-settings-close-icon" />
                </IconButton>
            </Box>

            {/* Settings content */}
            <Box className="reader-page-settings-content">
                <Typography
                    className="reader-page-settings-section-title"
                    variant="subtitle2"
                    sx={{ mb: 2, fontWeight: 'medium', color: 'text.primary' }}
                >
                    Text Selection
                </Typography>

                <FormControlLabel
                    className="reader-page-auto-select-control"
                    control={
                        <Checkbox
                            className="reader-page-auto-select-checkbox"
                            checked={autoSelectEnabled}
                            onChange={(e) => onAutoSelectChange(e.target.checked)}
                            size="small"
                            color="primary"
                        />
                    }
                    label={
                        <Box className="reader-page-auto-select-label">
                            <Typography
                                className="reader-page-auto-select-label-title"
                                variant="body2"
                                sx={{ fontWeight: 'medium' }}
                            >
                                Auto-select words
                            </Typography>
                            <Typography
                                className="reader-page-auto-select-label-description"
                                variant="caption"
                                color="text.secondary"
                            >
                                Automatically select words when clicking in text
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

export default ReaderSettings;
