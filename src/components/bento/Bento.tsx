import { type ReactNode } from "react";
import { Box } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { styled } from "@mui/material/styles";
import CardShell, { CARD_TITLE_SX } from "./CardShell";
import { COLORS, RAMP, type RampHue } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";

/**
 * Bento — the menu primitive (docs/SHELF_REDESIGN.md § A4). The component that
 * replaces `HubMenu` (decision D8).
 *
 * THE RULE THAT MAKES THE SYSTEM WORK — the whole redesign turns on this one
 * choice, so it is restated wherever either primitive is defined:
 *
 *     Bento is for MENUS OF DESTINATIONS.
 *     Shelf is for COLLECTIONS THE USER OWNS.
 *
 *     If a tile NAVIGATES, it is a Bento tile.
 *     If it represents a thing WITH A COUNT, it is a spine.
 *
 * A destination has no size, so a Bento tile has no height encoding — every tile in
 * a grid is the same height and the only weighting is `hero` (spans both columns)
 * and `low` (a shorter row of minor destinations). That is the opposite of `Spine`,
 * whose height IS its count.
 *
 * Two pieces, matching the design's classes:
 *
 *   Bento         `.bento`   the 2-column grid — owns the 16px page gutter
 *   BentoTile     `.bt`      one destination; `hero` = `.bt.w2`, `low` = `.bt.lo`
 *
 * A tile's body is `CardShell` (./CardShell), which the Games hub's full-width
 * `GameCard` also renders through — so a game card and a tile are one family.
 * (`BentoStrip` / `BentoSubTile` — a captioned row of sub-tiles — were deleted
 * 2026-10-03 once the Games hub's level rows became `GameCard`s; a SET of launch
 * options now lives inside a `GameCard`.)
 *
 * ON THE MISSING `markOutline`: every other pastel fill in the app carries the 12%
 * inset ring, because at ~1.15:1 against paper a pastel is not a shape on its own
 * (D2). A Bento tile is the deliberate exception, and the design draws the
 * distinction itself: `.msb .cells i` — 15px tall, no content — gets the inset ring,
 * while `.bt` — 112px tall, carrying a title and a subtitle — gets a soft drop
 * shadow instead. At this size the content and the shadow do the separating work,
 * and an inset hairline on a 19px-radius tile reads as a stray border. The rule is
 * therefore "a pastel needs an outline UNLESS it is large and occupied".
 * It is also the one exception to the app-wide button/card outline rule
 * (CLAUDE.md § "Buttons & cards").
 *
 * Used by: entries 1 (Home), 3 (Discover), 4 (Games), 5 (Account).
 */

/**
 * `.bento` — the grid. The 16px gutter is the design's menu gutter (the Shelf's is 22px;
 * they are different numbers on purpose, since a tile's own 14px of padding already
 * insets its text).
 *
 * TWO COLUMNS IS THE DEFAULT AND THE NORM — it is what every hub in the app uses, and
 * what makes a tile big enough to carry a title and a subtitle. `columns={3}` exists for
 * the one shape the artboards also draw (Friends, artboard 8): a row of SIBLING ACTIONS
 * that belong together and are named in one word each. At three columns a tile is too
 * narrow for a subtitle, so pair it with `variant="low"` and let the ghost glyph carry
 * the meaning the one-word label compresses. Do not reach for it to fit more
 * destinations on a hub — group them inside one full-width card instead.
 */
const Bento = styled(Box, {
    shouldForwardProp: (prop) => prop !== "columns",
})<{ columns?: 2 | 3 }>(({ columns = 2 }) => ({
    display: "grid",
    gridTemplateColumns: `repeat(${columns}, 1fr)`,
    gap: 10,
    padding: "14px 16px 0",
}));


/**
 * A tile is a DESTINATION, so it must be a real anchor rather than a Box with an
 * onClick: that is what gives it middle-click/new-tab, a status-bar URL preview, and
 * keyboard focus for free. This resolves the `to`/`onClick` pair into the props that
 * turn a `Box` into a `RouterLink` when — and only when — there is a route to go to.
 *
 * `onClick` alone is still supported for the tiles that open a sheet instead of
 * navigating; those are genuinely buttons and are typed as such.
 */
