import Icon from "./Icon";
import GlossText from "./GlossText";
import type { TwoLineSegment } from "./SwipeableTwoLineText";
import { ddt, isStarredSense } from "../utils/definitionUtils";
import type { DefinitionCluster } from "../types";

/**
 * A multi-sense word's dd LIST, as `SwipeableTwoLineText` segments — every sense's dd in
 * `sortedSenseClusters` order, the chosen sense marked with a `--selected` class (the
 * host underlines it through its own `sx`), and every STARRED sense led by a filled star in
 * the gloss's own colour: the default (index 0) plus any sense of commonality 4–5
 * (`isStarredSense`, 2026-11-05). `selectedIndex = null` marks no sense: the host has no pick to
 * show (an eip whose host passes no `selectedSenseIndex`), so nothing is underlined and only
 * the star remains.
 *
 * Extracted from EipEntryHeader (2026-11-04) when Memory Map's prompt adopted the same
 * "dd in eip logic", so the surfaces cannot drift on order, star or marking. (The eip header
 * itself has shown one dd since 2026-11-05; its list moved to EipSenseList.)
 *
 * `classPrefix` names the segment spans (`<prefix>` and `<prefix>--selected`), so each host
 * styles its own. Pass the result through `useMemo`: SwipeableTwoLineText re-measures
 * whenever its segments change identity.
 *
 * Used by: src/games/memory-map/MemoryMapPrompt.tsx (the prompt gloss) and
 * src/features/flashcards/FlashcardsLearnPage/EipSenseList.tsx (the eip's sense list, which
 * draws `leading` AFTER the gloss and flips its gap —
 * reads `leading`, `content` and `className` only). Docs:
 * docs/DEFINITION_CLUSTERS.md (picker order), docs/MEMORY_MAP_GAME.md § 3.1.
 */

// A starred sense's icon (the SensePicker's star, same size) and the gap after it —
// the star LEADS the gloss (owner's call 2026-10-30). Their sum is the `leadingWidth`
// SwipeableTwoLineText adds when it measures a line.
export const SENSE_STAR_SIZE = 13;
export const SENSE_STAR_GAP = 3;

export function buildSenseSegments(
    clusters: readonly DefinitionCluster[],
    selectedIndex: number | null,
    classPrefix: string
): TwoLineSegment[] {
    return clusters.map((cluster, index) => ({
        text: ddt(cluster),
        // Same string, with a classifier sense's label in italics; `text` stays the plain
        // string SwipeableTwoLineText measures.
        content: <GlossText text={ddt(cluster)} pos={cluster.pos} />,
        className: index === selectedIndex ? `${classPrefix} ${classPrefix}--selected` : classPrefix,
        ...(isStarredSense(cluster, index) && {
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

/**
 * The chosen sense's underline, in the palette's muted ink — quieter than the gloss itself
 * (owner's pick 2026-10-29). Shared by the surfaces that mark the pick in a sense list: the
 * eip's sense list (EipSenseList) and Memory Map's prompt, so they cannot drift.
 */
export function senseSelectedUnderlineSx(color: string) {
    return {
        textDecorationLine: "underline",
        textDecorationColor: color,
        textDecorationThickness: "1.5px",
        textUnderlineOffset: "2px",
    } as const;
}
