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
import type { Language, DiscoverCard } from "../types";

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
    display: "flex",
    flexDirection: "column",
    alignSelf: "stretch",
    overflow: "visible",
});

// CSS grid distributes the 4 buckets evenly in a 2×2 layout regardless of viewport height
const BucketsContainer = styled(Box)({
    width: "100vw",
    flex: 2,
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
    width: "100vw",
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
    gap: 72,
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
    const { language } = useParams<{ language: Language }>();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down("md"));
    const [cards, setCards] = useState<DiscoverCard[]>([]);
    const [currentCardIndex, setCurrentCardIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [highlightedBucket, setHighlightedBucket] = useState<string | null>(null);
    const [history, setHistory] = useState<Array<{ card: DiscoverCard; bucket: string }>>([]);
    const isLoadingMoreRef = useRef(false);

    // Refs for DOM-based collision detection — CSS grid owns the layout, we read positions on drag
    const bucketsRef = useRef<HTMLDivElement>(null);
    const onDeckRef = useRef<HTMLDivElement>(null);
    const bucketRefs = useRef<Map<string, HTMLElement>>(new Map());

    const buckets = useMemo<BucketZone[]>(() => [
        { id: "already-learned", label: "Already Learned", mainColor: COLORS.redMain, accentColor: COLORS.redAccent },
        { id: "library", label: "Add to\nLibrary", mainColor: COLORS.greenMain, accentColor: COLORS.greenAccent },
        { id: "skip", label: "Skip for now", mainColor: COLORS.blueMain, accentColor: COLORS.blueAccent },
        { id: "learn-later", label: "Add to Learn Later", mainColor: COLORS.yellowMain, accentColor: COLORS.yellowAccent },
    ], []);

    const [{ x, y, scale, opacity }, api] = useSpring(() => ({
        x: 0,
        y: 0,
        scale: 1,
        opacity: 1,
    }));

    // Fetch starter pack cards
    useEffect(() => {
        const fetchCards = async () => {
            try {
                const response = await fetch(`${API_BASE_URL}/api/starter-packs/${language}`, {
                    credentials: "include",
                });
                if (response.ok) {
                    const data = await response.json();
                    setCards(data);
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

    const currentCard = cards[currentCardIndex];

    // Animate card entrance when card changes
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
    }, [currentCardIndex, currentCard, api]);

    // Load more cards when 4 remain
    useEffect(() => {
        const remaining = cards.length - currentCardIndex;
        if (remaining === 4 && cards.length > 0) {
            loadMoreCards();
        }
    }, [currentCardIndex, cards.length]);

    // Check if the dragged card's center overlaps a bucket using actual DOM positions
    const checkBucketCollision = (ox: number, oy: number): string | null => {
        const onDeckEl = onDeckRef.current;
        if (!onDeckEl) return null;
        const onDeckRect = onDeckEl.getBoundingClientRect();

        // Card rests at center of OnDeckSection (via inset + margin:auto); drag offsets move it
        const cardCenterX = onDeckRect.left + onDeckRect.width / 2 + ox;
        const cardCenterY = onDeckRect.top + onDeckRect.height / 2 + oy;

        for (const [id, el] of bucketRefs.current) {
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

        try {
            // Animate card exit (fade out + shrink)
            await api.start({
                opacity: 0,
                scale: 0.8,
                config: { tension: 150, friction: 35 },
            });

            // Save to backend
            await fetch(`${API_BASE_URL}/api/starter-packs/sort`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    cardId: currentCard.id,
                    bucket: bucketId,
                    language,
                }),
            });

            // Add to history for undo
            setHistory((prev) => [...prev, { card: currentCard, bucket: bucketId }]);

            // Move to next card
            setCurrentCardIndex((prev) => prev + 1);
        } catch (error) {
            console.error("Error sorting card:", error);
        }
    };

    // Undo last action
    const handleUndo = async () => {
        if (history.length === 0) return;

        const lastAction = history[history.length - 1];
        setHistory((prev) => prev.slice(0, -1));
        setCurrentCardIndex((prev) => Math.max(0, prev - 1));

        try {
            await fetch(`${API_BASE_URL}/api/starter-packs/undo`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
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

    // Silently fetch more unsorted cards and append unique ones
    const loadMoreCards = async () => {
        if (isLoadingMoreRef.current) return;
        isLoadingMoreRef.current = true;
        try {
            const response = await fetch(`${API_BASE_URL}/api/starter-packs/${language}`, {
                credentials: "include",
            });
            if (response.ok) {
                const newCards: DiscoverCard[] = await response.json();
                setCards((prev) => {
                    const existingIds = new Set(prev.map((c) => c.id));
                    const unique = newCards.filter((c) => !existingIds.has(c.id));
                    return unique.length > 0 ? [...prev, ...unique] : prev;
                });
            }
        } catch (error) {
            console.error("Error loading more cards:", error);
        } finally {
            isLoadingMoreRef.current = false;
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
                        <Box className="sort-cards__card-body" sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
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
                            <Typography className="sort-cards__card-value" sx={{ fontSize: 12, fontWeight: 400, textAlign: "center" }}>
                                {currentCard.entryValue}
                            </Typography>
                        </Box>
                    </FlashCard>
                </OnDeckSection>
            </ContentArea>

            {/* Footer */}
            <MobileFooter activePage="discover" />
        </IPhoneFrame>
    );
};

export default SortCardsPage;
