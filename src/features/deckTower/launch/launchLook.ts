import type { IsoWash } from "../iso";
import { litWorld, towerLight } from "../timeOfDay";
import { TOWER_WORLDS, type TowerWorld } from "../towerWorlds";

/**
 * launchLook.ts — the launch screen's colours (docs/LAUNCH_SCREEN.md § "Colour").
 *
 * The main world in CLEAR weather (the weather is not known yet at launch), ALWAYS by day,
 * whatever the clock says (owner, 2026-11-11). Day's sky is `COLORS.bluMk`, main's sky, from
 * the colour framework. It is the cover's look only: td underneath already shows the true time
 * of day (and the weather, if known) when the circle opens (DeckTowerPage → `launchCovering`).
 * Its sky must equal BOOT_COVER_GROUND (src/components/bootCover/bootCoverGround.ts), painted
 * while the cover's chunk loads (guarded by __tests__/launchLook.test.ts).
 *
 * Layer: feature page logic (src/features/deckTower/launch). Pure.
 * Depends on: timeOfDay.ts (`litWorld`, `towerLight`), towerWorlds.ts.
 * Depended on by: BootLaunchScreen.tsx (`BOOT_LOOK`), LaunchScreen.tsx (the `LaunchLook` type).
 */

/** The launch screen's look: the main world lit by day, and day's wash. */
export interface LaunchLook {
    /** `sky` is the cover's colour; platform and floor are lit. */
    world: TowerWorld;
    /** Day's wash, for the platform and the pawn. */
    wash: IsoWash;
}

/** The main world in clear weather, by day. */
export function launchLook(): LaunchLook {
    const light = towerLight({ from: "day", to: "day", t: 0 });
    return { world: litWorld(TOWER_WORLDS.core, light), wash: light.wash };
}
