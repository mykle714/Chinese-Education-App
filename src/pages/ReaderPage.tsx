import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
    Box,
    useTheme,
    IconButton,
    Snackbar,
    Alert
} from "@mui/material";
import {
    Settings as SettingsIcon,
    TouchApp as TouchAppIcon
} from "@mui/icons-material";
import LeafPage from "../components/LeafPage";
import MinutePointsFireBadge from "../minutePoints/MinutePointsFireBadge";
import { useAuth } from "../AuthContext";
import { useTheme as useCustomTheme } from "../contexts/ThemeContext";
import { API_BASE_URL } from "../constants";
import VocabDisplayCard from "../components/VocabDisplayCard";
import { useVocabularyUpdate } from "../contexts/VocabularyUpdateContext";
import { processDocumentForTokens } from "../utils/tokenUtils";
import type { VocabEntry, Text } from "../types";

// Extracted components
import EmptyState from "../components/EmptyState";
import TextHeader from "../components/TextHeader";
import TextSidebar from "../components/TextSidebar";
import TextArea from "../components/TextArea";
import ReaderSettings from "../components/ReaderSettings";
import CreateDocumentDialog from "../components/CreateDocumentDialog";
import EditDocumentDialog from "../components/EditDocumentDialog";
import DeleteDocumentDialog from "../components/DeleteDocumentDialog";

// Extracted hooks
import { useVocabularyProcessing } from "../hooks/useVocabularyProcessing";
import { useTextSelection } from "../hooks/useTextSelection";
import { useReaderSettings } from "../hooks/useReaderSettings";
import { usePageTitle } from "../hooks/usePageTitle";

