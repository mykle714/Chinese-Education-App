import { useState, useEffect, useRef, useMemo } from "react";
import { useParams } from "react-router-dom";
import { Box, Typography, IconButton, CircularProgress, useMediaQuery, useTheme } from "@mui/material";
import { styled } from "@mui/material/styles";
import UndoIcon from "@mui/icons-material/Undo";
import { useDrag } from "@use-gesture/react";
import { useSpring, animated } from "@react-spring/web";
import MobileFooter from "../components/MobileFooter";
import MobileNavDrawer from "../components/MobileNavDrawer";
import PageHeader from "../components/PageHeader";
import { API_BASE_URL } from "../constants";
import { stripParentheses } from "../utils/definitionUtils";
import type { Language, DiscoverCard, DiscoverFetchResponse, DiscoverSortResponse } from "../types";
import { usePageTitle } from "../hooks/usePageTitle";
import { useAuth } from "../AuthContext";

// Parses an HSK label like "HSK3" → 3, returns null for missing/malformed values.
function parseHskLevel(label: string | null | undefined): number | null {
    if (!label) return null;
    const m = label.match(/^HSK([1-6])$/);
    return m ? Number(m[1]) : null;
}

// Design tokens from Figma
const COLORS = {
    background: "#F9F7F2",
    header: "#D7D7D4",
    onSurface: "#1D1B20",
    border: "#625F63",
    cardColor: "#D6CCC2",
    // Bucket colors
    redMain: "#EF476F",
    redAccent: "#F2BAC9",
    greenMain: "#05C793",
    greenAccent: "#BAF2D8",
    blueMain: "#779BE7",
    blueAccent: "#BAD7F2",
    yellowMain: "#FF8E47",
    yellowAccent: "#F2E2BA",
};

// Styled Components
const IPhoneFrame = styled(Box)({
    backgroundColor: COLORS.background,
    borderRadius: 0,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    width: "100vw",
    height: "100dvh",
});

const ContentArea = styled(Box)({
    flex: 1,
    minHeight: 0, // allow flex item to shrink below content size
    display: "flex",
    flexDirection: "column",
    alignSelf: "stretch",
    overflow: "visible",
});

// CSS grid distributes the 4 buckets evenly in a 2×2 layout regardless of viewport height
const BucketsContainer = styled(Box)({
    width: "100%",
    flex: "2 2 0", // flex-basis: 0 gives grid a definite height so 1fr rows resolve correctly
    minHeight: 0, // allow flex to shrink below grid content size on small screens
    maxHeight: 424, // 2 × 200px buckets + 16px rowGap + 8px paddingBlock
    paddingBlock: "4px",
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gridTemplateRows: "1fr 1fr",
    rowGap: "16px",
    justifyItems: "center",
});

