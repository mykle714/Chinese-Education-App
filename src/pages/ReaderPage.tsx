import { useState, useEffect, useCallback, useMemo } from "react";
import {
    Box,
    Drawer,
    useMediaQuery,
    useTheme,
    Fab,
    IconButton
} from "@mui/material";
import {
    LibraryBooks as LibraryBooksIcon,
    Settings as SettingsIcon
} from "@mui/icons-material";
import { useAuth } from "../AuthContext";
import { useTheme as useCustomTheme } from "../contexts/ThemeContext";
import { API_BASE_URL } from "../constants";
import { useWorkPoints } from "../hooks/useWorkPoints";
import WorkPointsBadge from "../components/WorkPointsBadge";
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

function ReaderPage() {
    const theme = useTheme();
    const customTheme = useCustomTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down("md"));
    const { token, user } = useAuth();
    const vocabularyUpdate = useVocabularyUpdate();

    // Work points integration
    const workPoints = useWorkPoints();

    // State management
    const [texts, setTexts] = useState<Text[]>([]);
    const [selectedText, setSelectedText] = useState<Text | null>(null);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Dialog states
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [textToEdit, setTextToEdit] = useState<Text | null>(null);
    const [textToDelete, setTextToDelete] = useState<Text | null>(null);

    // Use extracted hooks
    const vocabularyProcessing = useVocabularyProcessing(token);
    const readerSettings = useReaderSettings();
    const textSelection = useTextSelection(
        vocabularyProcessing.loadedPersonalCards,
        vocabularyProcessing.loadedDictionaryCards,
        readerSettings.autoSelectEnabled
    );

    // Wrap text selection handlers to record activity
    const handleTextChangeWithActivity = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        workPoints.recordActivity();
        textSelection.handleTextChange(event);
    }, [workPoints, textSelection]);

    const handleAutoWordSelectWithActivity = useCallback((event: React.SyntheticEvent<HTMLDivElement>) => {
        workPoints.recordActivity();
        textSelection.handleAutoWordSelect(event);
    }, [workPoints, textSelection]);

    const handleTextSelectionChangeWithActivity = useCallback((event: React.SyntheticEvent<HTMLDivElement>) => {
        workPoints.recordActivity();
        textSelection.handleTextSelectionChange(event);
    }, [workPoints, textSelection]);

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
                });

                if (!response.ok) {
                    throw new Error('Failed to fetch texts');
                }

                const textsData = await response.json();
                setTexts(textsData);
            } catch (err) {
                console.error('Error fetching texts:', err);
                // Use sample data for testing when API is not available
                const sampleTexts: Text[] = [
                    {
                        id: '1',
                        userId: null,
                        title: 'Sample Chinese Text',
                        description: 'A sample text for testing auto word selection',
                        content: '这是一个测试文本。我们可以点击任何地方来选择单词。This is a test text. We can click anywhere to select words. 中文和英文都应该工作正常。',
                        language: 'zh',
                        characterCount: 85,
                        isUserCreated: false,
                        createdAt: new Date().toISOString()
                    },
                    {
                        id: '2',
                        userId: null,
                        title: 'English Sample Text',
                        description: 'English text for testing word boundaries',
                        content: 'Hello world! This is an English text sample. Click anywhere in this text to test the auto word selection feature. It should work with punctuation, numbers like 123, and various word types.',
                        language: 'zh',
                        characterCount: 180,
                        isUserCreated: false,
                        createdAt: new Date().toISOString()
                    }
                ];
                setTexts(sampleTexts);
                setError(null);
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
                console.log('[READER-VOCAB-UPDATE] Clearing selected personal card (deleted):', entryId);
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
        console.log("[TEXT-SELECTION] Selected text:", text.title);
        setSelectedText(text);
        if (isMobile) {
            setDrawerOpen(false);
        }

        // Process vocabulary for the selected document
        await vocabularyProcessing.processDocumentVocabulary(text);
    }, [isMobile, vocabularyProcessing]);

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
            });

            if (response.ok) {
                const textsData = await response.json();
                setTexts(textsData);

                // If there's a selected text, update it with the fresh data and reprocess vocabulary incrementally
                if (selectedText) {
                    const updatedText = textsData.find((t: Text) => t.id === selectedText.id);
                    if (updatedText) {
                        console.log('[READER-PAGE] Processing vocabulary changes after document edit');

                        // Use incremental processing: only fetch vocabulary for newly added tokens
                        // This handles documents with >1000 tokens by processing only the diff
                        await vocabularyProcessing.processDocumentVocabularyIncremental(selectedText, updatedText);

                        // Update selected text after vocabulary processing completes
                        setSelectedText(updatedText);
                        console.log('[READER-PAGE] Updated selected text and vocabulary after edit');
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
        <>
            {/* Work Points Badge - only show on eligible pages */}
            {workPoints.isEligiblePage && (
                <Box className="reader-page-work-points-wrapper">
                    <WorkPointsBadge
                        points={workPoints.currentPoints}
                        isActive={workPoints.isActive}
                        isAnimating={workPoints.isAnimating}
                    />
                </Box>
            )}

            <Box className="reader-page-container" sx={{ display: 'flex', width: '100%', minHeight: 'calc(100vh - 200px)', mt: -2 }}>
                {/* Desktop sidebar */}
                {!isMobile && (
                    <Box className="reader-page-sidebar-desktop" sx={{
                        width: drawerWidth,
                        flexShrink: 0,
                        borderRight: '1px solid rgba(0, 0, 0, 0.08)',
                        height: 'fit-content',
                        minHeight: 'calc(100vh - 200px)'
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

                {/* Mobile drawer */}
                {isMobile && (
                    <Drawer
                        className="reader-page-mobile-drawer"
                        variant="temporary"
                        open={drawerOpen}
                        onClose={() => setDrawerOpen(false)}
                        ModalProps={{
                            keepMounted: true,
                        }}
                        sx={{
                            [`& .MuiDrawer-paper`]: {
                                width: drawerWidth,
                                boxSizing: 'border-box',
                            },
                        }}
                    >
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
                    </Drawer>
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
                    width: isMobile ? '100%' : `calc(100% - ${drawerWidth}px)`
                }}>
                    <Box className="reader-page-content" sx={{
                        flexGrow: 1,
                        p: { xs: 2, sm: 3 },
                        pt: { xs: 1, sm: 2 },
                        display: 'flex',
                        flexDirection: 'column',
                        minHeight: '100vh'
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
                                />

                                {/* Vocabulary card display (mobile only - above text) */}
                                {isMobile && (
                                    <Box className="reader-page-mobile-vocab-card-wrapper">
                                        <VocabDisplayCard
                                            personalEntry={textSelection.selectedPersonalCard}
                                            dictionaryEntry={textSelection.selectedDictionaryCard}
                                        />
                                    </Box>
                                )}

                                {/* Text content area with settings sidebar */}
                                <Box className="reader-page-text-content-area" sx={{ flexGrow: 1, display: 'flex', gap: 3 }}>
                                    {/* Text content */}
                                    <TextArea
                                        selectedText={selectedText}
                                        autoSelectEnabled={readerSettings.autoSelectEnabled}
                                        selectionColors={selectionColors}
                                        onTextChange={handleTextChangeWithActivity}
                                        onAutoWordSelect={handleAutoWordSelectWithActivity}
                                        onTextSelectionChange={handleTextSelectionChangeWithActivity}
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
                                                    personalEntry={textSelection.selectedPersonalCard}
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

                {/* Mobile FAB */}
                {isMobile && (
                    <Fab
                        className="reader-page-mobile-fab"
                        color="primary"
                        aria-label="open text selection"
                        onClick={() => setDrawerOpen(true)}
                        sx={{
                            position: 'fixed',
                            bottom: 80,
                            right: 16,
                            zIndex: 1000
                        }}
                    >
                        <LibraryBooksIcon className="reader-page-mobile-fab-icon" />
                    </Fab>
                )}
            </Box>
        </>
    );
}

export default ReaderPage;
