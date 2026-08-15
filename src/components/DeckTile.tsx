import { Box } from "@mui/material";
import { styled } from "@mui/material/styles";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { TRACKING } from "../theme/scale";

/**
 * DeckTile — the stacked-card "deck" icon, the app's one visual for *a set of cards*.
 *
 * Extracted from DeckBuckets so the fdp's collection tiles and the Account page's
 * count block render the SAME object. Before this it existed once, privately, inside
 * DeckBuckets; the fdp needed it for every other set it lists (All / Learn Now / the
 * up-to-three Mastered bars / each user deck), and a second copy would have drifted on the
 * stack offsets the moment either page was touched.
 *
 * The tile's face carries three things: the card COUNT as a small stat in the
 * top-left corner, the set's ICON centered in the space that frees up (supplied by
 * the caller — see the `icon` prop), and the set's NAME as a rotated
 * run up its right edge — deliberately the same treatment the Games hub gives a
 * card's mark-type label (docs/HUB_MENU_SYSTEM.md § "Edge label slot"): faded grey
 * uppercase turned 90° counter-clockwise, reading bottom-to-top, centered on the
 * height. A name too long for one run wraps to a second (and at most a third)
 * column beside it rather than shrinking — see MAX_LABEL_LINES.
 *
 * Purely presentational: it knows a label, an optional count, an optional icon
 * ELEMENT, two colors and whether it is tappable. It knows nothing about mastery bands, collections or routes — the
 * caller supplies all of that, which is what lets one component serve a utcm band, a
 * mastery bar and a user-authored deck.
 *
 * Depended on by: src/components/DeckBuckets.tsx,
 * src/features/flashcards/FlashcardsDecksPage.tsx. See docs/DECKS_FEATURE.md.
 */

// The card's geometry. Deliberately OFF the type scale: these are tuned to the fixed
// card shape, not to body copy, and the label has to survive being shrunk to a third
// of a phone's width.
//
// ⚠️ EVERY number below the first two is authored at REFERENCE_WIDTH and rendered in
// `cqw`, NOT px — see the note on that constant. Add a size here, run it through
// `scaled()` at the use site.
const SIZING = {
    // cardWidth/cardHeight define the NATURAL SIZE and the aspect ratio. The rendered
    // card shrinks to fit its container while preserving the ratio.
    //
    // 100 is what makes three tiles fill the fdp's row: the page's content column is
    // 337px (a 393px frame less the 28px gutter its section headings use), and
    // 3 × 100 + 2 × 18px of gap is 336. The tiles used to be 72 — the width the
    // ACCOUNT row renders at, four across in a 350px-capped section — which left the
    // fdp's row visibly narrower than the headings above it.
    //
    // The two pages therefore render this tile at two different sizes again (Account
    // still flex-shrinks it to ~71.5px), and that is now fine rather than the drift
    // the old comment warned about: every interior size scales with the rendered
    // width, so both are the same tile, not two designs.
    cardWidth: 100,
    cardHeight: 146,
    labelFontSize: 8.5,
    // Bold now that the label is a rotated edge run: at this size, faded grey caps
    // turned on their side need the extra weight to stay legible.
    labelFontWeight: 700,
    // The count is a corner stat, not the tile's subject: small caps-height digits
    // pinned to the top-left, leaving the face's middle free for the set's icon.
    countFontSize: 11,
    countFontWeight: 800,
    countInset: 7,
    // The collection glyph that fills the freed middle. Sized to read at the tile's
    // shrunk width (~72px) without crowding the edge label's column.
    iconSize: 30,
    // Faded rather than solid — the glyph is a quiet identifier for the set, and a
    // full-strength icon on a pastel panel would out-shout both the count and name.
    iconOpacity: 0.38,
    // Geometry of the edge label (see `.deck-tile__label`). `inset` is its distance
    // from the face's right edge and from its top/bottom; `lineColumn` is the width
    // ONE line of it occupies, which is also what the count block yields per line so
    // a wide count can't run into the letters.
    labelInset: 5,
    labelLineColumn: 12,
    // Gap between a wrapped label's columns. In vertical writing mode the line box
    // grows along the WIDTH, so this is horizontal breathing room, not leading.
    labelLineHeight: 1.35,
};

