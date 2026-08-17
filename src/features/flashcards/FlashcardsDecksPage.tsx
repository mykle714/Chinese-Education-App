import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import {
    Box, Typography, Alert, Button, Snackbar, IconButton,
    Dialog, DialogTitle, DialogContent, DialogActions, TextField,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { styled } from "@mui/material/styles";
import MobileTabScreen from "../../components/MobileTabScreen";
import DeckTile from "../../components/DeckTile";
import { useAuth } from "../../AuthContext";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useCategoryCounts } from "../../hooks/useCategoryCounts";
import { useMasteredCounts } from "../../hooks/useMasteredCounts";
import type { MasteryGoals } from "../../utils/masteryCompute";
import {
    builtinCollectionCount, builtinCollectionEntries, hasMasteredSection,
} from "./builtinCollections";
import { collectionPath, deckTileColors } from "./collectionRef";
import { collectionIcon } from "./collectionIcon";
import { FooterSpacer } from "../../components/MobileFooter";
import { fetchDecks, createDeck, type DeckSummary } from "../../api/decks";
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
// So the page is four stacked sections:
//   1. Review / Study Mix / Challenge — whole-library study entry points
//   2. Cards    — All Cards / Learn Now (+ Mastered, when it has no section of its own)
//   3. Mastered — one tile per active mastery bar, ONLY when a reading or writing
//                 goal is set (see hasMasteredSection)
//   4. Decks    — the user's own sets in rows of three, plus "New deck"
//
// EVERY set on this page is the same object: a `DeckTile` (the stacked-card icon)
// that navigates to that set's CollectionViewPage. Sections 2–4 differ only in what
// fills them, which is the point — a built-in collection, a mastery bar and a
// user-authored deck are all just "a set of your cards", and the page should not
// argue otherwise.
//
// WHICH built-in collections exist is NOT decided here: `builtinCollections.ts` owns
// the list, its order, its colors and its grouping, because the Games hub's
// collection selector renders the same list and this page is its source of truth.
// The per-band tiles (Unfamiliar / Target / Comfortable) that used to open this
// section are gone — a utcm band is a card property, not a set to study.
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

// A row of DeckTiles. THREE PER ROW is the page's grid unit — every section uses it
// (Cards holds two or three, Mastered up to three, and the user's decks wrap).
//
// A WRAPPING FLEX capped at exactly three tiles' worth of width, rather than a
// 3-column grid: a grid pins every tile to a column, so its last row is stuck with
// visibly empty columns and neither alignment below is expressible.
//
// The gaps are derived, not typed in twice: ROW_MAX_WIDTH must stay exactly
// 3 tiles + 2 column gaps, or a wider gap would push the third tile onto its own
// line (and a narrower one would let a fourth tile up). Change TILE_GAP alone.
// TILE_WIDTH must equal DeckTile's natural width (SIZING.cardWidth). Both were 72 —
// the width the Account row renders at — which left this page's rows 248px wide
// inside a 337px content column (a 393px frame less the 28px gutter the section
// headings use), so the tiles read as a narrow strip under a wider heading. At 100
// wide with an 18px gap the row is 336px: three tiles now land on the same left and
// right edges as every heading above them.
const TILE_WIDTH = 100;     // DeckTile's natural width (SIZING.cardWidth)
const TILE_GAP = 18;        // between tiles in a row
const TILE_ROW_GAP = 18;    // between wrapped rows — a touch looser, so rows read as rows
const ROW_MAX_WIDTH = 3 * TILE_WIDTH + 2 * TILE_GAP;

// The two alignments, and why the page uses both:
//
//   CENTERED (default) — the BUILT-IN sections. Cards and Mastered are fixed sets of
//     two or three tiles that never wrap, so there is no column structure to
//     preserve; left-aligning them would leave an obvious hole where the third tile
//     isn't, and the caption above them is centered on nothing.
//   LEFT (`alignLeft`) — the DECKS section. It is a growing, wrapping LIST: with
//     centering, adding a fourth deck would shunt the first three sideways to
//     re-center the row above it, so a deck's position changes every time the user
//     makes another one. Left-aligned, every deck keeps its place and each row
//     starts on the same column as the one above.
const TileGrid = styled(Box, {
    shouldForwardProp: (prop) => prop !== "alignLeft",
})<{ alignLeft?: boolean }>(({ alignLeft }) => ({
    width: "100%",
    maxWidth: ROW_MAX_WIDTH,
    margin: "0 auto",
    display: "flex",
    flexWrap: "wrap",
    justifyContent: alignLeft ? "flex-start" : "center",
    alignItems: "flex-start",
    gap: `${TILE_ROW_GAP}px ${TILE_GAP}px`,
    padding: "4px 0 12px",
}));

