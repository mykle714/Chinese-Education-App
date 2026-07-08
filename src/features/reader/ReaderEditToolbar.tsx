import { Box, Button, CircularProgress } from "@mui/material";
import UndoIcon from "@mui/icons-material/Undo";
import RedoIcon from "@mui/icons-material/Redo";
import { SIZE, WEIGHT } from "../../theme/scale";
import { COLORS } from "../../theme/colors";

// READER EDIT TOOLBAR — drops in below the document header while the Edit
// toggle is on (docs/LEAF_NODE_PAGES.md § Reader), modeled on the fie
// (flashcard icon editor) toolbar's row of small text buttons
// (CardEditToolbar.tsx): same compact button sizing/spacing, undo/redo on the
// left, cancel/save on the right. No advanced sub-menu here — content editing
// only needs undo/redo + cancel/save.
const ReaderEditToolbar: React.FC<{
    canUndo: boolean;
    canRedo: boolean;
    onUndo: () => void;
    onRedo: () => void;
    onCancel: () => void;
    onSave: () => void;
    saving: boolean;
}> = ({ canUndo, canRedo, onUndo, onRedo, onCancel, onSave, saving }) => {
    const smallBtnSx = {
        minWidth: "unset",
        px: 0.5,
        py: 0.25,
        height: "30px",
        fontSize: SIZE.micro,
        textTransform: "lowercase" as const,
        borderRadius: "6px",
        color: COLORS.onSurface,
        // See CardEditToolbar.tsx: opts out of the ~300ms double-tap-zoom delay so
        // rapid undo/redo taps register immediately on touch devices.
        touchAction: "manipulation",
        "& .MuiButton-startIcon": { marginRight: "2px" },
        "&.Mui-disabled": { color: COLORS.onSurface, opacity: 0.38 },
    };
    const iconSx = { fontSize: "16px !important" } as const;

    return (
        <Box
            className="reader-edit-toolbar"
            sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                px: 1.5,
                py: 0.75,
                backgroundColor: COLORS.header,
                borderBottom: `1px solid ${COLORS.rowBorder}`,
            }}
        >
            <Button
                className="reader-edit-toolbar__undo"
                size="small"
                variant="text"
                startIcon={<UndoIcon sx={iconSx} />}
                onClick={onUndo}
                disabled={!canUndo || saving}
                sx={smallBtnSx}
            >
                undo
            </Button>
            <Button
                className="reader-edit-toolbar__redo"
                size="small"
                variant="text"
                startIcon={<RedoIcon sx={iconSx} />}
                onClick={onRedo}
                disabled={!canRedo || saving}
                sx={smallBtnSx}
            >
                redo
            </Button>

            <Box sx={{ flex: 1 }} />

            <Button
                className="reader-edit-toolbar__cancel"
                size="small"
                variant="text"
                onClick={onCancel}
                disabled={saving}
                sx={smallBtnSx}
            >
                cancel
            </Button>
            <Button
                className="reader-edit-toolbar__save"
                size="small"
                variant="contained"
                onClick={onSave}
                disabled={saving}
                sx={{
                    ...smallBtnSx,
                    fontWeight: WEIGHT.semibold,
                    backgroundColor: COLORS.blueMain,
                    color: "#fff",
                    "&:hover": { backgroundColor: COLORS.blueMain },
                    "&.Mui-disabled": { color: "#fff", opacity: 0.5 },
                }}
            >
                {saving ? (
                    <CircularProgress size={16} thickness={5} sx={{ color: "#fff" }} className="reader-edit-toolbar__save-spinner" />
                ) : (
                    "save"
                )}
            </Button>
        </Box>
    );
};

export default ReaderEditToolbar;
