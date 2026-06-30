import { useState, useEffect, useRef, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Box, Typography, IconButton, Button, Chip } from "@mui/material";
import DelayedCircularProgress from "../components/DelayedCircularProgress";
import { styled } from "@mui/material/styles";
import UndoIcon from "@mui/icons-material/Undo";
import { useDrag } from "@use-gesture/react";
import { useSpring, animated } from "@react-spring/web";
import LeafPage from "../components/LeafPage";
import MinutePointsFireBadge from "../minutePoints/MinutePointsFireBadge";
import ForeignText from "../components/ForeignText";
import PosBadge from "../components/PosBadge";
import { API_BASE_URL } from "../constants";
import { stripParentheses } from "../utils/definitionUtils";
import type { Language, DiscoverCard, DiscoverFetchResponse, DiscoverSortResponse } from "../types";
import { usePageTitle } from "../hooks/usePageTitle";
import { useAuth } from "../AuthContext";
import { useTTS } from "../hooks/useTTS";
import { useDiscoverSettings } from "../hooks/useDiscoverSettings";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { SIZE, WEIGHT, LEADING, TRACKING } from "../theme/scale";

// This page is a DUMB FIFO QUEUE (see docs/SORT_CARDS_DESIGN.md): the server owns the
// difficulty level and all card selection; the client holds a short queue of
// ready-to-show cards, renders the head, and asks for exactly one replacement per
// sort. There is NO difficulty/band logic here on purpose — that coupling was the
// source of the old frozen-head / head-skip / "All cards sorted" bugs.

// Styled Components — phone-frame sizing comes from MobileDemoFrame via Layout.tsx

const ContentArea = styled(Box)({
    flex: 1,
    minHeight: 0, // allow flex item to shrink below content size
    display: "flex",
    flexDirection: "column",
    alignSelf: "stretch",
    overflow: "visible",
    // Disable text selection: the card is drag-to-sort, so selecting the
    // bucket labels / card text mid-drag is never intended and looks broken.
    userSelect: "none",
    WebkitUserSelect: "none",
    // Block native pan/scroll so dragging on the background/empty area doesn't
    // fight the card drag gesture (browser default would try to scroll the page).
    touchAction: "none",
});

// CSS grid distributes the 3 buckets evenly in a single row regardless of viewport height
const BucketsContainer = styled(Box)({
    width: "100%",
    flex: "1 1 0", // flex-basis: 0 gives grid a definite height so the 1fr row resolves correctly
    minHeight: 0, // allow flex to shrink below grid content size on small screens
    maxHeight: 208, // 1 × 200px bucket + 8px paddingBlock
    paddingBlock: "4px",
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gridTemplateRows: "1fr",
    columnGap: "12px",
    justifyItems: "center",
});

