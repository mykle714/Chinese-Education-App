import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../AuthContext";
import { fetchFlpReadyCounts } from "../../api/flpReadyCounts";
import { useNotify } from "../../components/notifications/useNotify";
import {
    deckFillGoalCopy,
    deckFillState,
    deckFillWarningCopy,
    deckSizeToday,
} from "./deckFillNotices";

/**
 * useDeckFillNotices — acp's two deck-size notifications (docs/SORT_CARDS_REQUIREMENTS.md
 * § 5.4), shown as sticky app notifications (docs/NOTIFICATIONS.md):
 *
 *   GOAL     "Sort at least N new cards…", then counting down "N more…" with each counted
 *            sort. Shown on arrival only when today's deck is under DECK_FILL_TARGET; pops
 *            by itself once the target is reached.
 *   WARNING  shown whenever today's deck is at DECK_FILL_WARN_AT or more: on arrival
 *            ("already has N… you don't need to add any more" — owner, 2026-11-14, after
 *            arriving at 47 and seeing nothing) or once a counted sort carries it over
 *            ("…may be hard to keep up with"). It replaces the goal. Undo dropping back
 *            under the line takes it down again.
 *
 * Either one, once TAPPED away, stays away for the rest of the visit; anything else
 * (reaching the goal, undo) is a state change and can bring it back.
 *
 * Arrival deck: ONE read of the core world's ready counts on mount, with `ignoreFocus`
 * (focus mode scopes the tower's figure to today's 30-card set, but this is about the whole
 * deck). It is not re-read after a sort: the visit's sorts are added on the client
 * (`countedSorts`, from the page's session decks), which is also how Undo is handled.
 *
 * Inert (`enabled: false`) in set mode — sorting a game's lent cards is not deck-building —
 * and when the route's language is not the account's: the ready counts are read for the
 * account's language (OnDeckVocabController.getFlpReadyCounts → getUserLanguage).
 *
 * LAYER: acp feature hook. Caller: AddCardsPage.tsx.
 */

const GOAL_ID = "acp-deck-fill-goal";
const WARNING_ID = "acp-deck-fill-warning";

export function useDeckFillNotices({ enabled, countedSorts }: { enabled: boolean; countedSorts: number }): void {
    const { isAuthenticated } = useAuth();
    const { notify, dismiss } = useNotify();
    // Today's deck on arrival, or null until (or unless) it has been read.
    const [arrivalDeck, setArrivalDeck] = useState<number | null>(null);
    const goalTapped = useRef(false);
    const warningTapped = useRef(false);

    // Keyed on isAuthenticated, never the token (CLAUDE.md "Never reload on token refresh").
    useEffect(() => {
        if (!enabled || !isAuthenticated) return;
        let cancelled = false;
        fetchFlpReadyCounts("core", { ignoreFocus: true })
            .then((result) => {
                if (cancelled) return;
                setArrivalDeck(deckSizeToday(result.counts ?? {}, result.upcoming ?? [], Date.now()));
            })
            // No figure, no notices: a failed read must not tell the learner a wrong number.
            .catch((err) => console.error("acp deck-fill notices: couldn't read ready counts", err));
        return () => { cancelled = true; };
    }, [enabled, isAuthenticated]);

    useEffect(() => {
        if (!enabled || arrivalDeck === null) return;
        const { total, toGo, full } = deckFillState(arrivalDeck, countedSorts);
        const warn = full;

        if (warn && !warningTapped.current) {
            notify({
                id: WARNING_ID,
                tone: "warning",
                message: deckFillWarningCopy(total, countedSorts),
                autoHideMs: null,
                onClose: (reason) => { if (reason === "tap") warningTapped.current = true; },
            });
        } else {
            dismiss(WARNING_ID);
        }

        if (toGo > 0 && !warn && !goalTapped.current) {
            notify({
                id: GOAL_ID,
                tone: "info",
                icon: "style", // the stacked-cards glyph (Material Symbols canonical name)
                message: deckFillGoalCopy(toGo, countedSorts),
                autoHideMs: null,
                onClose: (reason) => { if (reason === "tap") goalTapped.current = true; },
            });
        } else {
            dismiss(GOAL_ID);
        }
    }, [enabled, arrivalDeck, countedSorts, notify, dismiss]);

    // Leaving acp takes both banners with it.
    useEffect(() => () => { dismiss(GOAL_ID); dismiss(WARNING_ID); }, [dismiss]);
}
