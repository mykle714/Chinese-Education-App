import { useState, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import NodePage from "../../components/NodePage";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { usePageTitle } from "../../hooks/usePageTitle";
import DecksPanelBody from "./DecksPanelBody";
import NewDeckDialog from "./NewDeckDialog";
import { useDecksPanel } from "./useDecksPanel";
import { withLens } from "./collectionRef";
import {
    MASTERY_CENTER_PATHS, MASTERY_CENTER_TITLES, type MasteryCenterBar,
} from "./masteryCenters";
import type { VocabEntry } from "../../types";
import type { SheetPanelBodyHandle } from "../../components/sheet/SheetPanel";
import { readBackSnapshot, saveBackSnapshot } from "./backRestore";

/**
 * ONE page for both Mastery Centers — the Reading Center (`/flashcards/reading`) and
 * the Writing Center (`/flashcards/writing`).
 *
 * ── What it is ────────────────────────────────────────────────────────────────
 * The fdp's decks panel, rendered as a PAGE instead of a pull-up sheet and read
 * through ONE skill bar. Same collections, same decks, same searchable card grid; every
 * figure, ordering, bar strip and band badge on it answers "how is my reading (writing)
 * going" rather than "how well do I know this word".
 *
 * Nothing here decides what any of that means — `useDecksPanel(lens)` owns the data and
 * `DecksPanelBody` owns the presentation, both shared verbatim with the fdp. This file
 * is the FRAME: which lens, which title, and the page chrome around the body.
 *
 * ── Why a page and not a third tab ────────────────────────────────────────────
 * A Center is a drill-in from the fdp, so it is a NODE page (docs/UX_AND_NAVIGATION.md):
 * left back arrow, horizontal slide, and the Flashcards footer tab stays lit. A learner
 * is never "in" the Reading Center the way they are in Decks — they go there, look, and
 * come back.
 *
 * ── Navigation carries the lens ───────────────────────────────────────────────
 * Every link OUT of this page keeps it. A per-bar collection (Learn Now / Mastered)
 * carries its lens in its own id, so those tiles need nothing added; a DECK and a CARD
 * are bar-agnostic sets, so they get `?bar=` (`withLens`). Without that, tapping a deck
 * inside the Reading Center would silently drop the learner back into a core view of it.
 *
 * ── Not gated ─────────────────────────────────────────────────────────────────
 * The fdp's Center BUTTONS are gated on the goal flags; this route is not. Reading and
 * writing marks accrue for every account regardless of goals (migration 143), so a
 * hand-typed URL shows a truthful page rather than a wall. See masteryCenters.ts.
 *
 * Layer: feature page (src/features/flashcards).
 * Docs: docs/DECKS_FEATURE.md § "Mastery Centers", docs/MASTERY_REWORK.md § "Three bars".
 */
const MasteryCenterPage: React.FC = () => {
    const navigate = useNavigate();
    // Decks/cards opened from here are node/leaf drill-ins that slide over this page.
    const slideNavigate = useSlideNavigate();
    const { pathname, key: locationKey } = useLocation();

    // Which Center is this? Derived from the path rather than a route param, so the
    // two routes are literal strings in one table (masteryCenters.ts) and a typo
    // cannot produce a third, meaningless Center. Anything unrecognized reads as the
    // Reading Center — unreachable via the route table, and a defined page beats a
    // blank one if the table and the registry ever disagree.
    const bar: MasteryCenterBar =
        pathname === MASTERY_CENTER_PATHS.writing ? "writing" : "reading";
    const title = MASTERY_CENTER_TITLES[bar];
    usePageTitle(title);

    // Back restore (backRestore.ts): a Center left for a card or a set comes back with
    // the same search, sort, filter and scroll, painted from the cached lists at once.
    const [restored] = useState(() => readBackSnapshot("mastery-center", locationKey));
    const panel = useDecksPanel(bar, restored?.panel);
    // The body's handle — only its scroller is read, at the moment of leaving.
    const bodyRef = useRef<SheetPanelBodyHandle | null>(null);

    // Ref-held so the open handlers stay stable for the memoized cards (see the fdp).
    const rememberPlace = () => {
        saveBackSnapshot("mastery-center", locationKey, {
            panel: panel.snapshot(),
            scrollTop: bodyRef.current?.scroll?.scrollTop ?? 0,
        });
    };
    const rememberPlaceRef = useRef(rememberPlace);
    rememberPlaceRef.current = rememberPlace;
    const [newDeckOpen, setNewDeckOpen] = useState(false);

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

    return (
        <>
            <NodePage
                title={title}
                onBack={() => navigate("/flashcards/decks")}
                contentClassName="mastery-center-page__content"
                // The PANEL BODY owns the scrolling here, exactly as it does inside the
                // fdp's sheet: it is one overflow container with its own bottom fade and
                // footer clearance. A second scroll area around it would give the page
                // two nested scrollers and a fade at each edge.
                scrollable={false}
            >
                <DecksPanelBody
                    ref={bodyRef}
                    panel={panel}
                    initialScrollTop={restored?.scrollTop}
                    variant="page"
                    onOpenPath={handleOpenPath}
                    onOpenCard={handleOpenCard}
                    onNewDeck={() => setNewDeckOpen(true)}
                    // No headerDragBind: there is no sheet to resize.
                />
            </NodePage>

            <NewDeckDialog
                classPrefix="mastery-center"
                open={newDeckOpen}
                onClose={() => setNewDeckOpen(false)}
                onCreate={panel.addDeck}
            />
        </>
    );
};

export default MasteryCenterPage;