// Section caption above each tile section.
const SectionLabel = styled(Typography)(() => ({
    fontSize: SIZE.body,
    fontWeight: WEIGHT.medium,
    color: COLORS.onSurface,
    fontFamily: FONTS.sans,
}));

// Main Component
const FlashcardsDecksPage: React.FC = () => {
    usePageTitle("Decks");
    const navigate = useNavigate();
    // Collection pages are node drill-ins that slide over this page, so they use
    // the view-transition navigate and Decks is held beneath. See useSlideNavigate.
    const slideNavigate = useSlideNavigate();
    const { isAuthenticated, user } = useAuth();
    // Per-category library card counts, driving the two collection rows' figures
    // and the Review eligibility check. These count SORTED cards only — never the
    // temporary cards a game may have lent (docs/PROVISIONAL_CARDS.md), so the
    // sizes shown here always mean "cards you chose to keep".
    const { counts: categoryCounts } = useCategoryCounts();
    // Mastered totals per mastery bar, for the up-to-three Mastered rows below
    // (docs/MASTERY_REWORK.md § "Three bars"). The core figure comes from here rather
    // than from categoryCounts["Mastered"] so all three rows read from one source and
    // cannot disagree.
    const { counts: masteredCounts } = useMasteredCounts();
    // The account's goals decide BOTH which Mastered collections exist (core always,
    // reading/writing only when that goal is set — the same gate as the card bars
    // themselves) and whether Mastered is its own captioned section at all.
    const goals: MasteryGoals = {
        reading: user?.readingGoal === true,
        writing: user?.writingGoal === true,
    };
    // The built-in collections, already grouped. Shared with the Games hub selector
    // (builtinCollections.ts) so the two surfaces cannot offer different sets.
    const builtins = builtinCollectionEntries(goals);
    const cardsSection = builtins.filter((entry) => entry.group === "Cards");
    const masteredSection = builtins.filter((entry) => entry.group === "Mastered");
    const showMasteredSection = hasMasteredSection(goals);
    // Toast shown when a greyed Review button is tapped (no eligible cards yet).
    const [markMoreSnackOpen, setMarkMoreSnackOpen] = useState(false);

    // The user's decks in their current language.
    const [decks, setDecks] = useState<DeckSummary[]>([]);
    // `/api/decks` returns BOTH kinds since migration 148, so the page splits them:
    // generated ("preset") decks get their own captioned section ABOVE the user's own,
    // which is what keeps a new challenge from shuffling the authored decks the user
    // knows the position of. See docs/STUDY_CHALLENGE.md § 4.
    const challengeDecks = decks.filter((deck) => deck.editMode === "preset");
    const authoredDecks = decks.filter((deck) => deck.editMode !== "preset");
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

    // Every figure on a built-in tile comes from the two count hooks already loaded —
    // no extra request. The derivation itself lives beside the collection list
    // (builtinCollectionCount) so a collection's definition and its number cannot drift.
    const tileCount = (entry: (typeof builtins)[number]) =>
        builtinCollectionCount(entry.ref, categoryCounts, masteredCounts);

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
                        use its "Study these cards" button. */}
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

                    {/* ── Cards ── the whole library and the part still being learned,
                        plus the single Mastered tile when it has no section of its own.
                        Every tile is the same object as a user's deck below; only what
                        defines the set differs. */}
                    <Box
                        className="flashcards-decks__cards-header"
                        sx={{ width: "100%", px: 3.5, pt: 2, pb: 0.5 }}
                    >
                        <SectionLabel className="flashcards-decks__cards-label">Cards</SectionLabel>
                    </Box>

                    <TileGrid className="flashcards-decks__cards-row">
                        {cardsSection.map((entry, index) => (
                            <DeckTile
                                key={entry.key}
                                className={`flashcards-decks__collection-tile flashcards-decks__collection-tile--${entry.key}`}
                                label={entry.label}
                                count={tileCount(entry)}
                                icon={collectionIcon(entry.ref)}
                                mainColor={entry.colors.main}
                                accentColor={entry.colors.accent}
                                animationDelay={index * 70}
                                onClick={() => slideNavigate(collectionPath(entry.ref))}
                            />
                        ))}
                    </TileGrid>

                    <LineSeparator className="decks-line-separator" />

                    {/* ── Mastered ── one tile per ACTIVE mastery bar, and ONLY when
                        there is more than one of them: with core alone the tile sits in
                        Cards above, because a captioned section holding a single tile is
                        a heading for nothing. Colors, titles and destinations all come
                        from the shared helpers, so the tiles stay agnostic to which bar
                        they represent. */}
                    {showMasteredSection && (
                        <>
                            <Box
                                className="flashcards-decks__mastered-header"
                                sx={{ width: "100%", px: 3.5, pt: 2, pb: 0.5 }}
                            >
                                <SectionLabel className="flashcards-decks__mastered-label">Mastered</SectionLabel>
                            </Box>

                            <TileGrid className="flashcards-decks__mastered-row">
                                {masteredSection.map((entry, index) => (
                                    <DeckTile
                                        key={entry.key}
                                        className={`flashcards-decks__mastered-tile flashcards-decks__mastered-tile--${entry.key}`}
                                        label={entry.label}
                                        count={tileCount(entry)}
                                        icon={collectionIcon(entry.ref)}
                                        mainColor={entry.colors.main}
                                        accentColor={entry.colors.accent}
                                        animationDelay={index * 70}
                                        onClick={() => slideNavigate(collectionPath(entry.ref))}
                                    />
                                ))}
                            </TileGrid>

                            <LineSeparator className="decks-line-separator" />
                        </>
                    )}

                    {/* ── Challenges ── the FIFTH section (docs/STUDY_CHALLENGE.md § 4).
                        Placed immediately BEFORE the user's own Decks so generated sets sit
                        above authored ones and the user's decks keep a stable position at the
                        bottom of the page.

                        OMITTED ENTIRELY when there is no active challenge deck, exactly as
                        Mastered is when no reading/writing goal is set — an empty captioned
                        section is noise on a page whose job is to be scannable.

                        The tile is the same `DeckTile` as every other set here: the page's
                        governing idea is that a built-in collection, a mastery bar and a deck
                        are all just "a set of your cards". There is NO lock badge; the deck's
                        immutability shows up as the absence of controls on its own page. */}
                    {challengeDecks.length > 0 && (
                        <>
                            <Box
                                className="flashcards-decks__challenges-header"
                                sx={{ width: "100%", px: 3.5, pt: 2, pb: 1 }}
                            >
                                <Typography
                                    className="flashcards-decks__challenges-label"
                                    sx={{
                                        fontSize: SIZE.body,
                                        fontWeight: WEIGHT.medium,
                                        color: COLORS.onSurface,
                                        fontFamily: FONTS.sans,
                                    }}
                                >
                                    Challenges
                                </Typography>
                            </Box>
                            <TileGrid className="flashcards-decks__challenges-list" alignLeft>
                                {challengeDecks.map((deck, index) => (
                                    <DeckTile
                                        key={deck.id}
                                        className="flashcards-decks__challenge-tile"
                                        label={deck.name}
                                        count={deck.cardCount}
                                        icon={collectionIcon({ kind: "deck", deckId: deck.id })}
                                        mainColor={deckTileColors(deck.id).main}
                                        accentColor={deckTileColors(deck.id).accent}
                                        animationDelay={Math.min(index, 5) * 70}
                                        onClick={() => slideNavigate(`/flashcards/deck/${deck.id}`)}
                                    />
                                ))}
                            </TileGrid>
                            <LineSeparator className="challenges-line-separator" />
                        </>
                    )}

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

                    {(decksError || (!decksLoading && authoredDecks.length === 0)) && (
                        <Box className="flashcards-decks__decks-message" sx={{ width: "100%", px: 3.5, pb: 1 }}>
                            <Typography
                                className={decksError ? "flashcards-decks__decks-error" : "flashcards-decks__decks-empty"}
                                sx={{ fontSize: SIZE.body, fontFamily: FONTS.sans, color: COLORS.textSecondary }}
                            >
                                {decksError ??
                                    "No decks yet. Tap + to make one, then add cards to it from any card's detail page."}
                            </Typography>
                        </Box>
                    )}

                    {/* The user's decks, wrapping at three per row — the same tile as
                        every built-in set above, carrying the deck's derived pastel
                        (deckAccentColor: computed from the id, never stored). */}
                    <TileGrid className="flashcards-decks__decks-list" alignLeft>
                        {authoredDecks.map((deck, index) => (
                            <DeckTile
                                key={deck.id}
                                className="flashcards-decks__deck-tile"
                                label={deck.name}
                                count={deck.cardCount}
                                icon={collectionIcon({ kind: "deck", deckId: deck.id })}
                                mainColor={deckTileColors(deck.id).main}
                                accentColor={deckTileColors(deck.id).accent}
                                // Stagger only within the first couple of rows; past
                                // that the cascade would run longer than the scroll.
                                animationDelay={Math.min(index, 5) * 70}
                                onClick={() => slideNavigate(`/flashcards/deck/${deck.id}`)}
                            />
                        ))}
                    </TileGrid>

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
