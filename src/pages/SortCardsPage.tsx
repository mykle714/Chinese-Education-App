import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Box, Typography, IconButton, Button, Chip } from "@mui/material";
import DelayedCircularProgress from "../components/DelayedCircularProgress";
import { styled } from "@mui/material/styles";
import UndoIcon from "@mui/icons-material/Undo";
import { useDrag } from "@use-gesture/react";
import { useSpring, animated } from "@react-spring/web";
import NodePage from "../components/NodePage";
import MinutePointsFireBadge from "../minutePoints/MinutePointsFireBadge";
import ForeignText from "../components/ForeignText";
import PosBadge from "../components/PosBadge";
import SegmentedSentenceDisplay from "../components/SegmentedSentenceDisplay";
import { API_BASE_URL } from "../constants";
import { stripParentheses } from "../utils/definitionUtils";
import type { Language, DiscoverCard, SortPack, DiscoverFetchResponse, DiscoverNextPackResponse } from "../types";
import { usePageTitle } from "../hooks/usePageTitle";
import { useAuth } from "../AuthContext";
import { useTTS } from "../hooks/useTTS";
import { useDiscoverSettings } from "../hooks/useDiscoverSettings";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { SIZE, WEIGHT, LEADING, TRACKING } from "../theme/scale";

// The on-deck unit is now a SORT PACK (docs/SORT_CARDS_REQUIREMENTS.md §4.5): a sentence
// band + up to 3 draggable cards. The client holds a short FIFO queue of PACKS (target
// 2: on-deck + buffer). The server owns all selection/leveling; the client renders the
// head pack, sorts its cards one at a time, and asks for one replacement pack when a
// pack completes. Skip is a de-emphasized header button (not a drag target). Undo
// reverses one card action at a time (sort OR skip), 3 deep.

const UNDO_DEPTH = 3;

// Drag destinations (Skip is intentionally NOT here — §5.1).
interface BucketZone {
    id: "library" | "already-learned";
    label: string;
    mainColor: string;
    accentColor: string;
}

// A recorded card action, kept so Undo can reverse it and (if the pack has advanced)
// bring the pack back on deck. `pack` is the full pack the card belonged to.
interface UndoEntry {
    action: "sort" | "skip";
    cardId: number;
    bucket: string; // 'library' | 'already-learned' | 'skip'
    pack: SortPack;
}

const ContentArea = styled(Box)({
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    alignSelf: "stretch",
    overflow: "visible",
    userSelect: "none",
    WebkitUserSelect: "none",
    touchAction: "none",
});

// The two destination buckets, laid out evenly across the top. A definite height lets
// each bucket resolve its `height: 100%` while keeping the card aspect ratio (below).
const BucketsContainer = styled(Box)({
    width: "100%",
    flex: 1, // absorb the page's spare vertical space (and yield it back on short screens)
    minHeight: 0,
    containerType: "size", // establishes cqw/cqh for the buckets' "contain" sizing (below)
    paddingTop: 0,
    paddingBottom: 12,
    // No horizontal padding: it would be added on top of the two outer `space-evenly`
    // gaps, making the side margins larger than the middle. Zero padding keeps all three
    // gaps equal (the min-width cqw math still reserves room via the `- 8px` term).
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-evenly", // even spacing before / between / after the two buckets
    alignItems: "center",
});

const Bucket = styled(Box)<{ mainColor: string; accentColor: string; highlight?: boolean }>(
    ({ mainColor, accentColor, highlight }) => ({
        // Card-shaped drop targets that keep the 136:200 card aspect ratio in EVERY
        // regime. Width is the largest value that fits BOTH constraints — half the
        // container width (minus half the 16px gap) AND the full container height mapped
        // back through the ratio — i.e. a true "contain" fit. Height then follows from
        // aspect-ratio. So the buckets grow to fill tall screens and shrink on short
        // ones, always card-shaped, never overflowing or colliding. Uses the container
        // query units established by BucketsContainer's `containerType: size`.
        aspectRatio: "136 / 200",
        width: "min(calc(50cqw - 8px), calc(100cqh * 136 / 200))",
        minWidth: 0,
        padding: 8,
        backgroundColor: mainColor,
        borderRadius: 12,
        boxShadow: "1px 4px 4px rgba(0, 0, 0, 0.25)",
        opacity: highlight ? 0.9 : 0.23,
        transition: "opacity 0.2s ease-in-out, transform 0.2s ease-in-out",
        transform: highlight ? "scale(1.05)" : "scale(1)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        "& .bucket-inner": {
            width: "100%",
            height: "100%",
            backgroundColor: accentColor,
            borderRadius: 4,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 8,
        },
        "& .bucket-text": {
            fontSize: SIZE.caption,
            fontWeight: WEIGHT.regular,
            lineHeight: LEADING.tight,
            textAlign: "center",
            color: COLORS.onSurface,
            fontFamily: FONTS.sans,
            letterSpacing: TRACKING.caps,
        },
    })
);

