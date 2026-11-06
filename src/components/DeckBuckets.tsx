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
    // The 22px gutter is INHERITED from Shelf when this row is a PAGE section (the
    // Account page), not overridden: zeroing it there would put the spines 22px to the
    // left of the "Your library" header above them. A caller that has already paid for
    // its own padding — a row nested in a card, like the profile page's language panel
    // — passes `gutter={false}`, because inside that card the shelf's gutter is a
    // SECOND indent and the spines no longer line up with the card's own heading.
    ...(gutter ? null : { padding: 0 }),
    // The query container the spines size themselves against (`fittedSpineWidth`).
    // `cqw` resolves against the CONTENT box, so the gutter above is already excluded
    // — no px bookkeeping for it.
    containerType: "inline-size",
}));

/**
 * The CSS width every spine renders at, so all four ALWAYS fit on one line, in pure
 * CSS — nothing is measured in JS.
 *
 *   width = min(74px, (100cqw − gaps) / count)
 *
 * On a wide container the cap holds (the design's spine, not a stretched one) and
 * `distribute` spreads the slack between the spines. On a narrow one the spines
 * exactly fill the row and the gaps stay at `SPINE_GAP`. There is deliberately no
 * minimum (user, 2026-11-05: the row must always fit); every interior size scales
 * with the width (`Spine`'s `px`), so a narrower spine is a uniformly smaller one.
 *
 * The spine's padding is INSIDE `width` (it renders border-box — the 56px of label
 * room `BUCKET_LABELS` is written against is 74 − 2×9), so width IS the footprint.
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
function fittedSpineWidth(count: number): string {
    const gaps = SPINE_GAP * (count - 1) + ROUNDING_CUSHION;
    return `min(${SPINE_VARIANTS.base.width}px, (100cqw - ${gaps}px) / ${count})`;
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
 * pane (`src/pages/account/AccountPane.tsx`) and, per language, the user profile's stats card
 * (`src/features/profile/ProfileStatsCard.tsx`). The profile is the narrow host that the
 * `gutter` prop and the fitted spine width exist for.
 *
 * The row carries the count TWICE on purpose — as each spine's banded height and as
 * its mono numeral — which A3 warns against by reflex but is right here: the height
 * makes the four bands comparable at a glance (the shape of the user's library),
 * while the numeral is the figure someone reads a stats block to get. On a shelf
 * that is a navigation surface rather than a report, drop the numeral.
 */
const DeckBuckets: React.FC<DeckBucketsProps> = ({ counts, gutter = true }) => {
    const spineWidth = fittedSpineWidth(BUCKETS.length);

    return (
        <BucketsContainer className="decks-buckets-container" gutter={gutter}>
            {/* `distribute`: the four bands are a FIXED row that always fits, so they
                spread across the board rather than packing left and leaving dead
                board on the right — which would read as a row cut off mid-shelf. */}
            {/* `board={false}`: the hairline that closes this row is drawn by
                LibraryShelfWithVelocity, which frames the Velocity block with plain
                section dividers rather than wooden boards (user, 2026-10-10). */}
            <ShelfRow className="decks-buckets-row" distribute board={false}>
                {BUCKETS.map((category, index) => (
                    <Spine
                        key={category}
                        className={`${BAND_SPINE_CLASS} ${BAND_SPINE_CLASS}--${category.toLowerCase()}`}
                        label={BUCKET_LABELS[category]}
                        count={counts[category] ?? 0}
                        glyph={BUCKET_GLYPHS[category]}
                        variant={spineHeight(counts[category] ?? 0)}
                        color={BAND_COLORS[category].main}
                        // A CSS length against the row (`fittedSpineWidth`): the natural
                        // 74px when there is room, narrower when there is not.
                        width={spineWidth}
                        // Stagger so the four cascade left-to-right instead of firing at once.
                        animationDelay={index * 70}
                    />
                ))}
            </ShelfRow>
        </BucketsContainer>
    );
};

export default DeckBuckets;
