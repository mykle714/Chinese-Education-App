import { forwardRef, memo, useCallback, useRef, type CSSProperties } from "react";
import { Box, Typography } from "@mui/material";
import CollectionSortControl from "../flashcards/CollectionSortControl";
import { useCardLibrary } from "../flashcards/useCardLibrary";
import { cardStockPressSx, cardStockShadow, sortCardStockSx } from "../discover/sortCardStock";
import MiniVocabCardGrid from "../../components/MiniVocabCardGrid";
import { MINI_CARD_DIMENSIONS } from "../../components/miniCardFace";
import { FLP_CARD_STOCK_INSET_RATIO } from "../flashcards/constants";
import SearchField from "../../components/SearchField";
import { HeaderIconButton } from "../../components/PageHeader";
import { HUB_HEADER_PAD_TOP_PX, HUB_HEADER_PAD_X_PX, HUB_HEADER_TITLE_PX, HUB_HEADER_TITLE_TRACKING } from "../../components/pageHeaderSizing";
import { SLAB_FOOTER_TOTAL_HEIGHT } from "../../components/MobileFooter";
import { SAFE_TOP } from "../../theme/safeArea";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { LEADING, WEIGHT } from "../../theme/scale";
import { shadowTone } from "./iso";
import TowerFilterKeys from "./TowerFilterKeys";
import type { TowerWorldId } from "./towerWorlds";
import type { VocabEntry } from "../../types";

/**
 * TowerCardsPage — the CARDS PAGE under td's platform (docs/DECK_TOWER.md § "The cards
 * page"): the world's whole card library, as a page the tower scrolls down into.
 *
 *   ┌ title row ───────── "Cards"                  [↑] ┐  sticky: takes over as the page
 *   │ [Learning] [Mastered]  (TowerFilterKeys)         │  header once it reaches the top
 *   │ [ Search your cards…               (sort) ]      │
 *   │ ▢ ▢ ▢                                            │  the world's whole library, three
 *   │ ▢ ▢ ▢   …                                        │  to a row, on the tower's card stock
 *   └──────────────────────────────────────────────────┘
 *
 * ── Data ─────────────────────────────────────────────────────────────────────
 * `useCardLibrary(lens)` owns the library fetch, the counts, search, sort and the
 * Learning / Mastered filter, and the filters' toggle contract (press the down key to
 * lift it) is its `toggleCardsFilter`. The library is cached across world pans
 * (cardLibrary.ts), so the next world's page seeds from the last one's.
 *
 * ── Shape ────────────────────────────────────────────────────────────────────
 *   • LENS = THE WORLD. Each world's page reads its own bar (core / reading / writing), the
 *     same rule as its tower: the filter keys' figures and every card's mastery strip answer that
 *     world's question. The host keys this component by world, so a world swipe mounts the
 *     next world's page (search and filter are per visit, not carried across).
 *   • THE CARDS are acp's mini cards: MiniCard printed on the Deck Tower's card stock
 *     drawn as a THICK PANEL (`sortCardStock` → `sortCardStockSx` — cream rim, beige
 *     panel, a 4px wall, a cast shadow on the ground, no outline) WITH the mastery strip, and WITHOUT acp's levitation bob (hundreds of
 *     bobbing cards is motion for its own sake, and a cost per card). The ground is the
 *     world's sky, so the shadow is the iso shadow rule's tone for that sky
 *     (`shadowTone`), passed down as the `--tower-cards-ground-shadow` CSS variable so a
 *     sky that changes every frame (a world pan's blend) never re-renders a card.
 *   • NO SHEET CHROME. It scrolls in td's own scroller, so no handle, no drag-to-resize,
 *     no edge-fade mask; the slab footer floats over the last rows the way it floats over
 *     the tower, and the page pads its height so the last row clears it.
 *
 * ── The title row ────────────────────────────────────────────────────────────
 * Sticky at the scroller's top. It is laid out as a HUB page header (`HUB_HEADER_*` —
 * the same padding, title size and tracking as td's own header, and the safe-area inset),
 * so when td's header has been pushed off (towerScroll → useTowerCardsScroll) this row
 * stands exactly where it stood. It is not a `PageHeader`: each of those runs a
 * minute-points tick, and a page mounts exactly one. Its right slot is the UP ARROW, an
 * outlined header button in the sky's ink (not the paper hairline — `outlinedChipSx`'s
 * rule for a scene ground), which glides back to the platform. It has NO fill (decided
 * 2026-11-04): the title and arrow float on the sky, and the cards are seen scrolling up
 * under them and off the screen's top.
 *
 * Only the title row sticks (decided 2026-11-04): the filter keys and the search bar scroll away
 * with the cards. Scrolling back up to reach them is the same gesture as reading.
 *
 * Layer: feature page view (src/features/deckTower). Imports the flashcards feature's
 * library hook and its collection glyphs, and discover's card stock.
 * Docs: docs/DECK_TOWER.md § "The cards page".
 */

