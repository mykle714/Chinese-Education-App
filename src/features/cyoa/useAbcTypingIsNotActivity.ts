/**
 * useAbcTypingIsNotActivity — on the cyoa editors, interactions while the system `abc`
 * keyboard is up do not count as minute-points activity (docs/CYOA_FEATURE.md § 8).
 *
 * LAYER: feature hook (src/features/cyoa). Glues the beginner keyboard's active source to
 * the shared activity-suppression store.
 *
 * Owner's rules (2026-11-21):
 *   • abc up            → interactions do not count (the running clock still drains its 15 s
 *                          idle window — suppression, not a pause; see activitySuppression.ts)
 *   • 写 or ā up         → counts (ā is pinyin practice, typed alongside abc)
 *   • no keyboard up    → counts (rereading, reordering passages, tapping buttons)
 *
 * While abc is up EVERY interaction is ignored, not only keystrokes: on a phone the OS
 * keyboard's taps never reach the document, so the only events left are taps on the page
 * itself, and those are part of the same English-writing stint. The tap on the switch bar's
 * 写/ā segment is ignored too (abc is still up when it fires); the first stroke after it counts.
 *
 * Used by: StoryEditorPage.tsx, PassageEditorPage.tsx.
 */
import { useActiveKeyboardSource } from "../beginnerKeyboard";
import { useSuppressMinutePointsActivity } from "../../minutePoints/activitySuppression";

export function useAbcTypingIsNotActivity(): void {
    useSuppressMinutePointsActivity(useActiveKeyboardSource() === "os");
}
