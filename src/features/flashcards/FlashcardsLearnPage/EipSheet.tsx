import InfoCardSection from "./InfoCardSection";
import EipTabStrip from "./EipTabStrip";
import { useEipOverflowNotice } from "./useEipOverflowNotice";
import type { useEipTabs } from "./useEipTabs";
import { useFlashcardLearnSettings } from "../../../hooks/useFlashcardLearnSettings";
import { useNotificationFor } from "../../../components/notifications/useNotify";
import WordToolsRail from "../../../components/WordToolsRail";
import { useLearningToggle, type LearningToggleState } from "../../../hooks/useLearningToggle";
import type { Language, VocabEntry } from "../../../types";
import { useCompareSheet } from "../compare/useCompareSheet";

/**
 * The eip as a self-contained bottom sheet, for a host that has NO card faces of its own
 * to mirror (so `isFlipped` is always false) and needs nothing beyond the standard panel:
 * drill-in tabs, sense picks, minute points — and the Compare panel its rail raises.
 *
 * The host owns `useEipTabs` (it seeds the root tab with `eip.openForRoot(entry)` BEFORE
 * flipping `open` true) and the open flag; this renders the panel only while `open`, so the
 * sheet's open animation replays on every reopen (the flp's rule). SheetPanel portals its
 * own scrim and sheet to the frame, so no positioning host is needed.
 *
 * Closing keeps the tab trail (the acp rule): reopening on the same root word resumes the
 * drill-in chain; `openForRoot` reseeds when the root word changes.
 *
 * Hosts: acp (`AddCardsPage`), the Dictionary page (`features/dictionary/DictionaryPage`,
 * the only host that turns on `showWordTools`) and the saved-card cdp
 * (`features/flashcards/VocabCardDetailPage`, which since 2026-11-10 drills in through
 * this trail instead of navigating; with the Dictionary page it turns on
 * `showSynonymsRelated` + `showLearning`), and the Reader document page
 * (`features/reader/ReaderDocumentPage`, the Dictionary page's configuration plus
 * `sharedLearning`, so its keycap's Add key and the eip's are one state). The flp mounts `InfoCardSection` itself: it
 * mirrors a flipping card face (`isFlipped`) and wires extras.
 *
 * Layer: feature component (src/features/flashcards). Docs: docs/EIP_SHEET_GESTURES.md (mount
 * sites), docs/SORT_CARDS_REQUIREMENTS.md,
 * docs/READING_WRITING_CENTERS.md.
 */
interface EipSheetProps {
    eip: ReturnType<typeof useEipTabs>;
    open: boolean;
    onClose: () => void;
    onSpeak?: (entry: VocabEntry) => void;
    onSpeakSentence?: (text: string, pronunciation?: string) => void;
    speakingKey?: string | null;
    // Append Synonyms + Related Words to the bottom of the definition tab (the cdp's
    // treatment — InfoCardTabContent `showSynonymsRelated`). Dictionary page + saved-card cdp.
    showSynonymsRelated?: boolean;
    // Put the word-tools rail (`Write it` · `Compare`, WordToolsRail) at the very bottom
    // of the definition tab, under the synonyms. Compare CLOSES this eip and raises the
    // Compare panel (compare/CompareSheet, owned here so it outlives the eip) — Compare
    // never stacks over the eip (owner's call 2026-11-21). Dictionary page and Reader: a
    // reference lookup has no card to hang the rail above.
    showWordTools?: boolean;
    // Put the Learning key (raised "Add" ⇄ "Added!", EipAddKey) in the sheet's trail row
    // at the right end of the trail row, tracking whichever entry tab is showing. Dictionary page + saved-card cdp. A
    // failed add/remove raises this sheet's own error snackbar.
    showLearning?: boolean;
    // With `showLearning`: hide the Learning key while the trail's ROOT is showing (it
    // appears on every word drilled into from it). The saved-card cdp: its root is the
    // saved card the page is about, so the key there would only offer to un-save it.
    learningSkipsRoot?: boolean;
    // With `showLearning`: a host's own Learning toggle for one word. While the showing
    // tab is that word (`entryKey` match) the trail's key uses THIS state instead of the
    // sheet's hook, so the host's key for the word updates with every tap here (and the
    // sheet's hook stays inert — no second status fetch). The Reader: its keycap's key.
    sharedLearning?: { entryKey: string; state: LearningToggleState } | null;
    // Stack depth handed to SheetPanel (0 = root). acp passes 1 while its hidden
    // skipped-cards sheet is open, so an eip opened from that sheet stacks above it.
    depth?: number;
    // Open height (and the stop a downward drag/fling clips back to) as a fraction of the
    // frame — forwarded to SheetPanel's `defaultHeightRatio`. Omitted = 0.6. Dictionary: 0.8.
    defaultHeightRatio?: number;
}

