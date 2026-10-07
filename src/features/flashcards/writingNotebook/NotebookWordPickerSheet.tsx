import { useCallback, useRef } from "react";
import { Box } from "@mui/material";
import SheetPanel, { type SheetPanelBodyHandle } from "../../../components/sheet/SheetPanel";
import DictionaryWordSearch from "../../../components/DictionaryWordSearch";
import { isNotebookWord } from "../../../../server/contracts/writingNotebook";
import type { DictionaryEntry, Language } from "../../../types";

/**
 * NotebookWordPickerSheet — the Writing Notebook's word selector (docs/WRITING_NOTEBOOK.md
 * § "Word picker"): the compare sheet's mini dictionary search (`DictionaryWordSearch`,
 * shared with CompareWorkspace) in a modal SheetPanel.
 *
 * Only all-Han words of one to four characters are offered (`isNotebookWord` — the
 * server's own rule, NOTEBOOK_MAX_WORD_LENGTH). Picking hands back the det `word1`; the page then opens that word's sheet.
 * The host unmounts the sheet on pick, so each open starts from an empty query.
 */
interface NotebookWordPickerSheetProps {
    language: Language;
    onPick: (word: string) => void;
    onClose: () => void;
}

const isPickable = (entry: DictionaryEntry) => isNotebookWord(entry.word1);

export default function NotebookWordPickerSheet({ language, onPick, onClose }: NotebookWordPickerSheetProps) {
    const bodyRef = useRef<SheetPanelBodyHandle | null>(null);
    const nodeRef = useRef<HTMLDivElement | null>(null);
    // The body is one element that is both the gesture root and the scroller.
    const setBody = useCallback((node: HTMLDivElement | null) => {
        nodeRef.current = node;
        bodyRef.current = { root: node, scroll: node };
    }, []);

    return (
        <SheetPanel onClose={onClose} bodyRef={bodyRef} bodyKey="notebook-word-picker" title="Choose a word">
            <Box
                ref={setBody}
                className="notebook-word-picker"
                sx={{
                    display: "flex",
                    flexDirection: "column",
                    padding: "12px 18px 8px",
                    flex: 1,
                    minHeight: 0,
                    overflow: "auto",
                    // `pan-y`, not `none`: SheetPanel leaves scroll gestures to the browser
                    // (the same correction CompareWorkspace carries).
                    touchAction: "pan-y",
                }}
            >
                <DictionaryWordSearch
                    classPrefix="notebook-word-picker__search"
                    language={language}
                    heading={null}
                    onSelect={(entry) => onPick(entry.word1)}
                    filter={isPickable}
                />
            </Box>
        </SheetPanel>
    );
}
