import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { readExit } from "../../../games/runtime/gameExit";
import { readCirclePoint } from "../../../utils/pageTransition";
import { Box } from "@mui/material";
import LeafPage from "../../../components/LeafPage";
import { HeaderActionChip } from "../../../components/PageHeader";
import Icon from "../../../components/Icon";
import { FIRE_COUNT_INK } from "../../../minutePoints/FireCount";
import { OUTLINED_CHIP_ICON_PX, OUTLINED_CHIP_PAD_Y_PX, OUTLINED_CHIP_TEXT_PX } from "../../../components/pageHeaderSizing";
import { useAuth } from "../../../AuthContext";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useBlockEdgeSwipe } from "../../../hooks/useBlockEdgeSwipe";
import { fetchNotebookSummary } from "../../../api/writingNotebook";
import {
    decodeNotebookInk,
    encodeNotebookInk,
    type NotebookInk,
} from "../../../../server/contracts/writingNotebook";
import { useNotebookSheet } from "./useNotebookSheet";
import NotebookWordBar from "./NotebookWordBar";
import { NOTEBOOK_EDITOR_MIN_HEIGHT, NOTEBOOK_SIDE_GUTTER, wordBarCompacts } from "./notebookLayout";
import { nextStrokeAid, type StrokeAid } from "./strokeAid";
import NotebookGrid, { type NotebookGridHandle } from "./NotebookGrid";
import NotebookCellEditor from "./NotebookCellEditor";
import NotebookWordPickerSheet from "./NotebookWordPickerSheet";
import { NOTEBOOK_GLYPH } from "./notebookEntry";
import { COLORS } from "../../../theme/colors";
import { FONTS, DATA_TYPE } from "../../../theme/fonts";
import { LEADING } from "../../../theme/scale";

/**
 * WritingNotebookPage — `/flashcards/writing/notebook` (docs/WRITING_NOTEBOOK.md).
 *
 * An endless handwriting practice sheet for one word at a time. NOT a game: no rounds,
 * no score, no game framework — a leaf page reached from the Deck Tower's writing-world
 * paper stack, whose launch carries `state.exitTo` back to that world.
 *
 *   ┌──────────────────────────────┐
 *   │ ⌄  Notebook               🔥 │  LeafPage header — title + the app's flame only
 *   │ [✓12]   (⇄ Change)       (↑) │  NotebookToolbar — counter left, change-word chip
 *   │                              │    centred, back-to-top right (only when scrolled)
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
 * The sheet's counter (in NotebookToolbar): a check + the count, held together by one
 * rectangular 1px outline (2026-11-08) so the pair reads as a single readout.
 *
 * Sized to sit level with the Change chip beside it (HeaderActionChip →
 * `outlinedChipSx`): the same glyph size (`OUTLINED_CHIP_ICON_PX`), vertical padding
 * (`OUTLINED_CHIP_PAD_Y_PX`) and 1px outline in the same ink, so the toolbar's items share
 * one height. Two deliberate differences keep it from reading as a button:
 *   - RECTANGULAR corners (`NOTEBOOK_COUNT_RADIUS_PX`), not the chip's pill ends — the
 *     square also echoes the notebook's cells;
 *   - the count is MONO with tabular figures (a number, not a label), at the chip's type
 *     size so it lines up with "Change".
 * Ink2 (`COLORS.iconColor`, the header icons' ink); the orange stays the flame's.
 * Doc: docs/WRITING_NOTEBOOK.md § "Sheet" (Counter bullet).
 */
const NOTEBOOK_COUNT_RADIUS_PX = 4;

function NotebookCountBox({ count }: { count: number }) {
    return (
        <Box
            className="writing-notebook-page__count"
            role="img"
            aria-label={`${count} ${count === 1 ? "time written" : "times written"}`}
            sx={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                flexShrink: 0,
                lineHeight: LEADING.none,
                padding: `${OUTLINED_CHIP_PAD_Y_PX}px 8px`,
                border: `1px solid ${COLORS.iconColor}`,
                borderRadius: `${NOTEBOOK_COUNT_RADIUS_PX}px`,
                ...DATA_TYPE,
                fontSize: OUTLINED_CHIP_TEXT_PX,
                ...FIRE_COUNT_INK,
                fontVariantNumeric: "tabular-nums",
                color: COLORS.iconColor,
            }}
        >
            <Icon className="writing-notebook-page__count-icon" name={NOTEBOOK_GLYPH} size={OUTLINED_CHIP_ICON_PX} color={COLORS.iconColor} />
            {count}
        </Box>
    );
}

