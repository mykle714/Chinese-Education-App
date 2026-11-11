import React from "react";
import { Box, ButtonBase, Typography, useTheme, type BoxProps } from "@mui/material";
import { resolveDisplayDefinition, resolveDisplayPronunciation } from "../../../utils/definitionUtils";
import ForeignText from "../../../components/ForeignText";
import GlossText from "../../../components/GlossText";
import { ddTextColor } from "../../../utils/cardTextColor";
import { EIP_PANEL_GUTTER, InfoSheetEntryHeader } from "./styled";
import { FC_FONT_CJK } from "../constants";
import { SIZE, WEIGHT } from "../../../theme/scale";
import type { VocabEntry } from "../types";
import { COLORS } from "../../../theme/colors";
import { keycapPressSx } from "../../../theme/keycapPress";
import { roundedEdgeFilletDown, roundedEdgeRimLightTop } from "../../../theme/roundedEdge";
import { useEipColors } from "./useEipPalette";

// The eip's ENTRY HEADER — the band above the eip tabs: the headword keycap and the gloss — ONE dd: the selected sense's, else the
// default's. A multi-sense word's full sense list is NOT drawn here: it sits as a numbered two-column
// list at the top of the Definition tab (EipSenseList, owner's call 2026-11-05; it replaced the
// header's swipeable dot-separated list, 2026-10-29 → 2026-11-05).
//
// Mounted once, by InfoCardSection in the eip SHEET's upper panel (EipUpperPanel —
// flp/acp/saved-card cdp/Dictionary). The speaker and the Learning key live in the sheet's
// trail row (EipUpperPanel / EipAddKey), not here. Until 2026-11-10 InfoCardPanelBody also
// mounted it inline for the read-only dictionary cdp, the one host that drew a speaker +
// glowing Learning toggle beside the headword; that page and that stack are gone.
//
// Tower Tier 2 styling (2026-10-29), layout unchanged: the headword sits in a RAISED TILE
// (the palette's `face` on a 4px `edge` lip, 14px radius, at least HEADWORD_TILE_MIN square
// — design `.ehd > .cp`), the gloss is 18px. (The sense chip that sat beside the gloss
// was replaced by the sense list, 2026-10-29.)
// The design also flips the tile's pinyin BELOW the character; that is a layout change and
// was not taken.
// Docs: docs/LEAF_NODE_PAGES.md § card-detail pages; docs/DEFINITION_CLUSTERS.md (picker).
//
// Extra props (className, sx, the sheet's drag-to-resize bind handlers) are spread onto
// the root, so the bottom-sheet wrapper can make the header a resize handle.

export interface EipEntryHeaderProps extends Omit<BoxProps, "children"> {
    entry: VocabEntry | null;
    showPinyinColor?: boolean;
    // Index into sortedSenseClusters(entry); drives the reading and the dd. Omitted → the
    // persisted pick, else the default (resolveDisplayDefinition / resolveDisplayPronunciation).
    // Display-only (owner's call 2026-10-29): the pick is made on the card face's SensePicker.
    selectedSenseIndex?: number;
    // The eip SHEET: the gloss box takes the trail's boundaries, keycap edge → screen edge
    // (the trail row above shares them). The text keeps insets:
    // GLOSS_KEYCAP_CLEARANCE off the keycap on the left, the gutter on the right.
    // Needs the header's own gap removed and its side padding at 0 (InfoCardSection does both).
    // Docs: docs/EIP_SHEET_GESTURES.md § Telescope.
    glossToScreenEdge?: boolean;
}

// The headword keycap's lip, and how far it sinks when pressed.
const TILE_LIP = 4;

