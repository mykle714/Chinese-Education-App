import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Box, Slide, Tooltip, Typography, useMediaQuery, useTheme } from "@mui/material";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import { useAuth } from "../../AuthContext";
import { API_BASE_URL } from "../../constants";
import { ContentArea, MoreInfoPill } from "./styled";
import { FC_FONT } from "./constants";
import { SIZE, WEIGHT, TRACKING } from "../../theme/scale";
import { useCardDrag } from "./useCardDrag";
import { useWorkingLoop, type CardDragControls, type StudyMode } from "./useWorkingLoop";
import FlashcardsLearnHeader from "./FlashcardsLearnHeader";
import InfoCardSection from "./InfoCardSection";
import { getBreakdownItems as buildBreakdownItems } from "../../utils/breakdownUtils";
import { useEipTabs } from "./useEipTabs";
import EipTabStrip from "./EipTabStrip";
import TooManyTabsSnackbar from "./TooManyTabsSnackbar";
import FlashCardSection from "./FlashCardSection";
import CardIconCanvas from "./CardIconCanvas";
import CardEditToolbar, { type AlignDirection, CARD_EDIT_ANIM_MS, CARD_EDIT_ANIM_EASING } from "./CardEditToolbar";
import IconPickerDialog from "../../components/IconPickerDialog";
import { defaultLayoutForEntry, maxZ, isAdvancedLayout, isPlainDefaultLayout, DEFAULT_ICON_X, DEFAULT_ICON_Y, DEFAULT_ICON_SCALE, ALIGN_ROTATION, snapCenterToGrid, snapScaleToStep, snapRotation } from "./cardIconLayout";
import { saveIconLayout, fetchDefaultIconResults, type IconSearchItem } from "./cardIconApi";
import { iconSearchTerm } from "../../utils/definitionUtils";
import { ICON_LAYOUT_MAX_ITEMS, type IconLayoutItem, type VocabEntry } from "../../types";
import { setMinutePointsPaused } from "../../utils/minutePointsPause";
import SheetPanel, { type SheetPanelBodyHandle } from "./SheetPanel";
import SettingsPanelBody from "./SettingsPanelBody";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions,
    Button,
} from "@mui/material";
import { clearWritingDraft } from "../../components/handwriting/writingDraftStore";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useTTS, SLOW_SENTENCE_RATE } from "../../hooks/useTTS";
import { useFlashcardLearnSettings } from "../../hooks/useFlashcardLearnSettings";

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
    // See docs/CARD_ICON_LAYOUT.md. The editor operates on the active card's back
    // face. Saved layouts are echoed into a local override map (keyed by vet id) so
    // the card reflects the change without re-fetching the working loop.
    const [editMode, setEditMode] = useState(false);
    // Advanced mode: the full gesture canvas (drag/resize/rotate/add). Basic mode (false)
    // only swaps a single icon. See docs/CARD_ICON_LAYOUT.md.
    const [advMode, setAdvMode] = useState(false);
    // The editor keeps TWO drafts at once so toggling adv never destroys the other view:
    //  - basicDraft: the single-icon basic view (0 or 1 item).
    //  - advDraft:   the multi-icon advanced arrangement.
    // The active draft (driven by advMode) is what the card displays and what Save
    // persists ("we show/save whichever mode the user is in").
    const [basicDraft, setBasicDraft] = useState<IconLayoutItem[]>([]);
    const [advDraft, setAdvDraft] = useState<IconLayoutItem[]>([]);
    const draftLayout = advMode ? advDraft : basicDraft;
    // Which advanced-canvas icon is selected (index into advDraft), driving the per-icon
    // toolbar controls (delete / align / mirror). Null = nothing selected.
    const [selectedIcon, setSelectedIcon] = useState<number | null>(null);
    // Snap toggles (editor-only, not persisted): each quantizes one operation to a discrete
    // increment — move → 5%-of-width grid, rotate → 11.25° steps, resize → 5%-of-width size.
    // Turning one ON snaps every icon for that property immediately (one undo step) and keeps
    // future gestures quantized (the canvas reads these live). See docs/CARD_ICON_LAYOUT.md.
    const [snapMove, setSnapMove] = useState(false);
    const [snapRotate, setSnapRotate] = useState(false);
    const [snapResize, setSnapResize] = useState(false);
    // Undo/redo history for the advanced draft: two capped stacks of advDraft snapshots.
    // - advHistory (undo): each discrete action (gesture, add, delete, align, mirror,
    //   reorder) pushes the PRE-change snapshot via pushAdvHistory; undo pops and restores it.
    // - advFuture (redo): undo pushes the current draft here before restoring; redo replays
    //   it. Any NEW tracked action (pushAdvHistory) clears the redo stack — the standard
    //   editor rule that branching off an undo discards the abandoned future.
    const ADV_HISTORY_MAX = 100;
    const [advHistory, setAdvHistory] = useState<IconLayoutItem[][]>([]);
    const [advFuture, setAdvFuture] = useState<IconLayoutItem[][]>([]);
    // Refs are the SYNCHRONOUS source of truth for the draft + both history stacks. They
    // are kept current two ways: refreshed on every render (below) AND written immediately
    // by the mutators (setAdvDraftBoth / undo / redo / pushAdvHistory). The synchronous
    // write matters for RAPID presses: React only refreshes refs at render-commit time, so
    // two undo taps fired before the first re-render commits would otherwise both read the
    // SAME stale ref and collapse into a single undo. Writing the ref in-handler lets the
    // second tap chain off the first tap's result.
    const advDraftRef = useRef(advDraft);
    advDraftRef.current = advDraft;
    const advHistoryRef = useRef(advHistory);
    advHistoryRef.current = advHistory;
    const advFutureRef = useRef(advFuture);
    advFutureRef.current = advFuture;
    const snapshotDraft = useCallback(
        () => advDraftRef.current.map((it) => ({ ...it })),
        [],
    );
    // Set the draft through BOTH the ref (synchronous) and state (re-render). Use this in
    // place of a bare setAdvDraft anywhere a follow-up history op may read the draft back
    // in the same tick (undo/redo/pushAdvHistory all read advDraftRef).
    const setAdvDraftBoth = useCallback((next: IconLayoutItem[]) => {
        advDraftRef.current = next;
        setAdvDraft(next);
    }, []);
    // Cap-aware push of the current draft onto an undo-style stack.
    const pushCapped = useCallback(
        (stack: IconLayoutItem[][]) => {
            const next = [...stack, snapshotDraft()];
            return next.length > ADV_HISTORY_MAX ? next.slice(next.length - ADV_HISTORY_MAX) : next;
        },
        [snapshotDraft],
    );
    const pushAdvHistory = useCallback(() => {
        const nextHistory = pushCapped(advHistoryRef.current);
        advHistoryRef.current = nextHistory;
        advFutureRef.current = []; // A fresh tracked action invalidates the redo stack.
        setAdvHistory(nextHistory);
        setAdvFuture([]);
    }, [pushCapped]);
    // Lock is ORTHOGONAL to the undo/redo history (toggling lock is not a tracked action,
    // see handleToggleLock). When a history snapshot is restored we keep each icon's
    // geometry from the snapshot but re-apply the CURRENTLY-live lock flags (matched by
    // index against the live draft) so undo/redo never flips a lock. Icons that no longer
    // exist live (e.g. one resurrected by undoing a delete) come back unlocked.
    const withLiveLocks = useCallback(
        (snapshot: IconLayoutItem[]) =>
            snapshot.map((it, idx) => ({ ...it, locked: advDraftRef.current[idx]?.locked })),
        [],
    );
    const undoAdv = useCallback(() => {
        const h = advHistoryRef.current;
        if (h.length === 0) return;
        // Stash the current draft on the redo stack, then restore the previous snapshot
        // (carrying the live lock flags across — lock is not undone).
        const nextFuture = [...advFutureRef.current, snapshotDraft()];
        const nextHistory = h.slice(0, -1);
        const restored = withLiveLocks(h[h.length - 1]);
        advFutureRef.current = nextFuture;
        advHistoryRef.current = nextHistory;
        advDraftRef.current = restored;
        setAdvFuture(nextFuture);
        setAdvHistory(nextHistory);
        setAdvDraft(restored);
        setSelectedIcon(null);
    }, [snapshotDraft, withLiveLocks]);
    const redoAdv = useCallback(() => {
        const f = advFutureRef.current;
        if (f.length === 0) return;
        // Re-stash the current draft on the undo stack, then replay the redo snapshot
        // (carrying the live lock flags across — lock is not redone).
        const nextHistory = pushCapped(advHistoryRef.current);
        const nextFuture = f.slice(0, -1);
        const replayed = withLiveLocks(f[f.length - 1]);
        advHistoryRef.current = nextHistory;
        advFutureRef.current = nextFuture;
        advDraftRef.current = replayed;
        setAdvHistory(nextHistory);
        setAdvFuture(nextFuture);
        setAdvDraft(replayed);
        setSelectedIcon(null);
    }, [pushCapped, withLiveLocks]);
    // Whether "reset to default" has anything to clear (drives greying it out). A draft
    // that is just the plain default icon offers nothing to reset.
    //  - Advanced: also enabled while the action stack is non-empty (a saved design opens
    //    non-default → enabled; a default card becomes resettable once any tracked action
    //    has happened, even if it nets back to default).
    //  - Basic: enabled once the single icon differs from the default (a saved design
    //    opens changed → enabled; an untouched default stays greyed until "swap icon").
    const defaultIconId = currentEntry?.iconId ?? null;
    const canReset = advMode
        ? (!isPlainDefaultLayout(advDraft, defaultIconId) || advHistory.length > 0)
        : !isPlainDefaultLayout(basicDraft, defaultIconId);
    const [savingLayout, setSavingLayout] = useState(false);
    const [iconSearchOpen, setIconSearchOpen] = useState(false);
    // Prefetched icons8 results for the current card's DEFAULT query, warmed on enter-
    // edit so the picker can render instantly on open. Tagged with the card id + term so
    // a stale prefetch (from a previously-edited card) is never shown for another card.
    const [defaultIconResults, setDefaultIconResults] =
        useState<{ entryId: number; term: string; icons: IconSearchItem[] } | null>(null);
    const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
    const [iconLayoutOverrides, setIconLayoutOverrides] = useState<Record<number, IconLayoutItem[] | null>>({});

    // Merge any saved-this-session icon-layout override into an entry before render.
    const applyIconOverride = useCallback(
        (e: VocabEntry | null): VocabEntry | null => {
            if (!e) return e;
            if (e.id in iconLayoutOverrides) return { ...e, iconLayout: iconLayoutOverrides[e.id] };
            return e;
        },
        [iconLayoutOverrides],
    );
    const displayCurrentEntry = applyIconOverride(currentEntry);
    const displayNextEntry = applyIconOverride(nextEntry);

    // The picker's prefetched first page, for the CURRENT card only. Memoized so its
    // identity is stable across renders — IconPickerDialog's load effect depends on it,
    // and a fresh object literal each render would re-run that effect (it sets state in
    // the cache fast path) and loop infinitely.
    const pickerPrefetched = useMemo(
        () =>
            defaultIconResults && defaultIconResults.entryId === currentEntry?.id
                ? { term: defaultIconResults.term, icons: defaultIconResults.icons }
                : null,
        [defaultIconResults, currentEntry?.id],
    );

    // While editing, the active card reflects the live draft (WYSIWYG). In basic mode
    // there is no gesture canvas, so the draft is rendered through the normal static
    // icon-layer path by feeding it onto the entry's iconLayout.
    const editingCurrentEntry =
        editMode && displayCurrentEntry
            ? { ...displayCurrentEntry, iconLayout: draftLayout }
            : displayCurrentEntry;

    const exitEdit = useCallback(() => {
        setEditMode(false);
        setAdvMode(false);
        setIconSearchOpen(false);
        setResetConfirmOpen(false);
        setSelectedIcon(null);
        // Snap toggles are editor-only; clear them so the next edit session starts unsnapped.
        setSnapMove(false);
        setSnapRotate(false);
        setSnapResize(false);
        // Reset both the state AND the synchronous refs so a fresh edit session never sees
        // a stale stack from the previous one.
        advHistoryRef.current = [];
        advFutureRef.current = [];
        setAdvHistory([]);
        setAdvFuture([]);
    }, []);

    const enterEdit = useCallback(() => {
        if (!displayCurrentEntry) return;
        const existing = displayCurrentEntry.iconLayout;
        const clone = (l: IconLayoutItem[]) => l.map((it) => ({ ...it }));
        // The single default det icon at its default spot (basic-mode fallback).
        const def = defaultLayoutForEntry(displayCurrentEntry);
        if (existing && isAdvancedLayout(existing)) {
            // A saved ADVANCED arrangement (multiple icons, or a single icon that's been
            // moved / resized / rotated) → seed advanced from it and auto-open advanced.
            // Basic falls back to the default single icon (toggling adv off shows that,
            // while the advanced arrangement is preserved in advDraft).
            setAdvDraftBoth(clone(existing));
            setBasicDraft(def);
            setAdvMode(true);
        } else if (existing && existing.length === 1) {
            // A saved single default-placed icon → that IS the basic view; advanced
            // starts from it too (so the user can build on it without losing the icon).
            setBasicDraft(clone(existing));
            setAdvDraftBoth(clone(existing));
            setAdvMode(false);
        } else {
            // Nothing saved → default single icon in both drafts, basic mode.
            setBasicDraft(def);
            setAdvDraftBoth(def);
            setAdvMode(false);
        }
        setSelectedIcon(null);
        // Reset both the state AND the synchronous refs (see exitEdit).
        advHistoryRef.current = [];
        advFutureRef.current = [];
        setAdvHistory([]);
        setAdvFuture([]);
        setEditMode(true);

        // Warm the icon picker: fetch (and cache on the server) the default-query
        // results for this card so they're ready the instant the picker opens. Fire-and
        // -forget — on failure the picker simply does its normal live search on open.
        const term = iconSearchTerm(displayCurrentEntry.definition);
        const entryId = displayCurrentEntry.id;
        if (displayCurrentEntry.entryKey && displayCurrentEntry.language) {
            fetchDefaultIconResults(token, {
                language: displayCurrentEntry.language,
                entryKey: displayCurrentEntry.entryKey,
                pos: displayCurrentEntry.pos ?? null,
                term,
            })
                .then((icons) => setDefaultIconResults({ entryId, term, icons }))
                .catch(() => {/* picker falls back to a live search on open */});
        }
    }, [displayCurrentEntry, token, setAdvDraftBoth]);

    // Selection only makes sense inside the advanced canvas — clear it whenever advanced
    // mode is toggled off (the basic view has no selectable icons).
    useEffect(() => {
        if (!advMode) setSelectedIcon(null);
    }, [advMode]);

    // Pause minute-points accumulation while editing the icon layout (decorating a
    // card isn't study time). Always unpause on exit/unmount.
    useEffect(() => {
        setMinutePointsPaused(editMode);
        return () => setMinutePointsPaused(false);
    }, [editMode]);

    // Leaving the current card (e.g. an undo) cancels any in-progress edit.
    const editCardId = currentEntry?.id ?? null;
    useEffect(() => {
        if (editMode) exitEdit();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editCardId]);

    // The icon picker's pick handler depends on the mode: advanced mode APPENDS a new
    // icon at center; basic mode SWAPS the single icon (replaces the whole draft with
    // one default-positioned icon).
    const handlePickIcon = useCallback(
        (iconId: string) => {
            if (advMode) {
                const prev = advDraftRef.current;
                if (prev.length >= ICON_LAYOUT_MAX_ITEMS) return;
                pushAdvHistory();
                // New icons spawn at the card center, 20% larger (DEFAULT_ICON_SCALE), on top.
                setAdvDraftBoth([
                    ...prev,
                    { iconId, x: 0.5, y: 0.5, scale: DEFAULT_ICON_SCALE, rotation: 0, z: maxZ(prev) + 1 },
                ]);
            } else {
                setBasicDraft([{ iconId, x: DEFAULT_ICON_X, y: DEFAULT_ICON_Y, scale: DEFAULT_ICON_SCALE, rotation: 0, z: 0 }]);
            }
        },
        [advMode, pushAdvHistory, setAdvDraftBoth],
    );

    // ── Advanced per-icon toolbar actions ─────────────────────────────────────
    // Each snapshots history first, then mutates advDraft. They no-op when nothing is
    // selected (the toolbar already disables the buttons, but guard defensively).
    const handleDeleteSelected = useCallback(() => {
        if (selectedIcon === null) return;
        pushAdvHistory();
        setAdvDraftBoth(advDraftRef.current.filter((_, idx) => idx !== selectedIcon));
        setSelectedIcon(null);
    }, [selectedIcon, pushAdvHistory, setAdvDraftBoth]);

    // Duplicate the selected icon: clone its appearance (iconId / scale / rotation /
    // flipX) but drop the copy at the default new-icon spawn spot (card center) on top
    // of the stack, mirroring handlePickIcon's append. The new copy becomes selected so
    // the user can immediately drag it off the original.
    const handleDuplicateSelected = useCallback(() => {
        if (selectedIcon === null) return;
        const prev = advDraftRef.current;
        if (prev.length >= ICON_LAYOUT_MAX_ITEMS) return;
        const src = prev[selectedIcon];
        if (!src) return;
        pushAdvHistory();
        const copy: IconLayoutItem = { ...src, x: 0.5, y: 0.5, z: maxZ(prev) + 1 };
        setAdvDraftBoth([...prev, copy]);
        // The appended copy is the last item — select it (index = old length).
        setSelectedIcon(prev.length);
    }, [selectedIcon, pushAdvHistory, setAdvDraftBoth]);

    const handleAlign = useCallback(
        (dir: AlignDirection) => {
            if (selectedIcon === null) return;
            pushAdvHistory();
            setAdvDraftBoth(
                advDraftRef.current.map((it, idx) => (idx === selectedIcon ? { ...it, rotation: ALIGN_ROTATION[dir] } : it)),
            );
        },
        [selectedIcon, pushAdvHistory, setAdvDraftBoth],
    );

    const handleMirror = useCallback(() => {
        if (selectedIcon === null) return;
        pushAdvHistory();
        setAdvDraftBoth(
            advDraftRef.current.map((it, idx) => (idx === selectedIcon ? { ...it, flipX: !it.flipX } : it)),
        );
    }, [selectedIcon, pushAdvHistory, setAdvDraftBoth]);

    // Toggle the selected icon's lock: a locked icon stays selectable but ignores the
    // canvas translate/resize/rotate gestures (see CardIconCanvas). docs/CARD_ICON_LAYOUT.md.
    // Lock is deliberately NOT a tracked action — it pushes no undo history, and undo/redo
    // carry the live lock flags across (see withLiveLocks). So you can lock an icon and
    // still undo/redo its geometry, and undo/redo never flips the lock back on/off.
    const handleToggleLock = useCallback(() => {
        if (selectedIcon === null) return;
        setAdvDraftBoth(
            advDraftRef.current.map((it, idx) => (idx === selectedIcon ? { ...it, locked: !it.locked } : it)),
        );
    }, [selectedIcon, setAdvDraftBoth]);

    // Whether the currently selected advanced icon is locked (drives the lock button state).
    const selectedLocked =
        selectedIcon !== null && advDraft[selectedIcon]?.locked === true;

    // Reorder commits a fully rebuilt layout (z values permuted) from the order list.
    // Live reorder: the order list applies the new z-order on every placeholder move (so
    // the card previews the stack live), so this must NOT push undo history each call —
    // that happens once per drag via `onReorderStart` (= pushAdvHistory) below.
    const handleReorder = useCallback(
        (next: IconLayoutItem[]) => {
            setAdvDraftBoth(next);
        },
        [setAdvDraftBoth],
    );

    // ── Snap toggles ──────────────────────────────────────────────────────────
    // Each toggle quantizes one operation to a discrete increment. Turning a toggle ON
    // snaps EVERY icon for that property immediately (one undo step) so existing placements
    // jump onto the grid; the canvas then keeps future gestures quantized while it's on.
    // Turning it OFF only flips the flag (icons keep their snapped values). The shared
    // `applySnapAll` snapshots history once, then maps the patch over the live draft.
    const applySnapAll = useCallback(
        (patch: (it: IconLayoutItem) => Partial<IconLayoutItem>) => {
            pushAdvHistory();
            setAdvDraftBoth(advDraftRef.current.map((it) => ({ ...it, ...patch(it) })));
        },
        [pushAdvHistory, setAdvDraftBoth],
    );
    const handleToggleSnapMove = useCallback(() => {
        const next = !snapMove;
        setSnapMove(next);
        if (next) applySnapAll((it) => snapCenterToGrid(it.x, it.y));
    }, [snapMove, applySnapAll]);
    const handleToggleSnapRotate = useCallback(() => {
        const next = !snapRotate;
        setSnapRotate(next);
        if (next) applySnapAll((it) => ({ rotation: snapRotation(it.rotation) }));
    }, [snapRotate, applySnapAll]);
    const handleToggleSnapResize = useCallback(() => {
        const next = !snapResize;
        setSnapResize(next);
        if (next) applySnapAll((it) => ({ scale: snapScaleToStep(it.scale) }));
    }, [snapResize, applySnapAll]);

    const handleSaveLayout = useCallback(async () => {
        if (!currentEntry) return;
        setSavingLayout(true);
        try {
            const res = await saveIconLayout(token, currentEntry.id, draftLayout);
            setIconLayoutOverrides((o) => ({ ...o, [currentEntry.id]: res.iconLayout }));
            exitEdit();
        } catch (err) {
            console.error("Failed to save icon layout:", err);
        } finally {
            setSavingLayout(false);
        }
    }, [currentEntry, draftLayout, token, exitEdit]);

    // Reset-to-default: clear the saved layout (null), restoring the default centered
    // icon, then exit edit mode. Confirmation-gated by resetConfirmOpen.
    const handleResetConfirmed = useCallback(async () => {
        if (!currentEntry) return;
        setSavingLayout(true);
        try {
            await saveIconLayout(token, currentEntry.id, null);
            setIconLayoutOverrides((o) => ({ ...o, [currentEntry.id]: null }));
            exitEdit();
        } catch (err) {
            console.error("Failed to reset icon layout:", err);
        } finally {
            setSavingLayout(false);
        }
    }, [currentEntry, token, exitEdit]);

    // Hard-clear the preserved writing-practice draft when a card is marked (which
    // advances currentIndex) and when leaving the flp (cleanup on unmount).
    // (docs/HANDWRITING_RECOGNITION.md "Canvas / state lifecycle")
    useEffect(() => {
        clearWritingDraft();
        return () => clearWritingDraft();
    }, [currentIndex]);

    // Log enrichment data for the current card whenever it changes (covers both correct and incorrect advances)
    useEffect(() => {
        if (!currentEntry) return;
        console.log('Current card:', { id: currentEntry.id, entryKey: currentEntry.entryKey });
        console.log('Current card enrichment:', {
            definition: currentEntry.definition ?? 'none',
            pronunciation: currentEntry.pronunciation ?? 'none',
            difficulty: currentEntry.difficulty ?? 'none',
            partsOfSpeech: currentEntry.partsOfSpeech ?? 'none',
            vernacularScore: currentEntry.vernacularScore ?? 'none',
            category: currentEntry.category ?? 'none',
            breakdown: currentEntry.breakdown ?? 'none',
            longDefinition: currentEntry.longDefinition ?? 'none',
            exampleSentences: currentEntry.exampleSentences ?? 'none',
            expansion: currentEntry.expansion ?? 'none',
            expansionSegments: currentEntry.expansionSegments ?? 'none',
            expansionMetadata: currentEntry.expansionMetadata ?? 'none',
            expansionLiteralTranslation: currentEntry.expansionLiteralTranslation ?? 'none',
            relatedWords: currentEntry.relatedWords ?? 'none',
            usedIn: currentEntry.usedIn ?? 'none',
            hasAudio: currentEntry.hasAudio ?? 'none',
        });
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
                onToggleEdit={() => (editMode ? exitEdit() : enterEdit())}
                onSettingsClick={() => setSettingsOpen(true)}
            />
            <ContentArea className="mobile-demo-content">
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
                    <Box sx={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 20 }}>
                        <CardEditToolbar
                            advMode={advMode}
                            count={advDraft.length}
                            layout={advDraft}
                            hasSelection={selectedIcon !== null}
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
                            onSelectIcon={setSelectedIcon}
                            snapMove={snapMove}
                            snapRotate={snapRotate}
                            snapResize={snapResize}
                            onToggleSnapMove={handleToggleSnapMove}
                            onToggleSnapRotate={handleToggleSnapRotate}
                            onToggleSnapResize={handleToggleSnapResize}
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
                    // Gesture canvas only in advanced mode; basic mode renders the draft
                    // through the static icon layer (via editingCurrentEntry above).
                    editCanvas={editMode && advMode ? (
                        <CardIconCanvas
                            layout={advDraft}
                            onChange={setAdvDraftBoth}
                            selected={selectedIcon}
                            onSelect={setSelectedIcon}
                            onInteractionStart={pushAdvHistory}
                            snap={{ move: snapMove, rotate: snapRotate, resize: snapResize }}
                        />
                    ) : undefined}
                    editMode={editMode}
                    advMode={advMode}
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
                    const active = eip.activeTab;
                    const panelEntry = active?.entry ?? currentEntry;
                    const panelBreakdown = active?.breakdownItems ?? breakdownItems;
                    const panelSubTab = active ? active.selectedSubTab : 0;
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
                            depth={0}
                            onSpeak={tts.enabled ? tts.speak : undefined}
                            onSpeakSentence={tts.enabled ? speakSentenceAtRate : undefined}
                            speakingKey={tts.speakingKey}
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
                // Seed the search with the card's English meaning (parsed via the shared
                // iconSearchTerm: stripParentheses to match the card display, then the
                // "to " / "to be " infinitive strips) so relevant icons show immediately.
                initialTerm={iconSearchTerm(displayCurrentEntry?.definition)}
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
