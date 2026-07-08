import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Box, Collapse, useTheme, IconButton, Snackbar, Alert } from "@mui/material";
import {
    TouchApp as TouchAppIcon,
    Edit as EditIcon,
    Delete as DeleteIcon,
    CheckCircle as CheckCircleIcon,
    Flag as FlagIcon,
    Undo as UndoIcon,
} from "@mui/icons-material";
import ReaderDocumentSurface from "./ReaderDocumentSurface";
import MinutePointsFireBadge from "../../minutePoints/MinutePointsFireBadge";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import { useAuth } from "../../AuthContext";
import { useTheme as useCustomTheme } from "../../contexts/ThemeContext";
import { API_BASE_URL } from "../../constants";
import VocabDisplayCard from "../../components/VocabDisplayCard";
import { useVocabularyUpdate } from "../../contexts/VocabularyUpdateContext";
import { processDocumentForTokens } from "../../utils/tokenUtils";
import type { VocabEntry, Text } from "../../types";

import TextHeader from "./TextHeader";
import TextArea from "./TextArea";
import ReaderEditToolbar from "./ReaderEditToolbar";
import DeleteDocumentDialog from "./DeleteDocumentDialog";
import { canonicalizeValidationBody, isValidationShapePreserved, VALIDATION_FORMAT_MESSAGE } from "./validationFormat";

import { useVocabularyProcessing } from "../../hooks/useVocabularyProcessing";
import { useReaderContentEditor } from "./useReaderContentEditor";
import { buildReaderDictMap, buildExcludeSet, computeSegmentSpans } from "./documentSegmentation";
import { useTextSelection } from "./useTextSelection";
import { useReaderSettings } from "./useReaderSettings";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useLockBodyScroll } from "../../hooks/useLockBodyScroll";

// Drop-in/collapse timing for ReaderEditToolbar, matching the fie toolbar's
// CARD_EDIT_ANIM_MS/EASING (CardEditToolbar.tsx) so both editors' toolbars
// animate with the same feel. Kept as a local constant rather than importing
// across the flashcards/reader feature boundary (docs/PROJECT structure).
const EDIT_TOOLBAR_ANIM_MS = 300;
const EDIT_TOOLBAR_ANIM_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

