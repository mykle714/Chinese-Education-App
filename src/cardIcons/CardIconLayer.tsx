import React from "react";
import { Box } from "@mui/material";
import type { IconLayoutItem } from "../types";
import { iconImageUrl, iconItemStyle } from "./cardIconLayout";

/**
 * CardIconLayer — read-only renderer for a saved custom icon arrangement on a
 * flashcard face (docs/CARD_ICON_LAYOUT.md). Fills the face as an absolutely
 * positioned, clipped layer; each icon is placed by its normalized center/scale/
 * rotation. Decorative (pointer-events: none) and meant to sit BEHIND the card's
 * text/buttons (the parent gives it a lower zIndex than the content).
 *
 * Icons partially off the card are cut off by `overflow: hidden`; nothing paints
 * outside the card boundary.
 */
const CardIconLayer: React.FC<{ layout: IconLayoutItem[] }> = ({ layout }) => {
    return (
        <Box
            className="card-icon-layer"
            sx={{
                position: "absolute",
                inset: 0,
                // Explicit zIndex establishes a stacking context so the per-icon zIndex
                // values stay CONFINED to this layer. Without it, an icon with z >= 1
                // competes directly with the card content (zIndex 1) and paints OVER the
                // text. With it, the whole layer sits at z0, always behind the content.
                zIndex: 0,
                overflow: "hidden",
                borderRadius: "12px",
                pointerEvents: "none",
            }}
        >
            {layout.map((item, i) => (
                <Box
                    component="img"
                    key={`${item.iconId}-${i}`}
                    className="card-icon-layer__icon"
                    src={iconImageUrl(item.iconId)}
                    alt=""
                    draggable={false}
                    sx={{ ...iconItemStyle(item), objectFit: "contain", userSelect: "none" }}
                />
            ))}
        </Box>
    );
};

export default CardIconLayer;
