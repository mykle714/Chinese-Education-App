import { styled } from "@mui/material/styles";
import { Shelf, ShelfRow, Spine, spineHeight, SPINE_VARIANTS } from "./shelf";
import { BAND_COLORS } from "../utils/categoryColors";

// The four utcm bands as a shelf row on the Account page — one spine per band.
// No board: the Velocity block under it is framed by plain hairlines instead (see
// components/velocity/LibraryShelfWithVelocity). The spine itself lives in components/shelf (A3); this file only decides WHICH sets
// are on the shelf and in what order.
//
// Converted from DeckTile (decision D9, docs/SHELF_REDESIGN.md): the stacked-card
// tile is gone app-wide and the spine is the single visual for a set of cards.
//
// A "compact" preset plus an `onDeckClick` interactive mode used to live here for a
// tappable row on the old decks page; that page (deleted 2026-11-04) had long since
// rendered its own shelf, so this file carries one display-only variant.

/**
 * The row's minimum gap between spines, in px — `Spines` in components/shelf/Shelf.tsx.
 * A minimum rather than the spacing because this row is `distribute`d.
 */
const SPINE_GAP = 10;

const BucketsContainer = styled(Shelf, {
    shouldForwardProp: (prop) => prop !== "gutter",
})<{ gutter: boolean }>(({ gutter }) => ({
    width: "100%",
    // The 22px gutter is INHERITED from Shelf when this row is a PAGE section, not
    // overridden: zeroing it there would put the spines 22px left of a 22px-gutter
    // section header above them. A caller that has already paid for its own margin —
    // `LibraryShelfPanel` (the Account tab and a friend's expanded row), whose root
    // carries the page margin — passes `gutter={false}`, because there the shelf's
    // gutter is a SECOND indent and the spines no longer line up with the Velocity
    // card's column under them. (Every current caller passes `false`.)
    ...(gutter ? null : { padding: 0 }),
    // The query container the spines size themselves against (`fittedSpineWidth`).
    // `cqw` resolves against the CONTENT box, so the gutter above is already excluded
    // — no px bookkeeping for it.
    containerType: "inline-size",
}));

/**
 * The widest a band spine may grow, in px (user, 2026-11-14: the design's widest
 * spine, `.sp.vol`'s 86). Once the spines left the `SectionCard` box the row had spare
 * room (~81px per spine on a 390px phone, ~90 on a 430px one), and that width now goes
 * to the spines rather than to the gaps — which buys "Comfortable" a bigger font.
 */
const WIDE_SPINE_CAP = 86;

/**
 * The CSS width a spine is sized to, so all four ALWAYS fit on one line, in pure
 * CSS — nothing is measured in JS.
 *
 *   width = min(cap, (100cqw − gaps) / count)
 *
 * Used twice with two caps (see `DeckBuckets`):
 *   * the RENDERED width, capped at `WIDE_SPINE_CAP` (86) — the spine's footprint;
 *   * the INTERIOR width (`Spine`'s `interiorWidth`), capped at the natural 74 — what
 *     padding, type and glyph scale against.
 * So between 74 and 86 a spine gets wider but its type stays the design's size: the
 * extra width is label room (only the fit-to-line "Comfortable" name grows into it).
 * Below 74 both expressions agree and the spine shrinks uniformly, as before.
 *
 * On a wide container the cap holds and `distribute` spreads the slack between the
 * spines. On a narrow one the spines exactly fill the row and the gaps stay at
 * `SPINE_GAP`. There is deliberately no minimum (user, 2026-11-05: the row must always
 * fit).
 *
 * The spine's padding is INSIDE `width` (it renders border-box — at 74px the label
 * room is 74 − 2×9 = 56), so width IS the footprint.
 *
 * `ROUNDING_CUSHION` keeps sub-pixel layout rounding from tipping the row a hair over
 * and wrapping — the original bug: the old ResizeObserver read `clientWidth`, which
 * rounds to a whole pixel, and a row 0.4px too wide wrapped Mastered underneath.
 *
 * Shrinking uniformly is safe for this particular shelf because the information is
 * carried by HEIGHT (the count band) and all four spines share one width. Do not
 * generalise it to a row whose spines have different widths.
 */
const ROUNDING_CUSHION = 1;
function fittedSpineWidth(count: number, cap: number): string {
    const gaps = SPINE_GAP * (count - 1) + ROUNDING_CUSHION;
    return `min(${cap}px, (100cqw - ${gaps}px) / ${count})`;
}

/**
 * The class every band spine carries. Exported because the velocity arrows under this
 * shelf find the spines by it and measure their centres
 * (`components/velocity/VelocityArrows.tsx` → `useSpineCenters`) — one constant, so
 * renaming the class cannot silently detach the arrows from the shelf.
 */
export const BAND_SPINE_CLASS = "deck-bucket";

/** The four utcm bands, in ascending mastery order. */
const BUCKETS = ["Unfamiliar", "Target", "Comfortable", "Mastered"] as const;

/**
 * What each band is called ON THE SPINE.
 *
 * "Comfortable" is 70px wide at the spine's type size and the spine has 56px of
 * content, so it MUST break — and left to itself the browser breaks it wherever the
 * line runs out ("Comforta / ble"). The `\u00AD` is a SOFT HYPHEN: invisible unless
 * the break happens there, at which point it renders "Comfort- / able".
 *
 * It lives here, not in `Spine`, because knowing where an English word may be divided
 * is caller knowledge — the spine is a box that renders whatever string it is given,
 * and it has no business carrying a hyphenation dictionary. (`hyphens: auto` would do
 * this automatically, but only in a browser that ships hyphenation data for the
 * document's language, so it cannot be the only mechanism.)
 *
 * The other three fit on one line and are passed through unchanged.
 */
