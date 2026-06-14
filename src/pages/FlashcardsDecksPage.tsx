import { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Box, Typography, Alert, Button, Snackbar } from "@mui/material";
import DelayedCircularProgress from "../components/DelayedCircularProgress";
import { styled } from "@mui/material/styles";
import MobileDemoHeader from "../components/MobileDemoHeader";
import MobileFooter from "../components/MobileFooter";
import MiniVocabCard from "../components/MiniVocabCard";
import { useAuth } from "../AuthContext";
import { API_BASE_URL } from "../constants";
import type { VocabEntry } from "../types";
import { usePageTitle } from "../hooks/usePageTitle";
import { useDiscoverNavigation } from "../hooks/useDiscoverNavigation";
import { useCategoryCounts } from "../hooks/useCategoryCounts";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { SIZE, WEIGHT } from "../theme/scale";

// Minimum number of cards a user must have sorted into their library before the
// /flashcards/learn page is worth opening. Below this, we nudge them to Discover
// instead of letting them land on a near-empty study session.
const MIN_LIBRARY_CARDS = 20;

// Per-card delay (ms) for the staggered pop-in cascade, and the cap on how many
// cards get a growing delay. Without a cap, a large deck (hundreds of cards on
// real accounts) would stretch the cascade to 10s+ of continuously-firing
// animations, pinning the main thread and swallowing the first taps. Capping the
// index keeps the whole cascade under ~CARD_STAGGER_MAX × CARD_STAGGER_STEP ms.
const CARD_STAGGER_STEP = 50;
const CARD_STAGGER_MAX = 12;
const cardStaggerDelayMs = (index: number) => Math.min(index, CARD_STAGGER_MAX) * CARD_STAGGER_STEP;

// Styled Components — phone-frame sizing comes from MobileDemoFrame via Layout.tsx
const ContentArea = styled(Box)(() => ({
    flex: 1,
    overflowY: "auto",
    overflowX: "hidden",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
}));

// Shared look for the three study-entry buttons (Easy / Mix / Hard). Easy and
// Hard add their own color; Mix uses the neutral header surface.
const studyButtonBase = {
    borderRadius: "8px",
    padding: "18px 16px",
    fontSize: SIZE.bodyLg,
    fontWeight: WEIGHT.medium,
    fontFamily: FONTS.sans,
    textTransform: "none" as const,
    boxShadow: "2px 4px 4px rgba(0, 0, 0, 0.25)",
};

// Compact entry button into a mixed (all-category) study session. Sits centered
// between the Easy/Hard buttons with a fixed footprint so those two flex to fill
// the remaining side space.
const MixButton = styled(Button)(() => ({
    ...studyButtonBase,
    backgroundColor: COLORS.header,
    color: COLORS.onSurface,
    border: `2px solid ${COLORS.border}`,
    // Keep Mix at its original half-width footprint; Easy/Hard split the rest.
    flex: "0 0 50%",
    "&:hover": {
        backgroundColor: COLORS.header,
    },
}));

// Easy (blue) / Hard (red) difficulty entry buttons. They flank Mix and flex to
// take the remaining side space. `greyed` renders a non-interactive-looking
// disabled state WITHOUT the `disabled` prop, so taps still fire onClick to
// surface the "mark more cards" toast.
const EasyButton = styled(Button, {
    shouldForwardProp: (prop) => prop !== "greyed",
})<{ greyed?: boolean }>(({ greyed }) => ({
    ...studyButtonBase,
    flex: 1,
    // Softer blue accent tone from the deck buckets (Mastered accent).
    color: COLORS.onSurface,
    backgroundColor: greyed ? "#C7C7CC" : "#BAD7F2",
    opacity: greyed ? 0.6 : 1,
    "&:hover": {
        backgroundColor: greyed ? "#C7C7CC" : "#A6C9EC",
    },
}));

const HardButton = styled(Button, {
    shouldForwardProp: (prop) => prop !== "greyed",
})<{ greyed?: boolean }>(({ greyed }) => ({
    ...studyButtonBase,
    flex: 1,
    // Softer red accent tone from the deck buckets (Unfamiliar accent).
    color: COLORS.onSurface,
    backgroundColor: greyed ? "#C7C7CC" : "#F2BAC9",
    opacity: greyed ? 0.6 : 1,
    "&:hover": {
        backgroundColor: greyed ? "#C7C7CC" : "#EBA6B9",
    },
}));