function ReaderPage() {
    usePageTitle("Reader");
    const navigate = useNavigate();
    const theme = useTheme();
    const customTheme = useCustomTheme();
    // Reader is always rendered in its mobile layout regardless of viewport
    // width — the desktop sidebar/settings layout has been retired.
    const isMobile = true;
    const { token, user, isAuthenticated } = useAuth();
    const vocabularyUpdate = useVocabularyUpdate();

    // State management
    const [texts, setTexts] = useState<Text[]>([]);
    const [selectedText, setSelectedText] = useState<Text | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Dialog states
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [textToEdit, setTextToEdit] = useState<Text | null>(null);
    const [textToDelete, setTextToDelete] = useState<Text | null>(null);

    // One-off tap-to-navigate hint, shown as a toast when a document is opened
    // on mobile (the tap gesture from ReaderTapOverlay only exists there).
    const [tapHintOpen, setTapHintOpen] = useState(false);

    // Use extracted hooks
    const vocabularyProcessing = useVocabularyProcessing(token);
    const readerSettings = useReaderSettings();
    const textSelection = useTextSelection(
        vocabularyProcessing.loadedPersonalCards,
        vocabularyProcessing.loadedDictionaryCards,
        readerSettings.autoSelectEnabled
    );

    // Text selection handlers (activity detection is handled globally by useActivityDetection in useMinutePoints)
    const handleTextChangeWithActivity = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        textSelection.handleTextChange(event);
    }, [textSelection]);

    const handleAutoWordSelectWithActivity = useCallback((event: React.SyntheticEvent<HTMLDivElement>) => {
        textSelection.handleAutoWordSelect(event);
    }, [textSelection]);

    const handleTextSelectionChangeWithActivity = useCallback((event: React.SyntheticEvent<HTMLDivElement>) => {
        textSelection.handleTextSelectionChange(event);
    }, [textSelection]);

    // Get theme-based selection colors (memoized to prevent recalculation)
    const selectionColors = useMemo(() => {
        switch (customTheme.themeMode) {
            case 'dark':
                return {
                    backgroundColor: theme.palette.primary.main + '40', // 25% opacity
                };
            case 'blue':
                return {
                    backgroundColor: theme.palette.primary.main + '30', // ~19% opacity
                };
            case 'green':
                return {
                    backgroundColor: theme.palette.primary.main + '30', // ~19% opacity
                };
            case 'light':
            default:
                return {
                    backgroundColor: theme.palette.primary.main + '30', // ~19% opacity
                };
        }
    }, [customTheme.themeMode, theme.palette.primary.main]);

    // Lock the document while the Reader is mounted so the page itself can't
    // scroll or rubber-band. The reader container is already height-locked, but
    // the app shell renders body as a normal scroll container (overflow:auto +
    // min-height:100vh). On mobile the dynamic URL bar makes the body taller than
    // the visible area, so a touch-drag anywhere — including outside the text box —
    // pans the whole page. Pinning overflow:hidden + overscroll-behavior:none on
    // html/body confines scrolling to the inner textarea. Restored on unmount.
    useEffect(() => {
        const html = document.documentElement;
        const body = document.body;
        const prev = {
            htmlOverflow: html.style.overflow,
            htmlOverscroll: html.style.overscrollBehavior,
            bodyOverflow: body.style.overflow,
            bodyOverscroll: body.style.overscrollBehavior,
        };
        html.style.overflow = 'hidden';
        html.style.overscrollBehavior = 'none';
        body.style.overflow = 'hidden';
        body.style.overscrollBehavior = 'none';
        return () => {
            html.style.overflow = prev.htmlOverflow;
            html.style.overscrollBehavior = prev.htmlOverscroll;
            body.style.overflow = prev.bodyOverflow;
            body.style.overscrollBehavior = prev.bodyOverscroll;
        };
    }, []);

    // Drawer width consistent with main navigation
    const drawerWidth = 250;
    const settingsWidth = 200;

    // Fetch texts from API (with fallback sample data for testing)
    useEffect(() => {
        const fetchTexts = async () => {
            try {
                setLoading(true);
                const response = await fetch(`${API_BASE_URL}/api/texts`, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                    },
                    credentials: 'include',
                });

                if (!response.ok) {
                    throw new Error('Failed to fetch texts');
                }

                const textsData = await response.json();
                setTexts(textsData);
            } catch (err) {
                console.error('Error fetching texts:', err);
                setTexts([]);
                setError('Failed to load texts. Please try again later.');
            } finally {
                setLoading(false);
            }
        };

        if (token) {
            fetchTexts();
        }
    }, [token]);

    // Set up vocabulary update listeners
    useEffect(() => {
        if (!selectedText) return;

        // Get current document tokens for filtering
        const documentTokens = processDocumentForTokens(selectedText.content);

        // Helper function to check if entry is relevant to current document
        const isEntryRelevantToDocument = (entry: VocabEntry): boolean => {
            return documentTokens.includes(entry.entryKey);
        };

        // Add entry listener
        const unsubscribeAdd = vocabularyUpdate.onVocabAdd((entry: VocabEntry) => {
            if (isEntryRelevantToDocument(entry)) {
                console.log('[READER-VOCAB-UPDATE] Adding entry to loadedPersonalCards:', entry.entryKey);
                vocabularyProcessing.setLoadedPersonalCards(prev => {
                    // Check if entry already exists
                    const exists = prev.some(existing => existing.id === entry.id);
                    if (exists) return prev;
                    return [...prev, entry];
                });
            }
        });

        // Update entry listener
        const unsubscribeUpdate = vocabularyUpdate.onVocabUpdate((entry: VocabEntry) => {
            vocabularyProcessing.setLoadedPersonalCards(prev => {
                const index = prev.findIndex(existing => existing.id === entry.id);
                if (index === -1) {
                    // Entry not in loadedPersonalCards, check if it should be added
                    if (isEntryRelevantToDocument(entry)) {
                        console.log('[READER-VOCAB-UPDATE] Adding updated entry to loadedPersonalCards:', entry.entryKey);
                        return [...prev, entry];
                    }
                    return prev;
                }

                // Entry exists, update it
                console.log('[READER-VOCAB-UPDATE] Updating entry in loadedPersonalCards:', entry.entryKey);
                const updated = [...prev];
                updated[index] = entry;

                // Clear selectedPersonalCard if it's the updated entry
                if (textSelection.selectedPersonalCard && textSelection.selectedPersonalCard.id === entry.id) {
                    textSelection.setSelectedPersonalCard(entry);
                }

                return updated;
            });
        });

        // Remove entry listener
        const unsubscribeRemove = vocabularyUpdate.onVocabRemove((entryId: number) => {
            vocabularyProcessing.setLoadedPersonalCards(prev => {
                const filtered = prev.filter(entry => entry.id !== entryId);
                if (filtered.length !== prev.length) {
                    console.log('[READER-VOCAB-UPDATE] Removing entry from loadedPersonalCards:', entryId);
                }
                return filtered;
            });

            // Clear selectedPersonalCard if it's the deleted entry
            if (textSelection.selectedPersonalCard && textSelection.selectedPersonalCard.id === entryId) {
                textSelection.setSelectedPersonalCard(null);
            }
        });

        // Bulk add entries listener (for CSV imports)
        const unsubscribeBulkAdd = vocabularyUpdate.onVocabBulkAdd((entries: VocabEntry[]) => {
            const relevantEntries = entries.filter(isEntryRelevantToDocument);
            if (relevantEntries.length > 0) {
                console.log('[READER-VOCAB-UPDATE] Bulk adding entries to loadedPersonalCards:', relevantEntries.length);
                vocabularyProcessing.setLoadedPersonalCards(prev => {
                    const existingIds = new Set(prev.map(entry => entry.id));
                    const newEntries = relevantEntries.filter(entry => !existingIds.has(entry.id));
                    return [...prev, ...newEntries];
                });
            }
        });

        // Cleanup listeners on unmount or when selectedText changes
        return () => {
            unsubscribeAdd();
            unsubscribeUpdate();
            unsubscribeRemove();
            unsubscribeBulkAdd();
        };
    }, [selectedText, vocabularyUpdate, textSelection.selectedPersonalCard, vocabularyProcessing, textSelection]);

    // Handle text selection
    const handleTextSelect = useCallback(async (text: Text) => {
        setSelectedText(text);

        // Process vocabulary for the selected document
        await vocabularyProcessing.processDocumentVocabulary(text);
    }, [vocabularyProcessing]);

    const handleBackToList = useCallback(() => {
        setSelectedText(null);
    }, []);

    // Focus the reading box whenever a document is opened so it's immediately
    // ready for word navigation/selection, and auto-highlight the first word.
    // A new document starts with the caret at the top (restoreSelection=false).
    // The textarea is committed before this effect runs, so inputRef is populated.
    // After this, handleTextAreaBlur keeps focus pinned to the box.
    //
    // Keyed on the document id only: focusTextArea's identity changes with the
    // auto-select toggle, but we must NOT re-run (and reset the caret to the top)
    // on every toggle — only when a different document is opened.
    const focusTextArea = textSelection.focusTextArea;
    useEffect(() => {
        if (selectedText) {
            focusTextArea(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedText?.id]);

    // Surface the tap-to-navigate hint as a toast each time a document is opened
    // on mobile. Keyed on the document id so re-opening shows it again.
    useEffect(() => {
        setTapHintOpen(!!selectedText && isMobile);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedText?.id, isMobile]);

    // Return focus + re-highlight when a dialog closes. The blur that fired when
    // the dialog opened was deliberately ignored (handleTextAreaBlur skips while a
    // modal is open), so nothing would otherwise refocus the reading box. We watch
    // the open->closed transition and restore focus, preserving the user's place
    // (restoreSelection=true). If MUI restores focus to the edit button on the
    // dialog's exit transition, handleTextAreaBlur bounces it back here anyway.
    const anyDialogOpen = createDialogOpen || editDialogOpen || deleteDialogOpen;
    const prevAnyDialogOpenRef = useRef(anyDialogOpen);
    useEffect(() => {
        if (prevAnyDialogOpenRef.current && !anyDialogOpen && selectedText) {
            focusTextArea(true);
        }
        prevAnyDialogOpenRef.current = anyDialogOpen;
    }, [anyDialogOpen, selectedText, focusTextArea]);

    // Format date for display
    const formatDate = useCallback((dateString: string) => {
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }, []);

    // Dialog handlers
    const handleCreateNew = useCallback(() => {
        setCreateDialogOpen(true);
    }, []);

    const handleEdit = useCallback((text: Text) => {
        setTextToEdit(text);
        setEditDialogOpen(true);
    }, []);

    const handleDelete = useCallback((text: Text) => {
        setTextToDelete(text);
        setDeleteDialogOpen(true);
    }, []);

    const handleDialogSuccess = useCallback(async () => {
        // Reload texts after create/edit/delete
        try {
            const response = await fetch(`${API_BASE_URL}/api/texts`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                },
                credentials: 'include',
            });

            if (response.ok) {
                const textsData = await response.json();
                setTexts(textsData);

                // If there's a selected text, update it with the fresh data and reprocess vocabulary incrementally
                if (selectedText) {
                    const updatedText = textsData.find((t: Text) => t.id === selectedText.id);
                    if (updatedText) {
                        // Use incremental processing: only fetch vocabulary for newly added tokens
                        // This handles documents with >1000 tokens by processing only the diff
                        await vocabularyProcessing.processDocumentVocabularyIncremental(selectedText, updatedText);

                        // Update selected text after vocabulary processing completes
                        setSelectedText(updatedText);
                    }
                }
            }
        } catch (err) {
            console.error('Error reloading texts:', err);
        }
    }, [token, selectedText, vocabularyProcessing]);

    const handleDeleteSuccess = useCallback(async () => {
        // If deleted text was selected, clear selection
        if (selectedText && textToDelete && selectedText.id === textToDelete.id) {
            setSelectedText(null);
        }
        await handleDialogSuccess();
    }, [selectedText, textToDelete, handleDialogSuccess]);

    return (
        // Reader is a LEAF PAGE (see docs/LEAF_NODE_PAGES.md): no footer, DOWN back
        // arrow (→ Home), slides up on enter / down on exit. The streak fire badge
        // (previously in the global AppBar on /reader) rides in the header's right slot.
        <LeafPage
            title="Reader"
            onBack={() => navigate("/")}
            rightContent={isAuthenticated ? <MinutePointsFireBadge /> : undefined}
            className="reader-page-root"
        >
            <Box className="reader-page-container" sx={{
                display: 'flex',
                width: '100%',
                // Fill the space under the common header; the reader locks to this
                // box so the page itself never scrolls.
                flex: 1,
                minHeight: 0,
                overflow: 'hidden',
            }}>
                {/* Desktop sidebar */}
                {!isMobile && (
                    <Box className="reader-page-sidebar-desktop" sx={{
                        width: drawerWidth,
                        flexShrink: 0,
                        borderRight: '1px solid rgba(0, 0, 0, 0.08)',
                        height: '100%',
                        overflowY: 'auto'
                    }}>
                        <TextSidebar
                            texts={texts}
                            selectedText={selectedText}
                            loading={loading}
                            error={error}
                            onTextSelect={handleTextSelect}
                            onCreateNew={handleCreateNew}
                            onEdit={handleEdit}
                            onDelete={handleDelete}
                            formatDate={formatDate}
                            drawerWidth={drawerWidth}
                        />
                    </Box>
                )}

                {/* Dialogs */}
                <CreateDocumentDialog
                    open={createDialogOpen}
                    onClose={() => setCreateDialogOpen(false)}
                    onSuccess={handleDialogSuccess}
                    language={user?.selectedLanguage || 'zh'}
                />
                <EditDocumentDialog
                    open={editDialogOpen}
                    text={textToEdit}
                    onClose={() => {
                        setEditDialogOpen(false);
                        setTextToEdit(null);
                    }}
                    onSuccess={handleDialogSuccess}
                />
                <DeleteDocumentDialog
                    open={deleteDialogOpen}
                    text={textToDelete}
                    onClose={() => {
                        setDeleteDialogOpen(false);
                        setTextToDelete(null);
                    }}
                    onSuccess={handleDeleteSuccess}
                />

                {/* Main content */}
                <Box className="reader-page-main-content-wrapper" sx={{
                    flexGrow: 1,
                    minWidth: 0,
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    width: isMobile ? '100%' : `calc(100% - ${drawerWidth}px)`
                }}>
                    <Box className="reader-page-content" sx={{
                        flexGrow: 1,
                        minHeight: 0,
                        p: { xs: 2, sm: 3 },
                        pt: { xs: 1, sm: 2 },
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden'
                    }}>
                        {selectedText ? (
                            <>
                                {/* Text header */}
                                <TextHeader
                                    selectedText={selectedText}
                                    processingVocab={vocabularyProcessing.processingVocab}
                                    loadedCards={vocabularyProcessing.loadedPersonalCards}
                                    vocabError={vocabularyProcessing.vocabError}
                                    formatDate={formatDate}
                                    onBack={handleBackToList}
                                    onEdit={handleEdit}
                                    onDelete={handleDelete}
                                />

                                {/* Vocabulary card display (mobile only - above text) */}
                                {isMobile && (
                                    <Box className="reader-page-mobile-vocab-card-wrapper">
                                        <VocabDisplayCard
                                            dictionaryEntry={textSelection.selectedDictionaryCard}
                                        />
                                    </Box>
                                )}

                                {/* Text content area with settings sidebar */}
                                <Box className="reader-page-text-content-area" sx={{ flexGrow: 1, minHeight: 0, display: 'flex', gap: 3 }}>
                                    {/* Text content */}
                                    <TextArea
                                        selectedText={selectedText}
                                        autoSelectEnabled={readerSettings.autoSelectEnabled}
                                        selectionColors={selectionColors}
                                        onTextChange={handleTextChangeWithActivity}
                                        onAutoWordSelect={handleAutoWordSelectWithActivity}
                                        onTextSelectionChange={handleTextSelectionChangeWithActivity}
                                        inputRef={textSelection.inputRef}
                                        onBlur={textSelection.handleTextAreaBlur}
                                    />

                                    {/* Desktop right sidebar - vocabulary card and settings */}
                                    {!isMobile && (
                                        <Box className="reader-page-settings-sidebar" sx={{
                                            width: settingsWidth + 120, // Fixed width to accommodate card
                                            flexShrink: 0,
                                            pt: 1,
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: 2
                                        }}>
                                            {/* Vocabulary card display (desktop only - top right) */}
                                            <Box className="reader-page-desktop-vocab-card-wrapper">
                                                <VocabDisplayCard
                                                    dictionaryEntry={textSelection.selectedDictionaryCard}
                                                />
                                            </Box>

                                            {/* Settings sidebar (desktop only) */}
                                            <ReaderSettings
                                                autoSelectEnabled={readerSettings.autoSelectEnabled}
                                                onAutoSelectChange={readerSettings.handleAutoSelectChange}
                                                settingsOpen={readerSettings.settingsOpen}
                                                onSettingsToggle={readerSettings.handleSettingsToggle}
                                            />
                                        </Box>
                                    )}
                                </Box>
                            </>
                        ) : (
                            // Default state when no text is selected
                            <>
                                {isMobile ? (
                                    // On mobile, show the document selection directly in the main content area
                                    <Box sx={{
                                        width: '100%',
                                        maxWidth: '500px',
                                        mx: 'auto',
                                        mt: 2,
                                        '& > *': {
                                            width: '100% !important'
                                        }
                                    }}>
                                        <TextSidebar
                                            texts={texts}
                                            selectedText={selectedText}
                                            loading={loading}
                                            error={error}
                                            onTextSelect={handleTextSelect}
                                            onCreateNew={handleCreateNew}
                                            onEdit={handleEdit}
                                            onDelete={handleDelete}
                                            formatDate={formatDate}
                                            drawerWidth={500}
                                        />
                                    </Box>
                                ) : (
                                    // On desktop, show empty state (sidebar is already visible)
                                    <EmptyState isMobile={isMobile} />
                                )}
                            </>
                        )}
                    </Box>
                </Box>

                {/* Settings toggle button (when sidebar is closed) */}
                {!isMobile && !readerSettings.settingsOpen && (
                    <Box className="reader-page-settings-toggle" sx={{
                        position: 'fixed',
                        right: 16,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        zIndex: 1000
                    }}>
                        <IconButton
                            className="reader-page-settings-toggle-button"
                            onClick={readerSettings.handleSettingsToggle}
                            sx={{
                                backgroundColor: 'primary.main',
                                color: 'white',
                                boxShadow: 3,
                                '&:hover': {
                                    backgroundColor: 'primary.dark',
                                }
                            }}
                        >
                            <SettingsIcon className="reader-page-settings-toggle-icon" />
                        </IconButton>
                    </Box>
                )}

                {/* Tap-to-navigate hint toast (mobile). Mirrors ReaderTapOverlay:
                    a tap on the left side steps the cursor back, the right side
                    steps it forward. */}
                <Snackbar
                    className="reader-page-tap-hint-snackbar"
                    open={tapHintOpen}
                    autoHideDuration={5000}
                    onClose={() => setTapHintOpen(false)}
                    anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
                >
                    <Alert
                        className="reader-page-tap-hint-alert"
                        severity="info"
                        variant="filled"
                        icon={<TouchAppIcon className="reader-page-tap-hint-icon" />}
                        onClose={() => setTapHintOpen(false)}
                    >
                        Tap the left or right side of the text to move the cursor back or forward.
                    </Alert>
                </Snackbar>

            </Box>
        </LeafPage>
    );
}

export default ReaderPage;
