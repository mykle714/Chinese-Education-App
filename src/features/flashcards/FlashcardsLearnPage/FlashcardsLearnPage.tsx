import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Box, Slide, Tooltip, Typography, useMediaQuery, useTheme } from "@mui/material";
import DelayedCircularProgress from "../../../components/DelayedCircularProgress";
import { useAuth } from "../../../AuthContext";
import { API_BASE_URL } from "../../../constants";
import { ContentArea, MoreInfoPill } from "./styled";
import { FC_FONT } from "./constants";
import { SIZE, WEIGHT, TRACKING } from "../../../theme/scale";
import { useCardDrag } from "./useCardDrag";
import { useWorkingLoop, type CardDragControls, type StudyMode } from "./useWorkingLoop";
import { useCardIconEditor } from "./useCardIconEditor";
import { useToolbarOverlap } from "./useToolbarOverlap";
import FlashcardsLearnHeader from "./FlashcardsLearnHeader";
import InfoCardSection from "./InfoCardSection";
import { getBreakdownItems as buildBreakdownItems } from "../../../utils/breakdownUtils";
import { useEipTabs } from "./useEipTabs";
import EipTabStrip from "./EipTabStrip";
import TooManyTabsSnackbar from "./TooManyTabsSnackbar";
import FlashCardSection, { ChineseBlock, EnglishBlock } from "./FlashCardSection";
import CardIconCanvas from "./CardIconCanvas";
import { measureDefaultEnglishCenterY } from "../../../cardIcons/cardTextLayout";
import CardEditToolbar, { CARD_EDIT_ANIM_MS, CARD_EDIT_ANIM_EASING, TOOLBAR_DROPDOWN_SELECTOR } from "./CardEditToolbar";
import IconPickerDialog from "../../../components/IconPickerDialog";
import { iconSearchTerm, stripParentheses, resolveSelectedSenseIndex } from "../../../utils/definitionUtils";
import SheetPanel, { type SheetPanelBodyHandle } from "./SheetPanel";
import SettingsPanelBody from "./SettingsPanelBody";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions,
    Button,
    Snackbar,
    Alert,
} from "@mui/material";
import { clearWritingDraft } from "../../../components/handwriting/writingDraftStore";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useTTS, SLOW_SENTENCE_RATE } from "../../../hooks/useTTS";
import { useFlashcardLearnSettings } from "../../../hooks/useFlashcardLearnSettings";
import type { VocabEntry } from "./types";

