import React from "react";
import { Box, ListSubheader, Menu, MenuItem, Typography } from "@mui/material";
import Icon from "../../../components/Icon";
import { Label } from "../../../components/primitives";
import { COLORS } from "../../../theme/colors";
import { FONTS } from "../../../theme/fonts";
import { ddt, senseGrammarTag, sortedSenseClusters } from "../../../utils/definitionUtils";
import { numberedToTonedPinyin } from "../../../utils/textUtils";
import { getToneColor } from "../../../utils/toneColors";
import FrequencyScoreDots from "../../../components/FrequencyScoreDots";
import { SIZE, WEIGHT } from "../../../theme/scale";
import type { VocabEntry } from "../types";
import type { DefinitionCluster } from "../../../types";
import { SHADOW } from "../../../theme/shadows";

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
 *       grouped under the readings that separate them, starred default first,
 *       commonality beside each. The choice is made by comparison, in one look, and
 *       the sheet closes on the pick.
 *
 * Senses are `definitionClusters` (migration 90 — see docs/DEFINITION_CLUSTERS.md),
 * one row per cluster rendered through the ddt display transformation. Renders NOTHING
 * when the entry has no real choice (unclustered, or a single cluster), so every host
 * can drop it in unconditionally.
 *
 * ── Why its own module ────────────────────────────────────────────────────────
 * The trigger + menu (reading sections, star, per-sense commonality meter, grammar
 * tags, the card-flip stop-propagation) is ~120 lines of behavior that three
 * surfaces now share: the flashcard face (`CardFace.EnglishBlock`, flp + cdp) and
 * the eip definition header (`InfoCardPanelBody`). Duplicating it is how the two
 * pickers drift apart — they must offer the same senses, in the same order, with
 * the same labels.
 *
 * The host owns `selectedSenseIndex` (an index into `sortedSenseClusters(entry)`)
 * and decides what a pick MEANS — the card faces and the eip both persist it to the
 * vet row's `selectedSense` (migration 99); a dictionary-only entry with no vet row
 * simply keeps the pick in session state.
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
     * When true, the zh reading headings are replaced by neutral "Group N" labels.
     * Used on the FRONT/question side of a flashcard, where the card shows only
     * English and the learner is supposed to produce the Chinese — a tone-colored
     * pinyin heading would hand them the pronunciation (and the tones) for free.
     * The grouping itself is still useful (it shows which senses share a reading),
     * so only the label is censored.
     */
    censorReadings?: boolean;
    /**
     * Prefix for every emitted class name, so each host can scope its own styling
     * ("mobile-demo-flashcard-sense-trigger" on the card, "mobile-demo-eic-sense-…"
     * in the eip).
     */
    classPrefix?: string;
}

