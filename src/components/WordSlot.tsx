import type { ReactNode } from "react";
import { Box, useTheme } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import { Add } from "@mui/icons-material";

/**
 * WordSlot — the big outlined word box: a giant "+" while empty, the word once filled.
 * Tapping it is the host's call (open a dictionary search, arm a delete, …).
 *
 * Extracted from CompareWorkspace's two compare slots (docs/WORD_COMPARE_FEATURE.md).
 *
 * Used by: CompareWorkspace.
 * LAYER: shared presentational.
 */
interface WordSlotProps {
    /** The word as rendered by the host (ForeignText), or null for the "+" placeholder. */
    children?: ReactNode;
    /** Draw the destructive ring (Compare's armed-for-delete slot). */
    armed?: boolean;
    onClick: (e: React.MouseEvent) => void;
    className?: string;
    ariaLabel?: string;
    sx?: SxProps<Theme>;
}

export default function WordSlot({ children, armed = false, onClick, className, ariaLabel, sx }: WordSlotProps) {
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    const filled = children !== undefined && children !== null && children !== false;
    return (
        <Box
            className={className ? `word-slot ${className}` : "word-slot"}
            role="button"
            tabIndex={0}
            aria-label={ariaLabel}
            onClick={onClick}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(e as unknown as React.MouseEvent); } }}
            sx={[
                {
                    position: "relative",
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minHeight: "96px",
                    borderRadius: "12px",
                    border: armed ? `2px solid ${theme.palette.error.main}` : `1px solid ${fc.border}`,
                    padding: "8px",
                    cursor: "pointer",
                    transition: "border-color 0.15s ease",
                },
                ...(Array.isArray(sx) ? sx : [sx]),
            ]}
        >
            {filled ? children : <Add className="word-slot__add" sx={{ fontSize: 32, color: fc.textSecondary }} />}
        </Box>
    );
}
