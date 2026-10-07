import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box } from "@mui/material";
import LeafPage from "../../../components/LeafPage";
import { HeaderIconButton } from "../../../components/PageHeader";
import Icon from "../../../components/Icon";
import { FIRE_GLYPH_SIZE_PX } from "../../../minutePoints/FireCount";
import { useAuth } from "../../../AuthContext";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useBlockEdgeSwipe } from "../../../hooks/useBlockEdgeSwipe";
import { fetchNotebookSummary } from "../../../api/writingNotebook";
import {
    decodeNotebookInk,
    encodeNotebookInk,
    type NotebookInk,
} from "../../../../server/contracts/writingNotebook";
import { MASTERY_CENTER_PATHS } from "../masteryCenters";
import { useNotebookSheet } from "./useNotebookSheet";
import NotebookWordBar from "./NotebookWordBar";
import { NOTEBOOK_EDITOR_MIN_HEIGHT, wordBarCompacts } from "./notebookLayout";
import { nextStrokeAid, type StrokeAid } from "./strokeAid";
import NotebookGrid from "./NotebookGrid";
import NotebookCellEditor from "./NotebookCellEditor";
import NotebookWordPickerSheet from "./NotebookWordPickerSheet";
import { NOTEBOOK_BELT_ID, NOTEBOOK_GLYPH } from "./notebookBelt";
import { COLORS } from "../../../theme/colors";
import { FONTS } from "../../../theme/fonts";

/**
 * WritingNotebookPage — `/flashcards/writing/notebook` (docs/WRITING_NOTEBOOK.md).
 *
 * An endless handwriting practice sheet for one word at a time. NOT a game: no rounds,
 * no score, no game framework — a leaf page reached from the Writing Center's games
 * belt, whose back arrow returns there (scrolled to the belt, parked on this card).
 *
 *   ┌──────────────────────────────┐
 *   │ ⌄  Writing Notebook   ✎12  ⇄ │  LeafPage header — counter (flame-style) + change-word button
 *   │ ▣▣▣▣▣▣▣                      │  NotebookWordBar — the shadows, 2 per row (3–4 chars: 2×2),
 *   │ ▣▣▣▣▣▣▣                      │    spanning the sheet's width; tapping one cycles its stroke help
 *   │                              │    (a 2×2 drops to one row only if the canvas would not fit)
 *   │ ▢ ▢ ▢ ▢                      │
 *   │ ▢ ▢ ▢ ▢   …endless…          │  NotebookGrid — virtualised, 4 cells a row
 *   │        ( ⇊ Next empty )      │  only when the current page is full
 *   └──────────────────────────────┘
 *
 * Opens on the most recently opened word, at the top of its sheet. A first visit opens
 * nothing: the header's button is a "+" until the learner picks one. Tapping a cell
 * opens NotebookCellEditor over it; tapping out saves the cell, which the server
 * validates silently — the only visible effect is the counter.
 *
 * zh only (the recogniser is Chinese); the belt card is shown only for zh.
 * LAYER: feature page — data via useNotebookSheet / src/api/writingNotebook.ts.
 */
/**
 * The sheet's counter in the header, drawn in the minute-points flame's shape
 * (`FireCount` — `.hd .fire`): one big filled glyph with a mono 11px count beside it,
 * 4px apart, so the two readouts in the right slot read as a matched pair. Ink2
 * (`COLORS.iconColor`, the header icons' ink) rather than the flame's orange: the
 * orange is the earning signal and stays the flame's alone.
 */
function NotebookHeaderCount({ count }: { count: number }) {
    return (
        <Box
            className="writing-notebook-page__count"
            role="img"
            aria-label={`${count} ${count === 1 ? "time written" : "times written"}`}
            sx={{ display: "flex", alignItems: "center", gap: "4px", fontFamily: FONTS.mono, fontSize: 11, fontVariantNumeric: "tabular-nums", color: COLORS.iconColor }}
        >
            <Icon className="writing-notebook-page__count-icon" name={NOTEBOOK_GLYPH} size={FIRE_GLYPH_SIZE_PX} color={COLORS.iconColor} fill={1} />
            {count}
        </Box>
    );
}

