import React, { useMemo } from "react";
import { Box, ButtonBase, Typography, useTheme, type BoxProps } from "@mui/material";
import { DEFINITION_LIST_SEPARATOR, ddt, definitionListItems, resolveDefaultPronunciation, resolveDisplayDefinition, resolveDisplayPronunciation, resolveSelectedSenseIndex, sortedSenseClusters } from "../../../utils/definitionUtils";
import SwipeableTwoLineText, { type TwoLineSegment } from "../../../components/SwipeableTwoLineText";
import ForeignText, { type CPCDSize } from "../../../components/ForeignText";
import Icon from "../../../components/Icon";
import { ddTextColor } from "../../../utils/cardTextColor";
import { InfoSheetEntryHeader } from "./styled";
import { FC_FONT_CJK } from "../constants";
import { SIZE, WEIGHT } from "../../../theme/scale";
import { SpeakerButton } from "../../../components/SpeakerButton";
import LearningToggle from "../../../components/LearningToggle";
import type { LearningToggleState } from "../../../hooks/useLearningToggle";
import type { VocabEntry } from "../types";
import { COLORS } from "../../../theme/colors";
import { keycapPressSx } from "../../../theme/keycapPress";
import { useEipColors } from "./useEipPalette";

// The eip's ENTRY HEADER — the band above the eip tabs: headword cpcd, speaker (+ the
// dictionary eip's "+ to Learning") and the gloss — for a multi-sense word, EVERY sense's
// dd in one dot-separated list (the chosen sense underlined, the default starred).
//
// Mounted on every eip host: by InfoCardSection in the eip SHEET's upper panel
// (EipUpperPanel — flp/scp/saved-card cdp/Dictionary), and by InfoCardPanelBody in the
// cdps' inline panels.
//
// Tower Tier 2 styling (2026-10-29), layout unchanged: the headword sits in a RAISED TILE
// (the palette's `face` on a 4px `edge` lip, 14px radius, at least 76px square — design
// `.ehd > .cp`), the gloss is 18px. (The sense chip that sat beside the gloss
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
    // Headword cpcd size — "md" for the bottom sheet, "sm" for the centered popup.
    cpcdSize?: CPCDSize;
    // Speaker; undefined hides it.
    onSpeak?: (entry: VocabEntry) => void;
    // Text currently narrated by useTTS — the speaker spins when it is this entry.
    speakingKey?: string | null;
    // The Learning TOGGLE (glowing "+" ⇄ "Added!", useLearningToggle) for the entry
    // showing, in the slot under the speaker. Adding a word is a DICTIONARY-flow action
    // only: the dictionary cdp passes this; the Dictionary page's eip draws its Add key
    // in the trail row instead (EipAddKey). The flp's add-only "+" was removed 2026-10-29.
    learning?: LearningToggleState;
    // Index into sortedSenseClusters(entry); drives the reading, the dd of a word without a
    // sense list, and which item of the sense list is underlined. The list is DISPLAY-ONLY
    // (owner's call 2026-10-29): the pick is made on the card face's SensePicker.
    selectedSenseIndex?: number;
    // The Dictionary eip (EipSheet `showAllDefinitions`, owner's call 2026-10-29): the gloss
    // is the WHOLE flat `definitions` list joined with spaced middle dots — a lookup, not a
    // card, so every meaning is shown — on up to TWO lines, swiping sideways (both lines
    // together, rubber-banding at the ends) only when two lines overflow
    // (SwipeableTwoLineText). With every sense on screen there is
    // no chosen sense to mark, so the pinyin is the default
    // reading (resolveDefaultPronunciation, as on the search row). Falls back to the dd when
    // the entry carries no list (a vet row). Docs: docs/SHELF_REDESIGN.md § 7b.
    showAllDefinitions?: boolean;
}

// The headword keycap's lip, and how far it sinks when pressed.
const TILE_LIP = 4;

// The starred default's icon (the SensePicker's star, same size) and the gap after it —
// the star LEADS the gloss here (owner's call 2026-10-30). Their sum is the `leadingWidth` SwipeableTwoLineText adds when it measures a line.
const SENSE_STAR_SIZE = 13;
const SENSE_STAR_GAP = 3;

// Space between the headword cpcd and the speaker / Learning stack. Near zero on
// purpose: the stack should hug the headword so the dd gets the width (see the
// `.mobile-demo-eic-headword-group` wrapper below).
const HEADWORD_ACTIONS_GAP = 2;

