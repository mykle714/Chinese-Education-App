import { type ReactNode } from "react";
import { Box } from "@mui/material";
import { styled } from "@mui/material/styles";
import Icon from "../Icon";
import { COLORS } from "../../theme/colors";
import { FONTS, DATA_TYPE } from "../../theme/fonts";
import { SPINE_SIZES, SPINE_VARIANTS, spineScale, type SpineVariant } from "./spineGeometry";
import { SHADOW } from "../../theme/shadows";

/**
 * Spine — the app's single visual for *a set of cards*, and the atom of the shelf
 * (docs/SHELF_REDESIGN.md § A3). It replaces `DeckTile` outright (decision D9);
 * there is no coexistence period and no second "set of cards" visual.
 *
 * A spine is a ROUNDED BAR: a mid-tier body with the same 11px radius on all four
 * corners, a soft drop shadow, a white highlight down its right side, a title at the top
 * and an optional mono count at the foot. (Until 2026-11-13 it was drawn as a book seen
 * edge-on — 11/11/4/4 corners and a dark strap down its left edge (`.sp::after`). The
 * user chose the bar: inside the then-boxed `LibraryShelfPanel` the book cues read as
 * noise next to the white card, and the band row reads as a bar chart. The box went on
 * 2026-11-14; the bar stayed. The right-edge highlight was kept.) Its HEIGHT carries how big the set is, in three bands —
 * see `spineHeight` in ./spineGeometry.
 *
 * Purely presentational. It knows a label, a colour, an optional count and some
 * optional slots; it knows nothing about collections, decks, mastery bands or
 * routes. Its one caller today draws a utcm band on Account (DeckBuckets); it
 * served user-authored decks on the old Home page until Decks were deleted 2026-11-04,
 * which is why it still carries slots (`pin`, `caption`, `meta`, the `vol` variant)
 * that nothing passes.
 *
 * Depended on by: src/components/shelf/Shelf.tsx (as the row's content),
 * src/components/DeckBuckets.tsx. See docs/SHELF_REDESIGN.md § A3.
 */

export interface SpineProps {
    /** The set's name — `.nm`, at the top of the spine. */
    label: string;
    /**
     * FIT-TO-LINE name, for a caller that knows its label may be too wide to sit on one
     * line at `nameFontSize`: the label's measured width in px at `nameFontSize`
     * (natural scale), plus whatever cushion the caller wants. When set, the name:
     *   1. gets a line widened to the RIGHT — `namePadRightCompact` (2) instead of
     *      `padX` (9); the left inset and the foot row are unchanged, so the name starts
     *      where its neighbours' do; and
     *   2. is set at the LARGEST size that fits that line, capped at `nameFontSize` —
     *      `min(nameFontSize, line × nameFontSize / nameFitWidth)`, in CSS, so it tracks
     *      a container-sized spine without measuring anything in JS.
     * DeckBuckets passes it for "Comfortable" only (user, 2026-11-13: the names that fit
     * keep the design's size; 2026-11-14: as large as the widened spine allows).
     */
    nameFitWidth?: number;
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
    /**
     * The body colour — the ramp's MID tier (v2: "Mid: deck spines, pack spines,
     * document spines, bucket spines"). Ink on it is `COLORS.onSurface`.
     */
    color: string;
    /**
     * Width/height overrides, for the places the design overrides them. Interior
     * sizes (padding, type, glyph) follow `width` proportionally.
     *
     * `width` is either px (a number) or a CSS LENGTH string. The string form exists
     * so a row can size its spines from its OWN width in pure CSS — e.g. DeckBuckets
     * passes a `calc(min(…, 100cqw …))` against the row, which it marks as the
     * query container. The interior then scales as `calc(<width> * n/natural)`, so
     * nothing is measured in JS. (The spine still cannot be its own container — see
     * the ⚠️ on `SPINE_SIZES`; the container must be an ANCESTOR.)
     */
    width?: number | string;
    /**
     * The width interior sizes (padding, type, glyph) are scaled against, when it
     * differs from `width`. Defaults to `width`. A row that lets its spines grow WIDER
     * than the natural size but wants the extra width spent on label room rather than
     * bigger type passes `min(<natural>px, …)` here (DeckBuckets, 2026-11-14). Same
     * number-or-CSS-length forms as `width`.
     */
    interiorWidth?: number | string;
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
    // One radius on all four corners: the bar is a plain rounded rectangle, not a book
    // standing on its foot (see the component doc for the 2026-11-13 change).
    borderRadius: SPINE_SIZES.cornerRadius,
    background: color,
    // Two shadows in one: an outer drop shadow that lifts the spine off the row, and a
    // wide INSET white highlight on the right edge that gives the bar a soft roundness
    // rather than a flat swatch.
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
}));

