import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Box, Typography, Button, Chip, Menu, MenuItem, Snackbar } from "@mui/material";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import NodePage from "../../components/NodePage";
import MiniVocabCardGrid from "../../components/MiniVocabCardGrid";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import { FooterSpacer } from "../../components/MobileFooter";
import QuickMarkCard from "../../components/QuickMarkCard";
import {
    QUICK_MARK_BUCKET, QUICK_MARK_COLOR, QUICK_MARK_COMMIT_PX, QUICK_MARK_LABEL,
    paintQuickMarkDrag, snapshotCardSlots, playCardSlotSlide, observeCardDrawWindow, type CardSlots,
} from "../../components/quickMarkSwipe";
import { useAuth } from "../../AuthContext";
import { fetchQuickMarkPage, sortCard, undoSort } from "./starterPacksApi";
import { lookupVocabEntry } from "../../api/dictionary";
import EipSheet from "../flashcards/FlashcardsLearnPage/EipSheet";
import { useEipTabs } from "../flashcards/FlashcardsLearnPage/useEipTabs";
import { useTTS } from "../../hooks/useTTS";
import { useSwipeCommit, type SwipeDirection } from "../../hooks/useSwipeCommit";
import { CARD_FLY_OUT_MS } from "../flashcards/constants";
import type { Language, DiscoverCard, VocabEntry } from "../../types";
import { usePageTitle } from "../../hooks/usePageTitle";
import { COLORS } from "../../theme/colors";
import { SIZE, WEIGHT, TRACKING } from "../../theme/scale";

// QUICK MARK (docs/QUICK_MARK.md) — the Discover hub's bulk-triage grid, the second
// activity (between Sort Cards and Skipped Cards). The user picks a difficulty level and
// sees every not-yet-sorted discoverable word at that level as mini cards ordered by
// frequency score. Each card is SWIPED: left = Add to Learn Now, right = Mastered. A
// swipe saves immediately (one `sortCard` per card — the same library / already-learned
// buckets as Sort Cards, so nothing new is stored), the card flies off, the grid closes
// the gap, and an Undo toast offers to take the last swipe back. A tap opens the eip.
//
// LAYER: page (view). Fetches its own supply + posts each sort; no shared hook beyond the
// gesture (`useSwipeCommit`, shared with the Reading Center's swipe grid).

// Manual level dropdown — the generalized 1..6 difficulty scale (no "Auto": Quick Mark
// is always a concrete level). Mirrors SortCardsPage's DIFFICULTY_LEVELS.
const DIFFICULTY_LEVELS = [1, 2, 3, 4, 5, 6];

// The grid container's class (passed as MiniVocabCardGrid's `containerClassName`), used
// to find the cards for the gap-fill slide.
const GRID_CLASS = "quick-mark-cards-preview";
const GRID_SELECTOR = `.${GRID_CLASS}`;

// How long the Undo toast stays up after a swipe.
const UNDO_TOAST_MS = 4000;

// A card cursor for keyset pagination — the last FETCHED card's sort-key coordinates.
// Matches the server's ORDER BY (frequencyScore DESC NULLS LAST, id ASC).
interface QuickMarkCursor {
    score: number | null;
    id: number;
}

// The bottom toast: the last swipe (with Undo), or a failure message. `seq` keys the
// Snackbar so back-to-back swipes restart its auto-hide instead of extending a stale one.
type QuickMarkToastInput =
    | { kind: "undo"; card: DiscoverCard; index: number; direction: SwipeDirection }
    | { kind: "error"; message: string };
type QuickMarkToast = QuickMarkToastInput & { seq: number };

// One legend swatch — the destination collection's colour, as a dragged card turns.
const LegendItem: React.FC<{ direction: SwipeDirection; className: string }> = ({ direction, className }) => (
    <Box className={className} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        {direction === "left" && <Typography sx={{ fontSize: SIZE.micro, color: COLORS.textSecondary }}>←</Typography>}
        <Box sx={{ width: 12, height: 12, borderRadius: "50%", backgroundColor: QUICK_MARK_COLOR[direction], border: `1px solid ${COLORS.border}` }} />
        <Typography sx={{ fontSize: SIZE.micro, color: COLORS.textSecondary }}>{QUICK_MARK_LABEL[direction]}</Typography>
        {direction === "right" && <Typography sx={{ fontSize: SIZE.micro, color: COLORS.textSecondary }}>→</Typography>}
    </Box>
);