const FlashcardsLearnPage: React.FC = () => {
    usePageTitle("Learn");
    const navigate = useNavigate();
    const { token } = useAuth();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down("md"));
    const [searchParams] = useSearchParams();
    const selectedCategory: string | null = searchParams.get('category');
    // Difficulty mode (Easy/Hard) launched from the decks page, or null for Mix.
    const rawMode = searchParams.get('mode');
    const selectedMode: StudyMode | null = rawMode === 'easy' || rawMode === 'hard' ? rawMode : null;
    // Mode-specific empty-state copy shown when a mode session runs out of cards.
    const emptyMessage: string | undefined =
        selectedMode === 'easy' ? 'No more easy cards remaining.'
        : selectedMode === 'hard' ? 'No more hard cards remaining.'
        : undefined;

    const { settings: learnSettings, update: updateLearnSettings } = useFlashcardLearnSettings();
    const { showPinyin, showPinyinColor, showSegmentSpaces, autoplayChinese, showProgressCategory, slowExampleSentences } = learnSettings;
    // Settings sheet open/close. Independent from the EIC sheet so the two can
    // coexist if needed (each one renders its own SheetPanel).
    const [settingsOpen, setSettingsOpen] = useState(false);
    // Ref to SettingsPanelBody so SheetPanel can wire its scroll/resize coupling.
    const settingsBodyRef = useRef<SheetPanelBodyHandle | null>(null);

    const tts = useTTS();

    // Example-sentence (est) narration honors the flp "slow sentences" toggle:
    // 0.65× when on, 1× otherwise. Scoped here so the flashcard word (onSpeak)
    // and every non-flp caller stay at the default 1×. Memoized so InfoCardSection
    // children don't re-render when unrelated state changes.
    const speakSentenceAtRate = useCallback(
        (text: string, pronunciation?: string) =>
            tts.speakSentence(text, pronunciation, slowExampleSentences ? SLOW_SENTENCE_RATE : 1),
        // tts.speakSentence is itself memoized (stable) — depending on the whole
        // tts object would re-create this every render. Same pattern as the
        // narration effect above.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [tts.speakSentence, slowExampleSentences],
    );

    // Bridge ref handed to useWorkingLoop so it can read/drive the card-drag layer
    // (flip state + drag-position reset) without a render-time dependency on
    // useCardDrag, which is initialized below. Populated with no-ops up front and
    // re-pointed at the real drag controls after useCardDrag runs (latest-ref
    // pattern — see assignment after the useCardDrag call).
    const cardDragRef = useRef<CardDragControls>({
        isFlipped: false,
        setIsFlipped: () => {},
        resetDragPosition: () => {},
    });

    // Working-loop domain: fetch, card-stack state machine, mark/undo, side-one
    // language. See useWorkingLoop for the full state machine + retry logic.
    const {
        workingLoop,
        currentIndex,
        currentEntry,
        nextEntry,
        loading,
        error,
        isAnimating,
        isUndoing,
        lastMarkUndoSnapshot,
        activeFrontSlot,
        flyOut,
        currentSideOneLanguage,
        nextSideOneLanguage,
        handleCardDismiss,
        handleUndoLastMark,
    } = useWorkingLoop({ token, selectedCategory, mode: selectedMode, prefetch: tts.prefetch, cardDragRef });

    // Drag/flip logic. Depends on the working loop's isAnimating + currentIndex,
    // and feeds dismisses back into it via handleCardDismiss.
    const {
        cardRef,
        dragPosition,
        isDragging,
        isFlipped,
        setIsFlipped,
        resetDragPosition,
        showSwipeHint,
        showTapToFlipHint,
        shakeNonce,
        handlers,
    } = useCardDrag(isAnimating, handleCardDismiss, currentIndex);

    // Keep the bridge ref pointing at the live drag controls every render.
    cardDragRef.current = { isFlipped, setIsFlipped, resetDragPosition };

    // ── Custom card icon layout (edit mode) ───────────────────────────────────
    // All fie editor state + actions live in useCardIconEditor. See docs/CARD_ICON_LAYOUT.md.
    const {
        editMode,
        advMode,
        advDraft,
        selectedIcon,
        textDraft,
        selectedText,
        snapMove,
        snapRotate,
        snapResize,
        textForeign,
        textEnglish,
        cardColor,
        advHistory,
        advFuture,
        savingLayout,
        saveError,
        iconSearchOpen,
        lastIconQuery,
        resetConfirmOpen,
        canReset,
        selectedLocked,
        displayCurrentEntry,
        displayNextEntry,
        editingCurrentEntry,
        pickerPrefetched,
        setAdvMode,
        selectTarget,
        setTextDraftBoth,
        setIconSearchOpen,
        setLastIconQuery,
        setResetConfirmOpen,
        setSaveError,
        setTextForeign,
        setTextEnglish,
        setCardColor,
        setAdvDraftBoth,
        enterEdit,
        exitEdit,
        handlePickIcon,
        handleDeleteSelected,
        handleDuplicateSelected,
        handleAlign,
        handleMirror,
        handleToggleLock,
        handleToggleLockAt,
        handleReorder,
        handleToggleSnapMove,
        handleToggleSnapRotate,
        handleToggleSnapResize,
        handleNudgeMove,
        handleRotateStep,
        handleResizeStep,
        handleSaveLayout,
        handleResetConfirmed,
        persistSelectedSense,
        undoAdv,
        redoAdv,
        pushAdvHistory,
    } = useCardIconEditor({ currentEntry, nextEntry, token });

    // ── Toolbar-overlap push-down gate ────────────────────────────────────────
    // The advanced-edit push-down slides the card down to clear the three-row toolbar, but we
    // only want it when the toolbar would ACTUALLY overlap the card (on roomy viewports the
    // card is small enough that the toolbar clears it with no shift needed). These refs feed
    // useToolbarOverlap, which compares the toolbar's bottom edge to the card's centered top.
    const contentAreaRef = useRef<HTMLDivElement | null>(null);
    const toolbarRef = useRef<HTMLDivElement | null>(null);
    const toolbarOverlaps = useToolbarOverlap(editMode && advMode, contentAreaRef, toolbarRef, cardRef);
    // Push (and lift the card over the More Info pill) only when the toolbar would overlap.
    const pushCardDown = editMode && advMode && toolbarOverlaps;

    // Hard-clear the preserved writing-practice draft when a card is marked (which
    // advances currentIndex) and when leaving the flp (cleanup on unmount).
    // (docs/HANDWRITING_RECOGNITION.md "Canvas / state lifecycle")
    useEffect(() => {
        clearWritingDraft();
        return () => clearWritingDraft();
    }, [currentIndex]);

    // Log the current card whenever it changes (covers both correct and incorrect advances).
    // Dumps the card object verbatim as it arrived from the server (no key-picking or
    // null→'none' coercion) so the console reflects the raw working-loop response.
    useEffect(() => {
        if (!currentEntry) return;
        console.log('Current card (raw):', currentEntry);
        // Working loop cards grouped by category
        const categories = ['Unfamiliar', 'Target', 'Comfortable', 'Mastered'] as const;
        const byCategory = Object.fromEntries(
            categories.map(cat => [cat, workingLoop.filter(c => c.category === cat)])
        );
        console.log('Working loop by category:', byCategory);
    }, [currentEntry, workingLoop]);

    const breakdownItems = buildBreakdownItems(currentEntry);

    // TTS narration: auto-play the Chinese word the moment the Chinese face of
    // the card first becomes visible. Side 1 is randomized per card — when it's
    // 'zh' we play on mount; when it's 'en' we wait for the flip (Side 2 always
    // shows Chinese). Either way, exactly one play per card.
    //
    // Note: this effect can briefly see `chineseVisible === true` on a fresh
    // card before the working loop swaps in the new random value. The cleanup
    // calls tts.cancel(); CloudTTSProvider's cancel() bumps its generation so any
    // in-flight fetch from this stale-state render is dropped before audio.
    const chineseVisible = currentSideOneLanguage === 'zh' || isFlipped;
    useEffect(() => {
        if (!tts.enabled || !autoplayChinese) return;
        if (!chineseVisible || !currentEntry) return;
        tts.speak(currentEntry);
        // Cancel narration if the user advances mid-utterance.
        return () => tts.cancel();
        // tts.speak/cancel are stable across renders; depending on them would
        // re-fire narration on every settings change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chineseVisible, currentEntry?.id, tts.enabled, autoplayChinese]);

    // EIC modal sheet — opened by the centered "More Info" pill button.
    const [isEicOpen, setIsEicOpen] = useState(false);
    // Tracks whether the sheet has been opened at least once for the current card
    // to suppress the discoverability pulse animation after first use.
    const [eicHintConsumed, setEicHintConsumed] = useState(false);

    // Entry-tab system: tapping a breakdown/used-in row inside the EIP adds a
    // tab to the panel instead of stacking another panel on top. Each tab is
    // its own looked-up dictionary entry. Tapping the scrim closes the panel
    // and clears every tab (see closeEip). The active tab owns its own selected
    // sub-tab, so the page no longer tracks a separate selectedTab.
    const eipStripRef = useRef<HTMLDivElement | null>(null);
    const eip = useEipTabs({ apiBaseUrl: API_BASE_URL, token, stripRef: eipStripRef });

    const openEicSheet = () => {
        if (!currentEntry) return;
        setIsEicOpen(true);
        setEicHintConsumed(true);
        eip.openForRoot(currentEntry);
    };

    // Closes the EIP entirely and discards every tab (scrim tap or drag-dismiss).
    const closeEip = useCallback(() => {
        setIsEicOpen(false);
        eip.clear();
    }, [eip]);

    // "+ Add to Learn Now" from the EIP header 2×2 action grid. The primary card
    // is already in the library, but drilled-in words (breakdown chars / example
    // segments opened as entry tabs) may not be — InfoCardPanelBody gates the
    // button on `entry.discoverable`. Language comes from the entry itself so a
    // drilled-in word is added under its own language. Mirrors the dictionary
    // cdp handler (DictionaryCardDetailPage.handleAddToLibrary).
    const [addToLibSnack, setAddToLibSnack] = useState<string | null>(null);
    // Entries confirmed to be in the library this session (either freshly added
    // or reported already-present). Once an entry is here, its Add button is
    // hidden — the word is in the library, so the action is a no-op. Keyed by
    // language:entryKey so the same headword in different languages stays
    // independent. Persists for the page's lifetime (survives entry-tab switches
    // and EIP reopen); a page reload rebuilds it from scratch, which is fine.
    const [addedLibraryKeys, setAddedLibraryKeys] = useState<Set<string>>(new Set());
    const libraryKeyOf = (entry: VocabEntry) => `${entry.language}:${entry.entryKey}`;
    const handleAddToLibrary = useCallback(async (entry: VocabEntry) => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/vocabEntries/add-to-library`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ entryKey: entry.entryKey, language: entry.language }),
            });
            if (!res.ok) {
                setAddToLibSnack('Failed to add to Learn Now');
                return;
            }
            const data: { status: 'added' | 'already-in-library' } = await res.json();
            setAddToLibSnack(data.status === 'already-in-library' ? 'Already in Learn Now' : 'Added to Learn Now');
            // Either status means the word is now in the library — hide its Add button.
            setAddedLibraryKeys((prev) => {
                const next = new Set(prev);
                next.add(`${entry.language}:${entry.entryKey}`);
                return next;
            });
        } catch (err) {
            console.error('Failed to add to library:', err);
            setAddToLibSnack('Failed to add to Learn Now');
        }
    }, [token]);

    // The card editor and the EIP can't coexist — entering edit mode dismisses the
    // panel (and the More Info pill is disabled while editing, see MoreInfoPill below).
    // Key off editMode ONLY (rising edge): closeEip's identity churns every render
    // (useEipTabs returns a fresh object, and closeEip -> eip.clear() -> setTabs([]),
    // a new array ref each call), so depending on it here would re-run the effect every
    // render and loop infinitely.
    useEffect(() => {
        if (editMode) closeEip();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editMode]);

    // Hint shown when the user taps the pill before flipping the card.
    // Auto-dismisses after a couple seconds, and clears immediately on flip.
    const [showFlipHint, setShowFlipHint] = useState(false);
    useEffect(() => {
        if (!showFlipHint) return;
        const t = setTimeout(() => setShowFlipHint(false), 2000);
        return () => clearTimeout(t);
    }, [showFlipHint]);
    useEffect(() => {
        if (isFlipped) setShowFlipHint(false);
    }, [isFlipped]);

    const handleMoreInfoClick = () => {
        // Disabled while the card editor is open (the pill is also greyed out).
        if (editMode) return;
        if (!isFlipped) {
            setShowFlipHint(true);
            return;
        }
        openEicSheet();
    };

    // Lock body scroll while this page is mounted so wheel/touch events that
    // bubble past the EIC sheet can't shift the iPhone frame.
    useEffect(() => {
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = previous; };
    }, []);

    // Reset EIC state when a new card loads — close the panel and drop all tabs.
    useEffect(() => {
        setIsEicOpen(false);
        setEicHintConsumed(false);
        eip.clear();
    // eip.clear is stable but its identity changes when tabs change; we only
    // want to react to card changes, not tab changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentIndex]);

    // Phone-frame sizing comes from MobileDemoFrame via Layout.tsx

    if (loading) {
        return (
            <Box
                className="flashcards-learn__loading-wrapper"
                sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: isMobile ? "100vw" : "100%",
                    height: "100vh",
                    backgroundColor: theme.palette.flashcard.background,
                }}
            >
                <DelayedCircularProgress />
            </Box>
        );
    }

    if (error) {
        return (
            <Box
                className="flashcards-learn__error-wrapper"
                sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: isMobile ? "100vw" : "100%",
                    height: "100vh",
                    backgroundColor: theme.palette.flashcard.background,
                }}
            >
                <Typography color="error">{error}</Typography>
            </Box>
        );
    }

    return (
        <>
            <FlashcardsLearnHeader
                selectedCategory={selectedCategory}
                lastMarkUndoSnapshot={lastMarkUndoSnapshot}
                isAnimating={isAnimating}
                isUndoing={isUndoing}
                // In edit mode the back arrow first cancels the edit (discarding the
                // draft, unpausing minute points), then performs the normal back nav.
                onBack={() => {
                    if (editMode) exitEdit();
                    navigate('/flashcards/decks');
                }}
                onUndo={handleUndoLastMark}
                showPinyin={showPinyin}
                onTogglePinyin={() => updateLearnSettings({ showPinyin: !showPinyin })}
                isFlipped={isFlipped}
                editMode={editMode}
                onToggleEdit={() => (editMode ? exitEdit() : enterEdit(() => cardRef.current ? measureDefaultEnglishCenterY(cardRef.current) : null))}
                onSettingsClick={() => setSettingsOpen(true)}
            />
            <ContentArea
                ref={contentAreaRef}
                className="mobile-demo-content"
                // While the icon editor is open (advanced mode, an icon selected), a tap on
                // the white space OUTSIDE the card canvas and the edit toolbar deselects the
                // active icon — mirroring the empty-canvas deselect (CardIconCanvas). Taps
                // landing inside the canvas are left alone (it handles its own deselect), and
                // taps on the toolbar/menus are ignored so adjusting controls keeps the
                // selection. See docs/CARD_ICON_LAYOUT.md.
                //
                // The toolbar's dropdowns (align / shift / snap / order / contrast) are MUI
                // Menu/Popover PORTALED to <body>, so their cells are NOT DOM-descendants of
                // `.card-edit-toolbar`. But React synthetic events bubble through the React
                // tree, not the DOM tree, so a press on a menu cell still fires THIS handler —
                // and `closest(".card-edit-toolbar")` misses it, deselecting before the cell's
                // onClick runs (turning align / shift into no-ops). So also exempt presses
                // inside any open dropdown via its own portaled class.
                onPointerDown={(e) => {
                    if (!(editMode && advMode) || (selectedIcon === null && selectedText === null)) return;
                    const el = e.target as HTMLElement;
                    if (
                        !el.closest(".card-icon-canvas") &&
                        !el.closest(".card-edit-toolbar") &&
                        !el.closest(TOOLBAR_DROPDOWN_SELECTOR)
                    ) {
                        selectTarget(null);
                    }
                }}
            >
                {/* Floating edit toolbar — overlays the top of the content area while
                    editing so it does NOT push the card down (docs/CARD_ICON_LAYOUT.md).
                    Wrapped in <Slide> so it drops in on enter AND slides back up on exit
                    (both directions), matched to the card push-down + adv-rows Collapse. */}
                <Slide
                    in={editMode}
                    direction="down"
                    timeout={CARD_EDIT_ANIM_MS}
                    easing={CARD_EDIT_ANIM_EASING}
                    mountOnEnter
                    unmountOnExit
                >
                    <Box ref={toolbarRef} sx={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 20 }}>
                        <CardEditToolbar
                            advMode={advMode}
                            count={advDraft.length}
                            layout={advDraft}
                            hasSelection={selectedIcon !== null || selectedText !== null}
                            selectionKind={selectedText !== null ? "text" : selectedIcon !== null ? "icon" : null}
                            canUndo={advHistory.length > 0}
                            canRedo={advFuture.length > 0}
                            onChangeIcon={() => setIconSearchOpen(true)}
                            onAddIcon={() => setIconSearchOpen(true)}
                            onToggleAdv={() => setAdvMode((v) => !v)}
                            onUndo={undoAdv}
                            onRedo={redoAdv}
                            onDeleteSelected={handleDeleteSelected}
                            onDuplicate={handleDuplicateSelected}
                            onAlign={handleAlign}
                            onMirror={handleMirror}
                            onToggleLock={handleToggleLock}
                            selectedLocked={selectedLocked}
                            onReorder={handleReorder}
                            onReorderStart={pushAdvHistory}
                            onToggleLockAt={handleToggleLockAt}
                            // The order list selects an icon — route through selectTarget so it
                            // also clears any text-block selection (mutual exclusion).
                            onSelectIcon={(i) => selectTarget({ kind: "icon", index: i })}
                            selectedIndex={selectedIcon}
                            snapMove={snapMove}
                            snapRotate={snapRotate}
                            snapResize={snapResize}
                            onToggleSnapMove={handleToggleSnapMove}
                            onToggleSnapRotate={handleToggleSnapRotate}
                            onToggleSnapResize={handleToggleSnapResize}
                            onNudgeMove={handleNudgeMove}
                            onRotateStep={handleRotateStep}
                            onResizeStep={handleResizeStep}
                            foreignLabel={currentEntry?.entryKey ?? ""}
                            englishLabel={stripParentheses(currentEntry?.definition ?? "")}
                            textForeign={textForeign}
                            textEnglish={textEnglish}
                            onSetTextForeign={setTextForeign}
                            onSetTextEnglish={setTextEnglish}
                            cardColor={cardColor}
                            onSetCardColor={setCardColor}
                            canReset={canReset}
                            onReset={() => setResetConfirmOpen(true)}
                            onSave={handleSaveLayout}
                            onCancel={exitEdit}
                            saving={savingLayout}
                        />
                    </Box>
                </Slide>
                {/* Flashcard fills the full ContentArea. The EIC sheet now overlays
                    at the bottom rather than stacking above the flashcard. */}
                <FlashCardSection
                    currentEntry={editingCurrentEntry}
                    nextEntry={displayNextEntry}
                    activeFrontSlot={activeFrontSlot}
                    flyOut={flyOut}
                    cardRef={cardRef}
                    dragPosition={dragPosition}
                    isDragging={isDragging}
                    isFlipped={isFlipped}
                    isAnimating={isAnimating}
                    selectedCategory={selectedCategory}
                    emptyMessage={emptyMessage}
                    showPinyin={showPinyin}
                    showPinyinColor={showPinyinColor}
                    showProgressCategory={showProgressCategory}
                    sideOneLanguage={currentSideOneLanguage}
                    nextSideOneLanguage={nextSideOneLanguage}
                    showSwipeHint={showSwipeHint}
                    showTapToFlipHint={showTapToFlipHint}
                    shakeNonce={shakeNonce}
                    handlers={handlers}
                    onSpeak={tts.enabled ? tts.speak : undefined}
                    speakingKey={tts.speakingKey}
                    // Persist the learner's definition-cluster sense pick per account (migration 99).
                    onPersistSense={persistSelectedSense}
                    // Gesture canvas only in advanced mode; basic mode renders the draft
                    // through the static icon layer (via editingCurrentEntry above).
                    editCanvas={editMode && advMode ? (
                        <CardIconCanvas
                            layout={advDraft}
                            onChange={setAdvDraftBoth}
                            selectedIcon={selectedIcon}
                            selectedText={selectedText}
                            onSelectTarget={selectTarget}
                            onInteractionStart={pushAdvHistory}
                            snap={{ move: snapMove, rotate: snapRotate, resize: snapResize }}
                            // Movable text (migration 91): the live draft + the two real text
                            // nodes (built from the live-colored editingCurrentEntry). The foreign
                            // block renders the SAME speaker + writing-practice buttons the flp
                            // back face shows (onSpeak/showWriting), so the learner previews WHERE
                            // those buttons will sit relative to the moved text. They're inert here
                            // (the text-content wrapper is pointerEvents:none) — pure preview chrome.
                            textLayout={textDraft}
                            onTextChange={setTextDraftBoth}
                            foreignNode={editingCurrentEntry ? (
                                <ChineseBlock
                                    entry={editingCurrentEntry}
                                    showPinyin={showPinyin}
                                    showPinyinColor={showPinyinColor}
                                    onSpeak={tts.enabled ? tts.speak : undefined}
                                    speakingKey={tts.speakingKey}
                                    showWriting
                                    // In-flow so the buttons are part of the block's box — the
                                    // selection outline + on-card clamp include them.
                                    inlineActions
                                />
                            ) : null}
                            englishNode={editingCurrentEntry ? (
                                // Mirror the live card's currently-shown sense in the movable-text
                                // preview. CardFace owns the live index, but it stays in lockstep with
                                // the entry's persisted/override `selectedSense`, so we resolve the same
                                // display index from editingCurrentEntry (migration 99).
                                <EnglishBlock
                                    entry={editingCurrentEntry}
                                    selectedSenseIndex={resolveSelectedSenseIndex(editingCurrentEntry)}
                                />
                            ) : null}
                        />
                    ) : undefined}
                    editMode={editMode}
                    // Push down (and lift over the More Info pill) only when the advanced toolbar
                    // would actually overlap the card — see useToolbarOverlap.
                    pushDown={pushCardDown}
                />
                {/* Centered pill button — ghosted before flip, full opacity after. While
                    the icon editor is open it stays DRAWN but greyed + inert (isDisabled);
                    in advanced mode the card slides down and paints over it (the card slot
                    is raised above the pill in FlashCardSection). */}
                <Tooltip
                    open={showFlipHint}
                    title="Flip the card first to see extra info."
                    placement="top"
                    arrow
                >
                    <MoreInfoPill
                        className="mobile-demo-more-info-pill"
                        isFlipped={isFlipped}
                        isDisabled={editMode}
                        hintActive={isFlipped && !eicHintConsumed && !editMode}
                        onClick={handleMoreInfoClick}
                        aria-disabled={editMode}
                        aria-label="Open extra info"
                    >
                        <Typography sx={{ fontSize: SIZE.body, color: theme.palette.flashcard.onSurface, lineHeight: 1, transform: "translateY(-1px)" }}>↑</Typography>
                        <Typography sx={{ fontSize: SIZE.caption, fontWeight: WEIGHT.semibold, color: theme.palette.flashcard.onSurface, letterSpacing: TRACKING.wide, fontFamily: FC_FONT }}>More Info</Typography>
                    </MoreInfoPill>
                </Tooltip>
                {/* Modal EIC sheet — only mounted when open to reset animation on reopen.
                    Tapping a breakdown/used-in row inside the panel pushes a tab onto
                    the entry-tab strip above the grabber instead of stacking another
                    panel. Scrim/drag-dismiss closes the panel and clears every tab. */}
                {isEicOpen && (() => {
                    // The active tab owns the panel's entry/breakdown/sub-tab. openEicSheet
                    // always seeds a root tab before this renders, so activeTab is present;
                    // the currentEntry/breakdownItems fallbacks are a paint-safety net only.
                    // The Compare tab (docs/WORD_COMPARE_FEATURE.md) is a different kind — it
                    // has no entry/breakdown/sub-tab of its own, so it renders CompareTabBody
                    // instead (InfoCardSection branches on `compareTab`).
                    const active = eip.activeTab;
                    const compareTab = active?.kind === "compare" ? active : null;
                    const panelEntry = (active?.kind === "entry" ? active.entry : null) ?? currentEntry;
                    const panelBreakdown = (active?.kind === "entry" ? active.breakdownItems : null) ?? breakdownItems;
                    const panelSubTab = active?.kind === "entry" ? active.selectedSubTab : 0;
                    // Hide the Add button once this entry is known to be in the library:
                    // drop the handler so InfoCardPanelBody's `onAddToLibrary` gate fails.
                    const panelAlreadyInLibrary = panelEntry ? addedLibraryKeys.has(libraryKeyOf(panelEntry)) : false;
                    return (
                        <InfoCardSection
                            currentEntry={panelEntry}
                            selectedTab={panelSubTab}
                            onTabChange={eip.setActiveSubTab}
                            breakdownItems={panelBreakdown}
                            showPinyin={showPinyin}
                            showPinyinColor={showPinyinColor}
                            showSegmentSpaces={showSegmentSpaces}
                            isFlipped={isFlipped}
                            onClose={closeEip}
                            onBreakdownItemClick={(item) => eip.openForEntryKey(item.character)}
                            onUsedInItemClick={(item) => eip.openForEntryKey(item.entryKey)}
                            onExampleSegmentClick={(segment) => eip.openForEntryKey(segment)}
                            depth={0}
                            onSpeak={tts.enabled ? tts.speak : undefined}
                            onSpeakSentence={tts.enabled ? speakSentenceAtRate : undefined}
                            speakingKey={tts.speakingKey}
                            onAddToLibrary={panelAlreadyInLibrary ? undefined : handleAddToLibrary}
                            onOpenCompare={eip.openCompareTab}
                            compareTab={compareTab}
                            onSetCompareSlot={eip.setCompareSlot}
                            onCompareResult={eip.setCompareResult}
                            tabStrip={
                                <EipTabStrip
                                    tabs={eip.tabs}
                                    activeIndex={eip.activeIndex}
                                    onSelect={eip.setActive}
                                    onCloseActiveTab={() => {
                                        if (eip.closeActiveTab()) closeEip();
                                    }}
                                    isTabbedMode={eip.isTabbedMode}
                                    stripRef={eipStripRef}
                                />
                            }
                        />
                    );
                })()}
                <TooManyTabsSnackbar signal={eip.overflowSignal} />
                {/* "+ Add to Learn Now" result toast from the EIP header action grid.
                    Neutral severity — "already in library" is an informational outcome,
                    not an error. */}
                <Snackbar
                    open={addToLibSnack !== null}
                    autoHideDuration={3000}
                    onClose={() => setAddToLibSnack(null)}
                    anchorOrigin={{ vertical: "top", horizontal: "center" }}
                    sx={{ zIndex: 2000 }}
                >
                    <Alert
                        severity={addToLibSnack === 'Failed to add to Learn Now' ? "error" : "success"}
                        variant="filled"
                        onClose={() => setAddToLibSnack(null)}
                        sx={{ fontFamily: FC_FONT }}
                    >
                        {addToLibSnack}
                    </Alert>
                </Snackbar>
                {/* Icon-layout save/reset failure toast (e.g. backend PATCH error).
                    Replaces the prior silent console.error so the editor stays open
                    and the user knows the write didn't land. */}
                <Snackbar
                    open={saveError !== null}
                    autoHideDuration={4000}
                    onClose={() => setSaveError(null)}
                    anchorOrigin={{ vertical: "top", horizontal: "center" }}
                    sx={{ zIndex: 2000 }}
                >
                    <Alert
                        severity="error"
                        variant="filled"
                        onClose={() => setSaveError(null)}
                        sx={{ fontFamily: FC_FONT }}
                    >
                        {saveError}
                    </Alert>
                </Snackbar>
                {/* Settings sheet — same drag/scroll behavior as the EIP. Mounted
                    only while open so the open animation replays on each invocation.
                    Depth 99 keeps it above any open EIP panel stack. */}
                {settingsOpen && (
                    <SheetPanel
                        onClose={() => setSettingsOpen(false)}
                        bodyRef={settingsBodyRef}
                        depth={99}
                    >
                        <SettingsPanelBody
                            ref={settingsBodyRef}
                            settings={learnSettings}
                            update={updateLearnSettings}
                        />
                    </SheetPanel>
                )}
            </ContentArea>

            {/* Add-icon search dialog (download-on-select). docs/CARD_ICON_LAYOUT.md */}
            <IconPickerDialog
                open={iconSearchOpen}
                onClose={() => setIconSearchOpen(false)}
                title={advMode ? "Add an icon" : "Change icon"}
                onPick={handlePickIcon}
                // Seed the search with the user's last-typed query if they've searched
                // this edit session (remembered across opens); otherwise the card's English
                // meaning (parsed via the shared iconSearchTerm: stripParentheses to match
                // the card display, then the "to " / "to be " infinitive strips).
                initialTerm={lastIconQuery ?? iconSearchTerm(displayCurrentEntry?.definition)}
                onTermChange={setLastIconQuery}
                // Render the warmed default-query results instantly on open (when they
                // belong to THIS card); typing a new term reverts to a live search.
                prefetched={pickerPrefetched}
            />

            {/* Reset-to-default confirmation. */}
            <Dialog
                className="card-icon-reset-dialog"
                open={resetConfirmOpen}
                onClose={() => !savingLayout && setResetConfirmOpen(false)}
            >
                <DialogTitle>Reset to default icon?</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        This removes your custom icon arrangement for this card and restores the
                        default icon. This can't be undone.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setResetConfirmOpen(false)} disabled={savingLayout}>
                        Cancel
                    </Button>
                    <Button onClick={handleResetConfirmed} color="error" disabled={savingLayout}>
                        Reset
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
};

export default FlashcardsLearnPage;
