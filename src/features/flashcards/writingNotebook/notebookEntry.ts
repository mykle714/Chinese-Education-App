import { useEffect, useState } from "react";
import { useAuth } from "../../../AuthContext";
import { fetchNotebookSummary } from "../../../api/writingNotebook";
import { isFeatureEnabled } from "../../../../server/contracts/featureFlags";

/**
 * The Writing Notebook's entry point (docs/WRITING_NOTEBOOK.md § "Entry point"): the
 * paper stack on the Deck Tower's writing world (DeckTowerPage → `NOTEBOOK_PATH`,
 * `useNotebookTotal`, which sizes the stack). The notebook is not a game — it is not in
 * GAME_REGISTRY and has no GAME_FLAG. Until 2026-11-04 it also had a card on the Writing
 * Center's games belt (deleted with the Centers).
 */

/** The page's route (src/routes/routeMeta.ts). */
export const NOTEBOOK_PATH = "/flashcards/writing/notebook";
/** The card's glyph, also the page header counter's (WritingNotebookPage → NotebookHeaderCount). */
export const NOTEBOOK_GLYPH = "edit_note";

/**
 * The notebook total (the sum of every sheet's counter), fetched once per visit. Keyed on the account,
 * never the token (CLAUDE.md "never reload on a silent token refresh"). Off when the
 * feature flag is off or the account is not studying Chinese.
 */
export function useNotebookTotal(): number | undefined {
    const { user } = useAuth();
    const [total, setTotal] = useState<number | undefined>(undefined);
    const userId = user?.id;
    const zh = user?.selectedLanguage === "zh";
    useEffect(() => {
        if (!userId || !zh || !isFeatureEnabled("writingNotebook")) return;
        let cancelled = false;
        fetchNotebookSummary("zh")
            .then((summary) => { if (!cancelled) setTotal(summary.totalCount); })
            .catch((err) => console.error("Writing Notebook: summary failed", err));
        return () => { cancelled = true; };
    }, [userId, zh]);
    return total;
}