const EipSheet: React.FC<EipSheetProps> = ({
    eip, open, onClose, onSpeak, onSpeakSentence, speakingKey, showSynonymsRelated, showWordTools, showLearning, learningSkipsRoot, sharedLearning, depth = 0, defaultHeightRatio,
}) => {
    const { settings: learnSettings } = useFlashcardLearnSettings();
    const active = eip.activeTab;
    const entryTab = active;
    // The Compare panel the rail raises. Owned HERE rather than by InfoCardSection because
    // it must outlive the eip: Compare closes the eip, then opens at the eip's own depth.
    const { openCompare, compareSheet } = useCompareSheet({ depth });
    const handleCompare = (entry: VocabEntry) => {
        onClose();
        openCompare(entry);
    };
    // Membership of the SHOWING word — re-fetched as the trail moves between words.
    // Fed `null` unless the host asked for it, which leaves the hook inert (no fetch).
    const learningShown = !!showLearning && !(learningSkipsRoot && eip.activeIndex === 0);
    // The host's toggle applies only to its own word; any other tab runs the sheet's hook.
    const useShared = learningShown && !!sharedLearning && entryTab?.entry.entryKey === sharedLearning.entryKey;
    const ownLearning = useLearningToggle(
        learningShown && !useShared ? entryTab?.entry ?? null : null,
        (entryTab?.entry.language ?? "zh") as Language,
    );
    const learning = useShared && sharedLearning ? sharedLearning.state : ownLearning;
    // The trail-full notice, and Learning failures only — a successful add/remove is shown
    // by the toggle (docs/NOTIFICATIONS.md). A shared toggle's failures are the host's to raise.
    useEipOverflowNotice(eip.overflowSignal);
    useNotificationFor(ownLearning.error, ownLearning.clearError, { id: "eip-sheet-learning-error", tone: "error", autoHideMs: 2500 });

    return (
        <>
            {open && (
                <InfoCardSection
                    currentEntry={entryTab ? entryTab.entry : null}
                    selectedTab={entryTab ? entryTab.selectedSubTab : 0}
                    onTabChange={eip.setActiveSubTab}
                    breakdownItems={entryTab ? entryTab.breakdownItems : []}
                    showPinyinColor={learnSettings.showPinyinColor}
                    isFlipped={false}
                    onClose={onClose}
                    onBreakdownItemClick={(item) => { void eip.openForEntryKey(item.character); }}
                    onUsedInItemClick={(item) => { void eip.openForEntryKey(item.entryKey); }}
                    onExampleSegmentClick={(segment) => { void eip.openForEntryKey(segment); }}
                    depth={depth}
                    defaultHeightRatio={defaultHeightRatio}
                    onSpeak={onSpeak}
                    onSpeakSentence={onSpeakSentence}
                    speakingKey={speakingKey}
                    learning={learningShown ? learning : undefined}
                    // Only a PERSISTED pick is passed. A word with none (every det entry on the
                    // Dictionary page) passes undefined, so the sense list underlines nothing and
                    // the dd/reading resolvers fall back to the default — the same sense 0
                    // this used to pass explicitly.
                    selectedSenseIndex={entryTab?.entry.selectedSense ? entryTab.selectedSenseIndex : undefined}
                    entryTabId={active?.id}
                    entryTabIndex={eip.activeIndex}
                    tabStrip={
                        <EipTabStrip
                            tabs={eip.tabs}
                            activeIndex={eip.activeIndex}
                            onSelect={eip.popTo}
                            showCrumbs={eip.trailShown}
                        />
                    }
                    // Escape = pop the showing word (back one crumb). The ROOT returns false so
                    // SheetPanel plays the dismiss; popping it here would empty the body for
                    // the whole slide-out.
                    onCloseX={() => {
                        if (eip.tabs.length <= 1) return false;
                        eip.pop();
                        return true;
                    }}
                    // Swiping right past Definitions = back one crumb (the same pop as a tap on the
                    // previous crumb, so that word reopens on its remembered sub-tab). Off at the
                    // root: nothing sits below it, so that edge keeps its rubber-band.
                    onSwipeBack={eip.activeIndex > 0 ? () => eip.popTo(eip.activeIndex - 1) : undefined}
                    showMinutePoints
                    showSynonymsRelated={showSynonymsRelated}
                    definitionFooter={showWordTools && entryTab ? (
                        <WordToolsRail
                            className="eip-sheet__word-tools"
                            entry={entryTab.entry}
                            onCompare={handleCompare}
                            // The rail's default spacing is for sitting above a card; the
                            // tab's footer slot spaces it here.
                            sx={{ margin: "0 auto" }}
                        />
                    ) : undefined}
                />
            )}
            {compareSheet}
        </>
    );
};

export default EipSheet;
