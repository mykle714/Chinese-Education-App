import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import {
    Box, Alert, Button, Snackbar,
    Dialog, DialogTitle, DialogContent, DialogActions, TextField,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import MobileTabScreen from "../../components/MobileTabScreen";
import SheetPanel, { type SheetPanelBodyHandle } from "./FlashcardsLearnPage/SheetPanel";
import DecksSheetBody from "./DecksSheetBody";
import { useAuth } from "../../AuthContext";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useCategoryCounts } from "../../hooks/useCategoryCounts";
import { useMasteredCounts } from "../../hooks/useMasteredCounts";
import type { MasteryGoals } from "../../utils/masteryCompute";
import {
    builtinCollectionCount, builtinCollectionEntries, hasMasteredSection,
} from "./builtinCollections";
import {
    FLOATING_FOOTER_HEIGHT, FLOATING_FOOTER_INSET, FLOATING_FOOTER_EXTRA_GAP,
    FLOATING_FOOTER_CLEARANCE,
} from "../../components/MobileFooter";
import { fetchDecks, createDeck, type DeckSummary } from "../../api/decks";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";

// ── What this page is now ─────────────────────────────────────────────────────
//
// /decks used to BE the Learn Now card grid: it fetched every non-mastered library
// card and rendered them inline, with a search bar and a link row to the separate
// Mastered page. Those cards moved to CollectionViewPage
// (/flashcards/collection/learn-now), and the space they used became the DECK LIST
// — the user's own named card sets (docs/DECKS_FEATURE.md).
//
// The page is now split across TWO surfaces:
//
//   PAGE (behind)  — the Review / Study Mix / Challenge row: whole-library study
//                    entry points, always reachable without moving anything.
//   SHEET (front)  — a PERSISTENT pull-up panel holding every SET of cards:
//                    Cards, Mastered, Challenges and the user's Decks. It rests
//                    just above the floating footer, showing its grabber and the
//                    first caption, and is dragged up to browse (see
//                    DecksSheetBody for the sections themselves).
//
// The sheet is the SAME component as the eip bottom sheet on flp — `SheetPanel`,
// in persistent mode (`minHeight` > 0, no scrim), so the resize/fling/scroll
// coupling is shared code rather than a second implementation. "Persistent" means
// it opens AT its resting height with no open animation and can never be dismissed:
// its two stops are {resting, max}.
//
// EVERY set in the sheet is the same object: a `DeckTile` (the stacked-card icon)
// that navigates to that set's CollectionViewPage. The sections differ only in what
// fills them, which is the point — a built-in collection, a mastery bar and a
// user-authored deck are all just "a set of your cards", and the UI should not
// argue otherwise.
//
// WHICH built-in collections exist is NOT decided here: `builtinCollections.ts` owns
// the list, its order, its colors and its grouping, because the Games hub's
// collection selector renders the same list and this page is its source of truth.
//
// Phone-frame sizing comes from MobileDemoFrame via Layout.tsx; the header comes
// from MobileTabScreen — which is now NON-scrolling (`scrollable={false}`), because
// the only thing left behind the sheet is the button row and all scrolling happens
// inside the sheet.
//
// Inverted grey/white scheme, scoped to /decks only: the page surface is painted
// with the grey header tone (passed as MobileTabScreen `surfaceColor`).

// Resting ("closed") height of the sheet, measured from the bottom of the frame.
// Derived from the floating footer's own geometry so the two can't drift: the pill
// occupies INSET..INSET+HEIGHT, and SHEET_LIP is how much of the sheet shows ABOVE
// the pill — enough for the grabber plus the first section caption.
const SHEET_LIP = 44;
const SHEET_CLOSED_HEIGHT =
    FLOATING_FOOTER_INSET + FLOATING_FOOTER_HEIGHT + FLOATING_FOOTER_EXTRA_GAP + SHEET_LIP;