/**
 * The width every interior size in SIZING is authored against.
 *
 * The tile renders at two widths — ~71.5px on the Account row (four across in a
 * 350px section) and 100px on the fdp (three across in a 337px column) — and fixed
 * pixel type would mean one design that reads cramped at one size and sparse at the
 * other. So the tile declares itself a CONTAINER and every interior size is a
 * percentage of its own rendered width (`cqw`), authored at this reference. 72 is
 * the old natural width, which is what the Account row still renders: keeping the
 * reference there means that row is pixel-for-pixel unchanged by the fdp's resize.
 *
 * `container-type: inline-size`, NOT `size`. Inline-size containment only ignores
 * the contents' contribution to the WIDTH, which the tile sets explicitly anyway;
 * `size` would additionally make the height self-contained and is the variant that
 * broke the hub cards (docs/HUB_MENU_SYSTEM.md § "Do not make the font auto-fit").
 * Nothing here auto-fits text to its length — the whole tile scales as one piece.
 */
const REFERENCE_WIDTH = 72;

/** A SIZING value, as a share of the tile's rendered width. */
const scaled = (px: number) => `${((px / REFERENCE_WIDTH) * 100).toFixed(3)}cqw`;

/**
 * How many lines the edge label may wrap onto before it is clipped.
 *
 * The label runs along the tile's HEIGHT, so a long name doesn't get longer — it
 * gets WIDER, one column per line, eating into the middle of the face. Three is
 * where that stops being a quiet edge mark: "Mastered Reading" needs two, a
 * two-word user deck name usually two, and past three the tile is mostly name.
 */
const MAX_LABEL_LINES = 3;

/**
 * Rough uppercase advance per character, in em — glyph width plus `TRACKING.caps`.
 * Only ever used to GUESS the wrapped line count for the count block's padding
 * (below); the label itself wraps for real, in the browser.
 */
const CHAR_ADVANCE_EM = 0.74;

/**
 * Guess how many lines `label` will wrap onto, so the count block can yield the
 * matching width. It is an estimate on purpose: the alternative is measuring the
 * rendered label and reflowing, which costs a layout pass on every tile to move a
 * few pixels of padding. Being one line out only shifts the count slightly off
 * center — it never overlaps or clips the name.
 */
function estimateLabelLines(label: string): number {
    // Inline space available to one line: the face's height, less the label's own
    // top/bottom inset. (The face is the tile minus the stack's 12px vertical slack.)
    // Computed in REFERENCE units — the label's own sizes are authored there, and the
    // answer is scale-invariant anyway, since the whole tile scales together.
    const referenceHeight = (SIZING.cardHeight * REFERENCE_WIDTH) / SIZING.cardWidth;
    const runLength = referenceHeight - 12 - SIZING.labelInset * 2;
    const charsPerLine = Math.max(1, Math.floor(runLength / (SIZING.labelFontSize * CHAR_ADVANCE_EM)));
    // Word-aware, because the browser breaks at spaces: sum each word onto the
    // current line if it still fits, otherwise start a new one.
    let lines = 1;
    let used = 0;
    for (const word of label.trim().split(/\s+/)) {
        const cost = used === 0 ? word.length : word.length + 1;
        if (used + cost > charsPerLine && used > 0) {
            lines += 1;
            used = word.length;
        } else {
            used += cost;
        }
    }
    return Math.min(lines, MAX_LABEL_LINES);
}

/**
 * Width the count block yields to the edge label, for a label of `lines` lines.
 * Each line is another sideways column, so extra lines cost width — the count keeps
 * whatever is left rather than the label overlapping it.
 */
const labelColumnWidth = (lines: number) => lines * SIZING.labelLineColumn;

