import { useState, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Box } from "@mui/material";
import NodePage from "../../components/NodePage";
import { ScrollPastSpacer, FOOTER_CLEARANCE, FOOTER_HEIGHT } from "../../components/MobileFooter";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { usePageTitle } from "../../hooks/usePageTitle";
import DecksSheets, { DECKS_SHEET_PILL_BAND, type DecksSheetsHandle } from "./DecksSheets";
import { useDecksPanel } from "./useDecksPanel";
import { withLens } from "./collectionRef";
import {
    MASTERY_CENTER_PATHS, MASTERY_CENTER_TITLES, MASTERY_CENTER_GROUNDS, MASTERY_CENTER_HUES, type MasteryCenterBar,
} from "./masteryCenters";
import WritingPracticeGrid from "./centers/WritingPracticeGrid";
import WritingGamesCarousel from "./centers/WritingGamesCarousel";
import ReadingGamesCarousel, { readReturnedGame } from "./centers/ReadingGamesCarousel";
import { usePinScrollBottom } from "../../hooks/usePinScrollBottom";
import ReadingSwipeGrid from "./centers/ReadingSwipeGrid";
import WordOfTheDayCard from "./centers/WordOfTheDayCard";
import FlpStudyHand from "./FlpStudyHand";
import type { VocabEntry } from "../../types";
import { readBackSnapshot, saveBackSnapshot } from "./backRestore";

/**
 * ONE page for both Mastery Centers — the Reading Center (`/flashcards/reading`) and
 * the Writing Center (`/flashcards/writing`).
 *
 * ── What it is (since the 2026-10-02 redesign) ────────────────────────────────
 * A skill STUDY page on the skill's own ground (`MASTERY_CENTER_GROUNDS`): the things a
 * learner does to train that one skill, top to bottom, with the fdp's decks panel
 * behind the same two pill-raised sheets the fdp has (`DecksSheets`), read through this
 * Center's lens. docs/READING_WRITING_CENTERS.md tracks the build phase by phase:
 *
 *   Reading — word of the day (phase 3), Reading Flashcards stack (phase 4),
 *             word swipe grid (phase 2), reading games carousel.
 *   Writing — word of the day (phase 3), Writing Flashcards stack (the writing flp,
 *             docs/WRITING_PRACTICE_REWORK.md § 3), 6×6 word practice grid (phase 5),
 *             the writing games belt — Writing Grid (§ 2) + Writing Notebook
 *             (docs/WRITING_NOTEBOOK.md).
 *
 * It used to BE the decks panel rendered as a page (`DecksPanelBody` variant "page").
 * The panel's data still comes from `useDecksPanel(lens)` — now also feeding the
 * character grid its card library — and its pixels from `DecksPanelBody`, both shared
 * verbatim with the fdp.
 *
 * ── Why a page and not a third tab ────────────────────────────────────────────
 * A Center is a drill-in from the fdp, so it is a NODE page (docs/UX_AND_NAVIGATION.md):
 * left back arrow, horizontal slide, and the Flashcards footer tab stays lit.
 *
 * ── Navigation carries the lens ───────────────────────────────────────────────
 * Every link OUT of the sheets keeps it. A per-bar collection (Learn Now / Mastered)
 * carries its lens in its own id; a DECK and a CARD are bar-agnostic sets, so they get
 * `?bar=` (`withLens`). Without that, tapping a deck inside the Reading Center would
 * silently drop the learner back into a core view of it.
 *
 * ── Not gated ─────────────────────────────────────────────────────────────────
 * The fdp's Center BUTTONS are gated on the goal flags; this route is not. Reading and
 * writing marks accrue for every account regardless of goals (migration 143), so a
 * hand-typed URL shows a truthful page rather than a wall. See masteryCenters.ts.
 *
 * Layer: feature page (src/features/flashcards).
 * Docs: docs/READING_WRITING_CENTERS.md, docs/DECKS_FEATURE.md § "Mastery Centers",
 * docs/MASTERY_REWORK.md § "Three bars".
 */
/** Both Centers' compact card hand height — the design's `.rstk` (178px). */
const READING_HAND_HEIGHT = 178;

