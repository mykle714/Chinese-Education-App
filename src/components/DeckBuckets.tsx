import { styled } from "@mui/material/styles";
import { Shelf, ShelfRow, Spine, spineHeight } from "./shelf";
import { BAND_COLORS } from "../utils/categoryColors";

// The four utcm bands as a shelf row on the Account page — one spine per band,
// standing on a board. The spine itself lives in components/shelf (A3); this file
// only decides WHICH sets are on the shelf and in what order.
//
// Converted from DeckTile (decision D9, docs/SHELF_REDESIGN.md): the stacked-card
// tile is gone app-wide and the spine is the single visual for a set of cards.
//
// A "compact" preset plus an `onDeckClick` interactive mode used to live here for a
// tappable row on the /decks page. That page renders its own shelf now, so this file
// no longer carries a second variant for it.

const BucketsContainer = styled(Shelf)({
    width: "100%",
    // The 22px gutter is INHERITED from Shelf, not overridden. It used to be zeroed
    // because AccountPage wrapped this in its own 20px-padded column; that column is
    // gone (the page's primitives each carry their own gutter now), so zeroing it here
    // would put the spines 22px to the left of the "Your library" header above them.
});

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
 * ⚠️ The trophy USED to be the same glyph the fdp gave its Mastered collection, so
 * "mastered" read as one idea across both pages. The fdp moved to `check_circle` on
 * 2026-08-31 (`features/flashcards/collectionGlyph.ts`), which is the glyph this row
 * already spends on *Comfortable* — so the two pages now disagree and this row cannot
 * simply follow without colliding with itself. See docs/DECKS_FEATURE.md § glyphs.
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
}

/**
 * The four flashcard deck buckets (Unfamiliar / Target / Comfortable / Mastered),
 * each showing its per-category card count. Display-only — the tappable equivalents
 * are the fdp's collection spines. Rendered on the Account page
 * (`src/pages/AccountPage.tsx`), its only host.
 *
 * The row carries the count TWICE on purpose — as each spine's banded height and as
 * its mono numeral — which A3 warns against by reflex but is right here: the height
 * makes the four bands comparable at a glance (the shape of the user's library),
 * while the numeral is the figure someone reads a stats block to get. On a shelf
 * that is a navigation surface rather than a report, drop the numeral.
 */
const DeckBuckets: React.FC<DeckBucketsProps> = ({ counts }) => (
    <BucketsContainer className="decks-buckets-container">
        <ShelfRow className="decks-buckets-row">
            {BUCKETS.map((category, index) => (
                <Spine
                    key={category}
                    className={`deck-bucket deck-bucket--${category.toLowerCase()}`}
                    label={BUCKET_LABELS[category]}
                    count={counts[category] ?? 0}
                    glyph={BUCKET_GLYPHS[category]}
                    variant={spineHeight(counts[category] ?? 0)}
                    color={BAND_COLORS[category].main}
                    // Stagger so the four cascade left-to-right instead of firing at once.
                    animationDelay={index * 70}
                />
            ))}
        </ShelfRow>
    </BucketsContainer>
);

export default DeckBuckets;
