import React, { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Box, useTheme } from "@mui/material";
import {
    resolveDisplayPronunciation,
    singleSenseGlossList,
    sortedSenseClusters,
} from "../utils/definitionUtils";
import CpcdPopup from "./CpcdPopup";
import { CommonalityMeter } from "./ScoreMeters";
import GlossText from "./GlossText";
import { buildSenseSegments, senseSelectedUnderlineSx, SENSE_STAR_GAP } from "./senseListSegments";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { SIZE, WEIGHT } from "../theme/scale";
import { getToneColor } from "../utils/toneColors";
import { ddTextColor } from "../utils/cardTextColor";
import type { DefinitionCluster, DictionaryEntry } from "../types";

/**
 * SenseList — a word's translations as a NUMBERED list: the eip's "Other Translations"
 * (wrapped with its label by src/features/flashcards/FlashcardsLearnPage/EipSenseList.tsx,
 * on every eip host) and the Reader's dictionary keycap (src/components/VocabDisplayCard.tsx,
 * no label). One component so the two surfaces cannot drift on layout, type or star.
 * Moved out of EipSenseList 2026-11-17, when the Reader adopted it.
 *
 * ── Which rows ────────────────────────────────────────────────────────────────
 *   * MULTI-SENSE word (`sortedSenseClusters` → ≥2 senses): one row per sense, its dd.
 *     Same senses, order and stars as the card face's SensePicker and Memory Map's prompt —
 *     the cells are built by the shared `buildSenseSegments`, the pick marked by the shared
 *     `senseSelectedUnderlineSx`.
 *   * SINGLE-SENSE / unclustered word: one row per GLOSS of that one sense
 *     (`singleSenseGlossList` — the dictionary search row's list, owner's call 2026-11-15),
 *     so 我 reads "I", "me", "my". NO row is starred and nothing is underlined: the rows are
 *     glosses of one sense, not competing senses, so there is no default to single out and
 *     they all share one commonality score (owner's call 2026-11-17).
 *     Until 2026-11-17 the eip drew NOTHING for such a word — owner's call: the list must be
 *     "the same thing as multiple senses from the user's perspective" on every surface.
 *   * Nothing to list (no glosses at all) → renders nothing, and `wrap` is not called.
 *
 * ── Layout (EipSenseList's, unchanged) ────────────────────────────────────────
 * Numbered 1…n and filled column-major — DOWN the left column, then the right, like a
 * printed dictionary (owner's call 2026-11-07). Two columns only from 5 rows up
 * (`TWO_COLUMN_MIN_SENSES`), unless the caller asks for `singleColumn` (the Reader's
 * split-screen keycap, whose halves are already narrow — src/reading/ReaderPhraseSplitFace.tsx). A starred row keeps its star TRAILING the gloss (owner's call
 * 2026-11-07) — `buildSenseSegments` hands it over as `leading`, so this list moves it to
 * the end and flips its gap — glued to the gloss's last word (`glossHeadAndLastWord`) so
 * it never wraps onto a line alone (owner's call 2026-11-10). The number is the position;
 * the star means "default or very common". The pick is made on a card face's SensePicker,
 * never here.
 *
 * ── Alternate pinyin, inline (owner's call 2026-11-10) ────────────────────────
 * A sense whose reading differs from the headword's prints it at the END of its entry
 * (after the star). With the learner's tone-colour setting on (`showPinyinColor`) each
 * syllable takes its tone colour (inline spans, not `TonedPronunciation`, whose flex box
 * would turn the inline tap target below into a block); off, it is muted ink. "Differs"
 * compares two `resolveDisplayPronunciation` results (the row's index vs
 * `selectedSenseIndex`). Multi-sense only: a single sense has one reading.
 *
 * ── Tap a row's TEXT → its commonality (owner's call 2026-11-10) ──────────────
 * The tap target is the entry's text only — gloss, star and inline pinyin, one INLINE span
 * (`.eip-sense-list__tap`), so its hit area is the glyphs' line boxes. A tap opens the
 * est's `CpcdPopup` over that text (single column: to its right, see `popupBesideText`) with the SENSE's commonality as the five-circle meter
 * (a single-sense word's rows all show that one sense's score, else the entry's). The tap
 * does NOT change the pick. While open, the tapped text is drawn in Red Salmon
 * (`COLORS.keywordInk`) — except tone-coloured pinyin. It closes on a tap anywhere but a
 * row's text or the popup, a second tap on the same text, any scroll, or a change of word;
 * tapping another row's text moves it there. A tap ON the popup is forwarded to the row
 * text beneath it, if any (`elementsFromPoint`, skipping the popup's own stack); over
 * anything else it just closes.
 *
 * Colours read the MUI theme's `flashcard` palette, so inside the eip (which re-themes it)
 * the list follows the eip's light/dark palette, and on the Reader the app's light one.
 * The class names keep their `eip-sense-list` prefix so existing styling hooks still match.
 *
 * Layer: shared component (renders only). Docs: docs/DEFINITION_CLUSTERS.md (eip sense
 * list), docs/SHELF_REDESIGN.md § 7b, docs/USER_DOCUMENT_FEATURE_SUMMARY.md § Look.
 */

