import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { iconSearchTerm, resolveSelectedSenseIndex, senseLabelForIndex, resolveDisplayDefinition } from "../../utils/definitionUtils";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { lensFromSearch } from "./collectionRef";
import {
    Box, IconButton, Alert, useTheme,
    Slide, Snackbar, Button, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
} from "@mui/material";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import { styled } from "@mui/material/styles";
import NodePage from "../../components/NodePage";
import { FOOTER_HEIGHT } from "../../components/MobileFooter";
import { API_BASE_URL } from "../../constants";
import type { VocabEntry } from "../../types";
import IconPickerDialog from "../../components/IconPickerDialog";
import { clearWritingDraft } from "../../components/handwriting/writingDraftStore";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useFlashcardLearnSettings } from "../../hooks/useFlashcardLearnSettings";
import { useTTS, SLOW_SENTENCE_RATE } from "../../hooks/useTTS";
import { COLORS } from "../../theme/colors";
import AddToDeckMenu from "./AddToDeckMenu";
import { CardFaceSide, ChineseBlock, EnglishBlock } from "./FlashcardsLearnPage/FlashCardSection";
import { measureDefaultEnglishCenterY } from "../../cardIcons/cardTextLayout";
import { isAdvancedLayout } from "../../cardIcons/cardIconLayout";
import { CARD_BASE_WIDTH, CARD_BASE_HEIGHT, FC_FONT } from "./constants";
import { useCardIconEditor } from "../../cardIcons/editor/useCardIconEditor";
import CardIconCanvas from "../../cardIcons/editor/CardIconCanvas";
import CardEditToolbar, { CARD_EDIT_ANIM_MS, CARD_EDIT_ANIM_EASING, TOOLBAR_DROPDOWN_SELECTOR } from "../../cardIcons/editor/CardEditToolbar";
import { VocabCardSections } from "./VocabCardDetailBody";
import { getBreakdownItems } from "../../utils/breakdownUtils";
import { useOpenWordCard } from "../../hooks/useOpenWordCard";
import MasteryWindow from "../../components/mastery/MasteryWindow";
import WordToolsRail from "../../components/WordToolsRail";
import Icon from "../../components/Icon";
import InfoPeek from "./InfoPeek";
import SheetPanel, { type SheetPanelBodyHandle } from "./FlashcardsLearnPage/SheetPanel";
import SheetBody from "./FlashcardsLearnPage/SheetBody";
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

// Height of the resting `.peek` lip (grabber + one row + its padding). The lip is
// absolutely positioned at frame level, so the scrolling column has to reserve the
// space itself or its last row hides behind it. Derived from the lip's own parts
// rather than typed as one number, so restyling InfoPeek can't silently tuck the
// mastery cooldowns underneath it.
const PEEK_ROW_HEIGHT = 22;   // the icon/word/label row
const PEEK_VPAD_SUM = 9 + 4 + 11 + 15; // top pad + grabber + its margin + bottom pad
const PEEK_HEIGHT = PEEK_ROW_HEIGHT + PEEK_VPAD_SUM;
// …plus a breathing gap, and MINUS the footer clearance the scroll area already
// reserves (the lip stands on top of the footer bar, not beside it).
const PEEK_CLEARANCE = PEEK_HEIGHT + 12;

