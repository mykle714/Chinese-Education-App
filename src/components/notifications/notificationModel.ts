/**
 * notificationModel — the app notification system's types, constants and pure state
 * transitions (docs/NOTIFICATIONS.md).
 *
 * LAYER: shared client model (src/components). No React components here (fast refresh
 * needs component files to export only components), and nothing feature-specific: a
 * feature describes WHAT to say; this module and the provider own how a notification
 * lives and dies.
 *
 * Replaces MUI `<Snackbar>` + `<Alert>` (removed from the app 2026-11-14). Notifications
 * are drawn as tailless hint bubbles (HintBubbleSurface `tailSide="none"`), the same white,
 * outlined, grow-in / pop-out bubble as the flp hint pawn's.
 *
 * Depended on by: NotificationProvider.tsx, NotificationViewport.tsx, useNotify.ts,
 * src/__tests__/notificationModel.test.ts. Docs: docs/NOTIFICATIONS.md.
 */
import { createContext, type ReactNode } from "react";
import { SAFE_TOP } from "../../theme/safeArea";

/**
 * What a notification is FOR. Our color framework sets every semantic role to ink
 * (`COLORS.dangerInk` & co., src/theme/colors.ts § "Semantic roles"), so the tone is
 * carried by the leading ICON and the words — never by a hue.
 */
export type NotificationTone = "info" | "success" | "warning" | "error";

/** The Material Symbols glyph each tone leads with when the caller names none. */
export const TONE_ICON: Record<NotificationTone, string> = {
    info: "info",
    success: "check_circle",
    warning: "warning",
    error: "error",
};

/**
 * How long a notification stays up when the caller does not say. Errors linger a little
 * longer than the rest — they are the ones a learner most needs to read in full. These
 * match the auto-hide windows the retired Snackbars used (2.5–5 s).
 */
export const DEFAULT_AUTO_HIDE_MS: Record<NotificationTone, number> = {
    info: 4000,
    success: 3000,
    warning: 5000,
    error: 4000,
};

/** At most this many banners at once; a new one past the cap evicts the OLDEST. */
export const MAX_VISIBLE_NOTIFICATIONS = 3;

/**
 * Where the stack's top edge sits: under the page header (status band + a standard
 * header row — the 68px the Reader's Snackbar offset was tuned to), so a banner never
 * covers the back arrow or title.
 */
export const NOTIFICATION_TOP = `calc(68px + ${SAFE_TOP})`;

/**
 * Above the footer bar (100), page dims (~200) and modal sheets, so an error raised from
 * inside the eip or the AccountSheet is still seen — the retired flp Snackbars sat at 2000
 * for the same reason.
 */
export const NOTIFICATION_Z_INDEX = 2000;

/** One request to show (or update) a notification. */
export interface NotificationInput {
    /**
     * Stable identity. Re-notifying with the SAME id updates that banner in place (its
     * text changes, it does not re-animate) — acp's live "N to go" count relies on this.
     * Omitted: a fresh id is generated, so every call shows a new banner.
     */
    id?: string;
    tone?: NotificationTone;
    message: ReactNode;
    /** Material Symbols glyph name; defaults to the tone's (TONE_ICON). */
    icon?: string;
    /**
     * Milliseconds before it leaves by itself. `null` = sticky: it stays until tapped or
     * dismissed by its owner (the "Tap to dismiss" cue is shown on sticky banners only).
     * Omitted: DEFAULT_AUTO_HIDE_MS for the tone.
     */
    autoHideMs?: number | null;
    /**
     * Called once when it goes away for ANY reason — tapped, timed out, evicted, or
     * replaced by `dismiss(id)`. Owners of a piece of "error" state clear it here.
     */
    onClose?: (reason: NotificationCloseReason) => void;
}

export type NotificationCloseReason = "tap" | "timeout" | "evicted" | "dismissed";

/** A notification as the provider stores it: every default resolved. */
export interface ActiveNotification {
    id: string;
    tone: NotificationTone;
    message: ReactNode;
    icon: string;
    autoHideMs: number | null;
    onClose?: (reason: NotificationCloseReason) => void;
}

/** Resolve a request's defaults. `fallbackId` is used when the caller gave no id. */
export function resolveNotification(input: NotificationInput, fallbackId: string): ActiveNotification {
    const tone = input.tone ?? "info";
    return {
        id: input.id ?? fallbackId,
        tone,
        message: input.message,
        icon: input.icon ?? TONE_ICON[tone],
        autoHideMs: input.autoHideMs === undefined ? DEFAULT_AUTO_HIDE_MS[tone] : input.autoHideMs,
        onClose: input.onClose,
    };
}

/**
 * Add `next` to the stack, or update it in place when its id is already showing (same
 * slot, so it neither moves nor re-animates). Returns the new stack plus any notifications
 * pushed out by MAX_VISIBLE_NOTIFICATIONS, oldest first, so the caller can fire their
 * `onClose("evicted")`.
 */
export function upsertNotification(
    stack: readonly ActiveNotification[],
    next: ActiveNotification,
    max: number = MAX_VISIBLE_NOTIFICATIONS,
): { stack: ActiveNotification[]; evicted: ActiveNotification[] } {
    const at = stack.findIndex((n) => n.id === next.id);
    if (at >= 0) {
        const updated = [...stack];
        updated[at] = next;
        return { stack: updated, evicted: [] };
    }
    const grown = [...stack, next];
    const overflow = Math.max(0, grown.length - max);
    return { stack: grown.slice(overflow), evicted: grown.slice(0, overflow) };
}

/** What `useNotify()` hands a caller. */
export interface NotificationApi {
    /** Show (or update, by id) a notification; returns its id. */
    notify: (input: NotificationInput) => string;
    /** Take a notification down (it pops). A no-op for an id that is not showing. */
    dismiss: (id: string) => void;
}

/** The api context's value: the public api plus the viewport's tap handler (not exposed by useNotify). */
export interface NotificationContextValue extends NotificationApi {
    tap: (id: string) => void;
}

/** The provider's state, split from the api so a call site's `notify` never changes identity. */
export const NotificationApiContext = createContext<NotificationContextValue | null>(null);
export const NotificationStackContext = createContext<readonly ActiveNotification[]>([]);