// The headword keycap's minimum size, both ways, so a one-character word is a true square.
// It is the height the md cpcd needs: 76px cell - HEADWORD_CPCD_TOP_TRIM + the 8px bottom of
// HEADWORD_TILE_PADDING. Keep the three in step — a floor below that height leaves a
// one-character tile taller than wide.
export const HEADWORD_TILE_MIN = 81;
// No top padding: the md cpcd cell already carries about 17px of air above the glyph (its
// own padding + line box) but only about 5px below the pinyin, so the bottom's 8px is what
// centers the ink in the tile. 10px sides are only felt by multi-character words.
const HEADWORD_TILE_PADDING = "0 10px 8px";
// Pulls the cpcd up into its own top air, so the tile gives back the room md's
// GLYPH_DROP_PX (CPCDRow) opened above the glyph. The pinyin rises with the row; the
// glyph lands where it was before the drop.
const HEADWORD_CPCD_TOP_TRIM = 3;

// The whitespace between the keycap and the gloss's first letter when the sheet's gloss is at
// rest (`glossToScreenEdge`).
const GLOSS_KEYCAP_CLEARANCE = 10;


const EipEntryHeader: React.FC<EipEntryHeaderProps> = ({
    entry,
    showPinyinColor = true,
    selectedSenseIndex,
    glossToScreenEdge = false,
    className,
    ...rest
}) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    const colors = useEipColors();
    // The keycap's 1px outline: the app's border token on the light palette, a faint white ring on the dark one.
    const tileRing = `inset 0 0 0 1px ${colors.dark ? "rgba(255, 255, 255, 0.12)" : COLORS.border}`;
    // The hairline rounded edge (theme/roundedEdge.ts, straight-lip form), the rim light
    // just inside the ring.
    const tileRim = roundedEdgeRimLightTop(colors.face, 1);
    // A tap on the keycap's PADDING (outside the cpcd row) still copies: forward it as a
    // click on the row, so CPCDRow's tap-to-copy — and its characters ⇄ pinyin alternation
    // and confirmation caption — stays the one implementation. A tap ON the row is already
    // handled there and bubbles up here, so it is skipped.
    const copyFromTile = (e: React.MouseEvent<HTMLElement>) => {
        if ((e.target as Element).closest(".cpcd-row")) return;
        e.currentTarget.querySelector<HTMLElement>(".cpcd-row")?.click();
    };
    // `.eid` — the gloss's type, shared by the dd and the sense list.
    const glossSx = {
        flex: 1,
        minWidth: 0,
        // Centered in the space beside the headword (owner's call 2026-10-30; was right-aligned).
        textAlign: "center",
        // The gloss is the header's payload, not a caption: 12.5 → 14.5
        // (2026-09-04) → SIZE.bodyLg/16px → SIZE.subtitle/18px → SIZE.title/22px
        // (2026-10-10) → 17px (2026-10-29, Tower Tier 2 `.ehd .gl`, which pairs it
        // with the raised headword tile instead of out-sizing it) → SIZE.subtitle/18px
        // (2026-10-30).
        fontSize: SIZE.subtitle,
        letterSpacing: "-0.008em",
        fontWeight: WEIGHT.regular,
        // Matches the flp card face via the shared dd color helper: zh
        // renders at full contrast, other languages are de-emphasized one
        // step off `onSurface` via the `dd` token.
        // (No Contrast pick is applied here — as before, this header
        // follows the card theme only, not the per-card override.)
        color: ddTextColor(entry?.language, undefined, fc),
        // FC_FONT_CJK (FONTS.cjk → `var(--cjk-font)`), not FC_FONT: the dd
        // follows the app's Chinese typeface (--cjk-font,
        // written by useChineseFont) exactly like the flp card face's dd
        // in card/CardFace.tsx, so the two glosses read as the same text.
        fontFamily: FC_FONT_CJK,
        lineHeight: 1.25,
    } as const;

    // The resting insets inside the screen-edge gloss box (see `glossToScreenEdge`).
    const glossInsetStart = glossToScreenEdge ? GLOSS_KEYCAP_CLEARANCE : 0;
    const glossInsetEnd = glossToScreenEdge ? EIP_PANEL_GUTTER : 0;

    return (
        <InfoSheetEntryHeader
            className={["mobile-demo-eic-header", className].filter(Boolean).join(" ")}
            {...rest}
        >
            {/* The headword keycap's group. It held a speaker / Learning stack beside the
                keycap until the dictionary cdp's inline header went (2026-11-10); kept as
                the non-shrinking box the dd row sits beside. */}
            <Box
                className="mobile-demo-eic-headword-group"
                sx={{ display: "flex", alignItems: "center", flexShrink: 0 }}
            >
                {entry && (
                    // `.ehd > .cp` — the headword KEYCAP: a raised tile with the app's
                    // raised-key press (keycapPressSx, like EipAddKey and the tower plates).
                    // Resting on a 4px `edge` lip; held, it sinks the full lip. The WHOLE tile is the
                    // tap-to-copy button: a tap on the glyphs is handled by CPCDRow's own
                    // `tapToCopy`; a tap on the tile's padding is forwarded to it (see
                    // `copyFromTile`). Carries the app's 1px ring (CLAUDE.md § Buttons & cards).
                    <ButtonBase
                        component="div"
                        // Pressed look from the app-wide keycap delegate
                        // (keycapPressDelegate.ts) — the tile sits in the upper panel's
                        // drag handle, whose pointer capture steals `:active`.
                        className="mobile-demo-eic-headword-tile"
                        aria-label="Copy word"
                        disableRipple
                        onClick={copyFromTile}
                        sx={{
                            boxSizing: "border-box",
                            minWidth: HEADWORD_TILE_MIN,
                            minHeight: HEADWORD_TILE_MIN,
                            padding: HEADWORD_TILE_PADDING,
                            "& .cpcd-row": { marginTop: `-${HEADWORD_CPCD_TOP_TRIM}px` },
                            marginBottom: "4px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            borderRadius: "14px",
                            backgroundColor: colors.face,
                            cursor: "pointer",
                            // The app's raised-key press (theme/keycapPress.ts): the
                            // tile jumps down onto its lip and back up, no easing.
                            ...keycapPressSx({
                                restShadow: `${tileRing}, ${tileRim}, ${roundedEdgeFilletDown(colors.face, colors.edge)}, 0 ${TILE_LIP}px 0 ${colors.edge}`,
                                pressedShadow: `${tileRing}, ${tileRim}`,
                                pressedY: TILE_LIP,
                            }),
                        }}
                    >
                    <ForeignText
                        size="md"
                        justifyContent="flex-start"
                        className="mobile-demo-eic-header-cpcd"
                        text={entry.entryKey}
                        // Sense-resolved, like the dd printed beside it. The panel's own live
                        // pick is the override so the reading changes on the tap, ahead of the
                        // persisted `selectedSense` round-tripping back (useEipTabs.syncEntry).
                        pronunciation={resolveDisplayPronunciation(entry, selectedSenseIndex)}
                        useToneColor={showPinyinColor}
                        showPinyin
                        // Tap the headword to copy it: first tap the characters, next
                        // tap the pinyin (CPCDRow.tapToCopy). The header is the one place
                        // the headword is shown purely as a reference, so a tap has
                        // nothing else to mean here.
                        tapToCopy
                    />
                    </ButtonBase>
                )}
            </Box>
            {/* `.eid` — the gloss, centered in the space beside the headword: one dd. */}
            {entry && (
                <Box
                    className="mobile-demo-eic-header-english-row"
                    sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        flex: 1,
                        minWidth: 0,
                        marginRight: glossToScreenEdge ? `-${EIP_PANEL_GUTTER}px` : 0,
                    }}
                >
                <Typography
                    className="mobile-demo-eic-header-english"
                    sx={{ ...glossSx, paddingLeft: `${glossInsetStart}px`, paddingRight: `${glossInsetEnd}px` }}
                >
                    {/* The eip header gloss is a dd: it must agree with the flashcard face,
                        so it resolves through the shared resolver (chosen sense →
                        definitions[0] fallback) instead of reading definitions[0] directly. */}
                    <GlossText text={resolveDisplayDefinition(entry, selectedSenseIndex)} />
                </Typography>
                </Box>
            )}
        </InfoSheetEntryHeader>
    );
};

export default EipEntryHeader;
