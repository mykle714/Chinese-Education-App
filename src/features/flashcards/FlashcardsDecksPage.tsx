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
import SheetPill from "../../components/SheetPill";
import { FOOTER_CLEARANCE } from "../../components/MobileFooter";
import type { VocabEntry } from "../../types";
import { flpReadyCountsByBand, nextFlpReadyMs } from "../../utils/flpReadiness";
import { formatCooldownRemaining } from "../../utils/formatDuration";
import { foreignPromptTrack } from "../../../server/contracts/wire";
import { useFlashcardLearnSettings } from "../../hooks/useFlashcardLearnSettings";
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
//   SHEET (front)  — a MODAL pull-up panel holding every SET of cards:
//                    Collections, Challenges and the user's Decks, and BELOW them the
//                    learner's whole card library as a searchable grid. It is not on
//                    screen at rest: the "Sets & Cards" pill above the footer opens it
//                    (see DecksPanelBody).
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
// The sheet is the SAME component as the eip bottom sheet on flp — `SheetPanel` —
// and as of 2026-08-24 it is used the SAME WAY: a MODAL sheet with the eip's three
// stops {0, default (0.6 of the frame), max (0.92)}, its scrim, and its default
// 0.5 collapse rule. It used to run in persistent mode (`minHeight` > 0, no scrim,
// stops {resting, max}), resting as a lip above the footer that had to be dragged
// up. The lip is gone; the entry point is now a BUTTON, exactly as the eip's is on
// flp (`MoreInfoPill` → `openEicSheet`): the sheet is mounted only while open, so
// every open replays the 0 → default animation.
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

// ── The "Sets & Cards" pill ───────────────────────────────────────────────────
// The sheet's only entry point, and the direct counterpart of the flp's More Info
// pill: a capsule floating over the bottom of the study area, under the sheet's own
// scrim (zIndex 2 vs the scrim's 10) so it dims and goes inert while the sheet is up.
//
// It is offset by the FULL footer clearance rather than by FOOTER_HEIGHT, so it
// clears the floating pill bar with the same gap every other page's last row gets.
const SETS_PILL_HEIGHT = 34;
const SETS_PILL_BOTTOM = FOOTER_CLEARANCE;

// Breathing room between the study area's three rows (figure line / Centers rail /
// the card hand), and — via STUDY_AREA_BOTTOM_PAD — between the hand and the pill.
//
// The bottom pad reserves ONLY the pill's own band: `MobileTabScreen`'s content area
// already pads FOOTER_CLEARANCE for the footer bar, which is exactly where the pill
// is anchored. Derived rather than typed, or a taller pill would silently overlap the
// hand's `Study now` button.
const STUDY_AREA_GAP = 12;
const STUDY_AREA_BOTTOM_PAD = SETS_PILL_HEIGHT + STUDY_AREA_GAP;

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

/**
 * The two bands each mode draws from. They PARTITION the four utcm bands, which is what
 * makes Challenge + Review == Study Mix on the hand — see "The three modes' figures".
 * Module scope so the readiness memos below have a stable dependency.
 */
