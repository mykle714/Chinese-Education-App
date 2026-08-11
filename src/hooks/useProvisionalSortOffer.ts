import { useEffect, useState } from "react";
import { SORT_OFFER_DELAY_MS } from "../components/ProvisionalSortOffer";

/**
 * useProvisionalSortOffer — the timing/state of a game's end-of-round sort offer
 * (docs/PROVISIONAL_CARDS.md § 5).
 *
 * All four games sequence the offer identically: the run's own end popup lands first,
 * then a beat later the offer opens over it. This hook owns that beat plus the three
 * pieces of state around it — open / minimized / dismissed — so the pages only have
 * to say WHEN the round ended and WHICH words it borrowed.
 *
 * The whole thing resets when `active` goes false, which is what a replay does: a
 * second run gets its own offer rather than inheriting the first run's dismissal.
 */
export function useProvisionalSortOffer(
    /** True while the round is over — i.e. while the end popup is up. */
    active: boolean,
    /** The lent words this round used. An empty list means no offer at all. */
    words: string[]
): {
    open: boolean;
    minimized: boolean;
    onMinimize: () => void;
    onRestore: () => void;
    /** "Not now" — closes the offer for the rest of this round. */
    dismiss: () => void;
} {
    const [open, setOpen] = useState(false);
    const [minimized, setMinimized] = useState(false);
    const [dismissed, setDismissed] = useState(false);

    // Contents, not identity: the pages rebuild this array on every render.
    const wordsKey = words.join(",");

    useEffect(() => {
        if (!active || wordsKey.length === 0) {
            // Round restarted (or never borrowed anything) — clear the whole offer so
            // the next run is judged on its own.
            setOpen(false);
            setMinimized(false);
            setDismissed(false);
            return;
        }
        if (dismissed) return;
        const timer = setTimeout(() => setOpen(true), SORT_OFFER_DELAY_MS);
        return () => clearTimeout(timer);
    }, [active, wordsKey, dismissed]);

    return {
        open,
        minimized,
        onMinimize: () => setMinimized(true),
        onRestore: () => setMinimized(false),
        dismiss: () => {
            setOpen(false);
            setDismissed(true);
        },
    };
}