const TileRoot = styled(Box, {
    shouldForwardProp: (prop) =>
        prop !== "mainColor" &&
        prop !== "accentColor" &&
        prop !== "tappable" &&
        prop !== "labelLines",
})<{ mainColor: string; accentColor: string; tappable: boolean; labelLines: number }>(
    ({ mainColor, accentColor, tappable, labelLines }) => ({
        position: "relative",
        // Shrink to share the row width on narrow containers, but never grow past the
        // natural card size — so a row of two tiles doesn't render two huge cards.
        flex: "1 1 auto",
        width: SIZING.cardWidth,
        maxWidth: SIZING.cardWidth,
        minWidth: 0,
        // Height follows width so the card keeps its proportions as it shrinks.
        aspectRatio: `${SIZING.cardWidth} / ${SIZING.cardHeight}`,
        // Makes every `cqw` below resolve against THIS tile's rendered width, so the
        // count, icon and label scale with it (see REFERENCE_WIDTH). inline-size only.
        containerType: "inline-size",
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
        // Two offset layers give the stacked-card look; layer 1 is the face.
        // (A third layer used to sit behind these — dropped so the deck reads as a
        // two-card stack.) The back card is offset by 8px rather than the old 4px so it
        // still peeks clearly out from behind the face now that nothing sits behind it;
        // 8 is also exactly the layers' width slack, so the stack fills the tile's box.
        // Offsets and radii scale with the tile like everything else, so a 100px tile
        // is the 72px one enlarged rather than the same card with a thinner stack.
        "& .deck-tile__layer-2": {
            position: "absolute",
            left: scaled(8),
            top: scaled(8),
            width: `calc(100% - ${scaled(8)})`,
            height: `calc(100% - ${scaled(12)})`,
            backgroundColor: mainColor,
            borderRadius: scaled(8),
            boxShadow: "1px 4px 4px rgba(0, 0, 0, 0.25)",
        },
        "& .deck-tile__layer-1": {
            position: "absolute",
            left: 0,
            top: 0,
            width: `calc(100% - ${scaled(8)})`,
            height: `calc(100% - ${scaled(12)})`,
            backgroundColor: mainColor,
            borderRadius: scaled(8),
            boxShadow: "1px 4px 4px rgba(0, 0, 0, 0.25)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
        },
        "& .deck-tile__inner": {
            width: `calc(100% - ${scaled(8)})`,
            height: `calc(100% - ${scaled(8)})`,
            backgroundColor: accentColor,
            borderRadius: scaled(4),
        },
        // The set's ICON, centered on the face. It is the tile's biggest element now
        // that the count has moved to the corner, and it is what tells two same-colored
        // tiles apart at a glance. Positioned against the FACE (layer 1 is the
        // containing block), inset on the right by the edge label's column so a wide
        // glyph centers in the space actually left to it rather than under the letters.
        "& .deck-tile__icon": {
            position: "absolute",
            inset: 0,
            paddingRight: scaled(labelColumnWidth(labelLines)),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: COLORS.onSurface,
            opacity: SIZING.iconOpacity,
            zIndex: 1,
            // Decoration only — taps belong to the tile, never to the glyph.
            pointerEvents: "none",
            "& svg": {
                fontSize: scaled(SIZING.iconSize),
                width: scaled(SIZING.iconSize),
                height: scaled(SIZING.iconSize),
            },
        },
        // The set's name, as a rotated run up the tile's RIGHT EDGE — the same
        // treatment the Games hub gives a card's mark-type label (HubMenu's
        // CardEdgeSlot + MarkTypeChip's "edge" variant): faded grey caps turned 90°
        // counter-clockwise, reading bottom-to-top, centered on the tile's height.
        // Moving it off the centered stack leaves the middle of the face to the icon.
        //
        // A name too long for one run WRAPS, up to MAX_LABEL_LINES. Because the block
        // axis of vertical writing is the width, each extra line is another COLUMN
        // beside the first, not another row below it — so a long name grows inward
        // across the face rather than off the top of it. The first line lands furthest
        // from the edge, which is what reads first once the run is turned.
        "& .deck-tile__label": {
            position: "absolute",
            right: scaled(SIZING.labelInset),
            // BOTH offsets, deliberately — not `top: 50%` + a translate. The inline
            // axis here is the height, and an absolutely-positioned box with only
            // `top` set gets just the space BELOW that offset as its available inline
            // size: at 50% every label wrapped at half the face and a translate gave
            // none of it back. Pinning top and bottom hands it the whole run, and
            // `textAlign` (which aligns along the inline axis = vertically here) does
            // the centering that the translate used to.
            top: scaled(SIZING.labelInset),
            bottom: scaled(SIZING.labelInset),
            // `vertical-rl` lays the letters out top-to-bottom; the 180° flip makes
            // the run read bottom-to-top.
            transform: "rotate(180deg)",
            writingMode: "vertical-rl",
            fontSize: scaled(SIZING.labelFontSize),
            fontWeight: SIZING.labelFontWeight,
            letterSpacing: TRACKING.caps,
            textTransform: "uppercase",
            color: COLORS.textSecondary,
            opacity: 0.5,
            // Applies along the WIDTH here, so this is the gap between a wrapped
            // label's columns rather than leading.
            lineHeight: SIZING.labelLineHeight,
            zIndex: 1,
            // THE WRAP RULE. The line length is the inset-to-inset height set above,
            // so a name outrunning the face wraps to a second column on its own —
            // nothing here has to count characters.
            //
            // max-width is the BLOCK axis, i.e. how many columns fit. Past
            // MAX_LABEL_LINES the rest is clipped: a 64-char deck name has to stop
            // somewhere, and stopping at a fixed column keeps every tile's icon
            // centered in the same space.
            maxWidth: scaled(MAX_LABEL_LINES * SIZING.labelFontSize * SIZING.labelLineHeight),
            // Long single words (an unspaced deck name) still have to break, or one
            // over-long line would render past the face instead of wrapping.
            overflowWrap: "break-word",
            textAlign: "center",
            overflow: "hidden",
        },
        // The card count, pinned to the face's TOP-LEFT corner. It used to be big and
        // centered; it is now a small corner stat so the icon can own the middle. Its
        // width is bounded by the edge label's column so a four-digit count wraps
        // nowhere near the letters.
        "& .deck-tile__count": {
            position: "absolute",
            left: scaled(SIZING.countInset),
            top: scaled(SIZING.countInset),
            fontSize: scaled(SIZING.countFontSize),
            fontWeight: SIZING.countFontWeight,
            fontFamily: FONTS.sans,
            color: COLORS.onSurface,
            lineHeight: 1,
            zIndex: 2,
            maxWidth: `calc(100% - ${scaled(SIZING.countInset + labelColumnWidth(labelLines))})`,
            whiteSpace: "nowrap",
            overflow: "hidden",
        },
    })
);

