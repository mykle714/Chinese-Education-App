import { useEffect, useRef } from "react";
import { useNotify } from "../../../components/notifications/useNotify";
import { MAX_EIP_TABS } from "./useEipTabs";

/**
 * useEipOverflowNotice — tells the learner the eip's word trail is full (MAX_EIP_TABS)
 * when they try to open one more entry. Replaces TooManyTabsSnackbar (deleted 2026-11-14
 * with the MUI Snackbar; docs/NOTIFICATIONS.md).
 *
 * `signal` is useEipTabs' `overflowSignal`, a counter that ticks on each rejected push, so
 * back-to-back overflows each re-show (and restart) the banner. Only an INCREASE fires — a
 * remount that inherits a non-zero counter does not replay an old overflow.
 *
 * The id is shared, so the flp page and its EipSheet (both call this) show ONE banner.
 *
 * It used to fire when the strip ran out of WIDTH, which happened after a handful of
 * words; the strip scrolls now (EipTabStrip) and the cap is 50, so in practice this is a
 * safety net rather than something a reader meets while reading.
 *
 * LAYER: flp feature hook. Callers: FlashcardsLearnPage.tsx, EipSheet.tsx.
 */
export function useEipOverflowNotice(signal: number): void {
    const { notify } = useNotify();
    const seen = useRef(signal);
    useEffect(() => {
        if (signal <= seen.current) return;
        seen.current = signal;
        notify({
            id: "eip-too-many-tabs",
            tone: "info",
            message: `That's ${MAX_EIP_TABS} words open — go back a few, or tap off the panel to start fresh.`,
            autoHideMs: 2500,
        });
    }, [signal, notify]);
}
