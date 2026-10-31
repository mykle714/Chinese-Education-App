import { describe, expect, it } from "vitest";
import { COLORS } from "../../../theme/colors";
import { hexToOklch } from "../../../timeOfDay/wash";
import { platformTone } from "../iso";

// docs/ISO_ART_FRAMEWORK.md § "Palette": a rim stays a lighter tint of its own floor in
// every world, rather than going white on a pale one.
describe("platformTone rim", () => {
    it.each([
        ["core", COLORS.gld],
        ["reading", COLORS.pnk],
        ["writing", COLORS.bluMk],
    ])("%s's rim is lighter than its floor and keeps most of its chroma", (_world, base) => {
        const [floorL, floorC] = hexToOklch(base);
        const [rimL, rimC] = hexToOklch(platformTone(base).rim);
        expect(rimL).toBeGreaterThan(floorL);
        expect(rimC).toBeGreaterThan(floorC * 0.7);
    });
});
