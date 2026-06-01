import React from "react";
import { Button, useTheme } from "@mui/material";
import PageHeader from "../../components/PageHeader";
import MinutePointsFireBadge from "../../components/MinutePointsFireBadge";

interface BubbleMatchHeaderProps {
    onBack: () => void;
    showPinyin: boolean;
    onTogglePinyin: () => void;
    autoplayChinese: boolean;
    onToggleAutoplayChinese: () => void;
}

/**
 * Header for the Bubble Match game. Mirrors FlashcardsLearnHeader's two quick
 * toggles (pinyin + autoplay) and the minute-points fire badge, composed onto
 * the shared PageHeader primitive (it opts out of the hamburger like the other
 * specialty headers).
 */
const BubbleMatchHeader: React.FC<BubbleMatchHeaderProps> = ({
    onBack,
    showPinyin,
    onTogglePinyin,
    autoplayChinese,
    onToggleAutoplayChinese,
}) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;

    const toggleSx = (active: boolean) => ({
        minWidth: "unset",
        px: 1,
        py: 0.25,
        height: "30px",
        fontSize: "0.65rem",
        textTransform: "lowercase" as const,
        lineHeight: 1.4,
        borderRadius: "6px",
        backgroundColor: active ? fc.toggleActiveBg : fc.toggleInactiveBg,
        color: fc.onSurface,
        "&:hover": { backgroundColor: active ? fc.toggleActiveBg : fc.toggleInactiveBg },
    });

    const rightContent = (
        <>
            <Button
                className="pinyin-toggle-btn"
                variant={showPinyin ? "contained" : "text"}
                size="small"
                onClick={onTogglePinyin}
                sx={toggleSx(showPinyin)}
            >
                pinyin
            </Button>
            <Button
                className="autoplay-toggle-btn"
                variant={autoplayChinese ? "contained" : "text"}
                size="small"
                onClick={onToggleAutoplayChinese}
                sx={toggleSx(autoplayChinese)}
            >
                autoplay
            </Button>
            <MinutePointsFireBadge />
        </>
    );

    return <PageHeader title="Bubble Match" onBack={onBack} rightContent={rightContent} />;
};

export default BubbleMatchHeader;
