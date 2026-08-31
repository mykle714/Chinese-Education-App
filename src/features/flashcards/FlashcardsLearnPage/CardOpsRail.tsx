import { useEffect, useState } from "react";
import { Box } from "@mui/material";
import Icon from "../../../components/Icon";
import AddToDeckMenu from "../AddToDeckMenu";
import { CARD_OPS_CELL_SX, CARD_OPS_CELL_LABEL_SX } from "../cardOpsCell";
import { COLORS } from "../../../theme/colors";
import type { VocabEntry } from "../types";
import { SHADOW } from "../../../theme/shadows";

/**
 * `CardOpsRail` — the design's `.cdot` / `.crail` (artboard 21): everything that
 * operates on THIS CARD, behind a single `•••` on the card's own top edge.
 *
 * ── The rule this rail encodes ────────────────────────────────────────────────
 * Only true CARD operations live here — customize its icon arrangement, file it into a
 * deck, write a note on it. Things you do with the WORD (practise writing it, load it into
 * Compare) are on `WordToolsRail`, above the card and outside its boundary. The split
 * is not cosmetic: a word tool would still make sense if this card did not exist, and a
 * card operation would not.
 *
 * DELETE IS DELIBERATELY NOT HERE. It used to hold the third slot; the note editor took
 * that slot (docs/CARD_NOTES.md). Deleting a card is rare, irreversible and takes its
 * review history with it, so it belongs on a surface the learner has navigated TO — the
 * cdp header, and the shelf's multi-select — not one tap from the card they are drilling.
 *
 * ── Why a rail and not a menu ─────────────────────────────────────────────────
 * The `•••` expands SIDEWAYS along the top edge into one row of labelled glyphs. No
 * scrim, no dropdown, no radial fan — three deliberate consequences:
 *
 *   • the card stays fully readable underneath, so the learner can still see which
 *     card they are about to act on;
 *   • every option is labelled, so `note` beside `add to deck` is never a guess at
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
 * drawn. Front card only, answer face only. Answer-face-only matters for the note in
 * particular: the note renders on that same face, so opening its editor from the question
 * face would put a text box on a side that never shows it.
 *
 * The cdp mounts it too, on its hero card (`VocabCardDetailPage`), because the rail's
 * `note` cell is the ONLY affordance that opens the note editor — read-mode notes are
 * inert by design — so the note cannot exist on a surface without the rail. Its
 * `customize` and `add to deck` cells therefore duplicate two of that page's header
 * actions; the header keeps `delete`, which is deliberately not on the rail.
 *
 * Referenced by docs/SHELF_REDESIGN.md (artboard 21), docs/CARD_ICON_LAYOUT.md
 * (customize), docs/DECKS_FEATURE.md (add to deck) and docs/CARD_NOTES.md (note).
 */

export interface CardOpsRailProps {
    entry: VocabEntry;
    /** Open the flashcard icon editor (fie) on this card. */
    onCustomize: () => void;
    /**
     * Open the in-place note editor on this card (vet.note, migration 155). The editor
     * itself lives at the card's bottom edge (`CardNote`) — this cell only opens it, so
     * the rail closes on the same tap and leaves the card readable underneath.
     */
    onEditNote: () => void;
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
    onEditNote,
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
                boxShadow: SHADOW.float,
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
                className="card-ops-rail__note"
                onClick={(e) => { stop(e); setOpen(false); onEditNote(); }}
                sx={CARD_OPS_CELL_SX}
            >
                <Icon name="sticky_note_2" size={18} color={COLORS.onSurface} />
                <Box component="em" sx={CARD_OPS_CELL_LABEL_SX}>note</Box>
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
