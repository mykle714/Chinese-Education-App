import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import {
    Box, Typography, Alert, Button, Snackbar, IconButton,
    Dialog, DialogTitle, DialogContent, DialogActions, TextField,
} from "@mui/material";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import AddIcon from "@mui/icons-material/Add";
import { styled } from "@mui/material/styles";
import MobileTabScreen from "../../components/MobileTabScreen";
import { useAuth } from "../../AuthContext";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useCategoryCounts } from "../../hooks/useCategoryCounts";
import { FooterSpacer } from "../../components/MobileFooter";
import { fetchDecks, createDeck, type DeckSummary } from "../../api/decks";
import { deckAccentColor } from "./collectionRef";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";

// ── What this page is now ─────────────────────────────────────────────────────
//
// /decks used to BE the Learn Now card grid: it fetched every non-mastered library
// card and rendered them inline, with a search bar and a link row to the separate
// Mastered page. Those cards moved to CollectionViewPage
// (/flashcards/collection/learn-now), and the space they used is now the DECK LIST
// — the user's own named card sets (docs/DECKS_FEATURE.md).
//
// So the page is three stacked bands:
//   1. Review / Study Mix / Challenge — whole-library study entry points
//   2. Two collection rows — Learn Now and Mastered, styled identically, each
//      opening a CollectionViewPage
//   3. Decks              — the user's sets, plus "New deck"
//
// Phone-frame sizing comes from MobileDemoFrame via Layout.tsx; the scroll-away
// header + floating footer + scroll behavior come from MobileTabScreen.
//
// Inverted grey/white scheme, scoped to /decks only: the page surface is painted
// with the grey header tone (passed as MobileTabScreen `surfaceColor`).
const CONTENT_SX = {
    alignItems: "center",
} as const;

// Shared look for the three study-entry buttons (Review / Study Mix / Challenge).
// Review and Challenge add their own color; Study Mix uses the neutral header surface.
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
// between the Review/Challenge buttons with a fixed footprint so those two flex to
// fill the remaining side space.
const MixButton = styled(Button)(() => ({
    ...studyButtonBase,
    backgroundColor: COLORS.header,
    color: COLORS.onSurface,
    border: `2px solid ${COLORS.border}`,
    // Keep Study Mix at its original half-width footprint; Review/Challenge split the rest.
    flex: "0 0 50%",
    "&:hover": {
        backgroundColor: COLORS.header,
    },
}));

// Review (blue) / Challenge (red) difficulty entry buttons. They flank Study Mix and flex to
// take the remaining side space. `greyed` renders a non-interactive-looking
// disabled state WITHOUT the `disabled` prop, so taps still fire onClick to
// surface the "mark more cards" toast.
// The two differ only by accent color, so the shared shape lives here — notably
// the SMALLER type: "Review" and "Challenge" are longer words than the "Easy"/
// "Hard" they replaced, and at the base bodyLg size they crowd their buttons
// (which flex to whatever width Study Mix leaves them). One step down the scale
// keeps each label on a single line at the narrowest phone width.
const GREYED_BG = "#C7C7CC";
const difficultyButtonStyle = (greyed: boolean | undefined, accent: string, hover: string) => ({
    ...studyButtonBase,
    flex: 1,
    fontSize: SIZE.body,
    color: COLORS.onSurface,
    backgroundColor: greyed ? GREYED_BG : accent,
    opacity: greyed ? 0.6 : 1,
    "&:hover": {
        backgroundColor: greyed ? GREYED_BG : hover,
    },
});

// Softer blue accent tone from the deck buckets (Mastered accent).
const ReviewButton = styled(Button, {
    shouldForwardProp: (prop) => prop !== "greyed",
})<{ greyed?: boolean }>(({ greyed }) => difficultyButtonStyle(greyed, COLORS.blueAccent, "#A6C9EC"));

// Softer red accent tone from the deck buckets (Unfamiliar accent).
const ChallengeButton = styled(Button, {
    shouldForwardProp: (prop) => prop !== "greyed",
})<{ greyed?: boolean }>(({ greyed }) => difficultyButtonStyle(greyed, COLORS.redAccent, "#EBA6B9"));

