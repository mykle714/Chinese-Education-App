import { forwardRef, useImperativeHandle, useRef } from "react";
import { Box, Typography, IconButton } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { styled } from "@mui/material/styles";
import DeckTile from "../../components/DeckTile";
import { FLOATING_FOOTER_CLEARANCE } from "../../components/MobileFooter";
import { EDGE_FADE_MASK_NO_TOP } from "../../components/MobileTabScreen";
import type { SheetPanelBodyHandle } from "./FlashcardsLearnPage/SheetPanel";
import type { BuiltinCollectionEntry } from "./builtinCollections";
import { collectionPath, deckTileColors } from "./collectionRef";
import { collectionIcon } from "./collectionIcon";
import type { DeckSummary } from "../../api/decks";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";

// ── What this file is ─────────────────────────────────────────────────────────
//
// The BODY of the /decks pull-up sheet: every "set of cards" the page offers —
// Collections, Mastered, Challenges and the user's own Decks — in the three-per-row
// tile grid the page used to render inline.
//
// It is a SheetPanel body, so it obeys that contract (see SheetPanel):
//   • the forwarded {root, scroll} handle — `root` is the gesture target that
//     covers the whole body, `scroll` is the single overflow container whose
//     scrollTop decides between resizing the sheet and scrolling the content;
//   • `touchAction: "none"` on the scroller, because SheetPanel routes every
//     touchmove itself rather than letting the browser scroll natively.
//
// Structurally it mirrors SettingsPanelBody (the other non-eip sheet body) —
// same skeleton, different content. Data (counts, deck list, loading/error) is
// owned by FlashcardsDecksPage and passed in; this file is presentation only.
//
// Docs: docs/DECKS_FEATURE.md, docs/MOBILE_TAB_SCREEN_LAYOUT.md.

// A row of DeckTiles. THREE PER ROW is the grid unit — every section uses it
// (Collections holds two or three, Mastered up to three, and the user's decks wrap).
//
// A WRAPPING FLEX capped at exactly three tiles' worth of width, rather than a
// 3-column grid: a grid pins every tile to a column, so its last row is stuck with
// visibly empty columns and neither alignment below is expressible.
//
// The gaps are derived, not typed in twice: ROW_MAX_WIDTH must stay exactly
// 3 tiles + 2 column gaps, or a wider gap would push the third tile onto its own
// line (and a narrower one would let a fourth tile up). Change TILE_GAP alone.
// TILE_WIDTH must equal DeckTile's natural width (SIZING.cardWidth).
const TILE_WIDTH = 100;     // DeckTile's natural width (SIZING.cardWidth)
const TILE_GAP = 18;        // between tiles in a row
const TILE_ROW_GAP = 18;    // between wrapped rows — a touch looser, so rows read as rows
const ROW_MAX_WIDTH = 3 * TILE_WIDTH + 2 * TILE_GAP;

// The two alignments, and why the sheet uses both:
//
//   CENTERED (default) — the BUILT-IN sections. Collections and Mastered are fixed sets of
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

const LineSeparator = styled(Box)(() => ({
    width: 280,
    height: 1,
    backgroundColor: COLORS.border,
    margin: "0 auto",
}));

// Section caption above each tile section.
const SectionLabel = styled(Typography)(() => ({
    fontSize: SIZE.body,
    fontWeight: WEIGHT.medium,
    color: COLORS.onSurface,
    fontFamily: FONTS.sans,
}));

export interface DecksSheetBodyProps {
    // Built-in collections, already grouped and filtered by the page.
    collectionsSection: BuiltinCollectionEntry[];
    masteredSection: BuiltinCollectionEntry[];
    // Mastered gets its own captioned section only when more than one bar is
    // active; otherwise its single tile rides along in Collections (hasMasteredSection).
    showMasteredSection: boolean;
    // Figure shown on a built-in tile. Derived by the page from the count hooks;
    // undefined while a count is still loading (DeckTile renders no figure then).
    tileCount: (entry: BuiltinCollectionEntry) => number | undefined;
    // Generated (editMode === "preset") challenge decks and the user's own decks.
    challengeDecks: DeckSummary[];
    authoredDecks: DeckSummary[];
    decksLoading: boolean;
    decksError: string | null;
    onOpenPath: (path: string) => void;
    onNewDeck: () => void;
    // The sheet's grabber-drag binder, spread onto the section headings so a
    // vertical drag started on a caption resizes the sheet like the grabber does.
    headerDragBind?: () => Record<string, unknown>;
}

