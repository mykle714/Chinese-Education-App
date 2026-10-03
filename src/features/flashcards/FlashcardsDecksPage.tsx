import { useState, useCallback, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { Box } from "@mui/material";
import MobileTabScreen from "../../components/MobileTabScreen";
import { readBackSnapshot, saveBackSnapshot } from "./backRestore";
import DecksSheets, { DECKS_SHEET_PILL_BAND, type DecksSheetsHandle } from "./DecksSheets";
import { useDecksPanel } from "./useDecksPanel";
import { usePageTitle } from "../../hooks/usePageTitle";
import {
    activeMasteryCenters, MASTERY_CENTER_PATHS, MASTERY_CENTER_BUTTON_LABELS,
    MASTERY_CENTER_HUES, MASTERY_CENTER_GLYPHS,
} from "./masteryCenters";
import Icon from "../../components/Icon";
import FlpStudyHand from "./FlpStudyHand";
import type { VocabEntry } from "../../types";
import { COLORS, RAMP } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { WEIGHT } from "../../theme/scale";
import { CARD_SURFACE } from "../../theme/surfaces";

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
//   PAGE (behind)  — the STUDY AREA: the Reading/Writing Center rail (when the
//                    account pursues those goals), and the three ways
//                    into a session held as a fanned HAND of cards — Study Mix played
//                    forward, Review and Challenge peeking behind it (`StudyHand`,
//                    artboards 2 / 2b). Always reachable without moving anything.
//   SHEETS (front) — TWO modal pull-up panels, raised by the two pills sitting side
//                    by side above the footer (see "The two pills" below):
//                      Cards — the library duo (Learn Now / Mastered) over the whole
//                              card library as a searchable, sortable grid;
//                      Decks — the SETS: Challenges and the user's own Decks.
//                    Neither is on screen at rest. Both are the same component
//                    (`DecksPanelBody`) rendering a different `section`.
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

// ── The two pills ─────────────────────────────────────────────────────────────
// The pills, both sheets and the New-deck dialog live in `DecksSheets`, shared with
// the two Mastery Centers. One "Sets & Cards" pill used to raise a single panel that
// stacked the library duo, Challenges, Decks and a several-hundred-card grid into one
// scroller; splitting the panel split its entry point with it, so the pill's LABEL is
// the answer to which sheet you get. See DecksSheets.tsx.
// Breathing room between the study area's two rows (Centers rail / the card hand).
const STUDY_AREA_GAP = 12;
// The bottom pad reserves ONLY the pills' own band: `MobileTabScreen`'s content area
// already pads FOOTER_CLEARANCE for the footer bar, which is exactly where the pills
// are anchored. Derived rather than typed, or a taller pill would silently overlap the
// hand's `Study now` button.
const STUDY_AREA_BOTTOM_PAD = DECKS_SHEET_PILL_BAND;

const CONTENT_SX = {
    alignItems: "center",
} as const;

// This page is the CORE lens, so its sheets carry the bare names.
const DECKS_SHEET_TITLES = { cards: "Cards", decks: "Decks" } as const;

// Main Component
const FlashcardsDecksPage: React.FC = () => {
    usePageTitle("Decks");
    // Collection pages are node drill-ins that slide over this page, so they use
    // the view-transition navigate and Decks is held beneath. See useSlideNavigate.
    const slideNavigate = useSlideNavigate();
    // ── Back restore (backRestore.ts) ─────────────────────────────────────────
    // If this history entry was left from inside a sheet, come back to that sheet at the
    // same height, scroll, search, sort and filter — on the first frame. Read ONCE per
    // mount; DecksSheets drops the sheet half of it when that sheet closes.
    const { key: locationKey } = useLocation();
    const [restored] = useState(() => readBackSnapshot("decks", locationKey));
    // The whole panel, through the CORE lens — this page's one question. Every fetch,
    // count and ordering behind the sheet lives in the hook, shared verbatim with the
    // two Mastery Centers (useDecksPanel.ts).
    const panel = useDecksPanel("core", restored?.panel);
    // Which Center buttons this account gets: one per goal it has set. Read off the
    // panel's memoized goals rather than `user` again, so the two cannot disagree.
    const centers = activeMasteryCenters(panel.goals);
    // The pills + sheets layer — read only for its state at the moment of leaving.
    const sheetsRef = useRef<DecksSheetsHandle | null>(null);

    // Card Detail is a NODE page that slides over this page. No lens param: this page is
    // the core bar, which is what a card page shows by default.
    // Record where the learner is, the moment before they leave through the sheet, so
    // Back lands them in the same place. Held in a ref so the two open handlers below
    // stay referentially stable — the memoized mini cards re-render if `onCardClick`
    // changes identity — while still reading this render's panel state.
    const rememberPlace = () => {
        saveBackSnapshot("decks", locationKey, {
            panel: panel.snapshot(),
            ...(sheetsRef.current?.capture() ?? { openSheet: null, sheetHeight: null, scrollTop: 0 }),
        });
    };
    const rememberPlaceRef = useRef(rememberPlace);
    rememberPlaceRef.current = rememberPlace;

    const handleOpenCard = useCallback(
        (entry: VocabEntry) => {
            rememberPlaceRef.current();
            slideNavigate(`/flashcards/card/${entry.id}`);
        },
        [slideNavigate]
    );
    // A set (collection or deck page) opened from either sheet — same Back contract.
    const handleOpenPath = useCallback(
        (path: string) => {
            rememberPlaceRef.current();
            slideNavigate(path);
        },
        [slideNavigate]
    );

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
                        {/* Mastery Centers. The rail is omitted ENTIRELY when the account
                            pursues neither skill (and always for Spanish, which cannot
                            accrue those marks) — an empty row would leave the hand short
                            of the space it would otherwise have. With one goal set the
                            single tile takes the full width, which is correct: it is the
                            only other place to go.

                            Coloured by the SKILL's hue as a PASTEL, not as the saturated
                            mark hue: this is a filled surface, and D2b puts surfaces on
                            the ramp's 93% tier while marks and cells keep the saturated
                            hex. Reading green, writing purple — the same hue the Center
                            it opens grounds on (MASTERY_CENTER_HUES). */}
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
                                            // Same object family as the hand below: a
                                            // pastel card lying on the page. `CARD_SURFACE`
                                            // (theme/surfaces.ts) is that object — hairline +
                                            // RESTING elevation (never the front card's lifted
                                            // one; a tile is not the played card) + the 15px
                                            // card radius, which the flp card and the cdp hero
                                            // now share. The hand keeps its own larger 22px
                                            // radius because those cards are twice the size.
                                            ...CARD_SURFACE,
                                            cursor: "pointer",
                                            padding: "13px 13px 14px",
                                            backgroundColor: RAMP[MASTERY_CENTER_HUES[bar]].surface,  // v2 "Surface: Reading/Writing Centers"
                                        }}
                                    >
                                        <Icon name={MASTERY_CENTER_GLYPHS[bar]} size={19} sx={{ opacity: 0.72 }} />
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

                        {/* The card hand — Challenge / Review / Study Mix on the CORE bar.
                            Figures, Review gate and toast live in FlpStudyHand, shared with
                            the Reading Center (which mounts it on the reading bar). */}
                        <FlpStudyHand className="flashcards-decks__study-hand" bar="core" />
                    </Box>
                </MobileTabScreen>

                {/* The two sheet pills and their modal sheets (shared with the
                    Centers: DecksSheets). Rendered INSIDE the positioned frame (not the
                    scroll area): SheetPanel sizes itself from this box, and the pills'
                    zIndex 2 sits under the sheet's scrim so they dim while a sheet is up. */}
                <DecksSheets
                    ref={sheetsRef}
                    panel={panel}
                    classPrefix="flashcards-decks"
                    titles={DECKS_SHEET_TITLES}
                    restore={restored}
                    onOpenPath={handleOpenPath}
                    onOpenCard={handleOpenCard}
                />
            </Box>

        </>
    );
};

export default FlashcardsDecksPage;
