import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
    NotificationApiContext,
    NotificationStackContext,
    resolveNotification,
    upsertNotification,
    type ActiveNotification,
    type NotificationContextValue,
    type NotificationCloseReason,
    type NotificationInput,
} from "./notificationModel";

/**
 * NotificationProvider — owns the app's one notification stack (docs/NOTIFICATIONS.md).
 *
 * LAYER: shared client provider (src/components), mounted ONCE in src/App.tsx around
 * Layout. It only keeps state and timers; NotificationViewport (rendered by the shell —
 * MobileDemoFrame, or Layout's plain shell) draws it, so banners host at the phone frame
 * and are never sealed inside a transformed page surface (src/components/overlayHost.ts).
 *
 * Two contexts, so the `notify`/`dismiss` api has ONE identity for the app's lifetime:
 * a page's effect can list `notify` in its deps without re-running when the stack changes.
 *
 * Timers: one per auto-hiding notification, keyed by id. Re-notifying an id restarts its
 * timer (a repeated "50 words open" stays up its full window after the latest attempt);
 * a sticky one (`autoHideMs: null`) has none.
 *
 * `onClose` fires exactly once per notification, from outside any setState updater
 * (React may run an updater twice in StrictMode), which is why the stack is mirrored in
 * `stackRef` and every transition is computed from the ref.
 */
export default function NotificationProvider({ children }: { children: ReactNode }) {
    const [stack, setStack] = useState<readonly ActiveNotification[]>([]);
    const stackRef = useRef<readonly ActiveNotification[]>(stack);
    const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
    const nextId = useRef(0);

    const commit = useCallback((next: readonly ActiveNotification[]) => {
        stackRef.current = next;
        setStack(next);
    }, []);

    const clearTimer = useCallback((id: string) => {
        const timer = timers.current.get(id);
        if (timer !== undefined) {
            clearTimeout(timer);
            timers.current.delete(id);
        }
    }, []);

    // Take one notification down and tell its owner why.
    const close = useCallback((id: string, reason: NotificationCloseReason) => {
        const target = stackRef.current.find((n) => n.id === id);
        if (!target) return;
        clearTimer(id);
        commit(stackRef.current.filter((n) => n.id !== id));
        target.onClose?.(reason);
    }, [clearTimer, commit]);

    const notify = useCallback((input: NotificationInput): string => {
        const resolved = resolveNotification(input, `notification-${++nextId.current}`);
        const { stack: next, evicted } = upsertNotification(stackRef.current, resolved);
        commit(next);
        for (const gone of evicted) {
            clearTimer(gone.id);
            gone.onClose?.("evicted");
        }
        clearTimer(resolved.id);
        if (resolved.autoHideMs !== null) {
            timers.current.set(resolved.id, setTimeout(() => {
                timers.current.delete(resolved.id);
                close(resolved.id, "timeout");
            }, resolved.autoHideMs));
        }
        return resolved.id;
    }, [commit, clearTimer, close]);

    const dismiss = useCallback((id: string) => close(id, "dismissed"), [close]);

    // The viewport's tap handler. Not on the public api: a caller dismisses, a learner taps.
    const api = useMemo<NotificationContextValue>(
        () => ({ notify, dismiss, tap: (id: string) => close(id, "tap") }),
        [notify, dismiss, close],
    );

    useEffect(() => {
        const pending = timers.current;
        return () => {
            pending.forEach(clearTimeout);
            pending.clear();
        };
    }, []);

    return (
        <NotificationApiContext.Provider value={api}>
            <NotificationStackContext.Provider value={stack}>{children}</NotificationStackContext.Provider>
        </NotificationApiContext.Provider>
    );
}
