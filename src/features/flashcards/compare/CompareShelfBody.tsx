import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { Box, Typography, CircularProgress } from "@mui/material";
import DictionaryWordSearch from "../../../components/DictionaryWordSearch";
import LongDefinitionDisplay from "../../../components/LongDefinitionDisplay";
import { useWordComparison } from "../../../hooks/useWordComparison";
import { dictionaryEntryToVocabEntry } from "../../../utils/dictEntryAdapter";
import { SIZE } from "../../../theme/scale";
import { FONTS } from "../../../theme/fonts";
import { useEipColors } from "../FlashcardsLearnPage/useEipPalette";
import { eipShelfLook } from "../FlashcardsLearnPage/eipPalette";
import { EIP_PANEL_GUTTER } from "../FlashcardsLearnPage/styled";
import type { DictionaryEntry, Language, LongDefinitionPart, VocabEntry } from "../../../types";
import { isPickableFor, otherSlot, slotEntry, type CompareSlot, type CompareState } from "./compareState";

const UI_FONT = FONTS.sans;

// The body's own class — also the infinite-scroll observer's root (DictionaryWordSearch
// → DictionaryLoadMore resolves it with `closest`), so keep the two in step.
const BODY_CLASS = "compare-shelf-body";

/**
 * {root, scroll} — the handle SheetPanel binds its drag-to-resize / scroll coupling to
 * (SheetPanelBodyHandle). One element serves both: this body is the panel's only scroller.
 */
export interface CompareShelfBodyHandle {
    root: HTMLDivElement | null;
    scroll: HTMLDivElement | null;
}

interface CompareShelfBodyProps {
    state: CompareState;
    /** The slot the search is filling, or null to show the comparison (compareState → activeSearchSlot). */
    searchSlot: CompareSlot | null;
    /** A search row was picked for `searchSlot`. */
    onPick: (slot: CompareSlot, entry: VocabEntry) => void;
    /** A comparison arrived — the owner persists it with the pair. */
    onResult: (comparison: string | null, comparisonParts: LongDefinitionPart[] | null) => void;
    showPinyinColor: boolean;
}

/**
 * CompareShelfBody — the Compare panel's WHITE SHELF content (docs/WORD_COMPARE_FEATURE.md
 * § Layout). Two modes, chosen by the owner's `searchSlot`:
 *
 *   SEARCH  — the mini dictionary search (DictionaryWordSearch, in the Dictionary page's
 *             look), filling the ringed slot. Keyed on the slot, so switching slots starts
 *             a fresh query. Offers only words that fit a slot and are not the other word.
 *   RESULT  — the AI comparison paragraph, or its loading / daily-limit / retry state;
 *             with a slot still empty, a hint to tap its "+" (search mode is never opened
 *             for the learner — owner's call 2026-11-21).
 *
 * Request-driving: it owns `useWordComparison` (the in-flight request) and fires it once
 * both slots are filled and no paragraph is cached for the pair; a result is handed back
 * through `onResult`, so `state.comparison` stays the source of truth for what is shown.
 * It is mounted for the panel's whole life, so a comparison already running keeps running
 * while the learner opens the search to look at a replacement.
 *
 * Replaces CompareWorkspace (src/components, deleted 2026-11-21), whose two slots moved
 * up into the tinted band (CompareSlots).
 *
 * Layout note (inherited from CompareWorkspace): ONE scroll region — this Box — with every
 * child at natural height and `flexShrink: 0`. A nested `flex: 1; minHeight: 0` section
 * collapses the results to 0px once the field eats a part-height sheet, and the default
 * `flex-shrink: 1` squeezes a long paragraph inside its box instead of extending the scroll.
 *
 * Layer: feature component (src/features/flashcards/compare). Must sit under an
 * EipPaletteProvider. Depended on by: CompareSheet.
 */
