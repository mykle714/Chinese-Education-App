import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Box, Typography, IconButton, CircularProgress, useMediaQuery, useTheme } from "@mui/material";
import { styled } from "@mui/material/styles";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import UndoIcon from "@mui/icons-material/Undo";
import { useDrag } from "@use-gesture/react";
import { useSpring, animated } from "@react-spring/web";
import MobileFooter from "../components/MobileFooter";
import MobileNavDrawer from "../components/MobileNavDrawer";
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
    height: "100vh",
});

const Header = styled(Box)({
    backgroundColor: COLORS.header,
    minHeight: 96,
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    gap: 10,
});

const Toolbar = styled(Box)({
    display: "flex",
    gap: 10,
    width: "100%",
    height: 47,
    alignItems: "center",
    padding: "0 12px",
    position: "relative",
});

const ContentArea = styled(Box)({
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignSelf: "stretch",
    position: "relative",
    overflow: "visible",
});

const BucketsContainer = styled(Box)({
    width: "100vw",
    height: 452,
    position: "relative",
    flexShrink: 0,
});

const Bucket = styled(Box)<{ mainColor: string; accentColor: string; x: number; y: number; highlight?: boolean }>(
    ({ mainColor, accentColor, x, y, highlight }) => ({
        position: "absolute",
        left: x,
        top: y,
        width: 136,
        height: 200,
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
    position: "absolute",
    left: 0,
    top: 452,
    width: "100vw",
    height: 228,
    backgroundColor: COLORS.header,
    borderTop: `2px dashed ${COLORS.border}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
});

const AnimatedBox = animated(Box);

const FlashCard = styled(AnimatedBox)({
    width: 136,
    height: 200,
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
    x: number;
    y: number;
    mainColor: string;
    accentColor: string;
}

// Bucket x positions are computed dynamically inside the component based on viewport width.

const SortCardsPage: React.FC = () => {
    const navigate = useNavigate();
    const { language } = useParams<{ language: Language }>();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down("md"));
    const [cards, setCards] = useState<DiscoverCard[]>([]);
    const [currentCardIndex, setCurrentCardIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [highlightedBucket, setHighlightedBucket] = useState<string | null>(null);
    const [history, setHistory] = useState<Array<{ card: DiscoverCard; bucket: string }>>([]);
    const containerRef = useRef<HTMLDivElement>(null);
    const isLoadingMoreRef = useRef(false);

    // Track viewport width so buckets stay evenly distributed across the screen
    const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
    useEffect(() => {
        const handleResize = () => setViewportWidth(window.innerWidth);
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    // Distribute two bucket columns evenly: equal left margin, equal gap, equal right margin
    const BUCKET_WIDTH = 136;
    const colSpacing = Math.round((viewportWidth - 2 * BUCKET_WIDTH) / 3);
    const colX1 = colSpacing;
    const colX2 = colSpacing + BUCKET_WIDTH + colSpacing;
    const cardLeft = Math.round((viewportWidth - BUCKET_WIDTH) / 2);

    const buckets = useMemo<BucketZone[]>(() => [
        { id: "already-learned", label: "Already Learned", x: colX1, y: 20, mainColor: COLORS.redMain, accentColor: COLORS.redAccent },
        { id: "library", label: "Add to\nLibrary", x: colX2, y: 20, mainColor: COLORS.greenMain, accentColor: COLORS.greenAccent },
        { id: "skip", label: "Skip for now", x: colX1, y: 236, mainColor: COLORS.blueMain, accentColor: COLORS.blueAccent },
        { id: "learn-later", label: "Add to Learn Later", x: colX2, y: 236, mainColor: COLORS.yellowMain, accentColor: COLORS.yellowAccent },
    ], [colX1, colX2]);

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

    // Load more cards when 4 remain (marked the 5th-to-last)
    useEffect(() => {
        const remaining = cards.length - currentCardIndex;
        if (remaining === 4 && cards.length > 0) {
            loadMoreCards();
        }
    }, [currentCardIndex, cards.length]);

    // Check if card is dropped in a bucket
    const checkBucketCollision = (cardX: number, cardY: number): string | null => {
        if (!containerRef.current) return null;

        const cardCenterX = cardX + BUCKET_WIDTH / 2;
        const cardCenterY = cardY + 100; // Card height / 2 (200 / 2)

        for (const bucket of buckets) {
            const bucketLeft = bucket.x;
            const bucketTop = bucket.y;
            const bucketRight = bucket.x + BUCKET_WIDTH;
            const bucketBottom = bucket.y + 200;

            if (
                cardCenterX >= bucketLeft &&
                cardCenterX <= bucketRight &&
                cardCenterY >= bucketTop &&
                cardCenterY <= bucketBottom
            ) {
                return bucket.id;
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

        // Optionally call backend to undo
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

            if (down) {
                // Check collision while dragging
                // Add 504px offset for OnDeckSection position
                const bucketId = checkBucketCollision(cardLeft + ox, 452 + 16 + oy);
                setHighlightedBucket(bucketId);
            } else {
                // Released - check if dropped in bucket
                // Add 504px offset for OnDeckSection position
                const bucketId = checkBucketCollision(cardLeft + ox, 452 + 16 + oy);
                setHighlightedBucket(null);

                if (bucketId) {
                    handleCardSort(bucketId);
                }
            }
        },
        {
            from: () => [x.get(), y.get()],
            bounds: { left: -cardLeft, right: viewportWidth - cardLeft - BUCKET_WIDTH, top: -468, bottom: 100 },
        }
    );

    if (loading) {
        return (
            <Box className="sort-cards__loading-wrapper" sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
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
                <Header className="sort-cards__header">
                    <Toolbar className="sort-cards__toolbar">
                        <IconButton className="sort-cards__back-button" onClick={() => navigate("/flashcards/decks")} size="small">
                            <ExpandMoreIcon className="sort-cards__back-icon" sx={{ transform: "rotate(90deg)" }} />
                        </IconButton>
                        <Typography
                            className="sort-cards__title"
                            sx={{
                                flex: 1,
                                fontSize: 16,
                                fontWeight: 400,
                                color: COLORS.onSurface,
                                fontFamily: '"Inter", sans-serif',
                            }}
                        >
                            Sort Cards
                        </Typography>
                        <MobileNavDrawer />
                    </Toolbar>
                </Header>
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
            <Header className="sort-cards__header">
                <Toolbar className="sort-cards__toolbar">
                    <IconButton className="sort-cards__back-button" onClick={() => navigate("/flashcards/decks")} size="small">
                        <ExpandMoreIcon className="sort-cards__back-icon" sx={{ transform: "rotate(90deg)" }} />
                    </IconButton>
                    <Typography
                        className="sort-cards__title"
                        sx={{
                            flex: 1,
                            fontSize: 16,
                            fontWeight: 400,
                            color: COLORS.onSurface,
                            fontFamily: '"Inter", sans-serif',
                        }}
                    >
                        Sort Cards
                    </Typography>
                    {/* Undo and hamburger on the right */}
                    <IconButton
                        className="sort-cards__undo-button"
                        onClick={handleUndo}
                        size="small"
                        disabled={history.length === 0}
                    >
                        <UndoIcon className="sort-cards__undo-icon" />
                    </IconButton>
                    <MobileNavDrawer />
                </Toolbar>
            </Header>

                {/* Content Area */}
                <ContentArea className="sort-cards__content" ref={containerRef}>
                    {/* Buckets */}
                    <BucketsContainer className="sort-cards__buckets-container">
                        {buckets.map((bucket) => (
                            <Bucket
                                className="sort-cards__bucket"
                                key={bucket.id}
                                mainColor={bucket.mainColor}
                                accentColor={bucket.accentColor}
                                x={bucket.x}
                                y={bucket.y}
                                highlight={highlightedBucket === bucket.id}
                            >
                                <div className="bucket-inner">
                                    <div className="bucket-text">{bucket.label}</div>
                                </div>
                            </Bucket>
                        ))}
                    </BucketsContainer>

                    {/* On Deck Section with Draggable Card */}
                    <OnDeckSection className="sort-cards__on-deck">
                        <FlashCard
                            className="sort-cards__flash-card"
                            {...bind()}
                            style={{
                                x,
                                y,
                                scale,
                                opacity,
                                position: "absolute",
                                left: cardLeft,
                                top: 16,
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
