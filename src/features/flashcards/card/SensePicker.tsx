import React from "react";
import { Box, Fade, ListSubheader, Menu, MenuItem, Typography } from "@mui/material";
import Icon from "../../../components/Icon";
import { COLORS } from "../../../theme/colors";
import { FONTS, DATA_TYPE } from "../../../theme/fonts";
import { SHADOW } from "../../../theme/shadows";
import { TOWER_PLATE_PRINT } from "../../../theme/towerPlate";
import { frameOverlayHost } from "../../../components/overlayHost";
import { ddt, isStarredSense, senseGrammarTag, sortedSenseClusters } from "../../../utils/definitionUtils";
import { numberedToTonedPinyin } from "../../../utils/textUtils";
import { getToneColor } from "../../../utils/toneColors";
import GlossText from "../../../components/GlossText";
import { CommonalityMeter } from "../../../components/ScoreMeters";
import { SIZE, WEIGHT } from "../../../theme/scale";
import type { VocabEntry } from "../types";
import type { DefinitionCluster } from "../../../types";

/**
 * SensePicker — the shared definition-cluster ("sense") chooser.
 *
 * ONE component, every surface, two states (the design's `.ssel` / `.ssheet`,
 * artboards 19–25):
 *
 *   RESTING (`.ssel`) — a counter and a triangle in a small pill, sitting directly
 *       under the gloss. It is a set-and-forget control, so at rest it takes the least
 *       room that still says "this word has nine meanings and you are on the first".
 *   OPEN (`.ssheet`) — one tap lifts a compact sheet showing EVERY sense at once,
 *       grouped under the readings that separate them, starred default first. The
 *       choice is made by comparison, in one look, and the sheet closes on the pick.
 *
 * Senses are `definitionClusters` (migration 90 — see docs/DEFINITION_CLUSTERS.md),
 * one row per cluster rendered through the ddt display transformation. Renders NOTHING
 * when the entry has no real choice (unclustered, or a single cluster), so every host
 * can drop it in unconditionally.
 *
 * ── Why its own module ────────────────────────────────────────────────────────
 * The trigger + menu (reading sections, star, grammar tags, the card-flip
 * stop-propagation) is ~120 lines of behavior that lives on the
 * flashcard face (`CardFace.EnglishBlock` — flp + saved-card cdp). (The eip header
 * used to mount it too; it now shows one dd, and since 2026-11-05 the eip lists every sense
 * as a list at the top of its Definition tab instead — EipSenseList — built from the
 * same `sortedSenseClusters` order, `ddt` labels and `isStarredSense` stars, so the two still
 * name the senses identically.)
 *
 * ── Look (2026-11-21) ───────────────────────────────────────────────────────────
 * Owner's calls, all 2026-11-21. Tried and rejected the same day: a card-stock slip sheet
 * (too dark), a chip debossed into the card's beige panel (did not read as a control), and
 * an index-card sheet (red header rule, blue rules under every sense — the senses must
 * NOT be divided from each other; only the reading groups are).
 *   - the RESTING chip is a small WHITE outlined pill (the CLAUDE.md "Buttons & cards"
 *     outline), so it reads as a tab of the white sheet it opens.
 *   - the OPEN sheet is white with TINTED READING BANDS: each reading's pinyin sits in a
 *     full-width `COLORS.header` band (`READING_BAND_FILL`) that divides one reading group
 *     from the next; the senses under it are plain rows with no dividers. No sheet header.
 *   - each sense keeps its five-dot commonality meter, but the "commonality" column label
 *     and the "N senses" count are gone (both dropped for room).
 *   - lettering: sense labels stay in FONTS.cjk (each is a candidate dd, the card gloss's
 *     face); the reading bands take the plate print (TOWER_PLATE_PRINT).
 *   - the sheet is positioned INSIDE THE PHONE FRAME (`frameAnchorPosition`), not by
 *     MUI's window-relative anchoring — see that function.
 *
 * The host owns `selectedSenseIndex` (an index into `sortedSenseClusters(entry)`)
 * and decides what a pick MEANS — the card faces persist it to the vet row's
 * `selectedSense` (migration 99).
 *
 * Referenced by docs/DEFINITION_CLUSTERS.md.
 */
