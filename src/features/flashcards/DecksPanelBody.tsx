import { forwardRef, useImperativeHandle, useRef, useState, useCallback } from "react";
import { Box, Typography, IconButton, TextField, InputAdornment, Collapse } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { Search, Clear } from "@mui/icons-material";
import { styled } from "@mui/material/styles";
import { Shelf, ShelfRow, Spine, AddSpine, spineHeight } from "../../components/shelf";
import MiniVocabCardGrid from "../../components/MiniVocabCardGrid";
import LibraryDuo from "./LibraryDuo";
import CollectionSortControl from "./CollectionSortControl";
import type { VocabEntry } from "../../types";
import type { DecksPanelState } from "./useDecksPanel";
import { FOOTER_CLEARANCE } from "../../components/MobileFooter";
import { EDGE_FADE_MASK_NO_TOP } from "../../components/MobileTabScreen";
import type { SheetPanelBodyHandle } from "./FlashcardsLearnPage/SheetPanel";
import { deckTileColors } from "./collectionRef";
import { collectionGlyph } from "./collectionGlyph";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";

// ── What this file is ─────────────────────────────────────────────────────────
//
// The BODY of the decks PANEL: every "set of cards" a learner owns — Collections,
// Challenges and their own Decks — in a three-per-row tile grid, followed by their
// CARDS themselves.
//
// ── Three hosts, one body (docs/DECKS_FEATURE.md § "Mastery Centers") ─────────
//   fdp (/flashcards/decks)  — variant "sheet", lens core. The persistent pull-up
//       sheet behind the study buttons.
//   Reading Center           — variant "page", lens reading.
//   Writing Center           — variant "page", lens writing.
//
// The three differ in exactly two things: how the body is FRAMED (a resizable sheet
// vs. a page's own scroll area) and which mastery bar it is read through. Everything
// else — which collections exist, what their figures say, how the card grid is
// ordered — follows from the lens and is computed once in `useDecksPanel`, whose
// whole state object is passed in here as `panel`.
//
// ── What the LENS changes on this surface ────────────────────────────────────
//   • the tile row is that bar's three collections, with that bar's counts;
//   • the sort menu offers that bar's mastery / cooldown / date-mastered rows;
//   • every card in the grid draws that ONE bar and badges its band.
// A Center therefore answers "how is my reading going, set by set" with the same
// furniture the fdp uses to answer it about recognition and production.
//
// ── Why the cards are on this panel at all ────────────────────────────────────
// The tile sections answer "which set?"; the Cards section at the bottom answers
// "where is that one word?", which is the far more frequent errand and used to cost
// two navigations (All Cards tile → collection page). So the "All Cards" TILE keeps
// its place in the row (the Games hub needs the collection) while its grid also lives
// here, under the same search box /decks used to carry.
//
// The Decks section above it collapses (chevron on its caption, remembered in
// localStorage) so a learner with many decks can fold them away and put the card
// grid straight under the built-in collections.
//
// ── The sheet contract (variant "sheet" only) ────────────────────────────────
// As a SheetPanel body it obeys that contract (see SheetPanel):
//   • the forwarded {root, scroll} handle — `root` is the gesture target that
//     covers the whole body, `scroll` is the single overflow container whose
//     scrollTop decides between resizing the sheet and scrolling the content;
//   • `touchAction: "none"` on the scroller, because SheetPanel routes every
//     touchmove itself rather than letting the browser scroll natively.
// As a PAGE body neither applies: the ref is harmless (nothing reads it) and the
// scroller must keep `touchAction: "pan-y"`, or the page would refuse to scroll at
// all — nothing is intercepting its touchmoves to scroll it for us.
//
// Structurally it mirrors SettingsPanelBody (the other non-eip sheet body) —
// same skeleton, different content. Data is owned by `useDecksPanel`; this file is
// presentation only.
//
// Docs: docs/DECKS_FEATURE.md, docs/MOBILE_TAB_SCREEN_LAYOUT.md.

