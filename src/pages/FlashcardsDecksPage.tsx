import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Typography, CircularProgress, Alert, Button, useMediaQuery, useTheme } from "@mui/material";
import { styled } from "@mui/material/styles";
import MobileFooter from "../components/MobileFooter";
import MobileNavDrawer from "../components/MobileNavDrawer";
import MiniVocabCard from "../components/MiniVocabCard";
import { useAuth } from "../AuthContext";
import { API_BASE_URL } from "../constants";
import type { VocabEntry } from "../types";

// Design tokens from Figma
const COLORS = {
    background: "#F9F7F2",
    header: "#D7D7D4",
    onSurface: "#1D1B20",
    border: "#625F63",
    // Deck colors
    blueMain: "#779BE7",
    blueAccent: "#BAD7F2",
    greenMain: "#05C793",
    greenAccent: "#BAF2D8",
    yellowMain: "#FF8E47",
    yellowAccent: "#F2E2BA",
    redMain: "#EF476F",
    redAccent: "#F2BAC9",
};

// Styled Components
const IPhoneFrame = styled(Box)(() => ({
    backgroundColor: COLORS.background,
    borderRadius: 0,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    width: "100vw",
    height: "100vh",
}));

const ContentArea = styled(Box)(() => ({
    flex: 1,
    overflowY: "auto",
    overflowX: "hidden",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
}));

const BucketsContainer = styled(Box)(() => ({
    width: 393,
    height: 140,
    position: "relative",
    flexShrink: 0,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    padding: "0 20px",
}));

const StudyAllButton = styled(Button)(() => ({
    backgroundColor: COLORS.header,
    color: COLORS.onSurface,
    borderRadius: "8px",
    border: `2px solid ${COLORS.border}`,
    padding: "36px 32px",
    fontSize: 32,
    fontWeight: 500,
    fontFamily: '"Inter", sans-serif',
    textTransform: "none",
    boxShadow: "2px 4px 4px rgba(0, 0, 0, 0.25)",
    width: "100%",
    "&:hover": {
        backgroundColor: COLORS.header,
    },
}));

const LineSeparator = styled(Box)(() => ({
    width: 280,
    height: 1,
    backgroundColor: COLORS.border,
    margin: "0 auto",
}));

const CardsPreviewContainer = styled(Box)(() => ({
    width: 393,
    display: "flex",
    flexWrap: "wrap",
    gap: 16,
    padding: 28,
    justifyContent: "flex-start",
}));

// Deck Card Component
interface DeckCardProps {
    label: string;
    mainColor: string;
    accentColor: string;
    onClick: () => void;
}

const DeckCard = styled(Box)<{ mainColor: string; accentColor: string }>(
    ({ mainColor, accentColor }) => ({
        position: "relative",
        width: 80,
        height: 116,
        cursor: "pointer",
        transition: "transform 0.2s ease-in-out",
        flexShrink: 0,
        "&:hover": {
            transform: "translateY(-4px)",
        },
        "& .bucket-layer-3": {
            position: "absolute",
            left: 8,
            top: 8,
            width: 72,
            height: 104,
            backgroundColor: mainColor,
            borderRadius: 8,
            boxShadow: "1px 4px 4px rgba(0, 0, 0, 0.25)",
        },
        "& .bucket-layer-2": {
            position: "absolute",
            left: 4,
            top: 4,
            width: 72,
            height: 104,
            backgroundColor: mainColor,
            borderRadius: 8,
            boxShadow: "1px 4px 4px rgba(0, 0, 0, 0.25)",
        },
        "& .bucket-layer-1": {
            position: "absolute",
            left: 0,
            top: 0,
            width: 72,
            height: 104,
            backgroundColor: mainColor,
            borderRadius: 8,
            boxShadow: "1px 4px 4px rgba(0, 0, 0, 0.25)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
        },
        "& .bucket-inner": {
            width: "calc(100% - 8px)",
            height: "calc(100% - 8px)",
            backgroundColor: accentColor,
            borderRadius: 4,
        },
        "& .bucket-text": {
            position: "absolute",
            width: 60,
            height: 40,
            left: 6,
            top: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10,
            fontWeight: 400,
            lineHeight: 1.21,
            textAlign: "center",
            color: COLORS.onSurface,
            fontFamily: '"Inter", sans-serif',
            zIndex: 1,
        },
    })
);

const DeckCardComponent: React.FC<DeckCardProps> = ({
    label,
    mainColor,
    accentColor,
    onClick,
}) => {
    return (
        <DeckCard
            mainColor={mainColor}
            accentColor={accentColor}
            onClick={onClick}
            className="deck-card"
        >
            <div className="bucket-layer-3" />
            <div className="bucket-layer-2" />
            <div className="bucket-layer-1">
                <div className="bucket-inner" />
                <div className="bucket-text">{label}</div>
            </div>
        </DeckCard>
    );
};

