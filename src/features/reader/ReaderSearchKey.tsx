import { Button } from "@mui/material";
import Icon from "../../components/Icon";
import { readerPillButtonSx } from "../../reading/readerStyles";
import type { Tier2Look } from "../../timeOfDay/tier2Look";

/**
 * ReaderSearchKey — a round 30px key in the Reader's pill recipe (readerStyles →
 * readerPillButtonSx, neutral: the look's surface + ink + outline) carrying one icon.
 *
 * Two jobs on the display strip (ReaderDocumentPage → `.reader-document-display-strip`):
 *   - the closed search bar's SEARCH key, between Read and the audio chip (owner's call
 *     2026-11-18), which opens ReaderSearchBar;
 *   - the open bar's ˄ / ˅ / ✕ keys (ReaderSearchBar).
 * Same 30px height as the Read pill, so the strip's height never changes.
 *
 * `onMouseDown` preventDefault keeps focus where it is — on the reading box while the
 * bar is closed (useTextSelection's blur → refocus loop), and in the search field while
 * it is open, so stepping through matches doesn't drop its keyboard.
 *
 * Layer: feature presentational component (src/features/reader).
 * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Search".
 */
interface ReaderSearchKeyProps {
    look: Tier2Look;
    icon: string;
    label: string;
    onClick: () => void;
    className?: string;
    disabled?: boolean;
    // Hidden but still laid out (edit mode), like the strip's other controls.
    hidden?: boolean;
    buttonRef?: React.Ref<HTMLButtonElement>;
}

const READER_SEARCH_KEY_PX = 30;

function ReaderSearchKey({ look, icon, label, onClick, className, disabled = false, hidden = false, buttonRef }: ReaderSearchKeyProps) {
    return (
        <Button
            ref={buttonRef}
            className={`reader-search-key${className ? ` ${className}` : ""}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            title={label}
            sx={{
                ...readerPillButtonSx(look),
                width: READER_SEARCH_KEY_PX,
                height: READER_SEARCH_KEY_PX,
                px: 0,
                flexShrink: 0,
                visibility: hidden ? "hidden" : "visible",
            }}
        >
            <Icon name={icon} size={18} color={look.ink} />
        </Button>
    );
}

export default ReaderSearchKey;
