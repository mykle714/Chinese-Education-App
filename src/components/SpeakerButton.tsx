import React from "react";
import { Box, CircularProgress, IconButton, useTheme } from "@mui/material";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";

interface SpeakerButtonProps {
    onClick: () => void;
    // When true, render a thin spinning ring around the speaker icon to
    // indicate the audio request is in flight or playing. The parent owns the
    // computation (typically `tts.speakingKey === thisButtonsText`) so only
    // the clicked button spins when multiple buttons are visible at once.
    isLoading?: boolean;
}

/**
 * Speaker icon button used across the flashcards/dictionary UI. Stops pointer
 * event propagation so taps don't bubble up to enclosing flip/drag handlers.
 *
 * When `isLoading` is true, an MUI CircularProgress is overlaid around the
 * icon at the same visual size as the IconButton's hit target.
 */
export const SpeakerButton: React.FC<SpeakerButtonProps> = ({ onClick, isLoading }) => {
    const theme = useTheme();
    const stop = (e: React.SyntheticEvent) => {
        e.stopPropagation();
    };
    return (
        <Box
            className="speaker-button-wrapper"
            sx={{ position: "relative", display: "inline-flex" }}
        >
            <IconButton
                className="flashcard-speaker-button"
                size="small"
                onClick={(e) => { stop(e); onClick(); }}
                onMouseDown={stop}
                onTouchStart={stop}
                onTouchEnd={stop}
                aria-label="Play narration"
                sx={{
                    color: theme.palette.flashcard.textSecondary,
                    '&:hover': { color: theme.palette.flashcard.onSurface },
                }}
            >
                <VolumeUpIcon fontSize="small" />
            </IconButton>
            {isLoading && (
                // Sized to ring the IconButton (small = 32px hit target).
                // pointerEvents:none keeps the underlying button clickable
                // (so a rapid retap can cancel + restart playback).
                <CircularProgress
                    className="speaker-button-spinner"
                    size={32}
                    thickness={3}
                    sx={{
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        marginTop: "-16px",
                        marginLeft: "-16px",
                        color: theme.palette.flashcard.onSurface,
                        pointerEvents: "none",
                    }}
                />
            )}
        </Box>
    );
};

export default SpeakerButton;
