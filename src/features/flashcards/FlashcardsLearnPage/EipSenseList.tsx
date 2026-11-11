import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, useTheme } from "@mui/material";
import { resolveDisplayPronunciation, sortedSenseClusters } from "../../../utils/definitionUtils";
import CpcdPopup from "../../../components/CpcdPopup";
import { CommonalityMeter } from "../../../components/ScoreMeters";
import { COLORS } from "../../../theme/colors";
import { getToneColor } from "../../../utils/toneColors";
import { buildSenseSegments, senseSelectedUnderlineSx, SENSE_STAR_GAP } from "../../../components/senseListSegments";
import { ddTextColor } from "../../../utils/cardTextColor";
import { FC_FONT_CJK } from "../constants";
import EipSectionLabel from "../EipSectionLabel";
import { SIZE, WEIGHT } from "../../../theme/scale";
import GlossText from "../../../components/GlossText";
import type { VocabEntry } from "../types";

/**
 * EipSenseList — a multi-sense word's dd list ("Other Translations") as a NUMBERED list at the top of the eip's
 * Definition tab, on EVERY eip host (owner's call 2026-11-05: Dictionary first, then all
 * eips). It replaced the swipeable dot-separated list the eip header used to draw; the header
 * now shows one dd (EipEntryHeader). Mounted by InfoCardTabContent (tab 0).
 *
 * Same senses, order and stars as the card face's SensePicker and Memory Map's prompt — the
 * cells are built by the shared `buildSenseSegments`, the pick marked by the shared
 * `senseSelectedUnderlineSx`. Numbered 1…n in `sortedSenseClusters` order and filled
 * column-major — DOWN the left column, then the right, like a printed dictionary — so the
 * default and the most common senses sit together in the left column (owner's call
 * 2026-11-07; before that one sense per row, 2026-11-05). Titled "Other Translations" in
 * the eip's shared section-label style (`EipSectionLabel`, the Synonyms + Related labels'
 * treatment; owner's call 2026-11-07). Two columns only from 5 senses up
 * (`TWO_COLUMN_MIN_SENSES`); a 2–4-sense list stays one numbered column. A starred sense
 * keeps its star, TRAILING the gloss here (owner's call 2026-11-07) — `buildSenseSegments` hands it over as
 * `leading`, so this list moves it to the end and flips its gap (Memory Map's prompt still
 * leads with it). The star is glued to the gloss's last word (`glossHeadAndLastWord`), so it
 * never wraps onto a line alone (owner's call 2026-11-10). The number is the position; the star still means "default or very common".
 * The pick is made on a card face's SensePicker, never here.
 *
 * ── Alternate pinyin, inline (owner's call 2026-11-10) ────────────────────────
 * A sense whose reading differs from the headword's prints it at the END of its entry
 * (after the star). With the learner's tone-colour setting on (`showPinyinColor`, the same
 * flag the header's cpcd honours) each syllable takes its tone colour, split the way the
 * SensePicker's reading headings are (inline spans, not `TonedPronunciation`, whose flex
 * box would turn the inline tap target below into a block); off, it is muted ink. "Differs" compares two `resolveDisplayPronunciation`
 * results (the row's index vs `selectedSenseIndex`, which is exactly what EipEntryHeader
 * prints), so the syllable-count guard and column fallback apply to both sides alike.
 *
 * ── Tap a sense's TEXT → its commonality (owner's call 2026-11-10) ────────────
 * The tap target is the entry's text only — gloss, star and inline pinyin, one INLINE span
 * (`.eip-sense-list__tap`), so its hit area is the glyphs' line boxes: the number, the
 * gap and the white space right of a short or wrapped gloss do nothing. A tap opens the
 * eip's popup box (the est's `CpcdPopup`) over that text with the SENSE's commonality as
 * the five-circle meter (icons only, like DefinitionFacts). The tap does NOT change the
 * pick. While open, the tapped text is drawn in Red Salmon (`COLORS.keywordInk`) — except
 * tone-coloured pinyin, which keeps its tones (the setting wins). It closes
 * on a tap anywhere but a sense's text or the popup (row white space included), a second
 * tap on the same text, any scroll, or a change of entry; tapping another sense's text
 * moves it there. A tap ON the popup is forwarded to the sense text beneath it, if any
 * (found with `elementsFromPoint`, so a tap over a covered sense acts as a tap on that
 * sense); over anything else it just closes the popup — never passed through to whatever
 * control sits behind it. A null cluster score (0 discoverable zh senses on 2026-11-10) gets an
 * empty popup, a guard only.
 *
 * Renders nothing for a single-sense / unclustered word (sortedSenseClusters → null): the
 * header's one dd already says everything.
 *
 * Layer: feature component (src/features/flashcards). Docs: docs/SHELF_REDESIGN.md § 7b,
 * docs/DEFINITION_CLUSTERS.md (eip sense list).
 */