// Extra bottom padding the study area needs so Study Mix ends just ABOVE the resting
// sheet rather than behind it. `MobileTabScreen`'s scroll area already reserves
// FLOATING_FOOTER_CLEARANCE for the footer pill, and the sheet stands taller than
// that — so only the DIFFERENCE is missing, plus a breathing gap. Derived rather
// than typed, or a change to SHEET_LIP would silently tuck the button under the sheet.
// Breathing room around the Study Mix slab: the gap between it and the
// Review/Challenge row above, AND (via STUDY_AREA_BOTTOM_PAD below) the gap between
// it and the resting sheet. One constant so the slab always sits evenly between the
// two things it touches — bump this to loosen or tighten both at once.
//
// The same value is the slab SLOT's left/right padding, so the 3:4 button is framed
// on all four sides. Whichever axis the ratio does not fill turns into extra centred
// space on top of it, so the slab reads as inset from the Review/Challenge row above
// rather than aligned to its edges.
const STUDY_AREA_GAP = 24;
const STUDY_AREA_BOTTOM_PAD =
    SHEET_CLOSED_HEIGHT - FLOATING_FOOTER_CLEARANCE + STUDY_AREA_GAP;

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

// The primary entry into a mixed (all-category) study session. It is the page's
// BIGGEST target on purpose: Review and Challenge are the two narrow, conditional
// modes on the row above, and Study Mix is the one that always works — so it takes
// the whole slab between that row and the resting sheet (`flex: 1` inside a column
// that is itself `flex: 1`). Its type steps up to `title` to match the footprint;
// a slab this size carrying 16px text reads as an empty panel with a caption.
const MixButton = styled(Button)(() => ({
    ...studyButtonBase,
    backgroundColor: COLORS.header,
    color: COLORS.onSurface,
    border: `2px solid ${COLORS.border}`,
    // FIXED 3:4 (w:h) PORTRAIT RATIO, scaled to whichever axis runs out first.
    //
    // `flex: none` + container-query units, NOT `flex: 1`: a flex-grown item has a
    // definite height, and a definite height beats `aspect-ratio`, so the slab would
    // silently stretch to whatever the column left it. Here the slab's PARENT is the
    // size container (`containerType: "size"` on the slot below) and the width is
    // clamped by BOTH axes at once:
    //
    //     min(100cqw, 75cqh)   // 75cqh = the width a 3:4 box has at full height
    //
    // Whichever term is smaller wins, so the box grows to fill the slot and stops at
    // the first edge it touches — never overflowing, never breaking ratio. The single
    // pure-CSS alternative (`height: 100%; width: auto; max-width: 100%`) does NOT
    // hold the ratio: when max-width clamps, the definite height stays put.
    // cq units resolve against the container's CONTENT box, so the slot's padding is
    // real margin around the slab.
    flex: "none",
    width: "min(100cqw, 75cqh)",
    aspectRatio: "3 / 4",
    height: "auto",
    fontSize: SIZE.title,
    "&:hover": {
        backgroundColor: COLORS.header,
    },
}));

