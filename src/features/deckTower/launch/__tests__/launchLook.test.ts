import { describe, expect, it } from "vitest";
import { launchLook } from "../launchLook";
import { BOOT_COVER_GROUND } from "../../../../components/bootCover/bootCoverGround";

// The main chunk paints BOOT_COVER_GROUND while the cover's scene loads; the scene then draws
// launchLook's sky over it. Equal, or the cover visibly changes colour as it lands
// (docs/LOGIN_REWORK.md § 1).
describe("launchLook", () => {
    it("paints the same sky as the boot cover's pre-load ground", () => {
        expect(launchLook().world.sky.toLowerCase()).toBe(BOOT_COVER_GROUND.toLowerCase());
    });
});
