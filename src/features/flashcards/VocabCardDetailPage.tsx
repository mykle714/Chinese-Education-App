import { useState, useEffect, useRef, useCallback } from "react";
import { stripParentheses, iconSearchTerm, resolveSelectedSenseIndex, sortedSenseClusters } from "../../utils/definitionUtils";
import { useParams, useNavigate } from "react-router-dom";
import {
    Box, IconButton, Alert, useTheme,
    Slide, Snackbar, Button, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
} from "@mui/material";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import { styled } from "@mui/material/styles";
import NodePage from "../../components/NodePage";
import { FooterSpacer } from "../../components/MobileFooter";
import { API_BASE_URL } from "../../constants";
import type { VocabEntry } from "../../types";
import IconPickerDialog from "../../components/IconPickerDialog";
import { clearWritingDraft } from "../../components/handwriting/writingDraftStore";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useFlashcardLearnSettings } from "../../hooks/useFlashcardLearnSettings";
import { useTTS, SLOW_SENTENCE_RATE } from "../../hooks/useTTS";
import { useAuth } from "../../AuthContext";
import { COLORS } from "../../theme/colors";
import { CardFaceSide, ChineseBlock, EnglishBlock } from "./FlashcardsLearnPage/FlashCardSection";
import { measureDefaultEnglishCenterY } from "../../cardIcons/cardTextLayout";
import { isAdvancedLayout } from "../../cardIcons/cardIconLayout";
import { CARD_BASE_WIDTH, CARD_BASE_HEIGHT, FC_FONT } from "./FlashcardsLearnPage/constants";
import { useCardIconEditor } from "./FlashcardsLearnPage/useCardIconEditor";
import CardIconCanvas from "./FlashcardsLearnPage/CardIconCanvas";
import CardEditToolbar, { CARD_EDIT_ANIM_MS, CARD_EDIT_ANIM_EASING, TOOLBAR_DROPDOWN_SELECTOR } from "./FlashcardsLearnPage/CardEditToolbar";
import { VocabCardBadges, VocabCardSections } from "./VocabCardDetailBody";
import MasteryProgressBar from "./MasteryProgressBar";

// Padded content column. The outer NodePage/MobileTabScreen scroll area owns the
// scroll + floating-footer clearance, so this box does NOT scroll itself — it just
// stacks the hero + info boxes and stays the positioning context (position:
// relative) for the absolute edit-toolbar overlay (top: 0), which sits flush under
// the header instead of pushing content down.
const ContentArea = styled(Box)(() => ({
    display: "flex",
    flexDirection: "column",
    padding: "16px",
    gap: "12px",
    position: "relative",
}));

