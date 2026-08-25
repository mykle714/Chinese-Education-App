import { type ReactNode } from "react";
import { Box } from "@mui/material";
import { styled } from "@mui/material/styles";
import Icon from "../Icon";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SPINE_SIZES, SPINE_VARIANTS, spineScale, type SpineVariant } from "./spineGeometry";
import { SHADOW } from "../../theme/shadows";

/**
 * Spine — the app's single visual for *a set of cards*, and the atom of the shelf
 * (docs/SHELF_REDESIGN.md § A3). It replaces `DeckTile` outright (decision D9);
 * there is no coexistence period and no second "set of cards" visual.
 *
 * A spine is a book seen edge-on: a pastel body, a highlight down its right side, a
 * dark strap down its left (`.sp::after` — that strap is what sells "book"; without
 * it the shape reads as a rounded rectangle), a title at the top and an optional
 * mono count at the foot. Its HEIGHT carries how big the set is, in three bands —
 * see `spineHeight` in ./spineGeometry.
 *
 * Purely presentational. It knows a label, a colour, an optional count and some
 * optional slots; it knows nothing about collections, decks, mastery bands or
 * routes. That is what lets one component serve a utcm band on Account, a user's
 * deck on the fdp and a Reader volume.
 *
 * Depended on by: src/components/shelf/Shelf.tsx (as the row's content),
 * src/components/DeckBuckets.tsx, src/features/flashcards/DecksPanelBody.tsx.
 * See docs/DECKS_FEATURE.md.
 */

export interface SpineProps {
    /** The set's name — `.nm`, at the top of the spine. */
    label: string;
    /**
     * The set's size, rendered as the mono `.k` numeral at the foot.
     *
     * OMIT IT when the spine's height already says this (decision D9 / A3 work item
     * 6): height and numeral are the same fact, and printing both by reflex makes
     * the numeral noise. Pass it where the exact figure is the point — a row the
     * user scans for "how much is left" — and drop it where the row is a shape.
     */
    count?: number;
    /**
     * Which `.sp` modifier to render. Defaults to `base`. For a count-banded shelf,
     * pass `spineHeight(count)` rather than choosing by hand, so every shelf in the
     * app agrees on where the cutoffs sit.
     */
    variant?: SpineVariant;
    /** The body colour — a PASTEL from the ramp. Ink on it is `COLORS.onSurface`. */
    color: string;
    /**
     * Width/height overrides in px, for the two places the design overrides them
     * (the decks sheet squats the spine to 74 tall). Interior sizes follow `width`
     * automatically — that is what `containerType` below is for.
     */
    width?: number;
    height?: number;
    /** `.pin` — a mono badge on a translucent white chip, top-right. */
    pin?: ReactNode;
    /** `.cap2` — a mono caption along the foot. Mutually exclusive with `count`. */
    caption?: ReactNode;
    /**
     * A Material Symbols name (see components/Icon) identifying the set — the glyph
     * that tells two spines of the same colour apart before their names are read.
     *
     * It sits on the FOOT ROW, right-aligned, opposite the count. That position is
     * the design's own `.sp.vol .own` (a glyph pinned to the right edge, clear of the
     * foot content) generalised to every variant, and it is deliberately NOT the
     * design's other glyph slot `.mine`: `.mine` is a top-LEFT corner mark, which is
     * exactly where `label` starts, so the two overlap on any spine with a name. A
     * spine has no middle to centre a glyph in the way `DeckTile` did, and its foot
     * is the only edge with room.
     */
    glyph?: string;
    /** `.sp.vol .mt` — mono meta lines at the foot. `vol` only. */
    meta?: ReactNode;
    /**
     * `.sp.vol .own` — the owner glyph, sitting above the meta block. `vol` only;
     * on every other variant `glyph` is the same idea in the same corner.
     */
    ownerGlyph?: string;
    onClick?: () => void;
    /** Stagger, in ms, so a row cascades rather than firing at once. */
    animationDelay?: number;
    className?: string;
}

