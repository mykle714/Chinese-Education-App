/**
 * Runs `fn` once the browser has painted the current frame: a requestAnimationFrame
 * (just before the next paint) then a macrotask (just after it). For a tap handler whose
 * work is heavy enough to block a frame — the key's pressed look (set on pointerdown by
 * src/utils/keycapPressDelegate.ts) gets painted before the work starts, instead of being
 * swallowed by it.
 *
 * Layer: shared util. Depended on by: FlashcardsLearnPage (More Info, Compare),
 * hooks/useLearningToggle.ts. Docs: docs/DECK_TOWER.md § "Studying the tower" → "Tap
 * responsiveness".
 */
export function afterNextPaint(fn: () => void): void {
    requestAnimationFrame(() => { window.setTimeout(fn, 0); });
}
