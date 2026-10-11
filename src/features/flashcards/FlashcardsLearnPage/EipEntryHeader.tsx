import React from "react";
import { Box, IconButton, Typography, useTheme, type BoxProps } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { resolveDisplayDefinition, resolveDisplayPronunciation } from "../../../utils/definitionUtils";
import ForeignText, { type CPCDSize } from "../../../components/ForeignText";
import SensePicker from "../card/SensePicker";
import { ddTextColor } from "../../../utils/cardTextColor";
import { InfoSheetEntryHeader } from "./styled";
import { FC_FONT_CJK } from "../constants";
import { SIZE, WEIGHT } from "../../../theme/scale";
import { SpeakerButton } from "../../../components/SpeakerButton";
import LearnNowToggle from "../../../components/LearnNowToggle";
import type { LearnNowToggleState } from "../../../hooks/useLearnNowToggle";
import type { VocabEntry } from "../types";

// The eip's ENTRY HEADER — the band above the eip tabs: headword cpcd, speaker (+ the
// dictionary eip's "+ to Learn Now"), the showing sense's dd and the SensePicker chip.
//
// Mounted only by InfoCardPanelBody (src/features/flashcards/FlashcardsLearnPage/
// InfoCardPanelBody.tsx), and so on every eip host: the flp/scp/saved-card cdp sheet and
// the dictionary cdp's inline panel. Split out of InfoCardPanelBody to keep that file
// focused on the tab track + swipe gesture.
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
    // Add-only "+ to Learn Now" (discoverable entries only). Passed by the flp for a
    // drilled-into word not yet in Learn Now (the flp drops it once added). Superseded
    // by `learnNow` when both are given.
    onAddToLibrary?: (entry: VocabEntry) => void;
    // The Learn Now TOGGLE (glowing "+" ⇄ "Added!", useLearnNowToggle) for the entry
    // showing. Takes the slot under the speaker in place of `onAddToLibrary`. Passed by
    // the Dictionary page's eip (EipSheet) and the dictionary cdp.
    learnNow?: LearnNowToggleState;
    // Index into sortedSenseClusters(entry); drives the dd, the reading and the chip.
    selectedSenseIndex?: number;
    // A pick in the SensePicker; undefined hides the picker.
    onSelectSense?: (index: number) => void;
}

// Space between the headword cpcd and the speaker / Learn Now stack. Near zero on
// purpose: the stack should hug the headword so the dd gets the width (see the
// `.mobile-demo-eic-headword-group` wrapper below).
const HEADWORD_ACTIONS_GAP = 2;

const EipEntryHeader: React.FC<EipEntryHeaderProps> = ({
    entry,
    showPinyinColor = true,
    cpcdSize = "md",
    onSpeak,
    speakingKey,
    onAddToLibrary,
    learnNow,
    selectedSenseIndex,
    onSelectSense,
    className,
    ...rest
}) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;
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
                    <ForeignText
                        size={cpcdSize}
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
                )}
                {/* Header actions — a VERTICAL STACK: Speaker on top, the Learn Now control
                    under it (2026-10-10; was a 2-column grid, Speaker · Add). Either may be
                    absent — Speaker needs onSpeak; the Learn Now slot needs `learnNow` (the
                    compact glowing "+" ⇄ "Added!" toggle, LearnNowToggle) or, failing that,
                    the flp's add-only `onAddToLibrary` on a discoverable entry.
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
                    learnNow?.available ||
                    (onAddToLibrary && entry.discoverable)
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
                        {learnNow ? (
                            <LearnNowToggle state={learnNow} />
                        ) : onAddToLibrary && entry.discoverable && (
                            // The flp eip's add-only "+" (hidden by the flp once the word is
                            // added). Only discoverable entries can join Learn Now.
                            <IconButton
                                className="mobile-demo-eic-add-to-library"
                                size="small"
                                aria-label="Add to Learn Now"
                                onClick={(e) => {
                                    // Match SpeakerButton's stop-propagation pattern so
                                    // taps don't bubble to flip/drag handlers in any
                                    // wrapping card.
                                    e.stopPropagation();
                                    onAddToLibrary(entry);
                                }}
                                onMouseDown={(e) => e.stopPropagation()}
                                onTouchStart={(e) => e.stopPropagation()}
                                onTouchEnd={(e) => e.stopPropagation()}
                                sx={{
                                    color: fc.textSecondary,
                                    '&:hover': { color: fc.onSurface },
                                }}
                            >
                                <AddIcon fontSize="small" />
                            </IconButton>
                        )}
                    </Box>
                )}
            </Box>
            {/* `.eid` — the gloss of the SHOWING sense, right-aligned into the space
                between the headword and the sense chip, with the chip pinned to the
                far edge.

                Right-aligned on purpose: the chip is what the gloss belongs to, so
                setting the text against it reads as one statement ("this is what it
                means · sense 1 of 9") instead of two things at opposite ends of a
                rule. The chip is the SAME control, in the SAME place, on the card, the
                card detail and here — a pick made on any of them swaps everything
                below, which is why the panel needs no sense list of its own. */}
            {entry && (
                <Box
                    className="mobile-demo-eic-header-english-row"
                    sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1, minWidth: 0, justifyContent: "flex-end" }}
                >
                <Typography
                    className="mobile-demo-eic-header-english"
                    sx={{
                        flex: 1,
                        minWidth: 0,
                        textAlign: "right",
                        // The gloss is the header's payload, not a caption: 12.5 → 14.5
                        // (2026-09-04) → SIZE.bodyLg/16px → SIZE.subtitle/18px → SIZE.title/22px (2026-10-10).
                        fontSize: SIZE.title,
                        letterSpacing: "-0.008em",
                        fontWeight: WEIGHT.regular,
                        // Matches the flp card face via the shared dd color helper: zh
                        // renders at full contrast, other languages are de-emphasized one
                        // step off `onSurface` via the `dd` token.
                        // (No Contrast pick is applied here — as before, this header
                        // follows the card theme only, not the per-card override.)
                        color: ddTextColor(entry.language, undefined, fc),
                        // FC_FONT_CJK (FONTS.cjk → `var(--cjk-font)`), not FC_FONT: the dd
                        // follows the account's Chinese typeface (users."chineseFont",
                        // written by useChineseFont) exactly like the flp card face's dd
                        // in card/CardFace.tsx, so the two glosses read as the same text.
                        fontFamily: FC_FONT_CJK,
                        lineHeight: 1.35,
                    }}
                >
                    {/* The eip header gloss is a dd: it must agree with the flashcard face,
                        so it resolves through the shared resolver (chosen sense →
                        definitions[0] fallback) instead of reading definitions[0] directly. */}
                    {resolveDisplayDefinition(entry, selectedSenseIndex)}
                </Typography>
                {/* Same picker component the card face mounts (docs/DEFINITION_CLUSTERS.md).
                    Self-hides when the entry has no real choice of sense. Readings are
                    never censored here — the eip is a reference surface, not a quiz face. */}
                {onSelectSense && (
                    <SensePicker
                        entry={entry}
                        selectedSenseIndex={selectedSenseIndex}
                        onSelectSense={onSelectSense}
                        color={fc.textSecondary}
                        classPrefix="mobile-demo-eic"
                    />
                )}
                </Box>
            )}
        </InfoSheetEntryHeader>
    );
};

export default EipEntryHeader;
