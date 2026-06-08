import { Box } from "@mui/material";
import { styled } from "@mui/material/styles";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";

// Deck colors (the four buckets) come from the central palette: each deck has a
// saturated "main" body color and a lighter "accent" inner fill. The font-size
// presets below (SIZING) are deliberately off the type scale — they're tuned to
// the fixed card geometry, not body copy.

// Visual presets per variant. "compact" = the small interactive bucket used on
// the /decks page; "display" = the enlarged, count-forward stat block used on the
// Account page (the count is the dominant element there).
type DeckVariant = "compact" | "display";

interface VariantSizing {
    // cardWidth/cardHeight define the card's aspect ratio; the rendered card
    // shrinks to fit its container while preserving this ratio. The inner
    // "layer" boxes are sized off the card's actual dimensions via calc(), so
    // no explicit layer width/height is needed.
    cardWidth: number;
    cardHeight: number;
    textTop: number;
    labelFontSize: number;
    labelFontWeight: number;
    countFontSize: number;
    countFontWeight: number;
    countOpacity: number;
    containerHeight: number;
    containerGap: number;
}

const SIZING: Record<DeckVariant, VariantSizing> = {
    compact: {
        cardWidth: 80,
        cardHeight: 116,
        textTop: 32,
        labelFontSize: 10,
        labelFontWeight: 400,
        countFontSize: 9,
        countFontWeight: 700,
        countOpacity: 0.75,
        containerHeight: 140,
        containerGap: 12,
    },
    display: {
        // Enlarged so the big count reads as the primary feature of the component.
        cardWidth: 92,
        cardHeight: 134,
        textTop: 30,
        // Lighter and smaller so the label reads as a quiet caption under the count.
        labelFontSize: 8.5,
        labelFontWeight: 300,
        countFontSize: 22,
        countFontWeight: 800,
        countOpacity: 1,
        containerHeight: 150,
        containerGap: 16,
    },
};

const BucketsContainer = styled(Box)<{ variant: DeckVariant }>(({ variant }) => {
    const s = SIZING[variant];
    return {
        // Fill the parent so the row's width is bounded by its container; the
        // cards inside flex-shrink to fit rather than overflowing on narrow
        // containers (e.g. the Account tab's 350px-capped section).
        width: "100%",
        margin: "0 auto",
        height: s.containerHeight,
        position: "relative",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: s.containerGap,
        padding: "0 8px",
    };
});

// A single deck bucket: three stacked "layer" boxes give the 3D stacked-card look,
// with a label + (optional) count overlaid on top. `interactive` toggles the
// pointer cursor and hover lift used when the bucket navigates somewhere.
const DeckCard = styled(Box)<{
    mainColor: string;
    accentColor: string;
    variant: DeckVariant;
    interactive: boolean;
}>(({ mainColor, accentColor, variant, interactive }) => {
    const s = SIZING[variant];
    return {
        position: "relative",
        // Shrink to share the row width on narrow containers, but never grow
        // past the natural card size (so wide layouts look unchanged).
        flex: "1 1 auto",
        width: s.cardWidth,
        maxWidth: s.cardWidth,
        minWidth: 0,
        // Height follows width so the card keeps its proportions as it shrinks.
        aspectRatio: `${s.cardWidth} / ${s.cardHeight}`,
        cursor: interactive ? "pointer" : "default",
        transition: "transform 0.2s ease-in-out",
        // Each card "pops" in when the bucket row first mounts (the row is only
        // rendered once the counts have loaded — see AccountPage). The per-card
        // stagger comes from an inline animationDelay set in the render below, so
        // the four cards cascade in left-to-right. transformOrigin is the card's
        // bottom so they scale up "off the stack" rather than from dead center.
        // Keyframe `cardPopIn` is global (src/index.css), shared with the /decks
        // card previews.
        transformOrigin: "center bottom",
        animation: "cardPopIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) backwards",
        ...(interactive && {
            "&:hover": {
                transform: "translateY(-4px)",
            },
        }),
        "& .bucket-layer-3": {
            position: "absolute",
            left: 8,
            top: 8,
            width: "calc(100% - 8px)",
            height: "calc(100% - 12px)",
            backgroundColor: mainColor,
            borderRadius: 8,
            boxShadow: "1px 4px 4px rgba(0, 0, 0, 0.25)",
        },
        "& .bucket-layer-2": {
            position: "absolute",
            left: 4,
            top: 4,
            width: "calc(100% - 8px)",
            height: "calc(100% - 12px)",
            backgroundColor: mainColor,
            borderRadius: 8,
            boxShadow: "1px 4px 4px rgba(0, 0, 0, 0.25)",
        },
        "& .bucket-layer-1": {
            position: "absolute",
            left: 0,
            top: 0,
            width: "calc(100% - 8px)",
            height: "calc(100% - 12px)",
            backgroundColor: mainColor,
            borderRadius: 8,
            boxShadow: "1px 4px 4px rgba(0, 0, 0, 0.25)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
        },
        "& .bucket-inner": {
            width: "calc(100% - 8px)",
            height: "calc(100% - 8px)",
            backgroundColor: accentColor,
            borderRadius: 4,
        },
        "& .bucket-text": {
            position: "absolute",
            // Track the card width (minus the stack offset) so the count/label
            // stay centered and never overflow when the card shrinks.
            width: "calc(100% - 8px)",
            height: 40,
            left: "50%",
            transform: "translateX(-50%)",
            top: s.textTop,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 2,
            lineHeight: 1.21,
            textAlign: "center",
            color: COLORS.onSurface,
            fontFamily: FONTS.sans,
            zIndex: 1,
        },
        "& .bucket-label": {
            fontSize: s.labelFontSize,
            fontWeight: s.labelFontWeight,
        },
        // The card count. In the "display" variant this is the dominant element.
        "& .bucket-count": {
            fontSize: s.countFontSize,
            fontWeight: s.countFontWeight,
            lineHeight: 1,
            opacity: s.countOpacity,
        },
    };
});

