import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
    defaultLayoutForEntry,
    maxZ,
    isAdvancedLayout,
    isPlainDefaultLayout,
    DEFAULT_ICON_X,
    DEFAULT_ICON_Y,
    DEFAULT_ICON_SCALE,
    ALIGN_ROTATION,
    snapCenterToGrid,
    snapScaleToStep,
    snapRotation,
    nudgeCenter,
    nudgeRotationStep,
    nudgeScaleStep,
} from "../../../cardIcons/cardIconLayout";
import {
    resolveTextLayout,
    hasCustomTextLayout,
    isDefaultTextItem,
    textLayoutForSave,
    snapTextScale,
    nudgeTextScale,
    TEXT_BLOCKS,
} from "../../../cardIcons/cardTextLayout";
import { saveIconLayout, fetchDefaultIconResults, type IconSearchItem } from "../../../cardIcons/cardIconApi";
import { iconSearchTerm } from "../../../utils/definitionUtils";
import {
    ICON_LAYOUT_MAX_ITEMS,
    type IconLayoutItem,
    type SnapConfig,
    type TextBlock,
    type TextColorMode,
    type TextColors,
    type TextLayout,
    type TextLayoutItem,
    type VocabEntry,
} from "../../../types";
import type { CanvasTarget } from "./CardIconCanvas";
import { setMinutePointsPaused } from "../../../minutePoints/minutePointsPause";
import { setEditBreadcrumb, clearEditBreadcrumb } from "../../../utils/errorReporting";
import type { AlignDirection } from "./CardEditToolbar";

export interface UseCardIconEditorParams {
    /** The card currently shown (its back face is what the editor decorates). */
    currentEntry: VocabEntry | null;
    /** The pre-rendered next card (so saved-this-session overrides apply to it too). */
    nextEntry: VocabEntry | null;
    /** Auth token for the icon-layout save / prefetch calls. */
    token: string | null;
}

/**
 * useCardIconEditor — owns the entire flashcard icon-editor (fie) subsystem:
 * the basic/advanced drafts, selection, snap toggles, Contrast text colors, the
 * capped undo/redo stacks (with their synchronous refs), the per-card
 * session-override maps, and every editor action (enter/exit/save/reset, pick,
 * delete, duplicate, align, mirror, lock, reorder, snap toggles, step-nudges).
 *
 * Extracted verbatim from FlashcardsLearnPage so that page is now orchestration
 * + layout; all the stateful editor logic (and its documented stale-closure /
 * ref-sync invariants) lives here. See docs/CARD_ICON_LAYOUT.md.
 */
