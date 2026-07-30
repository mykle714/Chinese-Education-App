import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Box, Typography, Button, Chip, Menu, MenuItem, Snackbar } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import NodePage from "../../components/NodePage";
import MiniVocabCardGrid from "../../components/MiniVocabCardGrid";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import MinutePointsFireBadge from "../../minutePoints/MinutePointsFireBadge";
import { FooterSpacer } from "../../components/MobileFooter";
import QuickMarkCard from "../../components/QuickMarkCard";
import { type QuickMarkState, nextQuickMarkState } from "../../components/quickMarkState";
import { useAuth } from "../../AuthContext";
import { fetchQuickMarkPage, saveQuickMarks } from "./starterPacksApi";
import type { Language, DiscoverCard, VocabEntry } from "../../types";
import { usePageTitle } from "../../hooks/usePageTitle";
import { COLORS } from "../../theme/colors";
import { SIZE, WEIGHT, LEADING, TRACKING } from "../../theme/scale";

// QUICK MARK (docs/QUICK_MARK.md) — the Discover hub's bulk-triage grid, the second
// activity (between Sort Cards and Skipped Cards). The user picks a difficulty level,
// sees every not-yet-sorted discoverable word at that level as mini cards ordered by
// frequency score, taps each to cycle a 3-state mark (empty → Learn Now → Mastered),
// and hits Save to commit them all at once. Persistence reuses the Sort Cards buckets
// verbatim (library / already-learned), so nothing new is stored.
//
// LAYER: page (view). Fetches its own supply + posts the batch save; no shared hook.

// Manual level dropdown — the generalized 1..6 difficulty scale (no "Auto": Quick Mark
// is always a concrete level). Mirrors SortCardsPage's DIFFICULTY_LEVELS.
const DIFFICULTY_LEVELS = [1, 2, 3, 4, 5, 6];

// A card cursor for keyset pagination — the last card's sort-key coordinates. Matches
// the server's ORDER BY (frequencyScore DESC NULLS LAST, id ASC).
interface QuickMarkCursor {
    score: number | null;
    id: number;
}

// One legend swatch (matches the card's 18px corner badges).
const LegendItem: React.FC<{ swatch: React.ReactNode; label: string; className: string }> = ({ swatch, label, className }) => (
    <Box className={className} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        {swatch}
        <Typography sx={{ fontSize: SIZE.micro, color: COLORS.textSecondary }}>{label}</Typography>
    </Box>
);

