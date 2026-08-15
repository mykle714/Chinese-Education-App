import { Box } from "@mui/material";
import { styled } from "@mui/material/styles";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import AdjustIcon from "@mui/icons-material/Adjust";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import EmojiEventsOutlinedIcon from "@mui/icons-material/EmojiEventsOutlined";
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

/**
 * The glyph each band's tile carries, as one ascending progression: a question mark
 * (don't know it) → a target (working on it) → a check (comfortable) → a trophy
 * (done). The trophy is deliberately the SAME icon the fdp gives its Mastered
 * collection, so "mastered" looks like one idea across both pages.
 *
 * Kept local rather than shared with `features/flashcards/collectionIcon.tsx`:
 * components/ must not import from features/ (docs/FRONTEND_LAYERING.md), and these
 * are utcm BANDS — a property of one card's progress — not the collections that
 * module maps. Only the trophy is deliberately common to both.
 */
const BUCKET_ICONS: Record<(typeof BUCKETS)[number], React.ReactNode> = {
    Unfamiliar: <HelpOutlineIcon />,
    Target: <AdjustIcon />,
    Comfortable: <CheckCircleOutlineIcon />,
    Mastered: <EmojiEventsOutlinedIcon />,
};

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
                icon={BUCKET_ICONS[category]}
                mainColor={BAND_COLORS[category].main}
                accentColor={BAND_COLORS[category].accent}
                // Stagger so the four cascade left-to-right instead of firing at once.
                animationDelay={index * 70}
            />
        ))}
    </BucketsContainer>
);

export default DeckBuckets;
