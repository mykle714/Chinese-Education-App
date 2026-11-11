import { ButtonBase } from "@mui/material";
import Icon from "../../components/Icon";
import { COLORS } from "../../theme/colors";
import { LEADING } from "../../theme/scale";
import { OUTLINED_CHIP_HEIGHT_PX, OUTLINED_CHIP_ICON_PX, outlinedChipSx } from "../../components/pageHeaderSizing";

interface SuperpositionHintButtonProps {
    /** Whole seconds until the next hint; 0 = no cooldown running. */
    secondsLeft: number;
    /** False while a hint cannot be spent, for any reason. */
    ready: boolean;
    onHint: () => void;
}

/**
 * The button's floor width, px: wide enough for "Hint", so the countdown ("15s") never
 * shrinks it and the row does not shift as the cooldown runs out. A floor rather than a
 * fixed width, so a wider-than-expected face grows it instead of clipping the label.
 */
const HINT_BUTTON_MIN_WIDTH_PX = 68;

/**
 * The hint control in Leave's row, just left of the audio chip (GameFrame `exitRowTrailing`,
 * docs/FLP_GAME_BREAKS.md § 6). It wears the audio chip's outlined pill (`outlinedChipSx`:
 * height, glyph size, type, ink) so the two read as one pair of header controls. The
 * glyph's fill and the button's opacity carry the armed state, as Word Search's hint button
 * does. It stops its own press from reaching the board (which would start a drag); while
 * unarmed it lets a press through to any tile dragged up under it.
 *
 * Layer: game component, presentational. The Stage owns the cooldown and the hinted pair.
 * Referenced by: docs/SUPERPOSITION_GAME.md § Play.
 */
const SuperpositionHintButton: React.FC<SuperpositionHintButtonProps> = ({ secondsLeft, ready, onHint }) => (
    <ButtonBase
        className={`superposition-hint-button${ready ? " superposition-hint-button--ready" : ""}`}
        aria-label={secondsLeft > 0 ? `Hint available in ${secondsLeft} seconds` : "Show two tiles to stack"}
        disabled={!ready}
        onClick={onHint}
        onPointerDown={(event) => event.stopPropagation()}
        sx={{
            ...outlinedChipSx(COLORS.iconColor),
            boxSizing: "border-box",
            height: OUTLINED_CHIP_HEIGHT_PX,
            minWidth: HINT_BUTTON_MIN_WIDTH_PX,
            gap: "5px",
            lineHeight: LEADING.none,
            color: COLORS.iconColor,
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            opacity: ready ? 1 : 0.4,
            pointerEvents: ready ? "auto" : "none",
            transition: "opacity 150ms linear",
        }}
    >
        <Icon
            className="superposition-hint-button__icon"
            name="lightbulb"
            size={OUTLINED_CHIP_ICON_PX}
            color={COLORS.iconColor}
            fill={ready ? 1 : 0}
        />
        {secondsLeft > 0 ? `${secondsLeft}s` : "Hint"}
    </ButtonBase>
);

export default SuperpositionHintButton;
