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
import type { TextKind } from "../../../server/contracts/wire";
import VocabDisplayCard from "../../components/VocabDisplayCard";
import { useVocabularyUpdate } from "../../contexts/VocabularyUpdateContext";
import { processDocumentForTokens } from "../../utils/tokenUtils";
import type { VocabEntry, Text, Language } from "../../types";
import EipSheet from "../flashcards/FlashcardsLearnPage/EipSheet";
import EipAddKey from "../flashcards/FlashcardsLearnPage/EipAddKey";
import ReaderMoreInfoKey from "./ReaderMoreInfoKey";
import ReaderTapHint from "./ReaderTapHint";
import ReaderKeycapPawn from "./ReaderKeycapPawn";
import ReaderTapOverlay, { type TapZoneFlash, type TapZoneSide } from "./ReaderTapOverlay";
import { EIP_ADD_KEY_SIZES } from "../flashcards/FlashcardsLearnPage/eipAddKeySizes";
import { useReaderWordActions } from "./useReaderWordActions";

import TextHeader from "./TextHeader";
import TextArea from "./TextArea";
import ReaderEditToolbar from "./ReaderEditToolbar";
import DeleteDocumentDialog from "./DeleteDocumentDialog";
import IconPickerDialog from "../../components/IconPickerDialog";
import { readerMutedTextSx } from "./readerStyles";
import ReaderCpcdView from "./ReaderCpcdView";
import ReaderDisplayToggle from "./ReaderDisplayToggle";
import ReaderReadAloudButton from "./ReaderReadAloudButton";
import { ReaderAudioChip } from "../../components/AudioModeChip";
import { useReaderAudioSettings } from "./useReaderAudioSettings";
import { useReaderAudioPreload } from "./useReaderAudioPreload";
import { findDictionaryMatch } from "./textSelection";
import { useReaderReadAloud } from "./useReaderReadAloud";
import { useFlashcardLearnSettings } from "../../hooks/useFlashcardLearnSettings";

import { useVocabularyProcessing } from "../../hooks/useVocabularyProcessing";
import { useReaderContentEditor } from "./useReaderContentEditor";
import { buildReaderDictMap, buildExcludeSet, buildReaderPronunciationMap, computeSegmentSpans } from "./documentSegmentation";
import { useTextSelection } from "./useTextSelection";
import { useEnglishTranslations } from "./useEnglishTranslations";
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