/** The entry fields the list reads — satisfied by both a VocabEntry and a DictionaryEntry. */
export type SenseListEntry = Pick<DictionaryEntry, "definitionClusters"> & {
    pronunciation?: string | null;
    definitions?: string[] | null;
    language?: string | null;
    selectedSense?: string | null;
    frequencyScore?: number | null;
};

interface SenseListProps {
    entry: SenseListEntry;
    /** A stable id for the word (entryKey / word1 + language). A change closes the popup:
     *  its index would otherwise point into the NEW word's rows. Keyed on this rather than
     *  the object, so a re-render handing over a fresh copy of the same word leaves it open. */
    wordKey: string;
    /** Index into sortedSenseClusters(entry) to underline. Undefined → nothing underlined.
     *  Ignored for a single-sense word. */
    selectedSenseIndex?: number;
    /** The learner's tone-colour setting (the header cpcd's `useToneColor`). Default on. */
    showPinyinColor?: boolean;
    /** Never split into two columns, however many rows (the Reader's split-screen keycap,
     *  src/reading/ReaderPhraseSplitFace.tsx, where each half is already a narrow column). */
    singleColumn?: boolean;
    /** Wraps the list when there is one to show — the eip adds its section label and rule
     *  here. Not called when the list renders nothing, so no orphaned label is left behind. */
    wrap?: (list: ReactNode) => ReactNode;
}

// The row count at which the list splits into two columns; below it, one row per line.
const TWO_COLUMN_MIN_SENSES = 5;

/** One numbered row: the gloss (plain `text` + rendered `content`), its optional star, the
 *  marking class, and the commonality its popup shows. */
interface SenseRow {
    text: string;
    content: ReactNode;
    leading?: ReactNode;
    className: string;
    score: number | null;
}

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

/** The rows for a word (see "Which rows" in the header), or null when there is nothing to list. */
function buildSenseRows(
    entry: SenseListEntry,
    clusters: DefinitionCluster[] | null,
    selectedSenseIndex: number | undefined,
): SenseRow[] | null {
    const prefix = "eip-sense-list__sense";
    if (clusters) {
        return buildSenseSegments(clusters, selectedSenseIndex ?? null, prefix).map((segment, index) => ({
            text: segment.text,
            content: segment.content ?? segment.text,
            leading: segment.leading,
            className: segment.className ?? prefix,
            score: clusters[index]?.frequencyScore ?? null,
        }));
    }
    const glosses = singleSenseGlossList(entry);
    if (glosses.length === 0) return null;
    // The one sense, for its classifier label (GlossText) and its score.
    const lone = Array.isArray(entry.definitionClusters) ? entry.definitionClusters.find(Boolean) ?? null : null;
    const score = lone?.frequencyScore ?? entry.frequencyScore ?? null;
    return glosses.map((gloss) => ({
        text: gloss,
        content: <GlossText text={gloss} pos={lone?.pos} />,
        // No star: these are glosses of ONE sense (see "Which rows" in the header).
        className: prefix,
        score,
    }));
}