const SensePicker: React.FC<SensePickerProps> = ({
    entry,
    selectedSenseIndex = 0,
    onSelectSense,
    color,
    censorReadings = false,
    classPrefix = "mobile-demo-flashcard",
}) => {
    const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);

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
    const open = Boolean(anchorEl);

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
                onClick={(e) => { stopCardHandlers(e); onSelectSense?.(index); setAnchorEl(null); }}
                onMouseDown={stopCardHandlers}
                onTouchStart={stopCardHandlers}
                onTouchEnd={stopCardHandlers}
                sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: "9px",
                    padding: "6px 14px",
                    minHeight: 0,
                    "&.Mui-selected, &.Mui-selected:hover": { backgroundColor: COLORS.background },
                }}
            >
                <Typography
                    component="b"
                    className={`${classPrefix}-sense-label`}
                    sx={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 12.5,
                        // The showing sense is BOLD rather than ticked: the sheet is read
                        // by comparing every line at once, and a tick in a left gutter
                        // pushes all nine labels off their own margin to mark one of them.
                        fontWeight: selected ? WEIGHT.bold : WEIGHT.medium,
                        letterSpacing: "-0.008em",
                        whiteSpace: "normal",
                    }}
                >
                    {ddt(cluster)}
                </Typography>
                {/* The starred DEFAULT — the sense the card falls back to when the
                    learner has never picked one. Marked on the sense itself, not in a
                    gutter, so it costs no column. */}
                {index === 0 && (
                    <Icon name="star" size={13} fill={1} color="#F4A700" className={`${classPrefix}-sense-star`} />
                )}
                {/* Per-sense commonality (the cluster's own 1–5 conversation-frequency
                    score, migration 139 / docs/DEFINITION_CLUSTERS.md) — the same meter
                    the eip and cdp show, shrunk to sheet scale. It earns its place here
                    because the zh path GROUPS by reading, so the list order is no longer
                    globally frequency-sorted and the learner otherwise can't tell which of
                    two senses under different readings is the common one. Omitted (rather
                    than shown as five hollow dots) when scoring failed / never ran. */}
                {cluster.frequencyScore != null && (
                    <Box sx={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
                        <FrequencyScoreDots
                            className={`${classPrefix}-sense-commonality`}
                            score={cluster.frequencyScore}
                            dotSize={6}
                            gap={2.5}
                            filledColor={COLORS.onSurface}
                            emptyBorderColor={COLORS.border}
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
                it can afford to be this small and sit directly under the gloss on every
                surface (card, card detail, info panel). */}
            <Box
                component="button"
                type="button"
                className={`${classPrefix}-sense-trigger${open ? " sense-trigger--open" : ""}`}
                aria-label="Switch definition"
                aria-expanded={open}
                onClick={(e) => { stopCardHandlers(e); setAnchorEl(e.currentTarget); }}
                onMouseDown={stopCardHandlers}
                onTouchStart={stopCardHandlers}
                onTouchEnd={stopCardHandlers}
                sx={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "1px",
                    padding: "3px 4px 3px 8px",
                    borderRadius: "999px",
                    border: "none",
                    cursor: "pointer",
                    flexShrink: 0,
                    lineHeight: 1,
                    ...(open
                        // OPEN: inverted, so the chip reads as the sheet's own handle
                        // while the sheet is up rather than as one more thing to tap.
                        ? { backgroundColor: COLORS.onSurface, boxShadow: "none" }
                        : {
                              backgroundColor: "rgba(23,22,26,0.05)",
                              boxShadow: "inset 0 0 0 1px rgba(23,22,26,0.08)",
                          }),
                }}
            >
                <Typography
                    component="span"
                    className={`${classPrefix}-sense-count`}
                    sx={{
                        fontFamily: FONTS.mono,
                        fontVariantNumeric: "tabular-nums",
                        fontSize: 10,
                        letterSpacing: "0.06em",
                        color: open ? COLORS.white : (color ?? COLORS.iconColor),
                    }}
                >
                    {selectedSenseIndex + 1}/{sortedClusters.length}
                </Typography>
                <Icon
                    name={open ? "arrow_drop_up" : "arrow_drop_down"}
                    size={16}
                    color={open ? COLORS.white : (color ?? COLORS.iconColor)}
                />
            </Box>
            {/* OPEN state — `.ssheet` (artboard 23). One tap lifts EVERY sense at once,
                grouped under the readings that separate them, starred default first,
                commonality beside each line. The choice is therefore made by COMPARING,
                in one look, rather than by paging through senses one at a time — and it
                closes on the pick, so the control goes straight back to being two glyphs
                under the gloss.

                Still a MUI `Menu` under the restyle: the portal, the anchor tracking, the
                outside-tap dismiss and the focus trap are exactly what a sheet lifted off
                a chip inside a draggable card needs, and hand-rolling them here would be
                three bugs waiting on a surface that is already gesture-heavy. */}
            <Menu
                className={`${classPrefix}-sense-menu`}
                anchorEl={anchorEl}
                open={open}
                onClose={() => setAnchorEl(null)}
                MenuListProps={{ sx: { paddingTop: 0, paddingBottom: "5px" } }}
                slotProps={{
                    paper: {
                        sx: {
                            width: 262,
                            maxWidth: "calc(100% - 32px)",
                            borderRadius: "22px",
                            border: `1px solid ${COLORS.rowBorder}`,
                            boxShadow: SHADOW.popover,
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
                {/* `.sh` — how many senses there are, and what the right-hand column is.
                    Rendered ONCE at the top of the sheet rather than repeated over each
                    reading, which is what it used to be: a column header belongs to the
                    column, not to the first group in it. */}
                <Box
                    className={`${classPrefix}-sense-sheet-header`}
                    sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "10px",
                        padding: "11px 14px 8px",
                        borderBottom: `1px solid ${COLORS.rowBorder}`,
                    }}
                >
                    <Label>{sortedClusters.length} senses</Label>
                    {sortedClusters.some((c) => c.frequencyScore != null) && <Label>commonality</Label>}
                </Box>
                {/* zh: one pinyin-labelled section per distinct reading; MUI's Menu flattens
                    this array of fragments, so ListSubheader + MenuItems render inline.
                    es: no readings to section by, so the clusters render flat with a
                    per-sense grammar tag ("n · m") carrying the disambiguation instead. */}
                {!senseSections && sortedClusters.map((cluster, index) =>
                    renderSenseItem(cluster, index, true))}
                {senseSections?.map((section, sectionIndex) => [
                    <ListSubheader
                        key={`heading-${section.reading}`}
                        className={`${classPrefix}-sense-reading`}
                        disableSticky
                        sx={{
                            // `.grp` — the reading itself, small and quiet. It is a
                            // divider between groups of senses, not a title over them.
                            padding: "8px 14px 3px",
                            lineHeight: 1.4,
                            fontSize: 11,
                            fontWeight: WEIGHT.semibold,
                            fontFamily: FONTS.sans,
                            backgroundColor: "transparent",
                            color: COLORS.onSurface,
                        }}
                    >
                        {/* Front/question side: the reading is the answer, so the heading
                            becomes a bare ordinal label ("Group 1"). Sections are already in
                            frequency order, so the numbering is stable for a given card. */}
                        {censorReadings
                            ? <span style={{ color: COLORS.textSecondary }}>{`Group ${sectionIndex + 1}`}</span>
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
