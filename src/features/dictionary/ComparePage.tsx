import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import NodePage from "../../components/NodePage";
import CompareWorkspace, { type CompareState } from "../../components/CompareWorkspace";
import { FooterSpacer } from "../../components/MobileFooter";
import { useFlashcardLearnSettings } from "../../hooks/useFlashcardLearnSettings";
import { usePageTitle } from "../../hooks/usePageTitle";
import type { LongDefinitionPart, VocabEntry } from "../../types";

// COMPARE PAGE (`/compare`) — the standalone home for the word-comparison feature
// (docs/WORD_COMPARE_FEATURE.md), reached from the Home hub's "Compare Words" row.
//
// It is a NODE page (keeps the footer, left-arrow back, slides in from the right —
// docs/LEAF_NODE_PAGES.md), consistent with the other Home-hub destinations
// (Dictionary, Reader, Games).
//
// This page is a thin STATE OWNER around the shared `CompareWorkspace`: the very same
// component the eip's Compare tab renders (see InfoCardSection). Nothing about the
// slots, the mini dictionary search, the request, or the result rendering is
// duplicated here — the only difference between the two surfaces is where the
// CompareState lives (an eip tab object there, this `useState` here) and the fact
// that neither slot is pre-filled, since the user arrives without a source word.
//
// Layer: presentation / route shell. All data flow (compare request, dictionary
// search) is inside CompareWorkspace's hooks.

const EMPTY_COMPARE_STATE: CompareState = {
    slotA: null,
    slotB: null,
    comparison: null,
    comparisonParts: null,
};

const ComparePage: React.FC = () => {
    usePageTitle("Compare Words");
    const navigate = useNavigate();
    const { settings } = useFlashcardLearnSettings();
    const { showPinyinColor } = settings;
    // Like the cdp, this reference surface always shows pinyin regardless of the flp
    // pinyin toggle — the two slots ARE the reference material here.
    const showPinyin = true;

    const [compareState, setCompareState] = useState<CompareState>(EMPTY_COMPARE_STATE);

    // Filling or clearing either slot invalidates the paragraph — it described the OLD
    // pair. Mirrors useEipTabs.setCompareSlot so both surfaces behave identically.
    const handleSetSlot = useCallback((slot: "A" | "B", entry: VocabEntry | null) => {
        setCompareState(prev => ({
            ...prev,
            [slot === "A" ? "slotA" : "slotB"]: entry,
            comparison: null,
            comparisonParts: null,
        }));
    }, []);

    const handleResult = useCallback((comparison: string | null, comparisonParts: LongDefinitionPart[] | null) => {
        setCompareState(prev => ({ ...prev, comparison, comparisonParts }));
    }, []);

    return (
        <NodePage
            title="Compare Words"
            activePage="home"
            onBack={() => navigate("/")}
            contentClassName="compare-page__content"
        >
            {/* No ref: the {root, scroll} handle exists for the eip sheet's drag-to-resize
                coupling (SheetPanel); on a full page NodePage owns the scrolling. */}
            <CompareWorkspace
                state={compareState}
                onSetSlot={handleSetSlot}
                onResult={handleResult}
                showPinyin={showPinyin}
                showPinyinColor={showPinyinColor}
                // The workspace renders at natural height and MobileTabScreen's ScrollArea does
                // the scrolling — it already reserves FLOATING_FOOTER_CLEARANCE at the bottom and
                // extends behind the floating footer pill, which a nested scroller would not.
                layout="page"
            />
            {/* Clearance for the floating footer pill, the same way the hub pages do it: a real
                spacer ELEMENT as the last child, not padding. The content column overflows
                MobileTabScreen's ContentInner (flex:1 + minHeight:0, so it shrinks rather than
                growing), and Chrome does not extend a scroller's scrollHeight by its own
                paddingBottom for overflowing descendants — so ScrollArea's
                FLOATING_FOOTER_CLEARANCE alone leaves the last lines stranded behind the pill.
                A spacer is real content, so it scrolls. */}
            <FooterSpacer />
        </NodePage>
    );
};

export default ComparePage;
