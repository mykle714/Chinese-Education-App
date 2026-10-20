import { memo, useState, useLayoutEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { Box, Typography, Button, Chip, Menu, MenuItem, Snackbar } from "@mui/material";
import { styled } from "@mui/material/styles";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import MiniCard from "../../components/MiniCard";
import MiniVocabCardGrid from "../../components/MiniVocabCardGrid";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import { FooterSpacer } from "../../components/MobileFooter";
import QuickMarkCard from "../../components/QuickMarkCard";
import SheetCloseX from "../../components/sheet/SheetCloseX";
import { SheetHeaderSlot } from "../../components/sheet/sheetStyled";
import PageHeader from "../../components/PageHeader";
import MinutePointsFireBadge from "../../minutePoints/MinutePointsFireBadge";
import { QUICK_MARK_COLOR, QUICK_MARK_LABEL, QUICK_MARK_BUCKET } from "../../components/quickMarkSwipe";
import { MINI_CARD_DIMENSIONS, type MiniCardSize } from "../../components/miniCardFace";
import { stripParentheses } from "../../utils/definitionUtils";
import type { SwipeDirection } from "../../hooks/useSwipeCommit";
import { useQuickMarkGrid, QUICK_MARK_UNDO_TOAST_MS } from "./useQuickMarkGrid";
import type { QuickMarkSupplySeed } from "./useQuickMarkPreload";
import { DIFFICULTY_LEVELS, difficultyLabel } from "./difficultyLevels";
import type { Language, DiscoverCard, VocabEntry } from "../../types";
import { COLORS } from "../../theme/colors";
import { SIZE, WEIGHT, TRACKING } from "../../theme/scale";
import { SAFE_TOP } from "../../theme/safeArea";

// QUICK MARK PANEL (docs/SORT_CARDS_REQUIREMENTS.md § 4.8, docs/QUICK_MARK.md) — Sort
// Cards' on-deck platform, MAXIMIZED. The ⊞ button beside "skip" opens it; the ✕ in its
// top-right corner is the only way back. Fully open it is a MAXIMIZED panel: it covers
// the whole frame, the NodePage header included, on the page's own ground
// (`COLORS.background`) with square corners — a page, not a sheet — and, like a maximized
// SheetPanel, it ends HEADED: a real `PageHeader` titled "Quick Mark", no back chevron,
// with the close cluster (minute-points flame + ✕) in its right slot. It is the Quick
// Mark bulk-triage grid: a level chip (no Auto), the swipe legend, and
// a wall of swipeable mini cards (left = Learning, right = Mastered), with the pack the
// learner was looking at pinned first.
//
// THE MORPH. Opening, the panel grows UP out of the platform: a clip-path inset that
// starts at the platform's top edge opens to the top of the frame — its 20px top corners
// squaring off and its fill shifting from the platform's white to the page ground on the
// way. Each pinned (pack) card flies from its on-deck slot into its grid cell on a
// MorphGhost (the real cell held invisible until its ghost lands) — the 4th card of a
// 4-card pack included, straight into its row-2 cell. The rest of the panel's cards pop
// in with the grid's stagger as it grows (`SUPPLY_POP_START_MS`, `SUPPLY_POP_STAGGER_MS`).
// The supply is only in place at mount when the host preloaded it (useQuickMarkPreload);
// without a preload it pops in with the grid's own stagger when the fetch lands instead. Closing
// plays it backwards (back to a white, rounded slab): the clip retracts to
// the platform top while every
// pinned card still unsorted flies from its cell back to its slot; the panel (with the
// ghosts) unmounts at the same instant, uncovering the real cards exactly beneath them.
// The ghosts portal to <body> in viewport coordinates (as scp's FallingCardGhost does),
// so the clip never cuts them off.
//
// LAYER: feature view (features/discover). Its grid state is `useQuickMarkGrid`; every
// pack-level consequence of a swipe is the HOST's (SortCardsPage), through the callbacks.
// Mounted only while expanded, in NodePage's `overlay` slot — a sibling of the page's
// scroll area, whose `touch-action: none` would otherwise forbid the grid's vertical pan.
//
// Referenced by docs/SORT_CARDS_REQUIREMENTS.md § 4.8 and docs/QUICK_MARK.md.

// The grid container's class (passed as MiniVocabCardGrid's `containerClassName`): how
// the gap-fill slide, the draw window and the morph find the cards.
const GRID_CLASS = "sort-cards-quick-mark__grid";

// OnDeckSection's rounded top — the panel's corners while it is still the slab. Fully
// open they are square (a maximized page), so the radius only lives in the clip keyframes.
const PLATFORM_RADIUS_PX = 20;
// The slab's fill (OnDeckSection is white) and the open panel's — the same ground every
// page paints (MobileTabScreen's default `surfaceColor`).
const PLATFORM_FILL = COLORS.white;
const PAGE_FILL = COLORS.background;
// Above the on-deck cards' inline zIndex 1000 and the page header, below the eip sheet
// (1200+), which a tap on a grid card opens over the panel. Inside NodePage's Surface
// stacking context, so the frame-level floating footer still floats over it, exactly as
// it floats over the platform.
const PANEL_Z_INDEX = 1100;
// The ghosts sit over the panel.
const GHOST_Z_INDEX = 1150;

// Morph timing. The cards' flight runs a little longer than the clip, so they visibly
// land after the slab has settled; on close the flight must end by the time the clip
// does, because the panel — and the ghosts with it — unmounts the moment it finishes.
// The open is deliberately unhurried (it is a change of mode, played once); the close
// stays quick (it is a way back).
const EXPAND_MS = 620;
const COLLAPSE_MS = 340;
const GHOST_EXPAND_MS = 720;
const GHOST_STAGGER_MS = 60;
const CONTENT_FADE_IN_MS = 360;
const CONTENT_FADE_IN_DELAY_MS = 160;
const CONTENT_FADE_OUT_MS = 160;
// The preloaded supply's pop-in: it starts as the content fades in, a card after a card.
const SUPPLY_POP_START_MS = CONTENT_FADE_IN_DELAY_MS;
const SUPPLY_POP_STAGGER_MS = 28;
const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";
const EASE_IN_OUT = "cubic-bezier(0.65, 0, 0.35, 1)";

const clipFromTop = (insetTopPx: number, radiusPx: number) =>
    `inset(${insetTopPx}px 0px 0px 0px round ${radiusPx}px ${radiusPx}px 0px 0px)`;
// The two ends of the morph, as WAAPI keyframes: the platform slab and the open page.
const slabFrame = (insetTopPx: number) => ({ clipPath: clipFromTop(insetTopPx, PLATFORM_RADIUS_PX), backgroundColor: PLATFORM_FILL });
const PAGE_FRAME = { clipPath: clipFromTop(0, 0), backgroundColor: PAGE_FILL };
const prefersReducedMotion = () =>
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

type PanelPhase = "expanding" | "open" | "collapsing";

const PanelSurface = styled(Box)({
    // The whole frame (NodePage's Surface): over the page header, down to the bottom edge,
    // where the floating footer pill hovers over it as it does over the platform (the grid
    // ends in a FooterSpacer).
    position: "absolute",
    inset: 0,
    zIndex: PANEL_Z_INDEX,
    backgroundColor: PAGE_FILL,
    // It reaches the top of the screen, under the status bar, so it carries the same
    // clearance every page header gets — on the PANEL, as SheetPanel's merged chrome does,
    // because SheetHeaderSlot re-pads the PageHeader and would drop the header's own.
    paddingTop: SAFE_TOP,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    userSelect: "none",
    WebkitUserSelect: "none",
});

// The level chip's row, under the panel header.
const PanelLevelRow = styled(Box)({
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    minHeight: 40,
    paddingInline: 16,
    paddingBlock: 4,
});

// The panel's own scroller — the grid's vertical pan (the page itself never scrolls).
const PanelScroll = styled(Box)({
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    overflowX: "hidden",
    touchAction: "pan-y",
    overscrollBehavior: "contain",
});

/** One card's flight between an on-deck slot and a grid cell (viewport rects). */
interface MorphFlight {
    card: DiscoverCard;
    from: DOMRect;
    to: DOMRect;
    /** The face size at `to`, where the ghost is drawn. */
    size: MiniCardSize;
    delayMs: number;
    durationMs: number;
}

/** A slot rect's face size: the 4-card dock draws compact faces. */
const sizeForRect = (rect: DOMRect): MiniCardSize =>
    rect.width < MINI_CARD_DIMENSIONS.regular.width - 1 ? "compact" : "regular";

/**
 * A stand-in card for the morph. Rendered AT its destination and FLIP-animated from its
 * origin (translate + scale, so a compact 78px on-deck face grows into the regular 92px
 * grid face and back). `fill: backwards` holds the origin pose through the stagger delay.
 * Portalled to <body>: it must outlive the clip the panel is animating.
 */
const MorphGhost = memo(function MorphGhost({ flight, onLanded }: {
    flight: MorphFlight;
    onLanded: (cardId: number) => void;
}) {
    const ref = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const { from, to } = flight;
        const anim = el.animate([{
            transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`,
        }, { transform: "none" }], {
            duration: flight.durationMs, delay: flight.delayMs, easing: EASE_OUT, fill: "backwards",
        });
        anim.onfinish = () => onLanded(flight.card.id);
        return () => anim.cancel();
    // Mount-only: a flight is fixed once it starts; `onLanded` is a stable callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const { card } = flight;
    return createPortal(
        <Box
            ref={ref}
            className="sort-cards-quick-mark__morph-ghost"
            aria-hidden
            sx={{
                position: "fixed",
                left: flight.to.left,
                top: flight.to.top,
                transformOrigin: "top left",
                zIndex: GHOST_Z_INDEX,
                pointerEvents: "none",
            }}
        >
            <MiniCard
                size={flight.size}
                language={card.language}
                entryKey={card.entryKey}
                pronunciation={card.pronunciation}
                definition={stripParentheses(card.definition ?? "")}
                iconId={card.iconId}
            />
        </Box>,
        document.body,
    );
});

// One legend swatch — the destination collection's colour, as a dragged card turns.
const LegendItem: React.FC<{ direction: SwipeDirection; className: string }> = ({ direction, className }) => (
    <Box className={className} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        {direction === "left" && <Typography sx={{ fontSize: SIZE.micro, color: COLORS.textSecondary }}>←</Typography>}
        <Box sx={{ width: 12, height: 12, borderRadius: "50%", backgroundColor: QUICK_MARK_COLOR[direction], border: `1px solid ${COLORS.border}` }} />
        <Typography sx={{ fontSize: SIZE.micro, color: COLORS.textSecondary }}>{QUICK_MARK_LABEL[direction]}</Typography>
        {direction === "right" && <Typography sx={{ fontSize: SIZE.micro, color: COLORS.textSecondary }}>→</Typography>}
    </Box>
);

type QuickMarkBucket = (typeof QUICK_MARK_BUCKET)[SwipeDirection];

export interface QuickMarkPanelProps {
    language: Language;
    /** The concrete level the grid shows (the host's pinned level, else the pack's). */
    level: number;
    /** A level picked from the chip. The host pins its own dropdown to it. */
    onPickLevel: (level: number) => void;
    /** The on-deck pack's unsorted cards at the moment of opening. Read at mount only. */
    pinnedCards: DiscoverCard[];
    /** The preloaded first supply page, if the host has one. Read at mount only. */
    supplySeed: QuickMarkSupplySeed | null;
    /** The live on-deck platform's viewport rect — where the clip opens from / closes to. */
    getPlatformRect: () => DOMRect | null;
    /** A pinned card's on-deck slot (CardWell) viewport rect, or null if it has no slot. */
    getSlotRect: (cardId: number) => DOMRect | null;
    onSortPinned: (card: DiscoverCard, bucket: QuickMarkBucket) => void;
    onUndoPinned: (card: DiscoverCard, bucket: QuickMarkBucket) => void;
    onSupplySorted: (card: DiscoverCard, bucket: QuickMarkBucket) => void;
    onSupplyUnsorted: (card: DiscoverCard, bucket: QuickMarkBucket) => void;
    /** Tap a card → the host's eip opener (shared with the on-deck info buttons). */
    onOpenInfo: (card: DiscoverCard) => void;
    /** entryKey whose eip lookup is in flight (spinner on that card). */
    infoLoadingKey: string | null;
    /** The close morph finished — the host unmounts the panel. */
    onCollapsed: () => void;
}

const QuickMarkPanel: React.FC<QuickMarkPanelProps> = ({
    language, level, onPickLevel, pinnedCards, supplySeed, getPlatformRect, getSlotRect,
    onSortPinned, onUndoPinned, onSupplySorted, onSupplyUnsorted,
    onOpenInfo, infoLoadingKey, onCollapsed,
}) => {
    const panelRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [levelMenuAnchor, setLevelMenuAnchor] = useState<HTMLElement | null>(null);

    const grid = useQuickMarkGrid({
        language, level, pinnedCards, seed: supplySeed, gridClass: GRID_CLASS, scrollerRef: scrollRef,
        onSortPinned, onUndoPinned, onSupplySorted, onSupplyUnsorted,
    });

    // ── Morph ───────────────────────────────────────────────────────────────────
    const [phase, setPhase] = useState<PanelPhase>("expanding");
    const phaseRef = useRef<PanelPhase>("expanding");
    phaseRef.current = phase;
    const [flights, setFlights] = useState<MorphFlight[]>([]);
    // Grid cells held invisible while their ghost is in the air.
    const [inFlightIds, setInFlightIds] = useState<Set<number>>(() => new Set());

    // The platform's top edge, as a clip inset from the panel's own top.
    const platformInset = useCallback(() => {
        const panel = panelRef.current?.getBoundingClientRect();
        const platform = getPlatformRect();
        return panel && platform ? Math.max(0, platform.top - panel.top) : 0;
    }, [getPlatformRect]);
    const cellRect = useCallback((cardId: number) => {
        const cell = scrollRef.current?.querySelector(`.${GRID_CLASS} [data-swipe-id="${cardId}"]`);
        return cell ? cell.getBoundingClientRect() : null;
    }, []);

    // The cards in the grid on its first render — the pinned cards and, when preloaded,
    // the first supply page. The preloaded supply pops in on the morph's own clock
    // (renderCard); a card mounted later keeps the grid's own stagger.
    const mountCardIdsRef = useRef<Set<number> | null>(null);
    if (mountCardIdsRef.current === null) mountCardIdsRef.current = new Set(grid.cards.map((c) => c.id));

    // The pinned cards' expand flights, slot → cell (see THE MORPH above).
    const startExpandFlights = useCallback(() => {
        const opening = pinnedCards.flatMap((card): MorphFlight[] => {
            const from = getSlotRect(card.id);
            const to = cellRect(card.id);
            return from && to ? [{ card, from, to, size: "regular", delayMs: 0, durationMs: GHOST_EXPAND_MS }] : [];
        }).map((flight, i) => ({ ...flight, delayMs: i * GHOST_STAGGER_MS }));
        setFlights(opening);
        setInFlightIds(new Set(opening.map((f) => f.card.id)));
    }, [pinnedCards, getSlotRect, cellRect]);

    // OPEN — on mount, before the first paint (so the panel never flashes at full size).
    // The pinned cards are in the grid from the hook's first render, so their cells are
    // already laid out to measure.
    useLayoutEffect(() => {
        const panel = panelRef.current;
        const content = contentRef.current;
        if (!panel || !content || prefersReducedMotion()) {
            setPhase("open");
            return;
        }
        const clip = panel.animate([slabFrame(platformInset()), PAGE_FRAME], { duration: EXPAND_MS, easing: EASE_OUT });
        const fade = content.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: CONTENT_FADE_IN_MS, delay: CONTENT_FADE_IN_DELAY_MS, easing: "ease-out", fill: "backwards",
        });
        startExpandFlights();
        clip.onfinish = () => { if (phaseRef.current === "expanding") setPhase("open"); };
        return () => { clip.cancel(); fade.cancel(); };
    // Mount-only: the open morph plays once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // An opening ghost reached its cell: reveal the real card, retire the ghost. Closing
    // ghosts are NOT retired — they hold their slot pose until the panel unmounts, which
    // is the frame the real on-deck card underneath is uncovered.
    const handleGhostLanded = useCallback((cardId: number) => {
        if (phaseRef.current === "collapsing") return;
        setFlights((prev) => prev.filter((f) => f.card.id !== cardId));
        setInFlightIds((prev) => { const next = new Set(prev); next.delete(cardId); return next; });
    }, []);

    // CLOSE — the ✕. Ignored mid-open (the clip would jump) and once already closing.
    const handleClose = useCallback(() => {
        if (phaseRef.current !== "open") return;
        setPhase("collapsing");
        phaseRef.current = "collapsing";
        grid.dismissToast();
        const panel = panelRef.current;
        const content = contentRef.current;
        if (!panel || !content || prefersReducedMotion()) {
            onCollapsed();
            return;
        }
        // Every pinned card still standing flies home; a swiped one left a crater there.
        const closing = grid.cards
            .filter((card) => grid.isPinned(card.id) && !grid.leaving[card.id])
            .flatMap((card): MorphFlight[] => {
                const from = cellRect(card.id);
                const to = getSlotRect(card.id);
                if (!from || !to) return [];
                return [{ card, from, to, size: sizeForRect(to), delayMs: 0, durationMs: COLLAPSE_MS }];
            });
        setFlights(closing);
        setInFlightIds(new Set(closing.map((f) => f.card.id)));
        content.animate([{ opacity: 1 }, { opacity: 0 }], { duration: CONTENT_FADE_OUT_MS, fill: "forwards" });
        const clip = panel.animate([PAGE_FRAME, slabFrame(platformInset())], {
            duration: COLLAPSE_MS, easing: EASE_IN_OUT, fill: "forwards",
        });
        clip.onfinish = () => onCollapsed();
    }, [grid, cellRect, getSlotRect, platformInset, onCollapsed]);

    // ── Grid ────────────────────────────────────────────────────────────────────
    // MiniVocabCardGrid takes VocabEntry[]; a DiscoverCard supplies everything the
    // Quick Mark card reads (id + entryKey + definition + pronunciation + frequencyScore
    // + iconId). Stable per `cards` so the grid's reveal doesn't thrash.
    const entries = useMemo(() => grid.cards as unknown as VocabEntry[], [grid.cards]);
    const cardById = useMemo(() => new Map(grid.cards.map((c) => [c.id, c])), [grid.cards]);
    const { leaving, swipe, isPinned } = grid;

    const renderCard = useCallback(
        (entry: VocabEntry, index: number, animationDelayMs?: number) => {
            const card = cardById.get(entry.id);
            if (!card) return null;
            const cardLeaving = leaving[card.id] ?? null;
            // A pinned card arrives on its ghost: no pop-in. The preloaded supply (in the grid
            // at mount) pops in on the morph's clock, counted from the first supply card;
            // a card mounted later keeps the grid's own stagger. The card freezes its delay
            // at mount, so none of this replays.
            const popDelayMs = isPinned(card.id)
                ? undefined
                : mountCardIdsRef.current?.has(card.id)
                    ? SUPPLY_POP_START_MS + Math.max(0, index - pinnedCards.length) * SUPPLY_POP_STAGGER_MS
                    : animationDelayMs;
            return (
                <QuickMarkCard
                    key={card.id}
                    card={card}
                    leaving={cardLeaving}
                    swipeHandlers={cardLeaving ? undefined : swipe.handlers}
                    wasDrag={swipe.wasDrag}
                    onOpenInfo={onOpenInfo}
                    infoLoading={infoLoadingKey === card.entryKey}
                    // A pinned card ARRIVES on its ghost — no pop-in of its own.
                    animationDelayMs={popDelayMs}
                    hidden={inFlightIds.has(card.id)}
                />
            );
        },
        [cardById, leaving, isPinned, pinnedCards.length, swipe.handlers, swipe.wasDrag, onOpenInfo, infoLoadingKey, inFlightIds]
    );

    // Infinite-scroll sentinel, observed against the panel's own scroller. The callback
    // ref re-arms whenever loadMore changes (React first calls it with null, disconnecting
    // the stale observer).
    const { loadMore } = grid;
    const sentinelRef = useCallback((node: HTMLDivElement | null) => {
        if (!node) return;
        const observer = new IntersectionObserver(
            (obsEntries) => { if (obsEntries[0]?.isIntersecting) loadMore(); },
            { root: scrollRef.current, rootMargin: "300px" }
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, [loadMore]);

    const { toast } = grid;

    return (
        <PanelSurface
            ref={panelRef}
            className="sort-cards-quick-mark"
            sx={{ pointerEvents: phase === "collapsing" ? "none" : undefined }}
        >
            <Box ref={contentRef} className="sort-cards-quick-mark__content" sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
                {/* PANEL HEADER — the same final state as a maximized SheetPanel: the
                    app's real PageHeader, no back chevron (the ✕ is the close), and the
                    close cluster in its right slot. The flame rides in the cluster, not
                    PageHeader's own slot, so it sits inboard of the ✕ — and it is shown
                    because the panel covers scp's header, the study surface's one
                    "your time is counting" indicator (SheetPanel's showMinutePoints rule). */}
                <SheetHeaderSlot className="sort-cards-quick-mark__header">
                    <PageHeader
                        title="Quick Mark"
                        size="node"
                        showBack={false}
                        showFlame={false}
                        safeAreaTop={false}
                        rightContent={
                            <>
                                <MinutePointsFireBadge />
                                <SheetCloseX
                                    className="sort-cards-quick-mark__close"
                                    ariaLabel="Back to sorting"
                                    onClick={handleClose}
                                />
                            </>
                        }
                    />
                </SheetHeaderSlot>

                <PanelLevelRow className="sort-cards-quick-mark__level-row">
                    <Chip
                        className="sort-cards-quick-mark__level-chip"
                        label={
                            <Box sx={{ display: "flex", alignItems: "center", gap: 0.25 }}>
                                {difficultyLabel(language, level)}
                                <KeyboardArrowDownIcon sx={{ fontSize: "1rem" }} />
                            </Box>
                        }
                        size="small"
                        onClick={(e) => setLevelMenuAnchor(e.currentTarget)}
                        sx={{
                            backgroundColor: COLORS.infoInk, color: COLORS.white,
                            fontSize: SIZE.micro, fontWeight: WEIGHT.bold, letterSpacing: TRACKING.caps, cursor: "pointer",
                        }}
                    />
                    <Menu
                        className="sort-cards-quick-mark__level-menu"
                        anchorEl={levelMenuAnchor}
                        open={Boolean(levelMenuAnchor)}
                        onClose={() => setLevelMenuAnchor(null)}
                    >
                        {DIFFICULTY_LEVELS.map((lvl) => (
                            <MenuItem
                                className="sort-cards-quick-mark__level-menu-item"
                                key={lvl}
                                selected={level === lvl}
                                onClick={() => {
                                    setLevelMenuAnchor(null);
                                    if (lvl !== level) onPickLevel(lvl);
                                }}
                            >
                                {difficultyLabel(language, lvl)}
                            </MenuItem>
                        ))}
                    </Menu>
                </PanelLevelRow>

                {/* Legend — what each swipe direction does. */}
                <Box className="sort-cards-quick-mark__legend" sx={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 2, px: 2, pb: 0.5 }}>
                    <LegendItem className="sort-cards-quick-mark__legend-learn-now" direction="left" />
                    <LegendItem className="sort-cards-quick-mark__legend-mastered" direction="right" />
                </Box>

                <PanelScroll ref={scrollRef} className="sort-cards-quick-mark__scroll">
                    <MiniVocabCardGrid
                        containerClassName={GRID_CLASS}
                        classPrefix="sort-cards-quick-mark"
                        loading={grid.loading}
                        error={grid.error}
                        entries={entries}
                        emptyMessage="No unsorted cards at this level. Try another level."
                        // Unused: `renderCard` draws the cards, and each one handles its own tap.
                        onCardClick={() => {}}
                        renderCard={renderCard}
                        staggerReveal
                        footer={
                            <>
                                {/* Infinite-scroll sentinel (only while more pages exist). */}
                                {grid.hasMore && (
                                    <Box
                                        ref={sentinelRef}
                                        className="sort-cards-quick-mark__load-sentinel"
                                        sx={{ width: "100%", display: "flex", justifyContent: "center", py: 2 }}
                                    >
                                        {grid.loadingMore && <DelayedCircularProgress className="sort-cards-quick-mark__load-spinner" />}
                                    </Box>
                                )}
                                {/* Bottom clearance so the last row clears the floating footer pill. */}
                                <FooterSpacer />
                            </>
                        }
                    />
                </PanelScroll>
            </Box>

            <Snackbar
                key={toast?.seq}
                className="sort-cards-quick-mark__toast"
                open={toast !== null}
                autoHideDuration={QUICK_MARK_UNDO_TOAST_MS}
                // Ignore clickaway: a swipe on another card is a "click away", and it
                // would hide the toast that swipe is about to replace anyway.
                onClose={(_e, reason) => { if (reason !== "clickaway") grid.dismissToast(); }}
                message={
                    toast?.kind === "undo"
                        ? `${toast.card.entryKey} → ${QUICK_MARK_LABEL[toast.direction]}`
                        : toast?.message
                }
                action={toast?.kind === "undo" ? (
                    <Button
                        className="sort-cards-quick-mark__undo-button"
                        size="small"
                        onClick={grid.handleUndo}
                        sx={{ color: COLORS.white, fontSize: SIZE.micro, fontWeight: WEIGHT.bold, textTransform: "lowercase" }}
                    >
                        undo
                    </Button>
                ) : undefined}
                anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
            />

            {flights.map((flight) => (
                <MorphGhost key={`${phase === "collapsing" ? "out" : "in"}:${flight.card.id}`} flight={flight} onLanded={handleGhostLanded} />
            ))}
        </PanelSurface>
    );
};

export default QuickMarkPanel;