// Re-insert a card at (up to) its old position, unless it's already there.
const reinsert = (cards: DiscoverCard[], card: DiscoverCard, index: number): DiscoverCard[] =>
    cards.some((c) => c.id === card.id)
        ? cards
        : [...cards.slice(0, index), card, ...cards.slice(index)];

const QuickMarkPage: React.FC = () => {
    usePageTitle("Quick Mark");
    const navigate = useNavigate();
    const { isAuthenticated } = useAuth();
    const { language } = useParams<{ language: Language }>();

    // The chosen level. `null` before the first fetch seeds it from the server's
    // adaptive-frontier estimate; thereafter it is a concrete 1..6 the user can change.
    const [selectedLevel, setSelectedLevel] = useState<number | null>(null);
    const [levelMenuAnchor, setLevelMenuAnchor] = useState<HTMLElement | null>(null);

    // The cards still to triage. A swiped card leaves this list once its fly-off ends.
    const [cards, setCards] = useState<DiscoverCard[]>([]);
    // Cards mid fly-off (committed, still on screen), keyed by det id.
    const [leaving, setLeaving] = useState<Record<number, SwipeDirection>>({});
    const [loading, setLoading] = useState(true);        // initial page
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [toast, setToast] = useState<QuickMarkToast | null>(null);
    const toastSeq = useRef(0);

    // Guard so the intersection-observer sentinel doesn't fire overlapping loads.
    const loadingMoreRef = useRef(false);
    // The keyset cursor is the last card FETCHED, not the last card on screen: swipes
    // remove cards from `cards`, and resuming after an earlier card would re-request
    // rows the client already holds (or, with every card swiped, have no cursor at all).
    const cursorRef = useRef<QuickMarkCursor | null>(null);
    // Live mirror of `cards` for the swipe commit, which runs from a stable handler.
    const cardsRef = useRef(cards);
    cardsRef.current = cards;
    // Per-card fly-off timers (cleared when a failed save or an Undo restores the card
    // first) and in-flight sort promises (an Undo waits for its sort to land, so the
    // delete can't race ahead of the insert it reverses).
    const removeTimers = useRef(new Map<number, number>());
    const pendingSorts = useRef(new Map<number, Promise<unknown>>());
    useEffect(() => {
        const timers = removeTimers.current;
        return () => { for (const t of timers.values()) window.clearTimeout(t); };
    }, []);

    const difficultyLabel = useCallback(
        (lvl: number) => (language === "zh" ? `HSK ${lvl}` : `Level ${lvl}`),
        [language]
    );

    const showToast = useCallback((t: QuickMarkToastInput) => {
        setToast({ ...t, seq: ++toastSeq.current });
    }, []);

    // Load a page. `reset` (level change / mount) replaces the grid; otherwise the page
    // is appended after the keyset cursor.
    const loadPage = useCallback(async (level: number | null, reset: boolean) => {
        if (reset) setLoading(true);
        else { setLoadingMore(true); loadingMoreRef.current = true; }
        setError(null);
        try {
            const data = await fetchQuickMarkPage(language as Language, level, reset ? null : cursorRef.current);
            setHasMore(data.hasMore);
            const last = data.cards[data.cards.length - 1];
            if (last) cursorRef.current = { score: last.frequencyScore ?? null, id: last.id };
            if (reset) {
                setCards(data.cards);
                setLeaving({});
                setToast(null); // an Undo for the previous level's card would be confusing
                setSelectedLevel(data.level); // seed (mount) or confirm (user pick)
            } else {
                // De-dupe defensively in case a concurrent sort shifted the window.
                setCards((prev) => {
                    const seen = new Set(prev.map((c) => c.id));
                    return [...prev, ...data.cards.filter((c) => !seen.has(c.id))];
                });
            }
        } catch (err: unknown) {
            console.error("Error loading quick-mark cards:", err);
            if (reset) setError(err instanceof Error ? err.message : "Failed to load cards");
        } finally {
            if (reset) setLoading(false);
            else { setLoadingMore(false); loadingMoreRef.current = false; }
        }
    // No `token` dep: starterPacksApi reads the bearer token itself at call time, so a
    // silent ~15-min refresh no longer re-creates this callback (which would re-run the
    // load effect and reset the grid mid-triage).
    }, [language]);

    // Initial load (mount / language change / auth settle). Keyed on isAuthenticated,
    // NOT token — a silent token refresh must not reload the page mid-triage
    // (CLAUDE.md "Never reload on token refresh").
    useEffect(() => {
        if (language) loadPage(null, true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [language, isAuthenticated]);

    // User picks a concrete level from the dropdown → fresh session at that level.
    const handlePickLevel = useCallback((lvl: number) => {
        setLevelMenuAnchor(null);
        if (lvl === selectedLevel) return;
        setSelectedLevel(lvl);
        loadPage(lvl, true);
    }, [selectedLevel, loadPage]);

    // Load the next page after the last-fetched card (keyset cursor).
    const loadMore = useCallback(() => {
        if (loadingMoreRef.current || !hasMore || !cursorRef.current) return;
        loadPage(selectedLevel, false);
    }, [hasMore, selectedLevel, loadPage]);

    // Swiped the whole loaded page away while more exist: the sentinel lives inside the
    // grid's card list, which is gone, so fetch the next page directly.
    useEffect(() => {
        if (!loading && cards.length === 0 && hasMore) loadMore();
    }, [loading, cards.length, hasMore, loadMore]);

    // ── Gap fill ────────────────────────────────────────────────────────────────
    // When a card leaves (or comes back), the cards after it SLIDE to their new slots
    // instead of jumping (quickMarkSwipe.ts → FLIP). The slots are snapshotted just before
    // the list changes and the slide is played in a layout effect, i.e. before the browser
    // paints the jumped layout. The grid is found by its class: MiniVocabCardGrid takes
    // no ref, and the class is this page's own (`containerClassName` below).
    const slotsBeforeChange = useRef<CardSlots | null>(null);
    const snapshotSlots = useCallback(() => {
        const root = document.querySelector(GRID_SELECTOR);
        if (root) slotsBeforeChange.current = snapshotCardSlots(root);
    }, []);
    useLayoutEffect(() => {
        const before = slotsBeforeChange.current;
        if (!before) return;
        slotsBeforeChange.current = null;
        const root = document.querySelector(GRID_SELECTOR);
        if (root) playCardSlotSlide(root, before);
    }, [cards]);

    // Draw window: only cards within two rows of the screen are painted
    // (quickMarkSwipe.ts → observeCardDrawWindow). Rebuilt whenever the list changes so
    // new cards (next page, an Undo) are observed and removed ones are released. The
    // scroller is the NodePage's MobileTabScreen scroll area, as for the load sentinel.
    useEffect(() => {
        const root = document.querySelector(GRID_SELECTOR);
        if (!root) return;
        return observeCardDrawWindow(root, root.closest(".mobile-tab-screen__scroll"));
    }, [cards]);

    // Put a card back where it was: cancel its pending removal, clear its fly-off.
    const restoreCard = useCallback((card: DiscoverCard, index: number) => {
        const timer = removeTimers.current.get(card.id);
        if (timer !== undefined) { window.clearTimeout(timer); removeTimers.current.delete(card.id); }
        setLeaving((prev) => { const next = { ...prev }; delete next[card.id]; return next; });
        snapshotSlots();
        setCards((prev) => reinsert(prev, card, index));
    }, [snapshotSlots]);

    // Drop a card from the grid: the fly-off is over (or an Undo failed).
    const removeCard = useCallback((cardId: number) => {
        removeTimers.current.delete(cardId);
        setLeaving((prev) => { const next = { ...prev }; delete next[cardId]; return next; });
        snapshotSlots();
        setCards((prev) => prev.filter((c) => c.id !== cardId));
    }, [snapshotSlots]);

    // A committed swipe: write the sort NOW, fly the card off, then close the gap. A
    // failed write puts the card back and says so — the grid must never show a card as
    // sorted that the server didn't take.
    const handleCommit = useCallback((id: string, direction: SwipeDirection) => {
        const cardId = Number(id);
        const index = cardsRef.current.findIndex((c) => c.id === cardId);
        const card = cardsRef.current[index];
        if (!card || !language) return;
        setLeaving((prev) => ({ ...prev, [cardId]: direction }));
        removeTimers.current.set(cardId, window.setTimeout(() => removeCard(cardId), CARD_FLY_OUT_MS));
        const sort = sortCard({ cardId, bucket: QUICK_MARK_BUCKET[direction], language, packId: null })
            .catch((err) => {
                console.error(`[QuickMark] sort failed → card ${cardId} (${QUICK_MARK_BUCKET[direction]}):`, err);
                restoreCard(card, index);
                showToast({ kind: "error", message: `Couldn't save ${card.entryKey} — try again.` });
                throw err; // keep the rejection for an Undo awaiting this sort
            })
            .finally(() => pendingSorts.current.delete(cardId));
        pendingSorts.current.set(cardId, sort);
        showToast({ kind: "undo", card, index, direction });
    }, [language, removeCard, restoreCard, showToast]);

    // Undo the last swipe: put the card back immediately, then delete the vet row the
    // sort created (`undoSort` — the same reversal Sort Cards uses). If the sort itself
    // failed there is nothing to delete (and the card is already back).
    const handleUndo = useCallback(async () => {
        if (toast?.kind !== "undo" || !language) return;
        const { card, index, direction } = toast;
        setToast(null);
        restoreCard(card, index);
        try {
            await pendingSorts.current.get(card.id);
        } catch {
            return; // the sort never landed — restoring the card was the whole undo
        }
        try {
            await undoSort({ cardId: card.id, bucket: QUICK_MARK_BUCKET[direction], language, packId: null });
        } catch (err) {
            console.error(`[QuickMark] undo failed → card ${card.id}:`, err);
            removeCard(card.id); // still sorted on the server — don't show it as unsorted
            showToast({ kind: "error", message: `Couldn't undo ${card.entryKey}.` });
        }
    }, [toast, language, restoreCard, removeCard, showToast]);

    const swipe = useSwipeCommit({
        axisLock: true,
        threshold: () => QUICK_MARK_COMMIT_PX,
        onCommit: handleCommit,
        // Painted straight to the DOM: a state-driven drag re-rendered the page — and so
        // the grid's whole card list — on every pointermove.
        paint: paintQuickMarkDrag,
    });

    // ── The eip (tap a card) ────────────────────────────────────────────────────
    // A DiscoverCard is NOT a VocabEntry — it lacks the clustered senses, long definition
    // and the rest the panel renders — so the word is looked up in det first, exactly as
    // the scp's card-info button does (SortCardsPage → handleOpenCardInfo). A failed
    // lookup only clears the spinner: the eip is an optional detour off the triage.
    const eip = useEipTabs({ language });
    const [eipOpen, setEipOpen] = useState(false);
    const [eipLoadingId, setEipLoadingId] = useState<number | null>(null);
    const eipLoadingRef = useRef(false); // one lookup at a time, without re-creating the callback
    const tts = useTTS();
    const handleOpenInfo = useCallback(async (card: DiscoverCard) => {
        if (eipLoadingRef.current) return;
        eipLoadingRef.current = true;
        setEipLoadingId(card.id);
        try {
            const entry = await lookupVocabEntry(card.entryKey, language);
            eip.openForRoot(entry);
            setEipOpen(true);
        } catch (err) {
            console.error(`[QuickMark] failed to open the info panel for "${card.entryKey}":`, err);
        } finally {
            eipLoadingRef.current = false;
            setEipLoadingId(null);
        }
    }, [language, eip]);

    // MiniVocabCardGrid takes VocabEntry[]; a DiscoverCard supplies everything the
    // Quick Mark card reads (id + entryKey + definition + pronunciation + frequencyScore
    // + iconId). Stable per `cards` so the grid's reveal doesn't thrash.
    const entries = useMemo(() => cards as unknown as VocabEntry[], [cards]);
    const cardById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);

    const renderCard = useCallback(
        (entry: VocabEntry, _index: number, animationDelayMs?: number) => {
            const card = cardById.get(entry.id);
            if (!card) return null;
            const cardLeaving = leaving[card.id] ?? null;
            return (
                <QuickMarkCard
                    key={card.id}
                    card={card}
                    leaving={cardLeaving}
                    swipeHandlers={cardLeaving ? undefined : swipe.handlers}
                    wasDrag={swipe.wasDrag}
                    onOpenInfo={handleOpenInfo}
                    infoLoading={eipLoadingId === card.id}
                    animationDelayMs={animationDelayMs}
                />
            );
        },
        [cardById, leaving, swipe.handlers, swipe.wasDrag, handleOpenInfo, eipLoadingId]
    );

    // Infinite-scroll sentinel: observe it against the MobileTabScreen scroll container
    // (the sentinel's nearest `.mobile-tab-screen__scroll` ancestor) so it fires while
    // scrolling INSIDE the page, not the viewport. The callback ref re-arms whenever
    // loadMore changes (React first calls it with null, disconnecting the stale observer).
    const sentinelRef = useCallback((node: HTMLDivElement | null) => {
        if (!node) return;
        const root = node.closest(".mobile-tab-screen__scroll") as HTMLElement | null;
        const observer = new IntersectionObserver(
            (obsEntries) => { if (obsEntries[0]?.isIntersecting) loadMore(); },
            { root, rootMargin: "300px" }
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, [loadMore]);

    const levelLabel = selectedLevel != null ? difficultyLabel(selectedLevel) : "…";

    return (
        <NodePage
            title="Quick Mark"
            onBack={() => navigate("/discover")}
            contentClassName="quick-mark-page__content"
            contentSx={{ alignItems: "center" }}
            // No header actions: every swipe saves on its own (docs/QUICK_MARK.md § 6).
        >
            {/* Level dropdown (no Auto) */}
            <Box className="quick-mark-page__level-bar" sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 40, px: 2, py: 0.5 }}>
                <Chip
                    className="quick-mark-page__level-chip"
                    label={
                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.25 }}>
                            {levelLabel}
                            <KeyboardArrowDownIcon sx={{ fontSize: "1rem" }} />
                        </Box>
                    }
                    size="small"
                    onClick={(e) => setLevelMenuAnchor(e.currentTarget)}
                    sx={{ backgroundColor: COLORS.infoInk, color: COLORS.white, fontSize: SIZE.micro, fontWeight: WEIGHT.bold, letterSpacing: TRACKING.caps, cursor: "pointer" }}
                />
                <Menu className="quick-mark-page__level-menu" anchorEl={levelMenuAnchor} open={Boolean(levelMenuAnchor)} onClose={() => setLevelMenuAnchor(null)}>
                    {DIFFICULTY_LEVELS.map((lvl) => (
                        <MenuItem
                            className="quick-mark-page__level-menu-item"
                            key={lvl}
                            selected={selectedLevel === lvl}
                            onClick={() => handlePickLevel(lvl)}
                        >
                            {difficultyLabel(lvl)}
                        </MenuItem>
                    ))}
                </Menu>
            </Box>

            {/* Legend — what each swipe direction does. */}
            <Box className="quick-mark-page__legend" sx={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 2, px: 2, pb: 0.5 }}>
                <LegendItem className="quick-mark-page__legend-learn-now" direction="left" />
                <LegendItem className="quick-mark-page__legend-mastered" direction="right" />
            </Box>

            <MiniVocabCardGrid
                containerClassName={GRID_CLASS}
                classPrefix="quick-mark"
                loading={loading}
                error={error}
                entries={entries}
                emptyMessage="No unsorted cards at this level. Try another level."
                // Unused: `renderCard` draws the cards, and each one handles its own tap.
                onCardClick={() => {}}
                renderCard={renderCard}
                staggerReveal
                footer={
                    <>
                        {/* Infinite-scroll sentinel (only while more pages exist). */}
                        {hasMore && (
                            <Box
                                ref={sentinelRef}
                                className="quick-mark-page__load-sentinel"
                                sx={{ width: "100%", display: "flex", justifyContent: "center", py: 2 }}
                            >
                                {loadingMore && <DelayedCircularProgress className="quick-mark-page__load-spinner" />}
                            </Box>
                        )}
                        {/* Explicit bottom clearance so the last card row is never hidden
                            behind the floating footer pill. An in-flow spacer is required
                            because the ScrollArea's bottom padding is not honored at
                            scroll-end in this flex + overflow-scroll layout (measured: the
                            last row otherwise overlapped the pill by ~50px). */}
                        <FooterSpacer />
                    </>
                }
            />

            <Snackbar
                key={toast?.seq}
                className="quick-mark-page__toast"
                open={toast !== null}
                autoHideDuration={UNDO_TOAST_MS}
                // Ignore clickaway: a swipe on another card is a "click away", and it
                // would hide the toast that swipe is about to replace anyway.
                onClose={(_e, reason) => { if (reason !== "clickaway") setToast(null); }}
                message={
                    toast?.kind === "undo"
                        ? `${toast.card.entryKey} → ${QUICK_MARK_LABEL[toast.direction]}`
                        : toast?.message
                }
                action={toast?.kind === "undo" ? (
                    <Button
                        className="quick-mark-page__undo-button"
                        size="small"
                        onClick={handleUndo}
                        sx={{ color: COLORS.white, fontSize: SIZE.micro, fontWeight: WEIGHT.bold, textTransform: "lowercase" }}
                    >
                        undo
                    </Button>
                ) : undefined}
                anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
            />

            {/* eip bottom sheet (a tap on a card). SheetPanel's scrim covers the grid
                while it's up, so no card can be swiped mid-read. */}
            <EipSheet
                eip={eip}
                open={eipOpen}
                onClose={() => setEipOpen(false)}
                onSpeak={tts.speak}
                onSpeakSentence={tts.speakSentence}
                speakingKey={tts.speakingKey}
            />
        </NodePage>
    );
};

export default QuickMarkPage;