export function useCardIconEditor({ currentEntry, nextEntry, token }: UseCardIconEditorParams) {
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
    // ── Movable text (migration 91) ───────────────────────────────────────────
    // The two back-face text blocks (the foreign word + the English definition) are
    // independently movable/resizable/rotatable in ADVANCED mode, just like icons. The
    // draft always carries BOTH blocks (absent saved blocks seeded to their default spot)
    // so the canvas can position them; Save normalizes default blocks back out. See
    // docs/CARD_ICON_LAYOUT.md "Movable text".
    type TextDraft = { foreign: TextLayoutItem; english: TextLayoutItem };
    const [textDraft, setTextDraft] = useState<TextDraft>(() => resolveTextLayout(null));
    const textDraftRef = useRef(textDraft);
    textDraftRef.current = textDraft;
    const setTextDraftBoth = useCallback((next: TextDraft) => {
        textDraftRef.current = next;
        setTextDraft(next);
    }, []);
    // Which advanced-canvas icon is selected (index into advDraft), driving the per-icon
    // toolbar controls (delete / align / mirror). Null = nothing selected. Selection is a
    // single logical thing across icons AND text: `selectedIcon` and `selectedText` are
    // mutually exclusive (at most one is non-null), enforced by `selectTarget`.
    const [selectedIcon, setSelectedIcon] = useState<number | null>(null);
    // Which text block (if any) is selected — drives the per-block toolbar tools (move /
    // resize / rotate / align / snap / lock). Mutually exclusive with selectedIcon.
    const [selectedText, setSelectedText] = useState<TextBlock | null>(null);
    // Unified selection setter the canvas + order list call. Enforces mutual exclusion so a
    // text block and an icon are never both "selected". Null clears both.
    const selectTarget = useCallback((t: CanvasTarget | null) => {
        if (t === null) { setSelectedIcon(null); setSelectedText(null); return; }
        if (t.kind === "icon") { setSelectedText(null); setSelectedIcon(t.index); }
        else { setSelectedIcon(null); setSelectedText(t.block); }
    }, []);
    // Snap toggles: each quantizes one operation to a discrete increment — move →
    // 5%-of-width grid, rotate → 22.5° steps, resize → 5%-of-width size. Turning one ON
    // snaps every icon for that property immediately (one undo step) and keeps future
    // gestures quantized (the canvas reads these live). PERSISTED per card via
    // vet.snapConfig (migration 88): seeded from the card on enterEdit and saved with the
    // layout on Save (NULL when all off). See docs/CARD_ICON_LAYOUT.md.
    const [snapMove, setSnapMove] = useState(false);
    const [snapRotate, setSnapRotate] = useState(false);
    const [snapResize, setSnapResize] = useState(false);
    // Contrast text-color overrides (vet.textColors, migration 89): force the foreign-word
    // glyphs and/or the English definition to a fixed color. Seeded from the card on
    // enterEdit, previewed live on the card while editing, and saved with the layout (so
    // Cancel discards them). 'theme' = follow the device/app theme (default).
    const [textForeign, setTextForeign] = useState<TextColorMode>("theme");
    const [textEnglish, setTextEnglish] = useState<TextColorMode>("theme");
    // Card background fill (vet.cardColor, migration 94): tints the whole flashcard face with
    // one of six swatches. Lives in the same "card" menu as the Contrast text colors and rides
    // along on the same Save (so Cancel discards it). null = follow the theme (grey default).
    // Like the Contrast colors it is NOT part of the undo/redo history.
    const [cardColor, setCardColor] = useState<string | null>(null);
    // Undo/redo history for the advanced draft: two capped stacks of editor snapshots.
    // A snapshot captures BOTH the icon layout AND the three snap toggle states, so undo
    // restores the snap setup the same way it restores the icons — toggling a snap on/off
    // is undoable (the toggle flag is part of the snapshot, not just the geometry it
    // produced). Order changes ride along in `layout` (reorder only permutes each icon's z).
    // - advHistory (undo): each discrete action (gesture, add, delete, align, mirror,
    //   reorder, snap toggle) pushes the PRE-change snapshot via pushAdvHistory; undo pops
    //   and restores it.
    // - advFuture (redo): undo pushes the current snapshot here before restoring; redo
    //   replays it. Any NEW tracked action (pushAdvHistory) clears the redo stack — the
    //   standard editor rule that branching off an undo discards the abandoned future.
    type AdvSnapshot = {
        layout: IconLayoutItem[];
        // The two text blocks ride along in every snapshot, so moving/resizing/rotating text
        // is undoable the same way icon edits are.
        text: TextDraft;
        move: boolean;
        rotate: boolean;
        resize: boolean;
    };
    const ADV_HISTORY_MAX = 100;
    const [advHistory, setAdvHistory] = useState<AdvSnapshot[]>([]);
    const [advFuture, setAdvFuture] = useState<AdvSnapshot[]>([]);
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
    // Snap toggles are also part of every history snapshot, so they need synchronous refs
    // too (same rapid-press reasoning as advDraftRef). Refreshed on each render below and
    // written synchronously by undo/redo when a snapshot is restored. The toggle HANDLERS
    // (handleToggleSnap*) call setSnap*(next) then pushAdvHistory in the same tick — at
    // that point the ref still holds the OLD (pre-toggle) value, which is exactly the
    // pre-change state we want recorded.
    const snapMoveRef = useRef(snapMove);
    snapMoveRef.current = snapMove;
    const snapRotateRef = useRef(snapRotate);
    snapRotateRef.current = snapRotate;
    const snapResizeRef = useRef(snapResize);
    snapResizeRef.current = snapResize;
    const snapshotDraft = useCallback(
        (): AdvSnapshot => ({
            layout: advDraftRef.current.map((it) => ({ ...it })),
            text: {
                foreign: { ...textDraftRef.current.foreign },
                english: { ...textDraftRef.current.english },
            },
            move: snapMoveRef.current,
            rotate: snapRotateRef.current,
            resize: snapResizeRef.current,
        }),
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
        (stack: AdvSnapshot[]) => {
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
        (layout: IconLayoutItem[]) =>
            layout.map((it, idx) => ({ ...it, locked: advDraftRef.current[idx]?.locked })),
        [],
    );
    // Apply a restored snapshot to the live editor: the layout (carrying live lock flags
    // across — lock is not undone) AND the snap toggle states, through both refs (sync) and
    // state (re-render). Shared by undo + redo so they restore the snap setup identically.
    const applySnapshot = useCallback(
        (snap: AdvSnapshot) => {
            const restored = withLiveLocks(snap.layout);
            advDraftRef.current = restored;
            snapMoveRef.current = snap.move;
            snapRotateRef.current = snap.rotate;
            snapResizeRef.current = snap.resize;
            setAdvDraft(restored);
            setSnapMove(snap.move);
            setSnapRotate(snap.rotate);
            setSnapResize(snap.resize);
            // Restore the text blocks too (text edits live in the same history). Unlike icons,
            // text lock IS part of the snapshot (only two fixed blocks — no live-lock carry).
            const text: TextDraft = {
                foreign: { ...snap.text.foreign },
                english: { ...snap.text.english },
            };
            textDraftRef.current = text;
            setTextDraft(text);
        },
        [withLiveLocks],
    );
    const undoAdv = useCallback(() => {
        const h = advHistoryRef.current;
        if (h.length === 0) return;
        // Stash the current snapshot on the redo stack, then restore the previous one
        // (layout + snap toggles; lock flags carried live).
        const nextFuture = [...advFutureRef.current, snapshotDraft()];
        const nextHistory = h.slice(0, -1);
        advFutureRef.current = nextFuture;
        advHistoryRef.current = nextHistory;
        setAdvFuture(nextFuture);
        setAdvHistory(nextHistory);
        applySnapshot(h[h.length - 1]);
        setSelectedIcon(null);
        setSelectedText(null);
    }, [snapshotDraft, applySnapshot]);
    const redoAdv = useCallback(() => {
        const f = advFutureRef.current;
        if (f.length === 0) return;
        // Re-stash the current snapshot on the undo stack, then replay the redo snapshot
        // (layout + snap toggles; lock flags carried live).
        const nextHistory = pushCapped(advHistoryRef.current);
        const nextFuture = f.slice(0, -1);
        advHistoryRef.current = nextHistory;
        advFutureRef.current = nextFuture;
        setAdvHistory(nextHistory);
        setAdvFuture(nextFuture);
        applySnapshot(f[f.length - 1]);
        setSelectedIcon(null);
        setSelectedText(null);
    }, [pushCapped, applySnapshot]);
    // Whether "reset to default" has anything to clear (drives greying it out). A draft
    // that is just the plain default icon offers nothing to reset.
    //  - Advanced: also enabled while the action stack is non-empty (a saved design opens
    //    non-default → enabled; a default card becomes resettable once any tracked action
    //    has happened, even if it nets back to default).
    //  - Basic: enabled once the single icon differs from the default (a saved design
    //    opens changed → enabled; an untouched default stays greyed until "swap icon").
    const defaultIconId = currentEntry?.iconId ?? null;
    // Whether the text draft has any non-default block (drives reset + save-vs-null). Computed
    // off the live draft so a moved text block keeps reset enabled even on a default-icon card.
    const hasCustomTextDraft = TEXT_BLOCKS.some(
        (b) => !isDefaultTextItem(textDraft[b], b),
    );
    const canReset = advMode
        ? (!isPlainDefaultLayout(advDraft, defaultIconId) || hasCustomTextDraft || advHistory.length > 0)
        : !isPlainDefaultLayout(basicDraft, defaultIconId);
    const [savingLayout, setSavingLayout] = useState(false);
    // Surfaced as a toast when an icon-layout save/reset PATCH fails, so a failed
    // write isn't swallowed into console.error behind a dead-looking Save button.
    const [saveError, setSaveError] = useState<string | null>(null);
    const [iconSearchOpen, setIconSearchOpen] = useState(false);
    // The user's last-typed icon-search query, remembered across picker opens for the
    // whole edit session (cleared on exitEdit). null = never searched → fall back to the
    // current card's definition-derived default term. "" is a real value (user cleared
    // the box → reopen in browse-all mode), so we test against null, not falsiness.
    const [lastIconQuery, setLastIconQuery] = useState<string | null>(null);
    // Prefetched icons8 results for the current card's DEFAULT query, warmed on enter-
    // edit so the picker can render instantly on open. Tagged with the card id + term so
    // a stale prefetch (from a previously-edited card) is never shown for another card.
    const [defaultIconResults, setDefaultIconResults] =
        useState<{ entryId: number; term: string; icons: IconSearchItem[] } | null>(null);
    const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
    const [iconLayoutOverrides, setIconLayoutOverrides] = useState<Record<number, IconLayoutItem[] | null>>({});
    // Same session-override pattern for the per-card snap toggles (vet.snapConfig,
    // migration 88) — so re-opening the editor on a card just saved this session seeds
    // the toggles from the latest save rather than the stale server value.
    const [snapConfigOverrides, setSnapConfigOverrides] = useState<Record<number, SnapConfig | null>>({});
    // Same session-override pattern for the per-card Contrast text colors (vet.textColors,
    // migration 89).
    const [textColorsOverrides, setTextColorsOverrides] = useState<Record<number, TextColors | null>>({});
    // Same session-override pattern for the per-card card background fill (vet.cardColor,
    // migration 94).
    const [cardColorOverrides, setCardColorOverrides] = useState<Record<number, string | null>>({});
    // Same session-override pattern for the per-card movable-text placement (vet.textLayout,
    // migration 91).
    const [textLayoutOverrides, setTextLayoutOverrides] = useState<Record<number, TextLayout | null>>({});

    // Merge any saved-this-session icon-layout / snap-config / text-color / text-layout
    // overrides into an entry before render (and before enterEdit seeds the drafts from it).
    const applyIconOverride = useCallback(
        (e: VocabEntry | null): VocabEntry | null => {
            if (!e) return e;
            let merged = e;
            if (e.id in iconLayoutOverrides) merged = { ...merged, iconLayout: iconLayoutOverrides[e.id] };
            if (e.id in snapConfigOverrides) merged = { ...merged, snapConfig: snapConfigOverrides[e.id] };
            if (e.id in textColorsOverrides) merged = { ...merged, textColors: textColorsOverrides[e.id] };
            if (e.id in textLayoutOverrides) merged = { ...merged, textLayout: textLayoutOverrides[e.id] };
            if (e.id in cardColorOverrides) merged = { ...merged, cardColor: cardColorOverrides[e.id] };
            return merged;
        },
        [iconLayoutOverrides, snapConfigOverrides, textColorsOverrides, textLayoutOverrides, cardColorOverrides],
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
    // icon-layer path by feeding it onto the entry's iconLayout. The live Contrast text
    // colors are merged on too so the card previews them as the learner changes them.
    // The live text placement merged on too (textLayoutForSave → null when both blocks are at
    // default, so a default card renders its normal flex-column text). In ADVANCED mode the
    // back-face static text is suppressed and the canvas renders the live text instead; this
    // merge is what makes BASIC mode preview any text the learner moved in advanced. The canvas
    // text nodes are built from this entry too, so they pick up the live Contrast colors.
    const editingCurrentEntry =
        editMode && displayCurrentEntry
            ? {
                ...displayCurrentEntry,
                iconLayout: draftLayout,
                textColors: { foreign: textForeign, english: textEnglish },
                textLayout: textLayoutForSave(textDraft),
                // Live-preview the picked card fill (null = follow theme) as the learner taps swatches.
                cardColor,
            }
            : displayCurrentEntry;

    const exitEdit = useCallback(() => {
        // Clean exit — drop the reload breadcrumb so the next page load doesn't
        // misread it as an OS reload (see utils/errorReporting.ts).
        clearEditBreadcrumb();
        setEditMode(false);
        setAdvMode(false);
        setIconSearchOpen(false);
        setResetConfirmOpen(false);
        setSelectedIcon(null);
        setSelectedText(null);
        // Reset the text draft to default; re-seeded from the card's saved textLayout on the
        // next enterEdit (migration 91).
        setTextDraftBoth(resolveTextLayout(null));
        // Forget the remembered icon-search query so the next edit session re-seeds the
        // picker from the card's definition rather than a previous session's query.
        setLastIconQuery(null);
        // Clear the live toggles on exit; the next edit session re-seeds them from the
        // card's saved snapConfig in enterEdit (they persist per card, migration 88).
        setSnapMove(false);
        setSnapRotate(false);
        setSnapResize(false);
        // Clear the live Contrast colors too; re-seeded from the card's saved textColors on
        // the next enterEdit (migration 89).
        setTextForeign("theme");
        setTextEnglish("theme");
        // Clear the live card fill too; re-seeded from the card's saved cardColor on the next
        // enterEdit (migration 94).
        setCardColor(null);
        // Reset both the state AND the synchronous refs so a fresh edit session never sees
        // a stale stack from the previous one.
        advHistoryRef.current = [];
        advFutureRef.current = [];
        setAdvHistory([]);
        setAdvFuture([]);
    }, []);

    const enterEdit = useCallback((measureDefaultEnglishCenter?: () => number | null) => {
        if (!displayCurrentEntry) return;
        const existing = displayCurrentEntry.iconLayout;
        const clone = (l: IconLayoutItem[]) => l.map((it) => ({ ...it }));
        // The single default det icon at its default spot (basic-mode fallback).
        const def = defaultLayoutForEntry(displayCurrentEntry);
        // Seed the movable-text draft from the card's saved textLayout (both blocks, absent
        // ones filled with their default). A card with custom-placed text must open ADVANCED
        // (basic mode has no canvas to show/move it). migration 91.
        const customText = hasCustomTextLayout(displayCurrentEntry.textLayout);
        const seededText = resolveTextLayout(displayCurrentEntry.textLayout);
        // English specifically (independent of `customText`, which is true if EITHER block is
        // custom): with no saved/temp textLayout.english, the basic renderer just showed it
        // TOP-anchored (defaultEnglishTopAnchorTransform) at a height depending on the
        // definition's line count — not the fixed center DEFAULT_TEXT_CENTER.english. Measure
        // the actual on-screen position so opening the canvas doesn't jump the block.
        if (!displayCurrentEntry.textLayout?.english) {
            const measuredY = measureDefaultEnglishCenter?.();
            if (measuredY != null) {
                seededText.english = { ...seededText.english, y: measuredY };
            }
        }
        setTextDraftBoth(seededText);
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
        // Custom-placed text forces advanced mode even when the icon layout is basic/default,
        // so the canvas can show and edit the moved text.
        if (customText) setAdvMode(true);
        setSelectedIcon(null);
        setSelectedText(null);
        // Seed the snap toggles from this card's saved snapConfig (vet.snapConfig,
        // migration 88) so they persist per card. NULL/absent → all off. The toggles
        // only quantize FUTURE gestures here; existing placements aren't re-snapped on
        // enter (that would mutate the card before any user action). docs/CARD_ICON_LAYOUT.md.
        const snap = displayCurrentEntry.snapConfig ?? null;
        setSnapMove(snap?.move ?? false);
        setSnapRotate(snap?.rotate ?? false);
        setSnapResize(snap?.resize ?? false);
        // Seed the Contrast colors from this card's saved textColors (migration 89); NULL/
        // absent → both 'theme'. Discarded on Cancel (only Save persists them).
        const colors = displayCurrentEntry.textColors ?? null;
        setTextForeign(colors?.foreign ?? "theme");
        setTextEnglish(colors?.english ?? "theme");
        // Seed the card fill from this card's saved cardColor (migration 94); NULL/absent →
        // follow theme. Discarded on Cancel (only Save persists it).
        setCardColor(displayCurrentEntry.cardColor ?? null);
        // Reset both the state AND the synchronous refs (see exitEdit).
        advHistoryRef.current = [];
        advFutureRef.current = [];
        setAdvHistory([]);
        setAdvFuture([]);
        setEditMode(true);

        // Drop a reload-surviving breadcrumb: the fie holds many icon images + the
        // gesture canvas, which can push iOS WebKit to silently reload the tab (no JS
        // throw). If that happens before a clean exit, the next boot reports it as an
        // `unexpected-reload`. Cleared by exitEdit / unmount. See utils/errorReporting.ts.
        setEditBreadcrumb({ flow: "fie", phase: "editing", ref: displayCurrentEntry.entryKey });

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
    // mode is toggled off (the basic view has no selectable icons / text).
    useEffect(() => {
        if (!advMode) { setSelectedIcon(null); setSelectedText(null); }
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
                // New icons spawn at the SAME spot the basic-mode default icon uses
                // (DEFAULT_ICON_X/Y — centered upper-third), 25% larger (DEFAULT_ICON_SCALE),
                // on top. Matches the basic layout's default placement so a freshly added icon
                // lands where the single default icon would sit.
                setAdvDraftBoth([
                    ...prev,
                    { iconId, x: DEFAULT_ICON_X, y: DEFAULT_ICON_Y, scale: DEFAULT_ICON_SCALE, rotation: 0, z: maxZ(prev) + 1 },
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
    // the user can immediately drag it off the original. The copy is always unlocked even
    // when the source is locked, so the user can immediately drag/edit it without first
    // unlocking (a locked copy spawned on top of its locked original would be a trap).
    const handleDuplicateSelected = useCallback(() => {
        if (selectedIcon === null) return;
        const prev = advDraftRef.current;
        if (prev.length >= ICON_LAYOUT_MAX_ITEMS) return;
        const src = prev[selectedIcon];
        if (!src) return;
        pushAdvHistory();
        const copy: IconLayoutItem = { ...src, x: 0.5, y: 0.5, z: maxZ(prev) + 1, locked: false };
        setAdvDraftBoth([...prev, copy]);
        // The appended copy is the last item — select it (index = old length).
        setSelectedIcon(prev.length);
    }, [selectedIcon, pushAdvHistory, setAdvDraftBoth]);

    // ── Movable-text per-block actions (mirror the per-icon ones) ──────────────
    // Snapshot history, then patch the selected text block. Shared by align / lock / the
    // Shift-pad nudges when a TEXT block (not an icon) is selected. See docs/CARD_ICON_LAYOUT.md.
    const patchTextBlock = useCallback(
        (block: TextBlock, patch: Partial<TextLayoutItem>, snapshot = true) => {
            if (snapshot) pushAdvHistory();
            setTextDraftBoth({
                ...textDraftRef.current,
                [block]: { ...textDraftRef.current[block], ...patch },
            });
        },
        [pushAdvHistory, setTextDraftBoth],
    );

    const handleAlign = useCallback(
        (dir: AlignDirection) => {
            // Text selected → rotate the block; icon selected → rotate the icon.
            if (selectedText !== null) { patchTextBlock(selectedText, { rotation: ALIGN_ROTATION[dir] }); return; }
            if (selectedIcon === null) return;
            pushAdvHistory();
            setAdvDraftBoth(
                advDraftRef.current.map((it, idx) => (idx === selectedIcon ? { ...it, rotation: ALIGN_ROTATION[dir] } : it)),
            );
        },
        [selectedIcon, selectedText, patchTextBlock, pushAdvHistory, setAdvDraftBoth],
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
    // Toggle the lock of the icon at a specific layout index. Shared by the toolbar's
    // lock button (acts on the selection) and the order list's per-row lock symbol (acts
    // on that row's icon, regardless of selection).
    const handleToggleLockAt = useCallback(
        (idx: number) => {
            setAdvDraftBoth(
                advDraftRef.current.map((it, i) => (i === idx ? { ...it, locked: !it.locked } : it)),
            );
        },
        [setAdvDraftBoth],
    );
    const handleToggleLock = useCallback(() => {
        // Text selected → toggle that block's lock; icon selected → toggle the icon's lock.
        // (Text lock IS undoable — patchTextBlock snapshots — unlike the icon lock, which is
        // orthogonal to history. Text has only two fixed blocks, so the simpler model is fine.)
        if (selectedText !== null) { patchTextBlock(selectedText, { locked: !textDraftRef.current[selectedText].locked }); return; }
        if (selectedIcon === null) return;
        handleToggleLockAt(selectedIcon);
    }, [selectedIcon, selectedText, patchTextBlock, handleToggleLockAt]);

    // Whether the current selection (icon OR text block) is locked — drives the lock button.
    const selectedLocked =
        selectedText !== null
            ? textDraft[selectedText]?.locked === true
            : selectedIcon !== null && advDraft[selectedIcon]?.locked === true;

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
    // snaps EVERY icon for that property immediately so existing placements jump onto the
    // grid; the canvas then keeps future gestures quantized while it's on. Turning it OFF
    // just flips the flag (icons keep their snapped values).
    //
    // Either direction is a SINGLE undoable step. `toggleSnap` snapshots history FIRST
    // (capturing the pre-change toggle states + geometry), then flips the flag, then — only
    // when turning ON — maps the snap over every icon. Because the toggle states are part of
    // the snapshot, undo/redo restores the toggle itself (not just the geometry it produced)
    // and turning a snap OFF is now undoable too (it pushes history like turning it on).
    const toggleSnap = useCallback(
        (
            on: boolean,
            setFlag: (v: boolean) => void,
            patch: (it: IconLayoutItem) => Partial<IconLayoutItem>,
            // The matching snap for the two text blocks, so turning a toggle ON jumps the text
            // onto the same grid as the icons (one undo step covers both).
            textPatch: (it: TextLayoutItem) => Partial<TextLayoutItem>,
        ) => {
            pushAdvHistory();
            setFlag(on);
            if (on) {
                setAdvDraftBoth(advDraftRef.current.map((it) => ({ ...it, ...patch(it) })));
                const t = textDraftRef.current;
                setTextDraftBoth({
                    foreign: { ...t.foreign, ...textPatch(t.foreign) },
                    english: { ...t.english, ...textPatch(t.english) },
                });
            }
        },
        [pushAdvHistory, setAdvDraftBoth, setTextDraftBoth],
    );
    const handleToggleSnapMove = useCallback(
        () => toggleSnap(!snapMove, setSnapMove, (it) => snapCenterToGrid(it.x, it.y), (it) => snapCenterToGrid(it.x, it.y)),
        [snapMove, toggleSnap],
    );
    const handleToggleSnapRotate = useCallback(
        () => toggleSnap(!snapRotate, setSnapRotate, (it) => ({ rotation: snapRotation(it.rotation) }), (it) => ({ rotation: snapRotation(it.rotation) })),
        [snapRotate, toggleSnap],
    );
    const handleToggleSnapResize = useCallback(
        () => toggleSnap(!snapResize, setSnapResize, (it) => ({ scale: snapScaleToStep(it.scale) }), (it) => ({ scale: snapTextScale(it.scale) })),
        [snapResize, toggleSnap],
    );

    // ── Shift menu: fine step-nudges of the selected icon ──────────────────────
    // The Shift dropdown nudges the selected icon by one step per tap: cardinal moves,
    // CCW/CW rotation, and minus/plus size. Each step size honors the matching snap toggle
    // (one snap unit when on, a fine 1px/1° nudge when off — see cardIconLayout helpers).
    // Each is a discrete tracked action, so it snapshots undo history first (this is also
    // how undo/redo keeps working now that the toolbar's undo/redo buttons are hidden).
    const handleNudgeMove = useCallback(
        (dir: "up" | "down" | "left" | "right") => {
            // Text selected → nudge the block's center (move snap is generic on fractions, so
            // the icon helper is reused). Icon selected → nudge the icon.
            if (selectedText !== null) { patchTextBlock(selectedText, nudgeCenter(textDraftRef.current[selectedText], dir, snapMove)); return; }
            if (selectedIcon === null) return;
            pushAdvHistory();
            setAdvDraftBoth(
                advDraftRef.current.map((it, idx) =>
                    idx === selectedIcon ? { ...it, ...nudgeCenter(it, dir, snapMove) } : it,
                ),
            );
        },
        [selectedIcon, selectedText, snapMove, patchTextBlock, pushAdvHistory, setAdvDraftBoth],
    );
    const handleRotateStep = useCallback(
        (ccw: boolean) => {
            if (selectedText !== null) { patchTextBlock(selectedText, { rotation: nudgeRotationStep(textDraftRef.current[selectedText].rotation, ccw, snapRotate) }); return; }
            if (selectedIcon === null) return;
            pushAdvHistory();
            setAdvDraftBoth(
                advDraftRef.current.map((it, idx) =>
                    idx === selectedIcon ? { ...it, rotation: nudgeRotationStep(it.rotation, ccw, snapRotate) } : it,
                ),
            );
        },
        [selectedIcon, selectedText, snapRotate, patchTextBlock, pushAdvHistory, setAdvDraftBoth],
    );
    const handleResizeStep = useCallback(
        (increase: boolean) => {
            // Text resize uses the text-scale nudge (direct font multiplier, not the icon box).
            if (selectedText !== null) { patchTextBlock(selectedText, { scale: nudgeTextScale(textDraftRef.current[selectedText].scale, increase, snapResize) }); return; }
            if (selectedIcon === null) return;
            pushAdvHistory();
            setAdvDraftBoth(
                advDraftRef.current.map((it, idx) =>
                    idx === selectedIcon ? { ...it, scale: nudgeScaleStep(it.scale, increase, snapResize) } : it,
                ),
            );
        },
        [selectedIcon, selectedText, snapResize, patchTextBlock, pushAdvHistory, setAdvDraftBoth],
    );

    const handleSaveLayout = useCallback(async () => {
        if (!currentEntry) return;
        // Advance the breadcrumb to the "saving" phase: the save's state updates +
        // re-render are the suspected moment of the iOS reload, so a reload caught now
        // is reported with phase=saving (vs phase=editing). exitEdit clears it on success.
        setEditBreadcrumb({ flow: "fie", phase: "saving", ref: currentEntry.entryKey });
        setSavingLayout(true);
        try {
            // Persist the snap toggles alongside the layout (folded into one Save, so
            // Cancel discards both). NULL when all off, keeping clean rows. migration 88.
            const anySnapOn = snapMove || snapRotate || snapResize;
            const snapConfig: SnapConfig | null = anySnapOn
                ? { move: snapMove, rotate: snapRotate, resize: snapResize }
                : null;
            // Persist Contrast colors alongside the layout (folded into one Save, so Cancel
            // discards them). NULL when both sides are 'theme', keeping clean rows. migration 89.
            const textColors: TextColors | null =
                textForeign === "theme" && textEnglish === "theme"
                    ? null
                    : { foreign: textForeign, english: textEnglish };
            // Persist the movable-text placement alongside the layout (folded into one Save, so
            // Cancel discards it). NULL when both blocks are at default, keeping clean rows.
            // migration 91. Saved regardless of mode (text persists even from basic mode).
            const textLayout: TextLayout | null = textLayoutForSave(textDraft);
            // Persist the card fill alongside the layout (already null when the default swatch
            // is picked, keeping clean rows). migration 94.
            const res = await saveIconLayout(token, currentEntry.id, draftLayout, snapConfig, textColors, textLayout, cardColor);
            setIconLayoutOverrides((o) => ({ ...o, [currentEntry.id]: res.iconLayout }));
            setSnapConfigOverrides((o) => ({ ...o, [currentEntry.id]: res.snapConfig }));
            setTextColorsOverrides((o) => ({ ...o, [currentEntry.id]: res.textColors }));
            setTextLayoutOverrides((o) => ({ ...o, [currentEntry.id]: res.textLayout }));
            setCardColorOverrides((o) => ({ ...o, [currentEntry.id]: res.cardColor }));
            exitEdit();
        } catch (err) {
            console.error("Failed to save icon layout:", err);
            // Keep the editor open (the throw skipped exitEdit) and tell the user why,
            // so the draft isn't silently lost behind an unresponsive Save button.
            setSaveError("Couldn't save your icon layout. Please try again.");
        } finally {
            setSavingLayout(false);
        }
    }, [currentEntry, draftLayout, textDraft, token, exitEdit, snapMove, snapRotate, snapResize, textForeign, textEnglish, cardColor]);

    // Reset-to-default: clear the saved layout (null), restoring the default centered
    // icon, then exit edit mode. Confirmation-gated by resetConfirmOpen.
    const handleResetConfirmed = useCallback(async () => {
        if (!currentEntry) return;
        setSavingLayout(true);
        try {
            // Reset-to-default clears the layout AND the snap config + Contrast colors + text
            // placement + card fill (a default card carries no custom decoration), so the next
            // edit session on this card starts unsnapped, theme-colored, default-positioned
            // text, and the default (theme) background.
            await saveIconLayout(token, currentEntry.id, null, null, null, null, null);
            setIconLayoutOverrides((o) => ({ ...o, [currentEntry.id]: null }));
            setSnapConfigOverrides((o) => ({ ...o, [currentEntry.id]: null }));
            setTextColorsOverrides((o) => ({ ...o, [currentEntry.id]: null }));
            setTextLayoutOverrides((o) => ({ ...o, [currentEntry.id]: null }));
            setCardColorOverrides((o) => ({ ...o, [currentEntry.id]: null }));
            exitEdit();
        } catch (err) {
            console.error("Failed to reset icon layout:", err);
            setSaveError("Couldn't reset your icon layout. Please try again.");
        } finally {
            setSavingLayout(false);
        }
    }, [currentEntry, token, exitEdit]);

    // Clear the fie reload breadcrumb if the page unmounts while still in edit mode
    // (e.g. an in-app navigation away). That's a clean exit, not an OS reload, so the
    // next full page load must NOT misread a lingering crumb. See utils/errorReporting.ts.
    useEffect(() => () => clearEditBreadcrumb(), []);

    return {
        // state
        editMode,
        advMode,
        advDraft,
        selectedIcon,
        // Movable text (migration 91)
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
        // derived
        canReset,
        selectedLocked,
        displayCurrentEntry,
        displayNextEntry,
        editingCurrentEntry,
        pickerPrefetched,
        // setters
        setAdvMode,
        setSelectedIcon,
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
        // actions
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
    };
}
