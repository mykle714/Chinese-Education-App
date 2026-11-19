import { useEffect, useRef } from "react";
import { Box, InputBase } from "@mui/material";
import { keyframes } from "@mui/material/styles";
import Icon from "../../components/Icon";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import ReaderSearchKey from "./ReaderSearchKey";
import type { Tier2Look } from "../../timeOfDay/tier2Look";

/**
 * ReaderSearchBar — the Reader's find-in-document bar: the search key, opened, filling
 * the whole display strip (ReaderDocumentPage → `.reader-document-display-strip`).
 *
 *   [🔍 find in text…           2/7] [˄] [˅] [✕]
 *
 * A pill FIELD in the Reader's neutral pill look (the look's surface, ink and outline,
 * 30px tall like the Read pill) holding the query and the "current / total" count, then
 * three ReaderSearchKeys: previous match, next match, close.
 *
 * OPENING: the bar is laid over the strip (absolute, full row) and GROWS out of the
 * search key — a clip-path inset that starts at the key's box (`origin`, measured by the
 * page) and opens to the full row, so the key reads as stretching into the field. The
 * strip's own controls are hidden underneath (keeping its height).
 *
 * KEYS: Enter = next match, Shift+Enter = previous, Escape = close. The field focuses on
 * open (raising the keyboard — the app's default, so the beginner keyboard for zh, whose
 * ABC key hands over to the OS one for pinyin); the page folds the keycap away while a
 * keyboard is up (ReaderDocumentPage → KEYBOARD LIFT). The whole bar is a
 * `data-beginner-keyboard="keep"` region, so tapping it never dismisses that keyboard.
 *
 * Layer: feature presentational component (src/features/reader); state in useReaderSearch.
 * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Search".
 */

// The opening grow, ms — the edit toolbar's drop-in timing (ReaderDocumentPage →
// EDIT_TOOLBAR_ANIM_MS / _EASING), so the Reader's two "a bar opens" motions match.
const OPEN_MS = 300;
const OPEN_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
// Space between the field and each key, px.
const BAR_GAP_PX = 6;

// Clip from the key's box (CSS vars set per open) to the whole row. The contents fade in
// over the first part so they don't slide out from under a moving edge.
const growFromKey = keyframes`
    from { clip-path: inset(0 var(--reader-search-from-right) 0 var(--reader-search-from-left) round 999px); }
    to { clip-path: inset(0 0 0 0 round 0px); }
`;

interface ReaderSearchBarProps {
    look: Tier2Look;
    query: string;
    onQueryChange: (query: string) => void;
    matchCount: number;
    // Index of the current match, -1 when none.
    currentIndex: number;
    onStep: (direction: "next" | "prev") => void;
    onClose: () => void;
    // The field's placeholder — the page says whether pinyin is searched too.
    placeholder: string;
    // The search key's box inside the strip, px from the strip's left and right edges —
    // where the opening grow starts. Null skips the grow (no measurement).
    origin: { left: number; right: number } | null;
    // The search field, for the page to focus / check focus.
    inputRef: React.RefObject<HTMLInputElement | null>;
}