const REVIEW_BANDS = ["Comfortable", "Mastered"] as const;

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
    // Body of the sets sheet; SheetPanel reads {root, scroll} off this handle to
    // wire its resize/scroll coupling.
    const sheetBodyRef = useRef<SheetPanelBodyHandle | null>(null);
    // Is the modal sets sheet up? Mirrors the flp's `isEicOpen`: the panel is mounted
    // ONLY while true, so each open replays SheetPanel's 0 → default animation instead
    // of reappearing at whatever height the last session left it.
    const [sheetOpen, setSheetOpen] = useState(false);
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
    // Each figure is the number of cards THAT MODE COULD DEAL RIGHT NOW: its bands,
    // counted over the library, minus everything still on cooldown.
    //
    //   Challenge   — Unfamiliar + Target      ┐ the two partition the four bands, so
    //   Review      — Comfortable + Mastered   ┘ Challenge + Review == Study Mix
    //   Study Mix   — all four
    //
    // The identity is the point: the hand shows one pool split two ways, and a learner
    // can read the split off the three cards. It also forced a correction — Study Mix
    // used to print Unfamiliar+Target+Comfortable and silently omit Mastered, while its
    // loop (DEFAULT_LOOP_CONFIG, OnDeckVocabService.ts) has always dealt 1 Mastered card
    // in 10. The figure was understating the mode's own pool by the largest band a
    // long-running account has.
    //
    // READINESS IS THE flp'S RULE, not this page's: `flpReadyCountsByBand` restates
    // `rankFlpEligible`'s eligibility test (≥1 of the session's two mark types off
    // cooldown, windowed by the card's CORE category) on top of the shared cooldown
    // contract. See src/utils/flpReadiness.ts for why that differs from the card grid's
    // own cooldown sort, which is a per-TYPE measure.
    //
    // Computed on the CLIENT from the already-loaded library rather than fetched: the
    // page holds every sorted card (`panel.allCards`) and the cooldown arithmetic is a
    // shared contract, so a count endpoint would have added a round trip and a second
    // definition of "rested" that could drift from the pool it predicts.
    //
    // ⚠️ `now` is read ONCE per render pass, not per card — a clock that advanced
    // mid-computation could let Challenge + Review disagree with Study Mix by a card.
    // The figures are therefore a snapshot; they refresh when the page re-renders, which
    // is the same freshness the flp pool itself has.
    const { settings: learnSettings } = useFlashcardLearnSettings();
    // Which two tracks the session will present — the same derivation the flp makes, so
    // the count cools on exactly the tracks the learner is about to be shown.
    const foreignTrack = foreignPromptTrack(panel.language ?? "zh", learnSettings.showPinyin);

    const readyCounts = useMemo(
        () => flpReadyCountsByBand(panel.allCards, foreignTrack, Date.now()),
        [panel.allCards, foreignTrack]
    );

    // `undefined` until the library lands, so the cards print an em dash rather than a
    // provisional 0 — 0 is a real answer every one of these figures can give, and on a
    // cooldown count it is a COMMON one (a learner who just finished a session).
    const figuresLoaded = !panel.cardsLoading;
    const ready = useCallback((name: string): number => readyCounts[name] || 0, [readyCounts]);
    const challengePool = figuresLoaded ? ready("Unfamiliar") + ready("Target") : undefined;
    const reviewPool = figuresLoaded ? ready("Comfortable") + ready("Mastered") : undefined;
    const inRotation = figuresLoaded ? (challengePool ?? 0) + (reviewPool ?? 0) : undefined;

    // The LIBRARY figure is a different question ("how many cards do I own") and stays a
    // band total, not a ready count — it must not shrink because cards are resting.
    const libraryTotal = Object.keys(panel.categoryCounts).length > 0
        ? panel.categoryCounts["Unfamiliar"] + panel.categoryCounts["Target"]
            + panel.categoryCounts["Comfortable"] + panel.categoryCounts["Mastered"]
        : undefined;

    // REVIEW is gated on its READY count: with every Comfortable/Mastered card resting
    // there is nothing to review, and the flp cannot lend its way out of that — a lent
    // card has an empty mark history, so it bands Unfamiliar and can never satisfy a
    // Review pool (docs/PROVISIONAL_CARDS.md).
    //
    // Two different zeroes reach this, and they need different messages, so the
    // countdown below distinguishes them: nothing EARNED yet (a new learner) versus
    // everything RESTING (a learner who just reviewed).
    //
    // CHALLENGE has NO eligibility check at all. Its buckets are exactly the ones
    // provisioning fills — a lent card is Unfamiliar — so the server can always build
    // a Challenge loop, even for an account with nothing sorted. Study Mix likewise:
    // there is NO card-count gate into /flashcards/learn any more, because the
    // working-loop endpoint lends cards to reach the flp baseline.
    const reviewEligible = (reviewPool ?? 0) > 0;

    // Time until the soonest Review card rests out, for the greyed-card toast. null when
    // none is resting — which, given reviewPool is 0 here, means the learner owns none.
    const reviewNextReadyMs = useMemo(
        () => nextFlpReadyMs(panel.allCards, REVIEW_BANDS, foreignTrack, Date.now()),
        [panel.allCards, foreignTrack]
    );

    const handCards: StudyHandCard[] = useMemo(() => [
        // ⚠️ `label` is DISPLAY TEXT ONLY. The ids stay `challenge` / `review` — they are
        // the `?mode=` query param the flp parses (FlashcardsLearnPage → `selectedMode`)
        // and the server's own `MODE_CONFIGS` keys. Same split the "Learn Now" rename
        // made (CLAUDE.md § Terminology): rename what the learner reads, never the wire.
        { id: "challenge", label: "Challenge Mix", figure: challengePool, figureCaption: "Cards", hue: HAND_HUES.challenge },
        { id: "review", label: "Review Mix", figure: reviewPool, figureCaption: "Cards", hue: HAND_HUES.review, eligible: reviewEligible },
        { id: "mix", label: "Study Mix", figure: inRotation, figureCaption: "Cards", hue: HAND_HUES.mix },
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
                        {/* `.duebar` — ONE mono overline: the library's size.

                            The artboard's right slot carried a second overline naming the
                            set the hand draws from ("all cards"). It is gone: the hand only
                            ever draws from the whole library, so the label was a constant
                            dressed up as a scope, and a constant on screen is a question the
                            reader has to rule out. Bring it back only if the hand ever gains
                            a scope that can actually change.

                            ⚠️ The artboard's left slot reads "24 due today". A ready
                            count now EXISTS (`flpReadyCountsByBand` — it is what the
                            three hand cards below print), but "due today" is a stronger
                            claim than "ready now": it implies a deadline the app does
                            not model, and nothing expires at midnight. So this slot
                            keeps the library SIZE, which is a different and honest
                            question. If it should carry readiness instead, change the
                            LABEL with it — do not print a ready count under a due
                            caption. See docs/DEFERRED_WORK.md § 9. */}
                        <Box
                            className="flashcards-decks__library-line"
                            sx={{ display: "flex", alignItems: "center", gap: 1.5, flexShrink: 0 }}
                        >
                            {/* Blank until the count lands, then a fade — the same contract
                                the hand's corner tags keep, so the page has ONE way of
                                saying "not yet" rather than a mono ellipsis here and empty
                                tags an inch below. It used to read "counting…", which is a
                                second loading vocabulary for a line that is only ever a
                                figure. The element stays mounted throughout so the fade has
                                something to run on, and `\u00A0` holds the line box open so
                                the hand beneath does not shift up and settle back. */}
                            <Label
                                className="flashcards-decks__library-total"
                                sx={{
                                    opacity: libraryTotal === undefined ? 0 : 1,
                                    transition: "opacity 320ms ease",
                                }}
                            >
                                {libraryTotal === undefined ? "\u00A0" : `${libraryTotal.toLocaleString()} cards`}
                            </Label>
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

                {/* The "Sets & Cards" pill — the sheet's entry point, and the twin of
                    the flp's More Info pill (shared body: `SheetPill`). It sits INSIDE
                    the positioned frame (not the scroll area) at zIndex 2, so
                    SheetPanel's scrim (zIndex 10) covers it while the sheet is up: the
                    pill dims and stops taking taps exactly when it has nothing left to
                    do. */}
                <SheetPill
                    className="flashcards-decks__sets-pill"
                    label="Sets & Cards"
                    onClick={() => setSheetOpen(true)}
                    ariaLabel="Open sets and cards"
                    ariaExpanded={sheetOpen}
                    bottom={SETS_PILL_BOTTOM}
                    height={SETS_PILL_HEIGHT}
                />

                {/* The sets sheet. MODAL, with the eip's stops and scrim: mounted only
                    while open, dismissed by a downward drag or a scrim tap. */}
                {sheetOpen && (
                <SheetPanel
                    onClose={() => setSheetOpen(false)}
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
                )}
            </Box>

                {/* Toast: greyed Review tapped. TWO reasons the figure can be 0, and they
                    call for opposite advice — go earn some cards, or come back later —
                    so the message branches on whether anything is merely resting. */}
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
                        {reviewNextReadyMs === null
                            ? "Mark more cards in Study Mix to unlock this deck."
                            : `All your review cards are resting. Next ready in ${formatCooldownRemaining(reviewNextReadyMs)}.`}
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
