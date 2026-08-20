import { useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { Box, Alert, Button, Snackbar } from "@mui/material";
import { styled } from "@mui/material/styles";
import MobileTabScreen from "../../components/MobileTabScreen";
import SheetPanel, { type SheetPanelBodyHandle } from "./FlashcardsLearnPage/SheetPanel";
import DecksPanelBody from "./DecksPanelBody";
import NewDeckDialog from "./NewDeckDialog";
import { useDecksPanel } from "./useDecksPanel";
import { usePageTitle } from "../../hooks/usePageTitle";
import {
    activeMasteryCenters, MASTERY_CENTER_PATHS, MASTERY_CENTER_BUTTON_LABELS,
} from "./masteryCenters";
import { MARK_TYPE_COLORS } from "../../utils/masteryCompute";
import {
    FLOATING_FOOTER_HEIGHT, FLOATING_FOOTER_INSET, FLOATING_FOOTER_EXTRA_GAP,
    FLOATING_FOOTER_CLEARANCE,
} from "../../components/MobileFooter";
import type { VocabEntry } from "../../types";
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
//   PAGE (behind)  — the study-entry buttons: Review / Challenge, the Study Mix
//                    slab, and (when the account pursues them) the Reading and
//                    Writing Center buttons. Always reachable without moving anything.
//   SHEET (front)  — a PERSISTENT pull-up panel holding every SET of cards:
//                    Collections, Challenges and the user's Decks, and BELOW them the
//                    learner's whole card library as a searchable grid. It rests just
//                    above the floating footer, showing its grabber and the first
//                    caption, and is dragged up to browse (see DecksPanelBody).
//
// ── This page is the CORE bar, and only the core bar ─────────────────────────
// Every figure behind the sheet and inside it answers one question: how well does the
// learner KNOW these words (recognition + production). Reading and writing have their
// own pages — the Mastery Centers, opened from the two buttons under Study Mix — which
// render this very same panel through their own bar (masteryCenters.ts,
// docs/DECKS_FEATURE.md § "Mastery Centers"). Do not put a per-skill tile, count or
// sort row back on this page: that split is the whole point of the Centers.
//
// The "All Cards" TILE is deliberately absent from the sheet's Collections row:
// its grid is rendered inline at the bottom of the sheet instead, so finding a
// single card costs no navigation. The collection itself is untouched — its route
// (/flashcards/collection/all) and its entry in the shared list still exist, since
// the Games hub offers it as a playable set. Only the panel hides the tile.
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
// collection selector renders a sibling list. The panel's DATA is not owned here
// either — `useDecksPanel(lens)` owns every fetch and derivation, so this page and
// both Centers cannot drift.
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

// How far down the sheet must be dragged before a release collapses it back to
// SHEET_CLOSED_HEIGHT instead of springing open to the max, as a fraction of the
// closed→max travel. SheetPanel's default is 0.5 (nearest stop wins); the
// collections sheet is deliberately much stickier open — it only closes once
// pulled below 30% of the way up, so a small downward nudge doesn't shut it.
const SHEET_COLLAPSE_THRESHOLD_RATIO = 0.3;

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

// Reading / Writing Center buttons. A skill-accent pair on their own row UNDER the
// Study Mix slab, so the column reads top-to-bottom as: how hard (Review/Challenge) →
// the everyday session (Study Mix) → which SKILL (Reading/Writing). They are a
// different kind of destination from the three above them — a place to look at your
// library, not a session to start — which is why they sit below the slab rather than
// joining the difficulty row.
//
// Colored by MARK TYPE, not by band: reading is red and writing is yellow everywhere
// in the app (MARK_TYPE_COLORS, docs/MASTERY_REWORK.md § 5), and these buttons open
// the pages those two colors annotate.
const CenterButton = styled(Button)<{ accent: string }>(({ accent }) => ({
    ...studyButtonBase,
    flex: 1,
    // A shorter button than the difficulty row above: this row is taking its height
    // out of the Study Mix slab, and the slab is the page's primary target.
    padding: "12px 16px",
    fontSize: SIZE.body,
    color: COLORS.onSurface,
    backgroundColor: accent,
    "&:hover": { backgroundColor: accent, filter: "brightness(0.96)" },
}));

// Main Component
const FlashcardsDecksPage: React.FC = () => {
    usePageTitle("Decks");
    const navigate = useNavigate();
    // Collection pages are node drill-ins that slide over this page, so they use
    // the view-transition navigate and Decks is held beneath. See useSlideNavigate.
    const slideNavigate = useSlideNavigate();
    // The whole panel, through the CORE lens — this page's one question. Every fetch,
    // count and ordering behind the sheet lives in the hook, shared verbatim with the
    // two Mastery Centers (useDecksPanel.ts).
    const panel = useDecksPanel("core");
    // Which Center buttons this account gets: one per goal it has set. Read off the
    // panel's memoized goals rather than `user` again, so the two cannot disagree.
    const centers = activeMasteryCenters(panel.goals);
    // Body of the persistent sets sheet; SheetPanel reads {root, scroll} off this
    // handle to wire its resize/scroll coupling.
    const sheetBodyRef = useRef<SheetPanelBodyHandle | null>(null);
    // Toast shown when a greyed Review button is tapped (no eligible cards yet).
    const [markMoreSnackOpen, setMarkMoreSnackOpen] = useState(false);
    const [newDeckOpen, setNewDeckOpen] = useState(false);

    // Card Detail is a leaf that slides over this page. No lens param: this page is
    // the core bar, which is what a card page shows by default.
    const handleOpenCard = useCallback(
        (entry: VocabEntry) => slideNavigate(`/flashcards/card/${entry.id}`),
        [slideNavigate]
    );

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
    //
    // Both read the CORE bands, because both study modes are core sessions.
    const reviewEligible =
        ((panel.categoryCounts["Comfortable"] || 0) + (panel.categoryCounts["Mastered"] || 0)) > 0;

    const handleReviewClick = () => {
        if (!reviewEligible) { setMarkMoreSnackOpen(true); return; }
        navigate("/flashcards/learn?mode=review");
    };

    const handleChallengeClick = () => {
        navigate("/flashcards/learn?mode=challenge");
    };

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
                        Three rows, top to bottom:
                          • Review / Challenge — peers, the two halves of the difficulty
                            axis, at equal width;
                          • Study Mix — the slab, taking everything the other two rows
                            leave (it is the target that always works);
                          • Reading / Writing — the Mastery Center buttons, present only
                            for the goals this account pursues. They take their height
                            out of the slab, which is why the slab shrinks on an account
                            with goals rather than the page growing a scrollbar.
                        The first three are WHOLE-LIBRARY study entry points; to study one
                        collection, open it from the sheet below and use its "Study these
                        cards" button. */}
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

                        {/* Mastery Centers. The row is omitted ENTIRELY when the account
                            pursues neither skill (and always for Spanish, which cannot
                            accrue those marks) — an empty row would leave the slab short
                            of the space it would otherwise have. With one goal set the
                            single button takes the full width, which is correct: it is
                            the only other place to go. */}
                        {centers.length > 0 && (
                            <Box
                                className="flashcards-decks__center-row"
                                sx={{ display: "flex", alignItems: "stretch", gap: 1.5, flexShrink: 0 }}
                            >
                                {centers.map((bar) => (
                                    <CenterButton
                                        key={bar}
                                        className={`flashcards-decks__center-button flashcards-decks__center-button--${bar}`}
                                        accent={MARK_TYPE_COLORS[bar]}
                                        onClick={() => slideNavigate(MASTERY_CENTER_PATHS[bar])}
                                    >
                                        {MASTERY_CENTER_BUTTON_LABELS[bar]}
                                    </CenterButton>
                                ))}
                            </Box>
                        )}
                    </Box>
                </MobileTabScreen>

                {/* The sets sheet. Persistent (minHeight ⇒ never dismissed, no open
                    animation, no scrim), so `onClose` is deliberately omitted. */}
                <SheetPanel
                    minHeight={SHEET_CLOSED_HEIGHT}
                    showScrim={false}
                    collapseThresholdRatio={SHEET_COLLAPSE_THRESHOLD_RATIO}
                    bodyRef={sheetBodyRef}
                    // The body's scroll element is stable, but its identity changes
                    // when the deck list first arrives (the empty-state message and
                    // the tiles mount into it), so re-bind once decks have loaded.
                    bodyKey={panel.decksLoading ? "loading" : "ready"}
                >
                    {({ bindHeaderDrag }) => (
                        <DecksPanelBody
                            ref={sheetBodyRef}
                            panel={panel}
                            variant="sheet"
                            onOpenPath={slideNavigate}
                            onOpenCard={handleOpenCard}
                            onNewDeck={() => setNewDeckOpen(true)}
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

                <NewDeckDialog
                    classPrefix="flashcards-decks"
                    open={newDeckOpen}
                    onClose={() => setNewDeckOpen(false)}
                    onCreate={panel.addDeck}
                />
        </>
    );
};

export default FlashcardsDecksPage;