interface EditingCell {
    cellIndex: number;
    origin: HTMLElement;
    initialInk: NotebookInk;
    /** The encoded ink the cell held when it opened — an unchanged cell is not re-saved. */
    initialEncoded: string | undefined;
    /**
     * The canvas would not fit under the word bar (a 3–4 character 2×2 on a short screen),
     * so the editor covers the bar too and draws it COMPACT. Decided once, at open.
     */
    compactBar: boolean;
}

/** Every shadow off — a word nobody has tapped yet. */
const NO_STROKE_AIDS: ReadonlyMap<number, StrokeAid> = new Map();

export default function WritingNotebookPage() {
    usePageTitle("Writing Notebook");
    const navigate = useNavigate();
    const { user } = useAuth();
    const language = user?.selectedLanguage === "zh" ? "zh" : null;

    const [word, setWord] = useState<string | null>(null);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [editing, setEditing] = useState<EditingCell | null>(null);
    // Stroke-order help on the word bar's writing shadows, cycled PER POSITION by tapping
    // that cell's shadow: off → numbers → colored strokes + numbers (`StrokeAid`). Keyed by
    // the character's INDEX in the word, so the two 谢 of 谢谢 are set independently.
    // Positions mean nothing across words, so the aids belong to the word they were set
    // on (`strokeAidState.word`) and a different word reads as all-off — derived, not
    // reset in an effect, so a switch never paints the old word's aids for a frame.
    // Deliberately NOT persisted: every visit starts with every shadow bare (no entry =
    // "off"), and leaving the page forgets.
    const [strokeAidState, setStrokeAidState] = useState<{ word: string | null; aids: ReadonlyMap<number, StrokeAid> }>(
        () => ({ word: null, aids: new Map() }),
    );
    const strokeAids = strokeAidState.word === word ? strokeAidState.aids : NO_STROKE_AIDS;
    const cycleStrokeAid = useCallback((index: number) => {
        setStrokeAidState((state) => {
            const aids = state.word === word ? state.aids : NO_STROKE_AIDS;
            return { word, aids: new Map(aids).set(index, nextStrokeAid(aids.get(index) ?? "off")) };
        });
    }, [word]);
    const sheet = useNotebookSheet("zh", language ? word : null);

    // Drawing near a screen edge must not trigger the OS back swipe.
    useBlockEdgeSwipe(editing !== null);

    // Reopen the last word. Keyed on the account (never the token — CLAUDE.md "never
    // reload on a silent token refresh").
    const userId = user?.id;
    useEffect(() => {
        if (!userId || !language) return;
        let cancelled = false;
        fetchNotebookSummary(language)
            .then((summary) => { if (!cancelled && summary.lastWord) setWord((w) => w ?? summary.lastWord); })
            .catch((err) => console.error("Writing Notebook: summary failed", err));
        return () => { cancelled = true; };
    }, [userId, language]);

    // Back always returns to the Writing Center, scrolled to its games belt and parked on
    // this card (MasteryCenterPage → readReturnedGame; WritingGamesCarousel).
    const leave = () => navigate(MASTERY_CENTER_PATHS.writing, { state: { returnedFromGame: NOTEBOOK_BELT_ID } });

    // The sheet's box — measured at open to decide whether the editor fits beneath the bar.
    const sheetRef = useRef<HTMLDivElement | null>(null);
    const { cells, saveCell } = sheet;
    const openCell = useCallback((cellIndex: number, origin: HTMLElement) => {
        const encoded = cells.get(cellIndex);
        let initialInk: NotebookInk = [];
        try {
            if (encoded) initialInk = decodeNotebookInk(encoded);
        } catch {
            // A malformed stored cell opens blank; saving over it repairs it.
        }
        // Compact only as a fallback: a 1–2 character bar is already one row, and a 2×2
        // stays put whenever the sheet beneath it is tall enough for the editor.
        const sheetHeight = sheetRef.current?.clientHeight ?? Infinity;
        const compactBar = wordBarCompacts(word) && sheetHeight < NOTEBOOK_EDITOR_MIN_HEIGHT;
        setEditing({ cellIndex, origin, initialInk, initialEncoded: encoded, compactBar });
    }, [cells, word]);

    const finishCell = (ink: NotebookInk) => {
        const cell = editing;
        setEditing(null);
        if (!cell) return;
        const encoded = encodeNotebookInk(ink);
        const isEmpty = ink.length === 0;
        // Untouched: nothing to save, and no reason to re-run the recogniser.
        if (isEmpty ? cell.initialEncoded === undefined : encoded === cell.initialEncoded) return;
        saveCell(cell.cellIndex, encoded, isEmpty);
    };

    const pickWord = (picked: string) => {
        setPickerOpen(false);
        setWord(picked);
    };

    // The open cell's editor. Hosted in the sheet's box (dims the sheet only), or — when
    // the bar compacts — in the body's box, so it can cover the 2×2 with the compact bar.
    const editor = editing && (
        <NotebookCellEditor
            key={editing.cellIndex}
            initialInk={editing.initialInk}
            origin={editing.origin}
            onDone={finishCell}
            topBar={editing.compactBar
                ? <NotebookWordBar word={word} strokeAids={strokeAids} onCycleStrokeAid={cycleStrokeAid} compact />
                : undefined}
        />
    );

    return (
        <LeafPage
            title="Writing Notebook"
            onBack={leave}
            className="writing-notebook-page"
            contentSx={{ position: "relative" }}
            rightContent={language ? (
                <>
                    {word && sheet.count !== null && (
                        <NotebookHeaderCount count={sheet.count} />
                    )}
                    {/* Stays lit while a cell is open, but does not open the picker then: a
                        word switch mid-edit would land the pending save on the NEW sheet
                        (the save is keyed on the word at save time). */}
                    <HeaderIconButton
                        className="writing-notebook-page__change-word"
                        icon={word ? "swap_horiz" : "add"}
                        label={word ? `Change word (now ${word})` : "Choose a word"}
                        onClick={() => { if (!editing) setPickerOpen(true); }}
                    />
                </>
            ) : undefined}
        >
            {!language ? (
                <Box className="writing-notebook-page__unsupported" sx={{ padding: "32px 24px", textAlign: "center", fontFamily: FONTS.sans, color: COLORS.textSecondary }}>
                    The Writing Notebook is for Chinese. Switch your study language to Chinese to use it.
                </Box>
            ) : (
                <>
                    {/* Everything under the header — positioned, so a COMPACT-bar editor can
                        cover the word bar + sheet (never the header). */}
                    <Box className="writing-notebook-page__body" sx={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                        <NotebookWordBar word={word} strokeAids={strokeAids} onCycleStrokeAid={cycleStrokeAid} />
                        {sheet.saveError && (
                            <Box className="writing-notebook-page__save-error" role="status" sx={{ padding: "6px 16px", fontFamily: FONTS.sans, fontSize: 13, color: COLORS.redMain }}>
                                Your last cell didn't save. Open it and try again.
                            </Box>
                        )}
                        {/* The sheet's box — positioned, so the usual editor dims ONLY the sheet and
                            the full word bar above stays lit and tappable as the reference. */}
                        <Box ref={sheetRef} className="writing-notebook-page__sheet" sx={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                            {word ? (
                                // Keyed on the word: a new word is a new sheet, scrolled to its top.
                                <NotebookGrid key={word} sheet={sheet} onOpenCell={openCell} />
                            ) : (
                                <Box className="writing-notebook-page__empty" sx={{ padding: "40px 24px", textAlign: "center", fontFamily: FONTS.sans, fontSize: 14, color: COLORS.textSecondary }}>
                                    Tap + above to choose a word to practice.
                                </Box>
                            )}
                            {editing && !editing.compactBar && editor}
                        </Box>
                        {editing?.compactBar && editor}
                    </Box>
                    {pickerOpen && (
                        <NotebookWordPickerSheet language={language} onPick={pickWord} onClose={() => setPickerOpen(false)} />
                    )}
                </>
            )}
        </LeafPage>
    );
}
