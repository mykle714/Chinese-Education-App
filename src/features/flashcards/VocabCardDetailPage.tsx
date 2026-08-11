import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { iconSearchTerm, resolveSelectedSenseIndex, sortedSenseClusters, resolveDisplayDefinition } from "../../utils/definitionUtils";
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
import { useTTS, useAutoSpeakEntry, SLOW_SENTENCE_RATE } from "../../hooks/useTTS";
import { COLORS } from "../../theme/colors";
import AddToDeckMenu from "./AddToDeckMenu";
import { CardFaceSide, ChineseBlock, EnglishBlock } from "./FlashcardsLearnPage/FlashCardSection";
import { measureDefaultEnglishCenterY } from "../../cardIcons/cardTextLayout";
import { isAdvancedLayout } from "../../cardIcons/cardIconLayout";
import { CARD_BASE_WIDTH, CARD_BASE_HEIGHT, FC_FONT } from "./constants";
import { useCardIconEditor } from "../../cardIcons/editor/useCardIconEditor";
import CardIconCanvas from "../../cardIcons/editor/CardIconCanvas";
import CardEditToolbar, { CARD_EDIT_ANIM_MS, CARD_EDIT_ANIM_EASING, TOOLBAR_DROPDOWN_SELECTOR } from "../../cardIcons/editor/CardEditToolbar";
import { VocabCardBadges, VocabCardSections } from "./VocabCardDetailBody";
import { getBreakdownItems } from "../../utils/breakdownUtils";
import { useOpenWordCard } from "../../hooks/useOpenWordCard";
import MasteryProgressBar from "./MasteryProgressBar";
import ForeignText from "../../components/ForeignText";
import { apiGet } from '../../api/http';

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
    const { settings } = useFlashcardLearnSettings();
    const { showPinyinColor, slowExampleSentences } = settings;
    // cdp always shows pinyin regardless of the flp pinyin toggle — pinyin is
    // core reference info on the detail page, so we ignore settings.showPinyin here.
    const showPinyin = true;
    // Manual word narration — same speaker button flp shows on the back face's
    // ChineseBlock. Hidden when narration is disabled in settings (onSpeak undefined).
    const tts = useTTS();
    const [entry, setEntry] = useState<VocabEntry | null>(null);
    // Entering the cdp narrates the word once (see useAutoSpeakEntry); the speaker
    // button on the hero card remains available for replays.
    useAutoSpeakEntry(tts, entry);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState(false);
    // Guards the destructive delete behind an explicit confirmation (same pattern as
    // the icon reset-to-default dialog below).
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    // Which definitionClusters sense EnglishBlock currently shows on the hero card.
    // Mirrors CardFace: seeds from this saved card's PERSISTED choice (`selectedSense` label →
    // sorted index, migration 99), falling back to the top/starred sense. Persisted on pick.
    const [selectedSenseIndex, setSelectedSenseIndex] = useState(0);
    useEffect(() => { setSelectedSenseIndex(entry ? resolveSelectedSenseIndex(entry) : 0); }, [entry?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    // Drill-in: the info boxes' breakdown blocks, "Used In" rows and example-sentence
    // segments open the tapped word's cdp — the learner's own saved card when they
    // have one, else the read-only dictionary cdp (see useOpenWordCard). Prewarm the
    // lookup cache with this card's breakdown characters + used-in words so the first
    // tap navigates without a round trip.
    const linkableWords = useMemo(
        () => [
            ...getBreakdownItems(entry).map((item) => item.character),
            ...(entry?.usedIn ?? []).map((item) => item.entryKey),
        ],
        [entry]
    );
    const handleWordOpen = useOpenWordCard(linkableWords);

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
    } = useCardIconEditor({ currentEntry: entry, nextEntry: null });

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
                const data = await apiGet<VocabEntry>(`/api/vocabEntries/${id}`);
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

    // Hard-deletes the VocabEntry and returns to the decks page. Only reachable
    // after the user confirms in the delete dialog.
    const handleDeleteConfirmed = async () => {
        if (!entry) return;
        try {
            setActionLoading(true);
            const response = await fetch(`${API_BASE_URL}/api/vocabEntries/${entry.id}`, {
                method: 'DELETE',
                credentials: 'include',
            });
            if (!response.ok) throw new Error('Failed to delete card');
            setDeleteConfirmOpen(false);
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
                    {/* File this card into any of the user's decks (docs/DECKS_FEATURE.md).
                        First in the row because it is additive, unlike Edit and Delete. */}
                    <AddToDeckMenu
                        vocabEntryId={entry.id}
                        className="vocab-card-detail__add-to-deck"
                        color={fc.textSecondary}
                    />
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
                        onClick={() => setDeleteConfirmOpen(true)}
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
                                        englishLabel={resolveDisplayDefinition(entry, selectedSenseIndex)}
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
                                stacked bar + per-type composition for this saved card, with
                                a cpcd block of the card's word to its left. Block layout
                                falls back to a row automatically past 4 characters (see
                                ForeignText.layout), so longer words just read as before. */}
                            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1.5, my: 1.5 }}>
                                <ForeignText
                                    size="xl"
                                    layout="block"
                                    language={entry.language}
                                    text={entry.entryKey}
                                    pronunciation={entry.pronunciation}
                                    showPinyin={showPinyin}
                                    useToneColor={showPinyinColor}
                                />
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
                                                selectedSenseIndex={selectedSenseIndex}
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
                                                    selectedSenseIndex={selectedSenseIndex}
                                                />
                                            )}
                                            englishNode={<EnglishBlock entry={editingCurrentEntry!} selectedSenseIndex={selectedSenseIndex} inlineActions />}
                                        />
                                    ) : undefined}
                                />
                            </Box>

                            {/* Info boxes (definition / breakdown / examples / synonyms) —
                                shared with the read-only dictionary cdp. onWordOpen makes the
                                breakdown blocks / used-in rows / example segments drill into
                                the tapped word's cdp (saved card first, dictionary fallback). */}
                            <VocabCardSections
                                entry={entry}
                                showPinyin={showPinyin}
                                showPinyinColor={showPinyinColor}
                                onWordOpen={handleWordOpen}
                                // Keeps the Definition box's long definition on the same
                                // sense as the picker above (per-sense longDefinition).
                                selectedSenseIndex={selectedSenseIndex}
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
                    initialTerm={lastIconQuery ?? iconSearchTerm(displayCurrentEntry ? resolveDisplayDefinition(displayCurrentEntry, selectedSenseIndex) : null)}
                    onTermChange={setLastIconQuery}
                    prefetched={pickerPrefetched}
                />

                {/* Delete-card confirmation — the delete is a hard delete of the
                    VocabEntry (review history included), so it must be explicit. */}
                <Dialog
                    className="vocab-card-detail__delete-dialog"
                    open={deleteConfirmOpen}
                    onClose={() => !actionLoading && setDeleteConfirmOpen(false)}
                >
                    <DialogTitle>Delete this card?</DialogTitle>
                    <DialogContent>
                        <DialogContentText>
                            This permanently removes{entry ? ` "${entry.entryKey}"` : " this card"} from
                            your collection, along with its review history. This can't be undone.
                        </DialogContentText>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setDeleteConfirmOpen(false)} disabled={actionLoading}>
                            Cancel
                        </Button>
                        <Button onClick={handleDeleteConfirmed} color="error" disabled={actionLoading}>
                            Delete
                        </Button>
                    </DialogActions>
                </Dialog>

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
