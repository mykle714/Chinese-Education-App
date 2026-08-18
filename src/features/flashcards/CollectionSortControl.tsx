import { useState, useMemo } from "react";
import { Box, Button, Menu, Typography, ToggleButtonGroup, ToggleButton } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import SwapVertIcon from "@mui/icons-material/SwapVert";
import { sortBundles, sortLabel, type VocabSortKey } from "../../utils/vocabSort";
import type { MasteryGoals } from "../../utils/masteryCompute";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";

/**
 * CollectionSortControl — the "Sort by" button and its dimension menu, for any
 * surface that lists a set of cards.
 *
 * ── Why it is a component ─────────────────────────────────────────────────────
 * Two surfaces order the same `VocabEntry[]` with the same keys: the collection page
 * (CollectionViewPage) and the /decks sheet's inline Cards section (DecksSheetBody).
 * The menu is ~100 lines of non-obvious markup — rows that are deliberately NOT
 * MenuItems, a toggle group whose value is nulled unless the applied key belongs to
 * that row — and a second copy would have drifted the first time a mastery bar or a
 * language was added. `vocabSort.ts` already owns WHICH orderings exist; this owns
 * how they are picked.
 *
 * ── What it does NOT own ──────────────────────────────────────────────────────
 * The sort key itself. The caller holds it in state and applies it with
 * `sortVocabEntries`, because the caller is also the one holding the entries — and
 * the two surfaces default to different keys (a deck opens on `deckAdded`, everything
 * else on `recent`) and keep it for different lifetimes.
 *
 * Layer: feature component (src/features/flashcards). Presentation only.
 *
 * Docs: docs/DECKS_FEATURE.md § "Sort by (every collection)".
 */
export interface CollectionSortControlProps {
    sortKey: VocabSortKey;
    onSortKeyChange: (key: VocabSortKey) => void;
    /** Decides the pronunciation row's label ("Pinyin" vs. "Word (A–Z)"). */
    language: string | null | undefined;
    /** Decides which mastery rows exist — the same gate as the bars themselves. */
    goals: MasteryGoals;
    /**
     * Show the deck-only rows (currently "Date added", which reads `deckAddedAt` —
     * a field only the deck read selects). False on any collection where that field
     * does not exist, or the row would sort by nothing.
     */
    allowDeckOnly?: boolean;
    /**
     * Offer the PER-SKILL mastery rows (Mastery / Date mastered for the reading and
     * writing bars). False keeps the menu to the orderings that apply to every card —
     * what the /decks sheet's whole-library Cards section wants, where a per-skill
     * ordering is a niche view of a list the learner opened to find one word in.
     * The CORE bar's rows are always offered.
     */
    allowPerSkillBars?: boolean;
    /**
     * Class-name prefix so each host keeps distinct hooks
     * (e.g. "collection-view" → `collection-view__sort-button`).
     */
    classPrefix: string;
    /** Layout of the button's ROW — the host owns its width and padding. */
    sx?: SxProps<Theme>;
}

const CollectionSortControl: React.FC<CollectionSortControlProps> = ({
    sortKey,
    onSortKeyChange,
    language,
    goals,
    allowDeckOnly = false,
    allowPerSkillBars = true,
    classPrefix,
    sx,
}) => {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);

    // Two visibility gates, both filtering the shared list rather than forking it:
    //   • deck-only rows are hidden where the field they read does not exist —
    //     `deckAddedAt` is selected only by the deck read (OnDeckVocabService.getDeckCards);
    //   • per-skill rows are hidden where the host asked for the common orderings only.
    // `bundle.bar` is the tag rather than an `id` match, so adding a bar cannot
    // silently slip a row past this filter.
    const bundles = useMemo(
        () => sortBundles(language, goals).filter((bundle) => {
            if (bundle.deckOnly && !allowDeckOnly) return false;
            if (bundle.bar && bundle.bar !== "core" && !allowPerSkillBars) return false;
            return true;
        }),
        [language, goals, allowDeckOnly, allowPerSkillBars]
    );

    return (
        <>
            {/* Sort row. A text button rather than a bare icon: the ACTIVE ordering is
                the thing worth showing — a learner who sorted by "Least mastered" and
                then scrolled needs to see why the order looks the way it does. */}
            <Box
                className={`${classPrefix}__sort`}
                sx={{ display: "flex", justifyContent: "flex-end", ...sx }}
            >
                <Button
                    className={`${classPrefix}__sort-button`}
                    startIcon={<SwapVertIcon />}
                    onClick={(e) => setAnchor(e.currentTarget)}
                    sx={{
                        textTransform: "none",
                        fontFamily: FONTS.sans,
                        fontSize: SIZE.body,
                        fontWeight: WEIGHT.medium,
                        color: COLORS.textSecondary,
                        padding: "2px 8px",
                        minWidth: 0,
                    }}
                >
                    {sortLabel(sortKey, language, goals)}
                </Button>
            </Box>

            <Menu
                className={`${classPrefix}__sort-menu`}
                anchorEl={anchor}
                open={Boolean(anchor)}
                onClose={() => setAnchor(null)}
            >
                {/* One row per DIMENSION, with both directions as toggles on the right.
                    Not MenuItems: a row is not itself selectable — the two toggles are —
                    and nesting buttons inside a MenuItem would give the row a second,
                    ambiguous tap target that swallowed the toggles' clicks. */}
                {bundles.map((bundle) => (
                    <Box
                        key={bundle.id}
                        className={`${classPrefix}__sort-row ${classPrefix}__sort-row--${bundle.id}`}
                        sx={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "16px",
                            padding: "6px 16px",
                        }}
                    >
                        <Typography
                            className={`${classPrefix}__sort-row-label`}
                            sx={{
                                fontFamily: FONTS.sans,
                                fontSize: SIZE.body,
                                fontWeight: WEIGHT.medium,
                                color: COLORS.onSurface,
                                whiteSpace: "nowrap",
                            }}
                        >
                            {bundle.label}
                        </Typography>

                        <ToggleButtonGroup
                            className={`${classPrefix}__sort-directions`}
                            size="small"
                            exclusive
                            // null unless the applied key belongs to THIS row, so exactly
                            // one toggle in the whole menu ever reads as selected.
                            value={bundle.directions.some((d) => d.key === sortKey) ? sortKey : null}
                            onChange={(_e, next: VocabSortKey | null) => {
                                // MUI emits null when the selected toggle is tapped again.
                                // An ordering cannot be "off", so that tap is a no-op
                                // rather than a fall back to some default.
                                if (!next) return;
                                onSortKeyChange(next);
                                setAnchor(null);
                            }}
                        >
                            {bundle.directions.map((direction) => (
                                <ToggleButton
                                    key={direction.key}
                                    value={direction.key}
                                    className={`${classPrefix}__sort-direction ${classPrefix}__sort-direction--${direction.key}`}
                                    sx={{
                                        textTransform: "none",
                                        fontFamily: FONTS.sans,
                                        fontSize: SIZE.caption,
                                        fontWeight: WEIGHT.medium,
                                        padding: "2px 10px",
                                        lineHeight: 1.5,
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    {direction.label}
                                </ToggleButton>
                            ))}
                        </ToggleButtonGroup>
                    </Box>
                ))}
            </Menu>
        </>
    );
};

export default CollectionSortControl;
