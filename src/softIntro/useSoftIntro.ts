import { useEffect, useState, useSyncExternalStore } from "react";
import { useAuth } from "../AuthContext";
import type { SoftIntroId, SoftIntroState } from "./softIntroRegistry";
import {
    readSoftIntroOverride,
    recordSoftIntroVisit,
    resolveSoftIntroState,
    subscribeSoftIntroOverride,
} from "./softIntroStorage";

/**
 * Which style a soft introduction (si) should render in. docs/SOFT_INTRODUCTION.md § 4.
 *
 * The NATURAL state is decided ONCE, when the component mounts, and held for the life of
 * the mount — an si never changes style under the learner's eyes. A visit that crosses
 * the thresholds therefore still shows the intro; the graduated style arrives on the
 * next mount.
 *
 * Each mount counts as a visit (deduped to one per 30 minutes), recorded after paint.
 *
 * `enabled: false` — for a host that mounts the si's component somewhere the si is not
 * shown (e.g. a compact variant without the element): no visit is recorded there, so it
 * cannot graduate the si for a surface the learner never actually saw.
 *
 * Validator accounts can force every si on screen into one state from the header toggle
 * (`SoftIntroToggle`); that override is LIVE (re-renders immediately) because its whole
 * point is comparing the two styles side by side.
 */
export function useSoftIntro(id: SoftIntroId, { enabled = true }: { enabled?: boolean } = {}): SoftIntroState {
    const { user } = useAuth();
    const [natural] = useState(() => resolveSoftIntroState(id));
    const override = useSyncExternalStore(subscribeSoftIntroOverride, readSoftIntroOverride);

    useEffect(() => {
        if (enabled) recordSoftIntroVisit(id);
    }, [id, enabled]);

    return user?.isValidator && override !== "auto" ? override : natural;
}
