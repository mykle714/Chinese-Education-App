import { useEffect, useRef, useState } from "react";
import { Button } from "@mui/material";
import { READER_PILL_OFF_OPACITY, readerPillButtonSx } from "./readerStyles";
import type { ReaderDisplayMode } from "./useReaderDisplayMode";
import type { Tier2Look } from "../timeOfDay/tier2Look";

/**
 * ReaderDisplayToggle — the "Pinyin" pill at the right of the Reader's display strip
 * (ReaderDocumentPage → `.reader-document-display-strip`). One button, always labelled
 * "Pinyin", with two style states:
 *
 *   off (Text mode)   — the NEUTRAL surface pill, FADED (readerStyles → READER_PILL_OFF_OPACITY).
 *   on  (Pinyin mode) — the same pill at full strength.
 *
 * The Reader's pill recipe (readerStyles → readerPillButtonSx, neutral: white by day,
 * slate at night), like the Read/Stop pill at the strip's left edge. No hue for "on"
 * (owner's call 2026-11-18: faded → not faded, not blue). Replaced the Account-sheet-style
 * "Text ◯━ Pinyin" MUI Switch (owner's call 2026-11-18).
 *
 * Layer: shared presentation (src/reading — the reading engine shared by the Reader and cyoa, docs/CYOA_FEATURE.md § 4); state lives in
 * useReaderDisplayMode (`displayMode`, per device — one setting for the Reader and cyoa).
 * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Display modes".
 */

interface ReaderDisplayToggleProps {
    // The page's time-of-day look (ReaderDocumentPage → useTier2Look) — the off pill's surface + ink.
    look: Tier2Look;
    value: ReaderDisplayMode;
    onChange: (mode: ReaderDisplayMode) => void;
    className?: string;
    // Hidden but still laid out (edit mode), so the strip keeps its height.
    hidden?: boolean;
}

function ReaderDisplayToggle({ look, value, onChange, className, hidden = false }: ReaderDisplayToggleProps) {
    // DEFERRED COMMIT: the mode the pill already shows but has not yet handed to the page
    // (null = none in flight). Turning Pinyin on mounts the whole ReaderCpcdView (one cpcd
    // per word) synchronously, which blocks the main thread; committed in the tap's own
    // render, the pill would sit unchanged until that work finished. So the pill paints its
    // new state first, and the mode reaches the page on the frame after (double rAF = after
    // the next paint).
    const [pendingMode, setPendingMode] = useState<ReaderDisplayMode | null>(null);
    const frameRef = useRef<number | null>(null);
    const shownMode = pendingMode ?? value;
    const pinyinOn = shownMode === "pinyin";

    // Read the latest onChange at commit time, not the one captured at tap time.
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    // Leaving the page mid-commit drops the pending change (nothing left to switch).
    useEffect(() => () => {
        if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    }, []);

    const toggle = () => {
        const mode: ReaderDisplayMode = pinyinOn ? "text" : "pinyin";
        if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
        setPendingMode(mode);
        frameRef.current = window.requestAnimationFrame(() => {
            frameRef.current = window.requestAnimationFrame(() => {
                frameRef.current = null;
                // Same batch: the page's value becomes `mode` as the optimistic one clears,
                // so the pill never flickers back. A flip straight back to the page's
                // current value commits a no-op.
                onChangeRef.current(mode);
                setPendingMode(null);
            });
        });
    };

    return (
        <Button
            className={`reader-display-toggle${pinyinOn ? " reader-display-toggle--pinyin" : ""}${className ? ` ${className}` : ""}`}
            // Keep focus on the reading box (same as the dictionary keycap): a click here
            // would otherwise blur it and trip useTextSelection's blur → refocus loop.
            onMouseDown={(event) => event.preventDefault()}
            onClick={toggle}
            aria-pressed={pinyinOn}
            aria-label="Show pinyin"
            sx={{
                ...readerPillButtonSx(look),
                opacity: pinyinOn ? 1 : READER_PILL_OFF_OPACITY,
                visibility: hidden ? "hidden" : "visible",
            }}
        >
            Pinyin
        </Button>
    );
}

export default ReaderDisplayToggle;
