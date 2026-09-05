import { describe, expect, it } from "vitest";
import {
    CJK_FONT_CATALOG,
    CJK_FONT_OPTIONS,
    cjkFontStack,
    resolveCjkFont,
} from "../theme/cjkFontOptions";
import { CHINESE_FONT_IDS, DEFAULT_CHINESE_FONT_ID } from "../types";

/**
 * Guards the seam between the server's allow-list and the client's option catalog.
 *
 * `CHINESE_FONT_IDS` (server/contracts/wire.ts) is what PUT /api/users/displaySettings
 * will accept into `users."chineseFont"` (migration 157). `CJK_FONT_OPTIONS`
 * (src/theme/cjkFontOptions.ts) is what Settings offers, and it carries presentation
 * — labels, native names, stylesheet URLs — that the server has no business knowing,
 * which is why it cannot simply BE the id list.
 *
 * If the two drift, a typeface the user can tap is rejected by the server with a 400
 * and the setting silently refuses to change. This test makes that drift a red build.
 * Same guard `cardColor.test.ts` provides for CARD_COLOR_VALUES.
 *
 * See docs/CJK_TYPEFACE_LAB.md.
 */
describe("Chinese typeface catalog", () => {
    it("offers exactly the faces the server accepts", () => {
        const selectable = CJK_FONT_OPTIONS.map((o) => o.id);
        expect([...selectable].sort()).toEqual([...CHINESE_FONT_IDS].sort());
    });

    it("has a default that is itself selectable", () => {
        // The column DEFAULT must be a face a user could also pick, or a new account
        // starts on something Settings cannot show as selected.
        expect(CHINESE_FONT_IDS).toContain(DEFAULT_CHINESE_FONT_ID);
    });

    it("lists the default first", () => {
        // Settings leads with the default and badges it, so it must actually BE first.
        // Asserted rather than trusted to comment, so a future reshuffle of the
        // catalog cannot silently bury it mid-list.
        expect(CJK_FONT_OPTIONS[0]?.id).toBe(DEFAULT_CHINESE_FONT_ID);
    });

    it("never offers a face that is not free to ship", () => {
        // Currently vacuous — FZKai-Z03 (方正楷体), the one Founder face this catalog
        // ever carried, was removed outright on 2026-09-04 rather than kept as a
        // non-selectable benchmark. Kept as a live guard for the next candidate whose
        // licence is not OFL: a restricted face may sit in the catalog for comparison,
        // but may never reach a user. This is the whole reason `license` is on the option.
        const restricted = CJK_FONT_CATALOG.filter((f) => f.license === "restricted");
        expect(restricted.every((f) => !f.selectable)).toBe(true);
    });

    it("has unique ids and non-empty family names", () => {
        const ids = CJK_FONT_CATALOG.map((f) => f.id);
        expect(new Set(ids).size).toBe(ids.length);
        // A blank family would silently render the fallback stack with no error.
        expect(CJK_FONT_CATALOG.every((f) => f.family.trim().length > 0)).toBe(true);
    });

    it("falls back to the default for an unknown or missing id", () => {
        // Rows written before a face was retired, and clients older than the catalog,
        // both land here. resolveCjkFont must never return undefined.
        expect(resolveCjkFont("no-such-face").id).toBe(DEFAULT_CHINESE_FONT_ID);
        expect(resolveCjkFont(null).id).toBe(DEFAULT_CHINESE_FONT_ID);
        expect(resolveCjkFont(undefined).id).toBe(DEFAULT_CHINESE_FONT_ID);
    });

    it("keeps the default stack as a tail fallback in every built stack", () => {
        // A glyph the chosen face lacks must degrade per-glyph to Noto Sans SC rather
        // than to the OS font or tofu.
        for (const option of CJK_FONT_CATALOG) {
            const stack = cjkFontStack(option);
            expect(stack.startsWith(`"${option.family}"`)).toBe(true);
            expect(stack).toContain('"Noto Sans SC"');
            expect(stack.endsWith("sans-serif")).toBe(true);
        }
    });
});
