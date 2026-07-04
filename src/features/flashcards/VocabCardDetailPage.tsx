import { useState, useEffect, useRef } from "react";
import { stripParentheses, iconSearchTerm } from "../../utils/definitionUtils";
import { useParams, useNavigate } from "react-router-dom";
import {
    Box, Typography, Chip, IconButton, Alert, useTheme,
    Slide, Snackbar, Button, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
} from "@mui/material";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import { styled } from "@mui/material/styles";
import LeafPage from "../../components/LeafPage";
import { API_BASE_URL } from "../../constants";
import type { VocabEntry } from "../../types";
import ForeignText from "../../components/ForeignText";
import SegmentedSentenceDisplay from "../../components/SegmentedSentenceDisplay";
import LongDefinitionDisplay from "../../components/LongDefinitionDisplay";
import IconPickerDialog from "../../components/IconPickerDialog";
import { clearWritingDraft } from "../../components/handwriting/writingDraftStore";
import { getBreakdownItems } from "../../utils/breakdownUtils";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useFlashcardLearnSettings } from "../../hooks/useFlashcardLearnSettings";
import { useTTS } from "../../hooks/useTTS";
import { useAuth } from "../../AuthContext";
import { getCategoryColor } from "../../utils/categoryColors";
import { COLORS } from "../../theme/colors";
import { SIZE, WEIGHT, LEADING, TRACKING } from "../../theme/scale";
import { CardFaceSide, ChineseBlock, EnglishBlock } from "./FlashcardsLearnPage/FlashCardSection";
import { measureDefaultEnglishCenterY } from "../../cardIcons/cardTextLayout";
import InfoCardListRow from "./FlashcardsLearnPage/InfoCardListRow";
import { SharedCharsLabel, HskPill, MetadataChipRow } from "./FlashcardsLearnPage/styled";
import { CARD_BASE_WIDTH, CARD_BASE_HEIGHT, FC_FONT } from "./FlashcardsLearnPage/constants";
import { useCardIconEditor } from "./FlashcardsLearnPage/useCardIconEditor";
import CardIconCanvas from "./FlashcardsLearnPage/CardIconCanvas";
import CardEditToolbar, { CARD_EDIT_ANIM_MS, CARD_EDIT_ANIM_EASING, TOOLBAR_DROPDOWN_SELECTOR } from "./FlashcardsLearnPage/CardEditToolbar";

// Phone-frame sizing comes from MobileDemoFrame via Layout.tsx
const ContentArea = styled(Box)(() => ({
    flex: 1,
    overflowY: "auto",
    overflowX: "hidden",
    display: "flex",
    flexDirection: "column",
    padding: "16px",
    gap: "12px",
    // Containing block for the edit toolbar overlay (position: absolute, top: 0)
    // so it sits flush against the header instead of pushing content down.
    position: "relative",
}));

// Info section card — used for each eip-tab-content box below the hero card.
// Styled with the same flashcard-palette tokens as the eip itself (fc.background +
// fc.cardShadowSubtle), so these boxes read as the same visual system and stay
// theme-reactive (COLORS.* is a fixed light-mode palette, not theme-aware).
const SectionCard = styled(Box)(({ theme }) => ({
    backgroundColor: theme.palette.flashcard.background,
    borderRadius: "16px",
    boxShadow: theme.palette.flashcard.cardShadowSubtle,
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
}));

const SectionLabel = styled(Typography)(({ theme }) => ({
    fontSize: SIZE.micro,
    fontWeight: WEIGHT.bold,
    color: theme.palette.flashcard.textSecondary,
    letterSpacing: TRACKING.caps,
    textTransform: "uppercase",
    fontFamily: FC_FONT,
}));

// Category color mapping lives in src/utils/categoryColors (shared with
// MiniVocabCard and the flashcard-learn back-of-card chip).