interface EipSenseListProps {
    entry: VocabEntry;
    // Index into sortedSenseClusters(entry) to underline. Undefined → nothing underlined
    // (the host has no pick to name; EipEntryHeader's `selectedSenseIndex` rule).
    selectedSenseIndex?: number;
    // The learner's tone-colour setting (the header cpcd's `useToneColor`). Default on,
    // matching EipEntryHeader's `showPinyinColor` default.
    showPinyinColor?: boolean;
}

// The sense count at which the list splits into two columns; below it, one sense per row.
const TWO_COLUMN_MIN_SENSES = 5;

/**
 * A gloss split at its LAST space: everything up to and including that space, and the
 * final word. The starred row wraps `lastWord` together with the star (no-wrap), so the
 * star can never land alone on a new line. A one-word gloss has an empty `head`. The
 * space stays on `head` so the pick's underline is unbroken across the join.
 */
function glossHeadAndLastWord(text: string): { head: string; lastWord: string } {
    const trimmed = text.trimEnd();
    const cut = trimmed.lastIndexOf(" ");
    return cut < 0 ? { head: "", lastWord: trimmed } : { head: trimmed.slice(0, cut + 1), lastWord: trimmed.slice(cut + 1) };
}

// The tapped sense whose facts the popup shows, and the gloss span it floats above.
interface OpenSense {
    index: number;
    anchorEl: HTMLElement;
}