/** The cards' cast-shadow colour, set on the page root from the sky (see header). */
const GROUND_SHADOW_VAR = "var(--tower-cards-ground-shadow)";

/**
 * The mastery strip's left/right inset on this stock, px: the beige panel's inset plus
 * `STRIP_PANEL_CLEARANCE_PX` of panel on either end, so the strip sits wholly on the panel.
 */
const STRIP_PANEL_CLEARANCE_PX = 5;
const STRIP_SIDE_INSET_PX = Math.round(MINI_CARD_DIMENSIONS.regular.width * FLP_CARD_STOCK_INSET_RATIO + STRIP_PANEL_CLEARANCE_PX);

/**
 * The stock every card is printed on — acp's thick panel (sortCardStock
 * `sortCardStockSx`: 4px wall + cast shadow; `cardStockPressSx`: pushed back on
 * press). Module-level so its identity never changes — every memoized card receives
 * it. Its `&:hover` keeps the panel's shadow: the flat face's hover elevation would
 * replace the wall and shadow on a desktop hover.
 */
const TOWER_CARD_STOCK = {
    rim: COLORS.cardFace,
    sx: {
        ...sortCardStockSx("regular", false, GROUND_SHADOW_VAR),
        "&:hover": { boxShadow: cardStockShadow(false, GROUND_SHADOW_VAR) },
        // Pressed, the card is pushed back flush with the sky (no wall, no shadow); the cdp
        // opens on release. After `&:hover`, so a sticky touch hover cannot mask the press.
        ...cardStockPressSx(GROUND_SHADOW_VAR),
        // The mastery strip squeezed in off the cream rim: MiniCard spans it 8px in from
        // the card's sides, which on this stock is only ~1.5px inside the beige panel
        // (inset `width × FLP_CARD_STOCK_INSET_RATIO`, ≈6.5px), so its ends touched the rim.
        "& .mini-card__mastery-window": { left: STRIP_SIDE_INSET_PX, right: STRIP_SIDE_INSET_PX },
    },
} as const;

/** The title row's gap under its content. */
const TITLE_ROW_GAP_PX = 14;
/**
 * The title row's content height: td's header avatar (DeckTowerAvatar, `sizePx` 40) is the
 * tallest thing in td's header, so the row matches it and the title lands on the same
 * line the old one stood on.
 */
const TITLE_ROW_CONTENT_PX = 40;
/** The filter keys' and search field's column width — the card grid's (3 × 92 + 2 × 16 + 2 × 28). */
const GRID_WIDTH_PX = 364;

interface TowerCardsPageProps {
    world: TowerWorldId;
    /** Text and outline ink on the sky (DeckTowerPage `skyInk`). */
    ink: string;
    /** The sky as drawn right now (the pan's blended palette) — the cards' ground (their cast-shadow tone). */
    sky: string;
    onOpenCard: (entry: VocabEntry, world: TowerWorldId) => void;
    /** The up arrow: one stop up — the top of the cards page from the grid, else the platform line. */
    onUp: () => void;
    /** The host's per-frame styling: the world pan's slide, the study dive's fade. */
    style?: CSSProperties;
}

