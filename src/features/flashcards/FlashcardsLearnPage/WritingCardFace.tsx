import { useEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import { Lock, TouchApp } from "@mui/icons-material";
import WritingStage from "../../../components/handwriting/WritingStage";
import ResultStamp from "../../../components/handwriting/ResultStamp";
import { levelPreview, previewShowsWholeCharacter, WRITING_FOCUS_SIZE } from "../../../components/handwriting/levelBehavior";
import type { Ink } from "../../../components/handwriting/types";
import { resolveDisplayDefinition, resolveDisplayPronunciation } from "../../../utils/definitionUtils";
import { WRITING_LEVELS } from "../../../../server/contracts/writingLevels";
import type { VocabEntry } from "../../../types";
import { COLORS, DATA_TYPE } from "../../../theme";
import { SIZE } from "../../../theme/scale";
import { TOWER_CARD_FLIP_MS, FC_FONT } from "../constants";
import TonedPronunciation from "../../../components/TonedPronunciation";
import GlossText from "../../../components/GlossText";
import { iconImageUrl } from "../../../cardIcons/cardIconLayout";
import type { LookalikeMatch } from "../../../components/handwriting/lookalikes";
import LookalikeNotice from "./LookalikeNotice";
import WritingSourceWords from "./WritingSourceWords";

/**
 * WritingCardFace — the CONTENT of one face of a writing-flp card
 * (`?world=writing`, docs/WRITING_PRACTICE_REWORK.md § 3). The card itself — surface,
 * stack, flip, fly-out — is the ordinary flp card (FlashCardSection's `writingFace`);
 * this fills a face edge to edge (`CardFaceSide.fill`).
 *
 * The writing flp deals SINGLE CHARACTERS only (since 2026-11-22; the writing deck,
 * dal/shared/writingDeck.ts), so a face has exactly one cell.
 *
 *   FRONT  a header row — level · tone-coloured pinyin · dd stacked on the left, the
 *          card's icon on the right (`headerIconId`) — then the "From your words" strip
 *          (WritingSourceWords: up to 3 of the learner's words containing the character,
 *          masked, with "See all"), then the one cell, as large as the space left allows
 *          (`useCellSize`). Then a "Tap the card to submit" line at the bottom (the tap
 *          itself is the host's `handleCardClick`). A submit tap with the cell empty
 *          wiggles the card and flashes the cell (`flashNonce`). The cell previews what
 *          the editor will first show at this level (`levelPreview`): the outline for
 *          Walk-through / Trace / Step-through, the first region for Sections,
 *          nothing for Memorize / Flash / Blank / Timed (Memorize's outline is the editor's study
 *          phase, never previewed).
 *   BACK   the same layout; the cell shows the learner's ink over the WHOLE outline with
 *          its ✓ / ✗, and the bottom line says "Tap the card to continue". When the ink
 *          was read as a listed look-alike (`lookalike`) LookalikeNotice sits at the
 *          BOTTOM of the card's content box — it reaches down through the blank bottom
 *          line (`NOTICE_REACH_PX`) — and the cell shrinks to the old 2×2 cell size to
 *          make room (`useCellSize(true)`: half the area, the notice taking the other
 *          half). The bottom line is left blank, its height kept. The size change happens
 *          across the flip (the back is its own face), so the learner never sees the cell
 *          jump.
 *
 * Pure presentation: every state and handler is the host's (useWritingFlashcard). The
 * per-character arrays (`inks`, `locked`, `results`) are the attempt's shape, shared with
 * the mark's `perChar`; on this card they hold one entry. A cell tap stops propagation so
 * it never reaches the card's own tap (the dismiss).
 */
export interface WritingCardFaceProps {
    entry: VocabEntry;
    side: "front" | "back";
    level: number;
    inks: Ink[];
    /** Level 8: characters whose clock already ran (final; not reopenable). */
    locked: boolean[];
    /** Per-character verdicts once graded, else null. */
    results: boolean[] | null;
    checking: boolean;
    /** False for the peeking / flying card — draw only, no taps, no animation. */
    interactive: boolean;
    /** `el` is the tapped cell — the focus editor grows out of it (WritingPanel's morph). */
    onOpenCell?: (index: number, el: HTMLElement) => void;
    onInspectCell?: (index: number) => void;
    /**
     * > 0 after a submit tap found an empty cell: every still-empty, unlocked front cell
     * flashes. The flash replays per tap because FlashCardSection re-keys (remounts) the
     * front card on each `shakeNonce` bump, and the host passes that same nonce here.
     */
    flashNonce?: number;
    /** Back face: the look-alike miss to explain (useWritingFlashcard → lookalikeFor), else null. */
    lookalike?: LookalikeMatch | null;
}

export default function WritingCardFace({
    entry, side, level, inks, locked, results, checking, interactive, onOpenCell, onInspectCell, flashNonce = 0, lookalike = null,
}: WritingCardFaceProps) {
    const character = entry.entryKey;
    const spec = WRITING_LEVELS[level - 1];
    const preview = levelPreview(spec.mode);
    const back = side === "back";
    const pronunciation = resolveDisplayPronunciation(entry);
    const iconId = headerIconId(entry);
    // A look-alike notice (back face only) takes the bottom half of the grid area,
    // bottom-aligned; the cell moves up only if it has to.
    const notice = back && lookalike ? lookalike : null;
    const { gridRef, cellPx, areaPx } = useCellSize(notice !== null);
    // The notice's width: the old 2×2 block's (two cells and a gap).
    const noticeWidth = cellPx * 2 + CELL_GAP;
    // Source words mask the character unless the level already previews all of it
    // (levels 1–3), where a ? would hide nothing.
    const maskChar = previewShowsWholeCharacter(spec.mode) ? undefined : character;

    const result = back && results ? (results[0] ? "correct" : "wrong") : null;
    const canOpen = interactive && !back && !locked[0] && !checking;
    const canInspect = interactive && back;
    const ink = inks[0] ?? [];
    // Back face: the whole outline behind the ink, every level (the grading reveal).
    // Front face: the level's first-look preview.
    const showGuide = back || preview.guide;
    // The cell the submit gate is waiting on (useWritingFlashcard.allFilled).
    const flash = !back && interactive && flashNonce > 0 && ink.length === 0 && !locked[0];

    return (
        <Box
            className={`writing-card-face writing-card-face--${side}`}
            sx={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                // The face is card stock: a cream rim round a beige panel (CardFaceSide, rim
                // width `--card-stock-inset` set on the card frame — `cardStockVars`, card/cardStock.ts).
                // Every row is kept inside the panel, a little in from its edge; the px
                // figures are only floors (see `insetPad`).
                px: insetPad(20),
                pt: insetPad(24),
                pb: insetPad(20),
                gap: `${FACE_ROW_GAP}px`,
                boxSizing: "border-box",
                fontFamily: FC_FONT,
            }}
        >
            {/* Header: text on the left, the card's icon on the right. */}
            <Box className="writing-card-face__header" sx={{ width: "100%", display: "flex", alignItems: "center", gap: 1.5 }}>
                <Box className="writing-card-face__header-text" sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 0.5 }}>
                    <Box className="writing-card-face__level" sx={{ ...DATA_TYPE, fontSize: SIZE.body, color: COLORS.textFaint }}>
                        Level {spec.level} · {spec.name}
                    </Box>
                    {pronunciation && (
                        <TonedPronunciation
                            pronunciation={pronunciation}
                            className="writing-card-face__pinyin"
                            fontSize={SIZE.heading}
                        />
                    )}
                    <Box
                        className="writing-card-face__definition"
                        sx={{
                            fontSize: SIZE.bodyLg,
                            color: COLORS.textSecondary,
                            maxWidth: "100%",
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                        }}
                    >
                        <GlossText text={resolveDisplayDefinition(entry)} />
                    </Box>
                </Box>
                {iconId && (
                    <Box
                        component="img"
                        className="writing-card-face__icon"
                        src={iconImageUrl(iconId)}
                        alt=""
                        draggable={false}
                        sx={{ width: ICON_SIZE, height: ICON_SIZE, flexShrink: 0, objectFit: "contain", userSelect: "none", pointerEvents: "none" }}
                    />
                )}
            </Box>

            {/* Which of the learner's words the character is from (renders nothing when none). */}
            <WritingSourceWords words={entry.writingSourceWords ?? []} maskChar={maskChar} interactive={interactive} />

            {/* The grid AREA fills the space between the strip and the footer line; the one
                cell inside is as large as it allows (useCellSize), centred. */}
            <Box ref={gridRef} className="writing-card-face__grid-area" sx={{ flex: 1, minHeight: 0, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", py: `${GRID_AREA_PAD_Y}px` }}>
            <Box
                className="writing-card-face__block"
                sx={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    // With a notice the block fills the grid area's height: a spacer above
                    // the cell and the notice slot below split the free space equally, so
                    // the cell stays centred in the grid area. The slot also reaches
                    // NOTICE_REACH_PX past the area's bottom (negative margin, offset by an
                    // equal flex-basis so the split stays even), pinning the notice to the
                    // bottom of the card. The slot can't shrink below the notice (flex
                    // min-height: auto), so a tall notice takes its height from the TOP
                    // spacer — the cell moves up only by the overlap, never further.
                    alignSelf: notice ? "stretch" : undefined,
                }}
            >
            {notice && <Box className="writing-card-face__notice-spacer" sx={{ flex: "1 1 0" }} />}
            <CellBox
                px={cellPx}
                className={`writing-card-face__cell${result ? ` writing-card-face__cell--${result}` : ""}`}
                tappable={canOpen || canInspect}
                // Verdict = the corner ✓ / ✗ icon only; the ground stays white.
                bg={COLORS.white}
                flash={flash}
                onTap={(el) => {
                    if (canInspect) onInspectCell?.(0);
                    else if (canOpen) onOpenCell?.(0, el);
                }}
            >
                {(px) => (
                    <>
                        <Box
                            sx={{
                                position: "absolute",
                                top: 0,
                                left: 0,
                                width: WRITING_FOCUS_SIZE,
                                height: WRITING_FOCUS_SIZE,
                                transform: `scale(${px / WRITING_FOCUS_SIZE})`,
                                transformOrigin: "top left",
                                pointerEvents: "none",
                            }}
                        >
                            <WritingStage
                                key={`${side}-${ink.length}`}
                                character={character}
                                size={WRITING_FOCUS_SIZE}
                                drawable={false}
                                showGuide={showGuide}
                                guideVisible={showGuide}
                                loopAnimation={!back && interactive && preview.loop}
                                regionClip={back ? undefined : preview.regionClip}
                                snap={preview.snap}
                                initialInk={ink}
                                result="idle"
                            />
                        </Box>
                        {!back && locked[0] && (
                            <Lock className="writing-card-face__cell-locked" sx={{ position: "absolute", top: 6, left: 6, fontSize: 16, color: COLORS.textFaint }} />
                        )}
                        {result && (
                            // Delayed by the flip so the stamp lands on a face the learner can see.
                            <ResultStamp className="writing-card-face__result" result={result} size={24} inset={6} delayMs={TOWER_CARD_FLIP_MS} />
                        )}
                    </>
                )}
            </CellBox>
            {notice && cellPx > 0 && (
                <Box className="writing-card-face__notice-slot" sx={{ flex: `1 1 ${NOTICE_REACH_PX}px`, mb: `${-NOTICE_REACH_PX}px`, width: noticeWidth, display: "flex", flexDirection: "column", justifyContent: "flex-end", pt: `${CELL_GAP}px` }}>
                    <LookalikeNotice match={notice} width={noticeWidth} height={cellPx} tellWidth={Math.round(areaPx * NOTICE_TELL_WIDTH_FRACTION)} delayMs={TOWER_CARD_FLIP_MS} />
                </Box>
            )}
            </Box>
            </Box>

            {/* The bottom hint line. The card itself is the submit/continue target
                (useWritingFlashcard.handleCardClick); the cell stops its own taps. A look-alike
                notice replaces it: the row stays (empty, the notice drawn over it) so the grid
                area keeps its height. */}
            <Box className="writing-card-face__hint" sx={{ fontSize: SIZE.caption, color: COLORS.textSecondary, minHeight: HINT_ROW_PX, display: "flex", alignItems: "center", gap: 0.5 }}>
                {!notice && (
                    <>
                        {back ? "Tap the card to continue" : checking ? "Checking…" : "Tap the card to submit"}
                        {!checking && <TouchApp className="writing-card-face__hint-icon" sx={{ fontSize: 16, color: COLORS.textSecondary }} />}
                    </>
                )}
            </Box>
        </Box>
    );
}

