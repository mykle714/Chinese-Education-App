import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Box, Collapse, useTheme, useMediaQuery, Snackbar, Alert } from "@mui/material";
import { TouchApp as TouchAppIcon } from "@mui/icons-material";
import { HeaderIconButton } from "../../components/PageHeader";
import { COLORS } from "../../theme/colors";
import ReaderDocumentSurface from "./ReaderDocumentSurface";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import { useAuth } from "../../AuthContext";
import { useTheme as useCustomTheme } from "../../contexts/ThemeContext";
import { API_BASE_URL } from "../../constants";
import { apiPost, apiPut, ApiError } from "../../api/http";
import { NEW_DOCUMENT_ID } from "./readerPaths";
import VocabDisplayCard from "../../components/VocabDisplayCard";
import { useVocabularyUpdate } from "../../contexts/VocabularyUpdateContext";
import { processDocumentForTokens } from "../../utils/tokenUtils";
import type { VocabEntry, Text } from "../../types";

import TextHeader from "./TextHeader";
import TextArea from "./TextArea";
import ReaderEditToolbar from "./ReaderEditToolbar";
import DeleteDocumentDialog from "./DeleteDocumentDialog";

import { useVocabularyProcessing } from "../../hooks/useVocabularyProcessing";
import { useReaderContentEditor } from "./useReaderContentEditor";
import { buildReaderDictMap, buildExcludeSet, computeSegmentSpans } from "./documentSegmentation";
import { useTextSelection } from "./useTextSelection";
import { useReaderSettings } from "./useReaderSettings";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useLockBodyScroll } from "../../hooks/useLockBodyScroll";
import { SAFE_TOP } from "../../theme/safeArea";
import {
    useKeyboardInset,
    transitionForInset,
    BEGINNER_KEYBOARD_SLIDE_MS,
    BEGINNER_KEYBOARD_EASING,
} from "../beginnerKeyboard";

// Drop-in/collapse timing for ReaderEditToolbar, matching the fie toolbar's
// CARD_EDIT_ANIM_MS/EASING (CardEditToolbar.tsx) so both editors' toolbars
// animate with the same feel. Kept as a local constant rather than importing
// across the flashcards/reader feature boundary (docs/PROJECT structure).
// Where the page's three top-anchored snackbars sit. They clear the surface's own
// fixed header (the reader draws its NodePageHeader over the text) so an alert never
// covers the back arrow / edit / delete buttons — plus the status-bar inset, because
// the header itself is offset by it since `viewport-fit=cover` (src/theme/safeArea.ts).
// One constant rather than the three byte-identical `top: '68px !important'` overrides
// that used to sit inline on each Snackbar.
const SNACKBAR_TOP = `calc(68px + ${SAFE_TOP}) !important`;

const EDIT_TOOLBAR_ANIM_MS = 300;
const EDIT_TOOLBAR_ANIM_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

