import { useCallback, useMemo, useRef, useState } from "react";
import CompareSheet from "./CompareSheet";
import type { VocabEntry } from "../../../types";

/**
 * useCompareSheet — a host's handle on the Compare panel (CompareSheet,
 * docs/WORD_COMPARE_FEATURE.md). Split from CompareSheet.tsx so that file exports only
 * components (React fast refresh).
 *
 * Layer: feature hook (src/features/flashcards/compare).
 * Depended on by: FlashcardsLearnPage, VocabCardDetailPage, EipSheet.
 */
export interface UseCompareSheetOptions {
    // Stack depth to open AT. Read once, when `openCompare` fires — a sheet's position in
    // the stack must not change under it: SheetPanel captures `depth` in its gesture effect
    // and that effect does not list it in its deps, so a mid-life change would leave the
    // panel comparing a stale depth in `isTopmost()`.
    depth?: number;
}

/**
 * Wiring for a host: one call gives it `openCompare(entry)` for its `WordToolsRail` and a
 * `compareSheet` node to render. The HOST closes its eip before calling `openCompare`
 * (owner's call 2026-11-21: Compare never stacks over the eip).
 *
 * The session id is what enforces "reset on every open" — it keys the mounted sheet, so a
 * second open mounts a fresh component with a fresh seed.
 */
export function useCompareSheet(options: UseCompareSheetOptions = {}) {
    const { depth = 0 } = options;
    const [session, setSession] = useState<{ id: number; slotA: VocabEntry | null; depth: number } | null>(null);

    // Latest depth, read at open time — a ref, so `openCompare` keeps one identity.
    const depthRef = useRef(depth);
    depthRef.current = depth;

    const openCompare = useCallback((entry: VocabEntry | null = null) => {
        setSession(prev => ({ id: (prev?.id ?? 0) + 1, slotA: entry, depth: depthRef.current }));
    }, []);
    const closeCompare = useCallback(() => setSession(null), []);

    const compareSheet = useMemo(
        () =>
            session ? (
                <CompareSheet
                    key={session.id}
                    slotA={session.slotA}
                    onClose={closeCompare}
                    depth={session.depth}
                />
            ) : null,
        [session, closeCompare]
    );

    return { openCompare, closeCompare, compareSheet, compareOpen: session !== null };
}

