import { Button } from "@mui/material";
import Icon from "../components/Icon";
import { readerPillButtonSx } from "./readerStyles";
import type { Tier2Look } from "../timeOfDay/tier2Look";

/**
 * ReaderIconKey — a round 30px key in the Reader's pill recipe (readerStyles →
 * readerPillButtonSx, neutral: the look's surface + ink + outline) carrying one icon.
 * (Was `ReaderSearchKey` in src/features/reader until 2026-11-23; moved into the shared
 * reading engine when the cyoa toolbar needed it — features may not import each other.)
 *
 * Its jobs:
 *   - the Reader display strip's SEARCH key, right of Read (ReaderDocumentPage →
 *     `.reader-document-display-strip`), which opens ReaderSearchBar;
 *   - the open search bar's ˄ / ˅ / ✕ keys (ReaderSearchBar);
 *   - the cyoa story toolbar's dictionary-card fold key (StoryPlayPage, docs/CYOA_FEATURE.md § 3.4).
 * Same 30px height as the Read pill, so a strip's height never changes.
 *
 * `onMouseDown` preventDefault keeps focus where it is — on the reading box while the
 * bar is closed (useTextSelection's blur → refocus loop), and in the search field while
 * it is open, so stepping through matches doesn't drop its keyboard.
 *
 * Layer: shared presentation (src/reading).
 * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Search"; docs/CYOA_FEATURE.md § 3.4.
 */
interface ReaderIconKeyProps {
    look: Tier2Look;
    icon: string;
    label: string;
    onClick: () => void;
    className?: string;
    disabled?: boolean;
    // Hidden but still laid out (edit mode), like the strip's other controls.
    hidden?: boolean;
    // Toggle keys (the cyoa fold key): announced as expanded / collapsed.
    ariaExpanded?: boolean;
    buttonRef?: React.Ref<HTMLButtonElement>;
}

const READER_ICON_KEY_PX = 30;

function ReaderIconKey({ look, icon, label, onClick, className, disabled = false, hidden = false, ariaExpanded, buttonRef }: ReaderIconKeyProps) {
    return (
        <Button
            ref={buttonRef}
            className={`reader-icon-key${className ? ` ${className}` : ""}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            aria-expanded={ariaExpanded}
            title={label}
            sx={{
                ...readerPillButtonSx(look),
                width: READER_ICON_KEY_PX,
                height: READER_ICON_KEY_PX,
                px: 0,
                flexShrink: 0,
                visibility: hidden ? "hidden" : "visible",
            }}
        >
            <Icon name={icon} size={18} color={look.ink} />
        </Button>
    );
}

export default ReaderIconKey;
