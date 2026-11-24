import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import { Box, Button, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Typography, useTheme } from "@mui/material";
import { iconSearchTerm, resolveSelectedSenseIndex, senseLabelForIndex, resolveDisplayDefinition } from "../../../utils/definitionUtils";
import { useNotificationFor } from "../../../components/notifications/useNotify";
import { useAuth } from "../../../AuthContext";
import { removeFromLibrary } from "../../../utils/vocabApi";
import type { VocabEntry } from "../../../types";
import IconPickerDialog from "../../../components/IconPickerDialog";
import { useFlashcardLearnSettings } from "../../../hooks/useFlashcardLearnSettings";
import { useTTS } from "../../../hooks/useTTS";
import { CARD_SURFACE } from "../../../theme/surfaces";
import { SAFE_BOTTOM, SAFE_TOP } from "../../../theme/safeArea";
import { SIZE, TRACKING, WEIGHT } from "../../../theme/scale";
import { towerPlateSx, TOWER_RAIL_PILL_SIZE_SX, TOWER_RAIL_SX, TOWER_STUDY_FONT } from "../../../theme/towerPlate";
import { CardFaceSide, ChineseBlock, EnglishBlock } from "../../flashcards/FlashcardsLearnPage/FlashCardSection";
import { MoreInfoPill } from "../../flashcards/FlashcardsLearnPage/styled";
import { measureDefaultTextCenters } from "../../../cardIcons/cardTextLayout";
import { isAdvancedLayout } from "../../../cardIcons/cardIconLayout";
import { CARD_BASE_WIDTH, CARD_BASE_HEIGHT } from "../../flashcards/constants";
import { cardStockVars } from "../../flashcards/card/cardStock";
import { useCardIconEditor } from "../../../cardIcons/editor/useCardIconEditor";
import CardIconCanvas from "../../../cardIcons/editor/CardIconCanvas";
import CardEditPanel from "../../../cardIcons/editor/CardEditPanel";
import CardEditToolbar, { CARD_EDIT_ANIM_MS, CARD_EDIT_ANIM_EASING, TOOLBAR_DROPDOWN_SELECTOR } from "../../../cardIcons/editor/CardEditToolbar";
import { useToolbarInset } from "../../../cardIcons/editor/useToolbarInset";
import WordToolsRail from "../../../components/WordToolsRail";
import MiniVocabCard from "../../../components/MiniVocabCard";
import { MINI_CARD_DIMENSIONS } from "../../../components/miniCardFace";
import { HeaderIconButton } from "../../../components/PageHeader";
import PawnLoader from "../../../components/PawnLoader";
import { HUB_HEADER_PAD_TOP_PX, HUB_HEADER_PAD_X_PX } from "../../../components/pageHeaderSizing";
import { useCompareSheet } from "../../flashcards/compare/useCompareSheet";
import EipSheet from "../../flashcards/FlashcardsLearnPage/EipSheet";
import { useEipTabs } from "../../flashcards/FlashcardsLearnPage/useEipTabs";
import { apiGet } from "../../../api/http";
import { afterNextPaint } from "../../../utils/afterNextPaint";
import type { MasteryWorldId } from "../../../utils/masteryCompute";
import { STUDY_PLATE_TONES } from "../useTowerStudy";
import { GROUND_SHADOW_VAR_NAME, TOWER_CARD_STOCK } from "../towerCardStock";
import { CARD_VIEW_EASING, CARD_VIEW_MOTION_MS } from "./cardViewTiming";
import { shadowTone } from "../iso";
import TowerMasteryPanel from "./TowerMasteryPanel";
import type { TowerCardViewState } from "./useTowerCardView";