/**
 * How far the Centers' bottom fade reaches ABOVE the pill band, in px. The fade is a
 * linear ramp, so content just above the pills is still mostly transparent only if the
 * ramp keeps going well past them — this is that overshoot.
 */
const CENTER_FADE_REACH_ABOVE_PILLS = 48;

/**
 * The Centers' bottom edge-fade band, in px: from the footer bar's top edge up past the
 * Cards/Decks pills (which float FOOTER_CLEARANCE above the frame bottom, i.e. the
 * clearance's gap above the bar), their breathing room, and a further reach above. So
 * content scrolling under the pills has already dissolved into the ground instead of
 * showing through as noise. Derived, so a taller pill or a moved footer keeps the band
 * reaching past it. Must stay ≤ `EDGE_FADE_VAR_CAP` (scrollEdgeFade.ts).
 */
const CENTER_BOTTOM_FADE_BAND =
    FOOTER_CLEARANCE - FOOTER_HEIGHT + DECKS_SHEET_PILL_BAND + CENTER_FADE_REACH_ABOVE_PILLS;

const MasteryCenterPage: React.FC = () => {
    const navigate = useNavigate();
    // Decks/cards/games opened from here are drill-ins that slide over this page.
    const slideNavigate = useSlideNavigate();
    const { pathname, key: locationKey, state: locationState } = useLocation();

    // Which Center is this? Derived from the path rather than a route param, so the
    // two routes are literal strings in one table (masteryCenters.ts) and a typo
    // cannot produce a third, meaningless Center. Anything unrecognized reads as the
    // Reading Center — a defined page beats a blank one if the table and the registry
    // ever disagree.
    const bar: MasteryCenterBar =
        pathname === MASTERY_CENTER_PATHS.writing ? "writing" : "reading";
    const title = MASTERY_CENTER_TITLES[bar];
    usePageTitle(title);

    // Back restore (backRestore.ts): a Center left for a card or a set comes back with
    // the same sheet up at the same height, search, sort, filter and sheet scroll.
    const [restored] = useState(() => readBackSnapshot("mastery-center", locationKey));
    const panel = useDecksPanel(bar, restored?.panel);
    const sheetsRef = useRef<DecksSheetsHandle | null>(null);

    // Returning from a game this Center launched — either Center's games belt (the
    // game's exit carries `returnedFromGame` — games/runtime/gameExit; the Writing
    // Notebook's Back carries it too): reopen scrolled all the way down to the belt,
    // which sits last on both Centers, parked on the card just left. Pinned
    // rather than set once, because the sections above load after mount and grow
    // (usePinScrollBottom). Read once: later re-renders must not re-pin.
    const [returnedFromGame] = useState(() => readReturnedGame(locationState));
    const bodyRef = useRef<HTMLDivElement | null>(null);
    usePinScrollBottom(bodyRef, returnedFromGame !== null);

    // Ref-held so the open handlers stay stable for the memoized cards (see the fdp).
    const rememberPlace = () => {
        saveBackSnapshot("mastery-center", locationKey, {
            panel: panel.snapshot(),
            ...(sheetsRef.current?.capture() ?? { openSheet: null, sheetHeight: null, scrollTop: 0 }),
        });
    };
    const rememberPlaceRef = useRef(rememberPlace);
    rememberPlaceRef.current = rememberPlace;

    // A card opened from here keeps the lens, so its detail page shows this skill's
    // bar and cooldown rather than all of them (VocabCardDetailPage).
    const handleOpenCard = useCallback(
        (entry: VocabEntry) => {
            rememberPlaceRef.current();
            slideNavigate(withLens(`/flashcards/card/${entry.id}`, bar));
        },
        [slideNavigate, bar]
    );

    // Same rule for a set: the per-bar collections carry their lens in the id, a deck
    // needs the param. `withLens` is a no-op on a path that is already this bar's.
    const handleOpenPath = useCallback(
        (path: string) => {
            rememberPlaceRef.current();
            slideNavigate(withLens(path, bar));
        },
        [slideNavigate, bar]
    );

    // "Reading Cards" / "Writing Decks" — the sheet names carry the skill so a sheet
    // pulled to full height still says whose cards these are. The pills stay short.
    const skill = bar === "reading" ? "Reading" : "Writing";

    return (
        <NodePage
            title={title}
            onBack={() => navigate("/flashcards/decks")}
            contentClassName={`mastery-center-page__content mastery-center-page__content--${bar}`}
            surfaceColor={MASTERY_CENTER_GROUNDS[bar]}
            bottomFadeBand={CENTER_BOTTOM_FADE_BAND}
            // The Reading Center's games carousel is a sideways scroller; the scroll
            // area's own touch-action would otherwise cap it (NodePage.horizontalPan).
            horizontalPan={bar === "reading"}
            // The pills + sheets sit beside the scroll area, in the frame-filling
            // positioned box SheetPanel measures itself against (NodePage.overlay).
            overlay={
                <DecksSheets
                    ref={sheetsRef}
                    panel={panel}
                    classPrefix="mastery-center"
                    titles={{ cards: `${skill} Cards`, decks: `${skill} Decks` }}
                    pillLabels={{ cards: "Cards", decks: "Decks" }}
                    restore={restored}
                    onOpenPath={handleOpenPath}
                    onOpenCard={handleOpenCard}
                />
            }
        >
            <Box
                ref={bodyRef}
                className={`mastery-center-page__body mastery-center-page__body--${bar}`}
                sx={{
                    width: "100%",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "stretch",
                    // Room under the last section for the two pills, which float one
                    // footer-clearance above the bar (the scroll area already pads the
                    // footer clearance itself).
                    paddingBottom: `${DECKS_SHEET_PILL_BAND}px`,
                }}
            >
                {/* Both Centers open on the global Word of the Day, in the Center's hue. */}
                <WordOfTheDayCard hue={MASTERY_CENTER_HUES[bar]} />
                {bar === "writing" ? (
                    <>
                        {/* The WRITING flp's hand — Writing Challenge / Review / Mix, the same
                            compact stack as the Reading Center's (docs/WRITING_PRACTICE_REWORK.md
                            § 3). zh only: the recognizer is zh_CN. */}
                        {panel.language === "zh" && (
                            <Box
                                className="mastery-center-page__study-hand"
                                sx={{ height: READING_HAND_HEIGHT, margin: "14px 22px 0", display: "flex", flexDirection: "column", flexShrink: 0 }}
                            >
                                <FlpStudyHand bar="writing" variant="compact" />
                            </Box>
                        )}
                        <WritingPracticeGrid
                            cards={panel.allCards}
                            language={panel.language}
                            loading={panel.cardsLoading}
                        />
                        {panel.language === "zh" && (
                            <WritingGamesCarousel className="mastery-center-page__games" focusGameId={returnedFromGame} />
                        )}
                    </>
                ) : (
                    <>
                        {/* The fdp's card hand on the READING bar — Challenge / Review / Study
                            Mix, each opening the reading flp in that mode. zh only: the
                            reading flp has nothing to read on a Latin-script card. StudyHand
                            fills its container, so it gets a fixed (compact) box here; on the
                            fdp it stretches over the study area instead. */}
                        {panel.language === "zh" && (
                            <Box
                                className="mastery-center-page__study-hand"
                                sx={{ height: READING_HAND_HEIGHT, margin: "14px 22px 0", display: "flex", flexDirection: "column", flexShrink: 0 }}
                            >
                                <FlpStudyHand bar="reading" variant="compact" />
                            </Box>
                        )}
                        <ReadingSwipeGrid cards={panel.allCards} loading={panel.cardsLoading} />
                        <ReadingGamesCarousel className="mastery-center-page__games" focusGameId={returnedFromGame} />
                    </>
                )}
                {/* A little give past the last section (the Reading games carousel / the
                    Writing practice grid), so neither Center stops dead on the pills —
                    the hubs' overscroll comfort, MobileFooter. */}
                <ScrollPastSpacer />
            </Box>
        </NodePage>
    );
};

export default MasteryCenterPage;
