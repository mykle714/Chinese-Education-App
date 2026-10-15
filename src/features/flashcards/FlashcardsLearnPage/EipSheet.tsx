import InfoCardSection from "./InfoCardSection";
import EipTabStrip from "./EipTabStrip";
import TooManyTabsSnackbar from "./TooManyTabsSnackbar";
import type { useEipTabs } from "./useEipTabs";
import { useFlashcardLearnSettings } from "../../../hooks/useFlashcardLearnSettings";
import { saveSelectedSense } from "../../../utils/vocabApi";
import { senseLabelForIndex } from "../../../utils/definitionUtils";
import { Alert, Snackbar } from "@mui/material";
import WordToolsRail from "../../../components/WordToolsRail";
import { useLearnNowToggle } from "../../../hooks/useLearnNowToggle";
import type { Language, VocabEntry } from "../../../types";

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
 * Hosts: scp (`SortCardsPage`), iw (`IWPlayPage` — its onClose also lifts the scene hold),
 * the Reading Center's word grid (`centers/ReadingSwipeGrid`) and the Dictionary page
 * (`features/dictionary/DictionaryPage`, the only host that turns on
 * `showSynonymsRelated` + `showWordTools`). The flp and cdp mount
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
    // Append Synonyms + Related Words to the bottom of the definition tab (the cdp's
    // treatment — InfoCardTabContent `showSynonymsRelated`). Dictionary page only.
    showSynonymsRelated?: boolean;
    // Put the word-tools rail (`Write it` · `Compare`, WordToolsRail) at the very bottom
    // of the definition tab, under the synonyms. Compare opens the eip's OWN Compare tab
    // (useEipTabs.openCompareTab) rather than a separate sheet, so the comparison joins
    // the word trail like any drill-in. Dictionary page only: a reference lookup has no
    // card to hang the rail above.
    showWordTools?: boolean;
    // Put the Learn Now TOGGLE (glowing "+" ⇄ "Added!", LearnNowToggle) under the header
    // speaker, tracking whichever entry tab is showing. Dictionary page only. A failed
    // add/remove raises this sheet's own error snackbar.
    showLearnNow?: boolean;
    // Stack depth handed to SheetPanel (0 = root). scp passes 1 while its hidden
    // skipped-cards sheet is open, so an eip opened from that sheet stacks above it.
    depth?: number;
}

const EipSheet: React.FC<EipSheetProps> = ({
    eip, open, onClose, onSpeak, onSpeakSentence, speakingKey, showSynonymsRelated, showWordTools, showLearnNow, depth = 0,
}) => {
    const { settings: learnSettings } = useFlashcardLearnSettings();
    const active = eip.activeTab;
    const entryTab = active?.kind === "entry" ? active : null;
    const compareTab = active?.kind === "compare" ? active : null;
    // Membership of the SHOWING word — re-fetched as the trail moves between words.
    // Fed `null` unless the host asked for it, which leaves the hook inert (no fetch).
    const learnNow = useLearnNowToggle(
        showLearnNow ? entryTab?.entry ?? null : null,
        (entryTab?.entry.language ?? "zh") as Language,
    );

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
                    onSpeak={onSpeak}
                    onSpeakSentence={onSpeakSentence}
                    speakingKey={speakingKey}
                    learnNow={showLearnNow ? learnNow : undefined}
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
                    showSynonymsRelated={showSynonymsRelated}
                    definitionFooter={showWordTools && entryTab ? (
                        <WordToolsRail
                            className="eip-sheet__word-tools"
                            entry={entryTab.entry}
                            onCompare={eip.openCompareTab}
                            // The rail's default spacing is for sitting above a card; the
                            // tab's footer slot spaces it here.
                            sx={{ margin: "0 auto" }}
                        />
                    ) : undefined}
                />
            )}
            <TooManyTabsSnackbar signal={eip.overflowSignal} />
            {/* Learn Now failures only — a successful add/remove is shown by the toggle. */}
            <Snackbar
                className="eip-sheet__learn-now-error-snackbar"
                open={learnNow.error !== null}
                autoHideDuration={2500}
                onClose={learnNow.clearError}
                anchorOrigin={{ vertical: "top", horizontal: "center" }}
            >
                <Alert severity="error" variant="filled" onClose={learnNow.clearError}>
                    {learnNow.error}
                </Alert>
            </Snackbar>
        </>
    );
};

export default EipSheet;