function ReaderSearchBar({
    look,
    query,
    onQueryChange,
    matchCount,
    currentIndex,
    onStep,
    onClose,
    placeholder,
    origin,
    inputRef,
}: ReaderSearchBarProps) {
    // Focus the field on open (the keyboard trigger: BeginnerKeyboardProvider listens for
    // `focusin`). preventScroll: the page is a fixed shell; the strip is already on screen.
    useEffect(() => {
        inputRef.current?.focus({ preventScroll: true });
    }, [inputRef]);

    // The origin is read once, at mount — a later re-measure must not replay the grow.
    const originRef = useRef(origin);

    const hasMatches = matchCount > 0;
    const countLabel = !query ? "" : hasMatches ? `${currentIndex + 1}/${matchCount}` : "0/0";

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
            event.preventDefault();
            if (hasMatches) onStep(event.shiftKey ? "prev" : "next");
        } else if (event.key === "Escape") {
            event.preventDefault();
            onClose();
        }
    };

    return (
        <Box
            className="reader-search-bar"
            // Keeps the beginner keyboard up through a tap anywhere on the bar — ˄ / ˅, ✕'s
            // press, the gaps between keys. It dismisses on any pointerdown outside an
            // allow-list (BeginnerKeyboardProvider → `onPointerDown` / `keepsOpen`), and
            // its close would drop the keyboard inset and unfold the rdb (ReaderDocumentPage
            // → KEYBOARD LIFT). The keys' mousedown preventDefault (ReaderSearchKey) is the
            // separate guard for the OS keyboard: it keeps the field focused.
            data-beginner-keyboard="keep"
            sx={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                gap: `${BAR_GAP_PX}px`,
                ...(originRef.current && {
                    "--reader-search-from-left": `${originRef.current.left}px`,
                    "--reader-search-from-right": `${originRef.current.right}px`,
                    animation: `${growFromKey} ${OPEN_MS}ms ${OPEN_EASING} both`,
                    "@media (prefers-reduced-motion: reduce)": { animation: "none" },
                }),
            }}
        >
            <Box
                className="reader-search-bar__field"
                // A tap anywhere on the pill (the icon, the count) puts the caret in the field.
                onMouseDown={(event) => {
                    if (event.target !== inputRef.current) {
                        event.preventDefault();
                        inputRef.current?.focus({ preventScroll: true });
                    }
                }}
                sx={{
                    flex: 1,
                    minWidth: 0,
                    height: 30,
                    display: "flex",
                    alignItems: "center",
                    gap: 0.75,
                    pl: 1.25,
                    pr: 1.5,
                    boxSizing: "border-box",
                    backgroundColor: look.surface,
                    border: `1px solid ${look.outline}`,
                    borderRadius: "999px",
                    cursor: "text",
                }}
            >
                <Icon name="search" size={18} color={look.muted} />
                <InputBase
                    className="reader-search-bar__input"
                    inputRef={inputRef}
                    value={query}
                    onChange={(event) => onQueryChange(event.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    inputProps={{
                        "aria-label": "Find in document",
                        enterKeyHint: "search",
                        autoComplete: "off",
                        autoCorrect: "off",
                        autoCapitalize: "none",
                        spellCheck: false,
                    }}
                    sx={{
                        flex: 1,
                        minWidth: 0,
                        fontFamily: FONTS.sans,
                        fontSize: SIZE.body,
                        color: look.ink,
                        "& input": {
                            padding: 0,
                            height: "auto",
                            // Opt back in: text is app-wide `user-select: none`.
                            userSelect: "text",
                        },
                        "& input::placeholder": { color: look.muted, opacity: 1 },
                    }}
                />
                {countLabel && (
                    <Box
                        component="span"
                        className="reader-search-bar__count"
                        aria-live="polite"
                        sx={{
                            flexShrink: 0,
                            fontFamily: FONTS.sans,
                            fontSize: SIZE.caption,
                            fontWeight: WEIGHT.semibold,
                            fontVariantNumeric: "tabular-nums",
                            color: look.muted,
                        }}
                    >
                        {countLabel}
                    </Box>
                )}
            </Box>
            <ReaderSearchKey
                look={look}
                className="reader-search-bar__prev"
                icon="keyboard_arrow_up"
                label="Previous match"
                onClick={() => onStep("prev")}
                disabled={!hasMatches}
            />
            <ReaderSearchKey
                look={look}
                className="reader-search-bar__next"
                icon="keyboard_arrow_down"
                label="Next match"
                onClick={() => onStep("next")}
                disabled={!hasMatches}
            />
            <ReaderSearchKey
                look={look}
                className="reader-search-bar__close"
                icon="close"
                label="Close search"
                onClick={onClose}
            />
        </Box>
    );
}

export default ReaderSearchBar;
