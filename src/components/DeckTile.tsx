import { Box } from "@mui/material";
import { styled } from "@mui/material/styles";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";

/**
 * DeckTile — the stacked-card "deck" icon, the app's one visual for *a set of cards*.
 *
 * Extracted from DeckBuckets so the fdp's collection tiles and the Account page's
 * count block render the SAME object. Before this it existed once, privately, inside
 * DeckBuckets; the fdp needed it for eight more sets (All / the three bands / the
 * three Mastered bars / each user deck), and a second copy would have drifted on the
 * stack offsets the moment either page was touched.
 *
 * Purely presentational: it knows a label, an optional count, two colors and whether
 * it is tappable. It knows nothing about mastery bands, collections or routes — the
 * caller supplies all of that, which is what lets one component serve a utcm band, a
 * mastery bar and a user-authored deck.
 *
 * Depended on by: src/components/DeckBuckets.tsx,
 * src/features/flashcards/FlashcardsDecksPage.tsx. See docs/DECKS_FEATURE.md.
 */

// The card's geometry. Deliberately OFF the type scale: these are tuned to the fixed
// card shape, not to body copy, and the label has to survive being shrunk to a third
// of a phone's width.
const SIZING = {
    // cardWidth/cardHeight define the NATURAL SIZE and the aspect ratio. The rendered
    // card shrinks to fit its container while preserving the ratio, and the inner
    // "layer" boxes are sized off the card's actual dimensions via calc(), so no layer
    // needs explicit pixels.
    //
    // 72 is the width the Account page's row has always rendered at: four tiles in a
    // 350px-capped section were already shrinking to ~71.5px, while the fdp's roomier
    // grid let them sit at their old 92px natural size — the same component at two
    // sizes on two pages. Pinning the natural size to what Account renders makes every
    // deck on both pages identical, and the row still shrinks below it if a container
    // is narrower than four tiles.
    cardWidth: 72,
    cardHeight: 105,
    textTop: 30,
    labelFontSize: 8.5,
    labelFontWeight: 300,
    countFontSize: 22,
    countFontWeight: 800,
};

const TileRoot = styled(Box, {
    shouldForwardProp: (prop) =>
        prop !== "mainColor" && prop !== "accentColor" && prop !== "tappable",
})<{ mainColor: string; accentColor: string; tappable: boolean }>(
    ({ mainColor, accentColor, tappable }) => ({
        position: "relative",
        // Shrink to share the row width on narrow containers, but never grow past the
        // natural card size — so a row of two tiles doesn't render two huge cards.
        flex: "1 1 auto",
        width: SIZING.cardWidth,
        maxWidth: SIZING.cardWidth,
        minWidth: 0,
        // Height follows width so the card keeps its proportions as it shrinks.
        aspectRatio: `${SIZING.cardWidth} / ${SIZING.cardHeight}`,
        cursor: tappable ? "pointer" : "default",
        // Each card "pops" in when its row first mounts. The per-card stagger comes
        // from an inline animationDelay set by the caller, so a row cascades
        // left-to-right. transformOrigin is the card's bottom so they scale up "off
        // the stack" rather than from dead center. Keyframe `cardPopIn` is global
        // (src/index.css).
        transformOrigin: "center bottom",
        animation: "cardPopIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) backwards",
        transition: "transform 0.12s ease-out",
        ...(tappable && {
            "&:active": { transform: "scale(0.96)" },
        }),
        // Three offset layers give the stacked-card look; layer 1 is the face.
        "& .deck-tile__layer-3": {
            position: "absolute",
            left: 8,
            top: 8,
            width: "calc(100% - 8px)",
            height: "calc(100% - 12px)",
            backgroundColor: mainColor,
            borderRadius: 8,
            boxShadow: "1px 4px 4px rgba(0, 0, 0, 0.25)",
        },
        "& .deck-tile__layer-2": {
            position: "absolute",
            left: 4,
            top: 4,
            width: "calc(100% - 8px)",
            height: "calc(100% - 12px)",
            backgroundColor: mainColor,
            borderRadius: 8,
            boxShadow: "1px 4px 4px rgba(0, 0, 0, 0.25)",
        },
        "& .deck-tile__layer-1": {
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
        "& .deck-tile__inner": {
            width: "calc(100% - 8px)",
            height: "calc(100% - 8px)",
            backgroundColor: accentColor,
            borderRadius: 4,
        },
        "& .deck-tile__text": {
            position: "absolute",
            // Track the card width (minus the stack offset) so the count/label stay
            // centered and never overflow when the card shrinks.
            width: "calc(100% - 8px)",
            height: 40,
            left: "50%",
            transform: "translateX(-50%)",
            top: SIZING.textTop,
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
            // A deck name is user-typed and up to 64 chars; it must wrap inside the
            // card rather than spill over the stack edge.
            padding: "0 4px",
            overflow: "hidden",
        },
        "& .deck-tile__label": {
            fontSize: SIZING.labelFontSize,
            fontWeight: SIZING.labelFontWeight,
            // Two lines then ellipsis — enough for "Reading Mastered" or a two-word
            // deck name, bounded so a long name cannot push the count off the card.
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            wordBreak: "break-word",
        },
        // The card count — the dominant element of the tile.
        "& .deck-tile__count": {
            fontSize: SIZING.countFontSize,
            fontWeight: SIZING.countFontWeight,
            lineHeight: 1,
        },
    })
);

export interface DeckTileProps {
    label: string;
    /** Omitted while a count is still loading — the tile renders label-only rather than "0". */
    count?: number;
    mainColor: string;
    accentColor: string;
    /** Makes the tile a button. Omit for a display-only tile. */
    onClick?: () => void;
    /** ms of pop-in delay, so a caller can cascade a row. */
    animationDelay?: number;
    className?: string;
}

const DeckTile: React.FC<DeckTileProps> = ({
    label,
    count,
    mainColor,
    accentColor,
    onClick,
    animationDelay = 0,
    className,
}) => (
    <TileRoot
        className={`deck-tile ${className ?? ""}`}
        mainColor={mainColor}
        accentColor={accentColor}
        tappable={Boolean(onClick)}
        onClick={onClick}
        // A tappable tile is a real button to assistive tech and to the keyboard; a
        // display-only one stays a plain div rather than an unusable button.
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        aria-label={onClick ? `${label}${typeof count === "number" ? `, ${count} cards` : ""}` : undefined}
        onKeyDown={
            onClick
                ? (e: React.KeyboardEvent) => {
                      if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onClick();
                      }
                  }
                : undefined
        }
        style={{ animationDelay: `${animationDelay}ms` }}
    >
        <div className="deck-tile__layer-3" />
        <div className="deck-tile__layer-2" />
        <div className="deck-tile__layer-1">
            <div className="deck-tile__inner" />
            <div className="deck-tile__text">
                {/* The big count leads; the label sits beneath it. */}
                {typeof count === "number" && <span className="deck-tile__count">{count}</span>}
                <span className="deck-tile__label">{label}</span>
            </div>
        </div>
    </TileRoot>
);

export default DeckTile;