const Bucket = styled(Box)<{ mainColor: string; accentColor: string; highlight?: boolean }>(
    ({ mainColor, accentColor, highlight }) => ({
        aspectRatio: "136 / 200",
        minHeight: 0, // override grid item default (auto) so bucket shrinks with 1fr rows
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
            fontSize: 12,
            fontWeight: 400,
            lineHeight: 1.21,
            textAlign: "center",
            color: COLORS.onSurface,
            fontFamily: '"Inter", sans-serif',
            letterSpacing: "0.14em",
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
    backgroundColor: COLORS.cardColor,
    borderRadius: 12,
    boxShadow: "2px 4px 4px rgba(0, 0, 0, 0.25)",
    padding: 8,
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    alignItems: "center",
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
    const { token } = useAuth();
    const { language } = useParams<{ language: Language }>();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down("md"));
    // `cardQueue` is the append-only master list of every card we've fetched.
    // `currentCardIndex` advances through it. We never replace `cardQueue` so the
    // currently displayed card (and undo history) survive mid-session refetches.
    const [cardQueue, setCardQueue] = useState<DiscoverCard[]>([]);
    const [currentCardIndex, setCurrentCardIndex] = useState(0);
    const [userHskLevel, setUserHskLevel] = useState<number | null>(null);
    // provisionalMode: true when user has <3 Unfamiliar cards; narrows filter to hskLevel+1 only
    const [provisionalMode, setProvisionalMode] = useState<boolean>(false);
    const [loading, setLoading] = useState(true);
    const [highlightedBucket, setHighlightedBucket] = useState<string | null>(null);
    const [history, setHistory] = useState<Array<{ card: DiscoverCard; bucket: string }>>([]);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    // Set to true when a load-more fetch returns 0 new unique cards — stops infinite retries.
    // Cleared whenever new cards actually arrive so sorting can resume if state changes.
    const [loadMoreExhausted, setLoadMoreExhausted] = useState(false);

    // Refs for DOM-based collision detection — CSS grid owns the layout, we read positions on drag
    const bucketsRef = useRef<HTMLDivElement>(null);
    const onDeckRef = useRef<HTMLDivElement>(null);
    const bucketRefs = useRef<Map<string, HTMLElement>>(new Map());

    const buckets = useMemo<BucketZone[]>(() => [
        { id: "library", label: "Add to\nLibrary", mainColor: COLORS.redMain, accentColor: COLORS.redAccent },
        { id: "skip", label: "Skip for now", mainColor: COLORS.greenMain, accentColor: COLORS.greenAccent },
        { id: "learn-later", label: "Add to Learn Later", mainColor: COLORS.yellowMain, accentColor: COLORS.yellowAccent },
        { id: "already-learned", label: "Already Learned", mainColor: COLORS.blueMain, accentColor: COLORS.blueAccent },
    ], []);

    const [{ x, y, scale, opacity }, api] = useSpring(() => ({
        x: 0,
        y: 0,
        scale: 1,
        opacity: 1,
    }));

    // Fetch starter pack cards (initial load)
    useEffect(() => {
        const fetchCards = async () => {
            try {
                const response = await fetch(`${API_BASE_URL}/api/starter-packs/${language}`, {
                    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
                    credentials: "include",
                });
                if (response.ok) {
                    const data: DiscoverFetchResponse = await response.json();
                    setCardQueue(data.cards);
                    setUserHskLevel(data.userHskLevel);
                    setProvisionalMode(data.provisionalMode);
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
    }, [language]);

    // Build the visible queue: the currently displayed card is "frozen" at the
    // head and is never filtered out — even if a fresh server response shifts
    // userHskLevel mid-session, we don't want to yank the active card off-screen.
    // Normal mode: tail filtered to [userLevel, userLevel + 1].
    // Provisional mode (<3 Unfamiliar cards): tail filtered to only hskLevel+1.
    const visibleQueue = useMemo<DiscoverCard[]>(() => {
        const head = cardQueue[currentCardIndex];
        if (userHskLevel == null) {
            // No level known yet — show everything from the current index
            return cardQueue.slice(currentCardIndex);
        }
        const targetLevel = Math.min(6, userHskLevel + 1);
        const tail = cardQueue
            .slice(currentCardIndex + 1)
            .filter((c) => {
                const lvl = parseHskLevel(c.hskLevel);
                if (lvl == null) return false;
                if (provisionalMode) {
                    // Provisional: show only cards at exactly targetLevel (userHskLevel+1).
                    return lvl === targetLevel;
                }
                // Normal: show [userHskLevel, userHskLevel+1]
                const min = Math.max(1, userHskLevel);
                return lvl >= min && lvl <= targetLevel;
            });
        return head ? [head, ...tail] : tail;
    }, [cardQueue, currentCardIndex, userHskLevel, provisionalMode]);

    const currentCard = visibleQueue[0];

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

    // Diagnostic: log the displayed card + current HSK level whenever either changes
    useEffect(() => {
        if (currentCard) {
            const targetLevel = userHskLevel != null ? Math.min(6, userHskLevel + 1) : null;
            const bandMin = provisionalMode ? targetLevel : (userHskLevel != null ? Math.max(1, userHskLevel) : null);
            const bandMax = targetLevel;
            console.log(
                "[Discover] displaying card:",
                currentCard.entryKey,
                currentCard.hskLevel,
                "| userHskLevel:",
                userHskLevel,
                "| provisionalMode:",
                provisionalMode,
                "| band:",
                bandMin != null ? `HSK${bandMin}–HSK${bandMax}` : "unfiltered"
            );
        }
    }, [currentCard, userHskLevel, provisionalMode]);

    // Head-skip effect: advance past any out-of-band card at the head position.
    // Runs on cardQueue changes (initial load, load-more) and on band changes
    // (userHskLevel / provisionalMode updates from the server) so that a
    // mid-session rank-up updates the displayed card to match the new band.
    useEffect(() => {
        if (userHskLevel == null || cardQueue.length === 0) return;
        const head = cardQueue[currentCardIndex];
        if (!head) return; // index is past end; waiting for more cards
        const lvl = parseHskLevel(head.hskLevel);
        if (lvl == null) return;
        const targetLevel = Math.min(6, userHskLevel + 1);
        const min = provisionalMode ? targetLevel : Math.max(1, userHskLevel);
        if (lvl >= min && lvl <= targetLevel) return; // head is in-band, nothing to do
        let next = currentCardIndex + 1;
        while (next < cardQueue.length) {
            const nextLvl = parseHskLevel(cardQueue[next].hskLevel);
            if (nextLvl != null && nextLvl >= min && nextLvl <= targetLevel) break;
            next++;
        }
        if (next !== currentCardIndex) setCurrentCardIndex(next);
    }, [cardQueue, currentCardIndex, userHskLevel, provisionalMode]);

    // Reset exhausted flag when the HSK band changes — the server may have
    // cards in the new band even though the previous band was exhausted.
    useEffect(() => {
        setLoadMoreExhausted(false);
    }, [userHskLevel, provisionalMode]);

    // Load more cards when ≤5 remain in the client-filtered visible queue
    useEffect(() => {
        console.log("[LoadMore] effect fired — visibleQueue:", visibleQueue.length, "cardQueue:", cardQueue.length, "isLoadingMore:", isLoadingMore, "exhausted:", loadMoreExhausted);
        if (visibleQueue.length <= 5 && cardQueue.length > 0 && !isLoadingMore && !loadMoreExhausted) {
            console.log("[LoadMore] → calling loadMoreCards()");
            loadMoreCards();
        }
    // loadMoreCards is intentionally excluded — the trigger conditions (visible queue size,
    // loading state, exhaustion) are already in deps. Wrapping it in useCallback would
    // require its own deep dep list (cardQueue, currentCardIndex, language) and cause excess re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visibleQueue.length, cardQueue.length, isLoadingMore, loadMoreExhausted]);

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

    // Handle card sorting
    const handleCardSort = async (bucketId: string) => {
        if (!currentCard) return;

        const sortedCard = currentCard;
        console.log(`[Sort] "${sortedCard.entryKey}" → ${bucketId}`);

        // Animate card exit (fade out + shrink). We await only the local
        // animation — the server POST is fire-and-forget so the user never
        // waits on the network to see the next card.
        await api.start({
            opacity: 0,
            scale: 0.8,
            config: { tension: 150, friction: 35 },
        });

        // Add to history for undo
        setHistory((prev) => [...prev, { card: sortedCard, bucket: bucketId }]);

        // Advance past any out-of-band cards in cardQueue so the next active
        // card honors the current [userLevel, userLevel + 1] filter. If we run
        // off the end, the refetch effect (visibleQueue.length <= 5) will load more.
        setCurrentCardIndex((prev) => {
            if (userHskLevel == null) return prev + 1;
            const targetLevel = Math.min(6, userHskLevel + 1);
            const min = provisionalMode ? targetLevel : Math.max(1, userHskLevel);
            let next = prev + 1;
            while (next < cardQueue.length) {
                const lvl = parseHskLevel(cardQueue[next].hskLevel);
                if (lvl != null && lvl >= min && lvl <= targetLevel) break;
                next++;
            }
            return next;
        });

        // Fire-and-forget POST. When it returns we update userHskLevel; the
        // useMemo recomputes visibleQueue against the new level on next render,
        // but the currently displayed card stays put (frozen head).
        try {
            const response = await fetch(`${API_BASE_URL}/api/starter-packs/sort`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
                credentials: "include",
                body: JSON.stringify({
                    cardId: sortedCard.id,
                    bucket: bucketId,
                    language,
                }),
            });
            if (response.ok) {
                const data: DiscoverSortResponse = await response.json();
                if (typeof data.userHskLevel === "number") {
                    setUserHskLevel(data.userHskLevel);
                }
                if (typeof data.provisionalMode === "boolean") {
                    setProvisionalMode(data.provisionalMode);
                }
            }
        } catch (error) {
            console.error("Error sorting card:", error);
        }
    };

    // Undo last action — restore the just-sorted card. Because handleCardSort
    // may skip multiple out-of-band indices, we look up the card's actual
    // index in cardQueue rather than naively decrementing.
    const handleUndo = async () => {
        if (history.length === 0) return;

        const lastAction = history[history.length - 1];
        setHistory((prev) => prev.slice(0, -1));

        const restoredIndex = cardQueue.findIndex((c) => c.id === lastAction.card.id);
        if (restoredIndex >= 0) {
            setCurrentCardIndex(restoredIndex);
        } else {
            // Fallback (shouldn't normally happen since we never remove from cardQueue)
            setCurrentCardIndex((prev) => Math.max(0, prev - 1));
        }

        try {
            await fetch(`${API_BASE_URL}/api/starter-packs/undo`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
                credentials: "include",
                body: JSON.stringify({
                    cardId: lastAction.card.id,
                    language,
                }),
            });
        } catch (error) {
            console.error("Error undoing action:", error);
        }
    };

    // Fetch the next batch of unsorted cards, telling the server which card IDs
    // the client already holds so they are excluded from the result. This
    // guarantees every card in the response is genuinely new to the client.
    const loadMoreCards = async () => {
        if (isLoadingMore) return;
        setIsLoadingMore(true);
        console.log("[LoadMore] fetching with excludeIds count:", cardQueue.length);
        try {
            // Only exclude cards from currentCardIndex onward — these are still
            // in the visible pipeline. Cards before the index were either sorted
            // (server excludes via vocabentries) or skipped by the head-skip effect
            // (we WANT the server to return those since the band may have changed).
            const excludeIds = cardQueue.slice(currentCardIndex).map((c) => c.id);
            const response = await fetch(`${API_BASE_URL}/api/starter-packs/${language}/more`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
                credentials: "include",
                body: JSON.stringify({ excludeIds }),
            });
            console.log("[LoadMore] response status:", response.status);
            if (response.ok) {
                const data: DiscoverFetchResponse = await response.json();
                console.log("[LoadMore] received", data.cards.length, "new cards");
                if (data.cards.length > 0) {
                    setCardQueue((prev) => [...prev, ...data.cards]);
                    setLoadMoreExhausted(false);
                } else {
                    console.log("[LoadMore] server returned 0 cards — marking exhausted");
                    setLoadMoreExhausted(true); // server truly has nothing left
                }
                if (typeof data.userHskLevel === "number") {
                    setUserHskLevel(data.userHskLevel);
                }
                if (typeof data.provisionalMode === "boolean") {
                    setProvisionalMode(data.provisionalMode);
                }
            }
        } catch (error) {
            console.error("Error loading more cards:", error);
        } finally {
            setIsLoadingMore(false);
        }
    };

    // Drag gesture handler
    const bind = useDrag(
        ({ down, offset: [ox, oy] }) => {
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

    if (loading) {
        return (
            <Box className="sort-cards__loading-wrapper" sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100dvh" }}>
                <CircularProgress className="sort-cards__spinner" />
            </Box>
        );
    }

    // On desktop the Layout wraps this page normally; restore the phone-frame look
    const desktopFrameSx = !isMobile ? {
        maxWidth: 393,
        width: "100%",
        borderRadius: "20px",
        margin: "0 auto",
        minHeight: "852px",
        maxHeight: "932px",
    } : {};

    if (!currentCard) {
        return (
            <IPhoneFrame className="sort-cards__frame" sx={desktopFrameSx}>
                <PageHeader
                    title="Sort Cards"
                    showBack={false}
                    rightItems={<MobileNavDrawer />}
                />
                <ContentArea className="sort-cards__content">
                    <Box className="sort-cards__all-sorted" sx={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center" }}>
                        <Typography className="sort-cards__all-sorted-text">All cards sorted! 🎉</Typography>
                    </Box>
                </ContentArea>
                <MobileFooter activePage="discover" />
            </IPhoneFrame>
        );
    }

    return (
        <IPhoneFrame className="sort-cards__frame" sx={desktopFrameSx}>
            {/* Header */}
            <PageHeader
                title="Sort Cards"
                showBack={false}
                rightItems={
                    <>
                        <IconButton
                            className="sort-cards__undo-button"
                            onClick={handleUndo}
                            size="small"
                            disabled={history.length === 0}
                            sx={{ color: "#1D1B20" }}
                        >
                            <UndoIcon className="sort-cards__undo-icon" />
                        </IconButton>
                        <MobileNavDrawer />
                    </>
                }
            />

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
                        <Box className="sort-cards__card-image" sx={{ width: 96, height: 76, backgroundColor: "#e0e0e0", borderRadius: 1 }} />
                        {/* Characters + pronunciation centered in the middle */}
                        <Box className="sort-cards__card-key-group" sx={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                            <Typography className="sort-cards__card-key" sx={{ fontSize: 20, fontWeight: 400, letterSpacing: "0.08em" }}>
                                {currentCard.entryKey}
                            </Typography>
                            {currentCard.pronunciation && (
                                <Typography className="sort-cards__card-pronunciation" sx={{ fontSize: 8, fontWeight: 400 }}>
                                    {currentCard.pronunciation}
                                </Typography>
                            )}
                        </Box>
                        {/* Definition pinned to the bottom of the card; clamped to 2 lines to prevent overflow */}
                        <Typography
                            className="sort-cards__card-value"
                            sx={{
                                fontSize: 12,
                                fontWeight: 400,
                                textAlign: "center",
                                width: "100%",
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                            }}
                        >
                            {stripParentheses(currentCard.entryValue)}
                        </Typography>
                    </FlashCard>
                </OnDeckSection>
            </ContentArea>

            {/* Footer */}
            <MobileFooter activePage="discover" />
        </IPhoneFrame>
    );
};

export default SortCardsPage;
