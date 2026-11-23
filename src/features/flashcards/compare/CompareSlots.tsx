import { Box, ButtonBase } from "@mui/material";
import ForeignText from "../../../components/ForeignText";
import Icon from "../../../components/Icon";
import { resolveDisplayPronunciation } from "../../../utils/definitionUtils";
import { COLORS } from "../../../theme/colors";
import { FONTS } from "../../../theme/fonts";
import { SIZE, WEIGHT } from "../../../theme/scale";
import { keycapPressSx } from "../../../theme/keycapPress";
import { roundedEdgeFilletDown, roundedEdgeRimLightTop } from "../../../theme/roundedEdge";
import { useEipColors } from "../FlashcardsLearnPage/useEipPalette";
import type { VocabEntry } from "../../../types";
import type { CompareSlot, CompareState } from "./compareState";

/**
 * CompareSlots — the Compare panel's two WORD KEYCAPS, side by side with a "vs" between
 * them, drawn in the panel's tinted UPPER band (EipUpperPanel's `header` row, where the eip
 * draws its entry header). Docs: docs/WORD_COMPARE_FEATURE.md § Layout.
 *
 * Each slot is a raised white keycap — the eip headword tile's recipe (EipEntryHeader):
 * the palette's `face` on a 4px `edge` lip, the app's 1px outline, the hairline rounded
 * edge (theme/roundedEdge.ts) and the raised-key press (theme/keycapPress.ts). Filled, it
 * holds the word as an xl cpcd block; empty, a muted "+".
 *
 * BOTH keycaps are the same fixed SQUARE (SLOT_SIZE both ways), filled or empty, so the
 * pair reads as two matching keys rather than a word-wide slab beside a small "+". The word
 * is sized to fit the square (SLOT_CPCD_SIZE — see the constants below).
 *
 * TWO STATES (owner's call 2026-11-21): UP at rest, DOWN while the shelf's search is filling
 * that slot. Down is the keycap press held — sunk onto its lip, lip gone — the way
 * EipAddKey's "Added!" and td's latched filter keys rest low (`keycapPressSx` `restY`).
 * There is no extra highlight ring; the sunk key is the whole signal.
 *
 * Tapping a slot toggles it (`onSlotPress`; CompareSheet owns the latch): an up key goes
 * down and opens the search, the down key pops up and puts it away. There is no delete
 * gesture: a word is replaced, never cleared (the old tap-to-arm / tap-again-to-delete was
 * retired with the eip tab, 2026-11-21).
 *
 * The keycaps sit inside the upper panel's drag handle; its `filterTaps` keeps them
 * tappable, and the app-wide keycap delegate paints the press through the handle's
 * pointer capture (keycapPressDelegate.ts).
 *
 * Layer: feature component (src/features/flashcards/compare). Must sit under an
 * EipPaletteProvider. Depended on by: CompareSheet.
 */
interface CompareSlotsProps {
    state: CompareState;
    /** The slot the shelf's search is filling — its key is held DOWN — or null. */
    searchSlot: CompareSlot | null;
    onSlotPress: (slot: CompareSlot) => void;
    showPinyinColor: boolean;
}

// The keycap's lip, and how far it sinks when pressed (EipEntryHeader's TILE_LIP).
const SLOT_LIP = 4;
// The word's cpcd size. `lg`, not `xl`: the slot must hold the LARGEST block a slot can show
// (COMPARE_MAX_CHARS = 4 → a 2×2 square with two pinyin lines, ≈ 124px tall at lg —
// CPCDBlock: 2 × 38.4px glyphs + 2px gap + 4px margin + 2 × 20.3px pinyin lines; a
// two-character row is 2 × COLUMN_WIDTH.lg = 108px wide), and at xl that block is ≈ 155px
// tall and 144px wide — two of those squares plus the "vs" overrun a 393px phone's band.
// A one-character word at xl (the first cut) also made its key taller than the empty one.
const SLOT_CPCD_SIZE = "lg" as const;
// The square's side: the largest lg block (≈ 124px) plus SLOT_PADDING on each side, with a
// few px to spare. Two squares + gaps + "vs" ≈ 316px, inside the band's 357px
// (393 − 2 × EIP_PANEL_GUTTER).
const SLOT_SIZE = 140;
const SLOT_PADDING = 6;
const SLOT_RADIUS = 14;

