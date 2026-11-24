import { Button } from "@mui/material";
import { READER_PILL_OFF_OPACITY, readerPillButtonSx } from "./readerStyles";
import type { ReaderStepMode } from "./useReaderStepMode";
import type { Tier2Look } from "../timeOfDay/tier2Look";

/**
 * ReaderPhraseToggle — the "Phrase" pill, just left of the Pinyin pill (owner's call
 * 2026-11-23: "locate next to pinyin pill") on the Reader's display strip and the cyoa
 * story page's toolbar. One button, always labelled "Phrase", styled exactly like the
 * Pinyin pill (ReaderDisplayToggle):
 *
 *   off (step by word)   — the NEUTRAL surface pill, FADED (READER_PILL_OFF_OPACITY).
 *   on  (step by phrase) — the same pill at full strength.
 *
 * Unlike the Pinyin pill it commits straight away: switching changes only which span list
 * navigation walks (useReadingText → `stepSpans`), with nothing heavy to mount.
 *
 * Chinese only — the phrase rules are Chinese grammar (phraseChunking.ts); the pages do not
 * render it for other languages.
 *
 * Layer: shared presentation (src/reading); state lives in useReaderStepMode (`reader.stepMode`,
 * per device — one setting for the Reader and cyoa).
 * Docs: docs/READER_SEGMENTATION.md § "Phrase stepping".
 */
interface ReaderPhraseToggleProps {
    look: Tier2Look;
    value: ReaderStepMode;
    onChange: (mode: ReaderStepMode) => void;
    className?: string;
    // Hidden but still laid out (edit mode, the open search bar), so the strip keeps its height.
    hidden?: boolean;
}

function ReaderPhraseToggle({ look, value, onChange, className, hidden = false }: ReaderPhraseToggleProps) {
    const phraseOn = value === "phrase";
    return (
        <Button
            className={`reader-phrase-toggle${phraseOn ? " reader-phrase-toggle--on" : ""}${className ? ` ${className}` : ""}`}
            // Keep focus on the reading box (useTextSelection's blur → refocus loop).
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChange(phraseOn ? "word" : "phrase")}
            aria-pressed={phraseOn}
            aria-label="Step by phrase"
            sx={{
                ...readerPillButtonSx(look),
                opacity: phraseOn ? 1 : READER_PILL_OFF_OPACITY,
                visibility: hidden ? "hidden" : "visible",
            }}
        >
            Phrase
        </Button>
    );
}

export default ReaderPhraseToggle;