/** Gap between the cell and the look-alike notice, px — also subtracted when sizing the cell beside one. */
const CELL_GAP = 12;
/** Vertical gap between the face's rows (header, grid area, hint line), px. */
const FACE_ROW_GAP = 8;
/** The grid area's top/bottom padding, px. */
const GRID_AREA_PAD_Y = 8;
/** The bottom hint line's height, px — kept on the back face even when blank. */
const HINT_ROW_PX = 36;
/**
 * How far the look-alike notice slot reaches below the grid area, px: through the area's
 * bottom padding, the row gap and the (blank) hint line — to the bottom of the face's
 * content box, so the notice is bottom-aligned on the card.
 */
const NOTICE_REACH_PX = GRID_AREA_PAD_Y + FACE_ROW_GAP + HINT_ROW_PX;
/** Gap between the card stock's beige panel edge and the face's content, px. */
const PANEL_CONTENT_GAP = 12;

/**
 * A face padding that clears the card stock's cream rim: the larger of `plainPx` and
 * rim + PANEL_CONTENT_GAP. Without a `--card-stock-inset` in scope (no card-stock frame
 * above the face) it is just `plainPx`.
 */
function insetPad(plainPx: number): string {
    return `max(${plainPx}px, calc(var(--card-stock-inset, 0px) + ${PANEL_CONTENT_GAP}px))`;
}