// Review (blue) / Challenge (red) difficulty entry buttons. They now share ONE row
// at equal width (`flex: 1` each), above Study Mix rather than flanking it — they are
// peers, the two halves of the same difficulty axis, and Study Mix is a different
// kind of choice. `greyed` renders a non-interactive-looking disabled state WITHOUT
// the `disabled` prop, so taps still fire onClick to surface the "mark more cards" toast.
//
// The two differ only by accent color, so the shared shape lives here. They keep the
// base `bodyLg` type: the earlier one-step-down override existed because the pair
// split whatever width the half-width Study Mix left them (~25% each), which crowded
// words as long as "Challenge". At half the row each there is room again.
const GREYED_BG = "#C7C7CC";
const difficultyButtonStyle = (greyed: boolean | undefined, accent: string, hover: string) => ({
    ...studyButtonBase,
    flex: 1,
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
    const collectionsSection = builtins.filter((entry) => entry.group === "Collections");
    const masteredSection = builtins.filter((entry) => entry.group === "Mastered");
    const showMasteredSection = hasMasteredSection(goals);
    // Body of the persistent sets sheet; SheetPanel reads {root, scroll} off this
    // handle to wire its resize/scroll coupling.
    const sheetBodyRef = useRef<SheetPanelBodyHandle | null>(null);
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
            {/* Positioning context for the sheet: SheetPanel is `absolute; bottom: 0`
                and sizes its max height from this element's clientHeight, so it must
                be a POSITIONED box that fills the frame — MobileTabScreen's own root
                can't host it (the sheet would land inside the scroll area). The
                floating footer is rendered above both, at frame level. */}
            <Box
                className="flashcards-decks__frame"
                sx={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
            >
                <MobileTabScreen
                    title="Decks & Cards"
                    activePage="flashcards"
                    surfaceColor={COLORS.header}
                    contentClassName="decks-page-content"
                    contentSx={CONTENT_SX}
                    // Nothing behind the sheet scrolls any more — the sheet owns all
                    // of the page's scrollable content.
                    scrollable={false}
                >
                    {/* The study area: the whole space above the resting sheet.
                        Review and Challenge share ONE row at the top at equal width
                        (they are peers — two halves of the same difficulty axis),
                        and Study Mix takes everything left over down to the sheet.
                        These are WHOLE-LIBRARY entry points; to study one collection,
                        open it from the sheet below and use its "Study these cards"
                        button. */}
                    <Box
                        className="flashcards-decks__study-area"
                        sx={{
                            flex: 1,
                            minHeight: 0,
                            width: "100%",
                            display: "flex",
                            flexDirection: "column",
                            gap: `${STUDY_AREA_GAP}px`,
                            padding: `16px 20px ${STUDY_AREA_BOTTOM_PAD}px`,
                        }}
                    >
                        <Box
                            className="flashcards-decks__mode-row"
                            sx={{ display: "flex", alignItems: "stretch", gap: 1.5, flexShrink: 0 }}
                        >
                            <ReviewButton
                                className="flashcards-decks__review-button"
                                greyed={!reviewEligible}
                                onClick={handleReviewClick}
                            >
                                Review
                            </ReviewButton>
                            <ChallengeButton
                                className="flashcards-decks__challenge-button"
                                onClick={handleChallengeClick}
                            >
                                Challenge
                            </ChallengeButton>
                        </Box>
                        {/* Slot for the slab: takes all the height the row above
                            leaves, declares itself a SIZE CONTAINER so the button can
                            size off both of its axes (see MixButton), and centers the
                            button in whatever space is left over once the 3:4 ratio
                            has taken what it can. Its padding is the slab's margin. */}
                        <Box
                            className="flashcards-decks__mix-slot"
                            sx={{
                                flex: 1,
                                minHeight: 0,
                                containerType: "size",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                padding: `0 ${STUDY_AREA_GAP}px`,
                            }}
                        >
                            <MixButton className="flashcards-decks__mix-button" onClick={handleMixClick}>
                                Study Mix
                            </MixButton>
                        </Box>
                    </Box>
                </MobileTabScreen>

                {/* The sets sheet. Persistent (minHeight ⇒ never dismissed, no open
                    animation, no scrim), so `onClose` is deliberately omitted. */}
                <SheetPanel
                    minHeight={SHEET_CLOSED_HEIGHT}
                    showScrim={false}
                    bodyRef={sheetBodyRef}
                    // The body's scroll element is stable, but its identity changes
                    // when the deck list first arrives (the empty-state message and
                    // the tiles mount into it), so re-bind once decks have loaded.
                    bodyKey={decksLoading ? "loading" : "ready"}
                >
                    {({ bindHeaderDrag }) => (
                        <DecksSheetBody
                            ref={sheetBodyRef}
                            collectionsSection={collectionsSection}
                            masteredSection={masteredSection}
                            showMasteredSection={showMasteredSection}
                            tileCount={tileCount}
                            challengeDecks={challengeDecks}
                            authoredDecks={authoredDecks}
                            decksLoading={decksLoading}
                            decksError={decksError}
                            onOpenPath={slideNavigate}
                            onNewDeck={() => { setNewDeckName(""); setCreateError(null); setNewDeckOpen(true); }}
                            headerDragBind={bindHeaderDrag}
                        />
                    )}
                </SheetPanel>
            </Box>

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
