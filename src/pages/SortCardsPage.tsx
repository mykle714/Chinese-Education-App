import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Box, Typography, IconButton, CircularProgress } from "@mui/material";
import { styled } from "@mui/material/styles";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import UndoIcon from "@mui/icons-material/Undo";
import { useDrag } from "@use-gesture/react";
import { useSpring, animated } from "@react-spring/web";
import MobileFooter from "../components/MobileFooter";
import { API_BASE_URL } from "../constants";
import type { Language, VocabEntry } from "../types";

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
    borderRadius: "20px",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    maxWidth: 393,
    width: "100%",
    margin: "0 auto",
    minHeight: "852px",
    height: "100vh",
    maxHeight: "932px",
    border: `1px solid ${COLORS.border}`,
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
    width: 393,
    height: 504,
    position: "relative",
    flexShrink: 0,
});

const Bucket = styled(Box)<{ mainColor: string; accentColor: string; x: number; y: number; highlight?: boolean }>(
    ({ mainColor, accentColor, x, y, highlight }) => ({
        position: "absolute",
        left: x,
        top: y,
        width: 153,
        height: 222,
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
            fontSize: 14,
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
    top: 504,
    width: 393,
    height: 252,
    backgroundColor: COLORS.header,
    borderTop: `2px dashed ${COLORS.border}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
});

const AnimatedBox = animated(Box);

const FlashCard = styled(AnimatedBox)({
    width: 153,
    height: 220.94,
    backgroundColor: COLORS.cardColor,
    borderRadius: 12,
    boxShadow: "2px 4px 4px rgba(0, 0, 0, 0.25)",
    padding: 8,
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 80,
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

const BUCKETS: BucketZone[] = [
    { id: "already-learned", label: "Already Learned", x: 29, y: 20, mainColor: COLORS.redMain, accentColor: COLORS.redAccent },
    { id: "library", label: "Add to\nLibrary", x: 211, y: 20, mainColor: COLORS.greenMain, accentColor: COLORS.greenAccent },
    { id: "skip", label: "Skip for now", x: 29, y: 262, mainColor: COLORS.blueMain, accentColor: COLORS.blueAccent },
    { id: "learn-later", label: "Add to Learn Later", x: 211, y: 262, mainColor: COLORS.yellowMain, accentColor: COLORS.yellowAccent },
];

const SortCardsPage: React.FC = () => {
    const navigate = useNavigate();
    const { language } = useParams<{ language: Language }>();
    const [cards, setCards] = useState<VocabEntry[]>([]);
    const [currentCardIndex, setCurrentCardIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [highlightedBucket, setHighlightedBucket] = useState<string | null>(null);
    const [history, setHistory] = useState<Array<{ card: VocabEntry; bucket: string }>>([]);
    const containerRef = useRef<HTMLDivElement>(null);

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

    // Check if card is dropped in a bucket
    const checkBucketCollision = (cardX: number, cardY: number): string | null => {
        if (!containerRef.current) return null;

        const containerRect = containerRef.current.getBoundingClientRect();
        const cardCenterX = cardX + 153 / 2; // Card width / 2
        const cardCenterY = cardY + 220.94 / 2; // Card height / 2

        for (const bucket of BUCKETS) {
            const bucketLeft = bucket.x;
            const bucketTop = bucket.y;
            const bucketRight = bucket.x + 153;
            const bucketBottom = bucket.y + 222;

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
                const bucketId = checkBucketCollision(120 + ox, 504 + 15.53 + oy);
                setHighlightedBucket(bucketId);
            } else {
                // Released - check if dropped in bucket
                // Add 504px offset for OnDeckSection position
                const bucketId = checkBucketCollision(120 + ox, 504 + 15.53 + oy);
                setHighlightedBucket(null);

                if (bucketId) {
                    handleCardSort(bucketId);
                }
            }
        },
        {
            from: () => [x.get(), y.get()],
            bounds: { left: -120, right: 273, top: -520, bottom: 100 },
        }
    );

    if (loading) {
        return (
            <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
                <CircularProgress />
            </Box>
        );
    }

    if (!currentCard) {
        return (
            <Box
                sx={{ display: "flex", justifyContent: "center", padding: 2, minHeight: "100vh" }}
            >
                <IPhoneFrame>
                    <Header>
                        <Toolbar>
                            <IconButton onClick={() => navigate("/discover")} size="small">
                                <ExpandMoreIcon sx={{ transform: "rotate(90deg)" }} />
                            </IconButton>
                            <Typography
                                sx={{
                                    fontSize: 16,
                                    fontWeight: 400,
                                    color: COLORS.onSurface,
                                    fontFamily: '"Inter", sans-serif',
                                }}
                            >
                                Sort Cards
                            </Typography>
                        </Toolbar>
                    </Header>
                    <ContentArea>
                        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
                            <Typography>All cards sorted! 🎉</Typography>
                        </Box>
                    </ContentArea>
                    <MobileFooter activePage="discover" />
                </IPhoneFrame>
            </Box>
        );
    }

    return (
        <Box
            sx={{ display: "flex", justifyContent: "center", padding: 2, minHeight: "100vh" }}
        >
            <IPhoneFrame>
                {/* Header */}
                <Header>
                    <Toolbar>
                        <IconButton onClick={() => navigate("/discover")} size="small">
                            <ExpandMoreIcon sx={{ transform: "rotate(90deg)" }} />
                        </IconButton>
                        <Typography
                            sx={{
                                fontSize: 16,
                                fontWeight: 400,
                                color: COLORS.onSurface,
                                fontFamily: '"Inter", sans-serif',
                            }}
                        >
                            Sort Cards
                        </Typography>
                        <Box sx={{ position: "absolute", right: 12 }}>
                            <IconButton
                                onClick={handleUndo}
                                size="small"
                                disabled={history.length === 0}
                            >
                                <UndoIcon />
                            </IconButton>
                        </Box>
                    </Toolbar>
                </Header>

                {/* Content Area */}
                <ContentArea ref={containerRef}>
                    {/* Buckets */}
                    <BucketsContainer>
                        {BUCKETS.map((bucket) => (
                            <Bucket
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
                    <OnDeckSection>
                        <FlashCard
                            {...bind()}
                            style={{
                                x,
                                y,
                                scale,
                                opacity,
                                position: "absolute",
                                left: 120,
                                top: 15.53,
                            }}
                        >
                            <Box sx={{ width: 106, height: 83, backgroundColor: "#e0e0e0", borderRadius: 1 }} />
                            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                                <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                                    <Typography sx={{ fontSize: 24, fontWeight: 400, letterSpacing: "0.08em" }}>
                                        {currentCard.entryKey}
                                    </Typography>
                                    {currentCard.pronunciation && (
                                        <Typography sx={{ fontSize: 10, fontWeight: 400 }}>
                                            {currentCard.pronunciation}
                                        </Typography>
                                    )}
                                </Box>
                                <Typography sx={{ fontSize: 14, fontWeight: 400, textAlign: "center" }}>
                                    {currentCard.entryValue}
                                </Typography>
                            </Box>
                        </FlashCard>
                    </OnDeckSection>
                </ContentArea>

                {/* Footer */}
                <MobileFooter activePage="discover" />
            </IPhoneFrame>
        </Box>
    );
};

export default SortCardsPage;
