import { useCallback, useEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import PracticeWritingPopup from "../../../components/handwriting/PracticeWritingPopup";
import { usePracticeWriting } from "../../../components/handwriting/usePracticeWriting";
import { buildPool, initialLayout, type PlacedTile } from "./wordGridModel";
import { useWordGridGeometry, WORD_GRID_SIDE_GUTTER, WORD_GRID_TOP_GAP } from "./useWordGridGeometry";
import type { VocabEntry } from "../../../types";
import { COLORS } from "../../../theme/colors";
import { FONTS } from "../../../theme/fonts";
import { WEIGHT } from "../../../theme/scale";

/**
 * The Writing Center's practice grid (docs/READING_WRITING_CENTERS.md § Phase 5) — the
 * same 6×6 word grid as the Reading Center's (`wordGridModel`, `useWordGridGeometry`),
 * read through the WRITING bar: the learner's own cards, a word spanning one cell per
 * character up to two and compressed beyond (`cellSpan`), sampled by writing band in the Study Mix proportions, fresh on every visit.
 * Tapping a tile opens `PracticeWritingPopup` on that word.
 *
 * Words are capped at FOUR characters — the popup's 2×2 grid holds no more — and cards
 * still resting on the writing clock are left out, since their Verify marks would be
 * dropped at the mark chokepoint.
 *
 * Every tile IS a vet card, so every Verify writes a Writing mark on it (surface
 * "practice-writing"). This replaced `CharacterPracticeGrid` (2026-10-03), which exploded
 * cards into single characters and could only mark a character the learner owned as a
 * one-character card.
 *
 * zh only (the recognizer is zh_CN). Layer: feature component
 * (src/features/flashcards/centers).
 */

/** PracticeWritingPopup's limit: its 2×2 grid has four slots. */
const MAX_PRACTICE_LENGTH = 4;

interface WritingPracticeGridProps {
    cards: readonly VocabEntry[];
    language: string | null | undefined;
    /** True until the library has loaded — the grid waits rather than drawing an empty board. */
    loading: boolean;
}

const WritingPracticeGrid: React.FC<WritingPracticeGridProps> = ({ cards, language, loading }) => {
    // Built ONCE per mount from the first non-empty library — a background refetch must
    // not reshuffle the board ("fresh every visit" = fresh every mount). Same rule as
    // ReadingSwipeGrid.
    const built = useRef(false);
    const keySeq = useRef(0);
    const nextKey = useCallback(() => `w${keySeq.current++}`, []);
    const [tiles, setTiles] = useState<PlacedTile[]>([]);

    useEffect(() => {
        if (built.current || cards.length === 0 || language !== "zh") return;
        built.current = true;
        const pool = buildPool(cards, Date.now(), Math.random, { bar: "writing", maxLength: MAX_PRACTICE_LENGTH });
        const layout = initialLayout(pool, Math.random, nextKey);
        setTiles(layout);
    }, [cards, language, nextKey]);

    const { gridRef, cell, gridHeight, cellRect } = useWordGridGeometry(tiles.length > 0);

    // The tile whose popup is open.
    const [selected, setSelected] = useState<PlacedTile | null>(null);
    const practice = usePracticeWriting(selected?.word ?? null, {
        language,
        vocabEntryId: selected?.cardId,
    });

    if (language !== "zh" || (loading && tiles.length === 0)) return null;

    return (
        <>
            {tiles.length === 0 ? (
                <Box
                    className="writing-practice-grid__empty"
                    sx={{ margin: `${WORD_GRID_TOP_GAP}px ${WORD_GRID_SIDE_GUTTER}px 0`, padding: "18px", borderRadius: "14px", border: `1px dashed ${COLORS.border}`, textAlign: "center", fontFamily: FONTS.sans, fontSize: 13, color: COLORS.textSecondary }}
                >
                    Add more cards to your library!
                </Box>
            ) : (
                <Box sx={{ padding: `${WORD_GRID_TOP_GAP}px ${WORD_GRID_SIDE_GUTTER}px 0` }}>
                    <Box ref={gridRef} className="writing-practice-grid" sx={{ position: "relative", width: "100%", height: gridHeight }}>
                        {cell > 0 && tiles.map((tile) => {
                            const isSelected = selected?.key === tile.key;
                            const rect = cellRect(tile);
                            return (
                                <Box
                                    key={tile.key}
                                    component="button"
                                    type="button"
                                    className={`writing-practice-grid__tile${isSelected ? " writing-practice-grid__tile--selected" : ""}`}
                                    onClick={() => setSelected(tile)}
                                    aria-label={`Practice writing ${tile.word}`}
                                    sx={{
                                        position: "absolute",
                                        ...rect,
                                        borderRadius: "10px",
                                        backgroundColor: COLORS.white,
                                        // The design's `.ct.tap`: the open tile swaps its hairline
                                        // for a 2px inset ink ring, so the learner can see which
                                        // word the popup over it is practising.
                                        border: isSelected ? "1px solid transparent" : `1px solid ${COLORS.border}`,
                                        boxShadow: isSelected ? `inset 0 0 0 2px ${COLORS.onSurface}` : "none",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        padding: 0,
                                        cursor: "pointer",
                                        fontFamily: FONTS.cjk,
                                        // 28px as designed, shrunk only if a compressed
                                        // span (3 chars in 2 cells, 4 in 3) on a narrow
                                        // screen cannot hold the word — same rule as
                                        // ReadingSwipeGrid's front face.
                                        fontSize: Math.min(28, (rect.width - 12) / tile.length),
                                        fontWeight: WEIGHT.bold,
                                        lineHeight: 1,
                                        letterSpacing: "0.02em",
                                        color: COLORS.onSurface,
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    {tile.word}
                                </Box>
                            );
                        })}
                    </Box>
                </Box>
            )}

            {selected && practice.eligible && (
                <PracticeWritingPopup
                    // Remount per word: the popup seeds its draft from `character` in its
                    // initial state, so reusing one instance would carry ink over.
                    key={selected.key}
                    open
                    character={selected.word}
                    completedLevels={practice.completedLevels}
                    onLevelsChange={practice.onLevelsChange}
                    onWritingMark={practice.onWritingMark}
                    onClose={() => setSelected(null)}
                />
            )}
        </>
    );
};

export default WritingPracticeGrid;
