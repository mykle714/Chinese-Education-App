import { type ReactNode } from "react";
import { Box } from "@mui/material";
import { styled } from "@mui/material/styles";
import Icon from "../Icon";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";

/**
 * Shelf — the container primitive for a collection the user owns
 * (docs/SHELF_REDESIGN.md § A3). Four pieces, matching the design's classes:
 *
 *   Shelf        `.shelf`    the padded container — owns the 22px page gutter
 *   ShelfHeader  `.shelfhd`  a row's caption, with an optional affordance at the right
 *   ShelfRow     `.shrow`    one row of spines, sitting on its wooden board
 *   ShelfNote    `.shnote`   a sentence under a row
 *
 * The BOARD is the reason a row is a component rather than a flex container the
 * caller writes inline: it is an absolutely-positioned bar that must sit at the
 * row's foot and overhang it by 6px on each side, which is what makes the spines
 * look stood ON something instead of floating in a list. A caller reproducing that
 * by hand is a caller who will get the overhang wrong.
 *
 * Used by: entries 2 (Decks), 3 (Discover), 6 (Reader), 18 (Card Detail).
 */

/** `.shelf` — the padded container. The 22px gutter is the design's page gutter. */
const Shelf = styled(Box)(() => ({
    padding: "0 22px",
}));

/**
 * `.shrow` — one row. `position: relative` is load-bearing: the board positions
 * against it, and the 12px of bottom padding is the gap the board sits in.
 */
const ShelfRowRoot = styled(Box)(() => ({
    position: "relative",
    // Full width even inside a centred flex column. Without this the row shrinks to
    // its spines and both go adrift: the spines centre instead of starting on the
    // same column as the heading above them, and the BOARD — which sizes to the row —
    // becomes a short bar under the spines rather than a shelf they stand on.
    width: "100%",
    marginTop: 9,
    paddingBottom: 12,
}));

/** `.spines` — bottom-aligned so banded heights grow UPWARD off the board. */
const Spines = styled(Box, {
    shouldForwardProp: (prop) => prop !== "scrollable",
})<{ scrollable: boolean }>(({ scrollable }) => ({
    display: "flex",
    gap: 10,
    alignItems: "flex-end",
    ...(scrollable
        ? {
              // A row longer than the column scrolls sideways rather than wrapping:
              // spines are flex-shrink:0, and a wrapped row would put a second board's
              // worth of spines on no board at all.
              overflowX: "auto",
              scrollbarWidth: "none",
              "&::-webkit-scrollbar": { display: "none" },
          }
        : { flexWrap: "wrap" }),
}));

/**
 * `.board` — the wooden board. Overhangs the row by 6px on each side so it reads as
 * a shelf the spines are stood on rather than an underline of the row's content.
 */
const Board = styled(Box)(() => ({
    position: "absolute",
    left: -6,
    right: -6,
    bottom: 0,
    height: 3,
    borderRadius: 2,
    background: COLORS.wood,
    boxShadow: "0 2px 5px rgba(20, 18, 26, 0.14)",
}));

export interface ShelfRowProps {
    children: ReactNode;
    /**
     * Scroll the row sideways instead of wrapping (the default). Wrapping puts the
     * overflow spines below the board, standing on nothing — so wrap only where the
     * row is known to fit, and scroll a list that grows.
     */
    scrollable?: boolean;
    /** Drop the board — for a row that is a group of spines but not a shelf. */
    board?: boolean;
    className?: string;
}

export const ShelfRow: React.FC<ShelfRowProps> = ({
    children,
    scrollable = false,
    board = true,
    className,
}) => (
    <ShelfRowRoot className={`shelf-row${className ? ` ${className}` : ""}`}>
        <Spines className="shelf-row__spines" scrollable={scrollable}>
            {children}
        </Spines>
        {board && <Board className="shelf-row__board" />}
    </ShelfRowRoot>
);

export interface ShelfHeaderProps {
    children: ReactNode;
    /**
     * The affordance at the right end — a Material Symbols name. The design puts a
     * chevron here for "there is more of this", so the whole header row is the
     * target rather than a separate link.
     */
    action?: string;
    onActionClick?: () => void;
    className?: string;
}

/** `.shelfhd` — a row's caption. Carries its own 22px gutter, so it is a SIBLING of
 *  `Shelf`, not a child: putting it inside would double the padding. */
export const ShelfHeader: React.FC<ShelfHeaderProps> = ({
    children,
    action,
    onActionClick,
    className,
}) => (
    <Box
        className={`shelf-header${className ? ` ${className}` : ""}`}
        onClick={onActionClick}
        sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "19px 22px 0",
            cursor: onActionClick ? "pointer" : "default",
        }}
    >
        {children}
        {action && <Icon name={action} size={19} color={COLORS.textSecondary} />}
    </Box>
);

export interface ShelfNoteProps {
    children: ReactNode;
    className?: string;
}

/** `.shnote` — a sentence under a row. Its own gutter, like `ShelfHeader`. */
export const ShelfNote: React.FC<ShelfNoteProps> = ({ children, className }) => (
    <Box
        className={`shelf-note${className ? ` ${className}` : ""}`}
        sx={{
            padding: "11px 22px 0",
            fontFamily: FONTS.sans,
            fontSize: 12,
            color: COLORS.textSecondary,
        }}
    >
        {children}
    </Box>
);

export default Shelf;
