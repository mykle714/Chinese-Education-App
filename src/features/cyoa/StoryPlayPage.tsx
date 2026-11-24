import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Box, Collapse, Typography, useMediaQuery, useTheme } from "@mui/material";
import NodePageHeader from "../../components/NodePageHeader";
import { HeaderIconButton } from "../../components/PageHeader";
import { ReaderAudioChip } from "../../components/AudioModeChip";
import VocabDisplayCard from "../../components/VocabDisplayCard";
import { usePageSlide } from "../../hooks/usePageSlide";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { useTier2Look } from "../../timeOfDay/useTier2Look";
import type { Language } from "../../types";
import TextArea from "../../reading/TextArea";
import ReaderCpcdView from "../../reading/ReaderCpcdView";
import ReaderDisplayToggle from "../../reading/ReaderDisplayToggle";
import ReaderIconKey from "../../reading/ReaderIconKey";
import ReaderPhraseToggle from "../../reading/ReaderPhraseToggle";
import { useReaderStepMode } from "../../reading/useReaderStepMode";
import ReaderReadAloudButton from "../../reading/ReaderReadAloudButton";
import { buildReaderPronunciationMap, type SpanRange } from "../../reading/documentSegmentation";
import { useReaderDisplayMode } from "../../reading/useReaderDisplayMode";
import { useReaderReadAloud } from "../../reading/useReaderReadAloud";
import { useSegmentOverrides } from "../../reading/useSegmentOverrides";
import { useFlashcardLearnSettings } from "../../hooks/useFlashcardLearnSettings";
import ReadingEipHost from "../../reading/ReadingEipHost";
import ReadingTapRegion from "../../reading/ReadingTapRegion";
import { READER_PAGE_PAD_PX, readerSearchColors, readerSelectionColor } from "../../reading/readerStyles";
import { useContentVocabulary } from "../../reading/useContentVocabulary";
import { useEnglishTranslations } from "../../reading/useEnglishTranslations";
import { useReaderAudioSettings } from "../../reading/useReaderAudioSettings";
import { useReadingKeycap } from "../../reading/useReadingKeycap";
import { useReadingText } from "../../reading/useReadingText";
import { useReadingVocabSync } from "../../reading/useReadingVocabSync";
import { useStoryPlay } from "./useStoryPlay";
import StoryChoiceStack from "./StoryChoiceStack";
import StoryEdgeTab from "./StoryEdgeTab";
import StoryEndPanel from "./StoryEndPanel";
import { cyoaMessageSx, cyoaMutedTextSx } from "./cyoaStyles";
import { ADVENTURES_LIST_PATH, storyEditPath } from "./adventuresPaths";

