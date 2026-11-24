import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Box, Collapse, Typography, useTheme, useMediaQuery } from "@mui/material";
import { useNotificationFor } from "../../components/notifications/useNotify";
import { HeaderIconButton } from "../../components/PageHeader";
import ReaderDocumentSurface from "./ReaderDocumentSurface";
import { useAuth } from "../../AuthContext";
import { API_BASE_URL } from "../../constants";
import { apiPost, apiPut, ApiError } from "../../api/http";
import { NEW_DOCUMENT_ID } from "./readerPaths";
import { DOCUMENT_TITLE_MAX_LENGTH, type TextKind } from "../../../server/contracts/wire";
import VocabDisplayCard from "../../components/VocabDisplayCard";
import type { Text, Language } from "../../types";
import ReadingEipHost from "../../reading/ReadingEipHost";
import ReadingTapRegion from "../../reading/ReadingTapRegion";
import { useReadingText } from "../../reading/useReadingText";
import { useReadingKeycap } from "../../reading/useReadingKeycap";
import { useReadingVocabSync } from "../../reading/useReadingVocabSync";

import TextHeader from "./TextHeader";
import TextArea from "../../reading/TextArea";
import ReaderEditToolbar from "./ReaderEditToolbar";
import DeleteDocumentDialog from "./DeleteDocumentDialog";
import IconPickerDialog from "../../components/IconPickerDialog";
import { readerMutedTextSx, readerSearchColors, readerSelectionColor } from "../../reading/readerStyles";
import ReaderCpcdView from "../../reading/ReaderCpcdView";
import ReaderDisplayToggle from "../../reading/ReaderDisplayToggle";
import ReaderPhraseToggle from "../../reading/ReaderPhraseToggle";
import { useReaderStepMode } from "../../reading/useReaderStepMode";
import ReaderReadAloudButton from "../../reading/ReaderReadAloudButton";
import ReaderIconKey from "../../reading/ReaderIconKey";
import ReaderSearchBar from "./ReaderSearchBar";
import { useReaderSearch } from "./useReaderSearch";
import type { ReaderSearchMatch } from "./readerSearch";
import { scrollSelectionIntoView } from "../../reading/textSelectionUtils";
import { ReaderAudioChip } from "../../components/AudioModeChip";
import { useReaderAudioSettings } from "../../reading/useReaderAudioSettings";
import { useReaderReadAloud } from "../../reading/useReaderReadAloud";
import { useSegmentOverrides } from "../../reading/useSegmentOverrides";
import { usePronunciationOverrides } from "../../reading/usePronunciationOverrides";
import { shiftPronunciationOverrides } from "../../reading/pronunciationOverrides";
import type { PronunciationOverride } from "../../../server/contracts/wire";
import { useFlashcardLearnSettings } from "../../hooks/useFlashcardLearnSettings";

import { useVocabularyProcessing } from "../../hooks/useVocabularyProcessing";
import { useReaderContentEditor } from "./useReaderContentEditor";
import { buildReaderPronunciationMap, type SpanRange } from "../../reading/documentSegmentation";
import type { SentenceRange } from "../../reading/readerSentences";
import { useEnglishTranslations } from "../../reading/useEnglishTranslations";
import { useReaderSettings } from "./useReaderSettings";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useTier2Look } from "../../timeOfDay/useTier2Look";
import { useLockBodyScroll } from "../../hooks/useLockBodyScroll";
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

const EDIT_TOOLBAR_ANIM_MS = 300;
const EDIT_TOOLBAR_ANIM_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