const VocabCardDetailPage: React.FC = () => {
    usePageTitle("Card");
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    const { token } = useAuth();
    const { settings } = useFlashcardLearnSettings();
    const { showPinyinColor, slowExampleSentences } = settings;
    // cdp always shows pinyin regardless of the flp pinyin toggle — pinyin is
    // core reference info on the detail page, so we ignore settings.showPinyin here.
    const showPinyin = true;
    // Manual word narration — same speaker button flp shows on the back face's
    // ChineseBlock. Hidden when narration is disabled in settings (onSpeak undefined).
    const tts = useTTS();
    const [entry, setEntry] = useState<VocabEntry | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState(false);
    // Which definitionClusters sense EnglishBlock currently shows on the hero card.
    // Mirrors CardFace: seeds from this saved card's PERSISTED choice (`selectedSense` label →
    // sorted index, migration 99), falling back to the top/starred sense. Persisted on pick.
    const [selectedSenseIndex, setSelectedSenseIndex] = useState(0);
    useEffect(() => { setSelectedSenseIndex(entry ? resolveSelectedSenseIndex(entry) : 0); }, [entry?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    // The flashcard icon editor (fie) — the same toolbar/canvas flp opens on its
    // back face. There's no "next card" here (single-card page), so nextEntry is
    // null; the hook's session-override merging works the same either way.
    // See docs/CARD_ICON_LAYOUT.md.
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
    } = useCardIconEditor({ currentEntry: entry, nextEntry: null, token });

    // A sense pick updates the in-sync display index AND persists the chosen cluster's `sense`
    // LABEL for this saved card (index 0 = default/starred → stored as null). Same contract as
    // CardFace.handleSelectSense on the flp. See docs/DEFINITION_CLUSTERS.md.
    const handleSelectSense = useCallback((index: number) => {
        setSelectedSenseIndex(index);
        if (!entry) return;
        const sorted = sortedSenseClusters(entry);
        persistSelectedSense(entry, index === 0 ? null : sorted?.[index]?.sense ?? null);
    }, [entry, persistSelectedSense]);

    // Outside-tap deselect: a tap on the page outside the canvas/toolbar (and
    // outside a portaled toolbar dropdown) clears the active icon/text selection.
    // Mirrors ContentArea's onPointerDown handler on flp. See docs/CARD_ICON_LAYOUT.md.
    const contentAreaRef = useRef<HTMLDivElement | null>(null);
    const toolbarRef = useRef<HTMLDivElement | null>(null);
    // Measured on enterEdit to seed the advanced text draft's English position without a
    // visual jump — see measureDefaultEnglishCenterY's doc comment.
    const heroCardRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const fetchEntry = async () => {
            try {
                setLoading(true);
                const response = await fetch(`${API_BASE_URL}/api/vocabEntries/${id}`, {
                    credentials: "include",
                });
                if (!response.ok) {
                    throw new Error("Failed to fetch card");
                }
                const data = await response.json();
                setEntry(data);
            } catch (err: unknown) {
                setError(err instanceof Error ? err.message : "Failed to load card");
            } finally {
                setLoading(false);
            }
        };

        if (id) fetchEntry();
    }, [id]);

    // Log the fetched card verbatim on entering the cdp (and on any re-fetch),
    // mirroring flp's "Current card (raw)" dump (FlashcardsLearnPage.tsx) — the same
    // entry object that populates the eip (definition/breakdown/examples/synonyms).
    // Uses the identical log label so the two pages' output is greppable as one.
    useEffect(() => {
        if (!entry) return;
        console.log('Current card (raw):', entry);
    }, [entry]);

    // Hard-clear the preserved writing-practice draft when leaving the cdp.
    // (docs/HANDWRITING_RECOGNITION.md "Canvas / state lifecycle")
    useEffect(() => {
        return () => clearWritingDraft();
    }, []);

    // Hard-deletes the VocabEntry and returns to the decks page
    const handleDelete = async () => {
        if (!entry) return;
        try {
            setActionLoading(true);
            const response = await fetch(`${API_BASE_URL}/api/vocabEntries/${entry.id}`, {
                method: 'DELETE',
                credentials: 'include',
            });
            if (!response.ok) throw new Error('Failed to delete card');
            navigate('/flashcards/decks', { state: { refresh: Date.now() } });
        } catch (err) {
            console.error('Error deleting card:', err);
            setActionLoading(false);
        }
    };

    return (
        // Card Detail is a NODE PAGE (see docs/LEAF_NODE_PAGES.md): keeps the footer,
        // LEFT back arrow (returns to the previous screen), slides in from the right.
        // Reached from Decks/Mastered, so the Flashcards tab stays active.
        <NodePage
            title="Card Detail"
            activePage="flashcards"
            onBack={() => navigate(-1)}
            surfaceColor={COLORS.yellowAccent}
            // No top edge-fade: the badges/hero card shouldn't dissolve at the top.
            topFade={false}
            headerExtraActions={entry && (
                <Box sx={{ display: "flex", alignItems: "center" }}>
                    {/* Opens the same fie (flashcard icon editor) toolbar/canvas flp uses,
                        decorating this card's icon layout/text placement/colors — not a
                        navigation to a separate edit form. */}
                    <IconButton
                        className="vocab-card-detail__edit-button"
                        aria-label="Edit card"
                        onClick={() => (editMode ? exitEdit() : enterEdit(() => heroCardRef.current ? measureDefaultEnglishCenterY(heroCardRef.current) : null))}
                        sx={{ color: editMode ? theme.palette.primary.main : fc.textSecondary }}
                    >
                        <EditOutlinedIcon />
                    </IconButton>
                    <IconButton
                        className="vocab-card-detail__delete-button"
                        aria-label="Delete card"
                        disabled={actionLoading}
                        onClick={handleDelete}
                        sx={{ color: '#ef5350' }}
                    >
                        <DeleteOutlineIcon />
                    </IconButton>
                </Box>
            )}
        >
                <ContentArea
                    ref={contentAreaRef}
                    className="vocab-card-detail__content"
                    // While the icon editor is open (advanced mode, something selected), a tap
                    // outside the canvas/toolbar (and outside a portaled toolbar dropdown)
                    // deselects — mirrors flp's ContentArea handler. See docs/CARD_ICON_LAYOUT.md.
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
                    {loading ? (
                        <Box className="vocab-card-detail__loading" sx={{ display: "flex", justifyContent: "center", pt: 6 }}>
                            <DelayedCircularProgress className="vocab-card-detail__spinner" />
                        </Box>
                    ) : error ? (
                        <Alert className="vocab-card-detail__error-alert" severity="error">{error}</Alert>
                    ) : entry ? (
                        <>
                            {/* Floating edit toolbar — the same fie (flashcard icon editor)
                                toolbar flp uses. Overlays the top of ContentArea (flush against
                                the header above, spanning full width) instead of sitting in
                                normal flow, so opening it never shifts the badges/hero card/boxes
                                down. Matches flp's own overlay treatment. See docs/CARD_ICON_LAYOUT.md. */}
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
                                        foreignLabel={entry.entryKey}
                                        englishLabel={stripParentheses(entry.definition ?? "")}
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

                            <VocabCardBadges entry={entry} />

                            {/* Mastery progress bar (docs/MASTERY_REWORK.md): the pbh
                                stacked bar + per-type composition for this saved card. */}
                            <Box sx={{ display: "flex", justifyContent: "center", my: 1.5 }}>
                                <MasteryProgressBar entry={entry} />
                            </Box>

                            {/* Hero card — the same size/style as the flp (learn page)
                                card, showing the Side 2 (answer) face: cpcd + writing/audio
                                actions, the English definition (with sense-picker when the
                                entry has multiple orthogonal senses), and the entry's icon
                                arrangement. Reuses CardFaceSide/ChineseBlock/EnglishBlock
                                from FlashcardsLearnPage so any change to the flp back face
                                shows up here too. */}
                            <Box
                                className="vocab-card-detail__hero-card"
                                ref={heroCardRef}
                                sx={{
                                    aspectRatio: `${CARD_BASE_WIDTH} / ${CARD_BASE_HEIGHT}`,
                                    width: "100%",
                                    maxWidth: CARD_BASE_WIDTH,
                                    mx: "auto",
                                    mt: "32px",
                                    mb: "40px",
                                    position: "relative",
                                }}
                            >
                                <CardFaceSide
                                    rotated={false}
                                    contentGap={2}
                                    contentClassName="vocab-card-detail__side-two"
                                    iconId={editingCurrentEntry!.iconId}
                                    showIcon
                                    iconLayout={editingCurrentEntry!.iconLayout}
                                    textLayout={editingCurrentEntry!.textLayout}
                                    // Hero is the answer/back face — always renders the advanced layout.
                                    isUsingAdvancedLayout={isAdvancedLayout(editingCurrentEntry!.iconLayout, editingCurrentEntry!.textLayout)}
                                    cardColor={editingCurrentEntry!.cardColor}
                                    textBlocks={{
                                        foreign: (
                                            <ChineseBlock
                                                entry={editingCurrentEntry!}
                                                showPinyin={showPinyin}
                                                showPinyinColor={showPinyinColor}
                                                onSpeak={tts.enabled ? tts.speak : undefined}
                                                speakingKey={tts.speakingKey}
                                                showWriting
                                                inlineActions
                                            />
                                        ),
                                        english: (
                                            <EnglishBlock
                                                entry={editingCurrentEntry!}
                                                selectedSenseIndex={selectedSenseIndex}
                                                onSelectSense={handleSelectSense}
                                                inlineActions
                                            />
                                        ),
                                    }}
                                    // Gesture canvas only in advanced mode; basic mode renders the
                                    // draft through the static icon layer (via editingCurrentEntry).
                                    editCanvas={editMode && advMode ? (
                                        <CardIconCanvas
                                            layout={advDraft}
                                            onChange={setAdvDraftBoth}
                                            selectedIcon={selectedIcon}
                                            selectedText={selectedText}
                                            onSelectTarget={selectTarget}
                                            onInteractionStart={pushAdvHistory}
                                            snap={{ move: snapMove, rotate: snapRotate, resize: snapResize }}
                                            textLayout={textDraft}
                                            onTextChange={setTextDraftBoth}
                                            foreignNode={(
                                                <ChineseBlock
                                                    entry={editingCurrentEntry!}
                                                    showPinyin={showPinyin}
                                                    showPinyinColor={showPinyinColor}
                                                    onSpeak={tts.enabled ? tts.speak : undefined}
                                                    speakingKey={tts.speakingKey}
                                                    showWriting
                                                    inlineActions
                                                />
                                            )}
                                            englishNode={<EnglishBlock entry={editingCurrentEntry!} selectedSenseIndex={selectedSenseIndex} inlineActions />}
                                        />
                                    ) : undefined}
                                />
                            </Box>

                            {/* Info boxes (definition / breakdown / examples / synonyms) —
                                shared with the read-only dictionary cdp. No onWordOpen here,
                                so breakdown/example rows stay passive on the saved-card page. */}
                            <VocabCardSections
                                entry={entry}
                                showPinyin={showPinyin}
                                showPinyinColor={showPinyinColor}
                                // Same slow-rate-aware sentence narration as the flp est.
                                onSpeakSentence={
                                    tts.enabled
                                        ? (text, pronunciation) =>
                                              tts.speakSentence(text, pronunciation, slowExampleSentences ? SLOW_SENTENCE_RATE : 1)
                                        : undefined
                                }
                                speakingKey={tts.speakingKey}
                            />

                            <FooterSpacer />
                        </>
                    ) : null}
                </ContentArea>

                {/* Icon-layout save/reset failure toast (e.g. backend PATCH error) — keeps
                    the editor open and tells the user the write didn't land. */}
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

                {/* Add/change-icon search dialog (download-on-select). docs/CARD_ICON_LAYOUT.md */}
                <IconPickerDialog
                    open={iconSearchOpen}
                    onClose={() => setIconSearchOpen(false)}
                    title={advMode ? "Add an icon" : "Change icon"}
                    onPick={handlePickIcon}
                    initialTerm={lastIconQuery ?? iconSearchTerm(displayCurrentEntry?.definition)}
                    onTermChange={setLastIconQuery}
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
        </NodePage>
    );
};

export default VocabCardDetailPage;