export interface SensePickerProps {
    entry: VocabEntry;
    /** Index into the frequency-sorted cluster list currently shown. */
    selectedSenseIndex?: number;
    onSelectSense?: (index: number) => void;
    /** Trigger icon color — each host matches its own surrounding text. */
    color?: string;
    /**
     * When true, the zh reading headings are replaced by a fixed run of black
     * redaction bars (`RedactedReading`) — the same bars for every section.
     * Used on the FRONT/question side of a flashcard, where the card shows only
     * English and the learner is supposed to produce the Chinese — a tone-colored
     * pinyin heading would hand them the pronunciation (and the tones) for free.
     * The grouping itself is still useful (it shows which senses share a reading),
     * so only the label is censored.
     */
    censorReadings?: boolean;
    /**
     * Prefix for every emitted class name, so each host can scope its own styling
     * ("mobile-demo-flashcard-sense-trigger" on the card).
     */
    classPrefix?: string;
}

// ── Sheet tokens ───────────────────────────────────────────────────────────────

/**
 * The reading band's fill: `COLORS.header` (--header), the app's quiet neutral tint, so a
 * band reads as a group label rather than as a row, a selection (`COLORS.background`) or
 * a mastery colour.
 */
const READING_BAND_FILL = COLORS.header;

/** The open sheet's width, px — capped to the phone frame by `frameAnchorPosition`. */
const SHEET_WIDTH_PX = 262;
/** Breathing room kept between the sheet and the phone frame's edges, px. */
const FRAME_MARGIN_PX = 12;
/** Gap between the chip and the sheet, px. */
const SHEET_GAP_PX = 6;
/** Below this much room under the chip (inside the frame), the sheet opens ABOVE it. */
const MIN_ROOM_BELOW_PX = 220;

interface SheetPlacement {
    /** Viewport coords of the sheet's anchor point (MUI `anchorPosition`). */
    top: number;
    left: number;
    /** Opens upward: the anchor is the sheet's BOTTOM-left corner. */
    above: boolean;
    width: number;
    maxHeight: number;
}

/**
 * Where the sheet goes, computed against the PHONE FRAME rather than the window.
 *
 * MUI's Menu portals to `body` and keeps its paper on screen by clamping to
 * `window.innerWidth/innerHeight`. On mobile that is the same box as the frame; on
 * desktop the frame is a 402px card centred in the window (MobileDemoFrame), so a sheet
 * anchored to a chip near the card's right edge hung off the phone (found 2026-11-21).
 * So: centre the sheet under the chip, clamp it horizontally into the frame (less
 * FRAME_MARGIN_PX), open it above the chip when the room below is short, and cap its
 * height to whatever room remains (the Paper scrolls past that).
 */
function frameAnchorPosition(chip: HTMLElement): SheetPlacement {
    const chipRect = chip.getBoundingClientRect();
    const frame = frameOverlayHost(chip);
    const frameRect = frame === document.body
        ? new DOMRect(0, 0, window.innerWidth, window.innerHeight)
        : frame.getBoundingClientRect();
    const width = Math.min(SHEET_WIDTH_PX, frameRect.width - 2 * FRAME_MARGIN_PX);
    const centred = chipRect.left + chipRect.width / 2 - width / 2;
    const left = Math.min(
        Math.max(centred, frameRect.left + FRAME_MARGIN_PX),
        frameRect.right - FRAME_MARGIN_PX - width,
    );
    const roomBelow = frameRect.bottom - FRAME_MARGIN_PX - (chipRect.bottom + SHEET_GAP_PX);
    const roomAbove = chipRect.top - SHEET_GAP_PX - (frameRect.top + FRAME_MARGIN_PX);
    const above = roomBelow < MIN_ROOM_BELOW_PX && roomAbove > roomBelow;
    return above
        ? { top: chipRect.top - SHEET_GAP_PX, left, above, width, maxHeight: roomAbove }
        : { top: chipRect.bottom + SHEET_GAP_PX, left, above, width, maxHeight: roomBelow };
}

/**
 * Front/question side: the reading is the answer, so each section's heading is a fixed
 * run of black redaction bars instead of pinyin. The SAME bars for every section —
 * sizing them to the reading would leak its syllable count. The grouping alone still
 * shows which senses share a reading.
 */
const REDACTION_BAR_WIDTHS_PX = [22, 14];
const RedactedReading: React.FC<{ className: string }> = ({ className }) => (
    <Box component="span" className={className} aria-label="Reading hidden" sx={{ display: "inline-flex", gap: "3px", verticalAlign: "middle" }}>
        {REDACTION_BAR_WIDTHS_PX.map((w, i) => (
            <Box key={i} component="span" sx={{ width: w, height: 9, borderRadius: "1.5px", backgroundColor: COLORS.onSurface }} />
        ))}
    </Box>
);

/** Plate print at sheet scale — the reading bands. */
const SHEET_PRINT_SX = {
    ...TOWER_PLATE_PRINT,
    fontSize: SIZE.micro,
    lineHeight: 1.3,
} as const;