const VocabCardDetailPage: React.FC = () => {
    usePageTitle("Card");
    const { id } = useParams<{ id: string }>();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    // The mastery LENS this card was opened under (docs/DECKS_FEATURE.md § "Mastery
    // Centers"). `?bar=reading` means the learner came from the Reading Center, so the
    // Mastery section below shows the reading bar alone; absent it reads `core` and the
    // section shows recognition + production alone. Exactly one bar either way — this
    // page answers the question the surface that opened it was asking.
    const lens = lensFromSearch(searchParams);
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
    // The cdp does NOT narrate on landing. It is a reference page a learner opens to
    // read — often mid-thought, often several in a row via the breakdown/"Used In"
    // drill-ins — and speaking unbidden on every arrival is noise (and, on a drill-in
    // chain, a queue of overlapping words). Narration here is entirely manual: the
    // speaker button on the hero card and on each example sentence.
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState(false);
    // Guards the destructive delete behind an explicit confirmation (same pattern as
    // the icon reset-to-default dialog below).
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    // The extra-info sheet (artboard 18's `.peek`). The definition / breakdown /
    // examples boxes used to run down the page under the hero card, which made the cdp
    // a long scroll whose first screen was the only part most visits read. They are the
    // same content as the flp's eip, so they now live in the same place: a sheet that
    // rests as a lip at the bottom of the page and is pulled up when wanted. What stays
    // on the page is what the page is FOR — the card, and how well it is known.
    //
    // Modal (not persistent): unlike the decks sheet this one has nothing to show at
    // rest, so it mounts on open and unmounts on close, which also resets its open
    // animation. `InfoPeek` is the always-drawn lip that opens it.
    const [infoOpen, setInfoOpen] = useState(false);
    const infoBodyRef = useRef<SheetPanelBodyHandle | null>(null);
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

    // "Compare" on the word-tools rail. The flp can open Compare as an eip TAB beside
    // the word it is comparing; the cdp has no tab strip, so it hands the word to the
    // standalone Compare page instead, pre-filling slot A through route state (see
    // ComparePage). Same feature, same component underneath — only the host differs.
    const handleCompare = useCallback(
        (target: VocabEntry) => navigate("/compare", { state: { slotA: target } }),
        [navigate]
    );

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
        persistSelectedSense(entry, senseLabelForIndex(entry, index));
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
            onBack={() => navigate(-1)}
            // Four things share this header line (add-to-deck, edit, delete, and the
            // title): 21px collides, so the Card Detail artboard drops to 18px.
            headerSize="dense"
            surfaceColor={COLORS.yellowAccent}
            // No top edge-fade: the hero card shouldn't dissolve at the top.
            topFade={false}
            // Frame-level furniture, rendered OUTSIDE the scroll area (see NodePage's
            // `overlay`): the resting peek lip, and the extra-info sheet it raises.
            overlay={entry && (
                <>
                    <InfoPeek
                        className="vocab-card-detail__info-peek"
                        word={entry.entryKey}
                        language={entry.language}
                        onOpen={() => setInfoOpen(true)}
                        // The cdp keeps the footer bar, so the lip stands on top of it
                        // rather than at the bottom of the frame (artboard 18's
                        // `.peek{bottom:74px}`).
                        bottom={FOOTER_HEIGHT}
                        // Greyed while the icon editor is open: the sheet would cover the
                        // canvas being edited. Same rule the flp's lip follows.
                        disabled={editMode}
                    />
                    {infoOpen && (
                        <SheetPanel
                            bodyRef={infoBodyRef}
                            onClose={() => setInfoOpen(false)}
                        >
                            <SheetBody
                                ref={infoBodyRef}
                                className="vocab-card-detail__info-body"
                                // VocabCardSections is a stack of self-padded boxes with
                                // no gutter of its own — it was written for a page column
                                // that supplied one. The sheet supplies the same 16px.
                                sx={{ padding: "14px 16px 0", gap: "12px" }}
                            >
                                {/* The SAME sections the page used to stack inline, and
                                    the same ones the read-only dictionary cdp renders —
                                    only their container changed. */}
                                <VocabCardSections
                                    entry={entry}
                                    showPinyin={showPinyin}
                                    showPinyinColor={showPinyinColor}
                                    onWordOpen={handleWordOpen}
                                    // Keeps the Definition box's long definition on the
                                    // same sense as the card above it (per-sense
                                    // longDefinition).
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
                            </SheetBody>
                        </SheetPanel>
                    )}
                </>
            )}
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
                        navigation to a separate edit form.

                        Both glyphs are Material Symbols via `Icon` (D3), not
                        `@mui/icons-material` components: the artboard's header names
                        `edit` and `delete`, and the ligature face is where every other
                        converted surface takes its icons from. */}
                    <IconButton
                        className="vocab-card-detail__edit-button"
                        aria-label="Edit card"
                        onClick={() => (editMode ? exitEdit() : enterEdit(() => heroCardRef.current ? measureDefaultEnglishCenterY(heroCardRef.current) : null))}
                    >
                        <Icon name="edit" size={20} color={editMode ? theme.palette.primary.main : COLORS.iconColor} />
                    </IconButton>
                    <IconButton
                        className="vocab-card-detail__delete-button"
                        aria-label="Delete card"
                        disabled={actionLoading}
                        onClick={() => setDeleteConfirmOpen(true)}
                    >
                        <Icon name="delete" size={20} color={COLORS.dangerInk} />
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

                            {/* WORD TOOLS — `Write it` and `Compare`, on their own rail
                                above the card and outside its boundary. They act on the
                                WORD, not on this card, which is why they are not in the
                                header row above (add-to-deck / edit / delete, all card
                                operations) — see WordToolsRail. */}
                            <WordToolsRail
                                className="vocab-card-detail__word-tools"
                                entry={entry}
                                onCompare={handleCompare}
                            />

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
                                    // The badge row and the standalone cpcd header that
                                    // used to sit above the card are gone (artboard 18):
                                    // "the card is the masthead — ONE presentation of the
                                    // word". The page was printing the headword twice at
                                    // two sizes, and the category chip now reads off the
                                    // mastery window's own band pill, which is the band of
                                    // the track being looked at rather than only the core
                                    // one. So the card starts right under the tools rail.
                                    mb: "8px",
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

                            {/* MASTERY (docs/MASTERY_REWORK.md, artboard 18).
                                `MasteryWindow` renders the eight-mark window plus its own
                                `Mastery` rule and the Know / Read / Write switch; the
                                `lens` is which track it opens on, so a card reached from a
                                Mastery Center still reports that skill first. The old
                                vertical bar + its SectionCard wrapper are gone — see D6/D7
                                in docs/SHELF_REDESIGN.md.

                                Negative side margin cancels ContentArea's 16px so the
                                section rule runs to the design's 22px page gutter, which
                                is what every other converted section sits on. */}
                            <MasteryWindow
                                className="vocab-card-detail__mastery"
                                entry={entry}
                                lens={lens}
                            />

                            {/* Clearance for the resting peek lip, which is frame-level
                                furniture and therefore not in this column's flow. Without
                                it the mastery cooldowns end up behind the lip on a short
                                card. */}
                            <Box className="vocab-card-detail__peek-clearance" sx={{ height: `${PEEK_CLEARANCE}px`, flexShrink: 0 }} />
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
