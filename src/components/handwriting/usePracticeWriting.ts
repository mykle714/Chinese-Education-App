import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../AuthContext";
import { fetchCompletedLevels } from "./completions";
import { markFlashcard, type MarkSurface } from "../../api/flashcards";

/**
 * usePracticeWriting — the state `PracticeWritingPopup` needs around it, for one target.
 *
 * Every host of the popup does the same three things: fetch the target's completed
 * assistance levels (the stars), keep them in sync as the popup clears new ones, and
 * write a Writing mastery mark on each Verify when there is a vet card to mark. They
 * used to live inside `PracticeWritingButton`; the Writing Center's character grid
 * (docs/READING_WRITING_CENTERS.md) opens the same popup from a tile, so the behaviour
 * moved here and both hosts read it.
 *
 * `target` may be null (nothing selected — the grid between taps), which disables the
 * fetch and resets the stars.
 *
 * Docs: docs/HANDWRITING_RECOGNITION.md ("Entry points"), docs/MASTERY_REWORK.md.
 */
export function usePracticeWriting(
    target: string | null,
    options: {
        /** Recognition is zh-only and 1–4 characters; anything else disables the hook. */
        language: string | null | undefined;
        /** The vet card a Verify marks; omit when there is no card (no mark is written). */
        vocabEntryId?: number;
        /** Telemetry surface for the mark. */
        surface?: MarkSurface;
    }
) {
    const { language, vocabEntryId, surface = "practice-writing" } = options;
    const { token, isAuthenticated } = useAuth();
    const [completedLevels, setCompletedLevels] = useState<Set<string>>(new Set());

    // [...target] counts code points so surrogate-pair CJK glyphs count as one. Words
    // longer than 4 chars are excluded — the popup's grid only has four slots.
    const charCount = target ? [...target].length : 0;
    const eligible = language === "zh" && charCount >= 1 && charCount <= 4;

    // Load existing stars so a count can show before the popup opens.
    useEffect(() => {
        setCompletedLevels(new Set());
        if (!eligible || !token || !target) return;
        let cancelled = false;
        fetchCompletedLevels("zh", target, token)
            .then((levels) => {
                if (!cancelled) setCompletedLevels(new Set(levels));
            })
            .catch(() => {
                /* non-fatal: just show no stars */
            });
        return () => {
            cancelled = true;
        };
    // isAuthenticated not `token`: the stars needn't re-fetch on a silent refresh.
    // See CLAUDE.md "Never reload on token refresh".
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [eligible, target, isAuthenticated]);

    // Called by the popup when a level is freshly completed (it returns the new set).
    const onLevelsChange = useCallback((levels: string[]) => {
        setCompletedLevels(new Set(levels));
    }, []);

    // Record a Writing mastery mark on each Verify attempt (positive iff the whole word
    // was written correctly). Fire-and-forget, only when we know the vet card. Gated on
    // isAuthenticated rather than the token string (the raw token rotates every ~15 min);
    // markFlashcard supplies the header.
    const onWritingMark = useCallback((isCorrect: boolean) => {
        if (vocabEntryId == null || !isAuthenticated) return;
        // excludeIds defaults to []: the drill doesn't use the endpoint's replacement card.
        markFlashcard({ cardId: vocabEntryId, isCorrect, type: "writing", surface })
            .catch((err) => console.error(`[PracticeWriting] writing mark failed → card ${vocabEntryId}:`, err));
    }, [vocabEntryId, isAuthenticated, surface]);

    return { eligible, completedLevels, onLevelsChange, onWritingMark };
}