const SensePicker: React.FC<SensePickerProps> = ({
    entry,
    selectedSenseIndex = 0,
    onSelectSense,
    color,
    censorReadings = false,
    classPrefix = "mobile-demo-flashcard",
}) => {
    // The open sheet's frame-clamped placement (null = closed). Measured once on the tap;
    // the card does not move while the sheet is up (the backdrop swallows gestures).
    const [placement, setPlacement] = React.useState<SheetPlacement | null>(null);

    // A picker only makes sense with a real choice — a single-cluster (or unclustered)
    // entry renders nothing and its host falls back to the plain definitions[0] dd.
    // Sorted highest conversation-frequency first (nulls last) so index 0 is always the
    // starred/default sense.
    const sortedClusters = React.useMemo(() => sortedSenseClusters(entry), [entry]);

    // The picker groups the frequency-sorted clusters into reading sections so the
    // menu reads as "these senses share this pinyin". Grouping preserves the sort:
    // readings appear in the order their first (highest-frequency) cluster does, and
    // clusters stay frequency-ordered within a section — so the starred default (the
    // global index 0) always heads the first section. Each entry keeps its original
    // index into `sortedClusters` so `selectedSenseIndex` addressing is unchanged.
    //
    // NULL when no cluster carries a reading — i.e. Spanish, whose senses are separated by
    // pos/gender rather than pronunciation (migration 123). Sectioning those would emit one
    // meaningless "—" heading over the whole list, so the render falls back to a flat list
    // and each item shows its own grammar tag instead (see senseGrammarTag).
    const senseSections = React.useMemo(() => {
        if (!sortedClusters) return null;
        if (!sortedClusters.some((c) => c.reading)) return null;
        const sections: { reading: string; items: { cluster: DefinitionCluster; index: number }[] }[] = [];
        sortedClusters.forEach((cluster, index) => {
            const reading = cluster.reading ?? '';
            let section = sections.find((s) => s.reading === reading);
            if (!section) {
                section = { reading, items: [] };
                sections.push(section);
            }
            section.items.push({ cluster, index });
        });
        return sections;
    }, [sortedClusters]);

    // Mirrors SpeakerButton: the trigger can sit inside a draggable/flippable card, so
    // press events must not bubble to the card's own touch/mouse handlers.
    const stopCardHandlers = (e: React.SyntheticEvent) => e.stopPropagation();
    const open = placement !== null;
    const close = () => setPlacement(null);

    if (!sortedClusters) return null;

    // One sense row, shared by the sectioned (zh) and flat (es) render paths so the
    // selection / star / stop-propagation behavior can't drift between them. The grammar
    // tag ("n · m") is shown only on the flat path, where nothing else distinguishes two
    // senses that happen to read the same; the zh path's reading heading already does.
    const renderSenseItem = (
        cluster: DefinitionCluster,
        index: number,
        showGrammarTag: boolean,
    ) => {
        const tag = showGrammarTag ? senseGrammarTag(cluster) : null;
        const selected = index === selectedSenseIndex;
        return (
            <MenuItem
                key={`sense-${index}`}
                selected={selected}
                // The Menu renders in a portal, but React synthetic events bubble
                // through the React tree — so a tap here would otherwise reach the
                // card's flip handlers. Stop every press event, same as the trigger.
                onClick={(e) => { stopCardHandlers(e); onSelectSense?.(index); close(); }}
                onMouseDown={stopCardHandlers}
                onTouchStart={stopCardHandlers}
                onTouchEnd={stopCardHandlers}
                className={`${classPrefix}-sense-row${selected ? ` ${classPrefix}-sense-row--selected` : ""}`}
                sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: "9px",
                    padding: "6px 14px",
                    minHeight: 0,
                    // No selected-sense styling (owner's call, 2026-11-21): the showing sense
                    // looks like every other row — the chip's `N/M` already says which one it
                    // is. MUI still sets `.Mui-selected` (kept for a11y and the class hook), so
                    // its tint is cancelled here; hover/focus fall back to the default hover.
                    "&.Mui-selected": { backgroundColor: "transparent" },
                    "&.Mui-selected:hover, &.Mui-selected.Mui-focusVisible": { backgroundColor: COLORS.rowHoverBg },
                }}
            >
                <Typography
                    component="b"
                    className={`${classPrefix}-sense-label`}
                    sx={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 12.5,
                        fontWeight: WEIGHT.medium,
                        letterSpacing: "-0.008em",
                        whiteSpace: "normal",
                        // Each label is a candidate dd, so it wears the dd's face: FONTS.cjk
                        // (`var(--cjk-font)`, the app's Chinese typeface) — the same
                        // token the flp card face and eip header dd use.
                        fontFamily: FONTS.cjk,
                    }}
                >
                    {/* `pos` narrows the italic label to this sense alone (GlossText). */}
                    <GlossText text={ddt(cluster)} pos={cluster.pos} />
                </Typography>
                {/* The star: the DEFAULT (the sense the card falls back to when the
                    learner has never picked one) plus every sense of commonality 4–5 —
                    `isStarredSense`, shared with the eip's sense list so the two
                    star the same senses. Marked on the sense itself, not in a gutter, so
                    it costs no column. Text-coloured (`inherit`, the row's ink) rather
                    than gold, matching the eip's sense list. */}
                {isStarredSense(cluster, index) && (
                    <Icon name="star" size={13} fill={1} color="inherit" className={`${classPrefix}-sense-star`} />
                )}
                {/* Per-sense commonality (the cluster's own 1–5 conversation-frequency
                    score, migration 139 / docs/DEFINITION_CLUSTERS.md) — the same meter
                    the eip and cdp show, shrunk to sheet scale. It earns its place here
                    because the zh path GROUPS by reading, so the list order is no longer
                    globally frequency-sorted. Unlabelled since 2026-11-21 (the dots read
                    as commonality on their own). Omitted, rather than shown as five hollow
                    dots, when scoring failed / never ran. */}
                {cluster.frequencyScore != null && (
                    <Box sx={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
                        <CommonalityMeter
                            className={`${classPrefix}-sense-commonality`}
                            score={cluster.frequencyScore}
                            // 8px glyphs; tight gap because the glyph carries its own bearing.
                            unitSize={8}
                            gap={1}
                            filledColor={COLORS.onSurface}
                            emptyColor={COLORS.border}
                        />
                    </Box>
                )}
                {tag && (
                    <Typography
                        className={`${classPrefix}-sense-grammar`}
                        sx={{ fontSize: SIZE.micro, color: COLORS.textSecondary, whiteSpace: "nowrap", flexShrink: 0 }}
                    >
                        {tag}
                    </Typography>
                )}
            </MenuItem>
        );
    };

    return (
        <>
            {/* RESTING state — `.ssel` (artboards 19–25). A bare triangle said "there
                is a control here" and nothing else; the counter says the two things a
                learner actually needs at rest: this word has N meanings, and you are on
                the first. That makes it a set-and-forget control — it never asks for
                attention again on a word whose sense is already settled — which is why
                it can afford to be this small. Its host places it (beside or below the
                gloss on the card face, CardFace.EnglishBlock). */}
            <Box
                component="button"
                type="button"
                className={`${classPrefix}-sense-trigger${open ? " sense-trigger--open" : ""}`}
                aria-label="Switch definition"
                aria-expanded={open}
                onClick={(e) => { stopCardHandlers(e); setPlacement(frameAnchorPosition(e.currentTarget)); }}
                onMouseDown={stopCardHandlers}
                onTouchStart={stopCardHandlers}
                onTouchEnd={stopCardHandlers}
                sx={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "1px",
                    padding: "2px 3px 2px 7px",
                    borderRadius: "999px",
                    // A white outlined pill (the CLAUDE.md "Buttons & cards" outline) — a
                    // tab of the white index-card sheet it opens. OPEN swaps the hairline
                    // for an ink ring, the app's selected-tile mark.
                    border: `1px solid ${open ? COLORS.onSurface : COLORS.border}`,
                    backgroundColor: COLORS.white,
                    cursor: "pointer",
                    flexShrink: 0,
                    lineHeight: 1,
                    "&:active": { backgroundColor: COLORS.background },
                }}
            >
                <Typography
                    component="span"
                    className={`${classPrefix}-sense-count`}
                    sx={{
                        ...DATA_TYPE,
                        fontVariantNumeric: "tabular-nums",
                        fontSize: 10,
                        letterSpacing: "0.06em",
                        color: color ?? COLORS.iconColor,
                    }}
                >
                    {selectedSenseIndex + 1}/{sortedClusters.length}
                </Typography>
                <Icon
                    name={open ? "arrow_drop_up" : "arrow_drop_down"}
                    size={16}
                    color={color ?? COLORS.iconColor}
                />
            </Box>
            {/* OPEN state — `.ssheet` (artboard 23). One tap lifts EVERY sense at once,
                grouped under the readings that separate them, starred default first.
                The choice is therefore made by COMPARING,
                in one look, rather than by paging through senses one at a time — and it
                closes on the pick, so the control goes straight back to being two glyphs
                under the gloss.

                Still a MUI `Menu` under the restyle: the portal, the anchor tracking, the
                outside-tap dismiss and the focus trap are exactly what a sheet lifted off
                a chip inside a draggable card needs, and hand-rolling them here would be
                three bugs waiting on a surface that is already gesture-heavy.

                A white sheet with tinted reading bands, placed by `frameAnchorPosition` (anchorPosition, not anchorEl)
                so it stays inside the phone frame on desktop. A short Fade replaces MUI's
                Grow. */}
            <Menu
                className={`${classPrefix}-sense-menu`}
                open={open}
                onClose={close}
                anchorReference="anchorPosition"
                anchorPosition={placement ? { top: placement.top, left: placement.left } : undefined}
                transformOrigin={{ vertical: placement?.above ? "bottom" : "top", horizontal: "left" }}
                // Our own clamp already keeps it inside the frame; MUI's window clamp
                // would only fight it.
                marginThreshold={0}
                TransitionComponent={Fade}
                transitionDuration={{ enter: 120, exit: 80 }}
                // zh: the first reading band sits flush with the sheet's top edge (the Paper's
                // radius clips it). es has no bands, so its first row gets the top padding.
                MenuListProps={{ sx: { paddingTop: senseSections ? 0 : "5px", paddingBottom: "5px" } }}
                slotProps={{
                    paper: {
                        className: `${classPrefix}-sense-sheet`,
                        sx: {
                            width: placement?.width ?? SHEET_WIDTH_PX,
                            maxHeight: placement?.maxHeight,
                            borderRadius: "16px",
                            // The CLAUDE.md "Buttons & cards" outline — the sheet is a
                            // popover surface, not a tower object.
                            border: `1px solid ${COLORS.border}`,
                            boxShadow: SHADOW.lifted,
                            backgroundColor: COLORS.white,
                            backgroundImage: "none",
                        },
                    },
                }}
                // Backdrop/paper taps also bubble through the portal to the card's
                // flip handlers — swallow them at the Menu root too.
                onClick={stopCardHandlers}
                onMouseDown={stopCardHandlers}
                onTouchStart={stopCardHandlers}
                onTouchEnd={stopCardHandlers}
            >
                {/* zh: one pinyin-labelled section per distinct reading; MUI's Menu flattens
                    this array of fragments, so ListSubheader + MenuItems render inline.
                    es: no readings to section by, so the clusters render flat with a
                    per-sense grammar tag ("n · m") carrying the disambiguation instead. */}
                {!senseSections && sortedClusters.map((cluster, index) =>
                    renderSenseItem(cluster, index, true))}
                {senseSections?.map((section) => [
                    <ListSubheader
                        key={`heading-${section.reading}`}
                        className={`${classPrefix}-sense-reading`}
                        disableSticky
                        sx={{
                            // A full-width tinted band: the reading labels its group AND
                            // divides it from the previous one — the only divider in the
                            // sheet (the senses themselves are never divided).
                            padding: "5px 14px",
                            ...SHEET_PRINT_SX,
                            // The plate print's face, weight and tracking — but NOT its
                            // upper case: pinyin is lower-case by convention and capitals
                            // crowd the tone marks.
                            textTransform: "none",
                            fontSize: 11,
                            backgroundColor: READING_BAND_FILL,
                            color: COLORS.onSurface,
                            // Breathing room above every band but the first (flush top).
                            "&:not(:first-of-type)": { marginTop: "4px" },
                        }}
                    >
                        {/* Front/question side: the reading is the answer, so it is redacted. */}
                        {censorReadings
                            ? <RedactedReading className={`${classPrefix}-sense-reading-redacted`} />
                        /* Per-syllable tone coloring, matching cpcd/pinyin elsewhere. An
                           empty reading (should not happen for a clustered zh entry) falls
                           back to a neutral em dash. */
                        : section.reading
                            ? numberedToTonedPinyin(section.reading).split(/\s+/).filter(Boolean).map((syllable, si) => (
                                <React.Fragment key={si}>
                                    {si > 0 && ' '}
                                    <span style={{ color: getToneColor(syllable) }}>{syllable}</span>
                                </React.Fragment>
                            ))
                            : <span style={{ color: COLORS.textSecondary }}>—</span>}
                    </ListSubheader>,
                    // The reading heading above already disambiguates these senses,
                    // so the per-item grammar tag would be noise here.
                    ...section.items.map(({ cluster, index }) => renderSenseItem(cluster, index, false)),
                ])}
            </Menu>
        </>
    );
};

export default SensePicker;