const QuickMarkPage: React.FC = () => {
    usePageTitle("Quick Mark");
    const navigate = useNavigate();
    const { isAuthenticated } = useAuth();
    const { language } = useParams<{ language: Language }>();

    // The chosen level. `null` before the first fetch seeds it from the server's
    // adaptive-frontier estimate; thereafter it is a concrete 1..6 the user can change.
    const [selectedLevel, setSelectedLevel] = useState<number | null>(null);
    const [levelMenuAnchor, setLevelMenuAnchor] = useState<HTMLElement | null>(null);

    const [cards, setCards] = useState<DiscoverCard[]>([]);
    // Per-card mark, keyed by det id. Only cards the user has TAPPED appear here; a card
    // absent from the map is `empty`. Save sends every entry (empty → delete/no-op).
    const [marks, setMarks] = useState<Record<number, QuickMarkState>>({});
    const [loading, setLoading] = useState(true);        // initial page
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [savedToast, setSavedToast] = useState(false);
    // Snapshot of `marks` as of the last successful save (empty on a fresh/reset load).
    // The Save button is enabled (green) only while `marks` differs from this baseline;
    // saving re-baselines it, so tracking restarts from the just-saved state.
    const [savedMarks, setSavedMarks] = useState<Record<number, QuickMarkState>>({});

    // Guard so the intersection-observer sentinel doesn't fire overlapping loads.
    const loadingMoreRef = useRef(false);

    const difficultyLabel = useCallback(
        (lvl: number) => (language === "zh" ? `HSK ${lvl}` : `Level ${lvl}`),
        [language]
    );

    // Load a page. `reset` (level change / mount) replaces the grid and clears marks;
    // otherwise the page is appended via the keyset cursor (last card's score+id).
    const loadPage = useCallback(async (level: number | null, cursor: QuickMarkCursor | null, reset: boolean) => {
        if (reset) setLoading(true);
        else { setLoadingMore(true); loadingMoreRef.current = true; }
        setError(null);
        try {
            const data = await fetchQuickMarkPage(language as Language, level, cursor);
            setHasMore(data.hasMore);
            if (reset) {
                setCards(data.cards);
                setMarks({});
                setSavedMarks({}); // fresh session → nothing pending, Save starts grey
                setSelectedLevel(data.level); // seed (mount) or confirm (user pick)
            } else {
                // De-dupe defensively in case a concurrent save shifted the window.
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
    // load effect and wipe in-progress marks).
    }, [language]);

    // Initial load (mount / language change / auth settle). Keyed on isAuthenticated,
    // NOT token — a silent token refresh must not reload the page mid-triage and wipe
    // the user's in-progress marks (CLAUDE.md "Never reload on token refresh").
    useEffect(() => {
        if (language) loadPage(null, null, true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [language, isAuthenticated]);

    // User picks a concrete level from the dropdown → fresh session at that level.
    const handlePickLevel = useCallback((lvl: number) => {
        setLevelMenuAnchor(null);
        if (lvl === selectedLevel) return;
        setSelectedLevel(lvl);
        loadPage(lvl, null, true);
    }, [selectedLevel, loadPage]);

    // Load the next page after the last-shown card (keyset cursor).
    const loadMore = useCallback(() => {
        if (loadingMoreRef.current || !hasMore || cards.length === 0) return;
        const last = cards[cards.length - 1];
        loadPage(selectedLevel, { score: last.frequencyScore ?? null, id: last.id }, false);
    }, [hasMore, cards, selectedLevel, loadPage]);

    // Cycle one card's mark on tap. Functional update so onCycle stays referentially
    // stable (the memoized cards only re-render for the tapped id).
    const handleCycle = useCallback((cardId: number) => {
        setMarks((prev) => ({ ...prev, [cardId]: nextQuickMarkState(prev[cardId] ?? "empty") }));
    }, []);

    // Clear = reset every marked card to empty (docs §6). Only cards the user has
    // TOUCHED are reset (untouched cards already render empty and have no vet row), and
    // we keep them in the map as explicit `empty` rather than deleting the keys — so a
    // subsequent Save deletes any vet row a prior Save created for them. This keeps the
    // Save payload proportional to what the user actually did, not the whole loaded page.
    const handleClear = useCallback(() => {
        setMarks((prev) => {
            const next: Record<number, QuickMarkState> = {};
            for (const id of Object.keys(prev)) next[Number(id)] = "empty";
            return next;
        });
    }, []);

    // Are there unsaved changes? Compare the current marks against the last-saved
    // baseline over the union of both key sets, treating a missing key as `empty` —
    // so a card cycled all the way back to empty (or cleared after a save that left it
    // empty) correctly reads as "no change", while a Clear that undoes a saved mark
    // reads as dirty (it still needs a save to delete the vet row).
    const isDirty = useMemo(() => {
        const ids = new Set([...Object.keys(marks), ...Object.keys(savedMarks)]);
        for (const id of ids) {
            const key = Number(id);
            if ((marks[key] ?? "empty") !== (savedMarks[key] ?? "empty")) return true;
        }
        return false;
    }, [marks, savedMarks]);

    // Save = reconcile every touched card to its on-screen mark in one request. Cards
    // stay in view afterward (their last chance to undo — docs §6); the page is NOT
    // refetched, so already-loaded cards keep their positions.
    const handleSave = useCallback(async () => {
        // Re-entrancy guard: a concurrent tap while a save is in flight is ignored.
        // (The button is also disabled while `saving`, but keep the guard for safety.)
        if (saving || !isDirty) return;
        // Snapshot the marks being committed — `marks` can change mid-flight, and the
        // baseline must reflect exactly what the server received, not the later state.
        const snapshot = marks;
        const payload = Object.entries(snapshot).map(([cardId, state]) => ({ cardId: Number(cardId), state }));
        if (payload.length === 0) return;
        setSaving(true);
        try {
            await saveQuickMarks(language as Language, payload);
            setSavedMarks(snapshot); // re-baseline → Save goes back to grey
            setSavedToast(true);
        } catch (err) {
            console.error("Error saving quick marks:", err);
            setError("Failed to save. Please try again."); // baseline untouched → stays green for a retry
        } finally {
            setSaving(false);
        }
    }, [saving, isDirty, marks, language]);

    // MiniVocabCardGrid takes VocabEntry[]; a DiscoverCard supplies everything the
    // Quick Mark card reads (id + entryKey + definition + pronunciation + frequencyScore
    // + iconId). Stable per `cards` so the grid's incremental reveal doesn't thrash.
    const entries = useMemo(() => cards as unknown as VocabEntry[], [cards]);
    const cardById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);

    const renderCard = useCallback(
        (entry: VocabEntry, _index: number, animationDelayMs?: number) => {
            const card = cardById.get(entry.id);
            if (!card) return null;
            return (
                <QuickMarkCard
                    key={card.id}
                    card={card}
                    state={marks[card.id] ?? "empty"}
                    onCycle={handleCycle}
                    animationDelayMs={animationDelayMs}
                />
            );
        },
        [cardById, marks, handleCycle]
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
            activePage="discover"
            onBack={() => navigate("/discover")}
            contentClassName="quick-mark-page__content"
            contentSx={{ alignItems: "center" }}
            headerExtraActions={
                <>
                    <Button
                        className="quick-mark-page__clear-button"
                        variant="text"
                        size="small"
                        onClick={handleClear}
                        disabled={cards.length === 0}
                        sx={{ minWidth: "unset", px: 1, py: 0.25, height: "30px", fontSize: SIZE.micro, textTransform: "lowercase", lineHeight: LEADING.normal, borderRadius: "6px", color: COLORS.onSurface }}
                    >
                        clear
                    </Button>
                    <Button
                        className="quick-mark-page__save-button"
                        variant="contained"
                        size="small"
                        onClick={handleSave}
                        // Grey + unpressable with nothing pending; green once the marks
                        // diverge from the last-saved baseline, back to grey after saving.
                        disabled={!isDirty || saving}
                        sx={{
                            minWidth: "unset", px: 1.25, py: 0.25, height: "30px", fontSize: SIZE.micro,
                            textTransform: "lowercase", lineHeight: LEADING.normal, borderRadius: "6px",
                            backgroundColor: COLORS.greenMain,
                            "&:hover": { backgroundColor: COLORS.greenMain },
                            "&.Mui-disabled": { backgroundColor: COLORS.card, color: COLORS.textSecondary },
                        }}
                    >
                        save
                    </Button>
                    <MinutePointsFireBadge />
                </>
            }
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
                    sx={{ backgroundColor: COLORS.hskChip, color: "white", fontSize: SIZE.micro, fontWeight: WEIGHT.bold, letterSpacing: TRACKING.caps, cursor: "pointer" }}
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

            {/* Legend — the three tap states */}
            <Box className="quick-mark-page__legend" sx={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 1.5, px: 2, pb: 0.5 }}>
                <LegendItem
                    className="quick-mark-page__legend-empty"
                    label="Skip"
                    swatch={<Box sx={{ width: 16, height: 16, borderRadius: "50%", border: `2px solid ${COLORS.border}` }} />}
                />
                <LegendItem
                    className="quick-mark-page__legend-library"
                    label="Add to Learn Now"
                    swatch={<Box sx={{ width: 16, height: 16, borderRadius: "50%", backgroundColor: COLORS.greenMain, display: "flex", alignItems: "center", justifyContent: "center" }}><CheckIcon sx={{ fontSize: 11, color: "white" }} /></Box>}
                />
                <LegendItem
                    className="quick-mark-page__legend-mastered"
                    label="Mastered"
                    swatch={<Box sx={{ width: 16, height: 16, borderRadius: "50%", backgroundColor: COLORS.blueMain, color: "white", fontSize: 10, fontWeight: WEIGHT.bold, display: "flex", alignItems: "center", justifyContent: "center" }}>M</Box>}
                />
            </Box>

            <MiniVocabCardGrid
                containerClassName="quick-mark-cards-preview"
                classPrefix="quick-mark"
                loading={loading}
                error={error}
                entries={entries}
                emptyMessage="No unsorted cards at this level. Try another level."
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
                className="quick-mark-page__saved-toast"
                open={savedToast}
                autoHideDuration={2000}
                onClose={() => setSavedToast(false)}
                message="Saved"
                anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
            />
        </NodePage>
    );
};

export default QuickMarkPage;
