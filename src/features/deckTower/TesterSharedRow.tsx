import React, { Children, createContext, useContext, useLayoutEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import { COLORS } from "../../theme/colors";
import { TESTER_ROW_SX } from "./testerChipStyle";

/**
 * TesterSharedRow — puts two or more SHORT feature-tester chip groups (TimeOfDayToggle,
 * AuroraToggle, LightningStrikeChips, BankingAlwaysPlayToggle) on one row under the Deck
 * Tower's header, split by a hairline divider, so the tester stack takes fewer rows
 * (docs/DECK_TOWER.md § "Feature-tester rows").
 *
 * Layer: page-private component (feature module `src/features/deckTower`). Pure layout: the
 * groups inside still own their values and taps.
 *
 * HOW A GROUP KNOWS IT IS INSIDE: `TesterInlineContext`. TesterChipRow and
 * LightningStrikeChips read it and drop their own full-row padding (TESTER_ROW_SX →
 * TESTER_GROUP_SX), so the toggles themselves need no prop threaded through.
 *
 * THE DIVIDER ONLY SHOWS WHILE EVERYTHING FITS ON ONE LINE. On a ~375px phone a shared row is
 * right at the edge of the width (measured 2026-11-08), so it can wrap. A divider that
 * wrapped would dangle at a line's start or end, so the row measures the groups' natural
 * widths and hides the dividers when the sum (plus the gaps) is wider than the row. The sum
 * is independent of whether the dividers show, so hiding them cannot flip the result back
 * (no show/hide oscillation). The groups never split: each is a `flexShrink: 0` unit.
 *
 * Depends on: testerChipStyle.ts (`TESTER_ROW_SX`), COLORS.border (the chip outline's ink).
 * Depended on by: DeckTowerPage.tsx, TesterChipRow.tsx and LightningStrikeChips.tsx (the
 * context).
 */

/** True inside a TesterSharedRow: a chip group renders as an inline group, not a full row. */
export const TesterInlineContext = createContext(false);

/** Read by a chip group to choose TESTER_GROUP_SX (inline) over TESTER_ROW_SX (full row). */
export function useTesterInline(): boolean {
    return useContext(TesterInlineContext);
}

/** The divider's height: a little shorter than a chip (~24px), so it reads as a seam, not a wall. */
const DIVIDER_HEIGHT_PX = 16;

interface TesterSharedRowProps {
    /** BEM modifier naming the row — `deck-tower-page__tester-shared-row--${name}`. */
    name: string;
    /** The chip groups, in order. `false`/`null` children are skipped. */
    children: React.ReactNode;
}

const TesterSharedRow: React.FC<TesterSharedRowProps> = ({ name, children }) => {
    const groups = Children.toArray(children);
    const rowRef = useRef<HTMLDivElement>(null);
    const groupRefs = useRef<(HTMLDivElement | null)[]>([]);
    const [fitsOneLine, setFitsOneLine] = useState(true);

    useLayoutEffect(() => {
        const row = rowRef.current;
        if (!row) return;
        const measure = () => {
            const style = getComputedStyle(row);
            const contentWidth = row.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
            const gap = parseFloat(style.columnGap) || 0;
            const groupWidths = groupRefs.current
                .slice(0, groups.length)
                .reduce((sum, el) => sum + (el?.offsetWidth ?? 0), 0);
            // Between each pair of groups: gap · divider (1px) · gap.
            const seams = Math.max(groups.length - 1, 0) * (2 * gap + 1);
            setFitsOneLine(groupWidths + seams <= contentWidth);
        };
        measure();
        // Re-measure on a resize of the row (rotation, window) AND of any group (a chip
        // label changing width, the web font arriving after first paint).
        const observer = new ResizeObserver(measure);
        observer.observe(row);
        groupRefs.current.forEach((el) => el && observer.observe(el));
        return () => observer.disconnect();
    }, [groups.length]);

    return (
        <TesterInlineContext.Provider value={true}>
            <Box
                ref={rowRef}
                className={`deck-tower-page__tester-shared-row deck-tower-page__tester-shared-row--${name}`}
                sx={{ ...TESTER_ROW_SX, alignItems: "center" }}
            >
                {groups.map((group, i) => (
                    <React.Fragment key={i}>
                        {i > 0 && fitsOneLine && (
                            <Box
                                className="deck-tower-page__tester-shared-row-divider"
                                aria-hidden
                                sx={{ width: "1px", height: DIVIDER_HEIGHT_PX, flexShrink: 0, backgroundColor: COLORS.border }}
                            />
                        )}
                        <Box
                            ref={(el: HTMLDivElement | null) => { groupRefs.current[i] = el; }}
                            className="deck-tower-page__tester-shared-row-group"
                            sx={{ display: "flex", flexShrink: 0 }}
                        >
                            {group}
                        </Box>
                    </React.Fragment>
                ))}
            </Box>
        </TesterInlineContext.Provider>
    );
};

export default TesterSharedRow;