// The minimum visible space above, between and below the dictionary keycap's two STACKED
// header controls, px (they otherwise spread evenly from the face's top edge to the divider).
const KEYCAP_ACTIONS_GAP_PX = 6;
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

    const [savingEdit, setSavingEdit] = useState(false);
    const [editSaveError, setEditSaveError] = useState<string | null>(null);

    // DOCUMENT ICON (texts."iconId", migration 193; docs/USER_DOCUMENT_FEATURE_SUMMARY.md
    // § "Document icon"). Part of the edit DRAFT, like the content: seeded from the saved
    // icon on Edit, changed by the toolbar's icon button + IconPickerDialog, sent with
    // Save and simply dropped by Cancel. Not on the undo/redo stack — that history is the
    // text's typing bursts (useReaderContentEditor); re-picking is the icon's undo.
    const [draftIconId, setDraftIconId] = useState<string | null>(null);
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

    // Pinyin display mode (ReaderCpcdView): the pinyin under each word, and the device's
    // "Color pinyin by tone" preference (Settings → Display) for its tint.
    const pronunciations = useMemo(() => buildReaderPronunciationMap(
        vocabularyProcessing.loadedDictionaryCards,
        vocabularyProcessing.loadedPersonalCards
    ), [vocabularyProcessing.loadedDictionaryCards, vocabularyProcessing.loadedPersonalCards]);
    const { settings: { showPinyinColor } } = useFlashcardLearnSettings();
    const cpcdScrollRef = useRef<HTMLDivElement | null>(null);

    // English words → the Chinese entry each translates to (docs/USER_DOCUMENT_FEATURE_SUMMARY.md
    // § "English words"): one batch lookup per document; the keycap then shows that entry for a
    // highlighted English word exactly as for a Chinese one.
    const englishTranslations = useEnglishTranslations(text?.content, text?.language);

    const textSelection = useTextSelection(
        vocabularyProcessing.loadedPersonalCards,
        vocabularyProcessing.loadedDictionaryCards,
        readerSettings.autoSelectEnabled,
        segmentSpans,
        englishTranslations.translate
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

    // Selection tint: a touch stronger at night so it reads on the slate reading card.
    // Keyed on the time-of-day look (the card's colour), not the Settings theme.
    const selectionColors = useMemo(() => ({
        backgroundColor: theme.palette.primary.main + (look.dark ? '40' : '30'), // 25% / ~19% opacity
    }), [look.dark, theme.palette.primary.main]);

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

    // Focus the reading box once the document loads, caret parked at the top. No word
    // is highlighted: the page opens in useTextSelection's NOTHING-SELECTED MODE, and
    // the first word lights up only when the learner taps / arrows to it. Keyed on the
    // document id only — must NOT re-run (and reset the caret)
    // on every auto-select toggle.
    // Not for a new draft: it opens in edit mode, whose textarea focuses itself
    // (TextArea), and the reading box does not exist yet.
    const focusTextArea = textSelection.focusTextArea;
    useEffect(() => {
        if (text && text.id !== NEW_DOCUMENT_ID) focusTextArea(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [text?.id]);

    // The tap-to-navigate hint lives IN the dictionary keycap while nothing is selected
    // (NOTHING-SELECTED MODE, useTextSelection) — it replaced the 5 s `reader-tap-hint`
    // app notification (2026-11-17), so it stays up exactly as long as it is useful.
    const showNavigationHint = textSelection.awaitingFirstSelection;
    // The hint's face (ReaderTapHint: the tap-divide demo). Built once so VocabDisplayCard's
    // memo comparison (`idleHint` by identity) does not see a new element every render.
    // Tapping the demo flashes the matching REAL zone over the reading box
    // (ReaderTapOverlay → ZONE FLASH); the bumped id replays it on a repeat tap.
    // Cleared once it has played (`clearTapZoneFlash`): the overlay unmounts in edit mode,
    // and a request still set when it remounts on Cancel/Save would flash again.
    const [tapZoneFlash, setTapZoneFlash] = useState<TapZoneFlash | null>(null);
    const flashTapZone = useCallback((side: TapZoneSide) => {
        setTapZoneFlash((prev) => ({ side, id: (prev?.id ?? 0) + 1 }));
    }, []);
    const clearTapZoneFlash = useCallback(() => setTapZoneFlash(null), []);
    // The finger demo plays only the FIRST time the hint shows on this page. A long-press
    // on empty space brings the hint back (ReaderTapOverlay → `onClearSelection`), and
    // there it appears at rest (owner's call 2026-11-17).
    const [tapDemoPlayed, setTapDemoPlayed] = useState(false);
    useEffect(() => {
        if (!showNavigationHint) setTapDemoPlayed(true);
    }, [showNavigationHint]);
    const navigationHint = useMemo(
        () => <ReaderTapHint onZoneTap={flashTapZone} playDemo={!tapDemoPlayed} />,
        [flashTapZone, tapDemoPlayed]
    );
    // The keycap's face for a highlighted word with no entry: a small resting pawn. Built
    // once — VocabDisplayCard's memo compares it by identity.
    const keycapEmptyFace = useMemo(() => <ReaderKeycapPawn />, []);
    // The Pinyin display mode's cpcd view replaces the reading box (reading mode only).
    // It also switches the tap overlay to scroll the cpcd box and swallow long-presses.
    const showCpcd = readerSettings.displayMode === 'pinyin' && !contentEditor.editMode;

    // READ ALOUD (useReaderReadAloud): the display strip's play button reads from the caret,
    // one clause per clip, moving the word selection along with the audio. While it plays,
    // any tap, click or key press stops it AND still does its own job (the hook's window
    // listeners); a drag or wheel scrolls instead and keeps reading.
    // The pinyin hint is Chinese-only; in a Chinese document English words get the English voice.
    const readAloud = useReaderReadAloud({
        content: text?.content ?? '',
        spans: segmentSpans,
        pronunciations: text?.language === 'zh' ? pronunciations : null,
        inputRef: textSelection.inputRef,
        selectRange: textSelection.selectRange,
        documentLanguage: text?.language,
        textareaVisible: !showCpcd,
    });

    // The keycap's word actions (useReaderWordActions): speaker, More Info → eip, Add key.
    // The Add key's seed: the document's vocab lookup (useVocabularyProcessing → byTokens)
    // returns exactly the learner's Learning cards among its words, so a selected word with
    // a matching personal card is "Added!" and one without is "Add" — known with no fetch.
    // Undefined until that lookup has finished (useLearningToggle then waits for its own).
    const selectedDict = textSelection.selectedDictionaryCard;
    // An English word's translation is usually not among the document's loaded cards, so
    // a miss there proves nothing: its seed comes from the English lookup itself, which
    // reads each translation's Learning status with the matches (useEnglishTranslations →
    // translationInLearning).
    const selectedInLibrary = !selectedDict
        ? undefined
        : textSelection.selectedByTranslation && !textSelection.selectedPersonalCard
            ? englishTranslations.translationInLearning(selectedDict.word1)
            : vocabularyProcessing.processingVocab
                ? undefined
                : textSelection.selectedPersonalCard?.entryKey === selectedDict.word1;
    const wordActions = useReaderWordActions(
        selectedDict,
        (text?.language ?? user?.selectedLanguage ?? 'zh') as Language,
        selectedInLibrary,
        // The read-aloud selects a new word ~4×/s; the Add key's per-word status fetch
        // stands down until it stops (the key reappears on the word it stopped on).
        readAloud.playing,
    );
    const { openMoreInfo, learning: keycapLearning } = wordActions;

    // TAP-TO-HEAR (docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Tap-to-hear"): with the strip's
    // audio chip on default or media, moving the selection to a NEW word speaks it, as if
    // the keycap's speaker were pressed (an English word speaks its Chinese translation —
    // the keycap's word). Mute plays nothing.
    //
    // Keyed on the selection RANGE only, so it fires on a move and never on a re-render:
    // the blur → refocus loop and leaving the eip restore the same range (no change), and a
    // document opens with nothing selected, so the first sound is the learner's first tap.
    // Toggling the chip itself speaks nothing (it is not in the deps) — the app-wide rule
    // that changing an audio mode never makes a sound (useTTS → wasAutoplayOnRef).
    // Stands down while the read-aloud steps the selection (it is already speaking) and in
    // edit mode. The latest values are read through a ref so they need not be deps.
    const tapToHearRef = useRef({ autoplay: readerAudio.autoplay, readAloudPlaying: readAloud.playing, editMode: contentEditor.editMode, speak: wordActions.autoSpeakSelected });
    tapToHearRef.current = { autoplay: readerAudio.autoplay, readAloudPlaying: readAloud.playing, editMode: contentEditor.editMode, speak: wordActions.autoSpeakSelected };
    const { start: selectionStart, end: selectionEnd } = textSelection.selectionRange;
    useEffect(() => {
        if (selectionStart === selectionEnd) return;
        const { autoplay, readAloudPlaying, editMode, speak } = tapToHearRef.current;
        if (!autoplay || readAloudPlaying || editMode) return;
        speak();
    }, [selectionStart, selectionEnd]);
    // PRELOADING for tap-to-hear (useReaderAudioPreload): the server synthesizes the
    // document's words on open, and each move fetches the next few words into the browser.
    // A span resolves to the keycap's word exactly as useTextSelection does: its det row,
    // else (an English word) the Chinese entry it translates to.
    const { loadedDictionaryCards } = vocabularyProcessing;
    const translateEnglish = englishTranslations.translate;
    const resolveKeycapEntry = useCallback(
        (spanText: string) => findDictionaryMatch(spanText, loadedDictionaryCards) ?? translateEnglish(spanText),
        [loadedDictionaryCards, translateEnglish],
    );
    useReaderAudioPreload({
        enabled: readerAudio.autoplay && !contentEditor.editMode,
        language: text?.language,
        spans: segmentSpans,
        resolveEntry: resolveKeycapEntry,
        selectionStart,
        readAloudPlaying: readAloud.playing,
        prefetch: wordActions.tts.prefetch,
    });
    // Muting stops a tapped word mid-clip, edge-triggered so a speaker press while muted
    // is not cut off (useTTS does the same for the app-wide chip).
    const wasReaderAutoplayRef = useRef(readerAudio.autoplay);
    const cancelSpeech = wordActions.tts.cancel;
    useEffect(() => {
        if (wasReaderAutoplayRef.current && !readerAudio.autoplay) cancelSpeech();
        wasReaderAutoplayRef.current = readerAudio.autoplay;
    }, [readerAudio.autoplay, cancelSpeech]);
    // The keycap's right-edge controls: the eip's Add ⇄ Added! key and the More Info keycap
    // (the flp's, arrowless) — side by side with More Info rightmost, or both in their compact size when the keycap
    // stacks them under a long headword (VocabDisplayCard → ACTION LAYOUT). A word already
    // in Learning shows "Added!", and a tap removes it (the full toggle, not the flp's
    // add-only key); EipAddKey renders nothing for an undiscoverable word or while its
    // status loads. Memoised: VocabDisplayCard's memo compares it by identity.
    const renderKeycapActions = useCallback((stacked: boolean) => {
        const size = stacked ? 'compact' : 'regular';
        const moreInfo = <ReaderMoreInfoKey size={size} onClick={() => { void openMoreInfo(); }} />;
        const addKey = <EipAddKey state={keycapLearning} size={size} />;
        // Side by side: Add, then More Info at the far right (owner's call 2026-11-17).
        if (!stacked) return <>{addKey}{moreInfo}</>;
        // Stacked: More Info on top, over Add, spread EVENLY over the column VocabDisplayCard
        // gives them (face top edge → divider): equal space above, between and below. Three
        // equal flex spacers do the spreading, each with a KEYCAP_ACTIONS_GAP_PX floor; not
        // `space-evenly` + `gap`, which adds the gap to the middle space only.
        // Each key's margin box is set to its DRAWN extent: lifted `restAddY` (−1px) above
        // its box, and its lip hanging lip + restAddY (4 − 1 = 3px) below it
        // (EIP_ADD_KEY_SIZES.compact), so the spaces are even to the eye, not to the boxes.
        const compact = EIP_ADD_KEY_SIZES.compact;
        const addKeyDrawn = keycapLearning.available && keycapLearning.inLibrary !== undefined;
        const spacer = (key: string) => (
            <Box key={key} className="reader-keycap__actions-stack-spacer" sx={{ flex: '1 1 0', minHeight: `${KEYCAP_ACTIONS_GAP_PX}px` }} />
        );
        return (
            <Box
                className="reader-keycap__actions-stack"
                sx={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    '& > :not(.reader-keycap__actions-stack-spacer)': {
                        mt: `${-compact.restAddY}px`,
                        mb: `${compact.lipAdd + compact.restAddY}px`,
                    },
                }}
            >
                {spacer('above')}
                {moreInfo}
                {/* EipAddKey draws nothing for an undiscoverable word or while its status
                    loads; drop its spacer too so More Info stays centred alone. */}
                {addKeyDrawn && spacer('between')}
                {addKeyDrawn && addKey}
                {spacer('below')}
            </Box>
        );
    }, [openMoreInfo, keycapLearning]);

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
    // current content. Only the content is editable; the title is set once, on
    // create (server/utils/documentTitle.ts), and there is currently no rename UI.
    const handleEdit = useCallback(() => {
        if (!text) return;
        setEditSaveError(null);
        contentEditor.enterEditMode(text.content);
        setDraftIconId(text.iconId ?? null);
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
            iconId: draftIconId,
            kind: draftKind,
        });
        await vocabularyProcessing.processDocumentVocabulary(created);
        setText(created);
        contentEditor.exitEditMode();
        justCreatedIdRef.current = created.id;
        navigate(`/reader/${created.id}`, { replace: true });
    }, [contentEditor, user?.selectedLanguage, draftIconId, draftKind, vocabularyProcessing, navigate]);

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
            const updated = await apiPut<Text>(`/api/texts/${text.id}`, { content: contentEditor.draft, iconId: draftIconId });
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
    }, [text, isNewDraft, saveNewDraft, contentEditor, draftIconId, vocabularyProcessing]);

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
                            look={look}
                            processingVocab={vocabularyProcessing.processingVocab}
                            vocabError={vocabularyProcessing.vocabError}
                        />

                        <Box className="reader-page-mobile-vocab-card-wrapper">
                            <VocabDisplayCard
                                dictionaryEntry={textSelection.selectedDictionaryCard}
                                idleHint={showNavigationHint ? navigationHint : null}
                                emptyFace={keycapEmptyFace}
                                onSpeak={wordActions.speakSelected}
                                isSpeaking={wordActions.isSpeaking}
                                renderHeaderActions={renderKeycapActions}
                            />
                        </Box>

                        {/* The display strip: a row under the keycap — the read-aloud play
                        button (ReaderReadAloudButton) and the tap-to-hear audio chip
                        (ReaderAudioChip) at its left edge, the Text ⇄ Pinyin
                        switch (ReaderDisplayToggle) at its right. Both are hidden — not
                        removed — while editing, which is always the plain field, so the text
                        box doesn't jump. */}
                        <Box
                            className="reader-document-display-strip"
                            sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pb: 1 }}
                        >
                            {/* The audio controls, grouped at the left: Read, then the
                            tap-to-hear chip. */}
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
                                    hidden={contentEditor.editMode}
                                />
                                {/* preventDefault on mousedown keeps focus on the reading
                                box (as the Read pill and the switch do), so a desktop click
                                doesn't trip the blur → refocus loop. */}
                                <Box
                                    className="reader-document-audio-chip-wrapper"
                                    onMouseDown={(event) => event.preventDefault()}
                                    sx={{ display: 'flex', visibility: contentEditor.editMode ? 'hidden' : 'visible' }}
                                >
                                    <ReaderAudioChip
                                        className="reader-document-audio-chip"
                                        ink={look.ink2}
                                        mode={readerAudio.mode}
                                        onCycle={readerAudio.cycleMode}
                                    />
                                </Box>
                            </Box>
                            <ReaderDisplayToggle
                                look={look}
                                className="reader-document-display-mode-toggle"
                                value={readerSettings.displayMode}
                                onChange={readerSettings.setDisplayMode}
                                hidden={contentEditor.editMode}
                            />
                        </Box>
                    </Collapse>

                    <Box className="reader-page-text-content-area" sx={{ flexGrow: 1, minHeight: 0, display: 'flex', gap: 3, position: 'relative' }}>
                        <TextArea
                            look={look}
                            selectedText={text}
                            autoSelectEnabled={readerSettings.autoSelectEnabled && !contentEditor.editMode}
                            segmentSpans={segmentSpans}
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
                            cpcdView={showCpcd ? (
                                <ReaderCpcdView
                                    content={text.content}
                                    language={text.language as Language}
                                    segmentSpans={segmentSpans}
                                    pronunciations={pronunciations}
                                    selectionRange={textSelection.selectionRange}
                                    highlightColor={selectionColors.backgroundColor}
                                    showPinyinColor={showPinyinColor}
                                    onSelectRange={textSelection.selectRange}
                                    scrollRef={cpcdScrollRef}
                                    isAutoScrollPaused={readAloud.isFollowPaused}
                                    inkColor={look.ink}
                                />
                            ) : undefined}
                        />
                        {/* TAP REGION (owner's call 2026-11-17): tap-to-navigate covers the
                        whole screen below the display strip, not just the reading box —
                        anchored to this area's top (the strip's bottom edge) and pushed out
                        over the content box's side and bottom gutters to the screen's edges.
                        Reading mode only: edit mode is a plain editable field. */}
                        {!contentEditor.editMode && (
                            <Box
                                className="reader-page-tap-region"
                                sx={{
                                    position: 'absolute',
                                    top: 0,
                                    left: { xs: -16, sm: -24 },
                                    right: { xs: -16, sm: -24 },
                                    bottom: { xs: -(16 + editKeyboardInset), sm: -(24 + editKeyboardInset) },
                                    // Only a positioning frame: the overlay inside re-enables
                                    // pointers. On desktop the overlay renders nothing, and the
                                    // frame must not swallow clicks meant for the textarea.
                                    pointerEvents: 'none',
                                }}
                            >
                                <ReaderTapOverlay
                                    inputRef={textSelection.inputRef}
                                    scrollRef={showCpcd ? cpcdScrollRef : undefined}
                                    wordSource={showCpcd ? "pinyin" : "text"}
                                    onSelectSpanAtOffset={textSelection.selectSpanAtOffset}
                                    onClearSelection={textSelection.clearSelection}
                                    flash={tapZoneFlash}
                                    onFlashEnd={clearTapZoneFlash}
                                    night={look.dark}
                                />
                            </Box>
                        )}
                    </Box>
                </Box>
            )}

            {/* The keycap's More Info → the word's eip, the Dictionary page's configuration
                (Synonyms + Related, the word-tools rail, the Learning key). Portals its own
                scrim + sheet (SheetPanel). */}
            <EipSheet
                eip={wordActions.eip}
                open={wordActions.eipOpen}
                onClose={wordActions.closeEip}
                onSpeak={wordActions.tts.speak}
                onSpeakSentence={wordActions.tts.speakSentence}
                speakingKey={wordActions.tts.speakingKey}
                showSynonymsRelated
                showWordTools
                showLearning
                // The keycap's own Learning toggle: while the eip shows the selected word
                // its Add key IS the keycap's, so a tap updates both (useReaderWordActions).
                sharedLearning={wordActions.sharedLearning}
            />

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
 * the page renders matter (TextHeader: the title); the id is the
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
    };
}

export default ReaderDocumentPage;
