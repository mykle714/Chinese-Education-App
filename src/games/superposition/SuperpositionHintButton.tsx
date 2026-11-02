import { ButtonBase } from "@mui/material";
import Icon from "../../components/Icon";
import { COLORS } from "../../theme/colors";
import { SIZE, WEIGHT } from "../../theme/scale";
import { HINT_BUTTON_PX } from "./constants";

interface SuperpositionHintButtonProps {
    /** Whole seconds until the next hint; 0 = no cooldown running. */
    secondsLeft: number;
    /** False while a hint cannot be spent, for any reason. */
    ready: boolean;
    /** The button's top edge inside the board (px). */
    topPx: number;
    onHint: () => void;
}

/**
 * The top-right hint control, styled after Word Search's hint button: the glyph's fill and
 * the button's opacity carry the armed state. The width is fixed so the countdown does not
 * resize it. It stops its own press from reaching the board, which would start a drag, but
 * while unarmed it lets a press through to any tile lying here.
 *
 * Layer: game component, presentational. The Stage owns the cooldown and the hinted pair.
 * Referenced by: docs/SUPERPOSITION_GAME.md § Play.
 */
const SuperpositionHintButton: React.FC<SuperpositionHintButtonProps> = ({ secondsLeft, ready, topPx, onHint }) => (
    <ButtonBase
        className={`superposition-hint-button${ready ? " superposition-hint-button--ready" : ""}`}
        aria-label={secondsLeft > 0 ? `Hint available in ${secondsLeft} seconds` : "Show two tiles to stack"}
        disabled={!ready}
        onClick={onHint}
        onPointerDown={(event) => event.stopPropagation()}
        sx={{
            position: "absolute",
            top: topPx,
            right: 12,
            width: 72,
            height: HINT_BUTTON_PX,
            gap: 0.5,
            borderRadius: "10px",
            border: `1px solid ${COLORS.border}`,
            backgroundColor: COLORS.white,
            color: COLORS.onSurface,
            fontSize: SIZE.subtitle,
            fontWeight: WEIGHT.medium,
            fontVariantNumeric: "tabular-nums",
            opacity: ready ? 1 : 0.4,
            pointerEvents: ready ? "auto" : "none",
            transition: "opacity 150ms linear",
        }}
    >
        <Icon className="superposition-hint-button__icon" name="lightbulb" size={16} color={COLORS.onSurface} fill={ready ? 1 : 0} />
        {secondsLeft > 0 ? `${secondsLeft}s` : "Hint"}
    </ButtonBase>
);

export default SuperpositionHintButton;
