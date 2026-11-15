import { useContext, useEffect, useRef } from "react";
import {
    NotificationApiContext,
    type NotificationApi,
    type NotificationTone,
} from "./notificationModel";

/**
 * useNotify — a page's handle on the app notification system (docs/NOTIFICATIONS.md).
 *
 *     const { notify, dismiss } = useNotify();
 *     notify({ tone: "error", message: "Couldn't save — try again." });
 *
 * Both functions keep one identity for the app's lifetime, so they are safe in effect deps.
 *
 * LAYER: shared client hook (src/components). Throws outside NotificationProvider: a
 * notification that silently goes nowhere is the bug this system exists to prevent.
 */
export function useNotify(): NotificationApi {
    const ctx = useContext(NotificationApiContext);
    if (!ctx) throw new Error("useNotify must be used inside <NotificationProvider> (src/App.tsx)");
    return { notify: ctx.notify, dismiss: ctx.dismiss };
}

/**
 * useNotificationFor — mirror one piece of nullable message STATE as a notification.
 * The shape every retired `<Snackbar open={error !== null} onClose={clearError}>` had:
 *
 *     useNotificationFor(saveError, () => setSaveError(null), { id: "cdp-icon-save-error", tone: "error" });
 *
 * - `message` becomes non-null (or changes) → the banner shows / updates in place.
 * - The banner goes away (tap, timeout, eviction) → `clear()` runs, so the state empties.
 * - The state is cleared by its owner first → the banner is dismissed.
 *
 * `id` must be unique per call site, and stable: two mounts of the same site (the eip
 * inside the flp AND the flp page itself) then share one banner instead of stacking two.
 * `clear` is read through a ref, so an inline arrow does not re-run the effect.
 */
export function useNotificationFor(
    message: string | null | undefined,
    clear: () => void,
    options: { id: string; tone: NotificationTone; autoHideMs?: number | null; icon?: string },
): void {
    const { notify, dismiss } = useNotify();
    const clearRef = useRef(clear);
    clearRef.current = clear;
    const { id, tone, autoHideMs, icon } = options;

    useEffect(() => {
        if (!message) {
            dismiss(id);
            return;
        }
        notify({
            id,
            tone,
            message,
            icon,
            autoHideMs,
            // "dismissed" means WE took it down (message went null, or unmount) — the state
            // is already clear or about to be gone, so only the learner/timer paths clear it.
            onClose: (reason) => { if (reason !== "dismissed") clearRef.current(); },
        });
    }, [message, id, tone, autoHideMs, icon, notify, dismiss]);

    // Leaving the page takes its banner with it.
    useEffect(() => () => dismiss(id), [id, dismiss]);
}
