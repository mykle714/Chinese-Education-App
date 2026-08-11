import React from "react";
import { COLORS, FONTS, SIZE, WEIGHT } from "../theme";
import ForeignText from "./ForeignText";
import type { ProvisionalCardRow } from "../utils/provisionalCards";
import type { Language } from "../types";

/**
 * ProvisionalCardTable — the lent cards, one row per card: word1 · pinyin · dd.
 *
 * Shared by the pre-round notice (src/components/ProvisionalCardsNotice.tsx) and the
 * end-of-round sort offer (src/components/ProvisionalSortOffer.tsx) so the learner
 * meets the same three columns in the same order both times: the word they will see
 * on the board, how it is said, and what it means.
 *
 * A bare list of words was the first version of this and was not enough — a learner
 * being handed words they never sorted cannot judge the offer without the meaning.
 *
 * The table is the one scrollable region of its dialog: a large lent set must not
 * grow the card past the viewport. Scrolling is opt-in per container
 * (CLAUDE.md § Touch & Scroll), hence the explicit `touchAction: "pan-y"`.
 *
 * Referenced by: docs/PROVISIONAL_CARDS.md § 5.
 */
export interface ProvisionalCardTableProps {
    rows: ProvisionalCardRow[];
    /** Language of the words, so they render through ForeignText correctly. */
    language: Language;
    /** Cap on the scroll area's height in px. Default 210. */
    maxHeight?: number;
}

const ProvisionalCardTable: React.FC<ProvisionalCardTableProps> = ({
    rows,
    language,
    maxHeight = 210,
}) => {
    if (rows.length === 0) return null;

    return (
        <div
            className="provisional-card-table__scroll"
            style={{
                width: "100%",
                maxHeight,
                overflowY: "auto",
                touchAction: "pan-y",
                borderRadius: 12,
                background: COLORS.iconBg,
            }}
        >
            <table
                className="provisional-card-table"
                style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    textAlign: "left",
                    fontFamily: FONTS.sans,
                }}
            >
                <tbody>
                    {rows.map((row) => (
                        <tr
                            key={row.word}
                            className="provisional-card-table__row"
                            style={{ borderBottom: `1px solid ${COLORS.rowBorder}` }}
                        >
                            {/* Word column — sized to its content so the dd gets the slack. */}
                            <td
                                className="provisional-card-table__cell provisional-card-table__cell--word"
                                style={{ padding: "8px 10px", verticalAlign: "top", whiteSpace: "nowrap" }}
                            >
                                <ForeignText text={row.word} language={language} size="sm" />
                            </td>
                            <td
                                className="provisional-card-table__cell provisional-card-table__cell--pinyin"
                                style={{
                                    padding: "8px 10px",
                                    verticalAlign: "top",
                                    whiteSpace: "nowrap",
                                    fontSize: SIZE.body,
                                    color: COLORS.textSecondary,
                                }}
                            >
                                {row.pinyin ?? ""}
                            </td>
                            <td
                                className="provisional-card-table__cell provisional-card-table__cell--dd"
                                style={{
                                    padding: "8px 10px",
                                    verticalAlign: "top",
                                    width: "100%",
                                    fontSize: SIZE.body,
                                    fontWeight: WEIGHT.medium,
                                    color: COLORS.onSurface,
                                    lineHeight: 1.35,
                                }}
                            >
                                {row.dd}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export default ProvisionalCardTable;