const EipEntryHeader: React.FC<EipEntryHeaderProps> = ({
    entry,
    showPinyinColor = true,
    cpcdSize = "md",
    onSpeak,
    speakingKey,
    learning,
    selectedSenseIndex,
    showAllDefinitions = false,
    className,
    ...rest
}) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    const colors = useEipColors();
    // `showAllDefinitions`: the glosses to lay out, or null when there are none (a vet row
    // falls back to the dd). Memoized: SwipeableTwoLineText re-measures when it changes.
    const allDefinitions = useMemo(() => {
        if (!showAllDefinitions) return null;
        const items = definitionListItems(entry?.definitions);
        return items.length > 0 ? items : null;
    }, [showAllDefinitions, entry?.definitions]);
    // Every other host: a word with a real choice of sense (≥2 displayable clusters, the
    // SensePicker's own gate) lists each sense's dd, in the picker's order, so index 0 is
    // the starred default and `selectedSenseIndex` addresses the same item the card face's
    // picker chose. The chosen sense is underlined; the default carries the star, drawn in
    // the gloss's own colour (`inherit`) so it follows the dd colour and the night palette.
    // Null for a single-sense / unclustered word, which keeps the plain dd.
    const senseClusters = useMemo(
        () => (showAllDefinitions || !entry ? null : sortedSenseClusters(entry)),
        [showAllDefinitions, entry],
    );
    // No override → the persisted pick, exactly as the dd/pinyin resolvers fall back.
    const underlinedSenseIndex = selectedSenseIndex ?? (entry ? resolveSelectedSenseIndex(entry) : 0);
    const senseSegments = useMemo<TwoLineSegment[] | null>(() => senseClusters?.map((cluster, index) => ({
        text: ddt(cluster),
        className: index === underlinedSenseIndex ? "mobile-demo-eic-sense mobile-demo-eic-sense--selected" : "mobile-demo-eic-sense",
        ...(index === 0 && {
            leading: (
                <Icon
                    name="star"
                    size={SENSE_STAR_SIZE}
                    fill={1}
                    color="inherit"
                    className="mobile-demo-eic-sense-star"
                    sx={{ marginRight: `${SENSE_STAR_GAP}px`, verticalAlign: "-1px" }}
                />
            ),
            leadingWidth: SENSE_STAR_SIZE + SENSE_STAR_GAP,
        }),
    })) ?? null, [senseClusters, underlinedSenseIndex]);
    // The keycap's 1px outline: the app's border token by day, a faint white ring at night.
    const tileRing = `inset 0 0 0 1px ${colors.dark ? "rgba(255, 255, 255, 0.12)" : COLORS.border}`;
    // A tap on the keycap's PADDING (outside the cpcd row) still copies: forward it as a
    // click on the row, so CPCDRow's tap-to-copy — and its characters ⇄ pinyin alternation
    // and confirmation caption — stays the one implementation. A tap ON the row is already
    // handled there and bubbles up here, so it is skipped.
    const copyFromTile = (e: React.MouseEvent<HTMLElement>) => {
        if ((e.target as Element).closest(".cpcd-row")) return;
        e.currentTarget.querySelector<HTMLElement>(".cpcd-row")?.click();
    };
    // `.eid` — the gloss's type, shared by the dd and the all-definitions line.
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
        // follows the account's Chinese typeface (users."chineseFont",
        // written by useChineseFont) exactly like the flp card face's dd
        // in card/CardFace.tsx, so the two glosses read as the same text.
        fontFamily: FC_FONT_CJK,
        lineHeight: 1.25,
    } as const;

    return (
        <InfoSheetEntryHeader
            className={["mobile-demo-eic-header", className].filter(Boolean).join(" ")}
            {...rest}
        >
            {/* Headword + action stack as ONE tight group: the stack hugs the cpcd
                (HEADWORD_ACTIONS_GAP) instead of taking the header's full 14px gap, so
                the width it gives back goes to the dd. The header's gap now only
                separates this group from the dd row. The md cpcd cell already carries
                ~7px of side slack around its glyph, so a near-zero gap still reads as
                breathing room, not a collision. */}
            <Box
                className="mobile-demo-eic-headword-group"
                sx={{ display: "flex", alignItems: "center", gap: `${HEADWORD_ACTIONS_GAP}px`, flexShrink: 0 }}
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
                            minWidth: 76,
                            minHeight: 76,
                            padding: "8px 10px",
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
                                restShadow: `${tileRing}, 0 ${TILE_LIP}px 0 ${colors.edge}`,
                                pressedShadow: tileRing,
                                pressedY: TILE_LIP,
                            }),
                        }}
                    >
                    <ForeignText
                        size={cpcdSize}
                        justifyContent="flex-start"
                        className="mobile-demo-eic-header-cpcd"
                        text={entry.entryKey}
                        // Sense-resolved, like the dd printed beside it. The panel's own live
                        // pick is the override so the reading changes on the tap, ahead of the
                        // persisted `selectedSense` round-tripping back (useEipTabs.syncEntry).
                        pronunciation={allDefinitions !== null ? resolveDefaultPronunciation(entry) : resolveDisplayPronunciation(entry, selectedSenseIndex)}
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
                {/* Header actions — a VERTICAL STACK: Speaker on top, the Learning control
                    under it (2026-10-10; was a 2-column grid, Speaker · Add). Either may be
                    absent — Speaker needs onSpeak; the Learning slot needs `learning` (the
                    compact glowing "+" ⇄ "Added!" toggle, LearningToggle).
                    The header keeps ONLY the actions that are about the ENTRY ITSELF —
                    hear it, save it. CARD operations have left the panel for good: the
                    artboards make it information-only, so add-to-deck went onto the card's
                    own `•••` rail and Practice Writing onto the word-tools rail.
                    `InfoCardActionBar`, which used to carry all three at the end of the
                    definition tab, is deleted. Compare lives ONLY on `WordToolsRail`
                    (removed from this header 2026-09-04).

                    Sits immediately after the headword rather than at the far right,
                    because the far right now belongs to the sense chip — reading order
                    is identity (word, how to hear it) → meaning → which sense. */}
                {entry && (
                    onSpeak ||
                    learning?.available
                ) && (
                    <Box
                        className="mobile-demo-eic-actions"
                        sx={{
                            display: "flex",
                            flexDirection: "column",
                            // Left-justified (2026-10-10; was centered): the speaker and the
                            // "+" / "Added!" toggle share a left edge, so the wider "Added!"
                            // pill hangs off to the right instead of straddling the speaker.
                            alignItems: "flex-start",
                            gap: "2px",
                            flexShrink: 0,
                        }}
                    >
                        {onSpeak && (
                            <SpeakerButton
                                onClick={() => onSpeak(entry)}
                                isLoading={speakingKey === entry.entryKey}
                            />
                        )}
                        {learning && <LearningToggle state={learning} />}
                    </Box>
                )}
            </Box>
            {/* `.eid` — the gloss, centered in the space beside the headword.
                Three forms: the Dictionary eip's whole flat `definitions` list; the
                per-sense list (every sense's dd, dot-separated, the chosen one
                underlined and the default starred — the same senses, order and star the
                card face's SensePicker offers, so the panel names the pick without being
                a second place to make it); or, for a single-sense word, the plain dd.
                Both lists share SwipeableTwoLineText's two-line / swipe layout. */}
            {entry && (
                <Box
                    className="mobile-demo-eic-header-english-row"
                    sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1, minWidth: 0 }}
                >
                {allDefinitions !== null ? (
                    <SwipeableTwoLineText
                        className="mobile-demo-eic-header-english mobile-demo-eic-header-english--all-definitions"
                        segments={allDefinitions}
                        separator={DEFINITION_LIST_SEPARATOR}
                        // Vertical drags on the header belong to the sheet's resize gesture
                        // (EipUpperPanel), so only the sideways pan is the text's — as for the
                        // word trail.
                        touchAction="pan-x"
                        // Centered while it fits, start-first once it overflows.
                        align="center"
                        sx={glossSx}
                    />
                ) : senseSegments !== null ? (
                    <SwipeableTwoLineText
                        className="mobile-demo-eic-header-english mobile-demo-eic-header-english--senses"
                        segments={senseSegments}
                        separator={DEFINITION_LIST_SEPARATOR}
                        touchAction="pan-x"
                        align="center"
                        sx={{
                            ...glossSx,
                            // The chosen sense: underlined in the palette's muted ink, quieter
                            // than the gloss itself (owner's pick 2026-10-29). The offset clears
                            // descenders; it stays inside the line box, which the scroller clips.
                            "& .mobile-demo-eic-sense--selected": {
                                textDecorationLine: "underline",
                                textDecorationColor: colors.muted,
                                textDecorationThickness: "1.5px",
                                textUnderlineOffset: "2px",
                            },
                        }}
                    />
                ) : (
                <Typography
                    className="mobile-demo-eic-header-english"
                    sx={glossSx}
                >
                    {/* The eip header gloss is a dd: it must agree with the flashcard face,
                        so it resolves through the shared resolver (chosen sense →
                        definitions[0] fallback) instead of reading definitions[0] directly. */}
                    {resolveDisplayDefinition(entry, selectedSenseIndex)}
                </Typography>
                )}
                </Box>
            )}
        </InfoSheetEntryHeader>
    );
};

export default EipEntryHeader;
