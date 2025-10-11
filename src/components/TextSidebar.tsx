import { Box, Typography, List, ListItem, ListItemButton, CircularProgress, Alert, Chip } from "@mui/material";
import { Article as ArticleIcon } from "@mui/icons-material";

// Text interface for TypeScript
interface Text {
    id: string;
    title: string;
    description: string;
    content: string;
    createdAt: string;
    characterCount: number;
}

interface TextSidebarProps {
    texts: Text[];
    selectedText: Text | null;
    loading: boolean;
    error: string | null;
    onTextSelect: (text: Text) => void;
    formatDate: (dateString: string) => string;
    drawerWidth: number;
}

function TextSidebar({
    texts,
    selectedText,
    loading,
    error,
    onTextSelect,
    formatDate,
    drawerWidth
}: TextSidebarProps) {
    return (
        <Box
            className="reader-page-sidebar-content"
            sx={{ width: drawerWidth, height: '100%', display: 'flex', flexDirection: 'column' }}
        >
            {/* Header */}
            <Box
                className="reader-page-sidebar-header"
                sx={{ p: 2, borderBottom: '1px solid rgba(0, 0, 0, 0.08)' }}
            >
                <Typography
                    className="reader-page-sidebar-title"
                    variant="h6"
                    sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}
                >
                    <ArticleIcon className="reader-page-sidebar-title-icon" />
                    Reading Materials
                </Typography>
                <Typography
                    className="reader-page-sidebar-subtitle"
                    variant="body2"
                    color="text.secondary"
                >
                    Select a text to begin reading
                </Typography>
            </Box>

            {/* Loading state */}
            {loading && (
                <Box
                    className="reader-page-sidebar-loading"
                    sx={{ display: 'flex', justifyContent: 'center', p: 3 }}
                >
                    <CircularProgress className="reader-page-sidebar-loading-spinner" size={24} />
                </Box>
            )}

            {/* Error state */}
            {error && (
                <Box className="reader-page-sidebar-error" sx={{ p: 2 }}>
                    <Alert className="reader-page-sidebar-error-alert" severity="error">
                        {error}
                    </Alert>
                </Box>
            )}

            {/* Texts list */}
            {!loading && !error && (
                <List
                    className="reader-page-sidebar-texts-list"
                    sx={{ flexGrow: 1, overflow: 'auto', p: 1 }}
                >
                    {texts.map((text) => (
                        <ListItem
                            className="reader-page-sidebar-text-item"
                            key={text.id}
                            disablePadding
                            sx={{ mb: 1 }}
                        >
                            <ListItemButton
                                className="reader-page-sidebar-text-button"
                                onClick={() => onTextSelect(text)}
                                selected={selectedText?.id === text.id}
                                sx={{
                                    borderRadius: 2,
                                    flexDirection: 'column',
                                    alignItems: 'flex-start',
                                    p: 2,
                                    '&.Mui-selected': {
                                        backgroundColor: 'primary.main',
                                        color: 'white',
                                        '&:hover': {
                                            backgroundColor: 'primary.dark',
                                        },
                                    },
                                    '&:hover': {
                                        backgroundColor: 'action.hover',
                                    },
                                }}
                            >
                                <Typography
                                    className="reader-page-sidebar-text-title"
                                    variant="subtitle2"
                                    sx={{
                                        fontWeight: 'bold',
                                        mb: 0.5,
                                        color: selectedText?.id === text.id ? 'white' : 'text.primary'
                                    }}
                                >
                                    {text.title}
                                </Typography>
                                <Typography
                                    className="reader-page-sidebar-text-description"
                                    variant="body2"
                                    sx={{
                                        mb: 1,
                                        color: selectedText?.id === text.id ? 'rgba(255,255,255,0.8)' : 'text.secondary',
                                        fontSize: '0.875rem'
                                    }}
                                >
                                    {text.description}
                                </Typography>
                                <Box
                                    className="reader-page-sidebar-text-metadata"
                                    sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}
                                >
                                    <Chip
                                        className="reader-page-sidebar-text-char-count"
                                        label={`${text.characterCount} chars`}
                                        size="small"
                                        variant={selectedText?.id === text.id ? "filled" : "outlined"}
                                        sx={{
                                            fontSize: '0.75rem',
                                            height: 20,
                                            color: selectedText?.id === text.id ? 'white' : 'text.secondary',
                                            borderColor: selectedText?.id === text.id ? 'rgba(255,255,255,0.5)' : undefined,
                                            backgroundColor: selectedText?.id === text.id ? 'rgba(255,255,255,0.2)' : undefined
                                        }}
                                    />
                                    <Typography
                                        className="reader-page-sidebar-text-date"
                                        variant="caption"
                                        sx={{
                                            color: selectedText?.id === text.id ? 'rgba(255,255,255,0.7)' : 'text.secondary'
                                        }}
                                    >
                                        {formatDate(text.createdAt)}
                                    </Typography>
                                </Box>
                            </ListItemButton>
                        </ListItem>
                    ))}
                </List>
            )}
        </Box>
    );
}

export default TextSidebar;