const SpineRoot = styled(Box, {
    shouldForwardProp: (prop) => prop !== "color" && prop !== "tappable",
})<{ color: string; tappable: boolean }>(({ color, tappable }) => ({
    position: "relative",
    borderRadius: "11px 11px 4px 4px",
    background: color,
    // Two shadows in one: an outer drop shadow that lifts the spine off the board,
    // and a wide INSET white highlight on the right edge that rounds the body so it
    // reads as a cylinder rather than a flat swatch.
    boxShadow: SHADOW.spine,
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    overflow: "hidden",
    // Spines never shrink — a row that runs out of width wraps or scrolls. A shrunk
    // spine would break the height banding, since the reader compares heights across
    // the row and a narrowed spine reads as a different kind of thing.
    flexShrink: 0,
    cursor: tappable ? "pointer" : "default",
    // Matches DeckTile's entrance so the swap doesn't change how a row arrives.
    // Keyframe `cardPopIn` is global (src/index.css).
    transformOrigin: "center bottom",
    animation: "cardPopIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) backwards",
    transition: "transform 0.12s ease-out",
    ...(tappable && { "&:active": { transform: "scale(0.96)" } }),
    // `.sp::after` — the dark strap down the left edge.
    "&::after": {
        content: '""',
        position: "absolute",
        left: 0,
        top: 0,
        bottom: 0,
        width: SPINE_SIZES.strapWidth,
        background: "rgba(23, 22, 26, 0.09)",
    },
}));

