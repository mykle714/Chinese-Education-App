import React from "react";
import { ButtonBase } from "@mui/material";
import { SIZE } from "../../theme/scale";
import { PLATE_WALL_PX, towerPlateSx } from "../../theme/towerPlate";
import { CREAM_PLATE_TONES, TOWER_SLAB, washPlateTones } from "../../theme/towerSlab";
import { useTowerWash } from "../../timeOfDay/useDayWash";

/**
 * A full-width tower plate for Match Speed's end popup and blocked screen. `primary` is
 * the gold slab plate (the one way on); otherwise a cream card-stock plate.
 *
 * No `COLORS.border` outline: a plate's edge is its wall (docs/TOWER_STYLE_SHIFT.md
 * § "The outline rule").
 *
 * Layer: presentational (games/match-speed).
 */
const MatchSpeedPlateButton: React.FC<{
    className: string;
    onClick: () => void;
    primary?: boolean;
    children: React.ReactNode;
}> = ({ className, onClick, primary = false, children }) => {
    const wash = useTowerWash();
    return (
    <ButtonBase
        className={className}
        onClick={onClick}
        sx={{
            ...towerPlateSx(washPlateTones(primary ? TOWER_SLAB : CREAM_PLATE_TONES, wash)),
            width: "100%",
            height: 46,
            borderRadius: "14px",
            fontSize: SIZE.body,
            // The wall hangs below the box; keep it clear of whatever follows.
            marginBottom: `${PLATE_WALL_PX}px`,
        }}
    >
        {children}
    </ButtonBase>
    );
};

export default MatchSpeedPlateButton;