const CompareShelfBody = forwardRef<CompareShelfBodyHandle, CompareShelfBodyProps>(function CompareShelfBody(
    { state, searchSlot, onPick, onResult, showPinyinColor },
    ref,
) {
    const colors = useEipColors();
    // The dictionary pieces' colours, from the shelf (white by light theme, slate in Dark).
    const look = useMemo(() => eipShelfLook(colors), [colors]);
    const nodeRef = useRef<HTMLDivElement | null>(null);
    useImperativeHandle(ref, () => ({
        get root() { return nodeRef.current; },
        get scroll() { return nodeRef.current; },
    }), []);
    const wordComparison = useWordComparison();

    const language = (state.slotA?.language ?? state.slotB?.language ?? "zh") as Language;
    const bothFilled = !!state.slotA && !!state.slotB;

    // Fire the compare request whenever both slots are filled and no paragraph is cached for
    // this pair (filling or replacing either slot clears `comparison` — CompareSheet).
    useEffect(() => {
        if (state.slotA && state.slotB && !state.comparison) {
            wordComparison.compare(state.slotA.entryKey, state.slotB.entryKey, language);
        }
        // Keyed on the pair, not on the entry objects (their identity is not stable).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.slotA?.entryKey, state.slotB?.entryKey]);

    // Hand a successful result (+ its GSA-segmented parts) back to the owner.
    useEffect(() => {
        if (wordComparison.comparison) onResult(wordComparison.comparison, wordComparison.comparisonParts);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [wordComparison.comparison]);

    const handleRetry = () => {
        if (!state.slotA || !state.slotB) return;
        wordComparison.compare(state.slotA.entryKey, state.slotB.entryKey, language);
    };

    // The word already in the OTHER slot — excluded from the search, and named in its hint.
    const other = searchSlot ? slotEntry(state, otherSlot(searchSlot)) : null;
    const filter = useMemo(() => (entry: DictionaryEntry) => isPickableFor(entry, other), [other]);

    const statusSx = { fontSize: SIZE.body, color: colors.muted, textAlign: "center", fontFamily: UI_FONT } as const;

    return (
        <Box
            ref={nodeRef}
            className={BODY_CLASS}
            sx={{
                display: "flex",
                flexDirection: "column",
                padding: `4px ${EIP_PANEL_GUTTER}px 16px`,
                flex: 1,
                minHeight: 0,
                overflow: "auto",
                // `pan-y`, NOT `none` — the same correction InfoCardPanelBody carries.
                // SheetPanel picks resize-vs-scroll on the gesture's first committed move and
                // expresses "scroll" by NOT calling preventDefault, leaving the browser to pan
                // natively; `none` makes the browser refuse that pan, so a long result list
                // or paragraph cannot be scrolled once the sheet is at full height.
                touchAction: "pan-y",
            }}
        >
            {searchSlot ? (
                <DictionaryWordSearch
                    key={searchSlot}
                    classPrefix="compare-shelf-body__search"
                    language={language}
                    look={look}
                    scrollRootSelector={`.${BODY_CLASS}`}
                    filter={filter}
                    onSelect={(entry) => onPick(searchSlot, dictionaryEntryToVocabEntry(entry))}
                    emptyHint={other ? `Search for a word to compare with ${other.entryKey}.` : "Search for a word to compare."}
                />
            ) : (
                <Box
                    className="compare-shelf-body__result"
                    sx={{ minHeight: "80px", flexShrink: 0, display: "flex", alignItems: "flex-start", justifyContent: "center", pt: "4px" }}
                >
                    {!bothFilled && (
                        <Typography className="compare-shelf-body__hint" sx={{ ...statusSx, pt: 2 }}>
                            Tap the + to pick a word to compare.
                        </Typography>
                    )}
                    {bothFilled && wordComparison.loading && (
                        <Box className="compare-shelf-body__loading" sx={{ display: "flex", alignItems: "center", gap: 1, pt: 2 }}>
                            <CircularProgress size={18} />
                            <Typography sx={statusSx}>Comparing…</Typography>
                        </Box>
                    )}
                    {bothFilled && !wordComparison.loading && wordComparison.limitReached && (
                        <Typography className="compare-shelf-body__limit" sx={{ ...statusSx, pt: 2 }}>
                            {wordComparison.limitMessage || "You've reached your daily limit of AI lookups. Try again tomorrow."}
                        </Typography>
                    )}
                    {bothFilled && !wordComparison.loading && !wordComparison.limitReached && wordComparison.error && !state.comparison && (
                        <Typography
                            className="compare-shelf-body__retry"
                            onClick={handleRetry}
                            sx={{ ...statusSx, pt: 2, color: "error.main", cursor: "pointer", textDecoration: "underline" }}
                        >
                            The comparison request didn't go through. Tap to retry.
                        </Typography>
                    )}
                    {state.comparison && (
                        // Generated live by AI (word_comparison_cache) with no validation field,
                        // so it always carries the AI-generated treatment. Embedded Chinese
                        // (comparisonParts — DictionaryService.withComparisonParts) renders as
                        // inline cpcd with a passive definition popup: the panel has no eip to
                        // drill into (it closed when Compare opened), so no `onSegmentOpen`.
                        <LongDefinitionDisplay
                            className="compare-shelf-body__result-text"
                            longDefinition={state.comparison}
                            longDefinitionParts={state.comparisonParts}
                            showPinyin
                            showPinyinColor={showPinyinColor}
                            aiGenerated
                            sx={{ fontSize: SIZE.body, color: colors.ink, lineHeight: 1.6, fontFamily: UI_FONT, width: "100%" }}
                        />
                    )}
                </Box>
            )}
        </Box>
    );
});

export default CompareShelfBody;