const LineSeparator = styled(Box)(() => ({
    width: 280,
    height: 1,
    backgroundColor: COLORS.border,
    margin: "0 auto",
}));

// Full-width tappable row linking to a CollectionViewPage. Both built-in
// collections (Learn Now, Mastered) use it, so the two sit side by side in the
// same visual language — that identical styling is the point: Learn Now stopped
// being "the page you are on" and became a collection like any other.
const CollectionLinkRow = styled(Box)(() => ({
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

// One user-authored deck. A rounded card carrying the deck's derived pastel (see
// deckAccentColor — the color is computed from the id, not stored), matching the
// Home/Games hub card language without pulling in HubMenuRow's icon-tile layout,
// which a deck has nothing to put in.
const DeckCard = styled(Box, {
    shouldForwardProp: (prop) => prop !== "bgcolor",
})<{ bgcolor: string }>(({ bgcolor }) => ({
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 18px",
    borderRadius: "12px",
    backgroundColor: bgcolor,
    cursor: "pointer",
    boxShadow: "2px 4px 4px rgba(0, 0, 0, 0.15)",
}));

// Main Component
const FlashcardsDecksPage: React.FC = () => {
    usePageTitle("Decks");
    const navigate = useNavigate();
    // Collection pages are node drill-ins that slide over this page, so they use
    // the view-transition navigate and Decks is held beneath. See useSlideNavigate.
    const slideNavigate = useSlideNavigate();
    const { isAuthenticated } = useAuth();
    // Per-category library card counts, driving the two collection rows' figures
    // and the Review eligibility check. These count SORTED cards only — never the
    // temporary cards a game may have lent (docs/PROVISIONAL_CARDS.md), so the
    // sizes shown here always mean "cards you chose to keep".
    const { counts: categoryCounts } = useCategoryCounts();
    // Toast shown when a greyed Review button is tapped (no eligible cards yet).
    const [markMoreSnackOpen, setMarkMoreSnackOpen] = useState(false);

    // The user's decks in their current language.
    const [decks, setDecks] = useState<DeckSummary[]>([]);
    const [decksLoading, setDecksLoading] = useState(true);
    const [decksError, setDecksError] = useState<string | null>(null);
    const [newDeckOpen, setNewDeckOpen] = useState(false);
    const [newDeckName, setNewDeckName] = useState("");
    const [createError, setCreateError] = useState<string | null>(null);

    const loadDecks = useCallback(async () => {
        try {
            setDecksLoading(true);
            setDecksError(null);
            setDecks(await fetchDecks());
        } catch (err: unknown) {
            console.error("Error loading decks:", err);
            setDecksError(err instanceof Error ? err.message : "Could not load your decks");
        } finally {
            setDecksLoading(false);
        }
    }, []);

    // Keyed on isAuthenticated — the stable auth-presence flag, not the `token`
    // string — so a silent refresh doesn't re-fetch and reset the list.
    // See CLAUDE.md "Never reload on token refresh".
    useEffect(() => {
        if (isAuthenticated) loadDecks();
    }, [isAuthenticated, loadDecks]);

    // NO CARD-COUNT GATE into /flashcards/learn (docs/PROVISIONAL_CARDS.md).
    //
    // This used to refuse navigation below a 20-card minimum and toast the user
    // toward Discover. flp now tops itself up server-side: the working-loop endpoint
    // lends temporary cards to reach the flp baseline, so an empty deck opens a full
    // study session instead of a dead button.
    const handleMixClick = () => {
        navigate("/flashcards/learn");
    };

    // REVIEW draws from Comfortable+Mastered; CHALLENGE from Unfamiliar+Target
    // (server MODE_CONFIGS, OnDeckVocabService.ts).
    //
    // REVIEW still needs real cards: Comfortable and Mastered are EARNED bands, and a
    // lent card starts with an empty mark history, so provisioning can never populate
    // them. Greying Review is therefore a statement about the learner's progress, not
    // a card-count wall.
    //
    // CHALLENGE has NO eligibility check at all. Its buckets are exactly the ones
    // provisioning fills — a lent card is Unfamiliar — so the server can always build
    // a Challenge loop, even for an account with nothing sorted.
    const reviewEligible = ((categoryCounts["Comfortable"] || 0) + (categoryCounts["Mastered"] || 0)) > 0;

    const handleReviewClick = () => {
        if (!reviewEligible) { setMarkMoreSnackOpen(true); return; }
        navigate("/flashcards/learn?mode=review");
    };

    const handleChallengeClick = () => {
        navigate("/flashcards/learn?mode=challenge");
    };

    const handleCreateDeck = async () => {
        try {
            const deck = await createDeck(newDeckName);
            setDecks((prev) => [deck, ...prev]);
            setNewDeckOpen(false);
            setNewDeckName("");
            setCreateError(null);
        } catch (err: unknown) {
            // The server owns the rules (blank name, duplicate name, the 100-deck
            // per-language cap), so its message is shown verbatim rather than
            // re-deriving them here where they would drift.
            setCreateError(err instanceof Error ? err.message : "Could not create the deck");
        }
    };

    // Learn Now's size is every sorted card that isn't mastered — the same set its
    // collection page lists. Derived from the counts already loaded rather than a
    // second request.
    const learnNowCount =
        (categoryCounts["Unfamiliar"] || 0) +
        (categoryCounts["Target"] || 0) +
        (categoryCounts["Comfortable"] || 0);

    return (
        <>
            <MobileTabScreen
                title="Decks & Cards"
                activePage="flashcards"
                surfaceColor={COLORS.header}
                contentClassName="decks-page-content"
                contentSx={CONTENT_SX}
            >
                    {/* Study-entry row: Review (blue) and Challenge (red) flank the centered
                        Study Mix button and flex to fill the remaining side space. These are
                        WHOLE-LIBRARY entry points; to study one collection, open it and
                        use its "Play with these cards" button. */}
                    <Box
                        className="flashcards-decks__mode-row"
                        sx={{ width: "100%", padding: "16px 20px", display: "flex", alignItems: "stretch", gap: 1.5 }}
                    >
                        <ReviewButton
                            className="flashcards-decks__review-button"
                            greyed={!reviewEligible}
                            onClick={handleReviewClick}
                        >
                            Review
                        </ReviewButton>
                        <MixButton className="flashcards-decks__mix-button" onClick={handleMixClick}>
                            Study Mix
                        </MixButton>
                        <ChallengeButton
                            className="flashcards-decks__challenge-button"
                            onClick={handleChallengeClick}
                        >
                            Challenge
                        </ChallengeButton>
                    </Box>

                    <LineSeparator className="decks-line-separator" />

                    {/* The two built-in collections. Identically styled and adjacent,
                        because they are the same kind of thing. */}
                    <CollectionLinkRow
                        className="flashcards-decks__library-link"
                        onClick={() => slideNavigate("/flashcards/collection/learn-now")}
                    >
                        <Typography
                            className="flashcards-decks__library-link-label"
                            sx={{
                                fontSize: SIZE.body,
                                fontWeight: WEIGHT.medium,
                                color: COLORS.onSurface,
                                fontFamily: FONTS.sans,
                            }}
                        >
                            Learn Now
                            <Box
                                component="span"
                                className="flashcards-decks__library-link-count"
                                sx={{ color: COLORS.textSecondary, ml: 1, fontWeight: WEIGHT.regular }}
                            >
                                ({learnNowCount})
                            </Box>
                        </Typography>
                        <ChevronRightIcon
                            className="flashcards-decks__library-link-chevron"
                            sx={{ color: COLORS.textSecondary }}
                        />
                    </CollectionLinkRow>

                    <CollectionLinkRow
                        className="flashcards-decks__mastered-link"
                        onClick={() => slideNavigate("/flashcards/collection/mastered")}
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
                    </CollectionLinkRow>

                    <LineSeparator className="decks-line-separator" sx={{ mt: 1 }} />

                    {/* ── Decks ── the space the Learn Now grid used to occupy. */}
                    <Box
                        className="flashcards-decks__decks-header"
                        sx={{ width: "100%", px: 3.5, pt: 2, pb: 1, display: "flex", alignItems: "center", justifyContent: "space-between" }}
                    >
                        <Typography
                            className="flashcards-decks__decks-label"
                            sx={{
                                fontSize: SIZE.body,
                                fontWeight: WEIGHT.medium,
                                color: COLORS.onSurface,
                                fontFamily: FONTS.sans,
                            }}
                        >
                            Decks
                        </Typography>
                        <IconButton
                            className="flashcards-decks__new-deck-button"
                            aria-label="New deck"
                            size="small"
                            onClick={() => { setNewDeckName(""); setCreateError(null); setNewDeckOpen(true); }}
                            sx={{ color: COLORS.onSurface }}
                        >
                            <AddIcon />
                        </IconButton>
                    </Box>

                    <Box
                        className="flashcards-decks__decks-list"
                        sx={{ width: 364, maxWidth: "100%", px: 3.5, display: "flex", flexDirection: "column", gap: 1.25 }}
                    >
                        {decksError && (
                            <Typography
                                className="flashcards-decks__decks-error"
                                sx={{ fontSize: SIZE.body, fontFamily: FONTS.sans, color: COLORS.textSecondary }}
                            >
                                {decksError}
                            </Typography>
                        )}
                        {!decksError && !decksLoading && decks.length === 0 && (
                            <Typography
                                className="flashcards-decks__decks-empty"
                                sx={{ fontSize: SIZE.body, fontFamily: FONTS.sans, color: COLORS.textSecondary }}
                            >
                                No decks yet. Tap + to make one, then add cards to it from any card&apos;s detail page.
                            </Typography>
                        )}
                        {decks.map((deck) => (
                            <DeckCard
                                key={deck.id}
                                className="flashcards-decks__deck-card"
                                bgcolor={deckAccentColor(deck.id)}
                                onClick={() => slideNavigate(`/flashcards/deck/${deck.id}`)}
                            >
                                <Typography
                                    className="flashcards-decks__deck-name"
                                    sx={{
                                        fontSize: SIZE.body,
                                        fontWeight: WEIGHT.medium,
                                        color: COLORS.onSurface,
                                        fontFamily: FONTS.sans,
                                        // A 64-char name must not push the count off the card.
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    {deck.name}
                                </Typography>
                                <Typography
                                    className="flashcards-decks__deck-count"
                                    sx={{
                                        fontSize: SIZE.body,
                                        color: COLORS.textSecondary,
                                        fontFamily: FONTS.sans,
                                        flexShrink: 0,
                                        ml: 1,
                                    }}
                                >
                                    {deck.cardCount}
                                </Typography>
                            </DeckCard>
                        ))}
                    </Box>

                    <FooterSpacer />
            </MobileTabScreen>

                {/* Toast: greyed Review tapped — user has no eligible cards yet */}
                <Snackbar
                    className="flashcards-decks__mark-more-snackbar"
                    open={markMoreSnackOpen}
                    autoHideDuration={5000}
                    onClose={() => setMarkMoreSnackOpen(false)}
                    anchorOrigin={{ vertical: "top", horizontal: "center" }}
                    sx={{ zIndex: 2000 }}
                >
                    <Alert
                        className="flashcards-decks__mark-more-alert"
                        severity="info"
                        variant="filled"
                        onClose={() => setMarkMoreSnackOpen(false)}
                    >
                        Mark more cards in Study Mix to unlock this deck.
                    </Alert>
                </Snackbar>

                <Dialog
                    className="flashcards-decks__new-deck-dialog"
                    open={newDeckOpen}
                    onClose={() => setNewDeckOpen(false)}
                >
                    <DialogTitle>New deck</DialogTitle>
                    <DialogContent>
                        <TextField
                            className="flashcards-decks__new-deck-input"
                            autoFocus
                            fullWidth
                            size="small"
                            placeholder="Deck name"
                            value={newDeckName}
                            onChange={(e) => setNewDeckName(e.target.value)}
                            inputProps={{ maxLength: 64 }}
                            error={Boolean(createError)}
                            helperText={createError ?? " "}
                            sx={{ mt: 1, minWidth: 260 }}
                        />
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setNewDeckOpen(false)}>Cancel</Button>
                        <Button onClick={handleCreateDeck} disabled={!newDeckName.trim()}>Create</Button>
                    </DialogActions>
                </Dialog>
        </>
    );
};

export default FlashcardsDecksPage;
