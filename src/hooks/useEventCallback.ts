import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * useEventCallback — a function whose IDENTITY never changes but which always calls the
 * latest `fn` it was rendered with (the "latest ref" pattern; React's own planned
 * `useEffectEvent`). For handing an event handler to a `React.memo` child without the
 * handler's fresh identity on every render defeating the memo.
 *
 * ⚠️ EVENT HANDLERS ONLY — never a function the child calls DURING RENDER (a render prop
 * such as FlashCardSection's `writingFace`). The ref is re-pointed in a layout effect, so
 * a render-time call would see the previous render's function; worse, a memo child would
 * skip re-rendering when that function's OUTPUT changed, and draw stale content.
 *
 * Layer: shared hook. Depended on by: FlashcardsLearnPage (the props it hands the memoised
 * FlashCardSection). Docs: docs/DECK_TOWER.md § "Studying the tower" → "Tap responsiveness".
 */
export function useEventCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    const ref = useRef(fn);
    useLayoutEffect(() => {
        ref.current = fn;
    });
    return useCallback((...args: A) => ref.current(...args), []);
}
