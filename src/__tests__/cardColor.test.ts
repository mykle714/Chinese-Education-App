import { describe, expect, it } from "vitest";
import { CARD_COLOR_OPTIONS, resolveCardColor } from "../utils/cardColor";
import { CARD_COLOR_VALUES } from "../types";

/**
 * Guards the one place the card-fill palette is genuinely duplicated.
 *
 * `CARD_COLOR_VALUES` (server/contracts/wire.ts) is the server's allow-list: any
 * incoming `cardColor` not in it is stored as NULL. `CARD_COLOR_OPTIONS`
 * (src/utils/cardColor.ts) is the UI swatch row, built from design tokens so the
 * chips stay re-themeable — which is why it can't simply BE the hex list.
 *
 * The two were previously kept in sync by hand, with a comment saying so. If they
 * drift, a swatch the user can pick is silently rejected by the server and the card
 * reverts to the theme default — a bug with no error message anywhere. This test
 * makes that drift a red build instead.
 *
 * See docs/CARD_ICON_LAYOUT.md and docs/ARCHITECTURE_REVIEW.md finding 2.
 */
describe("card colour palette", () => {
  const explicitValues = CARD_COLOR_OPTIONS.filter((o) => !o.auto).map((o) => o.value);

  it("offers exactly the fills the server accepts", () => {
    expect([...explicitValues].sort()).toEqual([...CARD_COLOR_VALUES].sort());
  });

  it("has exactly one auto option, and it is the only null value", () => {
    const autos = CARD_COLOR_OPTIONS.filter((o) => o.auto);
    expect(autos).toHaveLength(1);
    expect(autos[0].value).toBeNull();
    expect(explicitValues.every((v) => v !== null)).toBe(true);
  });

  it("uses uppercase 6-digit hex, matching the stored form", () => {
    // The server compares stored values against CARD_COLOR_VALUES by string equality,
    // so a lowercase swatch would never match.
    for (const value of explicitValues) {
      expect(value).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it("resolves every offered fill, and falls through to the theme default otherwise", () => {
    for (const value of explicitValues) {
      expect(resolveCardColor(value)).toBe(value);
    }
    expect(resolveCardColor(null)).toBeUndefined();
    expect(resolveCardColor(undefined)).toBeUndefined();
    expect(resolveCardColor("#NOTAHEX")).toBeUndefined();
  });
});
