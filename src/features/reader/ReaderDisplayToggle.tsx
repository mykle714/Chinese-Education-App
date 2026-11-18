import { useEffect, useRef, useState } from "react";
import { Box, Switch } from "@mui/material";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import type { ReaderDisplayMode } from "./useReaderSettings";
import type { Tier2Look } from "../../timeOfDay/tier2Look";

/**
 * ReaderDisplayToggle — the Text ⇄ Pinyin switch at the right of the Reader's display
 * strip (ReaderDocumentPage → `.reader-document-display-strip`).
 *
 * The Account sheet's GOALS switch (owner's call 2026-11-17): the app-wide MUI `Switch`
 * (its look comes from the `MuiSwitch` theme override in ThemeContext), with only the
 * "on" track recoloured to a ramp Mark tier — the same treatment as
 * pages/account/AccountPane.tsx → `goalSwitchOnSx`. Flanked by its two labels,
 * "Text  ◯━  Pinyin"; the label of the current mode is ink, the other muted — both from the
 * page's time-of-day `look`, so they read on the night slate.
 * Off = Text, on = Pinyin. Tapping either label also picks that mode.
 *
 * Layer: feature presentational component (src/features/reader); state lives in
 * useReaderSettings (`displayMode`, per device).
 * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Display modes".
 */

// The "on" track colour. Blue: the Reader's own hue (its New document pill and the
// vocab-processing pill are blue), as a ramp Mark tier like the goal switches' redMk / orgMk.
const PINYIN_ON_TRACK = COLORS.bluMk;

// DEFERRED COMMIT: how long the switch shows its new position before the mode change
// reaches the page. Turning Pinyin on mounts the whole ReaderCpcdView (one cpcd per word)
// synchronously, which blocks the main thread; committed at once, the thumb would jump
// instead of sliding. MUI's switch slides its thumb and fades its track over
// `theme.transitions.duration.shortest` (150ms — not overridden by ThemeContext's
// MuiSwitch block); the extra margin lets the last frame paint before the heavy render.
const SWITCH_ANIMATION_MS = 200;

interface ReaderDisplayToggleProps {
    // The page's time-of-day look (ReaderDocumentPage → useTier2Look) — the labels' ink.
    look: Tier2Look;
    value: ReaderDisplayMode;
    onChange: (mode: ReaderDisplayMode) => void;
    className?: string;
    // Hidden but still laid out (edit mode), so the strip keeps its height.
    hidden?: boolean;
}

function ReaderDisplayToggle({ look, value, onChange, className, hidden = false }: ReaderDisplayToggleProps) {
    // DEFERRED COMMIT: the mode the switch already shows but has not yet handed to the
    // page (null = none in flight). The switch and labels draw this optimistic value.
    const [pendingMode, setPendingMode] = useState<ReaderDisplayMode | null>(null);
    const commitTimerRef = useRef<number | null>(null);
    const shownMode = pendingMode ?? value;
    const pinyinOn = shownMode === "pinyin";

    // Read the latest onChange at commit time, not the one captured at tap time.
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    // Leaving the page mid-animation drops the pending change (nothing left to switch).
    useEffect(() => () => {
        if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
    }, []);

    const pick = (mode: ReaderDisplayMode) => {
        if (mode === shownMode) return;
        if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
        setPendingMode(mode);
        commitTimerRef.current = window.setTimeout(() => {
            commitTimerRef.current = null;
            // Same batch: the page's value becomes `mode` as the optimistic one clears,
            // so the switch never flickers back. A flip straight back to the page's
            // current value commits a no-op.
            onChangeRef.current(mode);
            setPendingMode(null);
        }, SWITCH_ANIMATION_MS);
    };

    const label = (mode: ReaderDisplayMode, text: string) => (
        <Box
            component="span"
            className={`reader-display-toggle__label reader-display-toggle__label--${mode}`}
            onClick={() => pick(mode)}
            sx={{
                fontFamily: FONTS.sans,
                fontSize: SIZE.caption,
                fontWeight: WEIGHT.semibold,
                color: shownMode === mode ? look.ink : look.muted,
                cursor: "pointer",
                userSelect: "none",
            }}
        >
            {text}
        </Box>
    );

    return (
        <Box
            className={`reader-display-toggle${className ? ` ${className}` : ""}`}
            // Keep focus on the reading box (same as the dictionary keycap): a click here
            // would otherwise blur it and trip useTextSelection's blur → refocus loop.
            onMouseDown={(event) => event.preventDefault()}
            sx={{
                display: "inline-flex",
                alignItems: "center",
                gap: 0.5,
                visibility: hidden ? "hidden" : "visible",
            }}
        >
            {label("text", "Text")}
            <Switch
                className="reader-display-toggle__switch"
                checked={pinyinOn}
                onChange={(event) => pick(event.target.checked ? "pinyin" : "text")}
                inputProps={{ "aria-label": "Show pinyin" }}
                sx={{ "& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track": { backgroundColor: PINYIN_ON_TRACK } }}
            />
            {label("pinyin", "Pinyin")}
        </Box>
    );
}

export default ReaderDisplayToggle;