export default function CompareSlots({ state, searchSlot, onSlotPress, showPinyinColor }: CompareSlotsProps) {
    const colors = useEipColors();

    const renderSlot = (slot: CompareSlot, entry: VocabEntry | null) => {
        const down = searchSlot === slot;
        // The app's 1px outline in both states (CLAUDE.md § Buttons & cards).
        const ring = `inset 0 0 0 1px ${colors.dark ? "rgba(255, 255, 255, 0.12)" : COLORS.border}`;
        const rim = roundedEdgeRimLightTop(colors.face, 1);
        // Up: standing on its lip. Down: the press, held — sunk by the lip, lip gone.
        const upShadow = `${ring}, ${rim}, ${roundedEdgeFilletDown(colors.face, colors.edge)}, 0 ${SLOT_LIP}px 0 ${colors.edge}`;
        const downShadow = `${ring}, ${rim}`;
        const ordinal = slot === "A" ? "first" : "second";
        return (
            <ButtonBase
                component="div"
                className={`compare-slots__slot compare-slots__slot--${slot.toLowerCase()}${down ? " compare-slots__slot--down" : ""}${entry ? "" : " compare-slots__slot--empty"}`}
                aria-label={entry ? `Replace the ${ordinal} word, ${entry.entryKey}` : `Choose the ${ordinal} word`}
                aria-pressed={down}
                disableRipple
                onClick={() => onSlotPress(slot)}
                sx={{
                    // A fixed square, filled or empty (see SLOT_SIZE).
                    flex: "0 0 auto",
                    width: SLOT_SIZE,
                    height: SLOT_SIZE,
                    boxSizing: "border-box",
                    padding: `${SLOT_PADDING}px`,
                    overflow: "hidden",
                    marginBottom: `${SLOT_LIP}px`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: `${SLOT_RADIUS}px`,
                    backgroundColor: colors.face,
                    cursor: "pointer",
                    ...keycapPressSx({
                        restShadow: down ? downShadow : upShadow,
                        pressedShadow: downShadow,
                        pressedY: SLOT_LIP,
                        restY: down ? SLOT_LIP : 0,
                    }),
                }}
            >
                {entry ? (
                    <ForeignText
                        size={SLOT_CPCD_SIZE}
                        layout="block"
                        justifyContent="center"
                        language={entry.language}
                        text={entry.entryKey}
                        pronunciation={resolveDisplayPronunciation(entry)}
                        // A reference surface: the slots ARE the material being compared, so
                        // pinyin is always on (the eip's rule); colour follows the setting.
                        showPinyin
                        useToneColor={showPinyinColor}
                    />
                ) : (
                    <Icon name="add" size={32} color={colors.muted} className="compare-slots__add" />
                )}
            </ButtonBase>
        );
    };

    return (
        <Box className="compare-slots" sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px" }}>
            {renderSlot("A", state.slotA)}
            <Box
                component="span"
                className="compare-slots__vs"
                aria-hidden
                sx={{
                    flexShrink: 0,
                    // The same bottom margin the keycaps keep for their lip, so it centres on the
                    // keycap FACES rather than on face + lip.
                    marginBottom: `${SLOT_LIP}px`,
                    fontFamily: FONTS.sans,
                    fontSize: SIZE.caption,
                    fontWeight: WEIGHT.semibold,
                    color: colors.muted,
                    letterSpacing: "0.02em",
                }}
            >
                vs
            </Box>
            {renderSlot("B", state.slotB)}
        </Box>
    );
}