// READER OPEN-DOCUMENT PAGE — routed at `/reader/:id`, a footerless NODE-style
// drill-in from the `/reader` list (docs/LEAF_NODE_PAGES.md § Reader). Fetches its
// own Text by id (cdp-style: same pattern as VocabCardDetailPage), so it is
// deep-linkable/refreshable and supports the browser back button.
//
// `/reader/new` (NEW_DOCUMENT_ID) is a BLANK DRAFT: no fetch, opened straight in
// edit mode, and nothing exists server-side until the first Save — which POSTs the
// document (the server derives its title from the content), then swaps the URL for
// the real id. Cancel/back on a draft simply leaves; there is nothing to clean up.
// Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Creating a document".
function ReaderDocumentPage() {
    usePageTitle("Reader");
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const theme = useTheme();
    const customTheme = useCustomTheme();
    const { token, user } = useAuth();
    const isNewDraft = id === NEW_DOCUMENT_ID;
    // Set on a draft's first Save, just before the URL is replaced with the new id —
    // so the fetch effect below, which re-runs on the id change, knows the page
    // already holds this document (and its processed vocab) and skips a reload.
    const justCreatedIdRef = useRef<string | null>(null);
    const vocabularyUpdate = useVocabularyUpdate();
    useLockBodyScroll();

    // KEYBOARD LIFT (docs/USER_DOCUMENT_FEATURE_SUMMARY.md § Editing). While editing
    // with a keyboard up — ours or the OS's, `useKeyboardInset` is the union — the
    // title block and vocab card fold away so the text box rises to sit just under
    // the edit toolbar, and the content area reserves the keyboard's height at the
    // bottom so the box ends at the keyboard's top edge instead of behind it. Both
    // ride the keyboard's own slide curve, so the box goes up WITH the keyboard and
    // comes back down with it (the provider zeroes the inset as the exit starts).
    // Keyed on the inset, not just on edit mode: dismissing the keyboard mid-edit
    // brings the header back while the editor stays open.
    const keyboardInset = useKeyboardInset();
    const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

    const [text, setText] = useState<Text | null>(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);

    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

    const [tapHintOpen, setTapHintOpen] = useState(false);
    const [savingEdit, setSavingEdit] = useState(false);
    const [editSaveError, setEditSaveError] = useState<string | null>(null);

    const vocabularyProcessing = useVocabularyProcessing();
    const readerSettings = useReaderSettings();
    const contentEditor = useReaderContentEditor();

    // Fetch the document by id. Keyed on `id` + the STABLE auth identity, never
    // on `token` (a silent access-token refresh must not re-fetch and reset the
    // reading position — see CLAUDE.md "Never reload on token refresh").
    useEffect(() => {
        // The draft that was just saved: already in state, nothing to reload.
        if (id && id === justCreatedIdRef.current) {
            justCreatedIdRef.current = null;
            return;
        }
        if (isNewDraft) {
            setNotFound(false);
            setText(blankDraft(user?.selectedLanguage));
            contentEditor.enterEditMode('');
            setLoading(false);
            return;
        }
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
    // Not for a new draft: it opens in edit mode, whose textarea focuses itself
    // (TextArea), and the reading box does not exist yet.
    const focusTextArea = textSelection.focusTextArea;
    useEffect(() => {
        if (text && text.id !== NEW_DOCUMENT_ID) focusTextArea(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [text?.id]);

    // Tap-to-navigate hint toast, once per document open. A draft has nothing to
    // navigate yet; the hint shows once it is saved (its id changes then).
    const openTextId = text?.id;
    useEffect(() => {
        setTapHintOpen(!!openTextId && openTextId !== NEW_DOCUMENT_ID);
    }, [openTextId]);

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

    const handleBack = useCallback(() => {
        navigate("/reader");
    }, [navigate]);

    // Edit is a toggle: pressing it opens the inline content editor (auto-select
    // off, plain editable textarea, drop-down ReaderEditToolbar) seeded with the
    // current content. Only the content is editable; the title is set once, on
    // create (server/utils/documentTitle.ts), and there is currently no rename UI.
    const handleEdit = useCallback(() => {
        if (!text) return;
        setEditSaveError(null);
        contentEditor.enterEditMode(text.content);
    }, [text, contentEditor]);

    // Cancelling a never-saved draft leaves the page: there is no reading view of
    // an empty, nonexistent document to fall back to.
    const handleCancelEdit = useCallback(() => {
        setEditSaveError(null);
        if (isNewDraft) {
            navigate("/reader");
            return;
        }
        contentEditor.exitEditMode();
    }, [contentEditor, isNewDraft, navigate]);

    // First Save of a draft = create. The server derives the title from the
    // content; the URL is then replaced (not pushed) so Back returns to the list,
    // not to an empty draft.
    const saveNewDraft = useCallback(async () => {
        const created = await apiPost<Text>('/api/texts', {
            content: contentEditor.draft,
            language: user?.selectedLanguage || 'zh',
        });
        await vocabularyProcessing.processDocumentVocabulary(created);
        setText(created);
        contentEditor.exitEditMode();
        justCreatedIdRef.current = created.id;
        navigate(`/reader/${created.id}`, { replace: true });
    }, [contentEditor, user?.selectedLanguage, vocabularyProcessing, navigate]);

    const handleSaveEdit = useCallback(async () => {
        if (!text) return;

        setSavingEdit(true);
        setEditSaveError(null);
        try {
            if (isNewDraft) {
                await saveNewDraft();
                return;
            }
            const updated = await apiPut<Text>(`/api/texts/${text.id}`, { content: contentEditor.draft });
            await vocabularyProcessing.processDocumentVocabularyIncremental(text, updated);
            setText(updated);
            contentEditor.exitEditMode();
        } catch (err) {
            console.error('Error saving document edit:', err);
            // ApiError's message is the server's `error` field, which is what the
            // hand-rolled version read off the response body.
            setEditSaveError(err instanceof ApiError ? err.message : 'Failed to save changes');
        } finally {
            setSavingEdit(false);
        }
        // No `token` dep: apiPut/apiPost read the header at call time (CLAUDE.md ⛔ rule).
    }, [text, isNewDraft, saveNewDraft, contentEditor, vocabularyProcessing]);

    const handleDelete = useCallback(() => {
        setDeleteDialogOpen(true);
    }, []);

    const handleDeleteSuccess = useCallback(() => {
        navigate("/reader");
    }, [navigate]);

    // See KEYBOARD LIFT above. Reading mode suppresses both keyboards, so the inset
    // is only ever non-zero here while editing; the editMode gate just makes that
    // explicit.
    const editKeyboardInset = contentEditor.editMode ? keyboardInset : 0;
    const keyboardLifted = editKeyboardInset > 0;
    // The fold is a Collapse whose `in` is "NOT lifted", so its EXIT is the
    // keyboard arriving and its ENTER the keyboard leaving — hence the swap.
    const liftTimeout = prefersReducedMotion
        ? 0
        : { enter: BEGINNER_KEYBOARD_SLIDE_MS.exit, exit: BEGINNER_KEYBOARD_SLIDE_MS.enter };
    const liftEasing = { enter: BEGINNER_KEYBOARD_EASING.exit, exit: BEGINNER_KEYBOARD_EASING.enter };

    // Edit/Delete icon buttons live in the header's right slot (next to the back
    // arrow) rather than in TextHeader's toolbar, like every other node page's
    // header-level actions (docs/LEAF_NODE_PAGES.md). While the inline content
    // editor is open, Save/Cancel in ReaderEditToolbar are the only way to leave
    // edit mode — Edit/Delete are hidden so a delete cannot race an unsaved draft.
    // (A new draft is always in edit mode, so it never shows them.)
    const docHeaderRightContent = text ? (
        // A fragment, not a wrapping Box, so the header's own right-slot gap spaces these.
        // HeaderIconButton (not MUI IconButton) so they size like every other header action.
        <>
            {!contentEditor.editMode && (
                <HeaderIconButton
                    className="reader-page-text-header-edit-button"
                    icon="edit"
                    label="Edit document"
                    title="Edit document"
                    onClick={handleEdit}
                />
            )}
            {!contentEditor.editMode && (
                <HeaderIconButton
                    className="reader-page-text-header-delete-button"
                    icon="delete"
                    label="Delete document"
                    title="Delete document"
                    color={COLORS.dangerInk}
                    onClick={handleDelete}
                />
            )}
        </>
    ) : undefined;

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
                    saveDisabled={isNewDraft && !contentEditor.draft.trim()}
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
                    overflow: 'hidden',
                    // Keyboard clearance (KEYBOARD LIFT): the base gutter (the `p`
                    // above: 16px / 24px) plus the keyboard's height, travelling on
                    // its slide curve.
                    paddingBottom: { xs: `${16 + editKeyboardInset}px`, sm: `${24 + editKeyboardInset}px` },
                    transition: transitionForInset(editKeyboardInset),
                }}>
                    {/* Folds away while a keyboard is up in edit mode, lifting the
                    text box to the top of the page (KEYBOARD LIFT). */}
                    <Collapse
                        className="reader-document-lead"
                        in={!keyboardLifted}
                        timeout={liftTimeout}
                        easing={liftEasing}
                        sx={{ flexShrink: 0 }}
                    >
                        <TextHeader
                            selectedText={text}
                            processingVocab={vocabularyProcessing.processingVocab}
                            vocabError={vocabularyProcessing.vocabError}
                        />

                        <Box className="reader-page-mobile-vocab-card-wrapper">
                            <VocabDisplayCard
                                dictionaryEntry={textSelection.selectedDictionaryCard}
                            />
                        </Box>
                    </Collapse>

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
                sx={{ top: SNACKBAR_TOP }}
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
                className="reader-page-edit-save-error-snackbar"
                open={!!editSaveError}
                autoHideDuration={4000}
                onClose={() => setEditSaveError(null)}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
                sx={{ top: SNACKBAR_TOP }}
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

/**
 * The in-memory stand-in for `/reader/new` until its first Save. Only the fields
 * the page renders matter (TextHeader: the title); the id is the
 * NEW_DOCUMENT_ID sentinel the page checks for.
 */
function blankDraft(language: Text['language'] | undefined): Text {
    return {
        id: NEW_DOCUMENT_ID,
        title: 'New Document',
        content: '',
        language: language || 'zh',
        characterCount: 0,
        isUserCreated: true,
        createdAt: new Date().toISOString(),
    };
}

export default ReaderDocumentPage;
