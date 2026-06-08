import { forwardRef, useImperativeHandle, useRef } from "react";
import { Box, Switch, Typography, useTheme } from "@mui/material";
import { InfoSheetEntryHeader } from "./styled";
import { FC_FONT } from "./constants";
import { SIZE } from "../../theme/scale";
import type { SheetPanelBodyHandle } from "./SheetPanel";
import type { FlashcardLearnSettings } from "../../hooks/useFlashcardLearnSettings";

export interface SettingsPanelBodyProps {
    settings: FlashcardLearnSettings;
    update: (patch: Partial<FlashcardLearnSettings>) => void;
    scrollTouchAction?: React.CSSProperties["touchAction"];
}

/**
 * Body of the flashcards Settings sheet. Mirrors InfoCardPanelBody's
 * structural skeleton (forwarded {root, scroll} handle, flex column,
 * scroll container that hosts the resize-coupling gestures) so SheetPanel
 * can wire its scroll/resize coupling exactly as it does for the EIP.
 */
const SettingsPanelBody = forwardRef<SheetPanelBodyHandle, SettingsPanelBodyProps>(function SettingsPanelBody({
    settings,
    update,
    scrollTouchAction = "none",
}, ref) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    useImperativeHandle(ref, () => ({
        get root() { return rootRef.current; },
        get scroll() { return scrollRef.current; },
    }), []);
    const theme = useTheme();
    const fc = theme.palette.flashcard;

    // Control-placement principle (see also FlashcardsLearnHeader):
    //   • Header = "quick" toggles flipped often mid-study (pinyin, autoplay).
    //   • Settings sheet = "setup" prefs set once and rarely changed.
    // `showPinyin` and `autoplayChinese` also appear in the header by design —
    // the sheet lists every pref so it stays the single complete control panel,
    // while the header surfaces only the two high-frequency ones.
    //
    // `indented` marks a pref that modifies its predecessor (tone color only
    // makes sense while pinyin is shown), so it renders as a visually nested
    // sub-toggle beneath its parent.
    const rows: Array<{ key: keyof FlashcardLearnSettings; label: string; visible: boolean; indented?: boolean }> = [
        { key: "showPinyin", label: "Show pinyin", visible: true },
        // Pinyin color is meaningless when pinyin itself is hidden — nest it under pinyin.
        { key: "showPinyinColor", label: "Color pinyin by tone", visible: settings.showPinyin, indented: true },
        { key: "showSegmentSpaces", label: "Show spaces between words", visible: true },
        { key: "autoplayChinese", label: "Autoplay audio on Chinese side", visible: true },
        { key: "showProgressCategory", label: "Show progress category on back", visible: true },
    ];

    return (
        <Box
            ref={rootRef}
            className="flashcard-settings-panel-body"
            sx={{
                display: "flex",
                flexDirection: "column",
                flex: 1,
                minHeight: 0,
                touchAction: scrollTouchAction,
            }}
        >
            <InfoSheetEntryHeader className="flashcard-settings-header">
                <Typography
                    className="flashcard-settings-title"
                    sx={{
                        fontSize: SIZE.bodyLg,
                        fontWeight: 600,
                        color: fc.onSurface,
                        fontFamily: FC_FONT,
                        lineHeight: 1.3,
                        flex: 1,
                    }}
                >
                    Settings
                </Typography>
            </InfoSheetEntryHeader>

            <Box
                ref={scrollRef}
                className="flashcard-settings-scroll"
                sx={{
                    flex: 1,
                    minHeight: 0,
                    overflow: "auto",
                    padding: "8px 18px 16px",
                    overscrollBehavior: "contain",
                    touchAction: scrollTouchAction,
                }}
            >
                {rows.filter(r => r.visible).map((row, i, arr) => (
                    <Box
                        key={row.key}
                        className={`flashcard-settings-row flashcard-settings-row-${row.key}${row.indented ? " flashcard-settings-row-nested" : ""}`}
                        sx={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "12px 0",
                            // Nested sub-toggles indent and add a left rule so the
                            // parent/child relationship reads at a glance.
                            ...(row.indented && {
                                paddingLeft: "14px",
                                marginLeft: "4px",
                                borderLeft: `2px solid ${fc.border}`,
                            }),
                            borderBottom: i === arr.length - 1 ? "none" : `1px solid ${fc.border}`,
                        }}
                    >
                        <Typography
                            className="flashcard-settings-row-label"
                            sx={{
                                fontSize: row.indented ? 13 : 14,
                                color: row.indented ? fc.textSecondary : fc.onSurface,
                                fontFamily: FC_FONT,
                            }}
                        >
                            {row.label}
                        </Typography>
                        <Switch
                            className={`flashcard-settings-row-switch flashcard-settings-row-switch-${row.key}`}
                            checked={settings[row.key]}
                            onChange={(e) => update({ [row.key]: e.target.checked } as Partial<FlashcardLearnSettings>)}
                            size="small"
                        />
                    </Box>
                ))}
            </Box>
        </Box>
    );
});

export default SettingsPanelBody;