/** The header icon's box, px. */
const ICON_SIZE = 84;
/** The look-alike tell's text column, as a share of the card's inner width (centred). */
const NOTICE_TELL_WIDTH_FRACTION = 0.6;

/**
 * The icon the header shows: the most prominent icon of a saved custom arrangement
 * (largest scale), else the card's default icon. Null when the card has none.
 */
function headerIconId(entry: VocabEntry): string | null {
    const layout = entry.iconLayout;
    if (layout && layout.length > 0) {
        return layout.reduce((best, item) => (item.scale > best.scale ? item : best)).iconId;
    }
    return entry.iconId ?? null;
}

/**
 * Measures the grid area and returns the side of the card's one cell: as large as both
 * axes allow. Beside a look-alike notice (`withNotice`, back face only) the cell takes
 * half the height instead — the notice the other half, reaching through the blank hint
 * row (`NOTICE_REACH_PX`) — which is exactly the old 2×2 layout's cell, so the notice
 * keeps the proportions it was designed at (LookalikeNotice sizes its glyphs off it).
 */
function useCellSize(withNotice: boolean) {
    const gridRef = useRef<HTMLDivElement | null>(null);
    const [cellPx, setCellPx] = useState(0);
    // The grid area's content width — the card's inner width. LookalikeNotice sizes its
    // tell text off it (NOTICE_TELL_WIDTH_FRACTION).
    const [areaPx, setAreaPx] = useState(0);
    useEffect(() => {
        const el = gridRef.current;
        if (!el) return;
        const measure = () => {
            const style = getComputedStyle(el);
            const h = el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
            // Beside a notice: the 2×2 cell on both axes, so the notice (two cells and a
            // gap wide) fits the card's width too.
            const fit = (len: number) => (withNotice ? (len - CELL_GAP) / 2 : len);
            setCellPx(Math.max(0, Math.floor(Math.min(fit(el.clientWidth), fit(h)))));
            setAreaPx(el.clientWidth);
        };
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        measure();
        return () => ro.disconnect();
    }, [withNotice]);
    return { gridRef, cellPx, areaPx };
}