const TowerCardsPage = forwardRef<HTMLDivElement, TowerCardsPageProps>(function TowerCardsPage(
    { world, ink, sky, onOpenCard, onUp, style },
    ref
) {
    const panel = useCardLibrary(world);
    const { collections, tileCount, activeCollection, toggleCardsFilter, cardsSearch, setCardsSearch, cardsSortKey, setCardsSortKey, language, goals } = panel;

    // The grid wants a STABLE click handler (its cards are memoized); the host's changes
    // identity every render, so it is read through a ref.
    const onOpenCardRef = useRef(onOpenCard);
    onOpenCardRef.current = onOpenCard;
    const handleCardClick = useCallback((entry: VocabEntry) => onOpenCardRef.current(entry, world), [world]);

    return (
        <Box
            ref={ref}
            className={`tower-cards-page tower-cards-page--${world}`}
            style={{ ...style, ["--tower-cards-ground-shadow" as string]: shadowTone(sky) }}
            sx={{
                width: "100%",
                flexShrink: 0,
                // At least a screen tall, so the title row can always scroll up to the top
                // and finish the header hand-off, however few cards there are.
                minHeight: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                // The slab footer floats over the last row: clear it, plus breathing room.
                paddingBottom: `calc(${SLAB_FOOTER_TOTAL_HEIGHT} + 16px)`,
            }}
        >
            {/* ── The title row — sticky; the page header once it reaches the top. ── */}
            <Box
                className="tower-cards-page__header"
                sx={{
                    position: "sticky",
                    top: 0,
                    zIndex: 2,
                    alignSelf: "stretch",
                    paddingTop: `calc(${HUB_HEADER_PAD_TOP_PX}px + ${SAFE_TOP})`,
                    paddingLeft: `${HUB_HEADER_PAD_X_PX}px`,
                    paddingRight: `${HUB_HEADER_PAD_X_PX}px`,
                    paddingBottom: `${TITLE_ROW_GAP_PX}px`,
                    // Transparent: the cards scroll visibly under the title and off the top.
                }}
            >
                <Box
                    className="tower-cards-page__header-row"
                    sx={{ minHeight: TITLE_ROW_CONTENT_PX, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}
                >
                    {/* Always "Cards" — a filter never renames the page (2026-11-08; it used to
                        take the latched key's name). The latched key itself names the set on
                        screen, and carries its figure. */}
                    <Typography
                        className="tower-cards-page__title"
                        component="h2"
                        sx={{
                            fontFamily: FONTS.sans,
                            fontWeight: WEIGHT.semibold,
                            fontSize: HUB_HEADER_TITLE_PX,
                            letterSpacing: HUB_HEADER_TITLE_TRACKING,
                            lineHeight: LEADING.tight,
                            color: ink,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                        }}
                    >
                        Cards
                    </Typography>
                    <HeaderIconButton
                        className="tower-cards-page__up-button"
                        icon="keyboard_double_arrow_up"
                        label="Back to the tower"
                        variant="outlined"
                        color={ink}
                        outlineColor={ink}
                        // The arrow lives inside td's scroller, so a tap while the grid is
                        // still coasting would otherwise only stop the fling (useScrollSafeTap).
                        scrollSafeTap
                        onClick={onUp}
                    />
                </Box>
            </Box>

            {/* ── Learning / Mastered — the lens's two constants, as FILTERS on the grid
                below: two-state keycaps that stay down while filtering (TowerFilterKeys).
                Same column as the search row and the grid (GRID_WIDTH_PX, 28px sides), so the
                keys' outer edges line up with the search field's and the cards'. The keys'
                diagonal wall + cast shadow overhang the right edge by 9px, into that padding. ── */}
            <Box className="tower-cards-page__filters" sx={{ width: GRID_WIDTH_PX, maxWidth: "100%", px: 3.5, pt: "12px" }}>
                <TowerFilterKeys
                    entries={collections}
                    count={tileCount}
                    activeKey={activeCollection?.key ?? null}
                    onToggle={toggleCardsFilter}
                />
            </Box>

            {/* ── Search + sort on one row, over the grid's width. The
                common orderings only (`allowPerSkillBars={false}`): each skill bar has its own world. ── */}
            <Box className="tower-cards-page__search" sx={{ width: GRID_WIDTH_PX, maxWidth: "100%", px: 3.5, pt: "16px" }}>
                <SearchField
                    className="tower-cards-page__search-input"
                    placeholder="Search your cards..."
                    value={cardsSearch}
                    onChange={setCardsSearch}
                    // Fill and radius on the INPUT root, not the TextField's wrapper: the
                    // outline (`MuiOutlinedInput-notchedOutline`) inherits its radius from
                    // the input root, so the two curves coincide. On the wrapper the 8px
                    // fill shows outside the outline's 4px corner — a doubled corner on td's sky.
                    sx={{ "& .MuiOutlinedInput-root": { backgroundColor: COLORS.background, borderRadius: "8px" } }}
                    endAction={
                        <CollectionSortControl
                            classPrefix="tower-cards-page__cards"
                            sortKey={cardsSortKey}
                            onSortKeyChange={setCardsSortKey}
                            language={language}
                            goals={goals}
                            lens={world}
                            allowPerSkillBars={false}
                        />
                    }
                />
            </Box>

            <MiniVocabCardGrid
                // Remount on a filter change so the entrance cascade replays for every card
                // — a filter shows a different SET, so it should arrive like one; search is
                // narrowing within the set, so it does not remount.
                key={panel.cardsFilter}
                entries={panel.visibleCards}
                lens={world}
                loading={panel.cardsLoading}
                error={panel.cardsError}
                emptyMessage={
                    cardsSearch.trim()
                        ? "No cards match your search."
                        : activeCollection
                          ? `No cards in ${activeCollection.label} yet.`
                          : "No cards yet. Tap the sort platform on the Flashcards tower to add some."
                }
                onCardClick={handleCardClick}
                cardStock={TOWER_CARD_STOCK}
                containerClassName="tower-cards-page__grid"
                classPrefix="tower-cards-page__cards"
            />
        </Box>
    );
});

export default memo(TowerCardsPage);