/**
 * StoryPlayPage — `/adventures/:id`, reading one story (docs/CYOA_FEATURE.md § 3).
 *
 * A footerless NODE-STYLE drill-in from `/adventures`, composed like the Reader's
 * document surface (src/features/reader/ReaderDocumentSurface.tsx): `NodePageHeader`
 * (left arrow) + `usePageSlide({ axis: "x" })`, on the Tier 2 time-of-day ground (§ 3.7).
 * It does not import that surface — features may not import each other
 * (docs/FRONTEND_LAYERING.md) — and the composition is a dozen lines.
 *
 * Layout, top → bottom (§ 3.1):
 *   header        — back arrow (→ where the reader came from: `location.state.from`,
 *                   set by the editor's Preview; else /adventures), NO title text (more
 *                   room for the passage); the tap-to-hear chip (where the Reader keeps
 *                   it); for the story's own author, an Edit icon (→ /adventures/:id/edit, § 5)
 *   rdb           — the Reader's dictionary keycap, the same component and wiring
 *                   (src/reading/useReadingKeycap): tap demo, entry, speaker, Add,
 *                   More Info → the eip, Sentence Explain, the split-screen phrase face
 *   toolbar       — the Reader's display strip, rebuilt (2026-11-23, in the space the
 *                   rdb's pull-down tab used to take): Read aloud and the rdb's fold key
 *                   at the left, the Phrase pill (Chinese) and the Pinyin pill at the
 *                   right. It rides the rdb's lower edge, so it slides with it and sits
 *                   under the header when the rdb is folded (§ 3.1, § 3.4)
 *   passage       — the Reader's reading box (src/reading/TextArea + ReadingTapRegion):
 *                   gsa words, tap-to-navigate over the full width, long-press word jump
 *                   and sentence press; scrolls internally for a long passage
 *   notice        — a one-line message after a failed / stale pick
 *   bottom tab    — StoryEdgeTab, the choices' show/hide, standing on the stack's upper
 *                   edge so it slides with it; on the screen's foot when folded (§ 3.4)
 *   choice stack  — 1–4 keys (StoryChoiceStack), folded by the bottom tab (§ 3.4);
 *                   on an ending, the end panel instead (§ 3.6); "To be continued"
 *                   under all-disabled choices (§ 3.6a)
 *
 * ── The reading engine on this page (§ 4) ─────────────────────────────────────
 * TWO texts, ONE keycap. The passage and the inspected choice's label (§ 3.2) are each a
 * useReadingText; one vocabulary lookup covers the passage and every label
 * (useContentVocabulary over `vocabContent`), so inspecting needs no fetch. The keycap
 * follows the ACTIVE text — the label while a choice is inspected, else the passage.
 * Like the Reader, the active text's textarea always holds focus (useTextSelection's
 * blur → refocus); the other one stands down. Entering inspect mode parks the passage's
 * word and starts the label in nothing-selected mode; leaving restores the passage word.
 * The Reader's display-strip controls sit in the toolbar under the rdb, laid out like the
 * Reader's strip (owner's call 2026-11-23, reversing 2026-11-21's "just the rdb" header
 * placement): Read aloud (useReaderReadAloud, over the passage), the Phrase pill
 * (ReaderPhraseToggle over useReaderStepMode, `reader.stepMode`) and the Pinyin pill
 * (ReaderDisplayToggle over useReaderDisplayMode, `reader.displayMode`); the tap-to-hear
 * chip (ReaderAudioChip over useReaderAudioSettings, `reader.audio`) stays in the header,
 * as on the Reader. The settings are the Reader's own, so the pages share them. Pinyin mode draws the
 * passage as ReaderCpcdView; the inspected label stays plain text. Search stays Reader-only.
 *
 * State: useStoryPlay (server round trips). Local UI state: inspect mode, the two folds.
 * Minute points: `/adventures` is in MINUTE_POINTS_ELIGIBLE_PAGES (§ 8), like `/reader`.
 *
 * Layer: feature page (src/features/cyoa). Route row: src/routes/routeMeta.ts.
 */

/**
 * The folds' motion — the Reader's KEYBOARD LIFT curve (§ 3.4). Same values as
 * src/features/beginnerKeyboard/transition.ts (BEGINNER_KEYBOARD_SLIDE_MS / _EASING),
 * mirrored rather than imported across features.
 */
const FOLD_TIMEOUT = { enter: 300, exit: 220 };
const FOLD_EASING = { enter: "cubic-bezier(0.0, 0, 0.2, 1)", exit: "cubic-bezier(0.4, 0, 0.6, 1)" };

/**
 * Makes the rdb's top fold a SLIDE, not a wipe. A Collapse grows its height with the content
 * pinned to the top, so a panel under the header would be uncovered from the top down while
 * standing still. Pinning the content to the fold's BOTTOM edge (a flex-end column; the
 * wrapper must not shrink) makes it overflow — and get clipped — at the top instead, so the
 * keycap travels down out of the header together with the tab riding its lower edge.
 * The choices' fold needs nothing: it sits at the foot and grows upward, so top-pinned
 * content already rises with its edge.
 */
const FOLD_SLIDE_DOWN_SX = {
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    "& > .MuiCollapse-wrapper": { flexShrink: 0 },
} as const;

/**
 * The content padding, the Reader's (readerStyles → READER_PAGE_PAD_PX: 16 / 24px). The
 * passage runs full-bleed instead and folds it into the reading box's own padding.
 */
const CONTENT_PAD_PX = READER_PAGE_PAD_PX;

