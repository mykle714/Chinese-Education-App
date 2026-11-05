import Icon from "./Icon";
import GlossText from "./GlossText";
import type { TwoLineSegment } from "./SwipeableTwoLineText";
import { ddt } from "../utils/definitionUtils";
import type { DefinitionCluster } from "../types";

/**
 * A multi-sense word's dd LIST, as `SwipeableTwoLineText` segments — every sense's dd in
 * `sortedSenseClusters` order, the chosen sense marked with a `--selected` class (the
 * host underlines it through its own `sx`), the default (index 0) led by a filled star in
 * the gloss's own colour.
 *
 * Extracted from EipEntryHeader (2026-11-04) when Memory Map's prompt adopted the same
 * "dd in eip logic", so the two surfaces cannot drift on order, star or marking.
 *
 * `classPrefix` names the segment spans (`<prefix>` and `<prefix>--selected`), so each host
 * styles its own. Pass the result through `useMemo`: SwipeableTwoLineText re-measures
 * whenever its segments change identity.
 *
 * Used by: src/features/flashcards/FlashcardsLearnPage/EipEntryHeader.tsx (the eip header
 * gloss), src/games/memory-map/MemoryMapPrompt.tsx (the prompt gloss). Docs:
 * docs/DEFINITION_CLUSTERS.md (picker order), docs/MEMORY_MAP_GAME.md § 3.1.
 */

// The starred default's icon (the SensePicker's star, same size) and the gap after it —
// the star LEADS the gloss (owner's call 2026-10-30). Their sum is the `leadingWidth`
// SwipeableTwoLineText adds when it measures a line.
export const SENSE_STAR_SIZE = 13;
export const SENSE_STAR_GAP = 3;

export function buildSenseSegments(
    clusters: readonly DefinitionCluster[],
    selectedIndex: number,
    classPrefix: string
): TwoLineSegment[] {
    return clusters.map((cluster, index) => ({
        text: ddt(cluster),
        // Same string, with a classifier sense's label in italics; `text` stays the plain
        // string SwipeableTwoLineText measures.
        content: <GlossText text={ddt(cluster)} pos={cluster.pos} />,
        className: index === selectedIndex ? `${classPrefix} ${classPrefix}--selected` : classPrefix,
        ...(index === 0 && {
            leading: (
                <Icon
                    name="star"
                    size={SENSE_STAR_SIZE}
                    fill={1}
                    color="inherit"
                    className={`${classPrefix}-star`}
                    sx={{ marginRight: `${SENSE_STAR_GAP}px`, verticalAlign: "-1px" }}
                />
            ),
            leadingWidth: SENSE_STAR_SIZE + SENSE_STAR_GAP,
        }),
    }));
}
