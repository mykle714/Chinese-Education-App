import type { PawnEntranceCue } from "./iso";
import type { TowerModeId } from "./towerModes";
import { easeOutBack, usePopUpMotion, useTween, type PopUpMotion } from "./usePopUpMotion";

/**
 * useModeSwitchMotion — the Mix / Review floor switch's animated numbers (docs/DECK_TOWER.md
 * § "Mix / Review switch"). Layer: page logic; it draws nothing — IsoModeSwitch takes
 * `flip`, `sink`, `hatch` and `skyFall`.
 *
 * Rising, sinking and falling from the sky are usePopUpMotion's (shared with the focus
 * lever): it stands only while its world's Learn Now deck is up. `flip` springs between
 * 0 (Mix) and 1 (Review) with a small overshoot whenever the mode changes.
 *
 * DeckTowerPage runs one per world (like the lever), so a world swipe does not replay a
 * rise on the world arrived at.
 */

const FLIP_MS = 260;

export interface ModeSwitchMotion extends PopUpMotion {
    flip: number;
}

export function useModeSwitchMotion({
    visible,
    mode,
    instant = false,
    skyEntrance,
}: {
    visible: boolean;
    mode: TowerModeId;
    instant?: boolean;
    skyEntrance?: PawnEntranceCue;
}): ModeSwitchMotion {
    const popUp = usePopUpMotion({ visible, instant, skyEntrance });
    const flip = useTween(mode === "review" ? 1 : 0, FLIP_MS, easeOutBack);
    return { ...popUp, flip };
}