/**
 * TowerCardView — td's CARD VIEW: a saved card's detail, opened IN PLACE over the cards page
 * (docs/DECK_TOWER.md § "The card view"). It replaced the routed card detail page
 * (`features/flashcards/VocabCardDetailPage`, `/flashcards/card/:id`, deleted 2026-11-23),
 * and keeps everything that page did — the hero card with its sense picker and narration,
 * the icon editor (fie), Compare, the eip with its word trail, Remove from Learning — in the
 * tower's study look.
 *
 *   ┌ [←]                                     [🗑] ┐  back / remove, outlined in the sky's ink
 *   │        [ COMPARE ]   [ CUSTOMIZE ]          │  the flp session's plate rail (no Write it)
 *   │            ┌─────────────────┐              │
 *   │            │    hero card    │              │  the answer face, sized to the slot
 *   │            └─────────────────┘              │
 *   │  [Read]                        3h 12m        │  TowerMasteryPanel: track keycap, cooldown
 *   │  ██████··························            │  (top right), the bar that grows red → blue
 *   │              [ ↑ MORE INFO ]                 │  the flp's More Info plate, same spot
 *   └──────────────────────────────────────────────┘
 *
 * ── The open / close choreography: ONE motion ──
 * Everything starts in the same frame and runs on one duration and curve
 * (cardViewTiming.ts), so the open reads as a single gesture, not a fade then a zoom:
 *   - td fades its scroller and header out (DeckTowerPage → `CARD_VIEW_FADE`);
 *   - the tapped tile is hidden and a GHOST copy of it (the raised keycap mini card) zooms
 *     from the tile onto the hero's slot;
 *   - the flat HERO card zooms along the SAME path, under the ghost: it is laid out at its
 *     full size but starts transformed down onto the tile (a FLIP), so at every instant the
 *     two cards are the same size in the same place;
 *   - as they grow, the hero fades in early (`HERO_FADE`) and the ghost fades out across the
 *     middle of the motion (`GHOST_FADE`), so the keycap turns into the flat card while it is
 *     still small and moving, and the hero is opaque before the ghost thins (no see-through);
 *   - the chrome (header, rail, mastery, More Info) fades in on the same motion.
 * The close is the exact mirror (the fade windows reflected in time), with the page fading
 * back in from its first frame; `onClosed` unhides the tile in the same frame the ghost
 * unmounts. A tile that is gone (the window resized it off, the grid re-rendered it away)
 * means no ghost: the hero just fades.
 *
 * The ghost is a MiniVocabCard on the cards page's stock, not a clone of the tile's DOM, so
 * it carries the cast-shadow var the page root normally supplies (`--tower-cards-ground-shadow`).
 * The mini card (92 × 132) and the hero (295 × 426) share an aspect to within 1%, so one
 * uniform scale carries both. The hero's transform sits on the inner card, never on the
 * measured frame (`heroFrameRef`), so a close that starts mid-open still measures its slot.
 *
 * ── Not scrolling ──
 * Everything fits one screen: the card slot is the flexible row, and the hero is sized to
 * whichever of the slot's width or height binds (`HERO_WIDTH`). The footer is hidden while
 * the view is up (DeckTowerPage → useHideFooter), so the More Info plate stands exactly
 * where the flp's does.
 *
 * Layer: feature view (src/features/deckTower/cardView). Imports the flashcards feature's
 * card face, eip, Compare and the fie, as the routed page did. Mounted by DeckTowerPage.
 * Docs: docs/DECK_TOWER.md § "The card view"; docs/CARD_ICON_LAYOUT.md (fie);
 * docs/EIP_SHEET_GESTURES.md (§ mount sites); docs/WORD_COMPARE_FEATURE.md.
 */

/** The one motion (cardViewTiming.ts): the zoom, the page fade and the chrome fade. */
const MOTION_MS = CARD_VIEW_MOTION_MS;
const MOTION = `${MOTION_MS}ms ${CARD_VIEW_EASING}`;
/**
 * The cross-fade windows, as fractions of the motion (start, end), on the OPEN. The hero
 * (underneath) is opaque by the time the ghost on top has half gone, so the sky never shows
 * through the pair. The close reflects both windows in time (`mirrorWindow`).
 */
const HERO_FADE: readonly [number, number] = [0, 0.35];
const GHOST_FADE: readonly [number, number] = [0.15, 0.65];

/** An opacity transition over the window [start, end] of the motion. */
function fadeOver([start, end]: readonly [number, number]): string {
    return `opacity ${Math.round((end - start) * MOTION_MS)}ms ease ${Math.round(start * MOTION_MS)}ms`;
}
/** The same window run backwards in time — the close's half of a cross-fade. */
function mirrorWindow([start, end]: readonly [number, number]): readonly [number, number] {
    return [1 - end, 1 - start];
}

/** The hero card prints on the Deck Tower's card stock, scaled to the hero's width. */
const HERO_CARD_STOCK_VARS = cardStockVars("100cqw");
/**
 * The hero's width: the slot's width, the flp card's natural width, or whatever width the
 * slot's HEIGHT allows at the card's aspect — the smallest wins. `cq*` resolve against the
 * slot (`containerType: size`), the hero's nearest container ancestor.
 */