function tileLinkProps(to?: string, state?: unknown, onClick?: (e: React.MouseEvent) => void) {
    if (to) {
        return {
            component: RouterLink as React.ElementType,
            to,
            state,
            onClick,
            // No link styling: CardShell resets `textDecoration` / `color` itself.
        };
    }
    return onClick ? { component: "button" as React.ElementType, type: "button", onClick } : {};
}

export type BentoTileVariant = "base" | "hero" | "low" | "compact";

/** Per-variant geometry. Kept as a table rather than branches so the three variants
 *  can be read against each other — the ghost glyph's size and offset change with
 *  the tile, and that pairing is easy to break when it is spread across ifs. */
export const TILE_VARIANTS: Record<
    BentoTileVariant,
    { minHeight: number; span: number; title: number; letterSpacing: string; sub: number; ghost: number; ghostTop: number }
> = {
    base: { minHeight: 112, span: 1, title: 15.5, letterSpacing: "-0.015em", sub: 11.5, ghost: 92, ghostTop: -14 },
    hero: { minHeight: 150, span: 2, title: 23, letterSpacing: "-0.028em", sub: 12.5, ghost: 140, ghostTop: -26 },
    low: { minHeight: 90, span: 1, title: 15.5, letterSpacing: "-0.015em", sub: 11.5, ghost: 92, ghostTop: -14 },
    // The 3-up tile (Friends, artboard 8). Everything shrinks TOGETHER, and the ghost
    // shrinks most: at a third of the screen the tile is ~117px wide, so `low`'s 92px
    // glyph would fill it corner to corner and stop reading as a wash behind the label.
    compact: { minHeight: 74, span: 1, title: 14, letterSpacing: "-0.015em", sub: 11, ghost: 66, ghostTop: -10 },
};

export interface BentoTileProps {
    /** `.t` — the destination's name. */
    title: ReactNode;
    /** `.s` — one short line on what is there. Optional; a self-evident tile skips it. */
    subtitle?: ReactNode;
    /**
     * Which ramp hue the tile wears. A KEY rather than a colour, so every hub names
     * its hues the same way (see `RAMP`). The body is the hue's MID tier — v2 captions
     * every hub "Colour tiers — Mid: every bento tile" (artboards 1, 3, 4, 8).
     *
     * Text AND the ghost glyph are ink (`COLORS.onSurface`, subtitle
     * `COLORS.textSecondary`) on every hue: v2 has no per-hue ink tier.
     */
    hue: RampHue;
    /**
     * `.bg` — the oversized ghost glyph that bleeds off the top-right. A Material
     * Symbols name (see components/Icon).
     *
     * It is drawn in the tile's OWN ink at 15%, not in neutral ink: the artboards set
     * `color:var(--purA)` on the tile and let `.bg` inherit it, so the ghost is a
     * deeper wash of the tile's own hue rather than a grey smudge on it. That is what
     * keeps a tile reading as one colour instead of two.
     *
     * It is decoration, not information: clipped, behind the text, and at 15% barely a
     * tone. Pick it so a hub reads as one family of shapes at a glance — do NOT rely
     * on it to distinguish two tiles, because the title is doing that job.
     */
    icon?: string;
    /** `.pin` — a mono pill badge in the tile's top-right corner. */
    pin?: ReactNode;
    /**
     * What the pin MEANS, which is the only thing that decides its colour:
     *   `"default"` — a fact about the destination ("14 decks", "2 modes"). Translucent
     *                 white, so it reads as a quiet note on the tile's own pastel.
     *   `"alert"`   — a count of things WAITING FOR THE USER (friend requests, pending
     *                 challenges). The app's danger pink on white, because an unread
     *                 count that blends into its tile is a notification nobody sees.
     *
     * The distinction is deliberate and worth keeping: if every pin were alert-coloured
     * the tiles would all shout, and if none were, the two counts on the Friends hub —
     * the entire discovery mechanism for challenges (docs/STUDY_CHALLENGE.md § 1, Q48) —
     * would be indistinguishable from a deck count.
     */
    pinTone?: "default" | "alert";
    /**
     * The `pin` node brings its own chrome (e.g. the games' `WinCountPill`), so the slot
     * only POSITIONS it — no font, padding or background, and `pinTone` is ignored.
     * Lets a badge keep one look across surfaces instead of nesting a pill in a pill.
     */
    pinBare?: boolean;
    /** Which top corner the pin sits in. Default `"right"`; the Games hub's small game
     *  tiles use `"left"` so the win pill sits clear of the ghost glyph (top-right). */
    pinSide?: "left" | "right";
    variant?: BentoTileVariant;
    /**
     * Force the tile across every column of its grid, keeping `variant`'s geometry.
     *
     * `hero` already spans full width — it IS the big full-width tile — so this is for
     * the other combination the artboards use: a SHORT tile that still owns its own row
     * (Friends' Challenges bar, a `compact`/`low` tile under a 3-up of siblings). Width
     * and height are separate decisions, and folding them into one enum would mean
     * minting a variant per pairing.
     */
    fullWidth?: boolean;
    /** Destination route — the whole tile becomes a `RouterLink` to this path. */
    to?: string;
    /** Router `state` to carry with the navigation (Bubble Match's chosen level). */
    state?: unknown;
    /**
     * Receives the click event, so a tile that also has a `to` can intercept its own
     * activation — `preventDefault()` and navigate imperatively — while still leaving
     * modified clicks (⌘/ctrl/middle) to the underlying anchor. Word Search's mode
     * tiles need exactly this, to confirm before clobbering a saved board.
     */
    onClick?: (e: React.MouseEvent) => void;
    className?: string;
}