/**
 * One square cell of side `px`. The full-size stage inside is scaled to fit — the stage
 * always captures/replays ink in the WRITING_FOCUS_SIZE space, so a cell and the editor
 * share one coordinate system.
 */
function CellBox({ className, px, tappable, bg, flash, onTap, children }: {
    className: string;
    px: number;
    tappable: boolean;
    /** Pulse the OUTLINE twice (orgMk — attention, deliberately NOT red, which the ✗ "wrong" icon owns). */
    flash: boolean;
    bg: string;
    onTap: (el: HTMLElement) => void;
    children: (px: number) => React.ReactNode;
}) {
    return (
        <Box
            component="button"
            type="button"
            className={className}
            onClick={(e: React.MouseEvent) => {
                // Never let a cell tap reach the card's own tap (the dismiss).
                e.stopPropagation();
                if (tappable) onTap(e.currentTarget as HTMLElement);
            }}
            sx={{
                position: "relative",
                width: px,
                height: px,
                p: 0,
                borderRadius: "14px",
                border: `1px solid ${COLORS.border}`,
                bgcolor: bg,
                cursor: tappable ? "pointer" : "default",
                overflow: "hidden",
                // Replays per submit tap because FlashCardSection re-keys (remounts) the
                // front card on each shake bump. The button mounts on the first render
                // (only its children wait for `px`), so the animation starts with the cell.
                ...(flash ? {
                    animation: "writingCellFlash 0.9s ease-in-out",
                    "@keyframes writingCellFlash": {
                        // Outline only — the ground stays put. The 1px border plus a 1px inset
                        // ring reads as a 2px line; orgMk, since the pale orgM vanishes as a
                        // line on the white cell.
                        "0%, 50%, 100%": { borderColor: COLORS.border, boxShadow: "inset 0 0 0 1px transparent" },
                        "25%, 75%": { borderColor: COLORS.orgMk, boxShadow: `inset 0 0 0 1px ${COLORS.orgMk}` },
                    },
                } : {}),
            }}
        >
            {px > 0 && children(px)}
        </Box>
    );
}