export interface DeckTileProps {
    /**
     * The set's name, written up the tile's right edge. Wraps onto up to
     * MAX_LABEL_LINES columns on its own, so callers pass the plain name and never
     * pre-break it.
     */
    label: string;
    /** Omitted while a count is still loading — the tile renders label-only rather than "0". */
    count?: number;
    /**
     * The set's glyph, centered on the face — an `@mui/icons-material` element
     * (`<StyleOutlined />`). The tile styles whatever it is given (size, fade), so
     * callers pass the bare icon and never its sizing.
     *
     * Deliberately a PROP rather than something the tile derives: DeckTile knows
     * nothing about collections, mastery bars or decks, and choosing a glyph is
     * exactly that knowledge. The mapping lives with the callers —
     * `src/features/flashcards/collectionIcon.tsx` for the fdp's collections and
     * decks, and a local map in DeckBuckets for the Account page's utcm bands.
     */
    icon?: React.ReactNode;
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
    icon,
    mainColor,
    accentColor,
    onClick,
    animationDelay = 0,
    className,
}) => {
    // How wide the label will end up, guessed from its text — the count and the icon
    // yield exactly that much of the face so neither ever sits under the letters.
    const labelLines = estimateLabelLines(label);
    return (
    <TileRoot
        className={`deck-tile ${className ?? ""}`}
        mainColor={mainColor}
        accentColor={accentColor}
        labelLines={labelLines}
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
        <div className="deck-tile__layer-2" />
        <div className="deck-tile__layer-1">
            <div className="deck-tile__inner" />
            {/* Three siblings of the face, each positioned against it: the count in the
                top-left corner, the set's glyph filling the middle, and the name up the
                right edge. */}
            {typeof count === "number" && <span className="deck-tile__count">{count}</span>}
            {icon && (
                <span className="deck-tile__icon" aria-hidden>
                    {icon}
                </span>
            )}
            {/* Hidden from assistive tech only when the tile's own aria-label already
                speaks the name — a display-only tile has none, so it must stay
                readable. */}
            <span className="deck-tile__label" aria-hidden={onClick ? true : undefined}>{label}</span>
        </div>
    </TileRoot>
    );
};

export default DeckTile;
