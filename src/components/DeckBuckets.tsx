import { useEffect, useRef, useState } from "react";
import { styled } from "@mui/material/styles";
import { Shelf, ShelfRow, Spine, spineHeight, SPINE_VARIANTS } from "./shelf";
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

/**
 * `Shelf`'s own page gutter, in px (components/shelf/Shelf.tsx). Restated here
 * because this file has to SUBTRACT it when measuring how much room the spines
 * actually have — see `useFittedSpineWidth`.
 */
const SHELF_GUTTER = 22;

/**
 * The row's minimum gap between spines, in px — `Spines` in components/shelf/Shelf.tsx.
 * A minimum rather than the spacing because this row is `distribute`d.
 */
const SPINE_GAP = 10;

/**
 * How narrow a spine may get before the row stops shrinking and simply overflows.
 * Below roughly this width "Comfort-able" no longer fits on two lines at the scaled
 * type size, so shrinking further trades one broken layout for another.
 */
const MIN_SPINE_WIDTH = 46;

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
}));

/**
 * The width to render each spine at so all four fit the container on one line.
 *
 * ── WHY THIS IS MEASURED RATHER THAN FIXED ────────────────────────────────────
 * A spine is `flex-shrink: 0` at its natural 74px, and `ShelfRow` WRAPS when a row
 * runs out of width — which for this row means the fourth band drops underneath the
 * board and stands on nothing. Four spines need 4x74 + 3x10 = 326px, and inside the
 * profile page's language panel (page gutter + card padding + the shelf's own gutter)
 * there is closer to 290px on a phone. So the row must be told a width; it cannot
 * discover one.
 *
 * Shrinking uniformly is safe for this particular shelf because the information here
 * is carried by HEIGHT (the count band) and the four spines keep whatever width they
 * are all given — the reader is still comparing like with like. Do not generalise it
 * to a row whose spines have different widths.
 *
 * Returns `undefined` until the first measurement so the spines render at their
 * natural width rather than flashing at a guessed one.
 */
function useFittedSpineWidth(ref: React.RefObject<HTMLElement | null>, gutter: boolean, count: number) {
    const [width, setWidth] = useState<number | undefined>(undefined);

    useEffect(() => {
        const element = ref.current;
        if (!element || typeof ResizeObserver === "undefined") return;

        const measure = () => {
            // `clientWidth` includes the shelf's own padding, which the spines cannot
            // use — subtract it rather than measuring the inner row, which `ShelfRow`
            // does not expose a ref for.
            const available = element.clientWidth - (gutter ? SHELF_GUTTER * 2 : 0);
            if (available <= 0) return;
            const natural = SPINE_VARIANTS.base.width;
            // `SPINE_GAP` is the row's MINIMUM gap (the row is `distribute`d, so any
            // slack beyond this lands between the spines rather than at the end).
            // Reserving it here is what guarantees the fitted width never wraps.
            const fitted = (available - SPINE_GAP * (count - 1)) / count;
            // Never grow past the natural width — a wide container gets the design's
            // spine, not a stretched one.
            setWidth(Math.max(MIN_SPINE_WIDTH, Math.min(natural, Math.floor(fitted))));
        };

        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [ref, gutter, count]);

    return width;
}

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
    /**
     * Keep `Shelf`'s 22px page gutter (the default). Pass `false` where this row is
     * nested inside a container that already pads itself — see `BucketsContainer`.
     */
    gutter?: boolean;
}

/**
 * The four flashcard deck buckets (Unfamiliar / Target / Comfortable / Mastered),
 * each showing its per-category card count. Display-only — the tappable equivalents
 * are the fdp's collection spines. Rendered on the Account page
 * (`src/pages/AccountPage.tsx`) and, per language, inside the user profile's stats
 * card (`src/features/profile/ProfileStatsCard.tsx`) — which is the narrow host the
 * `gutter` prop and the fitted spine width exist for.
 *
 * The row carries the count TWICE on purpose — as each spine's banded height and as
 * its mono numeral — which A3 warns against by reflex but is right here: the height
 * makes the four bands comparable at a glance (the shape of the user's library),
 * while the numeral is the figure someone reads a stats block to get. On a shelf
 * that is a navigation surface rather than a report, drop the numeral.
 */
const DeckBuckets: React.FC<DeckBucketsProps> = ({ counts, gutter = true }) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const spineWidth = useFittedSpineWidth(containerRef, gutter, BUCKETS.length);

    return (
        <BucketsContainer className="decks-buckets-container" gutter={gutter} ref={containerRef}>
            {/* `distribute`: the four bands are a FIXED row that always fits, so they
                spread across the board rather than packing left and leaving dead
                board on the right — which would read as a row cut off mid-shelf. */}
            <ShelfRow className="decks-buckets-row" distribute>
                {BUCKETS.map((category, index) => (
                    <Spine
                        key={category}
                        className={`deck-bucket deck-bucket--${category.toLowerCase()}`}
                        label={BUCKET_LABELS[category]}
                        count={counts[category] ?? 0}
                        glyph={BUCKET_GLYPHS[category]}
                        variant={spineHeight(counts[category] ?? 0)}
                        color={BAND_COLORS[category].main}
                        // Narrowed to fit a small container; `undefined` on a container
                        // wide enough for the design's natural 74px.
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
