import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Box, Alert, Snackbar } from "@mui/material";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import NodePage from "../../components/NodePage";
import { apiGet } from "../../api/http";
import { useLearnNowToggle } from "../../hooks/useLearnNowToggle";
import type { DictionaryEntry, VocabEntry, Language } from "../../types";
import { useAuth } from "../../AuthContext";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useFlashcardLearnSettings } from "../../hooks/useFlashcardLearnSettings";
import { useTTS } from "../../hooks/useTTS";
import InfoCardPanelBody from "../../features/flashcards/FlashcardsLearnPage/InfoCardPanelBody";
import { getBreakdownItems } from "../../utils/breakdownUtils";
import { dictionaryEntryToVocabEntry } from "../../utils/dictEntryAdapter";
import { resolveSelectedSenseIndex } from "../../utils/definitionUtils";
import { VocabCardBadges } from "../../features/flashcards/VocabCardDetailBody";
import WordToolsRail from "../../components/WordToolsRail";
import { useCompareSheet } from "../../components/CompareSheet";

// READ-ONLY dictionary card detail (cdp) — the page a dictionary result opens into
// (instead of the eip popup). It's a NODE page (keeps the footer; see
// docs/LEAF_NODE_PAGES.md) reached from the Dictionary node, so the Home tab stays
// active. Keyed by :word (not a vet id) because a searched word usually isn't one
// of the user's saved cards — it fetches the det row via /api/dictionary/lookup and
// adapts it to the VocabEntry shape the eip panel consumes.
//
// Layout: NO flashcard. The page IS the eip — InfoCardPanelBody mounted inline (entry
// header, then the definition / examples / breakdown tabs, each pane scrolling on its
// own), with the word-tools rail at the bottom of the definition tab. The page itself
// does not scroll.
//
// Read-only means: NO edit toolbar / delete. The only write affordance is the "+ / Added!" Learning toggle (in the panel header, under the speaker) for discoverable entries (the word-tools
// rail's Practice Writing drill records no mark here — there is no vet row to mark).
//
// Drill-ins: breakdown/used-in rows and example-sentence segments open the cdp of
// the tapped word — the same drill-in the eip offers, except it navigates here
// instead of opening a nested eip tab. This recursion keeps every linked page
// read-only.

