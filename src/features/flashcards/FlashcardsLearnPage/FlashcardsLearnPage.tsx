import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import { Box, Slide, Tooltip, Typography, useMediaQuery, useTheme } from "@mui/material";
import DelayedCircularProgress from "../../../components/DelayedCircularProgress";
import { useAuth } from "../../../AuthContext";
import type { Language } from "../../../types";
import ProvisionalSortOffer from "../../../components/ProvisionalSortOffer";
import { ContentArea, MoreInfoPill } from "./styled";
import type { ReadyOutKind } from "./ReadyOutCardLayer";
import { afterNextPaint } from "../../../utils/afterNextPaint";
import { useEventCallback } from "../../../hooks/useEventCallback";
import WordToolsRail from "../../../components/WordToolsRail";
import { FC_FONT, TOWER_CARD_FLIP_MS } from "../constants";
import { playBreakAway, playBreakReturn, playBreakToolsReturn } from "./gameBreak/breakMotion";
import { SIZE, WEIGHT, TRACKING } from "../../../theme/scale";
import { useCardDrag } from "./useCardDrag";
import { useWorkingLoop, type CardDragControls } from "./useWorkingLoop";
import { useCardIconEditor } from "../../../cardIcons/editor/useCardIconEditor";
import { useToolbarInset } from "../../../cardIcons/editor/useToolbarInset";
import { useCardSlotPadding } from "./useCardSlotPadding";
import TowerStudyHeader from "./TowerStudyHeader";
import type { FlpTowerHost } from "./flpTowerHost";
import { towerPlateSx, TOWER_RAIL_PILL_SIZE_SX, TOWER_RAIL_SX, TOWER_STUDY_FONT } from "../../../theme/towerPlate";
import InfoCardSection from "./InfoCardSection";
import { getBreakdownItems as buildBreakdownItems } from "../../../utils/breakdownUtils";
import { useEipTabs } from "./useEipTabs";
import EipTabStrip from "./EipTabStrip";
import TooManyTabsSnackbar from "./TooManyTabsSnackbar";
import { useLearningToggle } from "../../../hooks/useLearningToggle";
import FlashCardSection, { ChineseBlock, EnglishBlock } from "./FlashCardSection";
import { useGameBreak } from "./gameBreak/useGameBreak";
import { useBreakClears } from "./gameBreak/useBreakClears";
import { useForcedBreak } from "./gameBreak/forcedBreak";
import GameBreakArea from "./gameBreak/GameBreakArea";
import GameBreakCard from "./gameBreak/GameBreakCard";
import GameBreakResultCard from "./gameBreak/GameBreakResultCard";
import { flpBreakGameFor } from "../../../games/flpBreak";
import { useWritingFlashcard } from "./useWritingFlashcard";
import HintPawn from "./hintPawn/HintPawn";
import type { GameBreakPhase } from "./gameBreak/useGameBreak";
import { pawnHintFor } from "./hintPawn/pawnHints";
import { useHintPawnEnabled } from "../../../hooks/useHintPawnSetting";
import CardIconCanvas from "../../../cardIcons/editor/CardIconCanvas";
import { measureDefaultTextCenters } from "../../../cardIcons/cardTextLayout";
import CardEditToolbar, { CARD_EDIT_ANIM_MS, CARD_EDIT_ANIM_EASING, TOOLBAR_DROPDOWN_SELECTOR } from "../../../cardIcons/editor/CardEditToolbar";
import IconPickerDialog from "../../../components/IconPickerDialog";
import { iconSearchTerm, resolveSelectedSenseIndex, resolveDisplayDefinition } from "../../../utils/definitionUtils";
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
import { useTestingFeatures } from "../../../hooks/useTestingFeatures";
import { useTTS } from "../../../hooks/useTTS";
import { useFlashcardLearnSettings } from "../../../hooks/useFlashcardLearnSettings";
import type { VocabEntry, SideOneLanguage } from "../types";

/**
 * Tower session: the content area's bare layout boxes — a tap on one is a tap off the card,
 * which is Back (`handleTowerOffCardTap`). The content area itself, FlashCardSection's card
 * slot, and the slot's padded container around the card frame.
 */
const TOWER_OFF_CARD_SELECTOR = ".mobile-demo-content, .mobile-demo-card-slot, .mobile-demo-draggable-container";
/** A press that travels further than this is a drag, not a tap. */
const TOWER_OFF_CARD_SLOP_PX = 10;
/**
 * The game-break phases in which the hint pawn is `away` — thrown off the left edge, back
 * when the cards return (docs/HINT_PAWN.md § "Game breaks"). The title phase joins them only
 * once Start is tapped (`playPending`); `skipping` uncovers the cards, so it is not here.
 */
const PAWN_AWAY_PHASES: ReadonlySet<GameBreakPhase> = new Set(["growing", "playing", "shrinking", "results", "leaving"]);

interface FlashcardsLearnPageProps {
    /**
     * The Deck Tower hosting this session: the flp runs only inside the tower, laid over
     * its scene (FlpTowerHost; docs/DECK_TOWER.md § "Studying the tower"). The standalone
     * `/flashcards/learn` route was deleted on 2026-11-04 with the old Home page, whose
     * study hand was its only launcher.
     */
    tower: FlpTowerHost;
}