const VocabCardDetailPage: React.FC = () => {
    usePageTitle("Card");
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    const { token } = useAuth();
    const { settings } = useFlashcardLearnSettings();
    const { showPinyin, showPinyinColor } = settings;
    // Manual word narration — same speaker button flp shows on the back face's
    // ChineseBlock. Hidden when narration is disabled in settings (onSpeak undefined).
    const tts = useTTS();
    const [entry, setEntry] = useState<VocabEntry | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState(false);
    // Which definitionClusters sense EnglishBlock currently shows on the hero card.
    // Mirrors CardFace's own local state — resets to the top/starred sense per entry.
    const [selectedSenseIndex, setSelectedSenseIndex] = useState(0);
    useEffect(() => { setSelectedSenseIndex(0); }, [entry?.id]);

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
        undoAdv,
        redoAdv,
        pushAdvHistory,
    } = useCardIconEditor({ currentEntry: entry, nextEntry: null, token });

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

    const isSingleChar = !!entry && [...entry.entryKey].length === 1;
    // For single-char zh, the breakdown box is replaced by a "Used In" list (mirrors
    // the eip's breakdown/used-in tab — see OnDeckVocabService.enrichWithUsedIn).
    const hasUsedIn = isSingleChar && !!entry?.usedIn && entry.usedIn.length > 0;
    const hasBreakdown = !isSingleChar && entry?.breakdown && Object.keys(entry.breakdown).length > 0;
    const hasExpansion = !!entry?.expansion;
    const hasBreakdownBox = isSingleChar ? (hasUsedIn || hasExpansion) : (hasBreakdown || hasExpansion);
    const breakdownItems = entry ? getBreakdownItems(entry) : [];

    const hasDefinitionBox = !!(entry?.longDefinition || entry?.longDefinitionParts?.length || (entry?.partsOfSpeech?.length ?? 0) > 0 || entry?.vernacularScore != null);
    const hasExamples = entry?.exampleSentences && entry.exampleSentences.length > 0;
    const hasSynonyms = entry?.synonyms && entry.synonyms.length > 0;
    const hasRelatedWords = entry?.relatedWords && entry.relatedWords.length > 0;
    const hasSynonymsOrRelated = hasSynonyms || hasRelatedWords;

    return (
        // Card Detail is a LEAF PAGE: no footer, DOWN back arrow (returns to the
        // previous screen), slides up on enter / down on exit.
        <LeafPage
            title="Card Detail"
            onBack={() => navigate(-1)}
            surfaceColor={COLORS.yellowAccent}
            rightContent={entry && (
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

                            {/* Badge pills — a flat list, not a two-slot row: category
                                (color-coded) plus a single level pill. The level pill reads
                                "HSK N" for zh (whose 1–6 difficulty integers ARE HSK levels)
                                and generically "Level N" for other languages sharing the same
                                1–6 difficulty scale. Reuses the eip's own HskPill/MetadataChipRow
                                styled components. */}
                            {(entry.category || entry.difficulty) && (
                                <MetadataChipRow className="vocab-card-detail__badges-row" sx={{ justifyContent: "flex-start", marginBottom: 0 }}>
                                    {entry.category && (
                                        <Chip
                                            className="vocab-card-detail__category-chip"
                                            label={entry.category}
                                            size="small"
                                            sx={{
                                                backgroundColor: getCategoryColor(entry.category),
                                                color: "white",
                                                fontSize: SIZE.micro,
                                                fontWeight: WEIGHT.bold,
                                                fontFamily: FC_FONT,
                                                height: 22,
                                            }}
                                        />
                                    )}
                                    {entry.difficulty != null && (
                                        <HskPill className="vocab-card-detail__level-pill">
                                            {entry.language === 'zh' ? `HSK ${entry.difficulty}` : `Level ${entry.difficulty}`}
                                        </HskPill>
                                    )}
                                </MetadataChipRow>
                            )}

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
                                                onSelectSense={setSelectedSenseIndex}
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
                                            englishNode={<EnglishBlock entry={editingCurrentEntry!} inlineActions />}
                                        />
                                    ) : undefined}
                                />
                            </Box>

                            {/* Definition — mirrors the eip's "definition" tab: long
                                definition + HSK/parts-of-speech/vernacular meta strip. */}
                            {hasDefinitionBox && (
                                <SectionCard className="vocab-card-detail__definition">
                                    <SectionLabel>Definition</SectionLabel>
                                    {(entry.longDefinition || entry.longDefinitionParts?.length) && (
                                        <LongDefinitionDisplay
                                            className="vocab-card-detail__long-definition-text"
                                            longDefinition={entry.longDefinition}
                                            longDefinitionParts={entry.longDefinitionParts}
                                            showPinyin={showPinyin}
                                            showPinyinColor={showPinyinColor}
                                            sx={{ fontSize: SIZE.body, color: fc.onSurface, fontFamily: FC_FONT, lineHeight: 1.6 }}
                                        />
                                    )}
                                    {/* HSK/Level now lives in the top pill list, so this strip
                                        covers only Type + Vernacular. */}
                                    {((entry.partsOfSpeech?.length ?? 0) > 0 || entry.vernacularScore != null) && (
                                        <Box
                                            className="vocab-card-detail__definition-meta-strip"
                                            sx={{
                                                display: "flex",
                                                gap: "18px",
                                                alignItems: "center",
                                                padding: "10px 0 0",
                                                borderTop: `1px solid ${fc.border}`,
                                            }}
                                        >
                                            {(entry.partsOfSpeech?.length ?? 0) > 0 && (
                                                <Box sx={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                                                    <SectionLabel>Type</SectionLabel>
                                                    <Typography sx={{ fontSize: SIZE.body, fontWeight: WEIGHT.semibold, color: fc.onSurface, fontFamily: FC_FONT }}>
                                                        {entry.partsOfSpeech!.join(', ')}
                                                    </Typography>
                                                </Box>
                                            )}
                                            {entry.vernacularScore != null && (
                                                <Box className="vocab-card-detail__vernacular-meta" sx={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                                                    <SectionLabel>Vernacular</SectionLabel>
                                                    <Box sx={{ display: "flex", alignItems: "center", gap: "4px", height: 19 }}>
                                                        {[1, 2, 3, 4, 5].map((level) => {
                                                            const filled = level <= entry.vernacularScore!;
                                                            return (
                                                                <Box
                                                                    key={level}
                                                                    sx={{
                                                                        width: 8,
                                                                        height: 8,
                                                                        borderRadius: "50%",
                                                                        background: filled ? fc.onSurface : "transparent",
                                                                        border: `1.5px solid ${filled ? fc.onSurface : fc.border}`,
                                                                    }}
                                                                />
                                                            );
                                                        })}
                                                    </Box>
                                                </Box>
                                            )}
                                        </Box>
                                    )}
                                </SectionCard>
                            )}

                            {/* Character Breakdown / Used In + Expansion — mirrors the eip's
                                combined "breakdown" tab (per-character rows for multi-char
                                entries, or "Used In" for single-char zh, plus the Expanded
                                Form block). */}
                            {hasBreakdownBox && (
                                <SectionCard className="vocab-card-detail__breakdown">
                                    <SectionLabel className="vocab-card-detail__section-label">
                                        {isSingleChar ? "Used In" : "Character Breakdown"}
                                    </SectionLabel>
                                    {(isSingleChar ? hasUsedIn : hasBreakdown) && (
                                        <Box className="vocab-card-detail__breakdown-list">
                                            {isSingleChar
                                                ? entry!.usedIn!.map((item, index) => (
                                                    <InfoCardListRow
                                                        key={`${item.vocabEntryId ?? 'det'}-${item.entryKey}`}
                                                        className="vocab-card-detail__used-in-row"
                                                        character={item.entryKey}
                                                        pinyin={item.pronunciation ?? ""}
                                                        definition={item.definition ?? ""}
                                                        size="sm"
                                                        showPinyin={showPinyin}
                                                        showPinyinColor={showPinyinColor}
                                                        isLast={index === entry!.usedIn!.length - 1}
                                                    />
                                                ))
                                                : breakdownItems.map((item, index) => (
                                                    <InfoCardListRow
                                                        key={item.character}
                                                        className="vocab-card-detail__breakdown-row"
                                                        character={item.character}
                                                        pinyin={item.pinyin}
                                                        definition={item.definition}
                                                        size="md"
                                                        showPinyin={showPinyin}
                                                        showPinyinColor={showPinyinColor}
                                                        isLast={index === breakdownItems.length - 1}
                                                    />
                                                ))}
                                        </Box>
                                    )}
                                    {hasExpansion && (
                                        <Box
                                            className="vocab-card-detail__expansion"
                                            sx={{
                                                background: fc.subtleBg,
                                                borderRadius: "10px",
                                                padding: "12px 14px",
                                                display: "flex",
                                                flexDirection: "column",
                                                gap: "8px",
                                            }}
                                        >
                                            <SharedCharsLabel className="vocab-card-detail__expansion-label">
                                                Expanded Form
                                            </SharedCharsLabel>
                                            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                                                <SegmentedSentenceDisplay
                                                    sentence={{
                                                        foreignText: entry.expansion!,
                                                        _segments: entry.expansionSegments ?? [...entry.expansion!],
                                                        segmentMetadata: entry.expansionMetadata ?? undefined,
                                                    }}
                                                    size="md"
                                                    compact
                                                    flexWrap="wrap"
                                                    justifyContent="center"
                                                    className="vocab-card-detail__expansion-chars"
                                                    showPinyin={showPinyin}
                                                    showPinyinColor={showPinyinColor}
                                                />
                                                {entry.expansionLiteralTranslation && (
                                                    <Typography sx={{
                                                        fontSize: SIZE.micro,
                                                        color: fc.textSecondary,
                                                        fontFamily: FC_FONT,
                                                        fontStyle: "italic",
                                                        textAlign: "center",
                                                        lineHeight: LEADING.normal,
                                                    }}>
                                                        "{stripParentheses(entry.expansionLiteralTranslation)}"
                                                    </Typography>
                                                )}
                                            </Box>
                                        </Box>
                                    )}
                                </SectionCard>
                            )}

                            {/* Example Sentences — mirrors the eip's "examples" tab. */}
                            {hasExamples && (
                                <SectionCard className="vocab-card-detail__examples">
                                    <SectionLabel className="vocab-card-detail__section-label">Example Sentences</SectionLabel>
                                    <Box className="vocab-card-detail__examples-list" sx={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                                        {entry.exampleSentences!.map((ex, i) => (
                                            <Box
                                                className="vocab-card-detail__example-item"
                                                key={i}
                                                sx={{
                                                    background: fc.subtleBg,
                                                    borderRadius: "10px",
                                                    padding: "12px 14px",
                                                    display: "flex",
                                                    flexDirection: "column",
                                                    gap: "8px",
                                                }}
                                            >
                                                <SegmentedSentenceDisplay
                                                    sentence={ex}
                                                    size="sm"
                                                    compact
                                                    flexWrap="wrap"
                                                    className="vocab-card-detail__example-chinese"
                                                    showPinyin={showPinyin}
                                                    showPinyinColor={showPinyinColor}
                                                    selectable
                                                />
                                                <Typography
                                                    className="vocab-card-detail__example-english"
                                                    sx={{
                                                        fontSize: SIZE.caption,
                                                        color: fc.textSecondary,
                                                        fontFamily: FC_FONT,
                                                        lineHeight: LEADING.normal,
                                                    }}
                                                >
                                                    {ex.english}
                                                </Typography>
                                            </Box>
                                        ))}
                                    </Box>
                                </SectionCard>
                            )}

                            {/* Synonyms & Related Words — not part of the eip's tabs, so this
                                one box holds both, kept at the very bottom. */}
                            {hasSynonymsOrRelated && (
                                <SectionCard className="vocab-card-detail__synonyms-related">
                                    {hasSynonyms && (
                                        <>
                                            <SectionLabel className="vocab-card-detail__section-label">Synonyms</SectionLabel>
                                            <Box className="vocab-card-detail__synonyms-list" sx={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                                {entry.synonyms!.map((syn) => {
                                                    const meta = entry.synonymsMetadata?.[syn];
                                                    return (
                                                        <Box
                                                            className="vocab-card-detail__synonym-item"
                                                            key={syn}
                                                            sx={{
                                                                backgroundColor: fc.subtleBg,
                                                                borderRadius: "8px",
                                                                padding: "6px 12px",
                                                                display: "flex",
                                                                flexDirection: "column",
                                                                alignItems: "center",
                                                                gap: "2px",
                                                            }}
                                                        >
                                                            <ForeignText
                                                                size="md"
                                                                compact
                                                                text={syn}
                                                                pronunciation={meta?.pronunciation}
                                                            />
                                                            {meta?.definition && (
                                                                <Typography sx={{ fontSize: SIZE.caption, color: fc.textSecondary, fontFamily: FC_FONT, fontStyle: "italic" }}>
                                                                    {stripParentheses(meta.definition)}
                                                                </Typography>
                                                            )}
                                                        </Box>
                                                    );
                                                })}
                                            </Box>
                                        </>
                                    )}
                                    {hasRelatedWords && (
                                        <>
                                            <SectionLabel className="vocab-card-detail__section-label" sx={hasSynonyms ? { mt: 1 } : undefined}>Related Words</SectionLabel>
                                            <Box className="vocab-card-detail__related-words-list" sx={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                                {entry.relatedWords!.map((rel) => (
                                                    <Box
                                                        className="vocab-card-detail__related-word-item"
                                                        key={rel.id}
                                                        sx={{
                                                            backgroundColor: fc.subtleBg,
                                                            borderRadius: "8px",
                                                            padding: "6px 12px",
                                                            display: "flex",
                                                            flexDirection: "column",
                                                            alignItems: "center",
                                                            gap: "2px",
                                                        }}
                                                    >
                                                        <ForeignText
                                                            size="md"
                                                            compact
                                                            text={rel.entryKey}
                                                            pronunciation={rel.pronunciation}
                                                        />
                                                        {rel.definition && (
                                                            <Typography sx={{ fontSize: SIZE.caption, color: fc.textSecondary, fontFamily: FC_FONT, fontStyle: "italic" }}>
                                                                {stripParentheses(rel.definition)}
                                                            </Typography>
                                                        )}
                                                    </Box>
                                                ))}
                                            </Box>
                                        </>
                                    )}
                                </SectionCard>
                            )}

                            {/* Bottom padding */}
                            <Box className="vocab-card-detail__bottom-padding" sx={{ height: 8 }} />
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
        </LeafPage>
    );
};

export default VocabCardDetailPage;