/** `.bt` — one destination. Its body (radius, outline, shadow, ghost, pin) is the
 *  family's shared `CardShell`; this component owns only the foot-aligned title +
 *  subtitle and the per-variant geometry. */
export const BentoTile: React.FC<BentoTileProps> = ({
    title,
    subtitle,
    hue,
    icon,
    pin,
    pinTone = "default",
    pinBare = false,
    pinSide = "right",
    variant = "base",
    fullWidth = false,
    to,
    state,
    onClick,
    className,
}) => {
    const v = TILE_VARIANTS[variant];
    const spansGrid = fullWidth || v.span === 2;
    const link = tileLinkProps(to, state, onClick);
    return (
        <CardShell
            className={`bento-tile bento-tile--${variant}${className ? ` ${className}` : ""}`}
            {...link}
            // v2: MID body, INK ghost glyph (CardShell draws every ghost in ink).
            background={RAMP[hue].mid}
            ghost={icon ? { name: icon, size: v.ghost, top: v.ghostTop, className: "bento-tile__ghost" } : undefined}
            pin={pin ? { node: pin, tone: pinTone, bare: pinBare, side: pinSide } : undefined}
            pinClassBlock="bento-tile"
            sx={{
                // `1 / -1` rather than `span 2`: a hero is "the full width of whatever
                // grid it is in", and spelling it as a span silently means "two thirds"
                // the moment it lands in a 3-column Bento.
                gridColumn: spansGrid ? "1 / -1" : undefined,
                minHeight: v.minHeight,
                // Content sits at the FOOT of the tile, which is what leaves the head
                // free for the ghost glyph to bleed into.
                justifyContent: "flex-end",
                cursor: to || onClick ? "pointer" : "default",
            }}
        >
            <Box
                className="bento-tile__title"
                sx={{
                    // `position: relative` on the text is load-bearing: without it the
                    // ghost glyph — an absolutely-positioned earlier sibling — paints OVER
                    // the title rather than behind it.
                    position: "relative",
                    ...CARD_TITLE_SX,
                    fontSize: v.title,
                    letterSpacing: v.letterSpacing,
                }}
            >
                {title}
            </Box>
            {subtitle && (
                <Box
                    className="bento-tile__subtitle"
                    sx={{
                        position: "relative",
                        fontFamily: FONTS.sans,
                        fontSize: v.sub,
                        color: COLORS.textSecondary,
                        marginTop: "3px",
                        lineHeight: 1.3,
                        // The hero is two columns wide but its subtitle should not be:
                        // a full-width line of 12.5px text under a 23px title reads as a
                        // paragraph rather than a caption.
                        ...(variant === "hero" ? { maxWidth: 250 } : {}),
                    }}
                >
                    {subtitle}
                </Box>
            )}
        </CardShell>
    );
};

export default Bento;
