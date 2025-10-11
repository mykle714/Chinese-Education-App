import { Box, Typography } from "@mui/material";
import { Article as ArticleIcon } from "@mui/icons-material";

interface EmptyStateProps {
    isMobile: boolean;
}

function EmptyState({ isMobile }: EmptyStateProps) {
    return (
        <Box
            className="reader-page-empty-state"
            sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '60vh',
                textAlign: 'center'
            }}
        >
            <ArticleIcon
                className="reader-page-empty-state-icon"
                sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }}
            />
            <Typography
                className="reader-page-empty-state-title"
                variant="h5"
                color="text.secondary"
                sx={{ mb: 1 }}
            >
                Select a text to begin reading
            </Typography>
            <Typography
                className="reader-page-empty-state-description"
                variant="body1"
                color="text.secondary"
            >
                Choose an article from the sidebar to start reading
            </Typography>
            {isMobile && (
                <Typography
                    className="reader-page-empty-state-mobile-hint"
                    variant="body2"
                    color="text.secondary"
                    sx={{ mt: 2 }}
                >
                    Tap the button in the bottom right to view the text list
                </Typography>
            )}
        </Box>
    );
}

export default EmptyState;