const HERO_WIDTH = `min(100cqw, ${CARD_BASE_WIDTH}px, calc(100cqh * ${CARD_BASE_WIDTH} / ${CARD_BASE_HEIGHT}))`;
/** The column the rail, mastery panel and hero share. The cards page grid's width (TowerCardsPage). */
const COLUMN_MAX_PX = 364;
/** The flp More Info plate's height (styled.ts MoreInfoPill at its padding and type) plus its wall, px. */
const MORE_INFO_HEIGHT_PX = 36;
/** MoreInfoPill's bottom offset above the safe area, px (styled.ts). */
const MORE_INFO_BOTTOM_PX = 24;

/**
 * `rest`: the first frame — both cards on the tile, nothing moving yet (the start of the
 * transitions). `open`: zooming out to, then standing on, the hero slot. `closing`: zooming
 * back onto the tile.
 */
type Phase = "rest" | "open" | "closing";

/** A rect in the view root's own (unscaled) coordinates. */
interface LocalRect { left: number; top: number; width: number; height: number }

/**
 * `el`'s rect relative to `root`, in `root`'s CSS pixels. Divides out any transform scale on
 * an ancestor (the desktop phone frame may be scaled), so the ghost's `left/top/scale` mean
 * the same thing as the root's own layout.
 */
function localRect(el: Element, root: HTMLElement): LocalRect {
    const r = el.getBoundingClientRect();
    const base = root.getBoundingClientRect();
    const scale = root.offsetWidth > 0 ? base.width / root.offsetWidth : 1;
    return {
        left: (r.left - base.left) / scale,
        top: (r.top - base.top) / scale,
        width: r.width / scale,
        height: r.height / scale,
    };
}

export interface TowerCardViewProps {
    view: TowerCardViewState;
    /** Ink on the sky (DeckTowerPage `skyInk`) — the header buttons and mastery heading. */
    ink: string;
    /** Night outweighs day in td's light (DeckTowerPage `cardViewNight`) — the mastery bar's outline darkens. */
    night: boolean;
    /** The sky as drawn (DeckTowerPage `pan.palette.sky`) — the ghost's cast-shadow tone. */
    sky: string;
    /** Mastery tracks offered (Know + the goals that are on). */
    tracks: readonly MasteryWorldId[];
    /** The back arrow, and the exit after Remove from Learning. */
    onRequestClose: () => void;
    /** The zoom back has landed on the tile — fade the page back in. */
    onRevealHost: () => void;
    /** The close has finished — unmount. */
    onClosed: () => void;
}

