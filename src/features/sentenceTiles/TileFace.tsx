import { Box } from "@mui/material";
import ForeignText from "../../components/ForeignText";
import type { CPCDSize } from "../../components/cpcdLayout";
import { COLORS } from "../../theme/colors";
import { tileFaceSx, tileStockShadow } from "./sentenceTilesStyles";

/**
 * TileFace — one word tile: the word (pinyin hidden) on a card-stock face
 * (docs/SENTENCE_TILES_GAME.md § "Pages"). Used on the board and in the rack.
 *
 * No point value is printed: scoring is provisional while the AI judges lines, and a printed
 * number would promise a rigid value the game does not have yet.
 *
 * The word is set in cpcd's BLOCK layout (ForeignText `layout="block"`, CPCDBlock): one or two
 * characters sit in a line, three make a triangle and four a 2×2 square, so every det word
 * fills its square tile the same way instead of shrinking a long row to fit. One character
 * reads at `sm`, two or more at `xs`.
 *
 * `stock`: "grounded" draws the tile's wall here (board tiles, set down); "none" draws the
 * face only, for a host that animates the stock itself (DraggableRackTile's lifting shadow).
 */

interface TileFaceProps {
    word: string;
    /** Square side in px (the face; the wall adds TILE_WALL_ALLOWANCE_PX right and below). */
    sizePx: number;
    /** Fill override (this turn's tiles, the last play, exchange picks). Defaults to the cream face. */
    face?: string;
    /** A strong ink ring (selected). */
    selected?: boolean;
    stock?: "grounded" | "none";
    className?: string;
}

function sizeFor(charCount: number): CPCDSize {
    return charCount <= 1 ? "sm" : "xs";
}

export default function TileFace({ word, sizePx, face = COLORS.cardFace, selected, stock = "grounded", className }: TileFaceProps) {
    return (
        <Box
            className={className ?? "sentence-tiles-tile"}
            sx={{
                ...tileFaceSx(face),
                ...(stock === "grounded" ? { boxShadow: tileStockShadow(face, null) } : null),
                width: sizePx,
                height: sizePx,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                ...(selected ? { outline: `2px solid ${COLORS.onSurface}`, outlineOffset: "1px" } : null),
            }}
        >
            <ForeignText
                className="sentence-tiles-tile__word"
                text={word}
                layout="block"
                size={sizeFor([...word].length)}
                showPinyin={false}
                useToneColor={false}
            />
        </Box>
    );
}