// ── Rows of spines ───────────────────────────────────────────────────────────
//
// Every set on this panel — a collection, a challenge deck, a user's own deck — is
// a `Spine` standing on a `ShelfRow`'s board (docs/SHELF_REDESIGN.md § A3). This
// replaced a three-per-row wrapping tile grid when `DeckTile` was deleted (D9).
//
// WHAT WENT AWAY, and why none of it is missed:
//   • `TILE_WIDTH` / `TILE_GAP` / `ROW_MAX_WIDTH` — the grid had to cap its own
//     width at exactly three tiles plus two gaps, or a fourth tile crept up onto
//     the row. A shelf has no such arithmetic: spines are a fixed width, the row is
//     as wide as the column, and however many fit, fit.
//   • The CENTERED vs LEFT alignment split. Centering a short row made sense under a
//     centered caption; it does not on a shelf, because the board runs the full
//     width of the row and spines floating in the middle of it look like a mistake.
//     Every row is left-aligned now, so each shelf's spines start on the same
//     column as the one above.
//
// The SHEET squats its spines (the design's `.sheet .sp`): inside a pull-up sheet a
// 140px spine would eat the panel, so every spine there is 74 tall and the height
// stops encoding the count. On the Mastery Center PAGES there is room, so the
// spines band by count via `spineHeight`.
const SHEET_SPINE_HEIGHT = 74;

// The shelf container for this panel. `Shelf` carries the design's 22px PAGE gutter,
// but this panel is not a page — every section heading in it is inset by the panel's
// own 28px (`px: 3.5`), and a shelf 6px narrower than its own caption reads as a
// misalignment rather than a design. So the gutter is overridden to match the
// headings, which is what makes a row's first spine start on the caption's column.
const PanelShelf = styled(Shelf)({
    width: "100%",
    padding: "0 28px",
});

// The sections used to be divided by a 280px centred hairline. The shelf's own BOARD
// now sits at the foot of every row and does that job — a hairline 12px under a board
// reads as a seam, not a separation — so the three `LineSeparator`s were removed with
// the tile grid. Kept out rather than restyled: if a divider is ever wanted again it
// belongs between a row and the NEXT heading, not immediately under a board.

// Section caption above each tile section.
const SectionLabel = styled(Typography)(() => ({
    fontSize: SIZE.body,
    fontWeight: WEIGHT.medium,
    color: COLORS.onSurface,
    fontFamily: FONTS.sans,
}));

// Whether the Decks section is expanded, remembered across visits.
//
// It is a VIEW preference rather than account data, so it stays on the device
// (localStorage) instead of costing a column and a round trip — the same choice
// useTTSSettings / useDiscoverSettings make. Reads are guarded because a private
// browsing context can throw on access, and a lost preference must never take the
// section down with it: the fallback is "expanded", the state the section has when
// nothing is known about the user.
const DECKS_OPEN_KEY = "decksSheet.decksOpen";

const readDecksOpen = (): boolean => {
    try {
        return window.localStorage.getItem(DECKS_OPEN_KEY) !== "false";
    } catch {
        return true;
    }
};

export interface DecksPanelBodyProps {
    /**
     * Everything the panel shows, for one lens — the whole return of `useDecksPanel`.
     *
     * Passed as ONE object rather than twenty props: the fields are not independent
     * (the collections, their counts, the card grid and its default ordering are all
     * derived from the same lens), and splitting them let a host pass a lens-scoped
     * card list beside core-scoped counts without the type system noticing.
     */
    panel: DecksPanelState;
    /**
     * How this body is framed. "sheet" is the fdp's pull-up panel (SheetPanel owns the
     * touch handling); "page" is a Mastery Center, where the body scrolls itself.
     */
    variant?: "sheet" | "page";
    /** Navigate to a set (a collection page or a deck page). */
    onOpenPath: (path: string) => void;
    /** Navigate to one card's detail page. */
    onOpenCard: (entry: VocabEntry) => void;
    /** Open the host's New-deck dialog. */
    onNewDeck: () => void;
    /**
     * The sheet's grabber-drag binder, spread onto the section headings so a vertical
     * drag started on a caption resizes the sheet like the grabber does. Absent in
     * "page" variant — there is nothing to resize.
     */
    headerDragBind?: () => Record<string, unknown>;
}

