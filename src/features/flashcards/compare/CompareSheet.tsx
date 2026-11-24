import { useCallback, useRef, useState } from "react";
import SheetPanel, { type SheetTelescopeHandle } from "../../../components/sheet/SheetPanel";
import { useFlashcardLearnSettings } from "../../../hooks/useFlashcardLearnSettings";
import EipUpperPanel from "../FlashcardsLearnPage/EipUpperPanel";
import EipShelf from "../FlashcardsLearnPage/EipShelf";
import { EipPaletteProvider } from "../FlashcardsLearnPage/EipPaletteContext";
import { useEipPalette } from "../FlashcardsLearnPage/useEipPalette";
import CompareSlots from "./CompareSlots";
import CompareShelfBody, { type CompareShelfBodyHandle } from "./CompareShelfBody";
import {
    EMPTY_COMPARE_STATE,
    activeSearchSlot,
    type CompareSlot,
    type CompareState,
} from "./compareState";
import type { LongDefinitionPart, VocabEntry } from "../../../types";

/**
 * COMPARE PANEL — the word-comparison surface as its own bottom sheet
 * (docs/WORD_COMPARE_FEATURE.md). Since 2026-11-21 it is the ONLY Compare surface: the eip's
 * Compare crumb is gone, and every `Compare` pill (the flp's and the saved-card cdp's
 * word-tools rails, and the rail at the bottom of the Dictionary / Reader eip's definition
 * tab) closes any open eip and raises this panel instead.
 *
 * ── Layout: the eip's band + shelf ─────────────────────────────────────────────
 *   UPPER (tinted) — EipUpperPanel, the eip's own telescope: the down caret (closes the
 *                    panel), the "Compare" title row that telescopes in toward max, and in
 *                    the header row the two word keycaps (CompareSlots).
 *   LOWER (white)  — EipShelf, then CompareShelfBody: the dictionary search while a
 *                    keycap is down, else the AI comparison (or a hint).
 * Same palette (EipPaletteProvider → useEipPalette, follows the app theme), same sheet
 * options as the eip (InfoCardSection): no top grabber, no edge padding, the band squeezes
 * on overstretch. The panel draws no minute-points flame — pull-up dictionary flows never
 * do (2026-10-06); earning rides the host page's header, still mounted underneath.
 *
 * ── State lifetime: reset on every open (decided 2026-09-04) ──────────────────
 * A session starts empty apart from slot A, seeded from the calling word as the INITIAL
 * value of the state hook — never an effect, which would re-seed on every identity change
 * of the entry. `useCompareSheet` (useCompareSheet.tsx) remounts this component per open (keyed on a session id),
 * so "reset each time" falls out of the seed. Re-fetching a pair costs nothing extra:
 * `word_comparison_cache` serves the second request.
 *
 * Layer: feature component + local state owner (src/features/flashcards/compare). Requests
 * live in CompareShelfBody (the comparison) and DictionaryWordSearch (the search).
 * Hosts (via useCompareSheet.tsx): FlashcardsLearnPage, TowerCardView (td's card view), EipSheet (the
 * Dictionary page and the Reader).
 */
export interface CompareSheetProps {
    /** The word to seed slot A with; null for a cold open (both slots empty). */
    slotA: VocabEntry | null;
    onClose: () => void;
    /** Stack depth, forwarded to SheetPanel (the host's eip depth — see EipSheet `depth`). */
    depth?: number;
}

// Open height as a share of the frame. Taller than the eip's 0.6 — chosen when the shelf
// opened straight onto a search (at 0.6 the band leaves room for the field and barely one
// result slab). Since search became tap-to-open it opens on a hint; focusing the search
// field maximizes the sheet anyway. Kept pending the owner's call.
const COMPARE_OPEN_HEIGHT_RATIO = 0.8;

export const CompareSheet: React.FC<CompareSheetProps> = ({ slotA, onClose, depth }) => {
    const { settings } = useFlashcardLearnSettings();
    const { showPinyinColor } = settings;
    const palette = useEipPalette();

    const bodyRef = useRef<CompareShelfBodyHandle | null>(null);
    const telescopeRef = useRef<SheetTelescopeHandle | null>(null);
    const [state, setState] = useState<CompareState>(
        slotA ? { ...EMPTY_COMPARE_STATE, slotA } : EMPTY_COMPARE_STATE
    );
    // The slot the learner tapped to fill or replace — search mode is always their choice;
    // nothing opens it on its own (activeSearchSlot).
    const [requestedSlot, setRequestedSlot] = useState<CompareSlot | null>(null);
    const searchSlot = activeSearchSlot(state, requestedSlot);

    // A slot keycap is a 2-state latch: tapping an UP key presses it down and opens the
    // search for that slot (releasing the other key, if it was down); tapping the DOWN key
    // pops it back up and puts the search away.
    const handleSlotPress = useCallback((slot: CompareSlot) => {
        setRequestedSlot(prev => (prev === slot ? null : slot));
    }, []);

    // A word picked from the search. Filling or replacing either slot invalidates the
    // paragraph — it described the OLD pair — and releases the key, so the shelf shows the
    // new comparison (or the hint, while the other slot is still empty).
    const handlePick = useCallback((slot: CompareSlot, entry: VocabEntry) => {
        setState(prev => ({
            ...prev,
            [slot === "A" ? "slotA" : "slotB"]: entry,
            comparison: null,
            comparisonParts: null,
        }));
        setRequestedSlot(null);
    }, []);

    const handleResult = useCallback(
        (comparison: string | null, comparisonParts: LongDefinitionPart[] | null) => {
            setState(prev => ({ ...prev, comparison, comparisonParts }));
        },
        []
    );

    return (
        <EipPaletteProvider palette={palette}>
        <SheetPanel
            onClose={onClose}
            depth={depth}
            defaultHeightRatio={COMPARE_OPEN_HEIGHT_RATIO}
            bodyRef={bodyRef}
            // One body for the panel's whole life, so the scroll coupling never re-binds.
            bodyKey="compare"
            // The eip's chrome options (InfoCardSection): the band draws its own caret and
            // title, the whole band and the shelf's pill are the resize handles, and the
            // band fills the sheet edge to edge.
            showClose={false}
            telescopeRef={telescopeRef}
            surface={palette.ground}
            showGrabber={false}
            edgePadding={false}
            squeezeOnOverstretch
        >
            {({ bindHeaderDrag, dismiss }) => (
                <>
                    <EipUpperPanel
                        ref={telescopeRef}
                        // Named for the pill that opens it.
                        title="Compare"
                        header={
                            <CompareSlots
                                state={state}
                                searchSlot={searchSlot}
                                onSlotPress={handleSlotPress}
                                showPinyinColor={showPinyinColor}
                            />
                        }
                        onClose={dismiss}
                        bindHeaderDrag={bindHeaderDrag}
                    />
                    <EipShelf bindHeaderDrag={bindHeaderDrag}>
                        <CompareShelfBody
                            ref={bodyRef}
                            state={state}
                            searchSlot={searchSlot}
                            onPick={handlePick}
                            onResult={handleResult}
                            showPinyinColor={showPinyinColor}
                        />
                    </EipShelf>
                </>
            )}
        </SheetPanel>
        </EipPaletteProvider>
    );
};

export default CompareSheet;
