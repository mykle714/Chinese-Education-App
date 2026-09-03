import { useRef } from "react";
import { TextField, InputAdornment, IconButton } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import { Search, Clear } from "@mui/icons-material";
import { COLORS } from "../theme/colors";

/**
 * SearchField — the app's ONE search box.
 *
 * ── Why it is a component ─────────────────────────────────────────────────────
 * Seven surfaces had independently hand-rolled the same MUI `TextField`: a magnifier
 * `startAdornment`, a conditional clear-button `endAdornment`, `fullWidth`, and a
 * placeholder. They had already drifted — three icon sizes, two icon colors, two
 * spellings of the clear button's aria-label, and one copy that focused the input
 * after clearing while the rest did not. This owns that markup so a search box looks
 * and behaves identically wherever it appears.
 *
 * ── The inline filter slot ────────────────────────────────────────────────────
 * `endAction` renders INSIDE the input's trailing adornment, to the right of the
 * clear button. It exists so that a surface which filters or reorders its results
 * (the collection page and the decks panel, both via CollectionSortControl) puts that
 * control on the search row itself rather than on a second row beneath it — a search
 * box and its filter are one control, and the app should only ever show them as one.
 * Pass an ICON-sized node: the slot is sized for an `IconButton`, not a text button.
 *
 * ── What it does NOT own ──────────────────────────────────────────────────────
 * Debouncing, querying, and the result list. The host holds the term in state and
 * decides what a term means — some search the server (dictionary, icons8), some filter
 * an already-loaded array (collection, decks panel).
 *
 * Layer: shared presentation component (src/components). No data access.
 *
 * Referenced by: CollectionViewPage, DecksPanelBody, DictionaryPage, CommunitySearchBar,
 * IconPickerDialog, CompareWorkspace, EntriesPage.
 * Docs: docs/DECKS_FEATURE.md § "Search + filter row".
 */
export interface SearchFieldProps {
    /** The current term. Controlled — the host owns this state. */
    value: string;
    /** Receives the new term directly (not the change event). */
    onChange: (next: string) => void;
    placeholder?: string;
    /**
     * Clear behavior. Defaults to `onChange("")`; pass this only when clearing means
     * more than emptying the term (e.g. useDictionarySearch also drops its results).
     * The field always re-focuses the input afterwards, so the user can retype without
     * re-tapping.
     */
    onClear?: () => void;
    /** Needed by hosts that drive the input from outside it (PinyinKeypad inserts characters). */
    inputRef?: React.Ref<HTMLInputElement>;
    /** MUI density. `small` also shrinks the adornment icons to match. */
    size?: "small" | "medium";
    /** The host's own class hook, e.g. `collection-view__search-input`. */
    className?: string;
    /**
     * Inline trailing control — a filter / sort trigger. Rendered after the clear
     * button, inside the same adornment. See "The inline filter slot" above.
     */
    endAction?: React.ReactNode;
    sx?: SxProps<Theme>;
}

const SearchField: React.FC<SearchFieldProps> = ({
    value,
    onChange,
    placeholder,
    onClear,
    inputRef,
    size = "small",
    className,
    endAction,
    sx,
}) => {
    // The adornment icons track the field's density so a `small` field does not carry
    // full-size 24px glyphs (which is what three of the seven call sites used to do).
    const iconSize = size === "small" ? "small" : "medium";

    // Own the input node even when the host passed its own ref, so clearing can restore
    // focus in every case. Both refs are attached via the callback below.
    const innerRef = useRef<HTMLInputElement | null>(null);

    const attachRef = (node: HTMLInputElement | null) => {
        innerRef.current = node;
        if (typeof inputRef === "function") inputRef(node);
        else if (inputRef) (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = node;
    };

    const handleClear = () => {
        if (onClear) onClear();
        else onChange("");
        innerRef.current?.focus();
    };

    return (
        <TextField
            className={className}
            fullWidth
            size={size}
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            inputRef={attachRef}
            InputProps={{
                startAdornment: (
                    <InputAdornment position="start">
                        <Search fontSize={iconSize} sx={{ color: COLORS.textSecondary }} />
                    </InputAdornment>
                ),
                // One adornment for both trailing controls: `endAction` is persistent
                // while the clear button appears only while there is text to clear, so
                // the filter must not sit in an adornment that unmounts with the term.
                endAdornment: (value || endAction) ? (
                    <InputAdornment position="end">
                        {value ? (
                            <IconButton
                                className={className ? `${className}-clear` : undefined}
                                aria-label="Clear search"
                                size="small"
                                onClick={handleClear}
                                edge={endAction ? false : "end"}
                            >
                                <Clear fontSize={iconSize} />
                            </IconButton>
                        ) : null}
                        {endAction}
                    </InputAdornment>
                ) : undefined,
            }}
            sx={sx}
        />
    );
};

export default SearchField;