// READER OPEN-DOCUMENT PAGE — routed at `/reader/:id`, a footerless NODE-style
// drill-in from the `/reader` list (docs/LEAF_NODE_PAGES.md § Reader). Fetches its
// own Text by id (the routed-detail-page pattern), so it is
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
    // Tier 2 time-of-day look (docs/SHELF_REDESIGN.md § 7b): sky-tint ground by day, slate
    // at night, like the Dictionary. Called ONCE here and passed down. The dictionary
    // keycap (VocabDisplayCard) and the eip sheet do NOT take it — the keycap stays the
    // white day keycap and the eip follows the Settings theme (owner's call 2026-11-17).
    const look = useTier2Look();
    const { token, user } = useAuth();
    const isNewDraft = id === NEW_DOCUMENT_ID;
    // A new draft's collection (texts.kind, migration 194): `/reader/new?kind=journal`
    // when ReaderPage's Journal tile was selected (readerPaths.ts → newDocumentPath).
    // Read only for a draft; it is sent on the first Save and fixed from then on.
    const [searchParams] = useSearchParams();
    const draftKind: TextKind = searchParams.get('kind') === 'journal' ? 'journal' : 'document';
    // Set on a draft's first Save, just before the URL is replaced with the new id —
    // so the fetch effect below, which re-runs on the id change, knows the page
    // already holds this document (and its processed vocab) and skips a reload.
    const justCreatedIdRef = useRef<string | null>(null);
    useLockBodyScroll();

    // KEYBOARD LIFT (docs/USER_DOCUMENT_FEATURE_SUMMARY.md § Editing). While editing
    // with a keyboard up — ours or the OS's, `useKeyboardInset` is the union — the
    // title block and vocab card fold away so the text box rises to sit just under
    // the edit toolbar, and the content area reserves the keyboard's height at the
    // bottom so the box ends at the keyboard's top edge instead of behind it. Both
    // ride the keyboard's own slide curve, so the box goes up WITH the keyboard and
    // comes back down with it (the provider zeroes the inset as the exit starts).
    // The fold itself is ALSO held shut for the whole of edit mode (owner's call
    // 2026-11-18): dismissing the keyboard mid-edit — or a toolbar tap that blurs the
    // field on touch — must not bring the rdb back down while the editor is open.
    // The bottom keyboard clearance still follows the inset.
    const keyboardInset = useKeyboardInset();
    const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

    const [text, setText] = useState<Text | null>(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);

    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

    const [savingEdit, setSavingEdit] = useState(false);
    const [editSaveError, setEditSaveError] = useState<string | null>(null);

    // DOCUMENT ICON (texts."iconId", migration 193; docs/USER_DOCUMENT_FEATURE_SUMMARY.md
    // § "Document icon"). Part of the edit DRAFT, like the content: seeded from the saved
    // icon on Edit, changed by the toolbar's icon button + IconPickerDialog, sent with
    // Save and simply dropped by Cancel. Not on the undo/redo stack — that history is the
    // text's typing bursts (useReaderContentEditor); re-picking is the icon's undo.
    const [draftIconId, setDraftIconId] = useState<string | null>(null);
    // DOCUMENT TITLE (docs/USER_DOCUMENT_FEATURE_SUMMARY.md § Editing). Also part of the
    // edit draft: while the editor is open the header title is a text field bound to
    // this (ReaderDocumentSurface `editableTitle`). Seeded with the saved title on Edit,
    // and with "" on a new draft — whose placeholder then shows "New Document" and whose
    // title the server derives from the content unless the learner types one. Sent with
    // Save only when it is non-blank and changed (titleToSave); Cancel drops it.
    const [draftTitle, setDraftTitle] = useState("");
    const [iconPickerOpen, setIconPickerOpen] = useState(false);

    const vocabularyProcessing = useVocabularyProcessing();
    const readerSettings = useReaderSettings();
    // The display strip's audio chip: the Reader's OWN mute / default / media setting
    // (separate from the app-wide narration chip), driving TAP-TO-HEAR below.
    const readerAudio = useReaderAudioSettings();
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
            setText(blankDraft(user?.selectedLanguage, draftKind));
            contentEditor.enterEditMode('');
            setDraftIconId(null);
            setDraftTitle("");
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

    // TIEBREAK SWITCHES (src/reading/useSegmentOverrides): the alternatives the learner
    // switched to in the Pinyin view, forced into the gsa below.
    const { overrides: activeOverrides, switchToAlternative: applyAlternative } = useSegmentOverrides(text?.content);

    // Pinyin display mode (ReaderCpcdView): the pinyin under each word, and the device's
    // "Color pinyin by tone" preference (Settings → Display) for its tint.
    const pronunciations = useMemo(() => buildReaderPronunciationMap(
        vocabularyProcessing.loadedDictionaryCards,
        vocabularyProcessing.loadedPersonalCards
    ), [vocabularyProcessing.loadedDictionaryCards, vocabularyProcessing.loadedPersonalCards]);
    const { settings: { showPinyinColor } } = useFlashcardLearnSettings();

    // READING CHOICES (src/reading/usePronunciationOverrides; docs/USER_DOCUMENT_FEATURE_SUMMARY.md
    // § "Reading choices"): per-occurrence readings for multi-reading words, picked by tapping
    // the keycap's headword and saved with the document (texts."pronunciationOverrides",
    // migration 207). Pinyin is Chinese-only, so another language gets no choices at all.
    // Saved by a choices-only PUT (no "Recently edited" stamp); an edit's Save carries the
    // shifted list itself (handleSaveEdit).
    const [readingChoiceSaveError, setReadingChoiceSaveError] = useState<string | null>(null);
    useNotificationFor(readingChoiceSaveError, () => setReadingChoiceSaveError(null), { id: "reader-reading-choice-save-error", tone: "error" });
    const savedTextId = text && text.id !== NEW_DOCUMENT_ID ? text.id : null;
    const persistReadingChoices = useMemo(
        () => (savedTextId
            ? (list: PronunciationOverride[]) => apiPut<Text>(`/api/texts/${savedTextId}`, { pronunciationOverrides: list })
            : undefined),
        [savedTextId]
    );
    const readingChoices = usePronunciationOverrides({
        saved: text?.pronunciationOverrides,
        persist: persistReadingChoices,
        onPersistError: () => setReadingChoiceSaveError("Couldn't save the reading choice"),
    });
    const { flush: flushReadingChoices } = readingChoices;
    const readingChoicesEnabled = text?.language === 'zh';
    const readingAt = readingChoicesEnabled ? readingChoices.lookup : undefined;
    const cpcdScrollRef = useRef<HTMLDivElement | null>(null);

    // English words → the Chinese entry each translates to (docs/USER_DOCUMENT_FEATURE_SUMMARY.md
    // § "English words"): one batch lookup per document; the keycap then shows that entry for a
    // highlighted English word exactly as for a Chinese one.
    const englishTranslations = useEnglishTranslations(text?.content, text?.language);

    // PHRASE STEPPING (docs/READER_SEGMENTATION.md § "Phrase stepping"): the strip's Phrase
    // pill — per device, shared with cyoa. The rules are Chinese grammar, so a document in any
    // other language always steps by word (and shows no pill).
    const { stepMode, setStepMode } = useReaderStepMode();
    const phraseStepping = text?.language === 'zh';

    // The document read with the engine (src/reading/useReadingText): its gsa word spans
    // (docs/READER_SEGMENTATION.md, with the tiebreak switches forced in), the step units
    // navigation walks (phrases with the Phrase pill on), and its selection.
    const { spans: segmentSpans, stepSpans, selection: textSelection, drillAtOffset } = useReadingText({
        content: text?.content ?? '',
        dictionaryCards: vocabularyProcessing.loadedDictionaryCards,
        personalCards: vocabularyProcessing.loadedPersonalCards,
        translateEnglish: englishTranslations.translate,
        overrides: activeOverrides,
        autoSelectEnabled: readerSettings.autoSelectEnabled,
        stepByPhrase: phraseStepping && stepMode === 'phrase',
    });

    const handleTextChangeWithActivity = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        textSelection.handleTextChange(event);
    }, [textSelection]);

    const handleAutoWordSelectWithActivity = useCallback((event: React.SyntheticEvent<HTMLDivElement>) => {
        textSelection.handleAutoWordSelect(event);
    }, [textSelection]);

    const handleTextSelectionChangeWithActivity = useCallback((event: React.SyntheticEvent<HTMLDivElement>) => {
        textSelection.handleTextSelectionChange(event);
    }, [textSelection]);

    // Selection tint: primary blue by day, the brighter bluMk mark tier at night so it
    // reads on the slate reading card (readerStyles → readerSelectionColor).
    const selectionColors = useMemo(() => ({
        backgroundColor: readerSelectionColor(look.dark, theme.palette.primary.main),
    }), [look.dark, theme.palette.primary.main]);
    // The search bar's match washes — yellow built like the blue selection above
    // (readerStyles → readerSearchColors); handed to both reading views.
    const searchColors = useMemo(() => readerSearchColors(look.dark), [look.dark]);

    // Vocabulary update listeners: keep loadedPersonalCards in sync with entries
    // added/edited/removed elsewhere in the app while this document is open.
    useReadingVocabSync(text?.content ?? null, vocabularyProcessing.setLoadedPersonalCards, [textSelection]);

    // Focus the reading box once the document loads, caret parked at the top. No word
    // is highlighted: the page opens in useTextSelection's NOTHING-SELECTED MODE, and
    // the first word lights up only when the learner taps / arrows to it. Keyed on the
    // document id only — must NOT re-run (and reset the caret)
    // on every auto-select toggle.
    // Not for a new draft: it opens in edit mode, whose textarea focuses itself
    // (TextArea), and the reading box does not exist yet.
    //
    // ⚠️ Gated on `!loading`, not just `text?.id`: the fetch sets `text` BEFORE it awaits
    // the vocabulary pass, and the reading box only mounts once `loading` clears
    // (`!loading && text` in the render below). Keyed on the id alone, this effect ran
    // while the box was still unmounted, so `focusTextArea` found no textarea and the page
    // opened unfocused. The tap overlay's pointerdown is preventDefault'd (it never
    // focuses), so the first forward tap stepped an unfocused textarea whose `select`
    // never reached React — no highlight, no keycap entry: a "dead" first tap. It only
    // bit a document's FIRST open in a session; a re-open skips the vocab fetch, so both
    // state updates landed in one render and the box was there in time.
    const focusTextArea = textSelection.focusTextArea;
    useEffect(() => {
        if (!loading && text && text.id !== NEW_DOCUMENT_ID) focusTextArea(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [text?.id, loading]);

    // SENTENCE MODE (useTextSelection → selectedSentence): the highlighted sentence, which
    // both reading views paint; the keycap's sentence face is useReadingKeycap's.
    const selectedSentence = textSelection.selectedSentence;
    // The Pinyin display mode's cpcd view replaces the reading box (reading mode only).
    // It also switches the tap overlay to scroll the cpcd box and swallow long-presses.
    const showCpcd = readerSettings.displayMode === 'pinyin' && !contentEditor.editMode;

    // SEARCH (docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Search"): the strip's search key
    // opens ReaderSearchBar over the whole strip. Matches are yellow in either display
    // mode (ReaderSearchHighlights / ReaderCpcdView); in the Pinyin mode of a Chinese
    // document the query is also matched against the pinyin (readerSearch.ts).
    // The CURRENT match is also SELECTED (owner's call 2026-11-18) — the keycap shows it
    // and Read starts from it — without taking focus from the search field, so its
    // keyboard stays up while stepping; closing the bar refocuses the reading box on it.
    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const searchKeyRef = useRef<HTMLButtonElement | null>(null);
    const displayStripRowRef = useRef<HTMLDivElement | null>(null);
    // The search key's box in the strip row when the bar opened — where its grow starts.
    const [searchOrigin, setSearchOrigin] = useState<{ left: number; right: number } | null>(null);
    const { selectRange, getRecordedSelection, inputRef: readingBoxRef } = textSelection;

    // Tap on a tiebreak alternative (ReaderCpcdView's yellow cells) → make it the word
    // (useSegmentOverrides → switchToAlternative), then select it.
    const switchToAlternative = useCallback(
        (alternative: SpanRange) => applyAlternative(alternative, selectRange),
        [applyAlternative, selectRange]
    );
    const showCpcdRef = useRef(showCpcd);
    showCpcdRef.current = showCpcd;
    const handleCurrentMatch = useCallback((match: ReaderSearchMatch) => {
        selectRange(match.start, match.end, { focus: false });
        // The Text mode's textarea does not scroll to a programmatic selection by itself;
        // the Pinyin view keeps its current match in view on its own.
        const textarea = readingBoxRef.current;
        if (textarea && !showCpcdRef.current) scrollSelectionIntoView(textarea, match);
    }, [selectRange, readingBoxRef]);
    // The recorded selection, not the textarea's `selectionStart`: while the search field
    // has focus a step only RECORDS the match (selectRange `focus: false`).
    const getSearchAnchor = useCallback(() => getRecordedSelection().start, [getRecordedSelection]);
    const search = useReaderSearch({
        content: text?.content ?? '',
        spans: segmentSpans,
        pronunciations,
        readingAt,
        matchPinyin: showCpcd && text?.language === 'zh',
        getAnchorOffset: getSearchAnchor,
        onCurrentMatch: handleCurrentMatch,
    });
    const { openSearch: openSearchState, closeSearch: closeSearchState } = search;
    const handleOpenSearch = useCallback(() => {
        const key = searchKeyRef.current?.getBoundingClientRect();
        const row = displayStripRowRef.current?.getBoundingClientRect();
        setSearchOrigin(key && row ? { left: key.left - row.left, right: row.right - key.right } : null);
        openSearchState();
    }, [openSearchState]);
    const { selectSpanAtOffset } = textSelection;
    const handleCloseSearch = useCallback(() => {
        // Read before closing: the recorded range is the current match (or wherever a tap
        // stepped to while the bar was up).
        const { start, end } = getRecordedSelection();
        closeSearchState();
        // Back to the reading box (focusTextArea restores the recorded range)...
        focusTextArea(true);
        // ...then select the WORD the reader was on (owner's call 2026-11-18). A match may
        // be part of a word (好 in 你好, "zhi" in 没治) or span several, and a range that is
        // not exactly one gsa span highlights nothing in the Pinyin view. A match starting
        // on punctuation / whitespace (in no word) keeps its own range; a collapsed caret
        // (no match was ever selected) is left alone.
        if (end > start) selectSpanAtOffset(start);
    }, [getRecordedSelection, closeSearchState, focusTextArea, selectSpanAtOffset]);
    // A tap on the reading area while the search field has focus: give the reading box
    // its focus back first (dropping the search keyboard), so the tap steps / jumps from
    // the current match and the keycap follows — the textarea only reports selection
    // changes while focused. The bar and its highlights stay up.
    const handleTapRegionPointerDown = useCallback(() => {
        if (searchInputRef.current && document.activeElement === searchInputRef.current) focusTextArea(true);
    }, [focusTextArea]);

    // READ ALOUD (useReaderReadAloud): the display strip's play button reads from the caret,
    // one clause per clip, moving the word selection along with the audio. While it plays,
    // any tap, click or key press stops it AND still does its own job (the hook's window
    // listeners); a drag or wheel scrolls instead and keeps reading.
    // With a sentence selected (SENTENCE MODE) it reads only that sentence (owner's call
    // 2026-11-23). Read through a ref so the press sees the sentence of this very render.
    const selectedSentenceRef = useRef(selectedSentence);
    selectedSentenceRef.current = selectedSentence;
    const getSelectedSentence = useCallback(() => selectedSentenceRef.current, []);
    // ...and when that read finishes on its own, the sentence is selected again.
    const { selectSentenceAtOffset } = textSelection;
    const reselectSentence = useCallback(
        (sentence: SentenceRange) => { selectSentenceAtOffset(sentence.start); },
        [selectSentenceAtOffset]
    );
    // The pinyin hint is Chinese-only; in a Chinese document English words get the English voice.
    const readAloud = useReaderReadAloud({
        content: text?.content ?? '',
        spans: segmentSpans,
        pronunciations: text?.language === 'zh' ? pronunciations : null,
        readingAt,
        inputRef: textSelection.inputRef,
        selectRange: textSelection.selectRange,
        documentLanguage: text?.language,
        textareaVisible: !showCpcd,
        getSelectedSentence,
        reselectSentence,
    });

    // THE DICTIONARY KEYCAP (src/reading/useReadingKeycap): its faces (tap demo, pawn,
    // Sentence Explain), its keys (speaker, Add, More Info → the eip), TAP-TO-HEAR and its
    // preloading (docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Tap-to-hear"), driven by the
    // display strip's audio chip (useReaderAudioSettings). Tap-to-hear stands down while the
    // read-aloud steps the selection (it is already speaking), in edit mode, and while the
    // search field has focus (typing a query re-selects the first match on every keystroke,
    // and each one would speak).
    const searchFieldFocused = useCallback(
        () => !!searchInputRef.current && document.activeElement === searchInputRef.current,
        []
    );
    const keycap = useReadingKeycap({
        text: { spans: segmentSpans, selection: textSelection },
        content: text?.content ?? '',
        language: (text?.language ?? user?.selectedLanguage ?? 'zh') as Language,
        dictionaryCards: vocabularyProcessing.loadedDictionaryCards,
        vocabLoading: vocabularyProcessing.processingVocab,
        translateEnglish: englishTranslations.translate,
        translationInLearning: englishTranslations.translationInLearning,
        autoplay: readerAudio.autoplay,
        readAloudPlaying: readAloud.playing,
        editing: contentEditor.editMode,
        isQuiet: searchFieldFocused,
        readingChoices: readingChoicesEnabled ? readingChoices : undefined,
    });
    const { wordActions, tapZoneFlash, clearTapZoneFlash } = keycap;

    // The reading box re-takes focus whenever it is blurred (useTextSelection) — except
    // while the eip is open, whose controls (tabs, search field, buttons) need focus. The
    // dialog-close effect below hands focus back when it closes.
    const { handleTextAreaBlur } = textSelection;
    const eipOpen = wordActions.eipOpen;
    const handleReadingBoxBlur = useCallback((event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (eipOpen) return;
        handleTextAreaBlur(event);
    }, [eipOpen, handleTextAreaBlur]);
    // An inline edit that failed to save.
    useNotificationFor(editSaveError, () => setEditSaveError(null), { id: "reader-edit-save-error", tone: "error" });

    // Return focus + re-highlight when a dialog closes (see original rationale in
    // docs/READER_SEGMENTATION.md / useTextSelection). Inline edit mode is treated
    // the same way — closing it (cancel or save) hands the reading box back its
    // focus/highlight.
    const anyDialogOpen = deleteDialogOpen || contentEditor.editMode || wordActions.eipOpen;
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
    // current content, and turns the header title into a text field (draftTitle).
    const handleEdit = useCallback(() => {
        if (!text) return;
        setEditSaveError(null);
        // The editor replaces the reading box; the search bar would have nothing to search.
        closeSearchState();
        // Send any reading choice still waiting on its debounce now, against the content it
        // was made on — the edit's Save then sends the shifted list.
        flushReadingChoices();
        contentEditor.enterEditMode(text.content);
        setDraftIconId(text.iconId ?? null);
        setDraftTitle(text.title);
    }, [text, contentEditor, closeSearchState, flushReadingChoices]);

    // The title to send with Save, or undefined to send none. A blank field never
    // reaches the server (it rejects an empty title): on a new draft that means "derive
    // it from the content", on a saved document "keep the current title". An unchanged
    // title is not sent either, so a content-only edit stays a content-only PUT.
    const titleToSave = useMemo(() => {
        const trimmed = draftTitle.trim();
        if (!trimmed) return undefined;
        if (!isNewDraft && trimmed === text?.title) return undefined;
        return trimmed;
    }, [draftTitle, isNewDraft, text?.title]);

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
    // content unless one was typed into the header; the URL is then replaced (not pushed) so Back returns to the list,
    // not to an empty draft.
    const saveNewDraft = useCallback(async () => {
        const created = await apiPost<Text>('/api/texts', {
            content: contentEditor.draft,
            language: user?.selectedLanguage || 'zh',
            iconId: draftIconId,
            kind: draftKind,
            title: titleToSave,
        });
        await vocabularyProcessing.processDocumentVocabulary(created);
        setText(created);
        contentEditor.exitEditMode();
        justCreatedIdRef.current = created.id;
        navigate(`/reader/${created.id}`, { replace: true });
    }, [contentEditor, user?.selectedLanguage, draftIconId, draftKind, titleToSave, vocabularyProcessing, navigate]);

    const handleSaveEdit = useCallback(async () => {
        if (!text) return;

        setSavingEdit(true);
        setEditSaveError(null);
        try {
            if (isNewDraft) {
                await saveNewDraft();
                return;
            }
            // `iconId: null` is sent on purpose when the icon was removed — the server
            // treats null as "clear" and only an absent field as "leave as is".
            // `title` is omitted (undefined drops out of the JSON) unless it changed.
            // READING CHOICES ride along, shifted onto the edited content ("shift only":
            // pronunciationOverrides.ts → shiftPronunciationOverrides); the server re-checks them.
            const pronunciationOverrides = shiftPronunciationOverrides(text.content, contentEditor.draft, readingChoices.overrides);
            const updated = await apiPut<Text>(`/api/texts/${text.id}`, { content: contentEditor.draft, iconId: draftIconId, title: titleToSave, pronunciationOverrides });
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
    }, [text, isNewDraft, saveNewDraft, contentEditor, draftIconId, titleToSave, vocabularyProcessing, readingChoices.overrides]);

    const handleDelete = useCallback(() => {
        setDeleteDialogOpen(true);
    }, []);

    const handleDeleteSuccess = useCallback(() => {
        navigate("/reader");
    }, [navigate]);

    // See KEYBOARD LIFT above. The reading box suppresses both keyboards, so a keyboard
    // is up only for the editor or for the search field; the gate makes that explicit.
    // Searching lifts the same way (owner's call 2026-11-18): the title block and keycap
    // fold away and the text box ends at the keyboard — but the display strip, which
    // holds the search bar, stays (see the strip's own Collapse below).
    const liftKeyboardInset = contentEditor.editMode || search.open ? keyboardInset : 0;
    const keyboardLifted = liftKeyboardInset > 0;
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
    // The tap-to-hear audio chip leads the slot (moved up from the display strip
    // 2026-11-23, matching the cyoa story page's header — StoryPlayPage); it hides
    // with Edit/Delete while editing, since tap-to-hear is off in the plain field.
    const docHeaderRightContent = text ? (
        // A fragment, not a wrapping Box, so the header's own right-slot gap spaces these.
        // HeaderIconButton (not MUI IconButton) so they size like every other header action.
        <>
            {!contentEditor.editMode && (
                // preventDefault on mousedown keeps focus on the reading box (as the Read
                // pill and the switch do), so a desktop click doesn't trip the
                // blur → refocus loop.
                <Box
                    className="reader-page-text-header-audio-chip-wrapper"
                    onMouseDown={(event) => event.preventDefault()}
                    sx={{ display: 'flex' }}
                >
                    <ReaderAudioChip
                        className="reader-page-text-header-audio-chip"
                        // `look.ink`, the Read pill's text ink (readerPillButtonSx), not the
                        // secondary `ink2` other chips use — same ink as the story page's
                        // header chip (owner's call 2026-11-18).
                        ink={look.ink}
                        mode={readerAudio.mode}
                        onCycle={readerAudio.cycleMode}
                    />
                </Box>
            )}
            {!contentEditor.editMode && (
                <HeaderIconButton
                    className="reader-page-text-header-edit-button"
                    icon="edit"
                    label="Edit document"
                    title="Edit document"
                    color={look.ink2}
                    onClick={handleEdit}
                />
            )}
            {!contentEditor.editMode && (
                <HeaderIconButton
                    className="reader-page-text-header-delete-button"
                    icon="delete"
                    label="Delete document"
                    title="Delete document"
                    // dangerInk is plain ink in v2; the look's ink so it reads at night.
                    color={look.ink}
                    onClick={handleDelete}
                />
            )}
        </>
    ) : undefined;

    return (
        <ReaderDocumentSurface
            look={look}
            // The document's own title is the page title (2026-11-17; it used to be a
            // 22px heading above the dictionary card, under a header that said "Reader").
            // "Reader" only while there is no document yet (loading / not found).
            title={text?.title ?? "Reader"}
            // In edit mode the title is a text field instead (draftTitle). The placeholder
            // is the saved title (a new draft's "New Document"), so clearing the field shows
            // what Save will keep.
            editableTitle={contentEditor.editMode && text ? {
                value: draftTitle,
                onChange: setDraftTitle,
                placeholder: text.title,
                maxLength: DOCUMENT_TITLE_MAX_LENGTH,
                ariaLabel: "Document title",
                lineColor: look.outline,
                placeholderColor: look.muted,
            } : undefined}
            onBack={handleBack}
            rightContent={docHeaderRightContent}
        >
            {/* Drops in below the surface's own header while editing, full-width like
            the header itself — same placement/motion as the fie toolbar dropping in
            below FlashcardsLearnPage's header (CardEditToolbar.tsx). */}
            <Collapse in={contentEditor.editMode} timeout={EDIT_TOOLBAR_ANIM_MS} easing={EDIT_TOOLBAR_ANIM_EASING} unmountOnExit>
                <ReaderEditToolbar
                    look={look}
                    canUndo={contentEditor.canUndo}
                    canRedo={contentEditor.canRedo}
                    onUndo={contentEditor.undo}
                    onRedo={contentEditor.redo}
                    onCancel={handleCancelEdit}
                    onSave={handleSaveEdit}
                    saving={savingEdit}
                    saveDisabled={isNewDraft && !contentEditor.draft.trim()}
                    iconId={draftIconId}
                    onPickIcon={() => setIconPickerOpen(true)}
                />
            </Collapse>

            {/* Plain muted lines rather than a spinner / MUI Alert — the Reader's flat
                look (readerStyles.ts), the Friends board's loading copy. */}
            {loading && (
                <Typography className="reader-document-loading" sx={readerMutedTextSx(look)}>Loading…</Typography>
            )}

            {!loading && notFound && (
                <Typography className="reader-document-not-found" sx={readerMutedTextSx(look)}>Document not found.</Typography>
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
                    paddingBottom: { xs: `${16 + liftKeyboardInset}px`, sm: `${24 + liftKeyboardInset}px` },
                    transition: transitionForInset(liftKeyboardInset),
                }}>
                    {/* Folds away for the whole of edit mode — keyboard up or not
                    (owner's call 2026-11-18: a toolbar tap that blurs the field and drops
                    the keyboard must not bring the rdb back down mid-edit) — and while the
                    search keyboard is up, lifting the text box to the top of the page
                    (KEYBOARD LIFT). */}
                    <Collapse
                        className="reader-document-lead"
                        in={!keyboardLifted && !contentEditor.editMode}
                        timeout={liftTimeout}
                        easing={liftEasing}
                        sx={{ flexShrink: 0 }}
                    >
                        <TextHeader
                            look={look}
                            processingVocab={vocabularyProcessing.processingVocab}
                            vocabError={vocabularyProcessing.vocabError}
                        />

                        <Box className="reader-page-mobile-vocab-card-wrapper">
                            <VocabDisplayCard {...keycap.cardProps} />
                        </Box>
                    </Collapse>

                    {/* The strip folds with the keycap for the whole of edit mode (every
                    control in it is hidden while editing, so unfolded it would only leave
                    an empty gap above the text box). The search bar lives in it, so it
                    stays put above the text box while the search keyboard is up. */}
                    <Collapse
                        className="reader-document-strip-fold"
                        in={!contentEditor.editMode}
                        timeout={liftTimeout}
                        easing={liftEasing}
                        sx={{ flexShrink: 0 }}
                    >
                        {/* The display strip: a row under the keycap — the read-aloud play
                        button (ReaderReadAloudButton) and the search key (ReaderIconKey)
                        at its left edge (the tap-to-hear chip moved to the header's right
                        slot 2026-11-23 — docHeaderRightContent), the Phrase pill (ReaderPhraseToggle,
                        Chinese documents only) and the Pinyin pill (ReaderDisplayToggle) at its
                        right. All are
                        hidden — not removed — while editing (always the plain field) and
                        while the search bar lies over the row, so nothing jumps. */}
                        <Box
                            className="reader-document-display-strip"
                            // A press anywhere on the strip that isn't a text field keeps
                            // focus where it is — the open search field's keyboard stays up
                            // (so the rdb stays folded: KEYBOARD LIFT) when the press lands
                            // between the bar's keys or on the strip's padding; with the bar
                            // closed, the reading box keeps its focus. Same rule as the edit
                            // toolbar (ReaderEditToolbar → onMouseDown).
                            onMouseDown={(event) => {
                                const target = event.target as HTMLElement;
                                if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') event.preventDefault();
                            }}
                            sx={{ pb: 1 }}
                        >
                            {/* The row itself: positioned so the open search bar lies over
                            exactly it (not the strip's bottom padding). */}
                            <Box
                                ref={displayStripRowRef}
                                className="reader-document-display-strip__row"
                                sx={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                            >
                                {/* The left group: Read, then the search key. */}
                                <Box
                                    className="reader-document-display-strip__audio"
                                    sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                                >
                                    <ReaderReadAloudButton
                                        look={look}
                                        playing={readAloud.playing}
                                        onStart={readAloud.start}
                                        onStop={readAloud.stop}
                                        disabled={segmentSpans.length === 0}
                                        hidden={contentEditor.editMode || search.open}
                                    />
                                    <ReaderIconKey
                                        look={look}
                                        className="reader-document-search-key"
                                        buttonRef={searchKeyRef}
                                        icon="search"
                                        label="Find in document"
                                        onClick={handleOpenSearch}
                                        disabled={!text.content}
                                        hidden={contentEditor.editMode || search.open}
                                    />
                                </Box>
                                {/* The right group: the Phrase pill, then the Pinyin pill. */}
                                <Box
                                    className="reader-document-display-strip__modes"
                                    sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                                >
                                    {phraseStepping && (
                                        <ReaderPhraseToggle
                                            look={look}
                                            className="reader-document-phrase-toggle"
                                            value={stepMode}
                                            onChange={setStepMode}
                                            hidden={contentEditor.editMode || search.open}
                                        />
                                    )}
                                    <ReaderDisplayToggle
                                        look={look}
                                        className="reader-document-display-mode-toggle"
                                        value={readerSettings.displayMode}
                                        onChange={readerSettings.setDisplayMode}
                                        hidden={contentEditor.editMode || search.open}
                                    />
                                </Box>
                                {search.open && !contentEditor.editMode && (
                                    <ReaderSearchBar
                                        look={look}
                                        query={search.query}
                                        onQueryChange={search.setQuery}
                                        matchCount={search.matches.length}
                                        currentIndex={search.currentIndex}
                                        onStep={search.step}
                                        onClose={handleCloseSearch}
                                        placeholder={showCpcd && text.language === 'zh' ? "Find text or pinyin" : "Find in text"}
                                        origin={searchOrigin}
                                        inputRef={searchInputRef}
                                    />
                                )}
                            </Box>
                        </Box>
                    </Collapse>

                    {/* Full-bleed: pulled out over the content box's side padding so the reading
                    box's scrollbar sits on the screen's edge; the box folds that padding into
                    its own (readerStyles → READER_TEXT_PADDING_SX), so the text margin holds. */}
                    <Box className="reader-page-text-content-area" sx={{ flexGrow: 1, minHeight: 0, display: 'flex', gap: 3, position: 'relative', mx: { xs: -2, sm: -3 } }}>
                        <TextArea
                            look={look}
                            selectedText={text}
                            autoSelectEnabled={readerSettings.autoSelectEnabled && !contentEditor.editMode}
                            // Arrow keys walk the step units (phrases with the Phrase pill on).
                            segmentSpans={stepSpans}
                            selectionColors={selectionColors}
                            onTextChange={handleTextChangeWithActivity}
                            onAutoWordSelect={handleAutoWordSelectWithActivity}
                            onTextSelectionChange={handleTextSelectionChangeWithActivity}
                            inputRef={textSelection.inputRef}
                            onBlur={handleReadingBoxBlur}
                            onUserInteraction={textSelection.noteUserInteraction}
                            editMode={contentEditor.editMode}
                            draftContent={contentEditor.draft}
                            onDraftChange={contentEditor.handleDraftChange}
                            searchMatches={search.open ? search.matches : undefined}
                            currentMatchIndex={search.currentIndex}
                            searchColors={searchColors}
                            onSelectSentenceAtOffset={textSelection.selectSentenceAtOffset}
                            cpcdView={showCpcd ? (
                                <ReaderCpcdView
                                    content={text.content}
                                    language={text.language as Language}
                                    segmentSpans={segmentSpans}
                                    pronunciations={pronunciations}
                                    readingAt={readingAt}
                                    selectionRange={textSelection.selectionRange}
                                    highlightColor={selectionColors.backgroundColor}
                                    showPinyinColor={showPinyinColor}
                                    onSelectRange={textSelection.selectRange}
                                    onSwitchToAlternative={switchToAlternative}
                                    scrollRef={cpcdScrollRef}
                                    isAutoScrollPaused={readAloud.isFollowPaused}
                                    inkColor={look.ink}
                                    searchMatches={search.open ? search.matches : undefined}
                                    currentMatchIndex={search.currentIndex}
                                    searchColors={searchColors}
                                    selectedSentence={selectedSentence}
                                    onSelectSentenceAtOffset={textSelection.selectSentenceAtOffset}
                                    stepSpans={stepSpans}
                                    onTapInsideSelection={drillAtOffset}
                                />
                            ) : undefined}
                        />
                        {/* TAP REGION (owner's call 2026-11-17): tap-to-navigate covers the
                        whole screen below the display strip, not just the reading box —
                        anchored to this area's top (the strip's bottom edge), as wide as the
                        full-bleed area (already the screen's width) and pushed out over the
                        content box's bottom gutter.
                        Reading mode only: edit mode is a plain editable field. */}
                        {!contentEditor.editMode && (
                            <ReadingTapRegion
                                className="reader-page-tap-region"
                                onPointerDownCapture={handleTapRegionPointerDown}
                                bottom={{ xs: -(16 + liftKeyboardInset), sm: -(24 + liftKeyboardInset) }}
                                inputRef={textSelection.inputRef}
                                scrollRef={showCpcd ? cpcdScrollRef : undefined}
                                wordSource={showCpcd ? "pinyin" : "text"}
                                onSelectSpanAtOffset={textSelection.selectSpanAtOffset}
                                onClearSelection={textSelection.clearSelection}
                                onSelectSentence={textSelection.selectSentenceAtSelection}
                                onTapInsideSelection={drillAtOffset}
                                flash={tapZoneFlash}
                                onFlashEnd={clearTapZoneFlash}
                                night={look.dark}
                            />
                        )}
                    </Box>
                </Box>
            )}

            {/* The keycap's More Info → the word's eip (src/reading/ReadingEipHost). */}
            <ReadingEipHost wordActions={wordActions} />

            <DeleteDocumentDialog
                look={look}
                open={deleteDialogOpen}
                text={text}
                onClose={() => setDeleteDialogOpen(false)}
                onSuccess={handleDeleteSuccess}
            />

            {/* Document icon picker — the shared icon browser (avatar + fie use it too).
                Opened from ReaderEditToolbar's icon button; picking or removing only
                changes the DRAFT icon (see DOCUMENT ICON above), Save stores it.
                IconPickerDialog caches the icon (ensureIcon8) before onPick, so the id
                always satisfies texts."iconId"'s FK to icons8. */}
            <IconPickerDialog
                open={iconPickerOpen}
                onClose={() => setIconPickerOpen(false)}
                title="Choose a document icon"
                currentIconId={draftIconId}
                onPick={(iconId) => setDraftIconId(iconId)}
                onRemove={async () => setDraftIconId(null)}
                removeLabel="Remove icon"
            />

        </ReaderDocumentSurface>
    );
}

/**
 * The in-memory stand-in for `/reader/new` until its first Save. Only the fields
 * the page renders matter (the header title, which is also the title field's
 * placeholder while editing); the id is the
 * NEW_DOCUMENT_ID sentinel the page checks for.
 */
function blankDraft(language: Text['language'] | undefined, kind: TextKind): Text {
    const now = new Date().toISOString();
    return {
        id: NEW_DOCUMENT_ID,
        title: kind === 'journal' ? 'New Journal Entry' : 'New Document',
        content: '',
        language: language || 'zh',
        characterCount: 0,
        isUserCreated: true,
        kind,
        createdAt: now,
        updatedAt: now,
        pronunciationOverrides: [],
    };
}

export default ReaderDocumentPage;
