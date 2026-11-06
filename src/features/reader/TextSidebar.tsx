import { useState } from "react";
import { Box, Typography, List, ListItem, ListItemButton, Alert, Button } from "@mui/material";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import { Article as ArticleIcon, Add as AddIcon, Person as PersonIcon } from "@mui/icons-material";
import SwipeToDeleteRow from "./SwipeToDeleteRow";
import type { Text } from "../../types";
import { SIZE , WEIGHT} from "../../theme/scale";
import { COLORS } from "../../theme/colors";

interface TextSidebarProps {
    texts: Text[];
    loading: boolean;
    error: string | null;
    // A failed swipe-delete, shown above the list (the list itself stays).
    actionError: string | null;
    onDismissActionError: () => void;
    onTextSelect: (text: Text) => void;
    onCreateNew: () => void;
    // Swipe-left → Delete. Deletes immediately (iPhone style, no confirmation).
    onDelete: (text: Text) => void;
    drawerWidth: number;
}

function TextSidebar({
    texts,
    loading,
    error,
    actionError,
    onDismissActionError,
    onTextSelect,
    onCreateNew,
    onDelete,
    drawerWidth
}: TextSidebarProps) {
    // At most one row is swiped open at a time; opening another closes this one.
    const [openRowId, setOpenRowId] = useState<string | null>(null);
    return (
        <Box
            className="reader-page-sidebar-content"
            sx={{ width: drawerWidth, height: '100%', display: 'flex', flexDirection: 'column' }}
        >
            {/* Header */}
            <Box
                className="reader-page-sidebar-header"
                sx={{ p: 2, borderBottom: `1px solid ${COLORS.rowBorder}` }}
            >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography
                        className="reader-page-sidebar-title"
                        variant="h6"
                        sx={{ fontWeight: WEIGHT.bold, display: 'flex', alignItems: 'center', gap: 1 }}
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
                    <DelayedCircularProgress className="reader-page-sidebar-loading-spinner" size={24} />
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

            {/* Delete failure (the row is restored by ReaderPage). */}
            {actionError && (
                <Box className="reader-page-sidebar-action-error" sx={{ px: 2, pt: 2 }}>
                    <Alert className="reader-page-sidebar-action-error-alert" severity="error" onClose={onDismissActionError}>
                        {actionError}
                    </Alert>
                </Box>
            )}

            {/* Texts list — each user document is a SwipeToDeleteRow (swipe left →
            Delete). No per-row edit: content is edited inside the open document. */}
            {!loading && !error && (
                <List
                    className="reader-page-sidebar-texts-list"
                    sx={{ flexGrow: 1, overflow: 'auto', p: 1 }}
                >
                    {texts.map((text) => {
                        const rowButton = (
                            <ListItemButton
                                className="reader-page-sidebar-text-button"
                                onClick={() => onTextSelect(text)}
                                sx={{
                                    borderRadius: 2,
                                    p: 2,
                                    '&:hover': { backgroundColor: 'action.hover' },
                                }}
                            >
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, width: '100%' }}>
                                    {text.isUserCreated && (
                                        <PersonIcon
                                            className="reader-page-sidebar-text-owner-icon"
                                            sx={{ fontSize: SIZE.bodyLg, color: COLORS.iconColor }}
                                        />
                                    )}
                                    <Typography
                                        className="reader-page-sidebar-text-title"
                                        variant="subtitle2"
                                        sx={{ fontWeight: WEIGHT.bold, color: 'text.primary', flex: 1 }}
                                    >
                                        {text.title}
                                    </Typography>
                                </Box>
                            </ListItemButton>
                        );
                        return (
                            <ListItem
                                className="reader-page-sidebar-text-item"
                                key={text.id}
                                disablePadding
                                sx={{ mb: 1, display: 'block' }}
                            >
                                {text.isUserCreated ? (
                                    <SwipeToDeleteRow
                                        open={openRowId === text.id}
                                        onOpenChange={(isOpen) => setOpenRowId(isOpen ? text.id : null)}
                                        onDelete={() => {
                                            setOpenRowId(null);
                                            onDelete(text);
                                        }}
                                    >
                                        {rowButton}
                                    </SwipeToDeleteRow>
                                ) : rowButton}
                            </ListItem>
                        );
                    })}
                </List>
            )}
        </Box>
    );
}

export default TextSidebar;
