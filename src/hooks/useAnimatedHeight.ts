import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Animates a container's height to follow its content.
 *
 * CSS cannot transition `height: auto`, so the outer box gets an explicit pixel height that
 * tracks the inner content's measured height (ResizeObserver). Whenever the content changes
 * size — e.g. a loading row is swapped for the full result — the outer box eases to the new
 * height via its own `transition: height`. The first measurement is applied without a
 * transition (it starts at that height), so a freshly mounted box does not grow from 0.
 *
 * Usage: put `{ height, overflow: 'hidden', transition: 'height …', boxSizing: 'content-box' }`
 * on the outer box and `innerRef` on its single child that wraps all the content (and carries
 * the padding).
 *
 * Used by: src/components/AiDictionaryEntryCard.tsx (Asking AI… → answer).
 * Docs: docs/DICTIONARY_AI_FALLBACK_SEARCH.md § Synthetic entry shape.
 */
export function useAnimatedHeight<T extends HTMLElement = HTMLDivElement>() {
    const innerRef = useRef<T | null>(null);
    // undefined until the first measurement → the box renders at its natural height.
    const [height, setHeight] = useState<number | undefined>(undefined);

    useLayoutEffect(() => {
        const inner = innerRef.current;
        if (!inner) return;
        // Measure synchronously so the first paint already carries a pixel height.
        setHeight(inner.offsetHeight);
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(() => setHeight(inner.offsetHeight));
        observer.observe(inner);
        return () => observer.disconnect();
    }, []);

    return { innerRef, height };
}
