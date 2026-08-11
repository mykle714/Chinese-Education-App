import { Box } from "@mui/material";
import { styled } from "@mui/material/styles";
import DeckTile from "./DeckTile";
import { BAND_COLORS } from "../utils/categoryColors";

// The four deck "buckets" as a display-only row. The stacked-card look itself lives
// in DeckTile — shared with the fdp, which renders the same object for every
// collection and every user deck (docs/DECKS_FEATURE.md).
//
// A "compact" preset plus an `onDeckClick` interactive mode used to live here for a
// tappable row on the /decks page. That page went back to rendering tiles — but as
// DeckTiles, so this file no longer carries a second variant for it.

const BucketsContainer = styled(Box)({
    // Fill the parent so the row's width is bounded by its container; the cards
    // inside flex-shrink to fit rather than overflowing on narrow containers (e.g.
    // the Account tab's 350px-capped section).
    width: "100%",
    margin: "0 auto",
    height: 150,
    position: "relative",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
    padding: "0 8px",
});

/** The four utcm bands, in ascending mastery order. */
const BUCKETS = ["Unfamiliar", "Target", "Comfortable", "Mastered"] as const;

interface DeckBucketsProps {
    // Per-category library card counts, keyed by category label.
    counts: Record<string, number>;
}

/**
 * The four flashcard deck buckets (Unfamiliar / Target / Comfortable / Mastered),
 * each showing its per-category card count. Display-only — the tappable equivalents
 * are the fdp's collection tiles. Rendered on the Account page
 * (`src/pages/AccountPage.tsx`), its only host.
 */
const DeckBuckets: React.FC<DeckBucketsProps> = ({ counts }) => (
    <BucketsContainer className="decks-buckets-container">
        {BUCKETS.map((category, index) => (
            <DeckTile
                key={category}
                className={`deck-bucket deck-bucket--${category.toLowerCase()}`}
                label={category}
                count={counts[category]}
                mainColor={BAND_COLORS[category].main}
                accentColor={BAND_COLORS[category].accent}
                // Stagger so the four cascade left-to-right instead of firing at once.
                animationDelay={index * 70}
            />
        ))}
    </BucketsContainer>
);

export default DeckBuckets;