/**
 * NotebookToolbar — the row under the page header (2026-11-08), modelled on the sort
 * cards page's control cluster (AddCardsPage → SortToolbar), but IN FLOW rather than
 * floated: the word bar sits directly beneath, and a floated row would cover it.
 *
 * Three fixed slots — a `1fr auto 1fr` grid, so the middle slot is truly centred on the
 * page whatever the side slots hold, and nothing shifts when one of them empties:
 *   LEFT   the counter (NotebookCountBox) — once a word is chosen and its count has loaded;
 *   MIDDLE the change-word chip;
 *   RIGHT  back to top (`keyboard_double_arrow_up`, the "Next empty" glyph flipped) — only while the sheet is scrolled away from the
 *          top (NotebookGrid → `onScrolledAwayChange`).
 * Items are the header's outlined-chip family (HeaderActionChip) so they keep the look
 * they had in the header. Moved out of the header because a 4-digit count crowded it.
 * Doc: docs/WRITING_NOTEBOOK.md § "Page anatomy".
 */
function NotebookToolbar({ count, word, showBackToTop, onBackToTop, onChangeWord }: {
    /** The sheet counter, or null while it loads / with no word. */
    count: number | null;
    word: string | null;
    showBackToTop: boolean;
    onBackToTop: () => void;
    onChangeWord: () => void;
}) {
    return (
        <Box
            className="writing-notebook-page__toolbar"
            sx={{
                display: "grid",
                gridTemplateColumns: "1fr auto 1fr",
                alignItems: "center",
                columnGap: "8px",
                flexShrink: 0,
                // Side padding = the sheet's gutter, so the side chips sit flush with the grid's edges.
                padding: `8px ${NOTEBOOK_SIDE_GUTTER}px 4px`,
            }}
        >
            <Box className="writing-notebook-page__toolbar-left" sx={{ display: "flex", justifyContent: "flex-start", minWidth: 0 }}>
                {word && count !== null && <NotebookCountBox count={count} />}
            </Box>
            <HeaderActionChip
                className="writing-notebook-page__change-word"
                icon={word ? "swap_horiz" : "add"}
                ariaLabel={word ? `Change word (now ${word})` : "Choose a word"}
                onClick={onChangeWord}
            >
                {word ? "Change" : "Choose"}
            </HeaderActionChip>
            <Box className="writing-notebook-page__toolbar-right" sx={{ display: "flex", justifyContent: "flex-end", minWidth: 0 }}>
                {showBackToTop && (
                    <HeaderActionChip
                        className="writing-notebook-page__back-to-top"
                        icon="keyboard_double_arrow_up"
                        ariaLabel="Back to the top of the sheet"
                        // Fires on release, so it still lands while the sheet is coasting from a fling.
                        scrollSafeTap
                        onClick={onBackToTop}
                    >
                        {null}
                    </HeaderActionChip>
                )}
            </Box>
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
    // The grid (for the toolbar's back-to-top) and whether it is scrolled away from the top.
    const gridRef = useRef<NotebookGridHandle | null>(null);
    const [scrolledAway, setScrolledAway] = useState(false);
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

    // Back returns where the notebook was opened from: the launch's `state.exitTo` (the
    // Deck Tower's paper stack → DeckTowerPage `NOTEBOOK_EXIT`). A launch without one (a
    // deep link, a reload that lost the state) returns to the tower's writing world all
    // the same — the stack is the notebook's only entry point.
    const location = useLocation();
    const exit = readExit(location.state);
    // Opened with the circle transition (the tower's paper stack): Back closes the circle
    // back onto the point it grew from (LeafPage `exitCircleTo`).
    const circleBackTo = exit ? readCirclePoint(location.state) : undefined;
    const leave = () =>
        exit
            ? navigate(exit.path, { state: exit.state })
            : navigate("/", { state: { towerWorld: "writing" } });

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
            title="Notebook"
            onBack={leave}
            exitCircleTo={circleBackTo}
            className="writing-notebook-page"
            contentSx={{ position: "relative" }}
        >
            {!language ? (
                <Box className="writing-notebook-page__unsupported" sx={{ padding: "32px 24px", textAlign: "center", fontFamily: FONTS.sans, color: COLORS.textSecondary }}>
                    The Writing Notebook is for Chinese. Switch your study language to Chinese to use it.
                </Box>
            ) : (
                <>
                    {/* Stays outside the body: a COMPACT-bar editor covers the word bar +
                        sheet, never the toolbar. The change chip stays lit while a cell is
                        open but does not open the picker then: a word switch mid-edit would
                        land the pending save on the NEW sheet (the save is keyed on the word
                        at save time). */}
                    <NotebookToolbar
                        count={sheet.count}
                        word={word}
                        showBackToTop={Boolean(word) && scrolledAway}
                        onBackToTop={() => gridRef.current?.scrollToTop()}
                        onChangeWord={() => { if (!editing) setPickerOpen(true); }}
                    />
                    {/* Everything under the toolbar — positioned, so a COMPACT-bar editor can
                        cover the word bar + sheet (never the header or toolbar). */}
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
                                <NotebookGrid key={word} ref={gridRef} sheet={sheet} onOpenCell={openCell} onScrolledAwayChange={setScrolledAway} />
                            ) : (
                                <Box className="writing-notebook-page__empty" sx={{ padding: "40px 24px", textAlign: "center", fontFamily: FONTS.sans, fontSize: 14, color: COLORS.textSecondary }}>
                                    Tap Choose above to pick a word to practice.
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
