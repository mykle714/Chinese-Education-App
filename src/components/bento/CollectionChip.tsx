import { type ReactNode } from "react";
import { Box } from "@mui/material";
import Icon from "../Icon";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";

/**
 * CollectionChip — `.chipsel` (docs/SHELF_REDESIGN.md § A4).
 *
 * The "which collection am I playing with" selector that sits ABOVE a Bento grid.
 * Today this is `GamesCollectionSelector` rendered into `HubMenu`'s `header` slot;
 * the redesign makes it a standalone bar, because with `HubMenu` deleted (D8) there
 * is no header slot to render into.
 *
 * WHY IT IS WHITE AND OUTLINED WHEN EVERY TILE BELOW IT IS A PASTEL: it is not a
 * destination. Tapping it changes what the destinations below will use, so it must
 * not read as one more thing in the menu. White-on-paper with a hairline is the
 * app's "this is a control" treatment (`.field`, `.rw`), and the contrast against a
 * grid of coloured tiles is the point.
 *
 * Used by: entry 4 (Games); available to 3 (Discover) if it grows a selector.
 */

export interface CollectionChipProps {
    /** Leading glyph — a Material Symbols name identifying the KIND of collection. */
    icon?: string;
    /** The collection's name. */
    label: ReactNode;
    /**
     * `small` — the trailing mono figure, normally the collection's card count.
     * Optional: a collection whose size is not the point omits it rather than
     * printing a zero.
     */
    count?: ReactNode;
    /**
     * An extra element between the label and the chevron — a colour swatch, a status
     * dot. Separate from `count` because `count` is typed as a mono FIGURE and styled
     * like one; a caller putting a shape there would inherit type styling it does not
     * want, and would make the slot's name a lie.
     */
    trailing?: ReactNode;
    /**
     * The trailing affordance. Defaults to `expand_more`, because the chip's whole job
     * is to open a picker and the artboard draws that chevron on it — a chip without
     * one reads as a label rather than a control. Pass `null` for the rare case where
     * there is nothing to pick.
     */
    action?: string | null;
    onClick?: () => void;
    className?: string;
}

const CollectionChip: React.FC<CollectionChipProps> = ({
    icon,
    label,
    count,
    trailing,
    action = "expand_more",
    onClick,
    className,
}) => (
    <Box
        className={`collection-chip${className ? ` ${className}` : ""}`}
        onClick={onClick}
        sx={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            // 18px gutter, not the grid's 16px: the chip is a bordered box, so its
            // own 1px edge would otherwise sit 2px proud of the tiles beneath it.
            margin: "14px 18px 0",
            padding: "11px 14px",
            borderRadius: "14px",
            background: COLORS.white,
            border: `1px solid ${COLORS.border}`,
            cursor: onClick ? "pointer" : "default",
        }}
    >
        {icon && <Icon name={icon} size={18} color={COLORS.textSecondary} />}
        <Box
            className="collection-chip__label"
            sx={{
                // flex:1 pushes the count to the far edge, so the count column lines up
                // regardless of how long the collection's name is.
                flex: 1,
                minWidth: 0,
                fontFamily: FONTS.sans,
                fontSize: 13.5,
                fontWeight: 600,
                color: COLORS.onSurface,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
            }}
        >
            {label}
        </Box>
        {count !== undefined && (
            <Box
                className="collection-chip__count"
                sx={{ fontFamily: FONTS.mono, fontSize: 10.5, color: COLORS.textFaint, flexShrink: 0 }}
            >
                {count}
            </Box>
        )}
        {trailing}
        {action && <Icon name={action} size={18} color={COLORS.textSecondary} />}
    </Box>
);

export default CollectionChip;