// The four deck definitions, in display order. `category` doubles as the label
// and the key into the counts map / navigation target.
const DECKS: { category: string; mainColor: string; accentColor: string }[] = [
    { category: "Unfamiliar", mainColor: COLORS.redMain, accentColor: COLORS.redAccent },
    { category: "Target", mainColor: COLORS.yellowMain, accentColor: COLORS.yellowAccent },
    { category: "Comfortable", mainColor: COLORS.greenMain, accentColor: COLORS.greenAccent },
    { category: "Mastered", mainColor: COLORS.blueMain, accentColor: COLORS.blueAccent },
];

interface DeckBucketsProps {
    // Per-category library card counts, keyed by category label.
    counts: Record<string, number>;
    // When provided, buckets are interactive and call this on tap. When omitted,
    // the buckets are display-only (no pointer/hover, no click handler).
    onDeckClick?: (category: string) => void;
    variant?: DeckVariant;
}

/**
 * The four flashcard deck "buckets" (Unfamiliar / Target / Comfortable / Mastered),
 * each showing its per-category card count. Shared between the /decks page
 * (interactive, "compact") and the Account page (display-only, "display").
 */
const DeckBuckets: React.FC<DeckBucketsProps> = ({ counts, onDeckClick, variant = "compact" }) => {
    const interactive = typeof onDeckClick === "function";
    return (
        <BucketsContainer variant={variant} className="decks-buckets-container">
            {DECKS.map(({ category, mainColor, accentColor }, index) => {
                const count = counts[category];
                return (
                    <DeckCard
                        key={category}
                        mainColor={mainColor}
                        accentColor={accentColor}
                        variant={variant}
                        interactive={interactive}
                        onClick={interactive ? () => onDeckClick!(category) : undefined}
                        className="deck-card"
                        // Stagger the pop-in so the cards cascade left-to-right
                        // instead of all firing at once (keyframes in DeckCard).
                        style={{ animationDelay: `${index * 70}ms` }}
                    >
                        <div className="bucket-layer-3" />
                        <div className="bucket-layer-2" />
                        <div className="bucket-layer-1">
                            <div className="bucket-inner" />
                            <div className="bucket-text">
                                {/* In the display variant the big count leads, label sits beneath. */}
                                {typeof count === "number" && <span className="bucket-count">{count}</span>}
                                <span className="bucket-label">{category}</span>
                            </div>
                        </div>
                    </DeckCard>
                );
            })}
        </BucketsContainer>
    );
};

export default DeckBuckets;
