import { useEffect, useState } from "react";

/**
 * useProvisionalSortOffer — the timing/state of a game's end-of-round sort offer
 * (docs/PROVISIONAL_CARDS.md § 5).
 *
 * All four games sequence the offer identically: the offer opens as soon as the round
 * ends, stacked over the run's own end popup. This hook owns that transition plus the
 * three pieces of state around it — open / minimized / dismissed — so the pages only
 * have to say WHEN the round ended and WHICH words it borrowed.
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
        // No delay: the offer opens on the same beat as the end popup.
        setOpen(true);
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