// The tapped row whose facts the popup shows, and the gloss span it floats above.
interface OpenSense {
    index: number;
    anchorEl: HTMLElement;
}

const SenseList: React.FC<SenseListProps> = ({ entry, wordKey, selectedSenseIndex, showPinyinColor = true, singleColumn = false, wrap }) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    const clusters = useMemo(() => sortedSenseClusters(entry), [entry]);
    const rows = useMemo(() => buildSenseRows(entry, clusters, selectedSenseIndex), [entry, clusters, selectedSenseIndex]);

    const [openSense, setOpenSense] = useState<OpenSense | null>(null);
    const popupRef = useRef<HTMLDivElement>(null);

    // A new word closes the popup (see `wordKey`).
    useEffect(() => setOpenSense(null), [wordKey]);

    // While open: a tap on anything but a row's text or the popup closes it (capture phase,
    // so a child's stopPropagation cannot hide the tap — the est's rule), and so does any
    // scroll (capture catches a pane's own scroll, which does not bubble), since the popup
    // would otherwise ride its gloss out from under the pane's clipped edge.
    useEffect(() => {
        if (!openSense) return;
        const close = () => setOpenSense(null);
        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as Element | null;
            // A tap on another row's text is left to its click, which moves the popup.
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

    if (!rows) return null;

    // A text tap toggles: the same row closes the popup, another row moves it there.
    const handleSenseTap = (index: number, text: HTMLElement) => {
        setOpenSense(openSense?.index === index ? null : { index, anchorEl: text });
    };

    // A tap on the popup → a tap on the row text under that point, if there is one;
    // otherwise the popup closes. Looked up by hit-test rather than by making the popup
    // pointer-transparent, so a tap over a non-list control cannot leak through to it.
    // The popup's whole stack is skipped: the card and what it holds (`popup.contains`)
    // AND its wrappers — the motion box and Popper's portal root (`el.contains(popup)`).
    // Skipping only the card's subtree used to land on those wrappers, which are no row's
    // text, so a tap over another sense just closed the popup.
    const handlePopupTap = (clientX: number, clientY: number) => {
        const popup = popupRef.current;
        const beneath = document
            .elementsFromPoint(clientX, clientY)
            .find((el) => !popup || (!popup.contains(el) && !el.contains(popup)))
            ?.closest<HTMLElement>(".eip-sense-list__tap");
        const index = beneath ? Number(beneath.dataset.senseIndex) : NaN;
        if (beneath && Number.isInteger(index)) handleSenseTap(index, beneath);
        else setOpenSense(null);
    };

    const openScore = openSense ? (rows[openSense.index]?.score ?? null) : null;
    // Each sense's inline pinyin, multi-sense only: when it differs from the headword's
    // (`resolveDisplayPronunciation` with `selectedSenseIndex` IS the eip header's).
    const headwordPinyin = clusters ? resolveDisplayPronunciation(entry, selectedSenseIndex) : null;
    const alternatePinyinFor = (index: number): string | null => {
        if (!clusters) return null;
        const sensePinyin = resolveDisplayPronunciation(entry, index);
        return sensePinyin && sensePinyin !== headwordPinyin ? sensePinyin : null;
    };

    // Two columns only from TWO_COLUMN_MIN_SENSES rows up. Column-major fill: a fixed row
    // count (the left column takes the odd one out) with `gridAutoFlow: "column"` sends
    // items down the left column before the right.
    const columnCount = !singleColumn && rows.length >= TWO_COLUMN_MIN_SENSES ? 2 : 1;
    const rowCount = Math.ceil(rows.length / columnCount);

    // Single column: the popup floats in the empty space to the RIGHT of the tapped text
    // rather than above it, where it would cover the row before (owner's call 2026-11-17).
    // It is anchored to the text's LAST line box, where the text ends — a wrapped gloss's
    // bounding box spans the full width and would leave no room on its right. Read live
    // (a virtual element), so Popper's re-placement on resize sees the current layout.
    // Two columns keep the default "above", since the right column fills that space.
    // A fresh virtual anchor per render is harmless: the popup closes on any scroll, and
    // Popper only re-measures it.
    const popupBesideText = columnCount === 1;
    const popupAnchor = openSense
        ? popupBesideText
            ? lastLineAnchor(openSense.anchorEl)
            : openSense.anchorEl
        : null;
    // Every number gets the same width (widest label, tabular digits), so the glosses start
    // on one edge within each column even once the count reaches two digits.
    const numberWidth = `${String(rows.length).length + 1}ch`;

    const list = (
        <>
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
                    // FONTS.cjk: Latin glosses that may need a CJK fallback glyph.
                    fontFamily: FONTS.cjk,
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
                {rows.map((row, index) => {
                    const isOpen = openSense?.index === index;
                    const alternatePinyin = alternatePinyinFor(index);
                    // Split once per row: the starred branch below glues the last word to the star.
                    const { head: glossHead, lastWord: glossLastWord } = glossHeadAndLastWord(row.text);
                    const pos = clusters?.[index]?.pos;
                    return (
                        <Box
                            component="li"
                            key={index}
                            className={`eip-sense-list__row ${row.className}`}
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
                                    {row.leading ? (
                                        // A starred row: the star never wraps onto a line of its
                                        // own. Its gloss's LAST word and the star share one
                                        // `nowrap` span (owner's call 2026-11-10). Both text
                                        // pieces keep the `__gloss` class so the pick's underline
                                        // runs across them and stops short of the star.
                                        <>
                                            {glossHead && (
                                                <span className="eip-sense-list__gloss">
                                                    <GlossText text={glossHead} pos={pos} />
                                                </span>
                                            )}
                                            <span className="eip-sense-list__last-word-with-star" style={{ whiteSpace: "nowrap" }}>
                                                <span className="eip-sense-list__gloss">
                                                    {glossLastWord}
                                                </span>
                                                {/* The star AFTER the word (see the header comment). */}
                                                {row.leading}
                                            </span>
                                        </>
                                    ) : (
                                        <span className="eip-sense-list__gloss">{row.content}</span>
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
            {/* The tapped row's facts, in the eip's popup box (header note). */}
            <CpcdPopup
                open={openSense != null}
                anchorEl={popupAnchor}
                placement={popupBesideText ? "right" : "top"}
                cardRef={popupRef}
                // Another row's tap replays the grow-in there, rather than sliding over.
                contentKey={openSense?.index}
                className="eip-sense-facts-popup"
                // Act on CLICK, the last event of the tap — not on pointerup. A pointerdown
                // preventDefault cancels only the compatibility mouse events, never the
                // click, so acting on pointerup let that click fire AFTER the popup had
                // moved: the card re-mounts for the new sense (`contentKey`), the click
                // fell through to the new sense's text under the finger, and its toggle
                // closed the popup that had just opened. On click the card is still the
                // target, and nothing of the tap is left to land anywhere else.
                onClick={(event) => handlePopupTap(event.clientX, event.clientY)}
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
        </>
    );

    return <>{wrap ? wrap(list) : list}</>;
};

/** A Popper virtual anchor on an inline element's last line box (its whole box when it
 *  has none, e.g. mid-unmount). See `popupBesideText`. */
function lastLineAnchor(el: HTMLElement) {
    return {
        getBoundingClientRect: () => {
            const lines = el.getClientRects();
            return lines.length > 0 ? lines[lines.length - 1] : el.getBoundingClientRect();
        },
        contextElement: el,
    };
}

export default SenseList;