// The pack's sentence — its OWN dedicated band: a full-width, solid, opaque strip
// sized to its CONTENT only (never flex-filling), so it stays compact and hands the
// spare vertical space to the buckets above. Sits just above the card tray.
const SentenceSection = styled(Box)({
    width: "100%",
    flex: "0 0 auto",
    padding: "14px 18px",
    backgroundColor: COLORS.sectionCard,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
});

// The up-to-3 draggable cards. Shrinks to fit its contents (does NOT flex-fill the
// remaining space); it sits at the bottom because BucketsContainer above it flex-fills.
// Extra bottom padding lifts the card row clear of the floating footer pill.
const OnDeckSection = styled(Box)({
    width: "100%",
    flex: "0 0 auto",
    paddingTop: "8px",
    paddingBottom: "20px",
    borderTop: `2px dashed ${COLORS.border}`,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
});

// Holds the up-to-3 cards side by side; wraps on very narrow frames.
const CardsRow = styled(Box)({
    width: "100%",
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingInline: 8,
});

const AnimatedBox = animated(Box);

const CardShell = styled(AnimatedBox)<{ locked?: boolean }>(({ locked }) => ({
    position: "relative",
    aspectRatio: "136 / 200",
    height: 150,
    maxHeight: "100%",
    maxWidth: "31%",
    backgroundColor: COLORS.card,
    borderRadius: 12,
    boxShadow: "2px 4px 4px rgba(0, 0, 0, 0.25)",
    padding: 10,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    cursor: locked ? "default" : "grab",
    touchAction: "none",
    opacity: locked ? 0.55 : 1,
    "&:active": { cursor: locked ? "default" : "grabbing" },
}));

// Occupies the exact footprint of a card that has been sorted away this session, so
// the remaining on-deck cards keep their positions instead of the flex row
// re-centering (docs/SORT_CARDS_REQUIREMENTS.md §4.5). Invisible + non-interactive.
const CardSlotPlaceholder = styled(Box)({
    aspectRatio: "136 / 200",
    height: 150,
    maxHeight: "100%",
    maxWidth: "31%",
    flex: "0 0 auto",
    visibility: "hidden",
    pointerEvents: "none",
});

// Diagonal "sorted!" watermark over a card already in the user's library.
const SortedWatermark = styled(Box)({
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
    "& span": {
        transform: "rotate(-20deg)",
        fontSize: SIZE.caption,
        fontWeight: WEIGHT.bold,
        letterSpacing: TRACKING.caps,
        textTransform: "uppercase",
        color: COLORS.redMain,
        border: `2px solid ${COLORS.redMain}`,
        borderRadius: 6,
        padding: "2px 8px",
        opacity: 0.85,
    },
});

/**
 * One draggable (or locked) card within the on-deck pack. Owns its own drag spring so
 * the three cards move independently. On drop into a bucket it animates out and calls
 * `onSort`; locked cards (already in the library) show a "sorted!" watermark and don't
 * drag.
 */
