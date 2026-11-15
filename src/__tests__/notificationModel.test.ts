// Tests for the app notification system's pure transitions
// (src/components/notifications/notificationModel.ts, docs/NOTIFICATIONS.md).
import { describe, it, expect } from "vitest";
import {
    DEFAULT_AUTO_HIDE_MS,
    TONE_ICON,
    resolveNotification,
    upsertNotification,
} from "../components/notifications/notificationModel";

describe("resolveNotification", () => {
    it("fills the tone's icon and auto-hide, and the fallback id", () => {
        const n = resolveNotification({ tone: "error", message: "x" }, "fallback");
        expect(n).toMatchObject({ id: "fallback", tone: "error", icon: TONE_ICON.error, autoHideMs: DEFAULT_AUTO_HIDE_MS.error });
    });
    it("keeps null as sticky rather than defaulting it", () => {
        expect(resolveNotification({ message: "x", autoHideMs: null }, "f").autoHideMs).toBeNull();
    });
});

describe("upsertNotification", () => {
    const make = (id: string, message = id) => resolveNotification({ id, message }, id);

    it("updates an id in place without moving it", () => {
        const { stack } = upsertNotification([make("a"), make("b")], make("a", "a2"));
        expect(stack.map((n) => [n.id, n.message])).toEqual([["a", "a2"], ["b", "b"]]);
    });
    it("evicts the oldest past the cap", () => {
        const { stack, evicted } = upsertNotification([make("a"), make("b")], make("c"), 2);
        expect(stack.map((n) => n.id)).toEqual(["b", "c"]);
        expect(evicted.map((n) => n.id)).toEqual(["a"]);
    });
});
