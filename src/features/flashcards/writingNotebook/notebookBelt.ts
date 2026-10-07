import { useEffect, useState } from "react";
import { useAuth } from "../../../AuthContext";
import { fetchNotebookSummary } from "../../../api/writingNotebook";
import type { GameCardData } from "../../../games/shared/GameCard";
import { isFeatureEnabled } from "../../../../server/contracts/featureFlags";

/**
 * The Writing Notebook's card on the Writing Center's games belt
 * (docs/WRITING_NOTEBOOK.md § "Entry point"). The notebook is not a game — it is not in
 * GAME_REGISTRY and has no GAME_FLAG — but it launches from the belt beside the Writing
 * Grid, so it borrows the belt's `GameCard` shape: a play-only blue card whose header
 * pill is the notebook's TOTAL (the sum of every sheet's counter) instead of a win count.
 */

/** The card's id on the belt, and the `returnedFromGame` the page's Back carries. */
export const NOTEBOOK_BELT_ID = "writing-notebook";
/** The page's route (src/routes/routeMeta.ts). */
export const NOTEBOOK_PATH = "/flashcards/writing/notebook";
/** The card's glyph, also the page header counter's (WritingNotebookPage → NotebookHeaderCount). */
export const NOTEBOOK_GLYPH = "edit_note";

/** The belt card. `total` undefined (still loading / failed) draws no pill. */
export function buildNotebookCard(total: number | undefined, onOpen: () => void): GameCardData {
    return {
        gameId: NOTEBOOK_BELT_ID,
        title: "Writing Notebook",
        glyph: NOTEBOOK_GLYPH,
        hue: "blu",
        options: [],
        tally: total === undefined ? undefined : { count: total, glyph: NOTEBOOK_GLYPH, noun: ["time written", "times written"] },
        play: { ariaLabel: "Open the Writing Notebook", onSelect: onOpen },
    };
}

/**
 * The notebook total for the belt card, fetched once per visit. Keyed on the account,
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
