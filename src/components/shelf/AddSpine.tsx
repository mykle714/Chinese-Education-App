import { Box } from "@mui/material";
import { styled } from "@mui/material/styles";
import Icon from "../Icon";
import { COLORS } from "../../theme/colors";
import { SPINE_VARIANTS, type SpineVariant } from "./spineGeometry";

/**
 * AddSpine — the "make a new one" affordance at the end of a shelf row
 * (`.sp.add` in the design). A spine-shaped hole rather than a spine: transparent,
 * dashed outline, no shadow, a centred `+`.
 *
 * A separate component rather than a `Spine` variant because it shares only the
 * BOX with a spine, not the anatomy — no body colour, no strap, no shadow, no
 * title, no count, and none of the slots. Folding it in would make every one of
 * those a conditional inside `Spine` for a shape that carries no data.
 *
 * Its height matches whatever the row's spines use, so it sits on the same board
 * rather than floating: pass the row's `variant` (or an explicit `height`).
 *
 * Depended on by: src/features/flashcards/DecksPanelBody.tsx. See
 * docs/SHELF_REDESIGN.md § A3.
 */

export interface AddSpineProps {
    onClick: () => void;
    /** Match the row's spines. Defaults to `base`. */
    variant?: SpineVariant;
    width?: number;
    height?: number;
    /** For screen readers — the row's own label ("New deck"). */
    label: string;
    className?: string;
}

const AddSpineRoot = styled(Box)(() => ({
    position: "relative",
    borderRadius: "11px 11px 4px 4px",
    background: "transparent",
    border: `1px dashed ${COLORS.border}`,
    boxShadow: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    cursor: "pointer",
    transition: "transform 0.12s ease-out",
    "&:active": { transform: "scale(0.96)" },
}));

const AddSpine: React.FC<AddSpineProps> = ({
    onClick,
    variant = "base",
    width,
    height,
    label,
    className,
}) => {
    const spec = SPINE_VARIANTS[variant];
    return (
        <AddSpineRoot
            className={`shelf-add-spine${className ? ` ${className}` : ""}`}
            onClick={onClick}
            role="button"
            aria-label={label}
            sx={{ width: width ?? spec.width, height: height ?? spec.height }}
        >
            <Icon className="shelf-add-spine__plus" name="add" size={22} color={COLORS.textFaint} />
        </AddSpineRoot>
    );
};

export default AddSpine;