const Bucket = styled(Box)<{ mainColor: string; accentColor: string; highlight?: boolean }>(
    ({ mainColor, accentColor, highlight }) => ({
        aspectRatio: "136 / 200",
        width: "100%", // fill the 1fr grid column; aspect-ratio then drives height
        maxHeight: "100%", // guard against short rows where ratio would overflow vertically
        minWidth: 0, // override grid item default (auto) so bucket shrinks with 1fr columns
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

const OnDeckSection = styled(Box)({
    width: "100%",
    flex: 1,
    minHeight: 0, // allow flex to shrink below card content size on small screens
    paddingBlock: "4px",
    position: "relative",
    backgroundColor: COLORS.header,
    borderTop: `2px dashed ${COLORS.border}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
});

const AnimatedBox = animated(Box);

const FlashCard = styled(AnimatedBox)({
    aspectRatio: "136 / 200",
    height: 200,
    maxHeight: "calc(100% - 16px)", // scale down on small screens (8px margin each side)
    backgroundColor: COLORS.card,
    borderRadius: 12,
    boxShadow: "2px 4px 4px rgba(0, 0, 0, 0.25)",
    padding: 16,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
    cursor: "grab",
    touchAction: "none",
    zIndex: 1000,
    "&:active": {
        cursor: "grabbing",
    },
});

interface BucketZone {
    id: string;
    label: string;
    mainColor: string;
    accentColor: string;
}

const SortCardsPage: React.FC = () => {
    usePageTitle("Discover");
    const navigate = useNavigate();
    const { token } = useAuth();
    const { language } = useParams<{ language: Language }>();
    const tts = useTTS();
    const { settings: discoverSettings, update: updateDiscoverSettings } = useDiscoverSettings();
    // Primes the cloud provider's <audio> element for autoplay exactly once per
    // session, on the first drag gesture. Mobile autoplay policy rejects a
    // programmatic play() that isn't tied to a user gesture, so the on-deck
    // autoplay effect (which runs on card change, not on a tap) needs this unlock.
    const audioUnlockedRef = useRef(false);
    // The FIFO queue: queue[0] is the on-deck card; the rest is the small buffer that
    // keeps the next card ready so the user never waits (target size 2). The server
    // returns cards already filtered/ordered — the client never reorders or filters.
    const [queue, setQueue] = useState<DiscoverCard[]>([]);
    // `exhausted` is the server's signal that the whole discoverable dictionary is
    // sorted. We only show the terminal state when the queue is ALSO empty.
    const [exhausted, setExhausted] = useState(false);
    // The single most-recent sort, kept client-side so Undo can re-show the card and
    // tell the server which bucket to reverse. Null when there's nothing to undo.
    const [lastSort, setLastSort] = useState<{ card: DiscoverCard; bucket: string } | null>(null);
    const [loading, setLoading] = useState(true);
    const [highlightedBucket, setHighlightedBucket] = useState<string | null>(null);
    // The server's estimated difficulty level for this user — DISPLAY ONLY (shown as a
    // chip below the header). The client never filters on it (that's the whole point of
    // the dumb-FIFO redesign); it's a cosmetic readout that the server keeps fresh.
    const [level, setLevel] = useState<number | null>(null);

    // Refs for DOM-based collision detection — CSS grid owns the layout, we read positions on drag
    const bucketsRef = useRef<HTMLDivElement>(null);
    const onDeckRef = useRef<HTMLDivElement>(null);
    const bucketRefs = useRef<Map<string, HTMLElement>>(new Map());

    const buckets = useMemo<BucketZone[]>(() => [
        { id: "skip", label: "Skip for now", mainColor: COLORS.greenMain, accentColor: COLORS.greenAccent },
        { id: "library", label: "Add to\nLearn Now", mainColor: COLORS.redMain, accentColor: COLORS.redAccent },
        { id: "already-learned", label: "Already Learned", mainColor: COLORS.blueMain, accentColor: COLORS.blueAccent },
    ], []);

    const [{ x, y, scale, opacity }, api] = useSpring(() => ({
        x: 0,
        y: 0,
        scale: 1,
        opacity: 1,
    }));

    // Fetch the initial queue (server fills head + buffer).
    useEffect(() => {
        const fetchCards = async () => {
            try {
                const response = await fetch(`${API_BASE_URL}/api/starter-packs/${language}`, {
                    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
                    credentials: "include",
                });
                if (response.ok) {
                    const data: DiscoverFetchResponse = await response.json();
                    setQueue(data.cards);
                    setExhausted(data.exhausted);
                    if (typeof data.level === "number") setLevel(data.level);
                } else {
                    console.error("Failed to fetch starter pack cards");
                }
            } catch (error) {
                console.error("Error fetching cards:", error);
            } finally {
                setLoading(false);
            }
        };

        if (language) {
            fetchCards();
        }
        // token is included so the initial load re-runs once auth resolves and a
        // token becomes available (the request sends the Authorization header).
    }, [language, token]);

    // The on-deck card is simply the head of the queue.
    const currentCard = queue[0];

    // Cosmetic level-chip text. zh difficulty integers ARE HSK levels, so show
    // "HSK n"; es uses the same 1–6 scale but it isn't an HSK label, so show "Level n".
    const levelLabel = level == null ? null : (language === "zh" ? `HSK ${level}` : `Level ${level}`);

    // TTS narration: auto-play the on-deck word each time a new card reaches the
    // head position. Keyed on the card id so re-renders (drag, highlight) don't
    // re-fire narration for the same card. Gated by both the Discover autoplay
    // toggle and the global TTS enable flag.
    useEffect(() => {
        if (!tts.enabled || !discoverSettings.autoplay) return;
        if (!currentCard) return;
        tts.speakSentence(currentCard.entryKey, currentCard.pronunciation ?? undefined);
        // Cancel narration if the user sorts/advances mid-utterance.
        return () => tts.cancel();
        // tts.speakSentence/cancel are stable across renders; depending on them
        // would re-fire narration on every settings change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentCard?.id, tts.enabled, discoverSettings.autoplay]);

    // Animate card entrance when the active card changes
    useEffect(() => {
        if (currentCard) {
            // Reset to starting position below, invisible
            api.set({ x: 0, y: 50, scale: 1, opacity: 0 });
            // Animate in (slide up + fade in)
            api.start({
                y: 0,
                opacity: 1,
                config: { tension: 280, friction: 26 },
            });
        }
    }, [currentCard, api]);

    // Check if the dragged card's center overlaps a bucket using actual DOM positions
    const checkBucketCollision = (ox: number, oy: number): string | null => {
        const onDeckEl = onDeckRef.current;
        if (!onDeckEl) return null;
        const onDeckRect = onDeckEl.getBoundingClientRect();

        // Card rests at center of OnDeckSection (via inset + margin:auto); drag offsets move it
        const cardCenterX = onDeckRect.left + onDeckRect.width / 2 + ox;
        const cardCenterY = onDeckRect.top + onDeckRect.height / 2 + oy;

        for (const [id, el] of bucketRefs.current) {
            // Guard: el could be null if the bucket unmounted between render and drag
            if (!el) continue;
            const rect = el.getBoundingClientRect();
            if (
                cardCenterX >= rect.left &&
                cardCenterX <= rect.right &&
                cardCenterY >= rect.top &&
                cardCenterY <= rect.bottom
            ) {
                return id;
            }
        }
        return null;
    };

    // Handle card sorting. The queue shrinks by one (pop head); the /sort response
    // carries the single replacement card we append to the tail — so one round-trip
    // does both the sort and the refill (no separate load-more call).
    const handleCardSort = async (bucketId: string) => {
        if (!currentCard) return;

        const sortedCard = currentCard;
        console.log(`[Sort] "${sortedCard.entryKey}" → ${bucketId}`);

        // Animate card exit (fade out + shrink). We await only the local animation —
        // the buffer card becomes the new head instantly; the network resolves after.
        await api.start({
            opacity: 0,
            scale: 0.8,
            config: { tension: 150, friction: 35 },
        });

        // Remember this sort for Undo (bounded to 1: only the most recent is undoable).
        setLastSort({ card: sortedCard, bucket: bucketId });

        // Optimistically pop the head. The ids that REMAIN are what the server must
        // exclude so the replacement card it returns isn't already in our queue.
        const remaining = queue.slice(1);
        const excludeIds = remaining.map((c) => c.id);
        setQueue(remaining);

        try {
            const response = await fetch(`${API_BASE_URL}/api/starter-packs/sort`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
                credentials: "include",
                body: JSON.stringify({
                    cardId: sortedCard.id,
                    bucket: bucketId,
                    language,
                    excludeIds,
                }),
            });
            if (!response.ok) throw new Error(`sort failed: ${response.status}`);
            const data: DiscoverSortResponse = await response.json();
            setExhausted(data.exhausted);
            if (typeof data.level === "number") setLevel(data.level);
            // Append the replacement to the tail (never touches the head → on-deck
            // immutability). Guard against a duplicate in case of overlap.
            if (data.nextCard) {
                const next = data.nextCard;
                setQueue((prev) => (prev.some((c) => c.id === next.id) ? prev : [...prev, next]));
            }
        } catch (error) {
            // Roll the optimistic pop back: re-show the sorted card at the head so the
            // UI never claims a card is sorted when the server didn't record it.
            console.error("Error sorting card:", error);
            setLastSort(null);
            setQueue((prev) => (prev.some((c) => c.id === sortedCard.id) ? prev : [sortedCard, ...prev]));
            api.start({ opacity: 1, scale: 1 });
        }
    };

    // Undo the last sort — unshift the card back to the head and tell the server which
    // bucket to reverse (skip → discover_skips row; otherwise → vet row).
    const handleUndo = async () => {
        if (!lastSort) return;

        const { card, bucket } = lastSort;
        setLastSort(null);
        // Re-show the card immediately at the head.
        setQueue((prev) => (prev.some((c) => c.id === card.id) ? prev : [card, ...prev]));

        try {
            await fetch(`${API_BASE_URL}/api/starter-packs/undo`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
                credentials: "include",
                body: JSON.stringify({ cardId: card.id, bucket, language }),
            });
            // Undoing means the dictionary isn't fully sorted anymore.
            setExhausted(false);
        } catch (error) {
            console.error("Error undoing action:", error);
        }
    };

    // Drag gesture handler
    const bind = useDrag(
        ({ down, offset: [ox, oy] }) => {
            // First touch of a drag is a genuine user gesture — use it to unlock
            // mobile autoplay so the next card's narration isn't blocked.
            if (down && !audioUnlockedRef.current) {
                audioUnlockedRef.current = true;
                tts.unlockAudio();
            }
            api.start({
                x: down ? ox : 0,
                y: down ? oy : 0,
                scale: down ? 1.1 : 1,
                immediate: down,
            });

            const bucketId = checkBucketCollision(ox, oy);
            if (down) {
                setHighlightedBucket(bucketId);
            } else {
                setHighlightedBucket(null);
                if (bucketId) handleCardSort(bucketId);
            }
        },
        {
            from: () => [x.get(), y.get()],
            // Read actual container dimensions from the DOM at gesture start
            bounds: () => {
                const bucketsRect = bucketsRef.current?.getBoundingClientRect();
                const onDeckRect = onDeckRef.current?.getBoundingClientRect();
                if (!bucketsRect || !onDeckRect) return {};
                // Offsets are relative to card's rest position (center of OnDeck)
                const restCenterY = onDeckRect.top + onDeckRect.height / 2;
                return {
                    left: -(onDeckRect.width / 2 - 40),
                    right: onDeckRect.width / 2 - 40,
                    top: bucketsRect.top - restCenterY,
                    bottom: onDeckRect.bottom - restCenterY,
                };
            },
        }
    );

    // Sort Cards is a LEAF PAGE (see docs/LEAF_NODE_PAGES.md): no footer, DOWN back
    // arrow (returns to the Discover hub), slides up on enter / down on exit. The
    // three view states (loading / no-cards / sorting) all render through one
    // LeafPage so it stays a single instance and the enter slide plays only once.
    if (loading) {
        return (
            <LeafPage title="Sort Cards" onBack={() => navigate("/discover")} rightContent={<MinutePointsFireBadge />}>
                <Box className="sort-cards__loading-wrapper" sx={{ display: "flex", flex: 1, justifyContent: "center", alignItems: "center" }}>
                    <DelayedCircularProgress className="sort-cards__spinner" />
                </Box>
            </LeafPage>
        );
    }

    if (!currentCard) {
        // Empty queue. With the new always-a-card supply (server widens to all levels
        // and recycles skips), running out is NOT a normal "you finished" state — it
        // means the server genuinely found no cards, so we surface it as an error.
        // An empty-but-not-exhausted queue is just a transient gap waiting on the
        // replacement card, so show a spinner instead.
        return (
            <LeafPage title="Sort Cards" onBack={() => navigate("/discover")} rightContent={<MinutePointsFireBadge />}>
                <ContentArea className="sort-cards__content">
                    <Box className="sort-cards__no-cards-error" sx={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center" }}>
                        {exhausted
                            ? <Typography className="sort-cards__no-cards-error-text">Error: no cards found</Typography>
                            : <DelayedCircularProgress className="sort-cards__spinner" />}
                    </Box>
                </ContentArea>
            </LeafPage>
        );
    }

    return (
        <LeafPage
            title="Sort Cards"
            onBack={() => navigate("/discover")}
            rightContent={
                <>
                    {/* Autoplay toggle — same "autoplay" text label flp uses
                        (FlashcardsLearnHeader), styled to the Discover header palette. */}
                    <Button
                        className="sort-cards__autoplay-toggle"
                        variant={discoverSettings.autoplay ? "contained" : "text"}
                        size="small"
                        onClick={() => updateDiscoverSettings({ autoplay: !discoverSettings.autoplay })}
                        aria-pressed={discoverSettings.autoplay}
                        sx={{
                            minWidth: "unset",
                            px: 1,
                            py: 0.25,
                            height: "30px",
                            fontSize: SIZE.micro,
                            textTransform: "lowercase",
                            lineHeight: LEADING.normal,
                            borderRadius: "6px",
                            color: COLORS.onSurface,
                            backgroundColor: discoverSettings.autoplay ? COLORS.card : "transparent",
                            "&:hover": {
                                backgroundColor: discoverSettings.autoplay ? COLORS.card : "transparent",
                            },
                        }}
                    >
                        autoplay
                    </Button>
                    <IconButton
                        className="sort-cards__undo-button"
                        onClick={handleUndo}
                        size="small"
                        disabled={!lastSort}
                        sx={{ color: COLORS.onSurface }}
                    >
                        <UndoIcon className="sort-cards__undo-icon" />
                    </IconButton>
                    <MinutePointsFireBadge />
                </>
            }
        >
            {/* Space below the header holding the user's level chip. Sits between the
                LeafPage header and the buckets so the level reads as page context, not
                part of the sortable card. */}
            <Box
                className="sort-cards__level-bar"
                sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 48, px: 2, py: 1 }}
            >
                {levelLabel && (
                    <Chip
                        className="sort-cards__level-chip"
                        label={levelLabel}
                        size="small"
                        sx={{
                            backgroundColor: COLORS.hskChip,
                            color: "white",
                            fontSize: SIZE.micro,
                            fontWeight: WEIGHT.bold,
                            letterSpacing: TRACKING.caps,
                        }}
                    />
                )}
            </Box>

            {/* Content Area */}
            <ContentArea className="sort-cards__content">
                {/* Buckets — CSS grid owns placement, no JS position math needed */}
                <BucketsContainer className="sort-cards__buckets-container" ref={bucketsRef}>
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

                {/* On Deck Section with Draggable Card */}
                <OnDeckSection className="sort-cards__on-deck" ref={onDeckRef}>
                    <FlashCard
                        className="sort-cards__flash-card"
                        {...bind()}
                        style={{
                            x,
                            y,
                            scale,
                            opacity,
                            position: "absolute",
                            inset: 0,
                            margin: "auto",
                        }}
                    >
                        {/* Representative icon (icons8) for the card, when one is assigned.
                            Served by the public endpoint /api/icons8/<iconId>/image (same as
                            the flashcard image). Not draggable so it doesn't fight the card
                            drag gesture; omitted entirely when the card has no icon. */}
                        {currentCard.iconId && (
                            <Box
                                component="img"
                                className="sort-cards__card-icon"
                                src={`${API_BASE_URL}/api/icons8/${encodeURIComponent(currentCard.iconId)}/image`}
                                alt=""
                                draggable={false}
                                sx={{ width: 64, height: 64, objectFit: "contain", pointerEvents: "none" }}
                            />
                        )}
                        {/* Characters + pronunciation centered in the middle, rendered per-character via cpcd */}
                        <Box className="sort-cards__card-key-group" sx={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                            <ForeignText
                                size="sm"
                                className="sort-cards__card-key"
                                text={currentCard.entryKey}
                                pronunciation={currentCard.pronunciation}
                            />
                            {/* "(v)"/"(n)" badge for Spanish words with multiple discoverable POS */}
                            <PosBadge pos={currentCard.pos} hasMultiplePos={currentCard.hasMultiplePos} />
                        </Box>
                        {/* Definition pinned to the bottom of the card; clamped to 2 lines to prevent overflow */}
                        <Typography
                            className="sort-cards__card-value"
                            sx={{
                                fontSize: SIZE.caption,
                                fontWeight: WEIGHT.regular,
                                textAlign: "center",
                                width: "100%",
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                            }}
                        >
                            {stripParentheses(currentCard.definition)}
                        </Typography>
                    </FlashCard>
                </OnDeckSection>
            </ContentArea>
        </LeafPage>
    );
};

export default SortCardsPage;