function StoryPlayPage() {
    const { id: storyId } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const location = useLocation();
    const slideNavigate = useSlideNavigate();
    const theme = useTheme();
    // Back returns to the page that opened this one when it said so (the editor's Preview
    // passes `state.from`, the ChallengeDetailPage convention); a plain open → the list.
    const backTo = (location.state as { from?: string } | null)?.from ?? ADVENTURES_LIST_PATH;
    // Called ONCE here (it claims the CpcdPopup/status-bar chrome) and passed down.
    const look = useTier2Look();
    const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
    const { surfaceRef, style, exit } = usePageSlide({ axis: "x" });

    const { status, play, choosing, notice, endingsFoundBefore, choose } = useStoryPlay(storyId);
    usePageTitle(play?.story.title ?? "Adventures");

    // The choice being inspected (§ 3.2), and whether the rdb and the choice stack show (§ 3.4).
    const [inspectingId, setInspectingId] = useState<string | null>(null);
    const [rdbOpen, setRdbOpen] = useState(true);
    const [choicesOpen, setChoicesOpen] = useState(true);

    const passageId = play?.passage.id ?? null;
    const passageContent = play?.passage.content ?? "";
    const choices = useMemo(() => play?.passage.choices ?? [], [play]);
    const inspectedChoice = inspectingId ? choices.find((choice) => choice.id === inspectingId) ?? null : null;
    const language = (play?.story.language ?? "zh") as Language;

    // ── The reading engine (see the header) ──
    // One lookup for the passage AND its labels, re-read per passage.
    const vocabContent = play ? [passageContent, ...choices.map((choice) => choice.label)].join("\n") : null;
    const vocab = useContentVocabulary(vocabContent);
    const english = useEnglishTranslations(vocabContent ?? undefined, language);
    // Tiebreak switches made in the Pinyin view (the passage only; dropped per passage).
    const { overrides: passageOverrides, switchToAlternative: applyAlternative } = useSegmentOverrides(passageContent);
    // PHRASE STEPPING (docs/READER_SEGMENTATION.md § "Phrase stepping"): the toolbar's Phrase
    // pill — the Reader's own per-device setting. Chinese stories only (the rules are
    // Chinese grammar). The passage and the inspected label both follow it.
    const { stepMode, setStepMode } = useReaderStepMode();
    const phraseStepping = language === "zh";
    const stepByPhrase = phraseStepping && stepMode === "phrase";
    const passageText = useReadingText({
        content: passageContent,
        dictionaryCards: vocab.loadedDictionaryCards,
        personalCards: vocab.loadedPersonalCards,
        translateEnglish: english.translate,
        overrides: passageOverrides,
        stepByPhrase,
    });
    const labelText = useReadingText({
        content: inspectedChoice?.label ?? "",
        dictionaryCards: vocab.loadedDictionaryCards,
        personalCards: vocab.loadedPersonalCards,
        translateEnglish: english.translate,
        stepByPhrase,
    });
    useReadingVocabSync(vocabContent, vocab.setLoadedPersonalCards, [passageText.selection, labelText.selection]);
    const passageSelection = passageText.selection;
    const labelSelection = labelText.selection;

    const inspecting = inspectedChoice !== null;

    // ── The toolbar's reading controls (§ 3.1) — the Reader's own, on the Reader's settings ──
    // Pinyin display mode (ReaderCpcdView over the passage): the same per-device
    // `reader.displayMode` as the Reader's pill, the pinyin from the loaded cards, tinted by
    // the device's "Color pinyin by tone" preference. The inspected label stays plain text.
    const { displayMode, setDisplayMode } = useReaderDisplayMode();
    const showCpcd = displayMode === "pinyin";
    const pronunciations = useMemo(
        () => buildReaderPronunciationMap(vocab.loadedDictionaryCards, vocab.loadedPersonalCards),
        [vocab.loadedDictionaryCards, vocab.loadedPersonalCards]
    );
    const { settings: { showPinyinColor } } = useFlashcardLearnSettings();
    const cpcdScrollRef = useRef<HTMLDivElement | null>(null);
    const searchColors = useMemo(() => readerSearchColors(look.dark), [look.dark]);
    const { selectRange: selectPassageRange } = passageText.selection;
    const switchToAlternative = useCallback(
        (alternative: SpanRange) => applyAlternative(alternative, selectPassageRange),
        [applyAlternative, selectPassageRange]
    );
    // Read aloud (useReaderReadAloud) over the PASSAGE, from its caret: one clause per clip,
    // moving the word selection along. Any tap elsewhere stops it (the hook's window
    // listeners) — including 🔍, so it never reads into inspect mode. The pinyin hint is
    // Chinese-only.
    const readAloud = useReaderReadAloud({
        content: passageContent,
        spans: passageText.spans,
        pronunciations: language === "zh" ? pronunciations : null,
        inputRef: passageText.selection.inputRef,
        selectRange: selectPassageRange,
        documentLanguage: language,
        textareaVisible: !showCpcd,
    });
    const activeText = inspecting ? labelText : passageText;
    const readerAudio = useReaderAudioSettings();
    const keycap = useReadingKeycap({
        text: activeText,
        content: inspecting ? inspectedChoice.label : passageContent,
        activeKey: inspecting ? inspectedChoice.id : "passage",
        language,
        dictionaryCards: vocab.loadedDictionaryCards,
        vocabLoading: vocab.processingVocab,
        translateEnglish: english.translate,
        translationInLearning: english.translationInLearning,
        autoplay: readerAudio.autoplay,
        // Tap-to-hear stands down while Read aloud steps the selection (it is already speaking).
        readAloudPlaying: readAloud.playing,
    });
    const { wordActions, tapZoneFlash, clearTapZoneFlash } = keycap;
    const eipOpen = wordActions.eipOpen;

    // The Reader's selection tint (readerStyles → readerSelectionColor).
    const selectionColors = useMemo(
        () => ({ backgroundColor: readerSelectionColor(look.dark, theme.palette.primary.main) }),
        [look.dark, theme.palette.primary.main]
    );

    // A new passage starts fresh: no inspection, both panels showing, and the passage in
    // NOTHING-SELECTED MODE with its caret at the top (the Reader's document open). The
    // passage's textarea is keyed by its id, so this runs against the new element.
    const { clearSelection: clearPassageSelection, focusTextArea: focusPassage } = passageSelection;
    useEffect(() => {
        setInspectingId(null);
        setChoicesOpen(true);
        setRdbOpen(true);
        if (passageId) clearPassageSelection(0);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [passageId]);

    // Inspect mode in and out (§ 3.2). In: the label's reading box takes focus in
    // nothing-selected mode (the passage's word is parked — its textarea keeps the range),
    // and a folded rdb slides back out so the label's words have somewhere to show.
    // Out: the passage gets its focus and its parked word back.
    const { clearSelection: clearLabelSelection } = labelSelection;
    const wasInspectingRef = useRef(false);
    useEffect(() => {
        if (inspectingId) {
            setRdbOpen(true);
            clearLabelSelection(0);
        } else if (wasInspectingRef.current) {
            focusPassage(true);
        }
        wasInspectingRef.current = inspectingId !== null;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [inspectingId]);

    // Closing the eip hands focus back to the active text, word and all (the Reader's
    // dialog-close rule).
    const wasEipOpenRef = useRef(eipOpen);
    useEffect(() => {
        if (wasEipOpenRef.current && !eipOpen) activeText.selection.focusTextArea(true);
        wasEipOpenRef.current = eipOpen;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [eipOpen]);

    // The blur → refocus loop, for the active text only: the passage stands down while a
    // choice is inspected, and both while the eip (whose controls need focus) is open.
    const { handleTextAreaBlur: passageBlur } = passageSelection;
    const { handleTextAreaBlur: labelBlur } = labelSelection;
    const handlePassageBlur = useCallback((event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (eipOpen || inspectingId) return;
        passageBlur(event);
    }, [eipOpen, inspectingId, passageBlur]);
    const handleLabelBlur = useCallback((event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (eipOpen || !inspectingId) return;
        labelBlur(event);
    }, [eipOpen, inspectingId, labelBlur]);

    const handleBack = useCallback(() => exit(() => navigate(backTo)), [exit, navigate, backTo]);
    const handleBackToList = useCallback(() => navigate(ADVENTURES_LIST_PATH), [navigate]);

    const isEnding = play?.ending != null;
    // An ending has no choices, so there is nothing to fold: the end panel always shows.
    const hasFoldablePanel = play !== null && !isEnding;

    // The inspected label as a small reading box (§ 3.2), drawn by StoryChoiceStack in place
    // of the label's text: the same TextArea at `size="inline"`, with its own tap region
    // (the back / forward thirds of the label) and, while it is active, the keycap demo's
    // zone flash.
    const passageTextValue = useMemo(() => ({ content: passageContent }), [passageContent]);
    const labelTextValue = useMemo(() => ({ content: inspectedChoice?.label ?? "" }), [inspectedChoice?.label]);
    const inspectedLabel = inspectedChoice ? (
        <Box className="story-choice__reader" sx={{ position: "relative", width: "100%", opacity: inspectedChoice.available ? 1 : 0.55 }}>
            <TextArea
                look={look}
                size="inline"
                selectedText={labelTextValue}
                autoSelectEnabled
                segmentSpans={labelText.stepSpans}
                selectionColors={selectionColors}
                onTextChange={labelSelection.handleTextChange}
                onAutoWordSelect={labelSelection.handleAutoWordSelect}
                onTextSelectionChange={labelSelection.handleTextSelectionChange}
                inputRef={labelSelection.inputRef}
                onBlur={handleLabelBlur}
                onUserInteraction={labelSelection.noteUserInteraction}
                onSelectSentenceAtOffset={labelSelection.selectSentenceAtOffset}
            />
            <ReadingTapRegion
                className="story-choice__tap-region"
                inputRef={labelSelection.inputRef}
                wordSource="text"
                onSelectSpanAtOffset={labelSelection.selectSpanAtOffset}
                onClearSelection={labelSelection.clearSelection}
                onSelectSentence={labelSelection.selectSentenceAtSelection}
                onTapInsideSelection={labelText.drillAtOffset}
                flash={tapZoneFlash}
                onFlashEnd={clearTapZoneFlash}
                night={look.dark}
            />
        </Box>
    ) : null;

    return (
        <Box
            ref={surfaceRef}
            className="story-play-surface"
            style={{ ...style, backgroundColor: look.ground }}
            sx={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}
        >
            {/* No title text (§ 3.1). */}
            <NodePageHeader
                title=""
                onBack={handleBack}
                titleColor={look.ink}
                rightContent={
                    <Box className="story-play__header-actions" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        {/* The tap-to-hear chip, in the header as on the Reader (§ 3.1); the
                        other reading controls are in the toolbar under the rdb. Keeps focus
                        on the reading box on a desktop mousedown (no blur → refocus loop). */}
                        {status === "ready" && (
                            <Box
                                className="story-play__audio-chip-wrapper"
                                onMouseDown={(event) => event.preventDefault()}
                                sx={{ display: "flex" }}
                            >
                                <ReaderAudioChip
                                    className="story-play__audio-chip"
                                    // `look.ink`, the pills' text ink, as on the Reader's header
                                    // chip (owner's call 2026-11-18).
                                    ink={look.ink}
                                    mode={readerAudio.mode}
                                    onCycle={readerAudio.cycleMode}
                                />
                            </Box>
                        )}
                        {play?.story.isOwn && storyId && (
                            <HeaderIconButton
                                className="story-play__edit"
                                icon="edit"
                                label="Edit story"
                                color={look.ink2}
                                onClick={() => slideNavigate(storyEditPath(storyId))}
                            />
                        )}
                    </Box>
                }
            />

            <Box className="story-play-body" sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                {status === "loading" && (
                    <Typography className="story-play-loading" sx={cyoaMutedTextSx(look)}>Loading…</Typography>
                )}
                {status === "unavailable" && (
                    <Typography className="story-play-unavailable" sx={cyoaMutedTextSx(look)}>
                        This story is no longer available.
                    </Typography>
                )}
                {status === "error" && (
                    <Typography className="story-play-error" sx={cyoaMutedTextSx(look)}>
                        Couldn't load this story. Please try again later.
                    </Typography>
                )}

                {status === "ready" && play && (
                    <>
                        {/* The rdb's fold: the keycap slides down from under the header and
                        the toolbar rides on its lower edge, so it travels with it (§ 3.4). */}
                        <Collapse
                            className="story-play-rdb-fold"
                            in={rdbOpen}
                            timeout={reducedMotion ? 0 : FOLD_TIMEOUT}
                            easing={FOLD_EASING}
                            sx={FOLD_SLIDE_DOWN_SX}
                        >
                            <Box className="story-play-rdb" sx={{ px: { xs: `${CONTENT_PAD_PX.xs}px`, sm: `${CONTENT_PAD_PX.sm}px` }, pt: 1 }}>
                                <VocabDisplayCard {...keycap.cardProps} />
                            </Box>
                        </Collapse>

                        {/* THE TOOLBAR (§ 3.1): the Reader's display strip, in the space the
                        rdb's pull-down tab used to take — Read aloud and the rdb's fold key at
                        the left (where the Reader has Read and Search), the Phrase and Pinyin
                        pills at the right. Same components on the same per-device settings, so
                        a change here is a change in the Reader too. A press on the bar itself
                        keeps focus on the reading box (the Reader strip's rule). */}
                        <Box
                            className="story-play-toolbar"
                            onMouseDown={(event) => event.preventDefault()}
                            sx={{
                                flexShrink: 0,
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                px: { xs: `${CONTENT_PAD_PX.xs}px`, sm: `${CONTENT_PAD_PX.sm}px` },
                                // Folded, the keycap is gone: keep the bar clear of the header.
                                pt: rdbOpen ? 0 : 1,
                            }}
                        >
                            <Box className="story-play-toolbar__left" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                <ReaderReadAloudButton
                                    look={look}
                                    playing={readAloud.playing}
                                    onStart={readAloud.start}
                                    onStop={readAloud.stop}
                                    // Reads the passage; while a label is inspected the
                                    // keycap follows the label, so there is nothing to read.
                                    disabled={passageText.spans.length === 0 || inspecting}
                                />
                                {/* The rdb's show/hide (§ 3.4) — the chevron points where the
                                card goes next: ▴ folds it up, ▾ drops it back down. */}
                                <ReaderIconKey
                                    look={look}
                                    className="story-play-toolbar__rdb-fold-key"
                                    icon={rdbOpen ? "expand_less" : "expand_more"}
                                    label={rdbOpen ? "Hide dictionary card" : "Show dictionary card"}
                                    ariaExpanded={rdbOpen}
                                    onClick={() => setRdbOpen((open) => !open)}
                                />
                            </Box>
                            <Box className="story-play-toolbar__modes" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                {phraseStepping && (
                                    <ReaderPhraseToggle
                                        look={look}
                                        className="story-play-toolbar__phrase-toggle"
                                        value={stepMode}
                                        onChange={setStepMode}
                                    />
                                )}
                                <ReaderDisplayToggle
                                    look={look}
                                    className="story-play-toolbar__display-mode-toggle"
                                    value={displayMode}
                                    onChange={setDisplayMode}
                                />
                            </Box>
                        </Box>

                        {/* The passage — the Reader's reading box, full-bleed so its scrollbar
                        sits on the screen's edge. Its tap region spans it (the Reader's TAP
                        REGION), down to the foot. */}
                        <Box
                            className="story-passage"
                            sx={{
                                flex: 1,
                                minHeight: 0,
                                display: "flex",
                                flexDirection: "column",
                                position: "relative",
                                // No side margin: full-bleed so the scrollbar sits on the
                                // screen's edge; the reading box folds the page padding into
                                // its own (readerStyles → READER_TEXT_PADDING_SX).
                                pt: 1,
                                // While a choice is inspected the keycap follows its label, so
                                // the passage takes no clicks either (desktop has no overlay).
                                pointerEvents: inspecting ? "none" : undefined,
                            }}
                        >
                            <TextArea
                                key={passageId ?? "none"}
                                look={look}
                                selectedText={passageTextValue}
                                autoSelectEnabled
                                // Arrow keys walk the step units (phrases with the Phrase pill on).
                                segmentSpans={passageText.stepSpans}
                                selectionColors={selectionColors}
                                onTextChange={passageSelection.handleTextChange}
                                onAutoWordSelect={passageSelection.handleAutoWordSelect}
                                onTextSelectionChange={passageSelection.handleTextSelectionChange}
                                inputRef={passageSelection.inputRef}
                                onBlur={handlePassageBlur}
                                onUserInteraction={passageSelection.noteUserInteraction}
                                onSelectSentenceAtOffset={passageSelection.selectSentenceAtOffset}
                                searchColors={searchColors}
                                cpcdView={showCpcd ? (
                                    <ReaderCpcdView
                                        content={passageContent}
                                        language={language}
                                        segmentSpans={passageText.spans}
                                        pronunciations={pronunciations}
                                        selectionRange={passageSelection.selectionRange}
                                        highlightColor={selectionColors.backgroundColor}
                                        showPinyinColor={showPinyinColor}
                                        onSelectRange={passageSelection.selectRange}
                                        onSwitchToAlternative={switchToAlternative}
                                        scrollRef={cpcdScrollRef}
                                        isAutoScrollPaused={readAloud.isFollowPaused}
                                        inkColor={look.ink}
                                        searchColors={searchColors}
                                        selectedSentence={passageSelection.selectedSentence}
                                        onSelectSentenceAtOffset={passageSelection.selectSentenceAtOffset}
                                        stepSpans={passageText.stepSpans}
                                        onTapInsideSelection={passageText.drillAtOffset}
                                    />
                                ) : undefined}
                            />
                            {/* Off while a choice is inspected: taps on the passage must not
                            move a word the keycap is not showing. */}
                            {!inspecting && (
                                <ReadingTapRegion
                                    className="story-passage__tap-region"
                                    inputRef={passageSelection.inputRef}
                                    scrollRef={showCpcd ? cpcdScrollRef : undefined}
                                    wordSource={showCpcd ? "pinyin" : "text"}
                                    onSelectSpanAtOffset={passageSelection.selectSpanAtOffset}
                                    onClearSelection={passageSelection.clearSelection}
                                    onSelectSentence={passageSelection.selectSentenceAtSelection}
                                    onTapInsideSelection={passageText.drillAtOffset}
                                    flash={tapZoneFlash}
                                    onFlashEnd={clearTapZoneFlash}
                                    night={look.dark}
                                />
                            )}
                        </Box>

                        <Box className="story-play-foot" sx={{ flexShrink: 0, display: "flex", flexDirection: "column", px: { xs: 2, sm: 3 } }}>
                            {notice && (
                                <Typography className="story-play-notice" sx={{ ...cyoaMessageSx(look), textAlign: "center", pb: 1 }}>
                                    {notice}
                                </Typography>
                            )}

                            {/* The choices' tab stands on the stack's upper edge and rises and
                            falls with it (§ 3.4). */}
                            {hasFoldablePanel && (
                                <StoryEdgeTab
                                    look={look}
                                    open={choicesOpen}
                                    onToggle={() => {
                                        // Folding mid-inspection would hide the ✕; leave inspect mode too.
                                        setInspectingId(null);
                                        setChoicesOpen((open) => !open);
                                    }}
                                    panelName="choices"
                                    className="story-play-choices-tab"
                                />
                            )}

                            {isEnding && play.ending ? (
                                <Box className="story-play-ending" sx={{ pb: 3 }}>
                                    <StoryEndPanel
                                        kind="ending"
                                        look={look}
                                        ending={play.ending}
                                        endingsFound={play.endingsFound}
                                        endingsTotal={play.endingsTotal}
                                        endingsFoundBefore={endingsFoundBefore}
                                        passagesSeen={play.passagesSeen}
                                        passagesTotal={play.passagesTotal}
                                        onBackToList={handleBackToList}
                                    />
                                </Box>
                            ) : (
                                <Collapse
                                    className="story-play-choices-fold"
                                    in={choicesOpen}
                                    timeout={reducedMotion ? 0 : FOLD_TIMEOUT}
                                    easing={FOLD_EASING}
                                >
                                    <Box className="story-play-choices" sx={{ pt: 1, pb: 1.5 }}>
                                        <StoryChoiceStack
                                            look={look}
                                            choices={choices}
                                            inspectingId={inspectingId}
                                            inspectedLabel={inspectedLabel}
                                            locked={choosing}
                                            onPick={choose}
                                            onInspect={setInspectingId}
                                        />
                                        {play.toBeContinued && (
                                            <Box className="story-play-to-be-continued" sx={{ pt: 1.5 }}>
                                                <StoryEndPanel kind="toBeContinued" look={look} onBackToList={handleBackToList} />
                                            </Box>
                                        )}
                                    </Box>
                                </Collapse>
                            )}

                        </Box>
                    </>
                )}
            </Box>

            {/* The keycap's More Info → the word's eip. */}
            <ReadingEipHost wordActions={wordActions} />
        </Box>
    );
}

export default StoryPlayPage;