const Spine: React.FC<SpineProps> = ({
    label,
    nameFitWidth,
    count,
    variant = "base",
    color,
    width,
    interiorWidth,
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
    // What the interior scales against: usually the rendered width, but a caller may
    // decouple the two (`interiorWidth`) so a widened spine keeps its type size.
    const scaleWidth = interiorWidth ?? renderedWidth;
    // Interior sizes are authored at the VARIANT'S natural width, not a global one.
    // A numeric width scales them by plain arithmetic; a CSS-length width scales them
    // in CSS (`calc(<width> * ratio)`), so they track a container-sized spine without
    // the component ever knowing its pixel width.
    const px = (n: number): number | string =>
        typeof scaleWidth === "number"
            ? n * spineScale(scaleWidth, spec.width)
            : `calc(${scaleWidth} * ${n / spec.width})`;
    // `px()` for use inside a shorthand string, where a bare number needs its unit.
    const len = (n: number) => {
        const value = px(n);
        return typeof value === "number" ? `${value}px` : value;
    };
    const fitsName = nameFitWidth !== undefined;
    // The fit-to-line name's font size (see `nameFitWidth`). Its line is the spine's
    // full rendered width minus the left `padX` and the narrowed right inset; the font
    // is that line scaled by nameFontSize / nameFitWidth, never above nameFontSize.
    const nameFontSize = fitsName
        ? `min(${len(SPINE_SIZES.nameFontSize)}, calc((${
              typeof renderedWidth === "number" ? `${renderedWidth}px` : renderedWidth
          } - ${len(SPINE_SIZES.padX + SPINE_SIZES.namePadRightCompact)}) * ${
              SPINE_SIZES.nameFontSize / nameFitWidth
          }))`
        : px(SPINE_SIZES.nameFontSize);
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
                padding: isVol ? 0 : `${len(SPINE_SIZES.padY)} ${len(SPINE_SIZES.padX)}`,
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
                            padding: `${len(SPINE_SIZES.volBandPadY)} ${len(SPINE_SIZES.volBandPadX)}`,
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
                                ...DATA_TYPE,
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
                            fontSize: nameFontSize,
                            // A fit-to-line name pulls out into the spine's RIGHT padding
                            // (padX → namePadRightCompact) so its line is wider. The left
                            // edge stays on the shared inset, and the root's padding — so
                            // the foot row — is untouched.
                            ...(fitsName && {
                                mr: `calc(-1 * ${len(SPINE_SIZES.padX - SPINE_SIZES.namePadRightCompact)})`,
                            }),
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
                            // A set's name can be ONE word wider than the spine's 56px of
                            // content ("Comfortable" at 11.5px — DeckBuckets passes
                            // `nameFitWidth` for it), so a label still has to be able to
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
                                    ...DATA_TYPE,
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
                        ...DATA_TYPE,
                        fontSize: px(SPINE_SIZES.pinFontSize),
                        color: COLORS.onSurface,
                        background: COLORS.frost,
                        borderRadius: px(6),
                        padding: `${len(2)} ${len(5)}`,
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
                        ...DATA_TYPE,
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
