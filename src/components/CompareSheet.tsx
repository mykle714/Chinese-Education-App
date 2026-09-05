import { useCallback, useMemo, useRef, useState } from "react";
import SheetPanel from "./sheet/SheetPanel";
import CompareWorkspace, { type CompareState, type CompareWorkspaceHandle } from "./CompareWorkspace";
import { useFlashcardLearnSettings } from "../hooks/useFlashcardLearnSettings";
import type { LongDefinitionPart, VocabEntry } from "../types";

/**
 * COMPARE SHEET — the word-comparison surface as a maximizable bottom panel, for every
 * host that does not have an eip tab strip to put it in (docs/WORD_COMPARE_FEATURE.md).
 *
 * ── Why a sheet and not a page ────────────────────────────────────────────────
 * Comparing is something you do *while looking at a word*, so it is modal to the word,
 * not a destination you travel to. The standalone `/compare` page (deleted 2026-09-04)
 * made it a destination: the card you were comparing FROM left the screen, and coming
 * back was a history pop. As a sheet it rises over whatever you were reading, drags to
 * full height (SheetPanel's merge chrome turns it into a page-with-a-header at the top
 * of its travel — the "maximize"), and drags away leaving the page beneath untouched.
 *
 * ── The two hosts and the one exception ───────────────────────────────────────
 * Both cdps mount this (`VocabCardDetailPage`, `DictionaryCardDetailPage`) from the
 * `Compare` pill on `WordToolsRail`. The **flp does not**: it already has an eip entry-tab
 * strip, and Compare is a singleton TAB there (`CompareEipTab`, useEipTabs), which keeps
 * the comparison beside the word trail it came from instead of on top of it. So there are
 * two Compare hosts by design — but only one Compare *body*: both render the shared
 * `CompareWorkspace`, which owns no slot state.
 *
 * ── State lifetime: reset on every open (decided 2026-09-04) ──────────────────
 * A session starts empty apart from slot A, which is seeded from the calling word. The
 * seed is the INITIAL value of the state hook and never an effect — an effect would
 * re-seed on every identity change of the entry object and silently undo a clear the
 * learner had just made. `useCompareSheet` remounts this component per open (keyed on a
 * session id), which is what makes "reset each time" fall out of the seed rather than
 * needing a clear-on-close effect. Re-fetching a pair that was already compared costs
 * nothing extra: `word_comparison_cache` serves the second request.
 *
 * LAYER: shared presentational + local state owner. Every request (the comparison, the
 * slot-B dictionary search) lives inside CompareWorkspace's hooks.
 */

const EMPTY_COMPARE_STATE: CompareState = {
    slotA: null,
    slotB: null,
    comparison: null,
    comparisonParts: null,
};

export interface CompareSheetProps {
    // The word to seed slot A with; null for a cold open (both slots empty).
    slotA: VocabEntry | null;
    onClose: () => void;
    // Stack depth, forwarded to SheetPanel. Pass 1 when the host already has a sheet up
    // (the fc cdp's eip) so the compare sheet and its scrim paint above it.
    depth?: number;
    // Tapping embedded Chinese inside the comparison paragraph. Omit for a passive
    // definition popup, which is what both cdps want — they have no eip to drill into.
    onSegmentOpen?: (segment: string) => void;
}

export const CompareSheet: React.FC<CompareSheetProps> = ({ slotA, onClose, depth, onSegmentOpen }) => {
    const { settings } = useFlashcardLearnSettings();
    // Like the cdp, this is a reference surface: the two slots ARE the material being
    // read, so pinyin is always on regardless of the flp's pinyin toggle. Colour still
    // follows the learner's setting.
    const showPinyin = true;
    const { showPinyinColor } = settings;

    const bodyRef = useRef<CompareWorkspaceHandle | null>(null);
    const [state, setState] = useState<CompareState>(
        slotA ? { ...EMPTY_COMPARE_STATE, slotA } : EMPTY_COMPARE_STATE
    );

    // Filling or clearing either slot invalidates the paragraph — it described the OLD
    // pair. Mirrors useEipTabs.setCompareSlot so the sheet and the eip tab behave
    // identically.
    const handleSetSlot = useCallback((slot: "A" | "B", entry: VocabEntry | null) => {
        setState(prev => ({
            ...prev,
            [slot === "A" ? "slotA" : "slotB"]: entry,
            comparison: null,
            comparisonParts: null,
        }));
    }, []);

    const handleResult = useCallback(
        (comparison: string | null, comparisonParts: LongDefinitionPart[] | null) => {
            setState(prev => ({ ...prev, comparison, comparisonParts }));
        },
        []
    );

    return (
        <SheetPanel
            onClose={onClose}
            depth={depth}
            bodyRef={bodyRef}
            // One body for the sheet's whole lifetime, so the scroll coupling never has to
            // re-bind (contrast the eip, whose bodyKey folds in the active tab).
            bodyKey="compare"
            // Title for the header — the same word the pill that opened it says.
            title="Compare"
            // (This sheet used to opt into a permanent header with `headerMode="always"`,
            // because its body's first row is two word slots and nothing above them said
            // what the surface was. Every SheetPanel does that now, so the prop is gone.)
            // The compare sheet is raised from study surfaces (flp/scp eip, dictionary cdp),
            // all of which it covers header and all.
            showMinutePoints
        >
            <CompareWorkspace
                ref={bodyRef}
                state={state}
                onSetSlot={handleSetSlot}
                onResult={handleResult}
                showPinyin={showPinyin}
                showPinyinColor={showPinyinColor}
                onSegmentOpen={onSegmentOpen}
            />
        </SheetPanel>
    );
};

export interface UseCompareSheetOptions {
    // Stack depth to open AT. Read once, when `openCompare` fires — a sheet's position in
    // the stack must not change under it: SheetPanel captures `depth` in its gesture effect
    // and that effect does not list it in its deps, so a mid-life change would leave the
    // panel comparing a stale depth in `isTopmost()`. Freezing it here also matches the
    // semantics: "which sheets were up when this one opened" is a fact about the open.
    depth?: number;
    onSegmentOpen?: (segment: string) => void;
}

/**
 * Wiring for a host page: one call gives it `openCompare(entry)` for its `WordToolsRail`
 * and a `compareSheet` node to render.
 *
 * The session id is what enforces "reset on every open" — it keys the mounted sheet, so a
 * second open (or the same pill tapped from a different word) mounts a fresh component
 * with a fresh seed rather than reusing the last session's slots.
 */
export function useCompareSheet(options: UseCompareSheetOptions = {}) {
    const { depth = 0, onSegmentOpen } = options;
    const [session, setSession] = useState<{ id: number; slotA: VocabEntry | null; depth: number } | null>(null);

    // Latest depth, read at open time. A ref rather than a dep of `openCompare` so hosts
    // whose depth is derived from state (the fc cdp's `infoOpen ? 1 : 0`) don't hand their
    // WordToolsRail a new callback identity on every eip toggle.
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
                    onSegmentOpen={onSegmentOpen}
                />
            ) : null,
        [session, closeCompare, onSegmentOpen]
    );

    return { openCompare, closeCompare, compareSheet, compareOpen: session !== null };
}

export default CompareSheet;
