import { describe, expect, it } from "vitest";
import { postLoginPath } from "../loginRedirect";

// docs/LOGIN_REWORK.md § 2 (R1) + Q2: return to a cold-start deep link, else `/`.
describe("postLoginPath", () => {
    it("returns the recorded deep link, with its search and hash", () => {
        expect(postLoginPath({ from: "/reader/abc?x=1#p" })).toBe("/reader/abc?x=1#p");
    });
    it("falls back to / with no state (a mid-session expiry, logout)", () => {
        expect(postLoginPath(null)).toBe("/");
        expect(postLoginPath(undefined)).toBe("/");
        expect(postLoginPath({})).toBe("/");
    });
    it("refuses anything that is not an in-app absolute path", () => {
        expect(postLoginPath({ from: "https://evil.example" })).toBe("/");
        expect(postLoginPath({ from: "//evil.example" })).toBe("/");
        expect(postLoginPath({ from: 42 })).toBe("/");
    });
    it("never returns to an auth page", () => {
        expect(postLoginPath({ from: "/login" })).toBe("/");
        expect(postLoginPath({ from: "/register?a=b" })).toBe("/");
    });
});
