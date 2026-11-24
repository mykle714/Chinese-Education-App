import { useEffect } from "react";
import { CONNECTION_EVENT, type ConnectionEventDetail } from "../../api/http";
import { useNotify } from "./useNotify";

/** The one shared id: every lost-connection moment shows (or updates) this single banner. */
export const CONNECTION_NOTICE_ID = "connection-lost";

/**
 * ConnectionNoticeHost — the app's ONE "No connection" notice (docs/NOTIFICATIONS.md §
 * "Failures"). Instead of each failed action raising its own error, the app says once
 * that it cannot reach the server, and takes it down by itself when it can again.
 *
 * Two signals, either one raises it:
 *   - the browser's `offline` / `online` events (the device has no network at all);
 *   - src/api/http.ts → CONNECTION_EVENT: a request failed at the network level after
 *     every quiet retry (the device is online but the server is unreachable), cleared by
 *     the next request that gets any response.
 * The notice is sticky (it stays until the connection is back) but tappable away like
 * every notification; a dismissed one comes back only at the NEXT loss.
 *
 * Mounted once, inside NotificationProvider (src/App.tsx). Draws nothing itself.
 * LAYER: shared client component (src/components/notifications).
 */
export default function ConnectionNoticeHost(): null {
    const { notify, dismiss } = useNotify();

    useEffect(() => {
        // Whether the browser says the device is offline, and whether the last request
        // through http.ts could not reach the server. Either one means "lost".
        let deviceOffline = typeof navigator !== "undefined" && navigator.onLine === false;
        let serverUnreachable = false;
        let shown = false;

        const sync = () => {
            const lost = deviceOffline || serverUnreachable;
            if (lost === shown) return;
            shown = lost;
            if (lost) {
                notify({
                    id: CONNECTION_NOTICE_ID,
                    tone: "warning",
                    icon: "wifi_off",
                    message: "No connection. Your changes may not save.",
                    autoHideMs: null,
                });
            } else {
                dismiss(CONNECTION_NOTICE_ID);
            }
        };

        const onOffline = () => { deviceOffline = true; sync(); };
        // Back online: the server is presumed reachable again until a request says otherwise.
        const onOnline = () => { deviceOffline = false; serverUnreachable = false; sync(); };
        const onConnection = (e: Event) => {
            serverUnreachable = (e as CustomEvent<ConnectionEventDetail>).detail.lost;
            sync();
        };

        window.addEventListener("offline", onOffline);
        window.addEventListener("online", onOnline);
        window.addEventListener(CONNECTION_EVENT, onConnection);
        sync(); // a cold start with no network
        return () => {
            window.removeEventListener("offline", onOffline);
            window.removeEventListener("online", onOnline);
            window.removeEventListener(CONNECTION_EVENT, onConnection);
            dismiss(CONNECTION_NOTICE_ID);
        };
    }, [notify, dismiss]);

    return null;
}