const TowerCardView: React.FC<TowerCardViewProps> = ({ view, ink, night, sky, tracks, onRequestClose, onRevealHost, onClosed }) => {
    const theme = useTheme();
    const { user } = useAuth();
    const { settings } = useFlashcardLearnSettings();
    const { showPinyinColor } = settings;
    // Pinyin always shows here regardless of the flp toggle — it is core reference info on
    // a detail view (the routed page's rule).
    const showPinyin = true;
    // Manual narration only: the speaker on the hero card and on each example sentence. A
    // detail view does not speak on arrival (the routed page's rule).
    const tts = useTTS();

    // The card: the grid's copy at once (the ghost and the hero need no wait), then the full
    // entry — the library's rows are not guaranteed to carry everything the eip reads.
    const [entry, setEntry] = useState<VocabEntry>(view.entry);
    const [fullLoaded, setFullLoaded] = useState(false);
    useEffect(() => {
        let cancelled = false;
        apiGet<VocabEntry>(`/api/vocabEntries/${view.entry.id}`)
            .then((data) => {
                if (cancelled) return;
                setEntry(data);
                setFullLoaded(true);
                // The same label as the flp's dump, so the two are greppable as one.
                console.log("Current card (raw):", data);
            })
            .catch((err) => {
                // Keep the grid's copy: the card still shows; the eip waits on the full entry.
                console.error("Error loading card:", err);
            });
        return () => { cancelled = true; };
    }, [view.entry.id]);

    // ── The choreography ─────────────────────────────────────────────────────
    const rootRef = useRef<HTMLDivElement | null>(null);
    const heroCardRef = useRef<HTMLDivElement | null>(null);
    // The hero's untransformed layout box — what the zoom measures (see the header).
    const heroFrameRef = useRef<HTMLDivElement | null>(null);
    const [phase, setPhase] = useState<Phase>("rest");
    const [origin, setOrigin] = useState<LocalRect | null>(null);
    const [target, setTarget] = useState<LocalRect | null>(null);

    // Measure the tile and the hero before the first paint, and hide the real tile so the
    // ghost is the only copy on screen. The tile is hidden by its own style rather than
    // through the grid's props: the grid's cards are memoized, and a prop change would
    // re-render the whole grid for one card.
    useLayoutEffect(() => {
        const root = rootRef.current;
        if (!root) return;
        const tile = view.tile && view.tile.isConnected ? view.tile : null;
        if (tile) {
            setOrigin(localRect(tile, root));
            tile.style.visibility = "hidden";
        }
        if (heroFrameRef.current) setTarget(localRect(heroFrameRef.current, root));
        return () => {
            if (tile) tile.style.visibility = "";
        };
    }, [view.tile]);

    // Open: one paint at `rest` (both cards drawn on the tile), then `open` starts every
    // transition in the same frame. Two frames, because the first rAF fires before the paint
    // that commits the `rest` styles.
    useEffect(() => {
        if (view.closing || phase !== "rest") return;
        let second = 0;
        const first = requestAnimationFrame(() => {
            second = requestAnimationFrame(() => setPhase("open"));
        });
        return () => {
            cancelAnimationFrame(first);
            cancelAnimationFrame(second);
        };
    }, [phase, view.closing]);

    // Close: re-measure both ends (the window may have changed since the open), start the
    // page fading back in, and run the mirrored motion; unmount when it lands.
    useEffect(() => {
        if (!view.closing) return;
        const root = rootRef.current;
        if (root && heroFrameRef.current) setTarget(localRect(heroFrameRef.current, root));
        if (root && view.tile && view.tile.isConnected) {
            // Measured while hidden: visibility does not change layout.
            setOrigin(localRect(view.tile, root));
        }
        setPhase("closing");
        onRevealHost();
        const t = window.setTimeout(onClosed, MOTION_MS);
        return () => window.clearTimeout(t);
    }, [view.closing]); // eslint-disable-line react-hooks/exhaustive-deps -- runs once, when the close starts

    const isOpen = phase === "open";
    // On the tile at rest and on the way back; on the hero slot while open.
    const atTile = !isOpen;
    // The zoom between the two rects: the ghost is laid out on the tile and grows onto the
    // slot; the hero is laid out on the slot and starts shrunk onto the tile (a FLIP). The
    // two interpolate identically (both from transform-origin 0 0), so they stay coincident.
    const zoom = useMemo(() => {
        if (!origin || !target || !target.width) return null;
        const k = target.width / (origin.width || MINI_CARD_DIMENSIONS.regular.width);
        return {
            ghostAtSlot: `translate(${target.left - origin.left}px, ${target.top - origin.top}px) scale(${k})`,
            heroAtTile: `translate(${origin.left - target.left}px, ${origin.top - target.top}px) scale(${1 / k})`,
        };
    }, [origin, target]);
    const ghostTransform = zoom && !atTile ? zoom.ghostAtSlot : "none";
    const heroTransform = zoom && atTile ? zoom.heroAtTile : "none";
    // The cross-fade: on the open, the hero fades in over HERO_FADE and the ghost out over
    // GHOST_FADE; the close mirrors both. No tile (no zoom): the hero fades over the motion.
    // At `rest` nothing transitions — the first frame is the motion's start, not a change.
    const heroFade = !zoom ? `opacity ${MOTION}` : phase === "closing" ? fadeOver(mirrorWindow(HERO_FADE)) : fadeOver(HERO_FADE);
    const ghostFade = phase === "closing" ? fadeOver(mirrorWindow(GHOST_FADE)) : fadeOver(GHOST_FADE);
    const heroTransition = phase === "rest" ? "none" : `transform ${MOTION}, ${heroFade}`;
    const ghostTransition = phase === "rest" ? "none" : `transform ${MOTION}, ${ghostFade}`;
    // Kept mounted while open (at opacity 0, on the slot) so the close can fade it back in.
    const ghostShown = zoom !== null;

    // ── The card (the routed page's body, unchanged in behaviour) ─────────────
    const [infoOpen, setInfoOpen] = useState(false);
    // The eip's word trail (docs/EIP_SHEET_GESTURES.md § mount sites): a drill-in pushes a
    // crumb in this same sheet; the trail outlives the panel, so reopening resumes it.
    const eip = useEipTabs({ language: entry.language });
    // Which definitionClusters sense the hero shows: seeded from this card's PERSISTED choice
    // (`selectedSense`, migration 99), persisted on pick. See docs/DEFINITION_CLUSTERS.md.
    const [selectedSenseIndex, setSelectedSenseIndex] = useState(() => resolveSelectedSenseIndex(view.entry));
    useEffect(() => { setSelectedSenseIndex(resolveSelectedSenseIndex(entry)); }, [entry.id, fullLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

    // Compare — never stacked over the eip (owner, 2026-11-21): an open eip closes first.
    // Deferred past the next paint like the flp's, so the plate's press paints first.
    const { openCompare, compareSheet } = useCompareSheet();
    const handleCompare = useCallback((compareEntry: VocabEntry) => {
        afterNextPaint(() => {
            setInfoOpen(false);
            openCompare(compareEntry);
        });
    }, [openCompare]);

    // The fie — the same editor the flp opens on its back face (docs/CARD_ICON_LAYOUT.md).
    // No "next card" here, so nextEntry is null.
    const {
        editMode, advMode, advDraft, selectedIcon, textDraft, selectedText,
        snapMove, snapRotate, snapResize, textForeign, textEnglish, cardColor,
        advHistory, advFuture, savingLayout, saveError, iconSearchOpen, lastIconQuery,
        resetConfirmOpen, canReset, selectedLocked, displayCurrentEntry, editingCurrentEntry,
        pickerPrefetched, setAdvMode, selectTarget, setTextDraftBoth, setIconSearchOpen,
        setLastIconQuery, setResetConfirmOpen, setSaveError, setTextForeign, setTextEnglish,
        setCardColor, setAdvDraftBoth, enterEdit, exitEdit, handlePickIcon, handleDeleteSelected,
        handleDuplicateSelected, handleAlign, handleMirror, handleToggleLock, handleToggleLockAt,
        handleReorder, handleToggleSnapMove, handleToggleSnapRotate, handleToggleSnapResize,
        handleNudgeMove, handleRotateStep, handleResizeStep, handleSaveLayout, handleResetConfirmed,
        persistSelectedSense, undoAdv, redoAdv, pushAdvHistory,
    } = useCardIconEditor({ currentEntry: entry, nextEntry: null });
    // Same id as the flp's: one editor, one message (docs/NOTIFICATIONS.md).
    useNotificationFor(saveError, () => setSaveError(null), { id: "card-icon-save-error", tone: "error" });
    const shownEntry = editingCurrentEntry ?? entry;

    const handleSelectSense = useCallback((index: number) => {
        setSelectedSenseIndex(index);
        persistSelectedSense(entry, senseLabelForIndex(entry, index));
    }, [entry, persistSelectedSense]);

    // ── Edit-toolbar reservation (the routed page's rule, docs/CARD_ICON_LAYOUT.md) ──
    // The fie toolbar lives in CardEditPanel, portaled over the header with no flow height.
    // The body (rail → mastery) is pushed down by exactly what the toolbar's PRIMARY row
    // intrudes past its top — usually 0, since the row ends inside the header band. The
    // advanced rows are NOT cleared: they are meant to land over the rail.
    const bodyRef = useRef<HTMLDivElement | null>(null);
    const toolbarRef = useRef<HTMLDivElement | null>(null);
    const toolbarInset = useToolbarInset(editMode, bodyRef, toolbarRef, 0, ".card-edit-toolbar__row");

    // Customize opens the fie on the hero (the answer face — no flip to wait for).
    const handleCustomize = useCallback(() => {
        if (editMode) return;
        enterEdit(() => (heroCardRef.current ? measureDefaultTextCenters(heroCardRef.current) : null));
    }, [editMode, enterEdit]);

    // The eip, seeded from the OVERRIDE-MERGED entry so its header's dd matches the hero.
    const openInfo = useCallback(() => {
        const root = displayCurrentEntry ?? entry;
        eip.openForRoot(root);
        setInfoOpen(true);
    }, [displayCurrentEntry, entry, eip]);

    // Keep an OPEN eip in step with a sense picked on the hero under it (trail crumbs hold a snapshot).
    useEffect(() => {
        if (!infoOpen || !displayCurrentEntry) return;
        eip.syncEntry(displayCurrentEntry);
    }, [infoOpen, displayCurrentEntry?.id, displayCurrentEntry?.selectedSense]); // eslint-disable-line react-hooks/exhaustive-deps

    // Remove from Learning: demotes the row to 'tracked' (never re-lent; history and progress survive;
    // re-adding promotes it in place), so no confirmation. Then the view closes; the cards
    // page re-reads its library on close and the card leaves the grid.
    // Docs: docs/PROVISIONAL_CARDS.md § "Removing from Learning demotes".
    const [actionLoading, setActionLoading] = useState(false);
    const handleDelete = async () => {
        try {
            setActionLoading(true);
            await removeFromLibrary(entry.entryKey, entry.language ?? user?.selectedLanguage ?? "zh");
            onRequestClose();
        } catch (err) {
            console.error("Error deleting card:", err);
            setActionLoading(false);
        }
    };

    // The rail's plates — the flp session's white plate skin, sized for the rail.
    const plateTones = STUDY_PLATE_TONES;
    const railPillSx = useMemo(
        () => ({ ...towerPlateSx(plateTones), ...TOWER_RAIL_PILL_SIZE_SX, fontFamily: TOWER_STUDY_FONT }),
        [plateTones]
    );

    // The chrome (everything but the card) fades in once the hero is up, out at the close's start.
    const chromeSx = {
        opacity: isOpen ? 1 : 0,
        transition: `opacity ${MOTION}`,
        pointerEvents: isOpen ? undefined : "none",
    } as const;
    const busy = editMode || !isOpen;

    return (
        <Box
            ref={rootRef}
            className={`tower-card-view tower-card-view--${phase}`}
            sx={{
                position: "absolute",
                inset: 0,
                zIndex: 4,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                // Nothing scrolls here, and the sky under it must not be dragged.
                touchAction: "none",
                // Taps only once open: mid-zoom the page under it is already inert (faded).
                pointerEvents: isOpen ? "auto" : "none",
            }}
            // While the fie is open in advanced mode with something selected, a tap outside the
            // canvas / toolbar (and outside a portaled toolbar dropdown) deselects.
            onPointerDown={(e) => {
                if (!(editMode && advMode) || (selectedIcon === null && selectedText === null)) return;
                const el = e.target as HTMLElement;
                if (!el.closest(".card-icon-canvas") && !el.closest(".card-edit-toolbar") && !el.closest(TOOLBAR_DROPDOWN_SELECTOR)) {
                    selectTarget(null);
                }
            }}
        >
            {/* ── Header: back (left), remove from Learning (right). Laid out as td's hub
                header (same padding + safe-area inset) so the arrow stands where the cards
                page's ↑ does. Not a PageHeader: td's own stays mounted (faded) and a page runs
                exactly one minute-points tick. ── */}
            <Box
                className="tower-card-view__header"
                sx={{
                    alignSelf: "stretch",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    minHeight: 40,
                    paddingTop: `calc(${HUB_HEADER_PAD_TOP_PX}px + ${SAFE_TOP})`,
                    paddingLeft: `${HUB_HEADER_PAD_X_PX}px`,
                    paddingRight: `${HUB_HEADER_PAD_X_PX}px`,
                    boxSizing: "content-box",
                    ...chromeSx,
                }}
            >
                <HeaderIconButton
                    className="tower-card-view__back-button"
                    icon="arrow_back"
                    label="Back to your cards"
                    variant="outlined"
                    color={ink}
                    outlineColor={ink}
                    disabled={busy}
                    onClick={onRequestClose}
                />
                {/* Remove from Learning stays a header action, never a rail plate: it is rare
                    and takes the card out of every list (not destructive — see handleDelete). */}
                <HeaderIconButton
                    className="tower-card-view__delete-button"
                    icon="delete"
                    label="Remove from Learning"
                    variant="outlined"
                    color={ink}
                    outlineColor={ink}
                    disabled={busy || actionLoading}
                    onClick={handleDelete}
                />
                {/* P5 (docs/DECK_TOWER.md § "Loading feedback"): the button only disables while the
                    removal saves; the loader speaks for a slow one. (A failure — after removeFromLibrary's
                    quiet retries — re-enables the button with no message of its own: the card
                    visibly stayed. docs/NOTIFICATIONS.md § 3a "Failures".) */}
                {actionLoading && <PawnLoader label="Removing card" />}
            </Box>

            {/* ── The fie panel — portals itself over the header (CardEditPanel), no flow height. ── */}
            <CardEditPanel open={editMode} ref={toolbarRef}>
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
            </CardEditPanel>

            {/* ── The body: everything under the header, pushed down by the fie toolbar's
                intrusion (toolbarInset) in lockstep with the toolbar's own drop. ── */}
            <Box
                ref={bodyRef}
                className="tower-card-view__body"
                sx={{
                    flex: 1,
                    minHeight: 0,
                    alignSelf: "stretch",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    paddingTop: `${toolbarInset}px`,
                    transition: `padding-top ${CARD_EDIT_ANIM_MS}ms ${CARD_EDIT_ANIM_EASING}`,
                }}
            >
            {/* ── The word tools: the flp session's two plates, Compare · Customize. No
                `Write it` (owner, 2026-11-23 — the flp dropped it 2026-11-17). Greyed while
                the fie is open, like the More Info plate. ── */}
            <Box className="tower-card-view__rail-band" sx={{ alignSelf: "stretch", ...chromeSx }}>
                <WordToolsRail
                    className="tower-card-view__word-tools"
                    entry={entry}
                    onCompare={handleCompare}
                    onCustomize={handleCustomize}
                    disabled={editMode}
                    showWriteIt={false}
                    sx={{ marginTop: "14px", paddingLeft: "18px", paddingRight: "18px", ...TOWER_RAIL_SX }}
                    pillSx={railPillSx}
                />
            </Box>

            {/* ── The card slot: the flexible row; the hero fits whichever of its sides binds. ── */}
            <Box
                className="tower-card-view__card-slot"
                sx={{
                    flex: 1,
                    minHeight: 0,
                    alignSelf: "stretch",
                    containerType: "size",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "18px 22px 14px",
                }}
            >
                {/* The hero: the answer face on the tower's card stock — the flp back face's
                    blocks (CardFaceSide / ChineseBlock / EnglishBlock), so a change there shows here. */}
                {/* The frame holds the hero's layout box and is what the zoom measures; the
                    card inside carries the zoom's transform (see the header). */}
                <Box
                    className="tower-card-view__hero-frame"
                    ref={heroFrameRef}
                    sx={{ width: HERO_WIDTH, aspectRatio: `${CARD_BASE_WIDTH} / ${CARD_BASE_HEIGHT}`, position: "relative" }}
                >
                <Box
                    className="tower-card-view__hero-card"
                    ref={heroCardRef}
                    sx={{
                        position: "absolute",
                        inset: 0,
                        // The cast shadow sits on this wrapper (the face is absolutely positioned
                        // inside it); the radius repeats so the shadow takes the card's shape.
                        borderRadius: CARD_SURFACE.borderRadius,
                        boxShadow: CARD_SURFACE.boxShadow,
                        // The card stock, sized off this box's own width (cardStock.ts).
                        containerType: "inline-size",
                        ...HERO_CARD_STOCK_VARS,
                        // Zoomed with the ghost, from the tile, cross-fading in under it.
                        transformOrigin: "0 0",
                        transform: heroTransform,
                        opacity: isOpen ? 1 : 0,
                        transition: heroTransition,
                    }}
                >
                    <CardFaceSide
                        rotated={false}
                        contentGap={2}
                        contentClassName="tower-card-view__side-two"
                        iconId={shownEntry.iconId}
                        showIcon
                        iconLayout={shownEntry.iconLayout}
                        textLayout={shownEntry.textLayout}
                        isUsingAdvancedLayout={isAdvancedLayout(shownEntry.iconLayout, shownEntry.textLayout)}
                        cardColor={shownEntry.cardColor}
                        textBlocks={{
                            foreign: (
                                <ChineseBlock
                                    entry={shownEntry}
                                    showPinyin={showPinyin}
                                    showPinyinColor={showPinyinColor}
                                    onSpeak={tts.speak}
                                    speakingKey={tts.speakingKey}
                                    inlineActions
                                    selectedSenseIndex={selectedSenseIndex}
                                />
                            ),
                            english: (
                                <EnglishBlock entry={shownEntry} selectedSenseIndex={selectedSenseIndex} onSelectSense={handleSelectSense} />
                            ),
                        }}
                        // Gesture canvas only in advanced mode; basic mode renders the draft
                        // through the static icon layer (via editingCurrentEntry).
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
                                        entry={shownEntry}
                                        showPinyin={showPinyin}
                                        showPinyinColor={showPinyinColor}
                                        onSpeak={tts.speak}
                                        speakingKey={tts.speakingKey}
                                        inlineActions
                                        selectedSenseIndex={selectedSenseIndex}
                                    />
                                )}
                                englishNode={<EnglishBlock entry={shownEntry} selectedSenseIndex={selectedSenseIndex} />}
                            />
                        ) : undefined}
                    />
                </Box>
                </Box>
            </Box>

            {/* ── Mastery — the world the card was opened from, plus the goals that are on. ── */}
            <Box
                className="tower-card-view__mastery"
                sx={{ width: COLUMN_MAX_PX, maxWidth: "100%", px: "28px", boxSizing: "border-box", ...chromeSx }}
            >
                <TowerMasteryPanel entry={entry} initialTrack={view.world} tracks={tracks} ink={ink} night={night} />
            </Box>

            {/* Clearance for the More Info plate, which is absolutely positioned (the flp's spot). */}
            <Box
                className="tower-card-view__more-info-clearance"
                sx={{ height: `calc(${MORE_INFO_HEIGHT_PX + MORE_INFO_BOTTOM_PX + 18}px + ${SAFE_BOTTOM})`, flexShrink: 0 }}
            />
            </Box>

            {/* ── More Info: the flp's plate (styled.ts MoreInfoPill) at the flp's position.
                Ghosted until the full entry lands (the eip reads fields the library rows may
                not carry) and while the fie is open; the open waits a paint, like the flp's. ── */}
            <Box className="tower-card-view__more-info-layer" sx={{ ...chromeSx }}>
                <MoreInfoPill
                    className="tower-card-view__more-info-pill"
                    isFlipped={fullLoaded}
                    isDisabled={editMode || !fullLoaded}
                    plate={plateTones}
                    onClick={() => afterNextPaint(openInfo)}
                    aria-disabled={editMode || !fullLoaded}
                    aria-label="Open extra info"
                >
                    <Typography sx={{ fontSize: SIZE.body, color: theme.palette.flashcard.onSurface, lineHeight: 1, transform: "translateY(-1px)" }}>↑</Typography>
                    <Typography sx={{ fontSize: SIZE.caption, fontWeight: WEIGHT.semibold, color: theme.palette.flashcard.onSurface, letterSpacing: TRACKING.wide, fontFamily: TOWER_STUDY_FONT }}>More Info</Typography>
                </MoreInfoPill>
            </Box>

            {/* ── The ghost: the tapped tile's stand-in through the zoom (see the header). ── */}
            {ghostShown && origin && (
                <Box
                    className="tower-card-view__ghost"
                    aria-hidden
                    style={{ [GROUND_SHADOW_VAR_NAME]: shadowTone(sky) } as React.CSSProperties}
                    sx={{
                        position: "absolute",
                        left: origin.left,
                        top: origin.top,
                        width: origin.width,
                        height: origin.height,
                        transformOrigin: "0 0",
                        transform: ghostTransform,
                        transition: ghostTransition,
                        opacity: isOpen ? 0 : 1,
                        pointerEvents: "none",
                        zIndex: 1,
                    }}
                >
                    <MiniVocabCard entry={view.entry} lens={view.world} stock={TOWER_CARD_STOCK} />
                </Box>
            )}

            {/* THE eip — the same sheet the Dictionary page and acp raise, with the word trail.
                `learningSkipsRoot`: the root is this saved card, so its Learning key would only
                offer to un-save it; drilled-into words get the key. A study surface (td claims
                it while the view is up), so EipSheet's flame stays on. */}
            <EipSheet
                eip={eip}
                open={infoOpen}
                onClose={() => setInfoOpen(false)}
                onSpeak={tts.speak}
                onSpeakSentence={tts.speakSentence}
                speakingKey={tts.speakingKey}
                showSynonymsRelated
                showLearning
                learningSkipsRoot
            />

            {/* The Compare sheet portals to the overlay host; its place here is moot. */}
            {compareSheet}

            {/* Add / change-icon search (download-on-select). docs/CARD_ICON_LAYOUT.md */}
            <IconPickerDialog
                open={iconSearchOpen}
                onClose={() => setIconSearchOpen(false)}
                title={advMode ? "Add an icon" : "Change icon"}
                onPick={handlePickIcon}
                initialTerm={lastIconQuery ?? iconSearchTerm(displayCurrentEntry ? resolveDisplayDefinition(displayCurrentEntry, selectedSenseIndex) : null)}
                onTermChange={setLastIconQuery}
                prefetched={pickerPrefetched}
            />

            <Dialog className="card-icon-reset-dialog" open={resetConfirmOpen} onClose={() => !savingLayout && setResetConfirmOpen(false)}>
                <DialogTitle>Reset to default icon?</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        This removes your custom icon arrangement for this card and restores the default icon. This can't be undone.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setResetConfirmOpen(false)} disabled={savingLayout}>Cancel</Button>
                    <Button onClick={handleResetConfirmed} color="error" disabled={savingLayout}>Reset</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default TowerCardView;