// Main Component
const FlashcardsDecksPage: React.FC = () => {
    const navigate = useNavigate();
    const { token } = useAuth();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down("md"));
    const [vocabEntries, setVocabEntries] = useState<VocabEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [learnLaterEntries, setLearnLaterEntries] = useState<VocabEntry[]>([]);
    const [learnLaterLoading, setLearnLaterLoading] = useState(true);
    const [learnLaterError, setLearnLaterError] = useState<string | null>(null);
    const [masteredEntries, setMasteredEntries] = useState<VocabEntry[]>([]);
    const [masteredLoading, setMasteredLoading] = useState(true);
    const [masteredError, setMasteredError] = useState<string | null>(null);

    // Fetch non-mastered library cards from OnDeck vocab sets
    useEffect(() => {
        const fetchLibraryCards = async () => {
            try {
                setLoading(true);
                setError(null);

                const response = await fetch(`${API_BASE_URL}/api/onDeck/non-mastered-library-cards`, {
                    credentials: 'include',
                });

                if (!response.ok) {
                    throw new Error('Failed to fetch library cards');
                }

                const data = await response.json();
                setVocabEntries(Array.isArray(data) ? data : []);
            } catch (err: unknown) {
                console.error('Error fetching library cards:', err);
                setError(err instanceof Error ? err.message : 'Failed to load library cards');
            } finally {
                setLoading(false);
            }
        };

        if (token) {
            fetchLibraryCards();
        }
    }, [token]);

    // Fetch learn later cards from OnDeck vocab sets
    useEffect(() => {
        const fetchLearnLaterCards = async () => {
            try {
                setLearnLaterLoading(true);
                setLearnLaterError(null);

                const response = await fetch(`${API_BASE_URL}/api/onDeck/learn-later-cards`, {
                    credentials: 'include',
                });

                if (!response.ok) {
                    throw new Error('Failed to fetch learn later cards');
                }

                const data = await response.json();
                setLearnLaterEntries(Array.isArray(data) ? data : []);
            } catch (err: unknown) {
                console.error('Error fetching learn later cards:', err);
                setLearnLaterError(err instanceof Error ? err.message : 'Failed to load learn later cards');
            } finally {
                setLearnLaterLoading(false);
            }
        };

        if (token) {
            fetchLearnLaterCards();
        }
    }, [token]);

    // Fetch mastered library cards from OnDeck vocab sets
    useEffect(() => {
        const fetchMasteredCards = async () => {
            try {
                setMasteredLoading(true);
                setMasteredError(null);

                const response = await fetch(`${API_BASE_URL}/api/onDeck/mastered-library-cards`, {
                    credentials: 'include',
                });

                if (!response.ok) {
                    throw new Error('Failed to fetch mastered cards');
                }

                const data = await response.json();
                setMasteredEntries(Array.isArray(data) ? data : []);
            } catch (err: unknown) {
                console.error('Error fetching mastered cards:', err);
                setMasteredError(err instanceof Error ? err.message : 'Failed to load mastered cards');
            } finally {
                setMasteredLoading(false);
            }
        };

        if (token) {
            fetchMasteredCards();
        }
    }, [token]);

    const handleDeckClick = (category: string) => {
        navigate(`/flashcards/learn?category=${encodeURIComponent(category)}`);
    };

    // Refetch all card lists
    const refetchCards = async () => {
        // Refetch non-mastered library cards
        try {
            setLoading(true);
            const response = await fetch(`${API_BASE_URL}/api/onDeck/non-mastered-library-cards`, {
                credentials: 'include',
            });
            if (response.ok) {
                const data = await response.json();
                setVocabEntries(Array.isArray(data) ? data : []);
            }
        } catch (err) {
            console.error('Error refetching library cards:', err);
        } finally {
            setLoading(false);
        }

        // Refetch learn later cards
        try {
            setLearnLaterLoading(true);
            const response = await fetch(`${API_BASE_URL}/api/onDeck/learn-later-cards`, {
                credentials: 'include',
            });
            if (response.ok) {
                const data = await response.json();
                setLearnLaterEntries(Array.isArray(data) ? data : []);
            }
        } catch (err) {
            console.error('Error refetching learn later cards:', err);
        } finally {
            setLearnLaterLoading(false);
        }

        // Refetch mastered cards
        try {
            setMasteredLoading(true);
            const response = await fetch(`${API_BASE_URL}/api/onDeck/mastered-library-cards`, {
                credentials: 'include',
            });
            if (response.ok) {
                const data = await response.json();
                setMasteredEntries(Array.isArray(data) ? data : []);
            }
        } catch (err) {
            console.error('Error refetching mastered cards:', err);
        } finally {
            setMasteredLoading(false);
        }
    };

    // Handler for skip/delete button - hard-deletes the VocabEntry
    const handleSkipCard = async (entry: VocabEntry) => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/vocabEntries/${entry.id}`, {
                method: 'DELETE',
                credentials: 'include',
            });

            if (!response.ok) {
                throw new Error('Failed to delete card');
            }

            await refetchCards();
        } catch (err) {
            console.error('Error deleting card:', err);
        }
    };

    // Handler for cycle button - toggles between library and learn-later
    const handleCycleCard = async (entry: VocabEntry, currentBucket: 'library' | 'learn-later') => {
        try {
            const targetBucket = currentBucket === 'library' ? 'learn-later' : 'library';

            const response = await fetch(`${API_BASE_URL}/api/starter-packs/sort`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({
                    cardId: entry.id,
                    bucket: targetBucket,
                    language: entry.language,
                }),
            });

            if (!response.ok) {
                throw new Error('Failed to cycle card');
            }

            // Refetch cards to update UI
            await refetchCards();
        } catch (err) {
            console.error('Error cycling card:', err);
        }
    };

    // On desktop the Layout wraps this page normally; restore the phone-frame look
    const desktopFrameSx = !isMobile ? {
        maxWidth: 393,
        width: "100%",
        borderRadius: "20px",
        margin: "0 auto",
        minHeight: "852px",
        maxHeight: "932px",
    } : {};

    return (
        <IPhoneFrame className="decks-page-frame" sx={desktopFrameSx}>
            {/* Header */}
            <PageHeader title="Decks & Cards" rightItems={<MobileNavDrawer />} />

                {/* Content Area */}
                <ContentArea className="decks-page-content">
                    {/* Study All Button */}
                    <Box className="flashcards-decks__study-all-wrapper" sx={{ width: '100%', padding: '16px 20px' }}>
                        <StudyAllButton className="flashcards-decks__study-all-button" onClick={() => navigate('/flashcards/learn')}>
                            Study All
                        </StudyAllButton>
                    </Box>

                    {/* Buckets/Decks Section */}
                    <BucketsContainer className="decks-buckets-container">
                        {/* Unfamiliar - Red */}
                        <DeckCardComponent
                            label="Unfamiliar"
                            mainColor={COLORS.redMain}
                            accentColor={COLORS.redAccent}
                            onClick={() => handleDeckClick("Unfamiliar")}
                        />

                        {/* Target - Yellow */}
                        <DeckCardComponent
                            label="Target"
                            mainColor={COLORS.yellowMain}
                            accentColor={COLORS.yellowAccent}
                            onClick={() => handleDeckClick("Target")}
                        />

                        {/* Comfortable - Green */}
                        <DeckCardComponent
                            label="Comfortable"
                            mainColor={COLORS.greenMain}
                            accentColor={COLORS.greenAccent}
                            onClick={() => handleDeckClick("Comfortable")}
                        />

                        {/* Mastered - Blue */}
                        <DeckCardComponent
                            label="Mastered"
                            mainColor={COLORS.blueMain}
                            accentColor={COLORS.blueAccent}
                            onClick={() => handleDeckClick("Mastered")}
                        />
                    </BucketsContainer>

                    {/* Line Separator */}
                    <LineSeparator className="decks-line-separator" />

                    {/* Library Cards Section */}
                    <Box className="flashcards-decks__library-header" sx={{ width: '100%', px: 3.5, pt: 2, pb: 1 }}>
                        <Typography
                            className="flashcards-decks__library-label"
                            sx={{
                                fontSize: 14,
                                fontWeight: 500,
                                color: COLORS.onSurface,
                                fontFamily: '"Inter", sans-serif',
                            }}
                        >
                            Library
                        </Typography>
                    </Box>

                    {/* Vocabulary Cards Preview */}
                    <CardsPreviewContainer className="decks-cards-preview">
                        {loading ? (
                            // Loading state
                            <Box className="flashcards-decks__library-loading" sx={{ display: 'flex', justifyContent: 'center', width: '100%', py: 4 }}>
                                <CircularProgress className="flashcards-decks__library-spinner" />
                            </Box>
                        ) : error ? (
                            // Error state
                            <Box className="flashcards-decks__library-error" sx={{ width: '100%', px: 2 }}>
                                <Alert className="flashcards-decks__library-error-alert" severity="error">{error}</Alert>
                            </Box>
                        ) : vocabEntries.length === 0 ? (
                            // Empty state
                            <Box className="flashcards-decks__library-empty" sx={{ width: '100%', px: 2 }}>
                                <Alert className="flashcards-decks__library-empty-alert" severity="info">
                                    No library cards yet. Add cards from the Discover page to see them here!
                                </Alert>
                            </Box>
                        ) : (
                            // Display vocabulary cards
                            vocabEntries.map((entry) => (
                                <MiniVocabCard
                                    key={entry.id}
                                    entry={entry}
                                    onClick={(e) => navigate(`/flashcards/card/${e.id}`)}
                                    onDelete={handleSkipCard}
                                    onCycle={(e) => handleCycleCard(e, 'library')}
                                />
                            ))
                        )}
                    </CardsPreviewContainer>

                    {/* Line Separator */}
                    <LineSeparator className="decks-line-separator" sx={{ mt: 2 }} />

                    {/* Learn Later Cards Section */}
                    <Box className="flashcards-decks__learn-later-header" sx={{ width: '100%', px: 3.5, pt: 2, pb: 1 }}>
                        <Typography
                            className="flashcards-decks__learn-later-label"
                            sx={{
                                fontSize: 14,
                                fontWeight: 500,
                                color: COLORS.onSurface,
                                fontFamily: '"Inter", sans-serif',
                            }}
                        >
                            Learn Later
                        </Typography>
                    </Box>

                    {/* Learn Later Cards Preview */}
                    <CardsPreviewContainer className="decks-learn-later-preview">
                        {learnLaterLoading ? (
                            // Loading state
                            <Box className="flashcards-decks__learn-later-loading" sx={{ display: 'flex', justifyContent: 'center', width: '100%', py: 4 }}>
                                <CircularProgress className="flashcards-decks__learn-later-spinner" />
                            </Box>
                        ) : learnLaterError ? (
                            // Error state
                            <Box className="flashcards-decks__learn-later-error" sx={{ width: '100%', px: 2 }}>
                                <Alert className="flashcards-decks__learn-later-error-alert" severity="error">{learnLaterError}</Alert>
                            </Box>
                        ) : learnLaterEntries.length === 0 ? (
                            // Empty state
                            <Box className="flashcards-decks__learn-later-empty" sx={{ width: '100%', px: 2 }}>
                                <Alert className="flashcards-decks__learn-later-empty-alert" severity="info">
                                    No learn later cards yet. Add cards from the Discover page to see them here!
                                </Alert>
                            </Box>
                        ) : (
                            // Display learn later cards
                            learnLaterEntries.map((entry) => (
                                <MiniVocabCard
                                    key={entry.id}
                                    entry={entry}
                                    onClick={(e) => navigate(`/flashcards/card/${e.id}`)}
                                    onDelete={handleSkipCard}
                                    onCycle={(e) => handleCycleCard(e, 'learn-later')}
                                />
                            ))
                        )}
                    </CardsPreviewContainer>

                    {/* Line Separator */}
                    <LineSeparator className="decks-line-separator" sx={{ mt: 2 }} />

                    {/* Mastered Cards Section */}
                    <Box className="flashcards-decks__mastered-header" sx={{ width: '100%', px: 3.5, pt: 2, pb: 1 }}>
                        <Typography
                            className="flashcards-decks__mastered-label"
                            sx={{
                                fontSize: 14,
                                fontWeight: 500,
                                color: COLORS.onSurface,
                                fontFamily: '"Inter", sans-serif',
                            }}
                        >
                            Mastered
                        </Typography>
                    </Box>

                    {/* Mastered Cards Preview */}
                    <CardsPreviewContainer className="decks-mastered-preview">
                        {masteredLoading ? (
                            // Loading state
                            <Box className="flashcards-decks__mastered-loading" sx={{ display: 'flex', justifyContent: 'center', width: '100%', py: 4 }}>
                                <CircularProgress className="flashcards-decks__mastered-spinner" />
                            </Box>
                        ) : masteredError ? (
                            // Error state
                            <Box className="flashcards-decks__mastered-error" sx={{ width: '100%', px: 2 }}>
                                <Alert className="flashcards-decks__mastered-error-alert" severity="error">{masteredError}</Alert>
                            </Box>
                        ) : masteredEntries.length === 0 ? (
                            // Empty state
                            <Box className="flashcards-decks__mastered-empty" sx={{ width: '100%', px: 2 }}>
                                <Alert className="flashcards-decks__mastered-empty-alert" severity="info">
                                    No mastered cards yet. Cards will appear here when you master them through study!
                                </Alert>
                            </Box>
                        ) : (
                            // Display mastered cards - NO onCycle prop (mastered cards can't be cycled)
                            masteredEntries.map((entry) => (
                                <MiniVocabCard
                                    key={entry.id}
                                    entry={entry}
                                    onClick={(e) => navigate(`/flashcards/card/${e.id}`)}
                                    onDelete={handleSkipCard}
                                />
                            ))
                        )}
                    </CardsPreviewContainer>
                </ContentArea>

                {/* Footer */}
                <MobileFooter activePage="home" />
        </IPhoneFrame>
    );
};

export default FlashcardsDecksPage;
