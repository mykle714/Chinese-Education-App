import React from "react";
import { Box, IconButton, ListItemIcon, ListItemText, ListSubheader, Menu, MenuItem, Typography, useTheme } from "@mui/material";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import StarIcon from "@mui/icons-material/Star";
import { ddt, senseGrammarTag, sortedSenseClusters } from "../../../utils/definitionUtils";
import { numberedToTonedPinyin } from "../../../utils/textUtils";
import { getToneColor } from "../../../utils/toneColors";
import FrequencyScoreDots from "../../../components/FrequencyScoreDots";
import { SIZE, WEIGHT, TRACKING } from "../../../theme/scale";
import type { VocabEntry } from "../types";
import type { DefinitionCluster } from "../../../types";

/**
 * SensePicker — the shared definition-cluster ("sense") chooser.
 *
 * A small triangle trigger that opens a menu of the word's orthogonal senses
 * (`definitionClusters`, migration 90 — see docs/DEFINITION_CLUSTERS.md), one item
 * per cluster rendered through the ddt display transformation. Renders NOTHING when
 * the entry has no real choice (unclustered, or a single cluster), so every host can
 * drop it in unconditionally.
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
    const theme = useTheme();
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
        return (
            <MenuItem
                key={`sense-${index}`}
                selected={index === selectedSenseIndex}
                // The Menu renders in a portal, but React synthetic events bubble
                // through the React tree — so a tap here would otherwise reach the
                // card's flip handlers. Stop every press event, same as the trigger.
                onClick={(e) => { stopCardHandlers(e); onSelectSense?.(index); setAnchorEl(null); }}
                onMouseDown={stopCardHandlers}
                onTouchStart={stopCardHandlers}
                onTouchEnd={stopCardHandlers}
            >
                {index === 0 && (
                    <ListItemIcon sx={{ minWidth: 28 }}>
                        <StarIcon fontSize="small" sx={{ color: theme.palette.warning.main }} />
                    </ListItemIcon>
                )}
                <ListItemText inset={index !== 0} primary={ddt(cluster)} />
                {/* Per-sense commonality (the cluster's own 1–5 conversation-frequency
                    score, migration 139 / docs/DEFINITION_CLUSTERS.md) — the same meter
                    the eip and cdp show, shrunk to menu scale and muted to secondary text
                    so it reads as metadata beside the sense label. It earns its place here
                    because the zh path GROUPS by reading, so the menu order is no longer
                    globally frequency-sorted and the learner otherwise can't tell which of
                    two senses under different readings is the common one. Omitted (rather
                    than shown as five hollow dots) when scoring failed / never ran. */}
                {cluster.frequencyScore != null && (
                    // Wrapper carries the spacing/no-shrink: FrequencyScoreDots takes
                    // colors and sizes but no sx, so layout is the caller's job.
                    <Box sx={{ ml: 1.5, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                        <FrequencyScoreDots
                            className={`${classPrefix}-sense-commonality`}
                            score={cluster.frequencyScore}
                            dotSize={5}
                            gap={2.5}
                            filledColor={theme.palette.text.secondary}
                            emptyBorderColor={theme.palette.divider}
                        />
                    </Box>
                )}
                {tag && (
                    <Typography
                        className={`${classPrefix}-sense-grammar`}
                        sx={{ ml: 1.5, fontSize: SIZE.micro, color: theme.palette.text.secondary, whiteSpace: 'nowrap' }}
                    >
                        {tag}
                    </Typography>
                )}
            </MenuItem>
        );
    };

    return (
        <>
            <IconButton
                className={`${classPrefix}-sense-trigger`}
                size="small"
                aria-label="Switch definition"
                onClick={(e) => { stopCardHandlers(e); setAnchorEl(e.currentTarget); }}
                onMouseDown={stopCardHandlers}
                onTouchStart={stopCardHandlers}
                onTouchEnd={stopCardHandlers}
                sx={color ? { color } : undefined}
            >
                <ArrowDropDownIcon fontSize="small" />
            </IconButton>
            <Menu
                className={`${classPrefix}-sense-menu`}
                anchorEl={anchorEl}
                open={Boolean(anchorEl)}
                onClose={() => setAnchorEl(null)}
                MenuListProps={{ sx: { py: 0.5 } }}
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
                {senseSections?.map((section, sectionIndex) => [
                    <ListSubheader
                        key={`heading-${section.reading}`}
                        className={`${classPrefix}-sense-reading`}
                        disableSticky
                        sx={{
                            lineHeight: 1.6,
                            fontWeight: WEIGHT.semibold,
                            bgcolor: 'transparent',
                            // Row so the heading can carry the right-hand column label
                            // (see the "Commonality" caption below) opposite the reading.
                            display: 'flex',
                            alignItems: 'baseline',
                            justifyContent: 'space-between',
                            gap: 1.5,
                        }}
                    >
                        <Box component="span">
                        {/* Front/question side: the reading is the answer, so the heading
                            becomes a bare ordinal label ("Group 1"). Sections are already in
                            frequency order, so the numbering is stable for a given card. */}
                        {censorReadings
                            ? <span style={{ color: theme.palette.text.secondary }}>{`Group ${sectionIndex + 1}`}</span>
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
                            : <span style={{ color: theme.palette.text.secondary }}>—</span>}
                        </Box>
                        {/* Column label for the trailing dot meters. Rendered on the FIRST
                            section only — repeating it over every reading would read as
                            part of each heading rather than as a one-time column header —
                            and only when some cluster actually has a score to show. */}
                        {sectionIndex === 0 && sortedClusters.some((c) => c.frequencyScore != null) && (
                            <Box
                                component="span"
                                className={`${classPrefix}-sense-commonality-label`}
                                sx={{
                                    fontSize: SIZE.micro,
                                    fontWeight: WEIGHT.regular,
                                    letterSpacing: TRACKING.wide,
                                    color: theme.palette.text.secondary,
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                Commonality
                            </Box>
                        )}
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