const BUCKET_LABELS: Record<(typeof BUCKETS)[number], string> = {
    Unfamiliar: "Unfamiliar",
    Target: "Target",
    Comfortable: "Comfort\u00ADable",
    Mastered: "Mastered",
};

/**
 * Bands whose label is set FIT-TO-LINE (`Spine` → `nameFitWidth`): the value is the
 * label's width in px at the spine's 11.5px name size, plus a 2px cushion against
 * font-rendering differences. "Comfortable" measured 70px (docs/SHELF_REDESIGN.md
 * § "Labels that do not fit a 74px spine") and is the one band name that cannot always
 * sit on one line at 11.5px; it takes the largest size that fits its spine (≈ 10px at
 * 74px, ≈ 11.1px at 81px, the full 11.5px from ≈ 83px). The other three keep the
 * design's size (user, 2026-11-13), so the row may mix two sizes deliberately rather
 * than shrinking every label to the longest.
 */
const NAME_FIT_WIDTHS: Partial<Record<(typeof BUCKETS)[number], number>> = { Comfortable: 72 };

/**
 * The glyph each band's spine carries, as one ascending progression: a question mark
 * (don't know it) → a target (working on it) → a check (comfortable) → a trophy
 * (done).
 *
 * ⚠️ The trophy is NOT the glyph the Mastered collection wears elsewhere: that is
 * `check_circle` (`features/flashcards/collectionGlyph.ts`, read by the Deck Tower's
 * cards-page filter keys), which this row already spends on *Comfortable* — so the two
 * disagree and this row cannot simply follow without colliding with itself.
 *
 * Material Symbols names rather than icon elements (decision D3) — the spine sizes
 * the glyph in `cqw` against its own width, which it cannot do to an opaque
 * `@mui/icons-material` element.
 *
 * Kept local rather than shared with `features/flashcards/collectionGlyph.ts`:
 * components/ must not import from features/ (docs/FRONTEND_LAYERING.md), and these
 * are utcm BANDS — a property of one card's progress — not the collections that
 * module maps.
 */
const BUCKET_GLYPHS: Record<(typeof BUCKETS)[number], string> = {
    Unfamiliar: "help",
    Target: "adjust",
    Comfortable: "check_circle",
    Mastered: "trophy",
};

interface DeckBucketsProps {
    // Per-category library card counts, keyed by category label.
    counts: Record<string, number>;
    /**
     * Keep `Shelf`'s 22px page gutter (the default). Pass `false` where this row is
     * nested inside a container that already pads itself — see `BucketsContainer`.
     */
    gutter?: boolean;
}

/**
 * The four flashcard deck buckets (Unfamiliar / Target / Comfortable / Mastered),
 * each showing its per-category card count. Display-only. Rendered only through
 * `components/velocity/LibraryShelfWithVelocity`, which hangs the Velocity card's
 * boundary arrows off these spines. Its hosts are the Account sheet's Account
 * pane (`src/pages/account/AccountPane.tsx`) and a friend's expanded leaderboard row
 * (`src/features/friends/FriendExpandedDetail.tsx`). The expanded row is the narrow host
 * that the `gutter` prop and the fitted spine width exist for.
 *
 * The row carries the count TWICE on purpose — as each spine's banded height and as
 * its mono numeral — which A3 warns against by reflex but is right here: the height
 * makes the four bands comparable at a glance (the shape of the user's library),
 * while the numeral is the figure someone reads a stats block to get. On a shelf
 * that is a navigation surface rather than a report, drop the numeral.
 */
const DeckBuckets: React.FC<DeckBucketsProps> = ({ counts, gutter = true }) => {
    const spineWidth = fittedSpineWidth(BUCKETS.length, WIDE_SPINE_CAP);
    const interiorWidth = fittedSpineWidth(BUCKETS.length, SPINE_VARIANTS.base.width);

    return (
        <BucketsContainer className="decks-buckets-container" gutter={gutter}>
            {/* `distribute`: the four bands are a FIXED row that always fits, so they
                spread across the board rather than packing left and leaving dead
                board on the right — which would read as a row cut off mid-shelf. */}
            {/* `board={false}`: the hairline that closes this row is drawn by
                LibraryShelfWithVelocity, which frames the Velocity block with plain
                section dividers rather than wooden boards (user, 2026-10-10) — and
                since 2026-11-13 not even those: nothing closes the row. */}
            <ShelfRow className="decks-buckets-row" distribute board={false}>
                {BUCKETS.map((category, index) => (
                    <Spine
                        key={category}
                        className={`${BAND_SPINE_CLASS} ${BAND_SPINE_CLASS}--${category.toLowerCase()}`}
                        label={BUCKET_LABELS[category]}
                        nameFitWidth={NAME_FIT_WIDTHS[category]}
                        count={counts[category] ?? 0}
                        glyph={BUCKET_GLYPHS[category]}
                        variant={spineHeight(counts[category] ?? 0)}
                        color={BAND_COLORS[category].main}
                        // CSS lengths against the row (`fittedSpineWidth`): the spine
                        // widens up to 86px when there is room, but its interior stays
                        // at the natural 74px scale, so the extra width is label room.
                        width={spineWidth}
                        interiorWidth={interiorWidth}
                        // Stagger so the four cascade left-to-right instead of firing at once.
                        animationDelay={index * 70}
                    />
                ))}
            </ShelfRow>
        </BucketsContainer>
    );
};

export default DeckBuckets;