const LineSeparator = styled(Box)(() => ({
    width: 280,
    height: 1,
    backgroundColor: COLORS.border,
    margin: "0 auto",
}));

const CardsPreviewContainer = styled(Box)(() => ({
    // 3 cards × 92px + 2 gaps × 16px + 2 sides × 28px padding = 364px
    width: 364,
    margin: "0 auto",
    display: "flex",
    flexWrap: "wrap",
    gap: 16,
    padding: 28,
    justifyContent: "flex-start",
}));

// Main Component
const FlashcardsDecksPage: React.FC = () => {
    usePageTitle("Decks");
    const navigate = useNavigate();
    const location = useLocation();
    const { token } = useAuth();
    const { goToDiscover } = useDiscoverNavigation();
    const [vocabEntries, setVocabEntries] = useState<VocabEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [learnLaterEntries, setLearnLaterEntries] = useState<VocabEntry[]>([]);
    const [learnLaterLoading, setLearnLaterLoading] = useState(true);
    const [learnLaterError, setLearnLaterError] = useState<string | null>(null);
    const [masteredEntries, setMasteredEntries] = useState<VocabEntry[]>([]);
    const [masteredLoading, setMasteredLoading] = useState(true);
    const [masteredError, setMasteredError] = useState<string | null>(null);
    // Per-category library card counts, used to gate study navigation. We only
    // enforce the MIN_LIBRARY_CARDS gate once counts have loaded (fail open before
    // then, so a slow fetch never blocks a user who has plenty of cards).
    const { counts: categoryCounts, loaded: countsLoaded } = useCategoryCounts();
    // Toast nudging users with too few library cards toward the Discover page.
    const [lowCardSnackOpen, setLowCardSnackOpen] = useState(false);
    // Toast shown when a greyed Easy/Hard button is tapped (no eligible cards yet).
    const [markMoreSnackOpen, setMarkMoreSnackOpen] = useState(false);

    // Fetch non-mastered library cards from OnDeck vocab sets
    useEffect(() => {
        const fetchLibraryCards = async () => {
            try {
                setLoading(true);
                setError(null);

                const response = await fetch(`${API_BASE_URL}/api/onDeck/non-mastered-library-cards`, {
                    credentials: 'include',
                    headers: { 'Authorization': `Bearer ${token}` },
                });

                if (!response.ok) {
                    throw new Error('Failed to fetch Learn Now cards');
                }

                const data = await response.json();
                setVocabEntries(Array.isArray(data) ? data : []);
            } catch (err: unknown) {
                console.error('Error fetching library cards:', err);
                setError(err instanceof Error ? err.message : 'Failed to load Learn Now cards');
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
                    headers: { 'Authorization': `Bearer ${token}` },
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
                    headers: { 'Authorization': `Bearer ${token}` },
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

    // Refresh card lists when navigating back from CDP after an action
    useEffect(() => {
        if (location.state?.refresh) {
            refetchCards();
        }
    }, [location.state?.refresh]);

    // All three card previews (Learn Now / Learn Later / Mastered) load from
    // separate endpoints. We hold every section behind this single flag so the
    // staggered pop-in cascades all fire together once everything is ready, rather
    // than section-by-section as each individual request resolves.
    const allCardsLoaded = !loading && !learnLaterLoading && !masteredLoading;

    // Total cards the user has sorted into their library, across every bucket.
    const totalLibraryCards = Object.values(categoryCounts).reduce((sum, n) => sum + n, 0);

    // Gate every entry point into /flashcards/learn: if the user has too few
    // cards in their library, nudge them to Discover instead of navigating.
    // Returns true when navigation was allowed.
    const guardLearnNavigation = (): boolean => {
        if (countsLoaded && totalLibraryCards < MIN_LIBRARY_CARDS) {
            setLowCardSnackOpen(true);
            return false;
        }
        return true;
    };

    const handleMixClick = () => {
        if (!guardLearnNavigation()) return;
        navigate('/flashcards/learn');
    };

    // Easy mode draws from Comfortable+Mastered; Hard from Unfamiliar+Target. A
    // mode is only usable once the account has at least one eligible card for it.
    const easyEligible = ((categoryCounts["Comfortable"] || 0) + (categoryCounts["Mastered"] || 0)) > 0;
    const hardEligible = ((categoryCounts["Unfamiliar"] || 0) + (categoryCounts["Target"] || 0)) > 0;

    // Easy/Hard handlers. When no eligible cards exist, the button is greyed but
    // still tappable — a tap surfaces the "mark more cards in Mix mode" toast.
    // Otherwise the same 20-card library minimum as Mix applies via the guard.
    const handleEasyClick = () => {
        if (!easyEligible) { setMarkMoreSnackOpen(true); return; }
        if (!guardLearnNavigation()) return;
        navigate('/flashcards/learn?mode=easy');
    };

    const handleHardClick = () => {
        if (!hardEligible) { setMarkMoreSnackOpen(true); return; }
        if (!guardLearnNavigation()) return;
        navigate('/flashcards/learn?mode=hard');
    };

    // Stable card-tap handler shared by all three previews. Defined once (not an
    // inline arrow per card) so the memoized MiniVocabCards don't all re-render
    // whenever this page re-renders (e.g. a snackbar toggling).
    const handleCardClick = useCallback(
        (entry: VocabEntry) => navigate(`/flashcards/card/${entry.id}`),
        [navigate]
    );

    // Refetch all card lists
    const refetchCards = async () => {
        // Refetch non-mastered library cards
        try {
            setLoading(true);
            const response = await fetch(`${API_BASE_URL}/api/onDeck/non-mastered-library-cards`, {
                credentials: 'include',
                headers: { 'Authorization': `Bearer ${token}` },
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
                headers: { 'Authorization': `Bearer ${token}` },
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
                headers: { 'Authorization': `Bearer ${token}` },
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

    return (
        <>
            {/* Header */}
            <MobileDemoHeader title="Decks & Cards" activePage="home" />

                {/* Content Area */}
                <ContentArea className="decks-page-content">
                    {/* Study-entry row: Easy (blue) and Hard (red) flank the centered
                        Mix button and flex to fill the remaining side space. */}
                    <Box
                        className="flashcards-decks__mode-row"
                        sx={{ width: '100%', padding: '16px 20px', display: 'flex', alignItems: 'stretch', gap: 1.5 }}
                    >
                        <EasyButton
                            className="flashcards-decks__easy-button"
                            greyed={!easyEligible}
                            onClick={handleEasyClick}
                        >
                            Easy
                        </EasyButton>
                        <MixButton className="flashcards-decks__mix-button" onClick={handleMixClick}>
                            Mix
                        </MixButton>
                        <HardButton
                            className="flashcards-decks__hard-button"
                            greyed={!hardEligible}
                            onClick={handleHardClick}
                        >
                            Hard
                        </HardButton>
                    </Box>

                    {/* Line Separator */}
                    <LineSeparator className="decks-line-separator" />

                    {/* Library Cards Section */}
                    <Box className="flashcards-decks__library-header" sx={{ width: '100%', px: 3.5, pt: 2, pb: 1 }}>
                        <Typography
                            className="flashcards-decks__library-label"
                            sx={{
                                fontSize: SIZE.body,
                                fontWeight: WEIGHT.medium,
                                color: COLORS.onSurface,
                                fontFamily: FONTS.sans,
                            }}
                        >
                            Learn Now
                        </Typography>
                    </Box>

                    {/* Vocabulary Cards Preview */}
                    <CardsPreviewContainer className="decks-cards-preview">
                        {!allCardsLoaded ? (
                            // Loading state — gated on all sections so the cascades sync.
                            <Box className="flashcards-decks__library-loading" sx={{ display: 'flex', justifyContent: 'center', width: '100%', py: 4 }}>
                                <DelayedCircularProgress className="flashcards-decks__library-spinner" />
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
                                    Please go to the Discover tab to select cards you would like to learn
                                </Alert>
                            </Box>
                        ) : (
                            // Display vocabulary cards — staggered pop-in on load.
                            vocabEntries.map((entry, index) => (
                                <MiniVocabCard
                                    key={entry.id}
                                    entry={entry}
                                    onClick={handleCardClick}
                                    animationDelayMs={cardStaggerDelayMs(index)}
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
                                fontSize: SIZE.body,
                                fontWeight: WEIGHT.medium,
                                color: COLORS.onSurface,
                                fontFamily: FONTS.sans,
                            }}
                        >
                            Learn Later
                        </Typography>
                    </Box>

                    {/* Learn Later Cards Preview */}
                    <CardsPreviewContainer className="decks-learn-later-preview">
                        {!allCardsLoaded ? (
                            // Loading state — gated on all sections so the cascades sync.
                            <Box className="flashcards-decks__learn-later-loading" sx={{ display: 'flex', justifyContent: 'center', width: '100%', py: 4 }}>
                                <DelayedCircularProgress className="flashcards-decks__learn-later-spinner" />
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
                            // Display learn later cards — staggered pop-in on load.
                            learnLaterEntries.map((entry, index) => (
                                <MiniVocabCard
                                    key={entry.id}
                                    entry={entry}
                                    onClick={handleCardClick}
                                    animationDelayMs={cardStaggerDelayMs(index)}
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
                                fontSize: SIZE.body,
                                fontWeight: WEIGHT.medium,
                                color: COLORS.onSurface,
                                fontFamily: FONTS.sans,
                            }}
                        >
                            Mastered
                        </Typography>
                    </Box>

                    {/* Mastered Cards Preview */}
                    <CardsPreviewContainer className="decks-mastered-preview">
                        {!allCardsLoaded ? (
                            // Loading state — gated on all sections so the cascades sync.
                            <Box className="flashcards-decks__mastered-loading" sx={{ display: 'flex', justifyContent: 'center', width: '100%', py: 4 }}>
                                <DelayedCircularProgress className="flashcards-decks__mastered-spinner" />
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
                            // Display mastered cards — staggered pop-in on load.
                            masteredEntries.map((entry, index) => (
                                <MiniVocabCard
                                    key={entry.id}
                                    entry={entry}
                                    onClick={handleCardClick}
                                    animationDelayMs={cardStaggerDelayMs(index)}
                                />
                            ))
                        )}
                    </CardsPreviewContainer>
                </ContentArea>

                {/* Footer */}
                <MobileFooter activePage="home" />

                {/* Nudge toast: too few library cards to start a study session */}
                <Snackbar
                    className="flashcards-decks__low-cards-snackbar"
                    open={lowCardSnackOpen}
                    autoHideDuration={5000}
                    onClose={() => setLowCardSnackOpen(false)}
                    anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
                    sx={{ zIndex: 2000 }}
                >
                    <Alert
                        className="flashcards-decks__low-cards-alert"
                        severity="info"
                        variant="filled"
                        onClose={() => setLowCardSnackOpen(false)}
                        action={
                            <Button
                                className="flashcards-decks__low-cards-action"
                                color="inherit"
                                size="small"
                                onClick={() => {
                                    setLowCardSnackOpen(false);
                                    goToDiscover();
                                }}
                            >
                                Discover
                            </Button>
                        }
                    >
                        Add at least {MIN_LIBRARY_CARDS} cards to your Learn Now deck — head to Discover to sort some cards.
                    </Alert>
                </Snackbar>

                {/* Toast: greyed Easy/Hard tapped — user has no eligible cards yet */}
                <Snackbar
                    className="flashcards-decks__mark-more-snackbar"
                    open={markMoreSnackOpen}
                    autoHideDuration={5000}
                    onClose={() => setMarkMoreSnackOpen(false)}
                    anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
                    sx={{ zIndex: 2000 }}
                >
                    <Alert
                        className="flashcards-decks__mark-more-alert"
                        severity="info"
                        variant="filled"
                        onClose={() => setMarkMoreSnackOpen(false)}
                    >
                        Mark more cards in Mix mode to unlock this deck.
                    </Alert>
                </Snackbar>
        </>
    );
};

export default FlashcardsDecksPage;
