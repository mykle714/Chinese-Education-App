import { useEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import { CheckCircle, Cancel, Lock, TouchApp } from "@mui/icons-material";
import WritingStage from "../../../components/handwriting/WritingStage";
import { levelPreview, WRITING_FOCUS_SIZE } from "../../../components/handwriting/levelBehavior";
import type { Ink } from "../../../components/handwriting/types";
import { resolveDisplayDefinition, resolveDisplayPronunciation } from "../../../utils/definitionUtils";
import { WRITING_LEVELS, WRITING_MAX_CHARS } from "../../../../server/contracts/writingLevels";
import type { VocabEntry } from "../../../types";
import { COLORS, FONTS } from "../../../theme";
import { SIZE } from "../../../theme/scale";
import { FC_FONT } from "../constants";
import TonedPronunciation from "../../../components/TonedPronunciation";
import { iconImageUrl } from "../../../cardIcons/cardIconLayout";

/**
 * WritingCardFace — the CONTENT of one face of a writing-flp card
 * (`?bar=writing`, docs/WRITING_PRACTICE_REWORK.md § 3). The card itself — surface,
 * stack, flip, fly-out — is the ordinary flp card (FlashCardSection's `writingFace`);
 * this fills a face edge to edge (`CardFaceSide.fill`).
 *
 *   FRONT  a header row — level · tone-coloured pinyin · dd stacked on the left, the
 *          card's icon on the right (`headerIconId`) — then the character grid (one cell
 *          per character, 2 per row). Every word, 1–4 characters, gets cells of the
 *          4-character size (`useFourCharCellSize`), so cell size never hints at word
 *          length and the ink scale is the same on every card. Then a "Tap the card to submit" line at the bottom
 *          (the tap itself is the host's `handleCardClick`). A submit tap with an empty
 *          cell wiggles the card and flashes every empty cell (`flashNonce`). An EMPTY or written cell
 *          previews what the editor will first show at this level (`levelPreview`):
 *          the outline for Snap / Trace / Step Through, the first region for
 *          Quarters / Eighths, nothing for Memorize / Blank / Timed (Memorize's outline is
 *          the editor's study phase, never previewed).
 *   BACK   the same layout; each cell shows the learner's ink over the WHOLE outline
 *          with its ✓ / ✗, and the bottom line says "Tap the card to continue".
 *
 * Pure presentation: every state and handler is the host's (useWritingFlashcard). A cell
 * tap stops propagation so it never reaches the card's own tap (the dismiss).
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
}

export default function WritingCardFace({
    entry, side, level, inks, locked, results, checking, interactive, onOpenCell, onInspectCell, flashNonce = 0,
}: WritingCardFaceProps) {
    const chars = [...entry.entryKey];
    const spec = WRITING_LEVELS[level - 1];
    const preview = levelPreview(spec.mode);
    const back = side === "back";
    const pronunciation = resolveDisplayPronunciation(entry);
    const iconId = headerIconId(entry);
    const { gridRef, cellPx } = useFourCharCellSize();

    return (
        <Box
            className={`writing-card-face writing-card-face--${side}`}
            sx={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                px: 2.5,
                pt: 3,
                pb: 2.5,
                gap: 1,
                boxSizing: "border-box",
                fontFamily: FC_FONT,
            }}
        >
            {/* Header: text on the left, the card's icon on the right. */}
            <Box className="writing-card-face__header" sx={{ width: "100%", display: "flex", alignItems: "center", gap: 1.5 }}>
                <Box className="writing-card-face__header-text" sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 0.5 }}>
                    <Box className="writing-card-face__level" sx={{ fontFamily: FONTS.mono, fontSize: SIZE.caption, color: COLORS.textFaint }}>
                        Level {spec.level} · {spec.name}
                    </Box>
                    {pronunciation && (
                        <TonedPronunciation
                            pronunciation={pronunciation}
                            className="writing-card-face__pinyin"
                            fontSize={SIZE.title}
                        />
                    )}
                    <Box
                        className="writing-card-face__definition"
                        sx={{
                            fontSize: SIZE.body,
                            color: COLORS.textSecondary,
                            maxWidth: "100%",
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                        }}
                    >
                        {resolveDisplayDefinition(entry)}
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

            {/* The grid AREA fills the space between header and footer and is measured as
                if it held the 2×2 (4-character) layout; the cells inside are always that
                size, laid out 2 per row (0→TL, 1→TR, 2→BL, 3→BR, as in the popup) and
                centred as a block. */}
            <Box ref={gridRef} className="writing-card-face__grid-area" sx={{ flex: 1, minHeight: 0, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", py: 1 }}>
            <Box
                className="writing-card-face__grid"
                sx={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${Math.min(chars.length, 2)}, ${cellPx}px)`,
                    gridAutoRows: `${cellPx}px`,
                    gap: `${CELL_GAP}px`,
                }}
            >
                {chars.map((ch, i) => {
                    const result = back && results ? (results[i] ? "correct" : "wrong") : null;
                    const canOpen = interactive && !back && !locked[i] && !checking;
                    const canInspect = interactive && back;
                    const ink = inks[i] ?? [];
                    // Back face: the whole outline behind the ink, every level (the grading
                    // reveal). Front face: the level's first-look preview.
                    const showGuide = back || preview.guide;
                    // The cells the submit gate is waiting on (useWritingFlashcard.allFilled).
                    const flash = !back && interactive && flashNonce > 0 && ink.length === 0 && !locked[i];
                    return (
                        <CellBox
                            key={`${side}-${i}`}
                            px={cellPx}
                            className={`writing-card-face__cell${result ? ` writing-card-face__cell--${result}` : ""}`}
                            tappable={canOpen || canInspect}
                            bg={result === "correct" ? COLORS.grnTint : result === "wrong" ? COLORS.redTint : COLORS.white}
                            flash={flash}
                            onTap={(el) => {
                                if (canInspect) onInspectCell?.(i);
                                else if (canOpen) onOpenCell?.(i, el);
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
                                            key={`${side}-${i}-${ink.length}`}
                                            character={ch}
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
                                    {!back && locked[i] && (
                                        <Lock className="writing-card-face__cell-locked" sx={{ position: "absolute", top: 6, left: 6, fontSize: 16, color: COLORS.textFaint }} />
                                    )}
                                    {result === "correct" && (
                                        <CheckCircle className="writing-card-face__result" sx={{ position: "absolute", top: 6, right: 6, fontSize: 20, color: COLORS.successInk }} />
                                    )}
                                    {result === "wrong" && (
                                        <Cancel className="writing-card-face__result" sx={{ position: "absolute", top: 6, right: 6, fontSize: 20, color: COLORS.dangerInk }} />
                                    )}
                                </>
                            )}
                        </CellBox>
                    );
                })}
            </Box>
            </Box>

            {/* The bottom hint line. The card itself is the submit/continue target
                (useWritingFlashcard.handleCardClick); cells stop their own taps. */}
            <Box className="writing-card-face__hint" sx={{ fontSize: SIZE.caption, color: COLORS.textSecondary, minHeight: 36, display: "flex", alignItems: "center", gap: 0.5 }}>
                {back ? "Tap the card to continue" : checking ? "Checking…" : "Tap the card to submit"}
                {!checking && <TouchApp className="writing-card-face__hint-icon" sx={{ fontSize: 16, color: COLORS.textSecondary }} />}
            </Box>
        </Box>
    );
}

/** Gap between grid cells, px — also subtracted when sizing the 2×2 cell. */
const CELL_GAP = 12;
/** The header icon's box, px. */
const ICON_SIZE = 84;

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
 * Measures the grid area and returns the side of one cell of the 2×2 layout — the
 * 4-character word's cell (WRITING_MAX_CHARS) — so 1-, 2- and 3-character words use the
 * very same size rather than growing to fill the space. The cell is as large as BOTH
 * axes allow for two cells plus one gap.
 */
function useFourCharCellSize() {
    const gridRef = useRef<HTMLDivElement | null>(null);
    const [cellPx, setCellPx] = useState(0);
    useEffect(() => {
        const el = gridRef.current;
        if (!el) return;
        // WRITING_MAX_CHARS (4) characters in a square grid: 2 cells per row, 2 rows.
        const perAxis = Math.ceil(Math.sqrt(WRITING_MAX_CHARS));
        const measure = () => {
            const style = getComputedStyle(el);
            const h = el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
            const fit = (len: number) => (len - CELL_GAP * (perAxis - 1)) / perAxis;
            setCellPx(Math.max(0, Math.floor(Math.min(fit(el.clientWidth), fit(h)))));
        };
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        measure();
        return () => ro.disconnect();
    }, []);
    return { gridRef, cellPx };
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
    /** Pulse the OUTLINE twice (orgMk — attention, deliberately NOT the red "wrong" tint). */
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