const DecksSheetBody = forwardRef<SheetPanelBodyHandle, DecksSheetBodyProps>(function DecksSheetBody({
    collectionsSection,
    masteredSection,
    showMasteredSection,
    tileCount,
    challengeDecks,
    authoredDecks,
    decksLoading,
    decksError,
    onOpenPath,
    onNewDeck,
    headerDragBind,
}, ref) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    // Getters rather than captured values: SheetPanel reads the handle inside an
    // effect that may run before these refs are attached on a later re-render.
    useImperativeHandle(ref, () => ({
        get root() { return rootRef.current; },
        get scroll() { return scrollRef.current; },
    }), []);

    return (
        <Box
            ref={rootRef}
            className="decks-sheet-body"
            sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
        >
            <Box
                ref={scrollRef}
                className="decks-sheet-body__scroll"
                sx={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: "auto",
                    // SheetPanel owns every touchmove on this body (it decides
                    // between growing the sheet and scrolling this box), so the
                    // browser must not also pan it.
                    touchAction: "none",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    // The floating footer pill hovers OVER the sheet (it is
                    // rendered at frame level, above the sheet's z-index), so the
                    // last tile row has to clear it exactly as a page's scroll
                    // area does.
                    paddingBottom: `${FLOATING_FOOTER_CLEARANCE}px`,
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
                {/* ── Collections ── the whole library and the part still being learned,
                    plus the single Mastered tile when it has no section of its own.
                    Every tile is the same object as a user's deck below; only what
                    defines the set differs. */}
                <Box
                    className="decks-sheet-body__collections-header"
                    {...(headerDragBind?.() ?? {})}
                    sx={{ width: "100%", px: 3.5, pt: 0.5, pb: 0.5 }}
                >
                    <SectionLabel className="decks-sheet-body__collections-label">Collections</SectionLabel>
                </Box>

                <TileGrid className="decks-sheet-body__collections-row">
                    {collectionsSection.map((entry, index) => (
                        <DeckTile
                            key={entry.key}
                            className={`decks-sheet-body__collection-tile decks-sheet-body__collection-tile--${entry.key}`}
                            label={entry.label}
                            count={tileCount(entry)}
                            icon={collectionIcon(entry.ref)}
                            mainColor={entry.colors.main}
                            accentColor={entry.colors.accent}
                            animationDelay={index * 70}
                            onClick={() => onOpenPath(collectionPath(entry.ref))}
                        />
                    ))}
                </TileGrid>

                <LineSeparator className="decks-line-separator" />

                {/* ── Mastered ── one tile per ACTIVE mastery bar, and ONLY when
                    there is more than one of them: with core alone the tile sits in
                    Collections above, because a captioned section holding a single tile is
                    a heading for nothing. */}
                {showMasteredSection && (
                    <>
                        <Box
                            className="decks-sheet-body__mastered-header"
                            {...(headerDragBind?.() ?? {})}
                            sx={{ width: "100%", px: 3.5, pt: 2, pb: 0.5 }}
                        >
                            <SectionLabel className="decks-sheet-body__mastered-label">Mastered</SectionLabel>
                        </Box>

                        <TileGrid className="decks-sheet-body__mastered-row">
                            {masteredSection.map((entry, index) => (
                                <DeckTile
                                    key={entry.key}
                                    className={`decks-sheet-body__mastered-tile decks-sheet-body__mastered-tile--${entry.key}`}
                                    label={entry.label}
                                    count={tileCount(entry)}
                                    icon={collectionIcon(entry.ref)}
                                    mainColor={entry.colors.main}
                                    accentColor={entry.colors.accent}
                                    animationDelay={index * 70}
                                    onClick={() => onOpenPath(collectionPath(entry.ref))}
                                />
                            ))}
                        </TileGrid>

                        <LineSeparator className="decks-line-separator" />
                    </>
                )}

                {/* ── Challenges ── (docs/STUDY_CHALLENGE.md § 4). Placed immediately
                    BEFORE the user's own Decks so generated sets sit above authored
                    ones and the user's decks keep a stable position at the bottom.

                    OMITTED ENTIRELY when there is no active challenge deck, exactly as
                    Mastered is when no reading/writing goal is set — an empty captioned
                    section is noise in a sheet whose job is to be scannable.

                    There is NO lock badge; the deck's immutability shows up as the
                    absence of controls on its own page. */}
                {challengeDecks.length > 0 && (
                    <>
                        <Box
                            className="decks-sheet-body__challenges-header"
                            {...(headerDragBind?.() ?? {})}
                            sx={{ width: "100%", px: 3.5, pt: 2, pb: 1 }}
                        >
                            <SectionLabel className="decks-sheet-body__challenges-label">Challenges</SectionLabel>
                        </Box>
                        <TileGrid className="decks-sheet-body__challenges-list" alignLeft>
                            {challengeDecks.map((deck, index) => (
                                <DeckTile
                                    key={deck.id}
                                    className="decks-sheet-body__challenge-tile"
                                    label={deck.name}
                                    count={deck.cardCount}
                                    icon={collectionIcon({ kind: "deck", deckId: deck.id })}
                                    mainColor={deckTileColors(deck.id).main}
                                    accentColor={deckTileColors(deck.id).accent}
                                    animationDelay={Math.min(index, 5) * 70}
                                    onClick={() => onOpenPath(`/flashcards/deck/${deck.id}`)}
                                />
                            ))}
                        </TileGrid>
                        <LineSeparator className="challenges-line-separator" />
                    </>
                )}

                {/* ── Decks ── the user's own sets. */}
                <Box
                    className="decks-sheet-body__decks-header"
                    {...(headerDragBind?.() ?? {})}
                    sx={{ width: "100%", px: 3.5, pt: 2, pb: 1, display: "flex", alignItems: "center", justifyContent: "space-between" }}
                >
                    <SectionLabel className="decks-sheet-body__decks-label">Decks</SectionLabel>
                    <IconButton
                        className="decks-sheet-body__new-deck-button"
                        aria-label="New deck"
                        size="small"
                        onClick={onNewDeck}
                        sx={{ color: COLORS.onSurface }}
                    >
                        <AddIcon />
                    </IconButton>
                </Box>

                {(decksError || (!decksLoading && authoredDecks.length === 0)) && (
                    <Box className="decks-sheet-body__decks-message" sx={{ width: "100%", px: 3.5, pb: 1 }}>
                        <Typography
                            className={decksError ? "decks-sheet-body__decks-error" : "decks-sheet-body__decks-empty"}
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
                <TileGrid className="decks-sheet-body__decks-list" alignLeft>
                    {authoredDecks.map((deck, index) => (
                        <DeckTile
                            key={deck.id}
                            className="decks-sheet-body__deck-tile"
                            label={deck.name}
                            count={deck.cardCount}
                            icon={collectionIcon({ kind: "deck", deckId: deck.id })}
                            mainColor={deckTileColors(deck.id).main}
                            accentColor={deckTileColors(deck.id).accent}
                            // Stagger only within the first couple of rows; past
                            // that the cascade would run longer than the scroll.
                            animationDelay={Math.min(index, 5) * 70}
                            onClick={() => onOpenPath(`/flashcards/deck/${deck.id}`)}
                        />
                    ))}
                </TileGrid>
            </Box>
        </Box>
    );
});

export default DecksSheetBody;
