import { useState, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { Box, Alert, Snackbar } from "@mui/material";
import MobileTabScreen from "../../components/MobileTabScreen";
import SheetPanel, { type SheetPanelBodyHandle } from "./FlashcardsLearnPage/SheetPanel";
import DecksPanelBody from "./DecksPanelBody";
import NewDeckDialog from "./NewDeckDialog";
import { useDecksPanel } from "./useDecksPanel";
import { usePageTitle } from "../../hooks/usePageTitle";
import {
    activeMasteryCenters, MASTERY_CENTER_PATHS, MASTERY_CENTER_BUTTON_LABELS,
} from "./masteryCenters";
import type { MasteryBarId } from "../../utils/masteryCompute";
import Icon from "../../components/Icon";
import { Label } from "../../components/primitives";
import StudyHand, { type StudyHandCard, type StudyModeId } from "./StudyHand";
import {
    FOOTER_HEIGHT, FOOTER_EXTRA_GAP,
    FOOTER_CLEARANCE,
} from "../../components/MobileFooter";
import type { VocabEntry } from "../../types";
import { COLORS, RAMP, type RampHue } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { WEIGHT } from "../../theme/scale";

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
//   PAGE (behind)  — the STUDY AREA: a library figure, the Reading/Writing Center
//                    rail (when the account pursues those goals), and the three ways
//                    into a session held as a fanned HAND of cards — Study Mix played
//                    forward, Review and Challenge peeking behind it (`StudyHand`,
//                    artboards 2 / 2b). Always reachable without moving anything.
//   SHEET (front)  — a PERSISTENT pull-up panel holding every SET of cards:
//                    Collections, Challenges and the user's Decks, and BELOW them the
//                    learner's whole card library as a searchable grid. It rests just
//                    above the floating footer, showing its grabber and the first
//                    caption, and is dragged up to browse (see DecksPanelBody).
//
// ── This page is the CORE bar, and only the core bar ─────────────────────────
// Every figure behind the sheet and inside it answers one question: how well does the
// learner KNOW these words (recognition + production). Reading and writing have their
// own pages — the Mastery Centers, opened from the rail above the hand — which
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
// EVERY set in the sheet is the same object: a `Spine` (components/shelf)
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
// the only thing left behind the sheet is the study area and all scrolling happens
// inside the sheet.
//
// Ground: PAPER, like every other page. The inversion survives — the sheet is white
// and stands off the paper behind it — but it is no longer "grey page / near-white
// sheet". The page used to pass `surfaceColor={COLORS.header}`, which after A2a put a
// paper-coloured footer bar over a grey page and drew a visible step across the bottom
// of the frame. The design has no tinted page grounds at all (artboard 2 is `--paper`
// with a `--white` sheet), so the tint came out rather than the bar being repainted.

// Resting ("closed") height of the sheet, measured from the bottom of the frame.
// Derived from the footer bar's own geometry so the two can't drift: the bar occupies
// the bottom FOOTER_HEIGHT px, and SHEET_LIP is how much of the sheet shows ABOVE the
// bar — enough for the grabber plus the first section caption.
const SHEET_LIP = 44;
const SHEET_CLOSED_HEIGHT = FOOTER_HEIGHT + FOOTER_EXTRA_GAP + SHEET_LIP;

// How far down the sheet must be dragged before a release collapses it back to
// SHEET_CLOSED_HEIGHT instead of springing open to the max, as a fraction of the
// closed→max travel. SheetPanel's default is 0.5 (nearest stop wins); the
// collections sheet is deliberately much stickier open — it only closes once
// pulled below 30% of the way up, so a small downward nudge doesn't shut it.
const SHEET_COLLAPSE_THRESHOLD_RATIO = 0.3;

// Breathing room between the study area's three rows (figure line / Centers rail /
// the card hand), and — via STUDY_AREA_BOTTOM_PAD — between the hand and the resting
// sheet.
//
// The bottom pad exists because `MobileTabScreen`'s scroll area only reserves
// FOOTER_CLEARANCE for the footer pill, and the sheet stands TALLER than that; only
// the DIFFERENCE is missing. Derived rather than typed, or a change to SHEET_LIP
// would silently tuck the hand's `Study now` button under the sheet.
const STUDY_AREA_GAP = 12;
const STUDY_AREA_BOTTOM_PAD =
    SHEET_CLOSED_HEIGHT - FOOTER_CLEARANCE + STUDY_AREA_GAP;

const CONTENT_SX = {
    alignItems: "center",
} as const;

// The Centers rail's two tiles, by mastery bar. Both are PASTELS (D2b: a filled
// surface takes the ramp's 93% tier, only marks and cells keep a saturated hex), and
// both are the artboard's own choices — reading on the red axis, writing on the gold
// one that `--yel` was added for.
const CENTER_HUES: Record<Exclude<MasteryBarId, "core">, RampHue> = {
    reading: "red",
    writing: "yel",
};
const CENTER_GLYPHS: Record<Exclude<MasteryBarId, "core">, string> = {
    reading: "menu_book",
    writing: "draw",
};

// The card hand's three modes, in FAN_ORDER. Fill hues are the artboard's: Challenge
// red (the difficulty end), Review blue, Study Mix the gold `--yel` this design added
// for exactly this card.
const HAND_HUES: Record<StudyModeId, RampHue> = {
    challenge: "red",
    review: "blu",
    mix: "yel",
};

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

    // ── The three modes' figures ─────────────────────────────────────────────
    //
    // Each mode's figure is the size of the SET IT DRAWS FROM, read off the core
    // bands — the server's own MODE_CONFIGS (OnDeckVocabService.ts):
    //   Study Mix   — every band still in rotation (= the Learn Now collection)
    //   Review      — Comfortable + Mastered
    //   Challenge   — Unfamiliar + Target
    //
    // ⚠️ NOT a "due today" count. The artboard's big number is a cooldown-aware ready
    // count and the app has no such figure (docs/DEFERRED_WORK.md). These are honest
    // set sizes, and each card says so in its own caption rather than implying a queue.
    //
    // `undefined` until the counts land, so the cards print an em dash rather than a
    // provisional 0 — 0 is a real answer every one of these figures can give.
    const band = useCallback(
        (name: string): number => panel.categoryCounts[name] || 0,
        [panel.categoryCounts]
    );
    const countsLoaded = Object.keys(panel.categoryCounts).length > 0;
    const inRotation = countsLoaded ? band("Unfamiliar") + band("Target") + band("Comfortable") : undefined;
    const reviewPool = countsLoaded ? band("Comfortable") + band("Mastered") : undefined;
    const challengePool = countsLoaded ? band("Unfamiliar") + band("Target") : undefined;
    const libraryTotal = countsLoaded ? (inRotation ?? 0) + band("Mastered") : undefined;

    // REVIEW still needs real cards: Comfortable and Mastered are EARNED bands, and a
    // lent card starts with an empty mark history, so provisioning can never populate
    // them. Greying Review is therefore a statement about the learner's progress, not
    // a card-count wall (docs/PROVISIONAL_CARDS.md).
    //
    // CHALLENGE has NO eligibility check at all. Its buckets are exactly the ones
    // provisioning fills — a lent card is Unfamiliar — so the server can always build
    // a Challenge loop, even for an account with nothing sorted. Study Mix likewise:
    // there is NO card-count gate into /flashcards/learn any more, because the
    // working-loop endpoint lends cards to reach the flp baseline.
    const reviewEligible = (reviewPool ?? 0) > 0;

    const handCards: StudyHandCard[] = useMemo(() => [
        { id: "challenge", label: "Challenge", figure: challengePool, figureCaption: "waiting", hue: HAND_HUES.challenge },
        { id: "review", label: "Review", figure: reviewPool, figureCaption: "ready", hue: HAND_HUES.review, eligible: reviewEligible },
        { id: "mix", label: "Study Mix", figure: inRotation, figureCaption: "in rotation", hue: HAND_HUES.mix },
    ], [challengePool, reviewPool, inRotation, reviewEligible]);

    // ONE commit handler for all three cards. The mode is a query param on the same
    // route, so the branch is only about the Review gate.
    const handleStudy = useCallback((id: StudyModeId) => {
        if (id === "review" && !reviewEligible) { setMarkMoreSnackOpen(true); return; }
        navigate(id === "mix" ? "/flashcards/learn" : `/flashcards/learn?mode=${id}`);
    }, [navigate, reviewEligible]);

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
                    contentClassName="decks-page-content"
                    contentSx={CONTENT_SX}
                    // Nothing behind the sheet scrolls any more — the sheet owns all
                    // of the page's scrollable content.
                    scrollable={false}
                >
                    {/* THE STUDY AREA — the whole space above the resting sheet.
                        Three rows, top to bottom (artboards 2 / 2b):

                          • the library line — how many cards there are, and which set
                            the three modes below draw from;
                          • the Centers rail — Reading / Writing, present only for the
                            goals this account pursues. It is a rail rather than two
                            buttons under the hand because it is a different KIND of
                            destination: a place to look at your library by skill, not a
                            session to start;
                          • the card HAND — Study Mix / Review / Challenge, one played
                            forward (see StudyHand).

                        All three modes are WHOLE-LIBRARY entry points; to study one
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
                            padding: `14px 18px ${STUDY_AREA_BOTTOM_PAD}px`,
                        }}
                    >
                        {/* `.duebar` — two mono overlines, the library's size on the left
                            and the set the hand draws from on the right.

                            ⚠️ The artboard's left slot reads "24 due today". The app has
                            no due/ready figure: that is a cooldown-aware count per mark
                            type and no endpoint returns it (see
                            docs/DEFERRED_WORK.md). The library SIZE is the honest figure
                            the same slot can carry today; do not synthesise a due count
                            from the band totals, which are not cooldown-aware. */}
                        <Box
                            className="flashcards-decks__library-line"
                            sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1.5, flexShrink: 0 }}
                        >
                            <Label className="flashcards-decks__library-total">
                                {libraryTotal === undefined ? "counting…" : `${libraryTotal.toLocaleString()} cards`}
                            </Label>
                            <Label className="flashcards-decks__library-scope">all cards</Label>
                        </Box>

                        {/* Mastery Centers. The rail is omitted ENTIRELY when the account
                            pursues neither skill (and always for Spanish, which cannot
                            accrue those marks) — an empty row would leave the hand short
                            of the space it would otherwise have. With one goal set the
                            single tile takes the full width, which is correct: it is the
                            only other place to go.

                            Coloured by MARK TYPE as a PASTEL, not as the saturated mark
                            hue: this is a filled surface, and D2b puts surfaces on the
                            ramp's 93% tier while marks and cells keep the saturated hex.
                            Reading takes `red`, writing `yel` — the artboard's own two. */}
                        {centers.length > 0 && (
                            <Box
                                className="flashcards-decks__center-rail"
                                sx={{ display: "flex", gap: "9px", flexShrink: 0 }}
                            >
                                {centers.map((bar) => (
                                    <Box
                                        key={bar}
                                        component="button"
                                        type="button"
                                        className={`flashcards-decks__center-tile flashcards-decks__center-tile--${bar}`}
                                        onClick={() => slideNavigate(MASTERY_CENTER_PATHS[bar])}
                                        sx={{
                                            flex: 1,
                                            minWidth: 0,
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: "9px",
                                            alignItems: "flex-start",
                                            textAlign: "left",
                                            border: "none",
                                            cursor: "pointer",
                                            borderRadius: "15px",
                                            padding: "13px 13px 14px",
                                            backgroundColor: RAMP[CENTER_HUES[bar]].fill,
                                        }}
                                    >
                                        <Icon name={CENTER_GLYPHS[bar]} size={19} sx={{ opacity: 0.72 }} />
                                        <Box
                                            component="b"
                                            sx={{
                                                fontFamily: FONTS.sans,
                                                fontSize: 14.5,
                                                fontWeight: WEIGHT.bold,
                                                letterSpacing: "-0.022em",
                                                color: COLORS.onSurface,
                                            }}
                                        >
                                            {MASTERY_CENTER_BUTTON_LABELS[bar]}
                                        </Box>
                                    </Box>
                                ))}
                            </Box>
                        )}

                        <StudyHand
                            className="flashcards-decks__study-hand"
                            cards={handCards}
                            onStudy={handleStudy}
                        />
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
