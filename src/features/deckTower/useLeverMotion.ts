import { easeOut, easeOutBack, usePopUpMotion, useTween, type PopUpMotion } from "./usePopUpMotion";
import type { PawnEntranceCue } from "./iso";

/**
 * useLeverMotion — the focus lever's animated numbers (docs/FOCUS_MODE.md § 5,
 * docs/DECK_TOWER.md § "Focus lever"). Layer: page logic; it draws nothing — IsoLever
 * takes `pull`, `sink`, `hatch` and `skyFall`.
 *
 * Rising, sinking and falling from the sky are usePopUpMotion's. On top of that:
 *
 *   pulled : the stick tips toward the viewer (it holds there while focus is on, or while
 *            the popup it opened is up); released, it springs back past rest and settles.
 */

const PULL_MS = 200;
const RELEASE_MS = 420;

export interface LeverMotion extends PopUpMotion {
    pull: number;
}

export function useLeverMotion({
    visible,
    pulled,
    instant = false,
    skyEntrance,
}: {
    visible: boolean;
    pulled: boolean;
    instant?: boolean;
    /** Read when `visible` turns true: arrive by falling from the sky on this cue instead of rising from the hatch. */
    skyEntrance?: PawnEntranceCue;
}): LeverMotion {
    const popUp = usePopUpMotion({ visible, instant, skyEntrance });
    const pull = useTween(pulled ? 1 : 0, pulled ? PULL_MS : RELEASE_MS, pulled ? easeOut : easeOutBack);
    return { ...popUp, pull };
}