const EipSenseList: React.FC<EipSenseListProps> = ({ entry, selectedSenseIndex, showPinyinColor = true }) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    const clusters = useMemo(() => sortedSenseClusters(entry), [entry]);
    const segments = useMemo(
        () => (clusters ? buildSenseSegments(clusters, selectedSenseIndex ?? null, "eip-sense-list__sense") : null),
        [clusters, selectedSenseIndex]
    );

    const [openSense, setOpenSense] = useState<OpenSense | null>(null);
    const popupRef = useRef<HTMLDivElement>(null);

    // A new word (the eip navigated, or the card advanced) closes the popup: its index
    // would otherwise point into the NEW word's senses. Keyed on the word, not the object,
    // so a parent re-render handing over a fresh copy of the same entry leaves it open.
    useEffect(() => setOpenSense(null), [entry.entryKey, entry.language]);

    // While open: a tap on anything but a sense's text or the popup closes it — row white
    // space included, since it is not a tap target (capture phase, so a
    // child's stopPropagation cannot hide the tap — the est's rule), and so does any scroll
    // (capture catches the eip pane's own scroll, which does not bubble), since the popup
    // would otherwise ride its gloss out from under the pane's clipped edge.
    useEffect(() => {
        if (!openSense) return;
        const close = () => setOpenSense(null);
        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as Element | null;
            // A tap on another sense's text is left to its click, which moves the popup.
            if (target?.closest?.(".eip-sense-list__tap") || popupRef.current?.contains(target)) return;
            close();
        };
        document.addEventListener("pointerdown", handlePointerDown, true);
        document.addEventListener("scroll", close, true);
        return () => {
            document.removeEventListener("pointerdown", handlePointerDown, true);
            document.removeEventListener("scroll", close, true);
        };
    }, [openSense]);

    if (!segments || !clusters) return null;

    // A text tap toggles: the same sense closes the popup, another sense moves it there.
    // The popup anchors to the tapped text span itself.
    const handleSenseTap = (index: number, text: HTMLElement) => {
        setOpenSense(openSense?.index === index ? null : { index, anchorEl: text });
    };

    // A tap on the popup → a tap on the sense text under that point, if there is one;
    // otherwise the popup closes. Looked up by hit-test rather than by making the popup
    // pointer-transparent, so a tap over a non-sense control (the header's buttons, a tab)
    // cannot leak through to it.
    const handlePopupTap = (clientX: number, clientY: number) => {
        const popup = popupRef.current;
        const beneath = document
            .elementsFromPoint(clientX, clientY)
            .find((el) => !popup?.contains(el))
            ?.closest<HTMLElement>(".eip-sense-list__tap");
        const index = beneath ? Number(beneath.dataset.senseIndex) : NaN;
        if (beneath && Number.isInteger(index)) handleSenseTap(index, beneath);
        else setOpenSense(null);
    };

    const openScore = openSense ? (clusters[openSense.index]?.frequencyScore ?? null) : null;
    // Each sense's inline pinyin: only when it differs from the headword's (header note);
    // `resolveDisplayPronunciation` with `selectedSenseIndex` IS the header's.
    const headwordPinyin = resolveDisplayPronunciation(entry, selectedSenseIndex);
    const alternatePinyinFor = (index: number): string | null => {
        const sensePinyin = resolveDisplayPronunciation(entry, index);
        return sensePinyin && sensePinyin !== headwordPinyin ? sensePinyin : null;
    };

    // Two columns only from TWO_COLUMN_MIN_SENSES senses up; a 2–4-sense list stays one
    // column (owner's call 2026-11-07). Column-major fill: a fixed row count (the left
    // column takes the odd one out) with `gridAutoFlow: "column"` sends items down the left
    // column before the right.
    const columnCount = segments.length >= TWO_COLUMN_MIN_SENSES ? 2 : 1;
    const rowCount = Math.ceil(segments.length / columnCount);
    // Every number gets the same width (widest label, tabular digits), so the glosses start
    // on one edge within each column even once the count reaches two digits.
    const numberWidth = `${String(segments.length).length + 1}ch`;

    return (
        // The section: title + list, ruled off from the definition paragraph below, the way
        // the Synonyms + Related section is ruled off from the facts above it.
        <Box
            component="section"
            className="eip-sense-list-section"
            sx={{
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                paddingBottom: "13px",
                marginBottom: "13px",
                borderBottom: `1px solid ${fc.border}`,
            }}
        >
            <EipSectionLabel className="eip-sense-list__title">Other Translations</EipSectionLabel>
            <Box
                className="eip-sense-list"
                component="ol"
                sx={{
                    listStyle: "none",
                    margin: 0,
                    padding: 0,
                    display: "grid",
                    gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                    gridTemplateRows: `repeat(${rowCount}, auto)`,
                    gridAutoFlow: "column",
                    columnGap: "16px",
                    rowGap: "8px",
                    alignItems: "start",
                    // The dd's type (EipEntryHeader's `.eid`), one step smaller for a list.
                    fontFamily: FC_FONT_CJK,
                    fontSize: SIZE.bodyLg,
                    fontWeight: WEIGHT.regular,
                    lineHeight: 1.3,
                    color: ddTextColor(entry.language, undefined, fc),
                    "& .eip-sense-list__sense--selected .eip-sense-list__gloss": senseSelectedUnderlineSx(
                        fc.textSecondary
                    ),
                    // The star trails the gloss in this list, so its gap moves from its right
                    // (the shared leading-star margin) to its left.
                    "& .eip-sense-list__sense-star": { marginRight: 0, marginLeft: `${SENSE_STAR_GAP}px` },
                    // The tapped text whose popup is open — gloss, star and pinyin — in Red Salmon.
                    "& .eip-sense-list__tap--open, & .eip-sense-list__tap--open .eip-sense-list__pinyin": {
                        color: COLORS.keywordInk,
                    },
                }}
            >
                {segments.map((segment, index) => {
                    const isOpen = openSense?.index === index;
                    const alternatePinyin = alternatePinyinFor(index);
                    // Split once per row: the starred branch below glues the last word to the star.
                    const { head: glossHead, lastWord: glossLastWord } = glossHeadAndLastWord(segment.text);
                    return (
                        <Box
                            component="li"
                            key={index}
                            className={`eip-sense-list__row ${segment.className ?? ""}`}
                            // Hanging indent: the number is its own column, so a wrapped gloss's
                            // second line aligns under the first line's text, not under the number.
                            sx={{ display: "flex", alignItems: "baseline", minWidth: 0 }}
                        >
                            <Box
                                component="span"
                                className="eip-sense-list__number"
                                aria-hidden
                                sx={{
                                    flexShrink: 0,
                                    width: numberWidth,
                                    marginRight: "4px",
                                    textAlign: "right",
                                    fontVariantNumeric: "tabular-nums",
                                    // Muted ink, like the pick's underline: the number is a position
                                    // marker, quieter than the gloss it labels.
                                    color: fc.textSecondary,
                                }}
                            >
                                {index + 1}.
                            </Box>
                            <Box
                                component="span"
                                className="eip-sense-list__body"
                                sx={{ minWidth: 0, overflowWrap: "anywhere" }}
                            >
                                {/* The tap target: an INLINE span, so only the text's own line
                                    boxes are hit — never the row's white space (header note). */}
                                <span
                                    className={`eip-sense-list__tap${isOpen ? " eip-sense-list__tap--open" : ""}`}
                                    data-sense-index={index}
                                    role="button"
                                    tabIndex={0}
                                    aria-expanded={isOpen}
                                    style={{ cursor: "pointer" }}
                                    onClick={(event) => handleSenseTap(index, event.currentTarget)}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter" || event.key === " ") {
                                            event.preventDefault();
                                            handleSenseTap(index, event.currentTarget);
                                        }
                                    }}
                                >
                                    {segment.leading ? (
                                        // A starred sense: the star never wraps onto a line of
                                        // its own. Its gloss's LAST word and the star share one
                                        // `nowrap` span, so the star stays at the line's end when
                                        // it fits and otherwise carries that word down with it
                                        // (owner's call 2026-11-10). Both text pieces keep the
                                        // `__gloss` class so the pick's underline runs across
                                        // them and stops short of the star.
                                        <>
                                            {glossHead && (
                                                <span className="eip-sense-list__gloss">
                                                    <GlossText text={glossHead} pos={clusters[index]?.pos} />
                                                </span>
                                            )}
                                            <span className="eip-sense-list__last-word-with-star" style={{ whiteSpace: "nowrap" }}>
                                                <span className="eip-sense-list__gloss">
                                                    {glossLastWord}
                                                </span>
                                                {/* The star AFTER the word (see the header comment). */}
                                                {segment.leading}
                                            </span>
                                        </>
                                    ) : (
                                        <span className="eip-sense-list__gloss">{segment.content ?? segment.text}</span>
                                    )}
                                    {/* This sense's own reading, last, when it differs from the headword's. */}
                                    {alternatePinyin && (
                                        <Box
                                            component="span"
                                            className="eip-sense-list__pinyin"
                                            sx={{
                                                marginLeft: "6px",
                                                fontSize: SIZE.body,
                                                color: fc.textSecondary,
                                                // Keep a two-syllable reading on one line.
                                                whiteSpace: "nowrap",
                                            }}
                                        >
                                            {showPinyinColor
                                                // One span per syllable: `getToneColor` reads one
                                                // syllable's diacritic, so the whole string cannot
                                                // be coloured at once.
                                                ? alternatePinyin.split(/\s+/).filter(Boolean).map((syllable, si) => (
                                                    <React.Fragment key={si}>
                                                        {si > 0 && " "}
                                                        <span
                                                            className="eip-sense-list__pinyin-syllable"
                                                            style={{ color: getToneColor(syllable) }}
                                                        >
                                                            {syllable}
                                                        </span>
                                                    </React.Fragment>
                                                ))
                                                : alternatePinyin}
                                        </Box>
                                    )}
                                </span>
                            </Box>
                        </Box>
                    );
                })}
            </Box>
            {/* The tapped sense's facts, in the eip's popup box (header note). */}
            <CpcdPopup
                open={openSense != null}
                anchorEl={openSense?.anchorEl ?? null}
                cardRef={popupRef}
                // Another sense's tap replays the grow-in there, rather than sliding over.
                contentKey={openSense?.index}
                className="eip-sense-facts-popup"
                // Act on pointerup, and preventDefault on pointerdown to suppress the touch
                // compatibility click: once the popup moves or closes, that ghost click
                // would land on whatever is now under the finger (the est's rule,
                // SegmentedSentenceDisplay).
                onPointerDown={(event) => event.preventDefault()}
                onPointerUp={(event) => {
                    event.preventDefault();
                    handlePopupTap(event.clientX, event.clientY);
                }}
            >
                {openScore != null && (
                    <Box
                        className="eip-sense-facts-popup__facts"
                        sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}
                    >
                        <CommonalityMeter
                            className="eip-sense-facts-popup__commonality-meter"
                            // DefinitionFacts' size; currentColor follows the popup's ink
                            // (light, or the dark eip's CpcdPopupTones).
                            unitSize={12}
                            score={openScore}
                            filledColor="currentColor"
                            emptyColor="currentColor"
                        />
                    </Box>
                )}
            </CpcdPopup>
        </Box>
    );
};

export default EipSenseList;
