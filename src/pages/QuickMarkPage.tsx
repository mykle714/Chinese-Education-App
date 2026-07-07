import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Box, Typography, Button, Chip, Menu, MenuItem, Snackbar } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import NodePage from "../components/NodePage";
import MiniVocabCardGrid from "../components/MiniVocabCardGrid";
import DelayedCircularProgress from "../components/DelayedCircularProgress";
import MinutePointsFireBadge from "../minutePoints/MinutePointsFireBadge";
import { FooterSpacer } from "../components/MobileFooter";
import QuickMarkCard from "../components/QuickMarkCard";
import { type QuickMarkState, nextQuickMarkState } from "../components/quickMarkState";
import { useAuth } from "../AuthContext";
import { API_BASE_URL } from "../constants";
import type { Language, DiscoverCard, VocabEntry } from "../types";
import { usePageTitle } from "../hooks/usePageTitle";
import { COLORS } from "../theme/colors";
import { SIZE, WEIGHT, LEADING, TRACKING } from "../theme/scale";

// QUICK MARK (docs/QUICK_MARK.md) — the Discover hub's bulk-triage grid, the second
// activity (between Sort Cards and Skipped Cards). The user picks a difficulty level,
// sees every not-yet-sorted discoverable word at that level as mini cards ordered by
// vernacular score, taps each to cycle a 3-state mark (empty → Learn Now → Mastered),
// and hits Save to commit them all at once. Persistence reuses the Sort Cards buckets
// verbatim (library / already-learned), so nothing new is stored.
//
// LAYER: page (view). Fetches its own supply + posts the batch save; no shared hook.

// Manual level dropdown — the generalized 1..6 difficulty scale (no "Auto": Quick Mark
// is always a concrete level). Mirrors SortCardsPage's DIFFICULTY_LEVELS.
const DIFFICULTY_LEVELS = [1, 2, 3, 4, 5, 6];

// A card cursor for keyset pagination — the last card's sort-key coordinates. Matches
// the server's ORDER BY (vernacularScore DESC NULLS LAST, id ASC).
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
    const { token, isAuthenticated } = useAuth();
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

    // Guard so the intersection-observer sentinel doesn't fire overlapping loads.
    const loadingMoreRef = useRef(false);

    const authHeaders = useMemo(
        () => ({ "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }),
        [token]
    );

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
            // Relative template string (NOT `new URL(...)`) — API_BASE_URL is "" in the
            // prod build and `new URL("/api/...")` throws with no base (see SortCardsPage).
            const params: string[] = [];
            if (level != null) params.push(`level=${level}`);
            if (cursor) {
                params.push(`cursorId=${cursor.id}`);
                if (cursor.score != null) params.push(`cursorScore=${cursor.score}`);
            }
            const qs = params.length ? `?${params.join("&")}` : "";
            const response = await fetch(`${API_BASE_URL}/api/starter-packs/${language}/quick-mark${qs}`, {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
                credentials: "include",
            });
            if (!response.ok) throw new Error(`quick-mark fetch failed: ${response.status}`);
            const data: { cards: DiscoverCard[]; level: number; hasMore: boolean } = await response.json();
            setHasMore(data.hasMore);
            if (reset) {
                setCards(data.cards);
                setMarks({});
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
    }, [language, token]);

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
        loadPage(selectedLevel, { score: last.vernacularScore ?? null, id: last.id }, false);
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

    // Save = reconcile every touched card to its on-screen mark in one request. Cards
    // stay in view afterward (their last chance to undo — docs §6); the page is NOT
    // refetched, so already-loaded cards keep their positions.
    const handleSave = useCallback(async () => {
        // Re-entrancy guard lives here (not on the button's `disabled`) so the Save
        // button never greys out — it must always look pressable, since the user may
        // want to Clear a previous save and re-save that empty state (deleting the
        // vet rows). A concurrent tap while a save is in flight is simply ignored.
        if (saving) return;
        const payload = Object.entries(marks).map(([cardId, state]) => ({ cardId: Number(cardId), state }));
        if (payload.length === 0) return;
        setSaving(true);
        try {
            const response = await fetch(`${API_BASE_URL}/api/starter-packs/quick-mark-batch`, {
                method: "POST",
                headers: authHeaders,
                credentials: "include",
                body: JSON.stringify({ language, marks: payload }),
            });
            if (!response.ok) throw new Error(`quick-mark-batch failed: ${response.status}`);
            await response.json();
            setSavedToast(true);
        } catch (err) {
            console.error("Error saving quick marks:", err);
            setError("Failed to save. Please try again.");
        } finally {
            setSaving(false);
        }
    }, [saving, marks, authHeaders, language]);

    // MiniVocabCardGrid takes VocabEntry[]; a DiscoverCard supplies everything the
    // Quick Mark card reads (id + entryKey + definition + pronunciation + vernacularScore
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
                        sx={{ minWidth: "unset", px: 1.25, py: 0.25, height: "30px", fontSize: SIZE.micro, textTransform: "lowercase", lineHeight: LEADING.normal, borderRadius: "6px", backgroundColor: COLORS.greenMain, "&:hover": { backgroundColor: COLORS.greenMain } }}
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