const DictionaryCardDetailPage: React.FC = () => {
    usePageTitle("Dictionary");
    const { word } = useParams<{ word: string }>();
    // `?sense=<cluster label>` — set by the dictionary search when the hit was found through a
    // non-default sense ("ma2" → 吗's má sense), so the page opens on the sense the row showed.
    // It outranks the requester's saved pick: they just chose this sense by tapping it.
    const [searchParams] = useSearchParams();
    const linkedSense = searchParams.get("sense");
    const navigate = useNavigate();
    const slideNavigate = useSlideNavigate();
    const { user } = useAuth();
    const { settings } = useFlashcardLearnSettings();
    const { showPinyinColor } = settings;
    // No showPinyin: the eip panel ALWAYS shows pinyin (reference surface), whatever
    // the flp pinyin toggle says.
    const tts = useTTS();

    const [entry, setEntry] = useState<VocabEntry | null>(null);
    // No narration on landing — same rule as the saved-card cdp (VocabCardDetailPage):
    // a detail page is read, not played at. The entry header's speaker button is the only
    // way a word is spoken here.
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    // Which definitionClusters sense the panel shows (header dd + chip, definition tab, breakdown pinyin).
    const [selectedSenseIndex, setSelectedSenseIndex] = useState(0);
    // Which eip tab (definition / examples / breakdown) the inline panel shows.
    const [selectedTab, setSelectedTab] = useState(0);

    const userLanguage = (user?.selectedLanguage || 'zh') as Language;

    useEffect(() => {
        if (!word) return;
        let cancelled = false;
        const fetchEntry = async () => {
            try {
                setLoading(true);
                setError(null);
                setSelectedSenseIndex(0);
                // A drill-in reuses this component for the new word: start on Definition.
                setSelectedTab(0);
                const dictData = await apiGet<DictionaryEntry>(
                    `/api/dictionary/lookup/${encodeURIComponent(word)}`
                );
                if (cancelled) return;
                const adapted = dictionaryEntryToVocabEntry(dictData);
                setEntry(adapted);
                // Seed the entry header from the requester's SAVED pick for this word when the
                // lookup carried one (they have it as a flashcard) - so the dictionary page and
                // their card agree. Falls back to the default/starred sense otherwise. The
                // picker here stays local-only: this page has no vet row to write when the word
                // is not in their library. See docs/DEFINITION_CLUSTERS.md.
                setSelectedSenseIndex(resolveSelectedSenseIndex(
                    linkedSense ? { ...adapted, selectedSense: linkedSense } : adapted,
                ));
            } catch (err: unknown) {
                if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load word");
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        fetchEntry();
        return () => { cancelled = true; };
        // Keyed on `word` and the linked `?sense=` only — both are stable for the page's
        // life. This effect used to list `token`, so every ~15-minute silent refresh re-ran
        // it — refetching the entry AND resetting selectedSenseIndex to 0, discarding the
        // sense the reader had picked. See CLAUDE.md "Never reload on token refresh".
    }, [word, linkedSense]);

    // Per-character rows for the panel's breakdown tab, following the sense the header
    // shows (so each character's pinyin matches it). Memoized: the panel takes it as a prop.
    const breakdownItems = useMemo(
        () => (entry ? getBreakdownItems(entry, selectedSenseIndex) : []),
        [entry, selectedSenseIndex],
    );

    // Drill-in: open the cdp of a linked word (breakdown/used-in/example segment).
    // Same slide as the Dictionary → cdp navigation (node-in-from-right).
    const handleWordOpen = useCallback((target: string) => {
        slideNavigate(`/dictionary/card/${encodeURIComponent(target)}`);
    }, [slideNavigate]);

    // Compare — raises the compare SHEET over this page with the word in slot A, rather
    // than navigating anywhere: the card you are comparing FROM stays on screen behind the
    // panel, and dragging the sheet to full height is the "maximize" (SheetPanel's merge
    // chrome). This page has no eip, so the sheet sits at depth 0 and its comparison
    // paragraph keeps passive definition popups (no onSegmentOpen — there is nothing here
    // to drill into; a segment tap would have to navigate, which is the thing the sheet
    // exists to avoid). See docs/WORD_COMPARE_FEATURE.md.
    const { openCompare, compareSheet } = useCompareSheet();

    // Learning toggle — the only write action on this read-only page, for discoverable
    // entries. Lives in the panel header under the speaker (LearnNowToggle), the same
    // control the Dictionary page's eip shows; state + rules in useLearnNowToggle.
    const learnNow = useLearnNowToggle(entry, userLanguage);

    return (
        <NodePage
            title="Card Detail"
            onBack={() => navigate(-1)}
            // Matches the vet Card Detail page, which the design draws at 18px — the
            // two are the same surface and must not disagree on their title size.
            headerSize="dense"
            // No `surfaceColor` — the app's standard ground, in lockstep with the vet cdp
            // above. Both used to paint yellowAccent.
            // Fixed, NON-scrolling page: the eip panel below fills the space between the
            // header and the footer, and each of its tab panes scrolls on its own (the
            // panel's own model — see InfoCardPanelBody). A scrolling page would let the
            // panes grow to their content and the tabs would scroll away with them.
            // (Non-scrolling pages drop the edge fades, so no topFade is needed.)
            scrollable={false}
        >
            <Box
                className="dictionary-card-detail__content"
                // Fills the non-scrolling page (flex: 1 + minHeight: 0 so the panel can
                // shrink to the viewport instead of overflowing under the footer). No side
                // gutter: the eip panel pads its own header/tabs/panes (18px), exactly as
                // it does inside the sheet.
                sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
            >
                {loading ? (
                    <Box className="dictionary-card-detail__loading" sx={{ display: "flex", justifyContent: "center", pt: 6 }}>
                        <DelayedCircularProgress />
                    </Box>
                ) : error ? (
                    <Alert className="dictionary-card-detail__error-alert" severity="error" sx={{ m: "16px" }}>{error}</Alert>
                ) : entry ? (
                    <>
                        {entry.category && (
                            <Box className="dictionary-card-detail__badges" sx={{ padding: "8px 18px 0" }}>
                                <VocabCardBadges entry={entry} />
                            </Box>
                        )}

                        {/* THE EIP, INLINE — the same InfoCardPanelBody the flp/scp/saved-card
                            sheet raises (entry header → definition/examples/breakdown tabs →
                            swipeable per-tab scrolling panes), mounted straight on the page
                            instead of in a SheetPanel. Synonyms + Related Words ride at the
                            bottom of the definition tab (showSynonymsRelated), as on the
                            saved-card cdp. Every drill-in (breakdown row, used-in row,
                            example segment) navigates to that word's dictionary cdp rather
                            than opening a nested eip tab, so browsing stays read-only.
                            The Learning toggle rides under the header speaker (learnNow).
                            No headerDragBind — there is no sheet to resize. */}
                        <InfoCardPanelBody
                            currentEntry={entry}
                            selectedTab={selectedTab}
                            onTabChange={setSelectedTab}
                            breakdownItems={breakdownItems}
                            showPinyinColor={showPinyinColor}
                            isFlipped={false}
                            onBreakdownItemClick={(item) => handleWordOpen(item.character)}
                            onUsedInItemClick={(item) => handleWordOpen(item.entryKey)}
                            onExampleSegmentClick={handleWordOpen}
                            // Speak the reading of the sense the header is showing.
                            onSpeak={(e) => tts.speak(e, selectedSenseIndex)}
                            onSpeakSentence={tts.speakSentence}
                            speakingKey={tts.speakingKey}
                            learnNow={learnNow}
                            selectedSenseIndex={selectedSenseIndex}
                            onSelectSense={setSelectedSenseIndex}
                            showSynonymsRelated
                            // pan-y: the panes scroll natively; horizontal stays free for
                            // the panel's own tab-swipe listener to claim.
                            scrollTouchAction="pan-y"
                            // WORD TOOLS — `Write it` and `Compare` at the bottom of the
                            // DEFINITION tab, under Synonyms + Related (2026-10-10). Other
                            // surfaces put this rail above their card; this page has no card,
                            // so the rail closes out the word's main reading instead. It is
                            // the page's sole Practice Writing entry point
                            // (docs/PRACTICE_WRITING.md). Both tools act on the WORD, so a
                            // read-only page is no obstacle: Compare hands the word to the
                            // compare sheet raised over this page. The rail hides itself when
                            // neither tool can act (a non-zh / >4-character word has no
                            // writing drill). The adapted det entry has no vet row, so the
                            // drill records no writing mark.
                            definitionFooter={
                                <WordToolsRail
                                    className="dictionary-card-detail__word-tools"
                                    entry={entry}
                                    onCompare={openCompare}
                                    // Drop the rail's default above-the-card bottom margin;
                                    // the tab's footer slot spaces it.
                                    sx={{ margin: "0 auto" }}
                                />
                            }
                        />
                    </>
                ) : null}
            </Box>

            {/* COMPARE SHEET — portals to the overlay host (nearestOverlayHost), so where
                it sits in this tree does not affect where it paints; it is here, outside
                the scrolling content Box, purely so it reads as page-level furniture. */}
            {compareSheet}

            {/* Failures only — a successful add/remove is shown by the toggle itself. */}
            <Snackbar
                className="dictionary-card-detail__library-error-snackbar"
                open={learnNow.error !== null}
                autoHideDuration={2500}
                onClose={learnNow.clearError}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            >
                <Alert
                    severity="error"
                    variant="filled"
                    onClose={learnNow.clearError}
                >
                    {learnNow.error}
                </Alert>
            </Snackbar>
        </NodePage>
    );
};

export default DictionaryCardDetailPage;
