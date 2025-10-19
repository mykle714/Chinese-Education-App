import { Box, Typography, List, ListItem, ListItemButton, CircularProgress, Alert, Chip, IconButton, Button, Tooltip } from "@mui/material";
import { Article as ArticleIcon, Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon, Person as PersonIcon } from "@mui/icons-material";
import type { Text } from "../types";

interface TextSidebarProps {
    texts: Text[];
    selectedText: Text | null;
    loading: boolean;
    error: string | null;
    onTextSelect: (text: Text) => void;
    onCreateNew: () => void;
    onEdit: (text: Text) => void;
    onDelete: (text: Text) => void;
    formatDate: (dateString: string) => string;
    drawerWidth: number;
}

function TextSidebar({
    texts,
    selectedText,
    loading,
    error,
    onTextSelect,
    onCreateNew,
    onEdit,
    onDelete,
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
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography
                        className="reader-page-sidebar-title"
                        variant="h6"
                        sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}
                    >
                        <ArticleIcon className="reader-page-sidebar-title-icon" />
                        Reading Materials
                    </Typography>
                </Box>
                <Typography
                    className="reader-page-sidebar-subtitle"
                    variant="body2"
                    color="text.secondary"
                    sx={{ mb: 1.5 }}
                >
                    Select a text to begin reading
                </Typography>
                <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={onCreateNew}
                    fullWidth
                    size="small"
                    sx={{ textTransform: 'none' }}
                >
                    New Document
                </Button>
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
                            secondaryAction={
                                text.isUserCreated && (
                                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                                        <Tooltip title="Edit">
                                            <IconButton
                                                size="small"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onEdit(text);
                                                }}
                                                sx={{
                                                    color: selectedText?.id === text.id ? 'white' : 'text.secondary',
                                                    '&:hover': {
                                                        backgroundColor: selectedText?.id === text.id ? 'rgba(255,255,255,0.2)' : undefined
                                                    }
                                                }}
                                            >
                                                <EditIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title="Delete">
                                            <IconButton
                                                size="small"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onDelete(text);
                                                }}
                                                sx={{
                                                    color: selectedText?.id === text.id ? 'white' : 'text.secondary',
                                                    '&:hover': {
                                                        backgroundColor: selectedText?.id === text.id ? 'rgba(255,255,255,0.2)' : undefined
                                                    }
                                                }}
                                            >
                                                <DeleteIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                    </Box>
                                )
                            }
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
                                    pr: text.isUserCreated ? 7 : 2, // Extra padding for action buttons
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
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5, width: '100%' }}>
                                    {text.isUserCreated && (
                                        <Tooltip title="Your Document">
                                            <PersonIcon
                                                sx={{
                                                    fontSize: 16,
                                                    color: selectedText?.id === text.id ? 'rgba(255,255,255,0.8)' : 'primary.main'
                                                }}
                                            />
                                        </Tooltip>
                                    )}
                                    <Typography
                                        className="reader-page-sidebar-text-title"
                                        variant="subtitle2"
                                        sx={{
                                            fontWeight: 'bold',
                                            color: selectedText?.id === text.id ? 'white' : 'text.primary',
                                            flex: 1
                                        }}
                                    >
                                        {text.title}
                                    </Typography>
                                </Box>
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