const Spine: React.FC<SpineProps> = ({
    label,
    count,
    variant = "base",
    color,
    width,
    height,
    pin,
    caption,
    glyph,
    meta,
    ownerGlyph,
    onClick,
    animationDelay,
    className,
}) => {
    const spec = SPINE_VARIANTS[variant];
    const renderedWidth = width ?? spec.width;
    // Interior sizes are authored at the VARIANT'S natural width, not a global one,
    // and are scaled here in JS rather than in `cqw` — see the note on SPINE_SIZES for
    // why container units cannot do this job.
    const scale = spineScale(renderedWidth, spec.width);
    const px = (n: number) => n * scale;
    const isVol = variant === "vol";

    return (
        <SpineRoot
            className={`shelf-spine shelf-spine--${variant}${className ? ` ${className}` : ""}`}
            color={color}
            tappable={Boolean(onClick)}
            onClick={onClick}
            sx={{
                width: renderedWidth,
                height: height ?? spec.height,
                // `.sp.vol` has no padding of its own — its contents are absolutely
                // positioned plates rather than a flow column.
                padding: isVol ? 0 : `${px(SPINE_SIZES.padY)}px ${px(SPINE_SIZES.padX)}px`,
                ...(animationDelay !== undefined && { animationDelay: `${animationDelay}ms` }),
            }}
        >
            {isVol ? (
                <>
                    {/* `.band` — a translucent plate carrying the title, the way a real
                        spine prints its name on a lighter panel. */}
                    <Box
                        className="shelf-spine__band"
                        sx={{
                            position: "absolute",
                            left: px(SPINE_SIZES.volBandInsetX),
                            right: px(SPINE_SIZES.volBandInsetX),
                            top: px(SPINE_SIZES.volBandTop),
                            background: "rgba(255, 255, 255, 0.66)",
                            borderRadius: px(7),
                            padding: `${px(SPINE_SIZES.volBandPadY)}px ${px(SPINE_SIZES.volBandPadX)}px`,
                            zIndex: 1,
                        }}
                    >
                        <Box
                            className="shelf-spine__title"
                            sx={{
                                fontFamily: FONTS.sans,
                                fontSize: px(SPINE_SIZES.volTitleFontSize),
                                fontWeight: 700,
                                lineHeight: SPINE_SIZES.volTitleLineHeight,
                                letterSpacing: "-0.005em",
                                color: COLORS.onSurface,
                                overflowWrap: "anywhere",
                            }}
                        >
                            {label}
                        </Box>
                    </Box>
                    {ownerGlyph !== undefined && (
                        <Box
                            className="shelf-spine__owner"
                            sx={{
                                position: "absolute",
                                right: px(SPINE_SIZES.volOwnerRight),
                                bottom: px(SPINE_SIZES.volOwnerBottom),
                                opacity: 0.6,
                                zIndex: 1,
                                lineHeight: 1,
                            }}
                        >
                            <Icon
                                name={ownerGlyph}
                                size={SPINE_SIZES.volOwnerSize}
                                color={COLORS.iconColor}
                                sx={{ fontSize: px(SPINE_SIZES.volOwnerSize) }}
                            />
                        </Box>
                    )}
                    {meta !== undefined && (
                        <Box
                            className="shelf-spine__meta"
                            sx={{
                                position: "absolute",
                                left: px(SPINE_SIZES.volMetaInset),
                                right: px(SPINE_SIZES.volMetaInset),
                                bottom: px(SPINE_SIZES.volMetaInset),
                                fontFamily: FONTS.mono,
                                fontSize: px(SPINE_SIZES.volMetaFontSize),
                                lineHeight: SPINE_SIZES.volMetaLineHeight,
                                color: COLORS.iconColor,
                                zIndex: 1,
                            }}
                        >
                            {meta}
                        </Box>
                    )}
                </>
            ) : (
                <>
                    {/* Title at the top and count at the foot, pushed apart by the
                        root's `space-between` — so the count sits on the spine's base
                        however tall the band makes it. */}
                    <Box
                        className="shelf-spine__name"
                        sx={{
                            fontFamily: FONTS.sans,
                            fontSize: px(SPINE_SIZES.nameFontSize),
                            fontWeight: 700,
                            // The design says -0.005em. Tightened to -0.01em because at
                            // the design's value "Unfamiliar" measures 56.02px into the
                            // spine's 56px of content and wraps — it misses by two
                            // hundredths of a pixel. 0.5% of tracking is invisible; a
                            // ten-letter word broken after its ninth letter is not.
                            letterSpacing: "-0.01em",
                            lineHeight: SPINE_SIZES.nameLineHeight,
                            color: COLORS.onSurface,
                            position: "relative",
                            zIndex: 1,
                            // A set's name is often ONE word wider than the spine's 56px
                            // of content ("Unfamiliar", "Comfortable"), so it has to
                            // break inside the word. The design's `overflow-wrap:
                            // anywhere` alone breaks at whatever character runs out of
                            // room — "Unfamilia / r" — so `hyphens: auto` goes first: the
                            // browser picks a syllable boundary and marks it with a
                            // hyphen ("Unfa- / miliar").
                            //
                            // ⚠️ It must be `break-word`, NOT the design's `anywhere`.
                            // `anywhere` creates a soft-wrap opportunity at EVERY
                            // character, so the line-breaker always fills to the last one
                            // that fits and hyphenation never gets a look in.
                            // `break-word` only breaks a word that cannot fit on a line
                            // of its own, which is exactly when hyphenation applies.
                            hyphens: "auto",
                            overflowWrap: "break-word",
                        }}
                    >
                        {label}
                    </Box>
                    {/* The foot row. A real flex row rather than two absolutely
                        positioned corners, so the count and the glyph physically
                        cannot overlap however long the numeral gets. */}
                    {(count !== undefined || glyph !== undefined) && (
                        <Box
                            className="shelf-spine__foot"
                            sx={{
                                display: "flex",
                                alignItems: "flex-end",
                                justifyContent: "space-between",
                                gap: px(4),
                                position: "relative",
                                zIndex: 1,
                            }}
                        >
                            <Box
                                className="shelf-spine__count"
                                sx={{
                                    fontFamily: FONTS.mono,
                                    fontSize: px(SPINE_SIZES.countFontSize),
                                    color: COLORS.iconColor,
                                    minWidth: 0,
                                }}
                            >
                                {count}
                            </Box>
                            {glyph !== undefined && (
                                <Icon
                                    className="shelf-spine__glyph"
                                    name={glyph}
                                    size={SPINE_SIZES.glyphSize}
                                    color={COLORS.iconColor}
                                    // Authored px for the opsz axis, rendered in cqw so
                                    // the glyph scales with the spine like everything else.
                                    sx={{ fontSize: px(SPINE_SIZES.glyphSize), opacity: 0.6, flexShrink: 0 }}
                                />
                            )}
                        </Box>
                    )}
                </>
            )}

            {pin !== undefined && (
                <Box
                    className="shelf-spine__pin"
                    sx={{
                        position: "absolute",
                        right: px(SPINE_SIZES.pinInset),
                        top: px(SPINE_SIZES.pinInset),
                        fontFamily: FONTS.mono,
                        fontSize: px(SPINE_SIZES.pinFontSize),
                        color: COLORS.onSurface,
                        background: "rgba(255, 255, 255, 0.72)",
                        borderRadius: px(6),
                        padding: `${px(2)}px ${px(5)}px`,
                        zIndex: 1,
                    }}
                >
                    {pin}
                </Box>
            )}

            {caption !== undefined && (
                <Box
                    className="shelf-spine__caption"
                    sx={{
                        position: "absolute",
                        left: px(SPINE_SIZES.captionInset),
                        right: px(SPINE_SIZES.captionInset),
                        bottom: px(SPINE_SIZES.captionInset),
                        fontFamily: FONTS.mono,
                        fontSize: px(SPINE_SIZES.captionFontSize),
                        color: COLORS.textSecondary,
                        zIndex: 1,
                    }}
                >
                    {caption}
                </Box>
            )}
        </SpineRoot>
    );
};

export default Spine;
