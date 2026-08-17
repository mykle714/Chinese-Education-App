import { resolveLongDefinitionForSense } from "../../../utils/definitionUtils";
import { TAB_LABELS } from "../constants";
import type { VocabEntry, BreakdownItem, UsedInItem } from "../types";
import type { LongDefinitionPart } from "../../../types";

/**
 * Per-tab emptiness for the eip, derived from the current entry.
 *
 * Its own module (rather than living next to the component that renders the tabs)
 * because BOTH the tab strip — which greys out an empty tab's label — and the tab
 * bodies need the same answers, and deriving them twice is how the two drift apart.
 * Kept out of InfoCardTabContent.tsx so that file exports only a component
 * (react-refresh/only-export-components).
 *
 * See docs/ARCHITECTURE_REVIEW.md finding 9.
 */

/** Which tabs have anything to show, plus the entry-derived values the body renders. */
export interface TabAvailability {
    definition: boolean;
    examples: boolean;
    breakdown: boolean;
    /** Single-char zh cards swap the breakdown tab for a "used in" list. */
    isSingleChar: boolean;
    usedInItems: UsedInItem[];
    longDefinition: string | null;
    longDefinitionParts: LongDefinitionPart[] | null;
    /** Tab-strip label for tab 2, which changes with `isSingleChar`. */
    breakdownTabLabel: string;
}

/**
 * Derive every per-tab emptiness answer from the entry. Pure — safe to call on each
 * render.
 *
 * The long definition is stored per sense (zh), so it is resolved for the sense this
 * card is on. `selectedSenseIndex` is the panel's LIVE pick (the eip header's
 * SensePicker) — passed as an override so the tab body updates on the tap, before the
 * persisted `selectedSense` round-trips back through useEipTabs.syncEntry. Omit it and
 * the entry's own persisted sense is used, which is what every non-eip caller wants.
 */
export function tabAvailability(
    currentEntry: VocabEntry | null,
    breakdownItems: BreakdownItem[],
    selectedSenseIndex?: number,
): TabAvailability {
    const { longDefinition, longDefinitionParts } = currentEntry
        ? resolveLongDefinitionForSense(currentEntry, selectedSenseIndex)
        : { longDefinition: null, longDefinitionParts: null };

    const isSingleChar = !!currentEntry && [...currentEntry.entryKey].length === 1;
    const usedInItems: UsedInItem[] =
        isSingleChar && currentEntry?.usedIn ? currentEntry.usedIn : [];

    return {
        definition: !!(
            longDefinition ||
            currentEntry?.difficulty ||
            (currentEntry?.partsOfSpeech?.length ?? 0) > 0
        ),
        examples: !!currentEntry?.exampleSentences?.length,
        breakdown: isSingleChar ? usedInItems.length > 0 : breakdownItems.length > 0,
        isSingleChar,
        usedInItems,
        longDefinition,
        longDefinitionParts,
        breakdownTabLabel: isSingleChar ? "used in" : TAB_LABELS[2],
    };
}
