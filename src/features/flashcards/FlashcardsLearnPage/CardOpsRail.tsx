import { useEffect, useState } from "react";
import { Box } from "@mui/material";
import Icon from "../../../components/Icon";
import AddToDeckMenu from "../AddToDeckMenu";
import { CARD_OPS_CELL_SX, CARD_OPS_CELL_LABEL_SX } from "../cardOpsCell";
import { COLORS } from "../../../theme/colors";
import type { VocabEntry } from "../types";

/**
 * `CardOpsRail` — the design's `.cdot` / `.crail` (artboard 21): everything that
 * operates on THIS CARD, behind a single `•••` on the card's own top edge.
 *
 * ── The rule this rail encodes ────────────────────────────────────────────────
 * Only true CARD operations live here — customize its icon arrangement, file it into a
 * deck, delete it. Things you do with the WORD (practise writing it, load it into
 * Compare) are on `WordToolsRail`, above the card and outside its boundary. The split
 * is not cosmetic: a word tool would still make sense if this card did not exist, and a
 * card operation would not.
 *
 * ── Why a rail and not a menu ─────────────────────────────────────────────────
 * The `•••` expands SIDEWAYS along the top edge into one row of labelled glyphs. No
 * scrim, no dropdown, no radial fan — three deliberate consequences:
 *
 *   • the card stays fully readable underneath, so the learner can still see which
 *     card they are about to delete;
 *   • every option is labelled, so `delete` beside `add to deck` is never a guess at
 *     an unlabelled glyph;
 *   • it opens and closes in place, inside the card's own bounds, so it cannot be
 *     mistaken for page chrome the way a portaled MUI `Menu` is.
 *
 * The rail closes on its own `×` rather than on an outside tap: an outside tap on this
 * surface is a card FLIP or a swipe, and spending it on dismissing a menu would either
 * eat the gesture or mark the card by accident.
 *
 * ── Where it is mounted ───────────────────────────────────────────────────────
 * Inside the card's SIDE 2 face (`CardFaceSide`'s `topRail` slot, threaded from the flp
 * page the same way `editCanvas` is), so it flips and drags with the card exactly as
 * drawn. Front card only, answer face only — a `•••` on a question face would offer to
 * delete a card the learner has not yet seen the answer to.
 *
 * The cdp does NOT use this: artboard 18 keeps its three card operations in the page
 * header, which that page has and the flp does not.
 *
 * Referenced by docs/SHELF_REDESIGN.md (artboard 21), docs/CARD_ICON_LAYOUT.md
 * (customize) and docs/DECKS_FEATURE.md (add to deck).
 */

export interface CardOpsRailProps {
    entry: VocabEntry;
    /** Open the flashcard icon editor (fie) on this card. */
    onCustomize: () => void;
    /** Ask to delete this card — the host raises the confirmation. */
    onDelete: () => void;
    /**
     * Suppress the whole control. The fie is already open (its own toolbar owns the
     * card), or the card is mid-animation and none of these actions is safe.
     */
    disabled?: boolean;
    className?: string;
}

export const CardOpsRail: React.FC<CardOpsRailProps> = ({
    entry,
    onCustomize,
    onDelete,
    disabled = false,
    className,
}) => {
    const [open, setOpen] = useState(false);

    // The rail sits on the flip/drag target, so EVERY press here has to be stopped
    // from reaching the card's handlers or the gesture is read as a flip.
    const stop = (e: React.SyntheticEvent) => e.stopPropagation();

    // Collapse whenever the control is suppressed, rather than only hiding it: an
    // open rail left behind a disabled state springs back the moment the fie closes,
    // over a card the learner has since moved on from. An effect, not a render-time
    // setState — the latter is a React warning and an extra render for no reason.
    useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

    if (disabled) return null;

    if (!open) {
        return (
            <Box
                component="button"
                type="button"
                aria-label="Card options"
                className={className ? `card-ops-dot ${className}` : "card-ops-dot"}
                onClick={(e) => { stop(e); setOpen(true); }}
                onMouseDown={stop}
                onTouchStart={stop}
                onTouchEnd={stop}
                sx={{
                    position: "absolute",
                    top: 11,
                    right: 11,
                    zIndex: 3,
                    display: "flex",
                    border: "none",
                    cursor: "pointer",
                    // Translucent white rather than opaque: the dot sits over the card's
                    // icon arrangement, and an opaque puck punches a hole in it.
                    backgroundColor: "rgba(255,255,255,0.66)",
                    borderRadius: "999px",
                    padding: "6px",
                    lineHeight: 1,
                }}
            >
                <Icon name="more_horiz" size={18} />
            </Box>
        );
    }

    return (
        <Box
            className={className ? `card-ops-rail ${className}` : "card-ops-rail"}
            onMouseDown={stop}
            onTouchStart={stop}
            onTouchEnd={stop}
            sx={{
                position: "absolute",
                top: 11,
                right: 11,
                zIndex: 4,
                display: "flex",
                alignItems: "stretch",
                gap: "1px",
                backgroundColor: "rgba(255,255,255,0.94)",
                borderRadius: "999px",
                boxShadow: "0 6px 18px rgba(20,18,26,0.15)",
                padding: "5px",
            }}
        >
            <Box
                component="button"
                type="button"
                className="card-ops-rail__customize"
                onClick={(e) => { stop(e); setOpen(false); onCustomize(); }}
                sx={CARD_OPS_CELL_SX}
            >
                <Icon name="brush" size={18} color={COLORS.onSurface} />
                <Box component="em" sx={CARD_OPS_CELL_LABEL_SX}>customize</Box>
            </Box>

            {/* Owns the deck fetch, the tick state and the save-on-close; the rail only
                supplies its shape. Self-hides on a card with no vet row. */}
            <AddToDeckMenu
                vocabEntryId={entry.id}
                className="card-ops-rail__add-to-deck"
                appearance="rail"
            />

            <Box
                component="button"
                type="button"
                className="card-ops-rail__delete"
                onClick={(e) => { stop(e); setOpen(false); onDelete(); }}
                sx={CARD_OPS_CELL_SX}
            >
                <Icon name="delete" size={18} color={COLORS.dangerInk} />
                <Box component="em" sx={{ ...CARD_OPS_CELL_LABEL_SX, color: COLORS.dangerInk }}>delete</Box>
            </Box>

            <Box
                className="card-ops-rail__separator"
                sx={{ width: "1px", backgroundColor: "rgba(23,22,26,0.1)", margin: "6px 3px", flexShrink: 0 }}
            />

            <Box
                component="button"
                type="button"
                aria-label="Close card options"
                className="card-ops-rail__close"
                onClick={(e) => { stop(e); setOpen(false); }}
                sx={{
                    ...CARD_OPS_CELL_SX,
                    justifyContent: "center",
                    width: 32,
                    padding: 0,
                    backgroundColor: COLORS.onSurface,
                }}
            >
                <Icon name="close" size={16} color={COLORS.white} />
            </Box>
        </Box>
    );
};

export default CardOpsRail;