// READER OPEN-DOCUMENT PAGE — routed at `/reader/:id`, a footerless NODE-style
// drill-in from the `/reader` list (docs/LEAF_NODE_PAGES.md § Reader). Fetches its
// own Text by id (cdp-style: same pattern as VocabCardDetailPage), so it is
// deep-linkable/refreshable and supports the browser back button.
function ReaderDocumentPage() {
    usePageTitle("Reader");
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const theme = useTheme();
    const customTheme = useCustomTheme();
    const { token, user, isAuthenticated } = useAuth();
    const vocabularyUpdate = useVocabularyUpdate();
    useLockBodyScroll();

    const [text, setText] = useState<Text | null>(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);

    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

    const [tapHintOpen, setTapHintOpen] = useState(false);
    const [validationMsg, setValidationMsg] = useState<string | null>(null);
    // Snackbar severity for validation feedback — failures (e.g. a changed format)
    // must show as an error, not green success.
    const [validationSeverity, setValidationSeverity] = useState<'success' | 'error'>('success');
    const notifyValidation = useCallback((msg: string, severity: 'success' | 'error' = 'success') => {
        setValidationMsg(msg);
        setValidationSeverity(severity);
    }, []);
    const [savingEdit, setSavingEdit] = useState(false);
    const [editSaveError, setEditSaveError] = useState<string | null>(null);

    const vocabularyProcessing = useVocabularyProcessing(token);
    const readerSettings = useReaderSettings();
    const contentEditor = useReaderContentEditor();

    // Fetch the document by id. Keyed on `id` + the STABLE auth identity, never
    // on `token` (a silent access-token refresh must not re-fetch and reset the
    // reading position — see CLAUDE.md "Never reload on token refresh").
    useEffect(() => {
        let cancelled = false;
        const fetchText = async () => {
            try {
                setLoading(true);
                setNotFound(false);
                const response = await fetch(`${API_BASE_URL}/api/texts/${id}`, {
                    headers: { 'Authorization': `Bearer ${token}` },
                    credentials: 'include',
                });
                if (response.status === 404) {
                    if (!cancelled) setNotFound(true);
                    return;
                }
                if (!response.ok) throw new Error('Failed to fetch document');
                const data = await response.json();
                if (cancelled) return;
                setText(data);
                await vocabularyProcessing.processDocumentVocabulary(data);
            } catch (err) {
                console.error('Error fetching document:', err);
                if (!cancelled) setNotFound(true);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        if (token && id) fetchText();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, user?.id]);

    // GSA word spans for tap/arrow navigation (docs/READER_SEGMENTATION.md).
    const segmentSpans = useMemo(() => {
        if (!text?.content) return [];
        const dictMap = buildReaderDictMap(
            vocabularyProcessing.loadedDictionaryCards,
            vocabularyProcessing.loadedPersonalCards
        );
        const excludeSet = buildExcludeSet(vocabularyProcessing.loadedDictionaryCards);
        return computeSegmentSpans(text.content, dictMap, excludeSet);
    }, [text?.content, vocabularyProcessing.loadedDictionaryCards, vocabularyProcessing.loadedPersonalCards]);

    const textSelection = useTextSelection(
        vocabularyProcessing.loadedPersonalCards,
        vocabularyProcessing.loadedDictionaryCards,
        readerSettings.autoSelectEnabled,
        segmentSpans
    );

    const handleTextChangeWithActivity = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        textSelection.handleTextChange(event);
    }, [textSelection]);

    const handleAutoWordSelectWithActivity = useCallback((event: React.SyntheticEvent<HTMLDivElement>) => {
        textSelection.handleAutoWordSelect(event);
    }, [textSelection]);

    const handleTextSelectionChangeWithActivity = useCallback((event: React.SyntheticEvent<HTMLDivElement>) => {
        textSelection.handleTextSelectionChange(event);
    }, [textSelection]);

    const selectionColors = useMemo(() => {
        switch (customTheme.themeMode) {
            case 'dark':
                return { backgroundColor: theme.palette.primary.main + '40' }; // 25% opacity
            case 'blue':
            case 'green':
            case 'light':
            default:
                return { backgroundColor: theme.palette.primary.main + '30' }; // ~19% opacity
        }
    }, [customTheme.themeMode, theme.palette.primary.main]);

    // Vocabulary update listeners: keep loadedPersonalCards in sync with entries
    // added/edited/removed elsewhere in the app while this document is open.
    useEffect(() => {
        if (!text) return;
        const documentTokens = processDocumentForTokens(text.content);
        const isEntryRelevantToDocument = (entry: VocabEntry): boolean => documentTokens.includes(entry.entryKey);

        const unsubscribeAdd = vocabularyUpdate.onVocabAdd((entry: VocabEntry) => {
            if (isEntryRelevantToDocument(entry)) {
                vocabularyProcessing.setLoadedPersonalCards(prev => {
                    if (prev.some(existing => existing.id === entry.id)) return prev;
                    return [...prev, entry];
                });
            }
        });

        const unsubscribeUpdate = vocabularyUpdate.onVocabUpdate((entry: VocabEntry) => {
            vocabularyProcessing.setLoadedPersonalCards(prev => {
                const index = prev.findIndex(existing => existing.id === entry.id);
                if (index === -1) {
                    if (isEntryRelevantToDocument(entry)) return [...prev, entry];
                    return prev;
                }
                const updated = [...prev];
                updated[index] = entry;
                if (textSelection.selectedPersonalCard && textSelection.selectedPersonalCard.id === entry.id) {
                    textSelection.setSelectedPersonalCard(entry);
                }
                return updated;
            });
        });

        const unsubscribeRemove = vocabularyUpdate.onVocabRemove((entryId: number) => {
            vocabularyProcessing.setLoadedPersonalCards(prev => prev.filter(entry => entry.id !== entryId));
            if (textSelection.selectedPersonalCard && textSelection.selectedPersonalCard.id === entryId) {
                textSelection.setSelectedPersonalCard(null);
            }
        });

        const unsubscribeBulkAdd = vocabularyUpdate.onVocabBulkAdd((entries: VocabEntry[]) => {
            const relevantEntries = entries.filter(isEntryRelevantToDocument);
            if (relevantEntries.length > 0) {
                vocabularyProcessing.setLoadedPersonalCards(prev => {
                    const existingIds = new Set(prev.map(entry => entry.id));
                    const newEntries = relevantEntries.filter(entry => !existingIds.has(entry.id));
                    return [...prev, ...newEntries];
                });
            }
        });

        return () => {
            unsubscribeAdd();
            unsubscribeUpdate();
            unsubscribeRemove();
            unsubscribeBulkAdd();
        };
    }, [text, vocabularyUpdate, textSelection.selectedPersonalCard, vocabularyProcessing, textSelection]);

    // Focus the reading box once the document loads, auto-highlighting the first
    // word. Keyed on the document id only — must NOT re-run (and reset the caret)
    // on every auto-select toggle.
    const focusTextArea = textSelection.focusTextArea;
    useEffect(() => {
        if (text) focusTextArea(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [text?.id]);

    // Tap-to-navigate hint toast, once per document open.
    useEffect(() => {
        setTapHintOpen(!!text);
    }, [text?.id]);

    // Return focus + re-highlight when a dialog closes (see original rationale in
    // docs/READER_SEGMENTATION.md / useTextSelection). Inline edit mode is treated
    // the same way — closing it (cancel or save) hands the reading box back its
    // focus/highlight.
    const anyDialogOpen = deleteDialogOpen || contentEditor.editMode;
    const prevAnyDialogOpenRef = useRef(anyDialogOpen);
    useEffect(() => {
        if (prevAnyDialogOpenRef.current && !anyDialogOpen && text) {
            focusTextArea(true);
        }
        prevAnyDialogOpenRef.current = anyDialogOpen;
    }, [anyDialogOpen, text, focusTextArea]);

    const formatDate = useCallback((dateString: string) => {
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }, []);

    const handleBack = useCallback(() => {
        navigate("/reader");
    }, [navigate]);

    // Edit is a toggle: pressing it opens the inline content editor (auto-select
    // off, plain editable textarea, drop-down ReaderEditToolbar) seeded with the
    // current content. Title/description editing has been dropped from this page
    // for now (still available from the list row's Edit dialog in ReaderPage.tsx).
    const handleEdit = useCallback(() => {
        if (!text) return;
        setEditSaveError(null);
        contentEditor.enterEditMode(text.content);
    }, [text, contentEditor]);

    const handleCancelEdit = useCallback(() => {
        setEditSaveError(null);
        contentEditor.exitEditMode();
    }, [contentEditor]);

    const handleSaveEdit = useCallback(async () => {
        if (!text) return;

        // Format guard + whitespace lock — ONLY for validation documents
        // (docs/DATA_VALIDATION_SYSTEM.md). A validation doc's body is a fixed
        // `<fieldName>:\n<JSON>` structure; the validator may edit only the JSON
        // values. Canonicalize the draft: this both rejects a broken format (null
        // result) and resets every non-value character (headers, separators,
        // indentation, stray whitespace) so a whitespace-only edit round-trips to the
        // original and never triggers a spurious flag. Ordinary reader documents have
        // no `validationField` and save their draft verbatim.
        let contentToSave = contentEditor.draft;
        if (text.validationField) {
            const canonical = canonicalizeValidationBody(contentEditor.draft, text.validationField);
            // Block a broken format AND any JSON key-name change (a renamed key stays
            // valid JSON but the server would no longer recognize the field).
            if (
                canonical === null ||
                !isValidationShapePreserved(contentEditor.draft, text.validationOriginalContent ?? '', text.validationField)
            ) {
                setEditSaveError(VALIDATION_FORMAT_MESSAGE);
                return;
            }
            contentToSave = canonical;
        }

        setSavingEdit(true);
        setEditSaveError(null);
        try {
            const response = await fetch(`${API_BASE_URL}/api/texts/${text.id}`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ content: contentToSave }),
            });
            if (!response.ok) {
                const data = await response.json().catch(() => null);
                setEditSaveError(data?.error || 'Failed to save changes');
                return;
            }
            const updated = await response.json();
            await vocabularyProcessing.processDocumentVocabularyIncremental(text, updated);
            setText(updated);
            contentEditor.exitEditMode();
        } catch (err) {
            console.error('Error saving document edit:', err);
            setEditSaveError('Failed to save changes');
        } finally {
            setSavingEdit(false);
        }
    }, [text, token, contentEditor, vocabularyProcessing]);

    const handleDelete = useCallback(() => {
        setDeleteDialogOpen(true);
    }, []);

    // After Edit saves (or a validation Approve/Flag/Revert PUTs new content),
    // refetch this document and incrementally reprocess only the newly added
    // tokens — the same incremental path the old in-page ReaderPage used.
    const refreshText = useCallback(async () => {
        if (!text) return;
        try {
            const response = await fetch(`${API_BASE_URL}/api/texts/${text.id}`, {
                headers: { 'Authorization': `Bearer ${token}` },
                credentials: 'include',
            });
            if (!response.ok) return;
            const updated = await response.json();
            await vocabularyProcessing.processDocumentVocabularyIncremental(text, updated);
            setText(updated);
        } catch (err) {
            console.error('Error refreshing document:', err);
        }
    }, [text, token, vocabularyProcessing]);

    const handleDeleteSuccess = useCallback(() => {
        navigate("/reader");
    }, [navigate]);

    // ── Data-validation actions (validators only; docs/DATA_VALIDATION_SYSTEM.md) ──
    // Note: the "download a new entry to validate" action lives ONLY on the reader
    // list page (ReaderPage.tsx) — not here. This page only Approves/Flags/Reverts
    // the already-open validation document.
    const handleApproveOrFlag = useCallback(async () => {
        if (!text?.validationEntryId) return;
        const changed = (text.content || '').trim() !== (text.validationOriginalContent || '').trim();
        const action = changed ? 'flag' : 'approve';
        try {
            const response = await fetch(`${API_BASE_URL}/api/validation/${text.id}/submit`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ action, content: text.content }),
            });
            const data = await response.json();
            if (!response.ok) {
                // The server rejects a submission whose edits broke the fixed
                // `<field>:\n<JSON>` format (code ERR_VALIDATION_FORMAT_CHANGED). Give
                // the validator an explicit, format-specific instruction to Revert and
                // start over rather than a generic failure message.
                if (data?.code === 'ERR_VALIDATION_FORMAT_CHANGED') {
                    notifyValidation(VALIDATION_FORMAT_MESSAGE, 'error');
                } else {
                    notifyValidation(data?.error || 'Failed to submit validation', 'error');
                }
                return;
            }
            notifyValidation(changed ? 'Flagged with your suggestion — thank you!' : 'Approved — thank you!', 'success');
            navigate("/reader"); // the entry can't be re-validated; return to the list
        } catch (err) {
            console.error('Error submitting validation:', err);
            notifyValidation('Failed to submit validation', 'error');
        }
    }, [text, token, navigate, notifyValidation]);

    const handleRevertValidation = useCallback(async () => {
        if (!text || text.validationOriginalContent == null) return;
        try {
            const response = await fetch(`${API_BASE_URL}/api/texts/${text.id}`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ content: text.validationOriginalContent }),
            });
            if (!response.ok) {
                notifyValidation('Failed to revert', 'error');
                return;
            }
            await refreshText();
            notifyValidation('Reverted to the original', 'success');
        } catch (err) {
            console.error('Error reverting validation doc:', err);
            notifyValidation('Failed to revert', 'error');
        }
    }, [text, token, refreshText, notifyValidation]);

    const headerRightContent = isAuthenticated ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <MinutePointsFireBadge />
        </Box>
    ) : undefined;

    // Validation-doc header actions. A validation document links to a dictionary
    // entry (migration 104); when its body has been edited away from the server's
    // original, Approve becomes "Flag with suggestion" (the edit is the suggestion),
    // and Revert restores the original. These live in the page header alongside
    // Edit/Delete — NOT in TextHeader's in-content toolbar — rendered as icon
    // buttons to match the header's existing action affordances.
    const isValidationDoc = !!text?.validationEntryId;
    const isValidationChanged =
        (text?.content || '').trim() !== (text?.validationOriginalContent || '').trim();

    // Edit/Delete icon buttons live in the header's right slot (next to the back
    // arrow) rather than in TextHeader's toolbar, like every other node page's
    // header-level actions (docs/LEAF_NODE_PAGES.md). While the inline content
    // editor is open, Save/Cancel in ReaderEditToolbar are the only way to leave
    // edit mode — Edit/Delete/validation actions are hidden to avoid a destructive
    // action (delete) or a state change (validation submit) racing an unsaved draft.
    const docHeaderRightContent = text ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {!contentEditor.editMode && isValidationDoc && (
                <>
                    <IconButton
                        className="reader-page-text-header-revert-button"
                        onClick={handleRevertValidation}
                        size="small"
                        disabled={!isValidationChanged}
                        aria-label="Revert to the original"
                        title="Revert to the original"
                    >
                        <UndoIcon fontSize="small" />
                    </IconButton>
                    {isValidationChanged ? (
                        <IconButton
                            className="reader-page-text-header-flag-button"
                            onClick={handleApproveOrFlag}
                            size="small"
                            color="warning"
                            aria-label="Flag with suggestion"
                            title="Flag with suggestion"
                        >
                            <FlagIcon fontSize="small" />
                        </IconButton>
                    ) : (
                        <IconButton
                            className="reader-page-text-header-approve-button"
                            onClick={handleApproveOrFlag}
                            size="small"
                            color="success"
                            aria-label="Approve"
                            title="Approve"
                        >
                            <CheckCircleIcon fontSize="small" />
                        </IconButton>
                    )}
                </>
            )}
            {!contentEditor.editMode && (
                <>
                    <IconButton
                        className="reader-page-text-header-edit-button"
                        onClick={handleEdit}
                        size="small"
                        aria-label="Edit document"
                        title="Edit document"
                    >
                        <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                        className="reader-page-text-header-delete-button"
                        onClick={handleDelete}
                        size="small"
                        color="error"
                        aria-label="Delete document"
                        title="Delete document"
                    >
                        <DeleteIcon fontSize="small" />
                    </IconButton>
                </>
            )}
            {headerRightContent}
        </Box>
    ) : headerRightContent;

    return (
        <ReaderDocumentSurface
            title="Reader"
            onBack={handleBack}
            rightContent={docHeaderRightContent}
        >
            {/* Drops in below the surface's own header while editing, full-width like
            the header itself — same placement/motion as the fie toolbar dropping in
            below FlashcardsLearnPage's header (CardEditToolbar.tsx). */}
            <Collapse in={contentEditor.editMode} timeout={EDIT_TOOLBAR_ANIM_MS} easing={EDIT_TOOLBAR_ANIM_EASING} unmountOnExit>
                <ReaderEditToolbar
                    canUndo={contentEditor.canUndo}
                    canRedo={contentEditor.canRedo}
                    onUndo={contentEditor.undo}
                    onRedo={contentEditor.redo}
                    onCancel={handleCancelEdit}
                    onSave={handleSaveEdit}
                    saving={savingEdit}
                />
            </Collapse>

            {loading && (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
                    <DelayedCircularProgress size={32} />
                </Box>
            )}

            {!loading && notFound && (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, p: 3 }}>
                    <Alert severity="error">Document not found.</Alert>
                </Box>
            )}

            {!loading && text && (
                <Box className="reader-document-content" sx={{
                    flexGrow: 1,
                    minHeight: 0,
                    p: { xs: 2, sm: 3 },
                    pt: { xs: 1, sm: 2 },
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden'
                }}>
                    <TextHeader
                        selectedText={text}
                        processingVocab={vocabularyProcessing.processingVocab}
                        vocabError={vocabularyProcessing.vocabError}
                        formatDate={formatDate}
                    />

                    <Box className="reader-page-mobile-vocab-card-wrapper">
                        <VocabDisplayCard
                            dictionaryEntry={textSelection.selectedDictionaryCard}
                        />
                    </Box>

                    <Box className="reader-page-text-content-area" sx={{ flexGrow: 1, minHeight: 0, display: 'flex', gap: 3 }}>
                        <TextArea
                            selectedText={text}
                            autoSelectEnabled={readerSettings.autoSelectEnabled && !contentEditor.editMode}
                            segmentSpans={segmentSpans}
                            selectionColors={selectionColors}
                            onTextChange={handleTextChangeWithActivity}
                            onAutoWordSelect={handleAutoWordSelectWithActivity}
                            onTextSelectionChange={handleTextSelectionChangeWithActivity}
                            inputRef={textSelection.inputRef}
                            onBlur={textSelection.handleTextAreaBlur}
                            editMode={contentEditor.editMode}
                            draftContent={contentEditor.draft}
                            onDraftChange={contentEditor.handleDraftChange}
                        />
                    </Box>
                </Box>
            )}

            <DeleteDocumentDialog
                open={deleteDialogOpen}
                text={text}
                onClose={() => setDeleteDialogOpen(false)}
                onSuccess={handleDeleteSuccess}
            />

            <Snackbar
                className="reader-page-tap-hint-snackbar"
                open={tapHintOpen}
                autoHideDuration={5000}
                onClose={() => setTapHintOpen(false)}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
                // Clears the surface's own fixed header (PageHeader is 60px) instead
                // of overlapping the back arrow / edit / delete buttons.
                sx={{ top: '68px !important' }}
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

            <Snackbar
                className="reader-page-validation-snackbar"
                open={!!validationMsg}
                // Errors (e.g. the format-changed rejection) stay up longer so the
                // validator can read the "Revert and start over" instruction.
                autoHideDuration={validationSeverity === 'error' ? 8000 : 4000}
                onClose={() => setValidationMsg(null)}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
                // Clears the surface's own fixed header (PageHeader is 60px) instead
                // of overlapping the back arrow / edit / delete buttons.
                sx={{ top: '68px !important' }}
            >
                <Alert
                    className="reader-page-validation-alert"
                    severity={validationSeverity}
                    variant="filled"
                    onClose={() => setValidationMsg(null)}
                >
                    {validationMsg}
                </Alert>
            </Snackbar>

            <Snackbar
                className="reader-page-edit-save-error-snackbar"
                open={!!editSaveError}
                autoHideDuration={4000}
                onClose={() => setEditSaveError(null)}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
                // Clears the surface's own fixed header (PageHeader is 60px) instead
                // of overlapping the back arrow / edit / delete buttons.
                sx={{ top: '68px !important' }}
            >
                <Alert
                    className="reader-page-edit-save-error-alert"
                    severity="error"
                    variant="filled"
                    onClose={() => setEditSaveError(null)}
                >
                    {editSaveError}
                </Alert>
            </Snackbar>
        </ReaderDocumentSurface>
    );
}

export default ReaderDocumentPage;
