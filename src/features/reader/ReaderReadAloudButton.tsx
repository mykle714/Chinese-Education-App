import { Box, Button } from "@mui/material";
import Icon from "../../components/Icon";
import { COLORS } from "../../theme/colors";
import { readerPillButtonSx } from "./readerStyles";
import { READ_ALOUD_CONTROL_ATTR } from "./useReaderReadAloud";
import type { Tier2Look } from "../../timeOfDay/tier2Look";

/**
 * ReaderReadAloudButton — the play/stop pill at the LEFT of the Reader's display strip
 * (ReaderDocumentPage → `.reader-document-display-strip`), opposite the Pinyin
 * pill (ReaderDisplayToggle). Starts useReaderReadAloud from the caret.
 *
 * The Reader's pill recipe (readerStyles → readerPillButtonSx): the neutral surface pill
 * (white by day, slate at night — the page's time-of-day `look`) with "Read" while idle, and the Reader's own blue mid tier (`COLORS.bluM`, the toolbar Save's fill)
 * with "Stop" while playing, so the state reads at a glance. Ink text either way (a hue
 * never carries text). While playing, any tap on the page stops the reading and still
 * reaches its target (useReaderReadAloud → ANY INPUT STOPS IT); this pill is exempt from
 * that listener (`READ_ALOUD_CONTROL_ATTR`) and stops through its own onClick, so the tap
 * cannot stop and then restart the reading.
 *
 * Layer: feature presentational component (src/features/reader); state in useReaderReadAloud.
 * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Read aloud".
 */
interface ReaderReadAloudButtonProps {
    look: Tier2Look;
    playing: boolean;
    onStart: () => void;
    onStop: () => void;
    disabled?: boolean;
    // Hidden but still laid out (edit mode), like ReaderDisplayToggle, so the strip keeps its height.
    hidden?: boolean;
}

function ReaderReadAloudButton({ look, playing, onStart, onStop, disabled = false, hidden = false }: ReaderReadAloudButtonProps) {
    return (
        <Button
            className={`reader-read-aloud-button${playing ? " reader-read-aloud-button--playing" : ""}`}
            // Keep focus on the reading box (same as ReaderDisplayToggle): a click here would
            // otherwise blur it and trip useTextSelection's blur → refocus loop — and the
            // caret the read starts from lives in that box.
            onMouseDown={(event) => event.preventDefault()}
            onClick={playing ? onStop : onStart}
            {...{ [READ_ALOUD_CONTROL_ATTR]: true }}
            disabled={disabled}
            aria-label={playing ? "Stop reading aloud" : "Read aloud from the cursor"}
            sx={{
                ...readerPillButtonSx(look, playing ? COLORS.bluM : undefined),
                gap: 0.5,
                pl: 1.25,
                visibility: hidden ? "hidden" : "visible",
            }}
        >
            {/* The colour goes on the Icon itself: Icon defaults to COLORS.iconColor (a dark
                grey) and does not inherit, so a wrapper `color` left it dark on the night slate. */}
            <Box component="span" className="reader-read-aloud-button__icon" sx={{ display: "inline-flex" }}>
                <Icon name={playing ? "stop" : "play_arrow"} size={18} color={playing ? COLORS.onSurface : look.ink} />
            </Box>
            {playing ? "Stop" : "Read"}
        </Button>
    );
}

export default ReaderReadAloudButton;