const FlashcardsLearnPage: React.FC<FlashcardsLearnPageProps> = ({ tower }) => {
    // Part of the Deck Tower page, whose tab title the session leaves alone.
    // Mounted under the tower but not being studied (FlpTowerHost `parked`).
    const parked = tower.parked;
    const { token, user } = useAuth();
    // The arrival notice for lent cards. Shown once per session: it opens as soon as
    // the loop reports a lent card and stays dismissed for the rest of the session,
    // so a mid-session refill that lends another card doesn't re-interrupt the learner.
    // The out-of-ready-cards card on top of the stack (§ "Running out of ready cards"
    // below; ReadyOutCardLayer → ReadyOutKind), or null.
    const [readyOut, setReadyOut] = useState<ReadyOutKind | null>(null);
    const readyOutUp = readyOut !== null;
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down("md"));
    // The session's BAR is the tower world being studied, always in Study Mix.
    // `reading` — the READING flp (docs/READING_WRITING_CENTERS.md § Phase 4): hanzi-only
    // front, narration only after the flip, every mark a reading mark (flpFaceSteering).
    const flpWorld = tower.world;
    const readingMode = flpWorld === 'reading';
    // `writing` — the WRITING flp (docs/WRITING_PRACTICE_REWORK.md § 3): the same card,
    // with its faces drawn by useWritingFlashcard (FlashCardSection's `writingFace`), and
    // marks are per character.
    const writingMode = flpWorld === 'writing';
    // Only tone colour is read from the shared learn settings. The shared `showPinyin`
    // pref is deliberately NOT read here: flp pinyin is fixed by the bar (normal flp
    // always shows it; the reading flp hides it on the question face) — see
    // FlashCardSection's `readingMode`.
    const { settings: { showPinyinColor } } = useFlashcardLearnSettings();

    const tts = useTTS();

    // Bridge ref handed to useWorkingLoop so it can read/drive the card-drag layer
    // (flip state + drag-position reset) without a render-time dependency on
    // useCardDrag, which is initialized below. Populated with no-ops up front and
    // re-pointed at the real drag controls after useCardDrag runs (latest-ref
    // pattern — see assignment after the useCardDrag call).
    const cardDragRef = useRef<CardDragControls>({
        resetCard: () => {},
        restoreFlipped: () => {},
        resetDragPosition: () => {},
    });

    // Same latest-ref bridge for the game break's counter (docs/FLP_GAME_BREAKS.md § 1):
    // useGameBreak needs the loop useWorkingLoop returns, and useWorkingLoop reports each
    // dismiss / undo to it — so it is re-pointed after useGameBreak runs, below.
    const breakCountersRef = useRef<{ dismissed: () => void; undone: () => void }>({
        dismissed: () => {},
        undone: () => {},
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
        clearUndo,
        provisionalReviewed,
        replaceGameCleared,
        lendMode,
        enableLend,
        resetLend,
    } = useWorkingLoop({
        token,
        world: flpWorld,
        prefetch: tts.prefetch,
        cardDragRef,
        onDismissed: () => breakCountersRef.current.dismissed(),
        onUndone: (wasCorrect, lent) => {
            breakCountersRef.current.undone();
            tower.onUndone(wasCorrect, lent);
        },
        onMarked: tower.onMarked,
    });

    // A tower session tells its host whether its deal is in and holds a card: the host
    // waits on it before diving, and re-deals a parked session dealt empty. NOT the loop's
    // size: the tower's count is its own figure (docs/DECK_TOWER.md § "Running out of
    // ready cards").
    const onTowerLoopChange = tower.onLoopChange;
    const hasCard = currentEntry !== null;
    useEffect(() => {
        onTowerLoopChange({ loading, hasCard });
    }, [onTowerLoopChange, loading, hasCard]);

    // Drag/flip logic. Depends on the working loop's isAnimating + currentIndex,
    // and feeds dismisses back into it via handleCardDismiss.
    const {
        cardRef,
        dragPosition,
        isDragging,
        isFlipped,
        setIsFlipped,
        resetCard,
        restoreFlipped,
        resetDragPosition,
        showSwipeHint,
        showTapToFlipHint,
        shakeNonce,
        handlers,
    } = useCardDrag(isAnimating, handleCardDismiss, currentIndex, TOWER_CARD_FLIP_MS);

    // Keep the bridge ref pointing at the live drag controls every render.
    cardDragRef.current = { resetCard, restoreFlipped, resetDragPosition };

    // Writing flp (`?world=writing`): the same card, drawn with the writing face. The
    // card never follows a drag — a tap (or swipe attempt) on the front submits (or
    // wiggles the card while a cell is still empty), and one on its back sends it off.
    // See useWritingFlashcard and docs/WRITING_PRACTICE_REWORK.md § 3.
    const writing = useWritingFlashcard({
        enabled: writingMode,
        entry: currentEntry,
        isFlipped,
        isAnimating,
        flip: () => setIsFlipped(true),
        dismiss: (direction, attempt) => void handleCardDismiss(direction, attempt),
    });

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
    } = useCardIconEditor({ currentEntry, nextEntry });

    // ── Game breaks (docs/FLP_GAME_BREAKS.md) ────────────────────────────────
    // Every BREAK_INTERVAL cards the stack holds an empty slot instead of a card, and the
    // dismiss of the card before it raises the game area. Not while the card editor is
    // open: the editor locks the card, and a break would land on top of an unsaved draft.
    // A feature tester's pin (the tower's ForcedBreakPicker) applies to a studied session
    // only: a parked one must not plan and prefetch a break nobody is looking at.
    const testingFeatures = useTestingFeatures();
    const forcedBreakKey = useForcedBreak(flpWorld, !parked && testingFeatures);
    const gameBreak = useGameBreak({
        world: flpWorld,
        language: (user?.selectedLanguage ?? "zh") as Language,
        workingLoop,
        disabled: editMode,
        forcedKey: forcedBreakKey,
    });
    breakCountersRef.current = { dismissed: gameBreak.noteDismissed, undone: gameBreak.noteUndone };
    // Undo stays live only on the break's card itself (it cancels the break). Past that
    // the break is under way: undo would edit a card the learner can't see.
    // The break's card on top is one more card in the stack, so everything the session does
    // around a card (undo, a tap off it) carries on until Play or Skip takes it away.
    const stackIsCards = gameBreak.phase === "cards" || gameBreak.phase === "title";
    // The out-of-ready-cards card locks undo too: the loop under it is being (or has been)
    // re-dealt, and the deal clears the snapshot anyway.
    const breakLocksUndo = !stackIsCards || readyOutUp;

    // ── Running out of ready cards (docs/DECK_TOWER.md § "Running out of ready cards") ──
    // The loop deals only the learner's own OFF-COOLDOWN cards until they are spent. The
    // loop running dry during a visit (and not mid-break: a break's clears refill on their
    // own) is the moment:
    //   - lend switch OFF → turn it on and re-deal (`pending`). `enableLend` flips `loading`
    //     in the same batch, so the next render already waits on the new deal;
    //   - the re-deal lands with cards → `lend`: "You're out of ready cards", over the
    //     first lent word; swiped or tapped off, study carries on;
    //   - nothing to deal even with the switch on (a focused world never lends; or the
    //     dictionary has nothing left) → `done`: "Done for the day", which stays.
    // A visit that starts dry (a tap on the empty tower) goes straight down this path.
    // The tower is not told any of it: its count is its own and simply stands at 0.
    const loopDry = !parked && !loading && !hasCard && gameBreak.phase === "cards";
    useEffect(() => {
        if (!loopDry) return;
        if (!lendMode) {
            setReadyOut("pending");
            enableLend();
            return;
        }
        setReadyOut("done");
    }, [loopDry, lendMode, enableLend]);
    useEffect(() => {
        if (readyOut !== "pending" || loading) return;
        setReadyOut(hasCard ? "lend" : "done");
    }, [readyOut, loading, hasCard]);
    // The `lend` card has flown off: the lent word under it is the top card now.
    const onReadyOutCardGone = useCallback(() => setReadyOut(null), []);
    // The tower takes the game's cleared cards off as the game goes away.
    const breakGameUp = gameBreak.phase === "growing" || gameBreak.phase === "playing";
    const onTowerGameBreakChange = tower.onGameBreakChange;
    useEffect(() => {
        onTowerGameBreakChange(breakGameUp);
    }, [onTowerGameBreakChange, breakGameUp]);
    // A card the game cleared leaves the tower AND the working loop, so the flp does not
    // deal it again straight after the game (docs/FLP_GAME_BREAKS.md § 4a).
    const onBreakCardCleared = useBreakClears(breakGameUp, replaceGameCleared, tower.onGameCardCleared);

    // ── Leaving the session ──────────────────────────────────────────────────
    // flp accumulates lent cards for the whole session (the working loop refills as
    // the learner goes), so the offer to keep them can only be made on the way OUT.
    // The back arrow therefore raises the offer once; "Not now" completes the exit.
    // `exitOfferShown` makes it a one-shot — a learner who declined and tapped back
    // again leaves immediately rather than being asked twice.
    const [exitOfferOpen, setExitOfferOpen] = useState(false);
    const [exitOfferShown, setExitOfferShown] = useState(false);

    // The ContentArea — the anchor for the game break's tool/stack motion and the measure
    // root for the toolbar/card-slot hooks below.
    const contentAreaRef = useRef<HTMLDivElement | null>(null);

    /**
     * Perform the real exit, closing the offer first if it is up. The session never
     * leaves the page: the tower flies its camera back out (docs/DECK_TOWER.md
     * § "Studying the tower").
     */
    const onTowerExit = tower.onExit;
    const leaveSession = useCallback(() => {
        setExitOfferOpen(false);
        if (editMode) exitEdit();
        onTowerExit();
    }, [editMode, exitEdit, onTowerExit]);

    /**
     * Back arrow. In edit mode it first cancels the edit (discarding the draft,
     * unpausing minute points) — that happens inside `leaveSession`. When the session
     * borrowed cards, the sort offer intercepts the first tap instead of navigating.
     */
    const handleBack = useCallback(() => {
        // Gated on what was REVIEWED, not on what was shown: a session that never got
        // past its third card should not be stopped on the way out to be asked about
        // seven words the learner never saw.
        if (provisionalReviewed.length > 0 && !exitOfferShown) {
            setExitOfferShown(true);
            setExitOfferOpen(true);
            return;
        }
        leaveSession();
    }, [provisionalReviewed.length, exitOfferShown, leaveSession]);

    // ── A tap off the card is Back ────────────────────────────────────────────
    // Over the Deck Tower the card lies on the tower's top, with the sky all round it, so
    // tapping the sky beside it reads as "put the deck down" — the same as the back arrow
    // (docs/DECK_TOWER.md § "Studying the tower"). Only a TAP on bare space counts:
    //   - the press must start AND end on one of the content area's empty layout boxes
    //     (TOWER_OFF_CARD_SELECTOR), so the card, the word tools, More Info and any control
    //     never count — a whitelist, so a new control added later is safe by default;
    //   - it must not travel (a swipe that starts on the card and ends off it fires its
    //     click on a shared ancestor, which is one of those boxes);
    //   - the target must be a DOM descendant: React events bubble through portals, so a
    //     tap on a portaled sheet's backdrop would otherwise land here.
    // Off during an icon edit (its own off-canvas tap deselects) and once a game break has
    // left the stack; its card counts as a card, and is excluded the same way as any other.
    const towerOffCardPress = useRef<{ x: number; y: number } | null>(null);
    // The results card counts too, though undo stays locked on it: a played game can't be undone.
    const towerOffCardLive = !parked && !editMode && (stackIsCards || gameBreak.phase === "results");
    const isTowerOffCardTarget = (e: React.SyntheticEvent): boolean => {
        const el = e.target as HTMLElement;
        return e.currentTarget.contains(el) && el.matches(TOWER_OFF_CARD_SELECTOR);
    };
    const noteTowerOffCardPress = (e: React.PointerEvent) => {
        towerOffCardPress.current = towerOffCardLive && isTowerOffCardTarget(e) ? { x: e.clientX, y: e.clientY } : null;
    };
    const handleTowerOffCardTap = (e: React.MouseEvent) => {
        const press = towerOffCardPress.current;
        towerOffCardPress.current = null;
        if (!press || !towerOffCardLive || !isTowerOffCardTarget(e)) return;
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > TOWER_OFF_CARD_SLOP_PX) return;
        handleBack();
    };

    // ── Advanced-toolbar reservation ──────────────────────────────────────────
    // The three-row advanced toolbar is an absolute overlay, so it takes no flow height. These
    // refs feed useToolbarInset, which measures how far it intrudes past the card slot's top
    // padding; the slot reserves that much extra and the card re-centers in what's left. On a
    // roomy viewport the intrusion is 0 and nothing moves. (`contentAreaRef` is declared
    // above, with the Back exit.)
    const toolbarRef = useRef<HTMLDivElement | null>(null);

    // ── Card-slot padding ─────────────────────────────────────────────────────
    // Measured, not fixed: the slot's BOTTOM pad has to reserve the band the More Info pill
    // occupies, otherwise a height-bound card (any viewport short enough that the card fills
    // the slot's height before its width) runs its bottom edge into the pill. The TOP pad is
    // the elastic one — it shrinks on a short slot so the reservation costs the whitespace
    // above the card rather than the card itself. See cardSlotPadding in styled.ts.
    const cardSlotRef = useRef<HTMLDivElement | null>(null);
    const moreInfoPillRef = useRef<HTMLDivElement | null>(null);
    const cardSlotPad = useCardSlotPadding(cardSlotRef, contentAreaRef, moreInfoPillRef);

    // The card frame goes to the tower (its camera aims at it) AND to the hint pawn, which
    // clips its bubble to the space below it (docs/HINT_PAWN.md).
    const cardFrameElRef = useRef<HTMLDivElement | null>(null);
    const towerCardFrameRef = tower.cardFrameRef;
    const setCardFrame = useCallback(
        (el: HTMLDivElement | null) => {
            cardFrameElRef.current = el;
            towerCardFrameRef(el);
        },
        [towerCardFrameRef]
    );

    const toolbarInset = useToolbarInset(editMode && advMode, cardSlotRef, toolbarRef, cardSlotPad.top);

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

    // TTS narration: auto-play the Chinese word only while the CHINESE face is the
    // one on screen. The card has exactly two faces and the flip is one-way, so the
    // showing face's language is Side 1's when unflipped and its opposite once
    // flipped: a zh-first card narrates on Side 1 only, an en-first card on Side 2
    // only. Either way, exactly one play per card, and never over an English face.
    //
    // `isFlipped` is scoped to the card it was made on (useCardDrag), so this never
    // sees the outgoing card's flip on a freshly dismissed-to card. The cleanup
    // still calls tts.cancel(); CloudTTSProvider's cancel() bumps its generation so
    // an in-flight fetch is dropped before it reaches audio — which is what stops a
    // zh-first card's narration when the user flips to its English face mid-utterance.
    const shownFaceLanguage: SideOneLanguage = isFlipped
        ? (currentSideOneLanguage === 'zh' ? 'en' : 'zh')
        : currentSideOneLanguage;
    const chineseVisible = shownFaceLanguage === 'zh';
    // A reading session narrates on the REVEAL instead: its question face is hanzi-only and
    // narrating it would hand the learner the pronunciation the card is asking them to read
    // (same rule as a reading Bubble Match run), but the answer face shows the reading, so
    // the audio plays once the card is flipped. Side 1 is always zh in reading mode, so
    // `chineseVisible` would wrongly count the answer face as "English" here.
    const narrateNow = readingMode ? isFlipped : chineseVisible;
    const breakUp = gameBreak.phase !== "cards";
    // The hint pawn (docs/HINT_PAWN.md): what it would say about the front card, and the
    // per-device switch (Settings → Display → Study helper). Memoised on the entry so the
    // pawn's bubble presence only reconciles when the card changes.
    const hintPawnEnabled = useHintPawnEnabled();
    const pawnHint = useMemo(() => pawnHintFor(flpWorld, displayCurrentEntry ?? null), [flpWorld, displayCurrentEntry]);
    useEffect(() => {
        // Parked under the tower: nobody is looking at the card yet. It is narrated when the
        // visit starts (`parked` is a dep).
        // Likewise during a break: the next card waits under the break's card, unseen.
        // Not under the out-of-ready-cards card: the word there is hidden until it goes.
        if (!narrateNow || !currentEntry || parked || breakUp || readyOutUp) return;
        // autoSpeak is a no-op when autoplay is off, so the setting is enforced
        // in one place rather than re-checked at every narration site.
        tts.autoSpeak(currentEntry);
        // Cancel narration if the user advances mid-utterance.
        return () => tts.cancel();
        // CONTENT IDENTITY ONLY. `tts.autoplay` is deliberately NOT a dep: it used to
        // be, and the off → on edge then re-ran this effect and narrated the card
        // already on screen just because the learner tapped the header audio chip.
        // Changing a setting is not a request to hear a word. The reverse direction
        // (turning audio off must stop an utterance) is handled once in useTTS.
        // tts.autoSpeak/cancel are stable across renders; depending on them would
        // re-fire narration on every settings change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [narrateNow, currentEntry?.id, parked, breakUp, readyOutUp]);

    // EIC modal sheet — opened by the centered "More Info" pill button.
    const [isEicOpen, setIsEicOpen] = useState(false);

    // Entry-tab system: tapping a breakdown/used-in row inside the EIP adds a
    // tab to the panel instead of stacking another panel on top. Each tab is
    // its own looked-up dictionary entry. The trail lives as long as the CARD does —
    // closing the panel keeps it, moving to the next card clears it (see closeEip and
    // the currentIndex effect). The active tab owns its own selected sub-tab, so the
    // page no longer tracks a separate selectedTab.
    const eip = useEipTabs();

    // The eip's Add key (EipAddKey), ADD-ONLY here: it shows only on a word the server
    // said was NOT in Learning when the word loaded (lent 'provisional' cards included,
    // so Add promotes them). After a tap it stays as "Added!" (still removable) while the
    // word is showing; the next load of that word (trail A → B → A, or reopening the eip)
    // re-evaluates it and the key disappears. Fed `null` while the panel is closed or on
    // the Compare tab, which leaves the hook inert (no fetch).
    // Docs: docs/EIP_SHEET_GESTURES.md § Add key.
    const eipLearningEntry = isEicOpen && eip.activeTab?.kind === "entry" ? eip.activeTab.entry : null;
    const eipLearning = useLearningToggle(eipLearningEntry, (eipLearningEntry?.language ?? "zh") as Language);
    const eipAddKeyShown = eipLearning.inLibraryOnLoad === false;

    const openEicSheet = () => {
        if (!displayCurrentEntry) return;
        setIsEicOpen(true);
        // Seed the root tab from the OVERRIDE-MERGED entry, not the raw one: a sense
        // picked earlier this session lives in the editor's `selectedSense` override
        // until the working loop refetches, and the eip header's dd must match the card.
        eip.openForRoot(displayCurrentEntry);
    };

    // Keep an OPEN eip in step with a sense picked on the card underneath it. Entry tabs
    // hold a snapshot, so without this the panel header would keep rendering the previous
    // sense's dd after the learner switches senses on the flashcard. Keyed on the sense
    // value (not the entry object, whose identity changes every render) so this fires once
    // per actual pick. See docs/DEFINITION_CLUSTERS.md.
    useEffect(() => {
        if (!isEicOpen || !displayCurrentEntry) return;
        eip.syncEntry(displayCurrentEntry);
    }, [isEicOpen, displayCurrentEntry?.id, displayCurrentEntry?.selectedSense]); // eslint-disable-line react-hooks/exhaustive-deps

    // Closes the EIP (scrim tap or drag-dismiss). The TABS SURVIVE: the trail belongs to
    // the card, not to the panel, so reopening the sheet on the same card comes back to
    // the same drill-in chain on the same word. It is dropped when the card changes (the
    // `currentIndex` effect below), which is also when `openForRoot` would reseed it.
    const closeEip = useCallback(() => {
        setIsEicOpen(false);
    }, []);

    // ── A visit ends (parked again) ──────────────────────────────────────────
    // The working loop is KEPT for the next tap on the tower — that is the point of parking
    // (docs/DECK_TOWER.md § "Studying the tower" → "Parked sessions") — but what belongs to the visit is not:
    //   - undo: the tower's height was reconciled at the climb-out, so undoing last visit's
    //     mark would put a card back on a tower that already counted it;
    //   - the sort offer: it may be raised again on the next visit's way out;
    //   - the game-break counter: each visit counts its own BREAK_INTERVAL;
    //   - the eip sheet: the next visit opens on the card, not on last visit's panel;
    //   - the card's flip: a card flipped but not yet marked goes back to Side 1, so a
    //     visit never opens on a revealed answer. `resetCard` (useCardDrag) is the same
    //     per-card reset a new card gets; the layer is already hidden (opacity 0) once
    //     parked, so the flip back is never seen. The writing card's "flip" is its
    //     graded submit, so its attempt is wiped too (useWritingFlashcard → resetAttempt)
    //     or Side 1 would come back showing last visit's graded ink.
    // Only the false → true edge: a session that MOUNTS parked has nothing to clear.
    const wasParked = useRef(parked);
    useEffect(() => {
        if (parked && !wasParked.current) {
            resetCard();
            writing.resetAttempt();
            clearUndo();
            setExitOfferShown(false);
            setExitOfferOpen(false);
            gameBreak.reset();
            closeEip();
            // The lend switch belongs to the visit: the next one starts on the learner's
            // own ready cards again (re-dealt now, while parked, if the switch was on).
            resetLend();
            setReadyOut(null);
        }
        wasParked.current = parked;
    // `gameBreak.reset` changes with the break's phase; only the edge matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [parked]);

    // The card editor and the EIP can't coexist — entering edit mode dismisses the
    // panel (and the More Info pill is disabled while editing, see MoreInfoPill below).
    // Key off editMode ONLY (rising edge): closeEip's identity churns every render
    // (useEipTabs returns a fresh object each render), so depending on it here would
    // re-run the effect every render and loop infinitely.
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
        // Disabled while the card editor is open (the pill is also greyed out), and under
        // the out-of-ready-cards card (the word under it is hidden).
        if (editMode || readyOutUp) return;
        if (!isFlipped) {
            setShowFlipHint(true);
            return;
        }
        openEicSheet();
    };

    // ── Word tools: flip to the answer first ─────────────────────────────────
    // Every word-tools button (`Write it`, `Compare`, `Customize`) acts on the ANSWER: the
    // writing popup and Compare both show the word in full, and the fie edits the answer
    // face's design. So a press while the question face is up first flips the card, the
    // same as tapping it would — the learner sees the answer they are about to act on
    // rather than having it revealed sideways by a popup. Fired from the rail's CAPTURE
    // phase (WordToolsRail `onToolPress`), so it runs before `Write it`'s own handler,
    // which lives inside PracticeWritingButton and cannot be wrapped.
    const revealAnswer = useEventCallback(() => {
        if (!isFlipped && !isAnimating) setIsFlipped(true);
    });

    // A Customize pressed on the question face has to wait out that flip before opening the
    // fie: `enterEdit` measures the answer face's text blocks (measureDefaultTextCenters),
    // and mid-flip they are rotated edge-on, so the seed positions would come out wrong.
    // Keyed by the entry it was pressed for, so a card that changes underneath the wait
    // (an undo, a fly-out) does not get the editor.
    const pendingCustomizeRef = useRef<number | null>(null);
    // The live front card's id, read by that delayed open (its closure would be stale).
    const currentEntryIdRef = useRef<number | undefined>(undefined);
    currentEntryIdRef.current = currentEntry?.id;
    useEffect(() => () => { if (pendingCustomizeRef.current !== null) window.clearTimeout(pendingCustomizeRef.current); }, []);

    // ── Stable props for the memoised FlashCardSection ───────────────────────
    // FlashCardSection is React.memo'd so that page state the card does not read (the eip
    // opening, its tab trail, the flip hint, the pill's hint) no longer re-renders the
    // whole card stack — opening the eip used to pay for that on the same frame as its own
    // mount. The memo only holds if every prop keeps its identity between renders, so the
    // EVENT handlers are routed through useEventCallback (stable identity, always the
    // latest closure). The writing card's `renderFace` is deliberately NOT wrapped: it is
    // called during render and its output follows the writing state, so it has to change
    // identity to re-render the card (writing sessions therefore re-render the card on
    // every page render, as before). See useEventCallback's ⚠️.
    const cardHandlersFor = () => (writingMode ? writing.swipeHandlers : handlers);
    const cardTouchStart = useEventCallback((e: React.TouchEvent) => cardHandlersFor().onTouchStart(e));
    const cardTouchEnd = useEventCallback((e: React.TouchEvent) => cardHandlersFor().onTouchEnd(e));
    const cardMouseDown = useEventCallback((e: React.MouseEvent) => cardHandlersFor().onMouseDown(e));
    const cardHandlers = useMemo(
        () => ({ onTouchStart: cardTouchStart, onTouchEnd: cardTouchEnd, onMouseDown: cardMouseDown }),
        [cardTouchStart, cardTouchEnd, cardMouseDown],
    );
    const handleWritingCardClick = useEventCallback(() => writing.handleCardClick());
    // `Customize` on the word-tools rail — opens the fie on the front card. Ignored while the
    // card is flying (nothing safe to edit). See revealAnswer above for the flip-first wait.
    const handleCustomizeCard = useEventCallback(() => {
        if (isAnimating || editMode || !currentEntry) return;
        const open = () => enterEdit(() => cardRef.current ? measureDefaultTextCenters(cardRef.current) : null);
        if (isFlipped) { open(); return; }
        // revealAnswer (capture phase) has already started the flip; open once it lands.
        if (pendingCustomizeRef.current !== null) window.clearTimeout(pendingCustomizeRef.current);
        const entryId = currentEntry.id;
        pendingCustomizeRef.current = window.setTimeout(() => {
            pendingCustomizeRef.current = null;
            if (currentEntryIdRef.current === entryId) open();
        }, TOWER_CARD_FLIP_MS);
    });

    // The word-tools pills wear the tower's plate skin, sized down for it
    // (TOWER_RAIL_PILL_SIZE_SX). Memoised on the host's tones so the rail's sx is stable.
    const plateTones = tower.plateTones;
    const towerPlatePillSx = useMemo(
        () => ({ ...towerPlateSx(plateTones), ...TOWER_RAIL_PILL_SIZE_SX, fontFamily: TOWER_STUDY_FONT }),
        [plateTones],
    );

    // "Compare" on the word-tools rail above the card. The flp has a tab strip of its
    // own, so it opens Compare AS AN EIP TAB beside the word — the one surface that does
    // not use the compare SHEET (both cdps do, having no strip to put a tab in).
    // Deferred past the next paint, like More Info: opening the eip blocks a frame, and the
    // Compare plate's press (keycapPressDelegate) must paint first.
    const handleCompare = (target: VocabEntry) => {
        afterNextPaint(() => {
            openEicSheet();
            eip.openCompareTab(target);
        });
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
        eip.clear();
    // eip.clear is stable but its identity changes when tabs change; we only
    // want to react to card changes, not tab changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentIndex]);

    // The break's card reached the top of the stack: it has no word, so the word tools and
    // More Info have nothing to act on.
    const breakCardOnTop = gameBreak.phase === "title";
    useLayoutEffect(() => {
        if (breakCardOnTop && contentAreaRef.current) void playBreakAway(contentAreaRef.current);
    }, [breakCardOnTop]);

    // The break gave the flp back. After a game the next card rises in with the tools; after
    // Skip / undo the stack never left, so only the tools return. A LAYOUT effect, on the
    // commit that re-shows the stack, so the slot is already below the frame on the first
    // painted frame (gameBreak/breakMotion.ts).
    useLayoutEffect(() => {
        if (gameBreak.returnNonce === 0 || !contentAreaRef.current) return;
        const playReturn = gameBreak.returnMotion === "full" ? playBreakReturn : playBreakToolsReturn;
        void playReturn(contentAreaRef.current);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gameBreak.returnNonce]);

    // Memoized for FlashCardSection's memo: it only changes with the plan or the buttons.
    const { planned: plannedBreak, results: breakResults, playPending: breakPlayPending, play: playBreak, beginLeave: leaveBreak } = gameBreak;
    const breakCard = useMemo(
        () => (breakResults ? (
            // The plan outlives the run (it clears on leave), so the results card can turn
            // with a sideways game as its title card did (FLP_GAME_BREAKS.md § 5b).
            <GameBreakResultCard
                results={breakResults}
                sideways={plannedBreak ? flpBreakGameFor(plannedBreak.candidate.game.gameId)?.sideways === true : false}
            />
        ) : plannedBreak ? (
            <GameBreakCard
                candidate={plannedBreak.candidate}
                onSkip={leaveBreak}
                onPlay={playBreak}
                playPending={breakPlayPending}
            />
        ) : null),
        [breakResults, plannedBreak?.candidate, leaveBreak, playBreak, breakPlayPending], // eslint-disable-line react-hooks/exhaustive-deps
    );

    // Phone-frame sizing comes from MobileDemoFrame via Layout.tsx

    // The whole-page spinner is for a deal with nothing to show yet. The lend re-deal keeps
    // the page up: its card stack shows the pending out-of-ready-cards card meanwhile.
    if (loading && !readyOutUp) {
        return (
            <Box
                className="flashcards-learn__loading-wrapper"
                sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: isMobile ? "100vw" : "100%",
                    height: "100vh",
                    // Over the Deck Tower the sky shows through.
                    backgroundColor: "transparent",
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
                    // Over the Deck Tower the sky shows through.
                    backgroundColor: "transparent",
                }}
            >
                <Typography color="error">{error}</Typography>
            </Box>
        );
    }

    return (
        <>
            {/* No arrival notice for lent cards: the out-of-ready-cards card in the stack
                announces them (§ "Running out of ready cards"; it replaced the generic
                ProvisionalCardsNotice here on 2026-11-11). */}
            {/* End-of-session offer. Unlike a game, flp has no scoreboard to attach
                this to — a session ends when the learner LEAVES — so the offer gates
                the back arrow instead (see `handleBack` below), listing every lent
                card the learner actually REVIEWED across the session — the loop holds
                ~10 at a time, so the dealt set would over-ask. Not minimizable:
                the learner is on their way out, so the only two answers are "sort
                them" and "leave anyway". Renders nothing when no cards were lent. */}
            <ProvisionalSortOffer
                open={exitOfferOpen}
                words={provisionalReviewed}
                language={(user?.selectedLanguage ?? "zh") as Language}
                onDismiss={leaveSession}
                dismissLabel="Leave anyway"
                // flp's own sheets live in the 1200s at frame level; stay above them.
                zIndex={1400}
                // Sorting navigates away from an unsaved icon-layout edit, so tear the
                // editor down first exactly as leaving normally would.
                onNavigate={() => { if (editMode) exitEdit(); }}
            />
            {/* Parked: the Deck Tower's own header is up (one PageHeader at a time). Undo
                stays live on the break's title card (it cancels the break and brings the
                last card back); it is locked once the game is playing. In edit mode the back
                arrow first cancels the edit (discarding the draft, unpausing minute points). */}
            {!parked && (
                <TowerStudyHeader
                    lastMarkUndoSnapshot={breakLocksUndo ? null : lastMarkUndoSnapshot}
                    isAnimating={isAnimating}
                    isUndoing={isUndoing}
                    onBack={handleBack}
                    onUndo={handleUndoLastMark}
                    editMode={editMode}
                    // The break's area draws its own header row, flame included, from the grow
                    // on (GameBreakChrome): step aside so only one minute-points tick runs.
                    hidden={gameBreak.areaMounted}
                />
            )}
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
                    noteTowerOffCardPress(e);
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
                onClick={handleTowerOffCardTap}
            >
                {/* Floating edit toolbar — overlays the top of the content area while
                    editing so it does NOT push the card down (docs/CARD_ICON_LAYOUT.md).
                    Wrapped in <Slide> so it drops in on enter AND slides back up on exit
                    (both directions), matched to the card slot's toolbar inset + adv-rows Collapse. */}
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
                            englishLabel={currentEntry ? resolveDisplayDefinition(currentEntry) : ""}
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
                {/* WORD TOOLS — `Write it`, `Compare` and `Customize`, on the PAGE above
                    the card and outside its boundary (`.wtl.top`, artboards 19–25). Not at
                    the bottom of the screen, which belongs to the thumb: the card is swiped
                    there and the info panel is raised from there. Any of them pressed on
                    the question face flips the card first (revealAnswer).

                    Hidden while the icon editor is open — the fie toolbar overlays exactly
                    this band, and the card is locked anyway.

                    Hidden on the writing flp too: `Write it` is what the card already is,
                    `Compare` would show the characters before they are written, and the
                    writing face is not the word layout `Customize` edits. */}
                {displayCurrentEntry && !editMode && !writingMode && !readyOutUp && (
                    <WordToolsRail
                        className="mobile-demo-word-tools"
                        entry={displayCurrentEntry}
                        onCompare={handleCompare}
                        onCustomize={handleCustomizeCard}
                        onToolPress={revealAnswer}
                        sx={{
                            marginTop: "18px", paddingLeft: "18px", paddingRight: "18px",
                            // The pills are a fixed-width centred group, wider than the card (towerPlate.ts).
                            ...TOWER_RAIL_SX,
                        }}
                        // The pills are the tower's floor-plate push buttons (towerPlate.ts).
                        pillSx={towerPlatePillSx}
                    />
                )}
                {/* Flashcard fills the rest of the ContentArea. The EIC sheet overlays
                    at the bottom rather than stacking above the flashcard. */}
                <FlashCardSection
                    slotRef={cardSlotRef}
                    // The stack is the tower's top card (FlpTowerHost).
                    cardsCovered={tower.cardsCovered}
                    cardFrameRef={setCardFrame}
                    pad={cardSlotPad}
                    currentEntry={editingCurrentEntry}
                    // The break's card holds the back position: no word card sits there.
                    nextEntry={gameBreak.stackHold ? null : displayNextEntry}
                    gameBreak={gameBreak.stackHold}
                    breakCard={breakCard}
                    onBreakCardGone={gameBreak.finishLeave}
                    onBreakCardSwiped={leaveBreak}
                    activeFrontSlot={activeFrontSlot}
                    flyOut={flyOut}
                    cardRef={cardRef}
                    dragPosition={dragPosition}
                    isDragging={isDragging}
                    isFlipped={isFlipped}
                    isAnimating={isAnimating}
                    // The out-of-ready-cards card on top (`pending` draws as a blank card).
                    readyOutCard={readyOut}
                    onReadyOutCardGone={onReadyOutCardGone}
                    showPinyinColor={showPinyinColor}
                    readingMode={readingMode}
                    sideOneLanguage={currentSideOneLanguage}
                    nextSideOneLanguage={nextSideOneLanguage}
                    showSwipeHint={showSwipeHint}
                    showTapToFlipHint={showTapToFlipHint}
                    // The writing card wiggles on the writing hook's nonce (a submit tap
                    // with an empty cell) rather than the swipe tutorial's.
                    shakeNonce={writingMode ? writing.shakeNonce : shakeNonce}
                    // The writing card is never dragged; it is flipped and sent off by the
                    // writing hook (a tap on its front / its back via onCardClick, or a
                    // swipe attempt on either face via swipeHandlers — direction ignored).
                    // Dispatches to the writing hook's or the drag hook's handlers per
                    // mode (cardHandlersFor) — one stable object, for FlashCardSection's memo.
                    handlers={cardHandlers}
                    writingFace={writingMode ? writing.renderFace : undefined}
                    onCardClick={writingMode ? handleWritingCardClick : undefined}
                    onSpeak={tts.speak}
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
                            // block renders the SAME speaker button the flp back face shows
                            // (onSpeak), so the learner previews WHERE that button will sit
                            // relative to the moved text. It's inert here
                            // (the text-content wrapper is pointerEvents:none) — pure preview chrome.
                            textLayout={textDraft}
                            onTextChange={setTextDraftBoth}
                            foreignNode={editingCurrentEntry ? (
                                <ChineseBlock
                                    entry={editingCurrentEntry}
                                    // Previews the answer face, which always shows pinyin.
                                    showPinyin
                                    showPinyinColor={showPinyinColor}
                                    onSpeak={tts.speak}
                                    speakingKey={tts.speakingKey}
                                    // In-flow so the buttons are part of the block's box — the
                                    // selection outline + on-card clamp include them.
                                    inlineActions
                                    // Same sense the preview's EnglishBlock below resolves, so the
                                    // previewed pinyin matches the live card's (migration 99).
                                    selectedSenseIndex={resolveSelectedSenseIndex(editingCurrentEntry)}
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
                    // Shrink the card slot from the top by however much the advanced toolbar
                    // intrudes (0 when it clears) — see useToolbarInset.
                    toolbarInset={toolbarInset}
                />
                {writing.overlays}
                {/* THE HINT PAWN — the study helper in the bottom-left corner, which speaks
                    the front card's hint (docs/HINT_PAWN.md). Mounted in every world; it
                    arrives only once a hint is due (writing: used-in words; main and reading:
                    a wrong-streak tip), so a session with no hint-worthy card never shows it.
                    After FlashCardSection in the DOM so it paints above the card stack;
                    before the eip so the sheet still covers it. */}
                {hintPawnEnabled && (
                    <HintPawn
                        world={flpWorld}
                        // Over the break's title card the pawn stays but has nothing to say:
                        // the card its hint described is covered.
                        hint={gameBreak.phase === "title" ? null : pawnHint}
                        // Seen only once the card is: not under the tower's count card or the
                        // icon editor.
                        unseen={tower.cardsCovered || editMode}
                        // Play on the break's card (from the tap, before the prefetch settles)
                        // until the cards return: thrown off left, slides back in after. Skip
                        // on the title card never sends it away.
                        away={(gameBreak.phase === "title" && gameBreak.playPending) || PAWN_AWAY_PHASES.has(gameBreak.phase)}
                        parked={parked}
                        // Its bubble is clipped to the space below the card (over the pill).
                        contentRef={contentAreaRef}
                        cardFrameRef={cardFrameElRef}
                    />
                )}
                {/* Centered pill button — ghosted before flip, full opacity after. While
                    the icon editor is open it stays DRAWN but greyed + inert (isDisabled);
                    it stays visible below the card in advanced mode too — the slot's bottom
                    pad reserves its band, so the card never reaches it.

                    Still TAPPABLE before the flip (only `isDisabled` swallows taps), because
                    a tap in that state is how the learner gets the "flip it first" tooltip
                    below — the pill has to be able to explain itself.

                    The writing flp has it too, gated the same way: its card only flips on
                    a submit tap, so the extra info (which shows the characters) is never
                    available while the learner is still writing them. */}
                <Tooltip
                    open={showFlipHint}
                    title={writingMode ? "Submit your writing first to see extra info." : "Flip the card first to see extra info."}
                    placement="top"
                    arrow
                >
                    {/* Presses on pointerdown via the app-wide keycap delegate (tower plate
                        skin only; held at least KEYCAP_MIN_HELD_MS). When the tap opens the
                        eip, the open is deferred past the next paint (afterNextPaint) — the
                        eip's mount blocks a frame, which used to swallow the press. */}
                    <MoreInfoPill
                        ref={moreInfoPillRef}
                        className="mobile-demo-more-info-pill"
                        isFlipped={isFlipped}
                        isDisabled={editMode || breakUp || readyOutUp}
                        plate={tower.plateTones}
                        onClick={() => (isFlipped && !editMode ? afterNextPaint(handleMoreInfoClick) : handleMoreInfoClick())}
                        aria-disabled={editMode || breakUp || readyOutUp}
                        aria-label="Open extra info"
                    >
                        <Typography sx={{ fontSize: SIZE.body, color: theme.palette.flashcard.onSurface, lineHeight: 1, transform: "translateY(-1px)" }}>↑</Typography>
                        <Typography sx={{ fontSize: SIZE.caption, fontWeight: WEIGHT.semibold, color: theme.palette.flashcard.onSurface, letterSpacing: TRACKING.wide, fontFamily: TOWER_STUDY_FONT }}>More Info</Typography>
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
                    // has no entry/breakdown/sub-tab of its own, so it renders CompareWorkspace
                    // instead (InfoCardSection branches on `compareTab`).
                    const active = eip.activeTab;
                    const compareTab = active?.kind === "compare" ? active : null;
                    const panelEntry = (active?.kind === "entry" ? active.entry : null) ?? displayCurrentEntry;
                    const panelBreakdown = (active?.kind === "entry" ? active.breakdownItems : null) ?? breakdownItems;
                    const panelSubTab = active?.kind === "entry" ? active.selectedSubTab : 0;
                    // The panel's live sense pick. Seeded per entry tab from the entry's
                    // persisted `selectedSense`, so it agrees with the flashcard face on open.
                    const panelSenseIndex = active?.kind === "entry" ? active.selectedSenseIndex : 0;
                    return (
                        <InfoCardSection
                            currentEntry={panelEntry}
                            selectedTab={panelSubTab}
                            onTabChange={eip.setActiveSubTab}
                            breakdownItems={panelBreakdown}
                            showPinyinColor={showPinyinColor}
                            isFlipped={isFlipped}
                            onClose={closeEip}
                            onBreakdownItemClick={(item) => eip.openForEntryKey(item.character)}
                            onUsedInItemClick={(item) => eip.openForEntryKey(item.entryKey)}
                            onExampleSegmentClick={(segment) => eip.openForEntryKey(segment)}
                            depth={0}
                            onSpeak={tts.speak}
                            onSpeakSentence={tts.speakSentence}
                            speakingKey={tts.speakingKey}
                            // Display-only in the eip (its header underlines this sense); the
                            // pick is made on the card face and arrives via syncEntry.
                            selectedSenseIndex={panelSenseIndex}
                            compareTab={compareTab}
                            onSetCompareSlot={eip.setCompareSlot}
                            onCompareResult={eip.setCompareResult}
                            entryTabId={eip.activeTab?.id}
                            entryTabIndex={eip.activeIndex}
                            tabStrip={
                                <EipTabStrip
                                    tabs={eip.tabs}
                                    activeIndex={eip.activeIndex}
                                    onSelect={eip.popTo}
                                    showCrumbs={eip.trailShown}
                                />
                            }
                            // Escape pops the SHOWING WORD off the breadcrumb trail
                            // (back one crumb). `pop` returns true when that was the root,
                            // and returning false from here is how SheetPanel is told to
                            // play its dismiss — the panel then unmounts through `onClose`
                            // (closeEip) at the end of the animation rather than instantly.
                            onCloseX={() => {
                                // The ROOT is not popped — it returns false and lets SheetPanel
                                // play the dismiss, and the host's onClose clears the trail
                                // once the sheet is gone. Popping the root here
                                // instead would empty the panel's body for the whole 220ms
                                // slide-out, so the sheet would leave showing nothing.
                                if (eip.tabs.length <= 1) return false;
                                eip.pop();
                                return true;
                            }}
                            // A study surface: the panel covers the page header, so it
                            // carries the minute-points flame itself.
                            // Swiping right past Definitions = back one crumb (the same pop as a tap on the
                            // previous crumb, so that word reopens on its remembered sub-tab). Off at the
                            // root: nothing sits below it, so that edge keeps its rubber-band.
                            onSwipeBack={eip.activeIndex > 0 ? () => eip.popTo(eip.activeIndex - 1) : undefined}
                            showMinutePoints
                            learning={eipAddKeyShown ? eipLearning : undefined}
                        />
                    );
                })()}
                {/* THE GAME BREAK, once Play is tapped (until then it is a card in the
                    stack). It portals to the phone frame, over the flp header and the
                    footer, so its own back arrow is the way out. docs/FLP_GAME_BREAKS.md § 2. */}
                {gameBreak.areaMounted && (
                    <GameBreakArea gameBreak={gameBreak} onCardCleared={onBreakCardCleared} />
                )}
                <TooManyTabsSnackbar signal={eip.overflowSignal} />
                {/* The eip Add key's failures only — a successful add/remove is shown by the key. */}
                <Snackbar
                    className="flp-eip__learning-error-snackbar"
                    open={eipLearning.error !== null}
                    autoHideDuration={2500}
                    onClose={eipLearning.clearError}
                    anchorOrigin={{ vertical: "top", horizontal: "center" }}
                    sx={{ zIndex: 2000 }}
                >
                    <Alert severity="error" variant="filled" onClose={eipLearning.clearError}>
                        {eipLearning.error}
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
                initialTerm={lastIconQuery ?? iconSearchTerm(displayCurrentEntry ? resolveDisplayDefinition(displayCurrentEntry) : null)}
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
