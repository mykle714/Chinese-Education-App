import InfoCardSection from "./InfoCardSection";
import EipTabStrip from "./EipTabStrip";
import TooManyTabsSnackbar from "./TooManyTabsSnackbar";
import type { useEipTabs } from "./useEipTabs";
import { useFlashcardLearnSettings } from "../../../hooks/useFlashcardLearnSettings";
import { saveSelectedSense } from "../../../utils/vocabApi";
import { senseLabelForIndex } from "../../../utils/definitionUtils";
import type { VocabEntry } from "../../../types";

/**
 * The eip as a self-contained bottom sheet, for a host that has NO card faces of its own
 * to mirror (so `isFlipped` is always false) and needs nothing beyond the standard panel:
 * drill-in tabs, sense picks, Compare, minute points.
 *
 * The host owns `useEipTabs` (it seeds the root tab with `eip.openForRoot(entry)` BEFORE
 * flipping `open` true) and the open flag; this renders the panel only while `open`, so the
 * sheet's open animation replays on every reopen (the flp's rule). SheetPanel portals its
 * own scrim and sheet to the frame, so no positioning host is needed.
 *
 * Closing keeps the tab trail (the scp rule): reopening on the same root word resumes the
 * drill-in chain; `openForRoot` reseeds when the root word changes.
 *
 * Hosts: scp (`SortCardsPage`), iw (`IWPlayPage` — its onClose also lifts the scene hold)
 * and the Reading Center's word grid (`centers/ReadingSwipeGrid`). The flp and cdp mount
 * `InfoCardSection` themselves: both mirror a card face (`isFlipped`) and wire extras.
 *
 * Layer: feature component (src/features/flashcards). Docs: docs/EIP_SHEET_GESTURES.md (mount
 * sites), docs/SORT_CARDS_REQUIREMENTS.md, docs/IMMERSIVE_WORLD.md § 5.3c,
 * docs/READING_WRITING_CENTERS.md.
 */
interface EipSheetProps {
    eip: ReturnType<typeof useEipTabs>;
    open: boolean;
    onClose: () => void;
    onSpeak?: (entry: VocabEntry) => void;
    onSpeakSentence?: (text: string, pronunciation?: string) => void;
    speakingKey?: string | null;
}

const EipSheet: React.FC<EipSheetProps> = ({ eip, open, onClose, onSpeak, onSpeakSentence, speakingKey }) => {
    const { settings: learnSettings } = useFlashcardLearnSettings();
    const active = eip.activeTab;
    const entryTab = active?.kind === "entry" ? active : null;
    const compareTab = active?.kind === "compare" ? active : null;

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
                    depth={0}
                    onSpeak={onSpeak}
                    onSpeakSentence={onSpeakSentence}
                    speakingKey={speakingKey}
                    selectedSenseIndex={entryTab ? entryTab.selectedSenseIndex : 0}
                    // The tab records the pick so the panel re-renders at once; the chosen
                    // cluster's LABEL is persisted for a word with a vet row. A word without
                    // one (id 0) keeps the pick local to the tab.
                    onSelectSense={(index) => {
                        eip.setActiveSenseIndex(index);
                        const entry = entryTab?.entry;
                        if (entry?.id) {
                            saveSelectedSense(entry.id, senseLabelForIndex(entry, index))
                                .catch((err) => console.error("Failed to save selected sense:", err));
                        }
                    }}
                    compareTab={compareTab}
                    onSetCompareSlot={eip.setCompareSlot}
                    onCompareResult={eip.setCompareResult}
                    entryTabId={active?.id}
                    entryTabIndex={eip.activeIndex}
                    tabStrip={
                        <EipTabStrip
                            tabs={eip.tabs}
                            activeIndex={eip.activeIndex}
                            onSelect={eip.setActive}
                            isTabbedMode={eip.isTabbedMode}
                        />
                    }
                    // ✕ = close the showing word. The LAST word returns false so SheetPanel
                    // plays the dismiss; closing its tab here would empty the body for the
                    // whole slide-out.
                    onCloseX={() => {
                        if (eip.tabs.length <= 1) return false;
                        eip.closeActiveTab();
                        return true;
                    }}
                    showMinutePoints
                />
            )}
            <TooManyTabsSnackbar signal={eip.overflowSignal} />
        </>
    );
};

export default EipSheet;
