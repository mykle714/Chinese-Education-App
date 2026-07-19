import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { Box, Typography, Alert, Button, Snackbar, TextField, InputAdornment, IconButton } from "@mui/material";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { Search, Clear } from "@mui/icons-material";
import { styled } from "@mui/material/styles";
import MobileTabScreen from "../../components/MobileTabScreen";
import MiniVocabCardGrid from "../../components/MiniVocabCardGrid";
import { useAuth } from "../../AuthContext";
import { API_BASE_URL } from "../../constants";
import type { VocabEntry } from "../../types";
import { filterVocabEntries } from "../../utils/vocabSearch";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useDiscoverNavigation } from "../../hooks/useDiscoverNavigation";
import { useCategoryCounts } from "../../hooks/useCategoryCounts";
import { FooterSpacer } from "../../components/MobileFooter";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";

// Minimum number of cards a user must have sorted into their library before the
// /flashcards/learn page is worth opening. Below this, we nudge them to Discover
// instead of letting them land on a near-empty study session.
const MIN_LIBRARY_CARDS = 20;

// Styled Components — phone-frame sizing comes from MobileDemoFrame via Layout.tsx;
// the scroll-away header + floating footer + scroll behavior come from
// MobileTabScreen.
// Inverted grey/white scheme, scoped to /decks only: the page surface is painted
// with the grey header tone (passed as MobileTabScreen `surfaceColor`) while the
// mini cards inside flip to the near-white page tone (COLORS.background). The
// shared MobileDemoFrame and MiniVocabCard keep their normal colors everywhere else.
const CONTENT_SX = {
    alignItems: "center",
    "& .mini-vocab-card": {
        backgroundColor: COLORS.background,
    },
} as const;

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
    backgroundColor: greyed ? "#C7C7CC" : COLORS.blueAccent,
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
    backgroundColor: greyed ? "#C7C7CC" : COLORS.redAccent,
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

// Full-width tappable row that replaces the old inline Mastered preview: it links
// to the dedicated /flashcards/mastered page (mastered decks can be large, so they
// live on their own page rather than rendering hundreds of cards inline here).
const MasteredLinkRow = styled(Box)(() => ({
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "18px 28px",
    cursor: "pointer",
    transition: "background-color 0.15s ease-in-out",
    "&:hover": {
        backgroundColor: COLORS.header,
    },
}));

// Main Component
const FlashcardsDecksPage: React.FC = () => {
    usePageTitle("Decks");
    const navigate = useNavigate();
    // For drill-ins that slide over this page (Mastered = node, Card Detail = leaf),
    // use the view-transition navigate so Decks is held beneath. See useSlideNavigate.
    const slideNavigate = useSlideNavigate();
    const location = useLocation();
    const { token, isAuthenticated } = useAuth();
    const { goToDiscover } = useDiscoverNavigation();
    const [vocabEntries, setVocabEntries] = useState<VocabEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    // Client-side search over the loaded Learn Now deck. Supports the same query
    // formats as the dictionary search bars (CJK / numbered pinyin / toneless
    // pinyin / English) via filterVocabEntries — no network round trip since the
    // deck is already in memory.
    const [searchInput, setSearchInput] = useState("");
    // Mastered cards now live on their own page (/flashcards/mastered); this page
    // only needs the count for the link row, which comes from categoryCounts.
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
    // Keyed on isAuthenticated — the stable auth-presence flag, not the `token`
    // string — so a silent refresh doesn't re-fetch and reset the deck list.
    // See CLAUDE.md "Never reload on token refresh".
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthenticated]);

    // Refresh card lists when navigating back from CDP after an action
    useEffect(() => {
        if (location.state?.refresh) {
            refetchCards();
        }
    }, [location.state?.refresh]);

    // The Learn Now preview gates its staggered pop-in cascade behind this flag.
    const allCardsLoaded = !loading;

    // Apply the search filter. Referentially stable while the query and deck are
    // unchanged, so MiniVocabCardGrid's reveal cascade isn't restarted each render.
    const filteredEntries = useMemo(
        () => filterVocabEntries(vocabEntries, searchInput),
        [vocabEntries, searchInput]
    );
    const isSearching = searchInput.trim().length > 0;

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

    // Stable card-tap handler shared by both previews. Defined once (not an
    // inline arrow per card) so the memoized MiniVocabCards don't all re-render
    // whenever this page re-renders (e.g. a snackbar toggling).
    const handleCardClick = useCallback(
        (entry: VocabEntry) => slideNavigate(`/flashcards/card/${entry.id}`),
        [slideNavigate]
    );

    // Refetch both card lists
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
    };

    return (
        <>
            <MobileTabScreen
                title="Decks & Cards"
                activePage="flashcards"
                surfaceColor={COLORS.header}
                contentClassName="decks-page-content"
                contentSx={CONTENT_SX}
            >
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

                    {/* Client-side search over the loaded Learn Now deck. Sized to
                        the 364px card grid so the input lines up over the cards. */}
                    <Box className="flashcards-decks__library-search" sx={{ width: 364, maxWidth: "100%", px: 3.5, pb: 1 }}>
                        <TextField
                            className="flashcards-decks__library-search-input"
                            fullWidth
                            size="small"
                            placeholder="Search Learn Now cards..."
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            InputProps={{
                                startAdornment: (
                                    <InputAdornment position="start">
                                        <Search />
                                    </InputAdornment>
                                ),
                                endAdornment: searchInput && (
                                    <InputAdornment position="end">
                                        <IconButton
                                            aria-label="clear search"
                                            onClick={() => setSearchInput("")}
                                            edge="end"
                                            size="small"
                                        >
                                            <Clear />
                                        </IconButton>
                                    </InputAdornment>
                                ),
                            }}
                        />
                    </Box>

                    {/* Vocabulary Cards Preview */}
                    <MiniVocabCardGrid
                        containerClassName="decks-cards-preview"
                        classPrefix="flashcards-decks__library"
                        loading={!allCardsLoaded}
                        error={error}
                        entries={filteredEntries}
                        emptyMessage={
                            isSearching
                                ? "No Learn Now cards match your search."
                                : "Please go to the Discover tab to select cards you would like to learn"
                        }
                        onCardClick={handleCardClick}
                    />

                    {/* Line Separator */}
                    <LineSeparator className="decks-line-separator" sx={{ mt: 2 }} />

                    {/* Mastered Cards link — the full list lives on its own page so a
                        large mastered deck never renders hundreds of cards inline. */}
                    <MasteredLinkRow
                        className="flashcards-decks__mastered-link"
                        onClick={() => slideNavigate('/flashcards/mastered')}
                    >
                        <Typography
                            className="flashcards-decks__mastered-link-label"
                            sx={{
                                fontSize: SIZE.body,
                                fontWeight: WEIGHT.medium,
                                color: COLORS.onSurface,
                                fontFamily: FONTS.sans,
                            }}
                        >
                            Mastered Cards
                            <Box
                                component="span"
                                className="flashcards-decks__mastered-link-count"
                                sx={{ color: COLORS.textSecondary, ml: 1, fontWeight: WEIGHT.regular }}
                            >
                                ({categoryCounts["Mastered"] || 0})
                            </Box>
                        </Typography>
                        <ChevronRightIcon
                            className="flashcards-decks__mastered-link-chevron"
                            sx={{ color: COLORS.textSecondary }}
                        />
                    </MasteredLinkRow>

                    <FooterSpacer />
            </MobileTabScreen>

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