const DecksPanelBody = forwardRef<SheetPanelBodyHandle, DecksPanelBodyProps>(function DecksPanelBody({
    panel,
    variant = "sheet",
    onOpenPath,
    onOpenCard,
    onNewDeck,
    headerDragBind,
}, ref) {
    const {
        lens, goals, language, collections, tileCount,
        challengeDecks, authoredDecks, decksLoading, decksError,
        visibleCards, cardsTotal, cardsLoading, cardsError,
        cardsSearch, setCardsSearch, cardsSortKey, setCardsSortKey,
    } = panel;
    const isSheet = variant === "sheet";
    const rootRef = useRef<HTMLDivElement | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    // Purely presentational, so it lives here rather than in the page: nothing above
    // this component behaves differently when the deck tiles are folded away.
    const [decksOpen, setDecksOpen] = useState(readDecksOpen);
    const toggleDecksOpen = useCallback(() => {
        setDecksOpen((open) => {
            const next = !open;
            try {
                window.localStorage.setItem(DECKS_OPEN_KEY, String(next));
            } catch {
                // A storage failure costs the memory, not the interaction.
            }
            return next;
        });
    }, []);
    // Getters rather than captured values: SheetPanel reads the handle inside an
    // effect that may run before these refs are attached on a later re-render.
    useImperativeHandle(ref, () => ({
        get root() { return rootRef.current; },
        get scroll() { return scrollRef.current; },
    }), []);

    return (
        <Box
            ref={rootRef}
            className="decks-panel-body"
            sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
        >
            <Box
                ref={scrollRef}
                className="decks-panel-body__scroll"
                sx={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: "auto",
                    // SHEET: SheetPanel owns every touchmove on this body (it decides
                    // between growing the sheet and scrolling this box), so the browser
                    // must not also pan it.
                    // PAGE: nothing is intercepting those touchmoves, so the browser
                    // must pan it — `none` here would make a Mastery Center unscrollable
                    // on touch (see CLAUDE.md § Touch & Scroll: scrolling is opt-in, and
                    // this container is where a Center opts in).
                    touchAction: isSheet ? "none" : "pan-y",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    // ⚠️ NO SHRINKING. This is a SCROLLING column: its content is
                    // meant to overflow and be scrolled, but a flex item's default
                    // `flex-shrink: 1` makes every section compress to fit the box
                    // instead. The visible symptom was the collapsible Decks section
                    // failing to push the Cards grid down when it expanded — the
                    // Collapse (which carries `min-height: 0`, so nothing stopped it)
                    // absorbed its own growth by being squeezed. Pinning every direct
                    // child to its natural height makes the column's height the honest
                    // sum of its sections, which is what the scroller wants anyway.
                    "& > *": { flexShrink: 0 },
                    // The footer bar sits OVER the sheet (it is
                    // rendered at frame level, above the sheet's z-index), so the
                    // last tile row has to clear it exactly as a page's scroll
                    // area does.
                    paddingBottom: `${FOOTER_CLEARANCE}px`,
                    // …and fade out over that same band, so tiles dissolve as they
                    // pass behind the pill instead of being sliced by it. The SAME
                    // mask MobileTabScreen's ScrollArea uses (imported, not
                    // re-derived), minus its top band — the sheet's top edge is its
                    // own grabber, which must stay solid. The mask is anchored to
                    // this element's box, not to the scrolled content, so the fade
                    // stays parked at the bottom edge while the content moves.
                    maskImage: EDGE_FADE_MASK_NO_TOP,
                    WebkitMaskImage: EDGE_FADE_MASK_NO_TOP,
                }}
            >
                {/* ── YOUR LIBRARY ── this LENS's two constants: what is still to be
                    learned in this bar, and what is finished in it. (All Cards has no
                    tile — its grid is the Cards section at the bottom.)

                    These two are the one place the sheet does NOT use a spine, and the
                    reason is in LibraryDuo's header: their SIZE is what the learner came
                    to read, and a 74px spine cannot print a figure worth reading. Every
                    other section below is spines, unchanged (D9). */}
                <Box
                    className="decks-panel-body__library-header"
                    {...(headerDragBind?.() ?? {})}
                    sx={{ width: "100%", px: 3.5, pt: 0.5, pb: 0.5, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1.5 }}
                >
                    <SectionLabel className="decks-panel-body__library-label">Your library</SectionLabel>
                    <SectionLabel className="decks-panel-body__library-note" sx={{ color: COLORS.textFaint }}>
                        the two constants
                    </SectionLabel>
                </Box>

                <LibraryDuo
                    className="decks-panel-body__library-duo"
                    entries={collections}
                    count={tileCount}
                    onOpenPath={onOpenPath}
                    headerDragBind={headerDragBind}
                />

                {/* ── Challenges ── (docs/STUDY_CHALLENGE.md § 4). Placed immediately
                    BEFORE the user's own Decks so generated sets sit above authored
                    ones and the user's decks keep a stable position at the bottom.

                    OMITTED ENTIRELY when there is no active challenge deck — an empty
                    captioned section is noise in a panel whose job is to be scannable.

                    There is NO lock badge; the deck's immutability shows up as the
                    absence of controls on its own page. */}
                {challengeDecks.length > 0 && (
                    <>
                        <Box
                            className="decks-panel-body__challenges-header"
                            {...(headerDragBind?.() ?? {})}
                            sx={{ width: "100%", px: 3.5, pt: 2, pb: 1 }}
                        >
                            <SectionLabel className="decks-panel-body__challenges-label">Challenges</SectionLabel>
                        </Box>
                        <PanelShelf><ShelfRow className="decks-panel-body__challenges-list" scrollable>
                            {challengeDecks.map((deck, index) => (
                                <Spine
                                    key={deck.id}
                                    className="decks-panel-body__challenge-spine"
                                    label={deck.name}
                                    count={deck.cardCount}
                                    glyph={collectionGlyph({ kind: "deck", deckId: deck.id })}
                                    variant={isSheet ? "base" : spineHeight(deck.cardCount)}
                                    height={isSheet ? SHEET_SPINE_HEIGHT : undefined}
                                    color={deckTileColors(deck.id).main}
                                    animationDelay={Math.min(index, 5) * 70}
                                    onClick={() => onOpenPath(`/flashcards/deck/${deck.id}`)}
                                />
                            ))}
                        </ShelfRow></PanelShelf>
                    </>
                )}

                {/* ── Decks ── the user's own sets. COLLAPSIBLE: the whole caption row
                    is the toggle (a wide target beats a 24px chevron on a phone), while
                    the + button keeps its own handler and stops the tap from also
                    folding the section it is about to add to.

                    The caption row still carries headerDragBind, so a vertical DRAG
                    started on it resizes the sheet; useDrag's filterTaps is what keeps
                    the tap-to-toggle working through the same binding. */}
                <Box
                    className="decks-panel-body__decks-header"
                    {...(headerDragBind?.() ?? {})}
                    role="button"
                    aria-expanded={decksOpen}
                    onClick={toggleDecksOpen}
                    sx={{
                        width: "100%", px: 3.5, pt: 2, pb: 1,
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        cursor: "pointer",
                    }}
                >
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                        {/* Rotated rather than swapped for a second icon, so the arrow
                            turns with the section instead of cutting to a new glyph. */}
                        <ExpandMoreIcon
                            className="decks-panel-body__decks-chevron"
                            sx={{
                                fontSize: 20,
                                color: COLORS.onSurface,
                                transition: "transform 180ms ease",
                                transform: decksOpen ? "rotate(0deg)" : "rotate(-90deg)",
                            }}
                        />
                        <SectionLabel className="decks-panel-body__decks-label">
                            Decks{authoredDecks.length > 0 ? ` (${authoredDecks.length})` : ""}
                        </SectionLabel>
                    </Box>
                </Box>

                <Collapse in={decksOpen} timeout={180} sx={{ width: "100%" }} unmountOnExit>
                    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
                        {(decksError || (!decksLoading && authoredDecks.length === 0)) && (
                            <Box className="decks-panel-body__decks-message" sx={{ width: "100%", px: 3.5, pb: 1 }}>
                                <Typography
                                    className={decksError ? "decks-panel-body__decks-error" : "decks-panel-body__decks-empty"}
                                    sx={{ fontSize: SIZE.body, fontFamily: FONTS.sans, color: COLORS.textSecondary }}
                                >
                                    {decksError ??
                                        "No decks yet. Tap + to make one, then add cards to it from any card's detail page."}
                                </Typography>
                            </Box>
                        )}

                        {/* The user's decks, wrapping at three per row — the same tile as
                            every built-in set above, carrying the deck's derived pastel
                            (deckTileColors: computed from the id, never stored). */}
                        {/* Scrolls sideways rather than wrapping: this is the one
                            GROWING list on the panel, and a wrapped second line would
                            put its spines below the board, standing on nothing. The
                            AddSpine rides at the end of the row — it is the design's
                            own "new deck" affordance (`.sp.add`), which is why the
                            section header no longer carries a + button. */}
                        <PanelShelf><ShelfRow className="decks-panel-body__decks-list" scrollable>
                            {authoredDecks.map((deck, index) => (
                                <Spine
                                    key={deck.id}
                                    className="decks-panel-body__deck-spine"
                                    label={deck.name}
                                    count={deck.cardCount}
                                    glyph={collectionGlyph({ kind: "deck", deckId: deck.id })}
                                    variant={isSheet ? "base" : spineHeight(deck.cardCount)}
                                    height={isSheet ? SHEET_SPINE_HEIGHT : undefined}
                                    color={deckTileColors(deck.id).main}
                                    // Stagger only within the first couple of rows; past
                                    // that the cascade would run longer than the scroll.
                                    animationDelay={Math.min(index, 5) * 70}
                                    onClick={() => onOpenPath(`/flashcards/deck/${deck.id}`)}
                                />
                            ))}
                            <AddSpine
                                className="decks-panel-body__new-deck-spine"
                                label="New deck"
                                height={isSheet ? SHEET_SPINE_HEIGHT : undefined}
                                onClick={onNewDeck}
                            />
                        </ShelfRow></PanelShelf>
                    </Box>
                </Collapse>


                {/* ── Cards ── the learner's whole sorted library, inline, replacing the
                    All Cards TILE that used to send them to a page to see the same grid.
                    Search is client-side over the already-loaded set (the page owns the
                    filter, via the same filterVocabEntries the collection page uses), so
                    typing costs no round trip.

                    The caption shows the UNFILTERED total: it names the size of the set,
                    and a number that shrank as you typed would be reporting the search
                    rather than the library. */}
                <Box
                    className="decks-panel-body__cards-header"
                    {...(headerDragBind?.() ?? {})}
                    sx={{ width: "100%", px: 3.5, pt: 2, pb: 1 }}
                >
                    <SectionLabel className="decks-panel-body__cards-label">
                        Cards{cardsTotal > 0 ? ` (${cardsTotal})` : ""}
                    </SectionLabel>
                </Box>

                {/* Sized to the 364px card grid below so the input lines up over the
                    cards, exactly as it does on the collection page. */}
                <Box className="decks-panel-body__cards-search" sx={{ width: 364, maxWidth: "100%", px: 3.5 }}>
                    <TextField
                        className="decks-panel-body__cards-search-input"
                        fullWidth
                        size="small"
                        placeholder="Search your cards..."
                        value={cardsSearch}
                        onChange={(e) => setCardsSearch(e.target.value)}
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start">
                                    <Search sx={{ color: COLORS.textSecondary }} />
                                </InputAdornment>
                            ),
                            endAdornment: cardsSearch ? (
                                <InputAdornment position="end">
                                    <IconButton
                                        className="decks-panel-body__cards-search-clear"
                                        aria-label="Clear search"
                                        size="small"
                                        onClick={() => setCardsSearch("")}
                                    >
                                        <Clear fontSize="small" />
                                    </IconButton>
                                </InputAdornment>
                            ) : undefined,
                        }}
                        sx={{ backgroundColor: COLORS.background, borderRadius: "8px" }}
                    />
                </Box>

                {/* Same picker as the collection page (CollectionSortControl), on the
                    same 364px column as the search box and the grid. */}
                <CollectionSortControl
                    classPrefix="decks-panel-body__cards"
                    sortKey={cardsSortKey}
                    onSortKeyChange={setCardsSortKey}
                    language={language}
                    goals={goals}
                    lens={lens}
                    // Common orderings only: this is the whole library, opened to FIND
                    // a card, so the per-skill (reading / writing) mastery rows are
                    // left to the collection pages that are about those bars.
                    allowPerSkillBars={false}
                    sx={{ width: 364, maxWidth: "100%", px: 3.5, pt: 1 }}
                />

                <MiniVocabCardGrid
                    entries={visibleCards}
                    // One strip per card, on the panel's own bar (core in the fdp).
                    lens={lens}
                    loading={cardsLoading}
                    error={cardsError}
                    emptyMessage={
                        cardsSearch.trim()
                            ? "No cards match your search."
                            : "Please go to the Discover tab to select cards you would like to learn"
                    }
                    onCardClick={onOpenCard}
                    containerClassName="decks-panel-body__cards-grid"
                    classPrefix="decks-panel-body__cards"
                />
            </Box>
        </Box>
    );
});

export default DecksPanelBody;