const DraggableCard: React.FC<{
    card: DiscoverCard;
    locked: boolean;
    onCheckCollision: (clientX: number, clientY: number) => string | null;
    onHighlight: (bucketId: string | null) => void;
    onSort: (cardId: number, bucketId: string) => void;
    onFirstDrag: () => void;
}> = ({ card, locked, onCheckCollision, onHighlight, onSort, onFirstDrag }) => {
    const [{ x, y, scale, opacity }, api] = useSpring(() => ({ x: 0, y: 0, scale: 1, opacity: 1 }));

    // Entrance: slide up + fade in when the card first mounts (new pack / brought back).
    useEffect(() => {
        api.set({ x: 0, y: 24, scale: 1, opacity: 0 });
        api.start({ y: 0, opacity: 1, config: { tension: 280, friction: 26 } });
    }, [api]);

    const bind = useDrag(
        ({ first, down, movement: [mx, my], xy: [px, py] }) => {
            if (locked) return;
            if (first) onFirstDrag();
            api.start({ x: down ? mx : 0, y: down ? my : 0, scale: down ? 1.1 : 1, immediate: down });
            const bucketId = onCheckCollision(px, py);
            if (down) {
                onHighlight(bucketId);
            } else {
                onHighlight(null);
                if (bucketId) {
                    // Animate the card out, then commit the sort.
                    api.start({ opacity: 0, scale: 0.8, config: { tension: 150, friction: 35 } });
                    onSort(card.id, bucketId);
                }
            }
        },
        { filterTaps: true }
    );

    return (
        <CardShell
            className="sort-cards__flash-card"
            locked={locked}
            {...(locked ? {} : bind())}
            style={{ x, y, scale, opacity, zIndex: 1000 }}
        >
            {card.iconId && (
                <Box
                    component="img"
                    className="sort-cards__card-icon"
                    src={`${API_BASE_URL}/api/icons8/${encodeURIComponent(card.iconId)}/image`}
                    alt=""
                    draggable={false}
                    sx={{ width: 44, height: 44, objectFit: "contain", pointerEvents: "none" }}
                />
            )}
            <Box className="sort-cards__card-key-group" sx={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <ForeignText size="sm" className="sort-cards__card-key" text={card.entryKey} pronunciation={card.pronunciation} />
                <PosBadge pos={card.pos} hasMultiplePos={card.hasMultiplePos} />
            </Box>
            <Typography
                className="sort-cards__card-value"
                sx={{
                    fontSize: SIZE.micro,
                    fontWeight: WEIGHT.regular,
                    textAlign: "center",
                    width: "100%",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                }}
            >
                {stripParentheses(card.definition)}
            </Typography>
            {locked && (
                <SortedWatermark className="sort-cards__sorted-watermark">
                    <span>sorted!</span>
                </SortedWatermark>
            )}
        </CardShell>
    );
};

const SortCardsPage: React.FC = () => {
    usePageTitle("Discover");
    const navigate = useNavigate();
    const { token } = useAuth();
    const { language } = useParams<{ language: Language }>();
    const tts = useTTS();
    const { settings: discoverSettings, update: updateDiscoverSettings } = useDiscoverSettings();
    const audioUnlockedRef = useRef(false);

    // FIFO queue of PACKS. queue[0] is the on-deck pack; the rest is the buffer.
    const [queue, setQueue] = useState<SortPack[]>([]);
    // Cards resolved (sorted or skipped) this session, per packKey → set of cardIds.
    // Drives which cards are still draggable; survives advancing so Undo can restore.
    // `doneRef` is the authoritative copy read by handlers (so rapid successive sorts
    // don't race on a stale `done` closure); `done` state exists only to trigger renders.
    const [done, setDone] = useState<Record<string, Set<number>>>({});
    const doneRef = useRef<Record<string, Set<number>>>({});
    const [exhausted, setExhausted] = useState(false);
    const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [highlightedBucket, setHighlightedBucket] = useState<string | null>(null);
    const [level, setLevel] = useState<number | null>(null);

    const bucketRefs = useRef<Map<string, HTMLElement>>(new Map());

    const buckets = useMemo<BucketZone[]>(() => [
        { id: "library", label: "Add to\nLearn Now", mainColor: COLORS.redMain, accentColor: COLORS.redAccent },
        { id: "already-learned", label: "Already Learned", mainColor: COLORS.blueMain, accentColor: COLORS.blueAccent },
    ], []);

    const authHeaders = useMemo(
        () => ({ "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }),
        [token]
    );

    // Initial pack queue.
    useEffect(() => {
        const fetchPacks = async () => {
            try {
                const response = await fetch(`${API_BASE_URL}/api/starter-packs/${language}`, {
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                    credentials: "include",
                });
                if (response.ok) {
                    const data: DiscoverFetchResponse = await response.json();
                    setQueue(data.packs);
                    setExhausted(data.exhausted);
                    if (typeof data.level === "number") setLevel(data.level);
                } else {
                    console.error("Failed to fetch starter packs");
                }
            } catch (error) {
                console.error("Error fetching packs:", error);
            } finally {
                setLoading(false);
            }
        };
        if (language) fetchPacks();
    }, [language, token]);

    const currentPack = queue[0];
    const doneForCurrent = currentPack ? done[currentPack.packKey] : undefined;

    const levelLabel = level == null ? null : (language === "zh" ? `HSK ${level}` : `Level ${level}`);

    // Narrate the on-deck pack's sentence (or first card) when it changes.
    useEffect(() => {
        if (!tts.enabled || !discoverSettings.autoplay || !currentPack) return;
        const text = currentPack.sentence?.foreignText ?? currentPack.cards[0]?.entryKey;
        if (text) tts.speakSentence(text);
        return () => tts.cancel();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentPack?.packKey, tts.enabled, discoverSettings.autoplay]);

    // DOM collision test: is the pointer over a bucket?
    const checkBucketCollision = useCallback((clientX: number, clientY: number): string | null => {
        for (const [id, el] of bucketRefs.current) {
            if (!el) continue;
            const r = el.getBoundingClientRect();
            if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return id;
        }
        return null;
    }, []);

    const unlockAudioOnce = useCallback(() => {
        if (!audioUnlockedRef.current) {
            audioUnlockedRef.current = true;
            tts.unlockAudio();
        }
    }, [tts]);

    // Advance past a completed pack: drop the head and refill the tail with one pack,
    // excluding the packKeys we still hold so the replacement is never a duplicate.
    const advancePack = useCallback(async (completedKey: string) => {
        const rest = queue.filter((p) => p.packKey !== completedKey);
        setQueue(rest);
        try {
            const response = await fetch(`${API_BASE_URL}/api/starter-packs/next-pack`, {
                method: "POST",
                headers: authHeaders,
                credentials: "include",
                body: JSON.stringify({ language, excludePackKeys: rest.map((p) => p.packKey) }),
            });
            if (!response.ok) throw new Error(`next-pack failed: ${response.status}`);
            const data: DiscoverNextPackResponse = await response.json();
            setExhausted(data.exhausted);
            if (typeof data.level === "number") setLevel(data.level);
            if (data.nextPack) {
                const next = data.nextPack;
                setQueue((prev) => (prev.some((p) => p.packKey === next.packKey) ? prev : [...prev, next]));
            }
        } catch (error) {
            console.error("Error fetching next pack:", error);
        }
    }, [queue, authHeaders, language]);

    // doneRef helpers — the authoritative resolved-card store. Mutations mirror into
    // `done` state to re-render. Reading from the ref (not the `done` closure) is what
    // makes rapid successive sorts race-free.
    const markResolved = useCallback((packKey: string, cardIds: number[]) => {
        const set = new Set(doneRef.current[packKey] ?? []);
        cardIds.forEach((id) => set.add(id));
        doneRef.current = { ...doneRef.current, [packKey]: set };
        setDone(doneRef.current);
    }, []);
    const unmarkResolved = useCallback((packKey: string, cardId: number) => {
        const set = new Set(doneRef.current[packKey] ?? []);
        set.delete(cardId);
        doneRef.current = { ...doneRef.current, [packKey]: set };
        setDone(doneRef.current);
    }, []);
    const isResolved = useCallback((packKey: string, cardId: number) => doneRef.current[packKey]?.has(cardId) === true, []);
    // A pack is complete when every card is either pre-sorted (locked) or resolved now.
    const isPackComplete = useCallback(
        (pack: SortPack) => pack.cards.every((c) => c.sorted || isResolved(pack.packKey, c.id)),
        [isResolved]
    );

    const pushUndo = useCallback((entry: UndoEntry) => {
        setUndoStack((prev) => [...prev, entry].slice(-UNDO_DEPTH));
    }, []);

    // Sort one card into a bucket (per-card POST). Optimistic: resolve locally first,
    // then decide (from the ref) whether that completed the pack.
    const handleSortCard = useCallback(async (cardId: number, bucketId: string) => {
        const pack = currentPack;
        if (!pack) return;
        pushUndo({ action: "sort", cardId, bucket: bucketId, pack });
        markResolved(pack.packKey, [cardId]);
        // Now (after marking) — did this sort finish the pack? → mark authored pack seen + advance.
        const lastInPack = isPackComplete(pack);
        if (lastInPack) advancePack(pack.packKey);

        try {
            const response = await fetch(`${API_BASE_URL}/api/starter-packs/sort`, {
                method: "POST",
                headers: authHeaders,
                credentials: "include",
                body: JSON.stringify({ cardId, bucket: bucketId, language, packId: pack.packId, lastInPack }),
            });
            if (!response.ok) throw new Error(`sort failed: ${response.status}`);
            const data = await response.json();
            if (typeof data.level === "number") setLevel(data.level);
        } catch (error) {
            console.error("Error sorting card:", error);
        }
    }, [currentPack, pushUndo, markResolved, isPackComplete, advancePack, authHeaders, language]);

    // Skip the whole on-deck pack: defer every remaining unsorted card at once.
    const handleSkipPack = useCallback(async () => {
        const pack = currentPack;
        if (!pack) return;
        const toSkip = pack.cards.filter((c) => !c.sorted && !isResolved(pack.packKey, c.id));
        if (toSkip.length === 0) return;

        // Enqueue one undo action per skipped card (Undo reverses them one at a time).
        for (const c of toSkip) pushUndo({ action: "skip", cardId: c.id, bucket: "skip", pack });
        markResolved(pack.packKey, toSkip.map((c) => c.id));
        advancePack(pack.packKey);

        try {
            const response = await fetch(`${API_BASE_URL}/api/starter-packs/skip-pack`, {
                method: "POST",
                headers: authHeaders,
                credentials: "include",
                body: JSON.stringify({ cardIds: toSkip.map((c) => c.id), language, packId: pack.packId }),
            });
            if (!response.ok) throw new Error(`skip-pack failed: ${response.status}`);
        } catch (error) {
            console.error("Error skipping pack:", error);
        }
    }, [currentPack, isResolved, pushUndo, markResolved, advancePack, authHeaders, language]);

    // Undo the most recent card action (sort or skip). Un-resolves the card and, if its
    // pack has advanced off-deck, brings the pack back on deck.
    const handleUndo = useCallback(async () => {
        const entry = undoStack[undoStack.length - 1];
        if (!entry) return;
        setUndoStack((prev) => prev.slice(0, -1));

        unmarkResolved(entry.pack.packKey, entry.cardId);
        // Bring the undone pack back to the FRONT so it is on deck again. It may already
        // be the head (undoing a card within the on-deck pack — leave the queue as-is),
        // or it may still be sitting in the buffer (the server can re-serve a just-sorted
        // pack when the pool is small); in the latter case we must MOVE it to the front,
        // not skip it because it happens to exist somewhere in the queue.
        setQueue((prev) => {
            if (prev[0]?.packKey === entry.pack.packKey) return prev;
            const without = prev.filter((p) => p.packKey !== entry.pack.packKey);
            return [entry.pack, ...without];
        });
        setExhausted(false);

        try {
            await fetch(`${API_BASE_URL}/api/starter-packs/undo`, {
                method: "POST",
                headers: authHeaders,
                credentials: "include",
                body: JSON.stringify({ cardId: entry.cardId, bucket: entry.bucket, language, packId: entry.pack.packId }),
            });
        } catch (error) {
            console.error("Error undoing action:", error);
        }
    }, [undoStack, unmarkResolved, authHeaders, language]);

    if (loading) {
        return (
            <NodePage title="Sort Cards" activePage="discover" onBack={() => navigate("/discover")} scrollable={false} headerExtraActions={<MinutePointsFireBadge />}>
                <Box className="sort-cards__loading-wrapper" sx={{ display: "flex", flex: 1, justifyContent: "center", alignItems: "center" }}>
                    <DelayedCircularProgress className="sort-cards__spinner" />
                </Box>
            </NodePage>
        );
    }

    if (!currentPack) {
        return (
            <NodePage title="Sort Cards" activePage="discover" onBack={() => navigate("/discover")} scrollable={false} headerExtraActions={<MinutePointsFireBadge />}>
                <ContentArea className="sort-cards__content">
                    <Box className="sort-cards__no-cards-error" sx={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center" }}>
                        {exhausted
                            ? <Typography className="sort-cards__no-cards-error-text">Error: no cards found</Typography>
                            : <DelayedCircularProgress className="sort-cards__spinner" />}
                    </Box>
                </ContentArea>
            </NodePage>
        );
    }

    return (
        <NodePage
            title="Sort Cards"
            activePage="discover"
            onBack={() => navigate("/discover")}
            scrollable={false}
            headerExtraActions={
                <>
                    <Button
                        className="sort-cards__autoplay-toggle"
                        variant={discoverSettings.autoplay ? "contained" : "text"}
                        size="small"
                        onClick={() => updateDiscoverSettings({ autoplay: !discoverSettings.autoplay })}
                        aria-pressed={discoverSettings.autoplay}
                        sx={{
                            minWidth: "unset", px: 1, py: 0.25, height: "30px",
                            fontSize: SIZE.micro, textTransform: "lowercase", lineHeight: LEADING.normal,
                            borderRadius: "6px", color: COLORS.onSurface,
                            backgroundColor: discoverSettings.autoplay ? COLORS.card : "transparent",
                            "&:hover": { backgroundColor: discoverSettings.autoplay ? COLORS.card : "transparent" },
                        }}
                    >
                        autoplay
                    </Button>
                    {/* Skip — de-emphasized (§5.1): a small header action, not a drag bucket.
                        Defers every remaining unsorted card in the on-deck pack. */}
                    <Button
                        className="sort-cards__skip-button"
                        variant="text"
                        size="small"
                        onClick={handleSkipPack}
                        sx={{
                            minWidth: "unset", px: 1, py: 0.25, height: "30px",
                            fontSize: SIZE.micro, textTransform: "lowercase", lineHeight: LEADING.normal,
                            borderRadius: "6px", color: COLORS.onSurface,
                        }}
                    >
                        skip
                    </Button>
                    <IconButton
                        className="sort-cards__undo-button"
                        onClick={handleUndo}
                        size="small"
                        disabled={undoStack.length === 0}
                        sx={{ color: COLORS.onSurface }}
                    >
                        <UndoIcon className="sort-cards__undo-icon" />
                    </IconButton>
                    <MinutePointsFireBadge />
                </>
            }
        >
            <Box
                className="sort-cards__level-bar"
                sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 40, px: 2, py: 0.5 }}
            >
                {levelLabel && (
                    <Chip
                        className="sort-cards__level-chip"
                        label={levelLabel}
                        size="small"
                        sx={{ backgroundColor: COLORS.hskChip, color: "white", fontSize: SIZE.micro, fontWeight: WEIGHT.bold, letterSpacing: TRACKING.caps }}
                    />
                )}
            </Box>

            <ContentArea className="sort-cards__content">
                {/* Destination buckets */}
                <BucketsContainer className="sort-cards__buckets-container">
                    {buckets.map((bucket) => (
                        <Bucket
                            className="sort-cards__bucket"
                            key={bucket.id}
                            ref={(el: HTMLElement | null) => {
                                if (el) bucketRefs.current.set(bucket.id, el);
                                else bucketRefs.current.delete(bucket.id);
                            }}
                            mainColor={bucket.mainColor}
                            accentColor={bucket.accentColor}
                            highlight={highlightedBucket === bucket.id}
                        >
                            <div className="bucket-inner">
                                <div className="bucket-text">{bucket.label}</div>
                            </div>
                        </Bucket>
                    ))}
                </BucketsContainer>

                {/* Sentence — a compact solid band just above the card tray */}
                {currentPack.sentence && (
                    <SentenceSection className="sort-cards__sentence-section">
                        <SegmentedSentenceDisplay
                            className="sort-cards__sentence"
                            sentence={currentPack.sentence}
                            language={language}
                            size="sm"
                            showPinyin={language === "zh"}
                            flexWrap="wrap"
                            justifyContent="center"
                        />
                        <Typography
                            className="sort-cards__sentence-english"
                            sx={{ fontSize: SIZE.micro, color: COLORS.textSecondary, textAlign: "center" }}
                        >
                            {currentPack.sentence.english}
                        </Typography>
                    </SentenceSection>
                )}

                {/* On-deck: up to 3 draggable cards (tray shrinks to fit). A card the
                    user resolved this session leaves an invisible placeholder in its
                    slot so the other cards don't reposition. */}
                <OnDeckSection className="sort-cards__on-deck">
                    <CardsRow className="sort-cards__cards-row">
                        {currentPack.cards.map((card) => {
                            // Resolved this session (sorted/skipped) but not pre-sorted:
                            // hold the slot with a placeholder instead of a live card.
                            if (!card.sorted && doneForCurrent?.has(card.id)) {
                                return (
                                    <CardSlotPlaceholder
                                        key={`${currentPack.packKey}:${card.id}`}
                                        className="sort-cards__card-placeholder"
                                        aria-hidden
                                    />
                                );
                            }
                            return (
                                <DraggableCard
                                    key={`${currentPack.packKey}:${card.id}`}
                                    card={card}
                                    locked={!!card.sorted}
                                    onCheckCollision={checkBucketCollision}
                                    onHighlight={setHighlightedBucket}
                                    onSort={handleSortCard}
                                    onFirstDrag={unlockAudioOnce}
                                />
                            );
                        })}
                    </CardsRow>
                </OnDeckSection>
            </ContentArea>
        </NodePage>
    );
};

export default SortCardsPage;
