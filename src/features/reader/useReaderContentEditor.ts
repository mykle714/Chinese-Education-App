import { useCallback, useEffect, useRef, useState } from "react";

// READER INLINE CONTENT EDITOR — undo/redo history for the Edit-toggle content
// textarea (ReaderEditToolbar / ReaderDocumentPage). See docs/LEAF_NODE_PAGES.md
// § Reader for how this composes with the routed document page.
//
// History is grouped by TYPING BURST rather than per-keystroke: a burst is a run
// of onChange calls with no pause longer than BURST_GAP_MS between them. The
// pre-burst draft is pushed once, at the start of the burst — so one undo tap
// reverts a whole sentence/paste rather than a single character. This mirrors
// the discrete-action history in useCardIconEditor.ts (each gesture/action is one
// undo step), adapted for continuous typing.
const HISTORY_MAX = 100;
const BURST_GAP_MS = 800;

export function useReaderContentEditor() {
    const [editMode, setEditMode] = useState(false);
    const [draft, setDraft] = useState("");
    const [history, setHistory] = useState<string[]>([]);
    const [future, setFuture] = useState<string[]>([]);

    // Synchronous refs alongside the state above — mutators need to read the
    // latest value in the same tick a rapid double-tap (e.g. two quick undos)
    // fires before the first re-render commits (same rationale as advDraftRef
    // in useCardIconEditor.ts).
    const draftRef = useRef(draft);
    const historyRef = useRef(history);
    const futureRef = useRef(future);
    const burstActiveRef = useRef(false);
    const burstTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const pushCapped = (stack: string[], value: string) => {
        const next = [...stack, value];
        return next.length > HISTORY_MAX ? next.slice(next.length - HISTORY_MAX) : next;
    };

    const clearBurstTimer = () => {
        if (burstTimeoutRef.current) {
            clearTimeout(burstTimeoutRef.current);
            burstTimeoutRef.current = null;
        }
    };

    const enterEditMode = useCallback((content: string) => {
        draftRef.current = content;
        historyRef.current = [];
        futureRef.current = [];
        burstActiveRef.current = false;
        clearBurstTimer();
        setDraft(content);
        setHistory([]);
        setFuture([]);
        setEditMode(true);
    }, []);

    const exitEditMode = useCallback(() => {
        burstActiveRef.current = false;
        clearBurstTimer();
        setEditMode(false);
    }, []);

    const handleDraftChange = useCallback((next: string) => {
        if (!burstActiveRef.current) {
            // Starting a new burst: snapshot the PRE-change draft as the undo step,
            // and invalidate any redo stack (standard editor rule — branching off an
            // undo discards the abandoned future).
            const nextHistory = pushCapped(historyRef.current, draftRef.current);
            historyRef.current = nextHistory;
            futureRef.current = [];
            setHistory(nextHistory);
            setFuture([]);
            burstActiveRef.current = true;
        }
        clearBurstTimer();
        burstTimeoutRef.current = setTimeout(() => {
            burstActiveRef.current = false;
        }, BURST_GAP_MS);
        draftRef.current = next;
        setDraft(next);
    }, []);

    const undo = useCallback(() => {
        const h = historyRef.current;
        if (h.length === 0) return;
        const nextFuture = pushCapped(futureRef.current, draftRef.current);
        const prev = h[h.length - 1];
        const nextHistory = h.slice(0, -1);
        historyRef.current = nextHistory;
        futureRef.current = nextFuture;
        burstActiveRef.current = false;
        clearBurstTimer();
        setHistory(nextHistory);
        setFuture(nextFuture);
        draftRef.current = prev;
        setDraft(prev);
    }, []);

    const redo = useCallback(() => {
        const f = futureRef.current;
        if (f.length === 0) return;
        const nextHistory = pushCapped(historyRef.current, draftRef.current);
        const next = f[f.length - 1];
        const nextFuture = f.slice(0, -1);
        historyRef.current = nextHistory;
        futureRef.current = nextFuture;
        burstActiveRef.current = false;
        clearBurstTimer();
        setHistory(nextHistory);
        setFuture(nextFuture);
        draftRef.current = next;
        setDraft(next);
    }, []);

    useEffect(() => clearBurstTimer, []);

    return {
        editMode,
        draft,
        canUndo: history.length > 0,
        canRedo: future.length > 0,
        enterEditMode,
        exitEditMode,
        handleDraftChange,
        undo,
        redo,
    };
}
