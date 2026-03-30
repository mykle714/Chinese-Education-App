import React from "react";
import { Box } from "@mui/material";

interface CPCDRowProps {
    children: React.ReactNode;
    /** Determines the overlap between adjacent CPCDs: xs → -6px, sm → -6px, md → -4px */
    size?: "xs" | "sm" | "md";
    flexWrap?: "nowrap" | "wrap";
    justifyContent?: string;
    className?: string;
}

// Negative margin values per size — tighter sizes get more overlap
const OVERLAP_BY_SIZE = {
    xs: "-8px",
    sm: "-6px",
    md: "-4px",
};

const CPCDRow: React.FC<CPCDRowProps> = ({
    children,
    size = "sm",
    flexWrap = "nowrap",
    justifyContent,
    className,
}) => {
    const overlap = OVERLAP_BY_SIZE[size];
    // Compensate for the first child's negative margin so it stays at x=0
    const overlapAbs = overlap.replace("-", "");

    return (
        <Box
            className={className}
            sx={{
                display: "flex",
                flexDirection: "row",
                flexWrap,
                paddingLeft: overlapAbs,
                ...(justifyContent && { justifyContent }),
                "& > *": {
                    marginLeft: overlap,
                },
            }}
        >
            {children}
        </Box>
    );
};

export default CPCDRow;
