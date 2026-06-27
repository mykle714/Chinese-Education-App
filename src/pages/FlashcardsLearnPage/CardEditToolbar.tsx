import React, { useState } from "react";
import {
    Box,
    Button,
    CircularProgress,
    Menu,
    MenuItem,
    Popover,
    Typography,
    useTheme,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import AutorenewIcon from "@mui/icons-material/Autorenew";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import TuneIcon from "@mui/icons-material/Tune";
import UndoIcon from "@mui/icons-material/Undo";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import CropSquareIcon from "@mui/icons-material/CropSquare";
import FlipIcon from "@mui/icons-material/Flip";
import LayersIcon from "@mui/icons-material/Layers";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { SIZE, WEIGHT } from "../../theme/scale";
import { ICON_LAYOUT_MAX_ITEMS, type IconLayoutItem } from "../../types";
import CardIconOrderList from "./CardIconOrderList";

export type AlignDirection = "up" | "right" | "down" | "left";

/**
 * CardEditToolbar — the floating bar shown just below the page header while the custom
 * card icon-layout editor is open (docs/CARD_ICON_LAYOUT.md).
 *
 * Two modes, toggled by the "adv" button (each keeps its own draft on the page, so
 * toggling never destroys the other view):
 *  - **Basic**: the card shows a single icon; the left button is **swap icon** (swap
 *    the one icon for another).
 *  - **Advanced**: the gesture canvas is live (drag / resize / rotate); the left button
 *    is **add icon** (＋) with the `count/12` readout, and a second toolbar row of
 *    per-icon tools drops in below: **undo** (history-stack revert), **delete** (remove
 *    the selected icon), **align** (dropdown of 4 arrows snapping the selected icon's
 *    orientation), **mirror** (horizontal flip of the selected icon), and **order** (a
 *    dropdown listing every icon in paint order with drag-to-reorder). Delete / align /
 *    mirror are disabled when no icon is selected; undo is disabled with an empty stack.
 *
 * **Reset** (resets to the default icon) is a standalone button in the right cluster,
 * available in both modes (it clears the saved arrangement back to the default icon).
 */
const CardEditToolbar: React.FC<{
    advMode: boolean;
    count: number;
    layout: IconLayoutItem[];
    hasSelection: boolean;
    canUndo: boolean;
    onChangeIcon: () => void;
    onAddIcon: () => void;
    onToggleAdv: () => void;
    onUndo: () => void;
    onDeleteSelected: () => void;
    onAlign: (dir: AlignDirection) => void;
    onMirror: () => void;
    onReorder: (next: IconLayoutItem[]) => void;
    onReorderStart: () => void;
    canReset: boolean;
    onReset: () => void;
    onSave: () => void;
    onCancel: () => void;
    saving: boolean;
}> = ({
    advMode,
    count,
    layout,
    hasSelection,
    canUndo,
    onChangeIcon,
    onAddIcon,
    onToggleAdv,
    onUndo,
    onDeleteSelected,
    onAlign,
    onMirror,
    onReorder,
    onReorderStart,
    canReset,
    onReset,
    onSave,
    onCancel,
    saving,
}) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    const atMax = count >= ICON_LAYOUT_MAX_ITEMS;

    // Anchors for the two advanced-row dropdowns (alignment menu + order popover).
    const [alignAnchor, setAlignAnchor] = useState<null | HTMLElement>(null);
    const [orderAnchor, setOrderAnchor] = useState<null | HTMLElement>(null);

    const smallBtnSx = {
        minWidth: "unset",
        px: 1,
        py: 0.25,
        height: "30px",
        fontSize: SIZE.micro,
        textTransform: "lowercase" as const,
        borderRadius: "6px",
        color: fc.onSurface,
    };

    const alignOptions: { dir: AlignDirection; label: string; icon: React.ReactNode }[] = [
        { dir: "up", label: "Up", icon: <ArrowUpwardIcon fontSize="small" /> },
        { dir: "right", label: "Right", icon: <ArrowForwardIcon fontSize="small" /> },
        { dir: "down", label: "Down", icon: <ArrowDownwardIcon fontSize="small" /> },
        { dir: "left", label: "Left", icon: <ArrowBackIcon fontSize="small" /> },
    ];

    return (
        <Box className="card-edit-toolbar">
            {/* Primary toolbar row. */}
            <Box
                className="card-edit-toolbar__row"
                sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    px: 1.5,
                    py: 0.75,
                    backgroundColor: fc.toggleInactiveBg,
                    borderBottom: "1px solid rgba(0,0,0,0.08)",
                }}
            >
                {/* Contextual left button — ONE persistent <Button> in both modes so it
                    never remounts/jumps on the adv toggle; only its label, icon, and action
                    swap (advanced = "add icon" + AddIcon + append; basic = "swap icon" +
                    AutorenewIcon + replace). A fixed width keeps the button itself from
                    resizing as the label changes. The adv-only count readout sits to its
                    right; the flex spacer below absorbs its width so the button stays put. */}
                <Button
                    className={advMode ? "card-edit-toolbar__add" : "card-edit-toolbar__swap-icon"}
                    size="small"
                    variant="text"
                    startIcon={
                        advMode
                            ? <AddIcon sx={{ fontSize: "16px !important" }} />
                            : <AutorenewIcon sx={{ fontSize: "16px !important" }} />
                    }
                    onClick={advMode ? onAddIcon : onChangeIcon}
                    disabled={(advMode && atMax) || saving}
                    sx={{ ...smallBtnSx, minWidth: "60px", justifyContent: "flex-start" }}
                >
                    {advMode ? "add icon" : "swap icon"}
                </Button>
                {/* Count readout slot is ALWAYS rendered with a fixed width so the space is
                    pre-provisioned — the text only fills in during adv mode, but the slot
                    reserves room either way so the row never reflows on the toggle. Width
                    is sized to fit the widest value it can show ("12/12"). */}
                <Typography
                    className="card-edit-toolbar__count"
                    sx={{ fontSize: SIZE.micro, color: fc.onSurface, opacity: 0.7, minWidth: "28px" }}
                >
                    {advMode ? `${count}/${ICON_LAYOUT_MAX_ITEMS}` : ""}
                </Typography>

                {/* Push the adv toggle + Save/Cancel to the right. */}
                <Box sx={{ flex: 1 }} />

                {/* Advanced-mode toggle. Filled when active. */}
                <Button
                    className="card-edit-toolbar__adv"
                    size="small"
                    variant="text"
                    startIcon={<TuneIcon sx={{ fontSize: "16px !important" }} />}
                    onClick={onToggleAdv}
                    disabled={saving}
                    sx={{
                        ...smallBtnSx,
                        backgroundColor: advMode ? fc.toggleActiveBg : "transparent",
                        "&:hover": { backgroundColor: advMode ? fc.toggleActiveBg : fc.toggleInactiveBg },
                    }}
                >
                    adv
                </Button>

                {/* Reset to default — standalone, available in both modes. */}
                <Button
                    className="card-edit-toolbar__reset"
                    size="small"
                    variant="text"
                    startIcon={<RestartAltIcon sx={{ fontSize: "16px !important" }} />}
                    onClick={onReset}
                    disabled={!canReset || saving}
                    sx={smallBtnSx}
                >
                    reset
                </Button>

                <Button
                    className="card-edit-toolbar__cancel"
                    size="small"
                    variant="text"
                    onClick={onCancel}
                    disabled={saving}
                    sx={smallBtnSx}
                >
                    cancel
                </Button>
                <Button
                    className="card-edit-toolbar__save"
                    size="small"
                    variant="contained"
                    onClick={onSave}
                    disabled={saving}
                    sx={{
                        ...smallBtnSx,
                        fontWeight: WEIGHT.semibold,
                        backgroundColor: fc.toggleActiveBg,
                        "&:hover": { backgroundColor: fc.toggleActiveBg },
                    }}
                >
                    {saving ? (
                        <CircularProgress
                            size={16}
                            thickness={5}
                            sx={{ color: fc.onSurface }}
                            className="card-edit-toolbar__save-spinner"
                        />
                    ) : (
                        "save"
                    )}
                </Button>
            </Box>

            {/* Secondary (advanced) toolbar row — per-icon tools, dropped in below while
                advanced mode is on. */}
            {advMode && (
                <Box
                    className="card-edit-toolbar__adv-row"
                    sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 0.5,
                        px: 1.5,
                        py: 0.5,
                        backgroundColor: fc.toggleInactiveBg,
                        borderBottom: "1px solid rgba(0,0,0,0.08)",
                    }}
                >
                    <Button
                        className="card-edit-toolbar__undo"
                        size="small"
                        variant="text"
                        startIcon={<UndoIcon sx={{ fontSize: "16px !important" }} />}
                        onClick={onUndo}
                        disabled={!canUndo || saving}
                        sx={smallBtnSx}
                    >
                        undo
                    </Button>

                    <Button
                        className="card-edit-toolbar__delete"
                        size="small"
                        variant="text"
                        startIcon={<DeleteOutlineIcon sx={{ fontSize: "16px !important" }} />}
                        onClick={onDeleteSelected}
                        disabled={!hasSelection || saving}
                        sx={smallBtnSx}
                    >
                        delete
                    </Button>

                    <Button
                        className="card-edit-toolbar__align"
                        size="small"
                        variant="text"
                        startIcon={<CropSquareIcon sx={{ fontSize: "16px !important" }} />}
                        onClick={(e) => setAlignAnchor(e.currentTarget)}
                        disabled={!hasSelection || saving}
                        sx={smallBtnSx}
                    >
                        align
                    </Button>

                    <Button
                        className="card-edit-toolbar__mirror"
                        size="small"
                        variant="text"
                        startIcon={<FlipIcon sx={{ fontSize: "16px !important" }} />}
                        onClick={onMirror}
                        disabled={!hasSelection || saving}
                        sx={smallBtnSx}
                    >
                        mirror
                    </Button>

                    <Button
                        className="card-edit-toolbar__order"
                        size="small"
                        variant="text"
                        startIcon={<LayersIcon sx={{ fontSize: "16px !important" }} />}
                        onClick={(e) => setOrderAnchor(e.currentTarget)}
                        disabled={count === 0 || saving}
                        sx={smallBtnSx}
                    >
                        order
                    </Button>

                    {/* Alignment dropdown: 4 arrows that snap the selected icon's orientation. */}
                    <Menu
                        className="card-edit-toolbar__align-menu"
                        anchorEl={alignAnchor}
                        open={Boolean(alignAnchor)}
                        onClose={() => setAlignAnchor(null)}
                    >
                        {alignOptions.map((opt) => (
                            <MenuItem
                                key={opt.dir}
                                onClick={() => {
                                    onAlign(opt.dir);
                                    setAlignAnchor(null);
                                }}
                                sx={{ gap: 1, fontSize: SIZE.caption }}
                            >
                                {opt.icon}
                                {opt.label}
                            </MenuItem>
                        ))}
                    </Menu>

                    {/* Render-order dropdown: drag-to-reorder list of all icons. */}
                    <Popover
                        className="card-edit-toolbar__order-popover"
                        anchorEl={orderAnchor}
                        open={Boolean(orderAnchor)}
                        onClose={() => setOrderAnchor(null)}
                        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
                    >
                        <CardIconOrderList layout={layout} onReorder={onReorder} onReorderStart={onReorderStart} />
                    </Popover>
                </Box>
            )}
        </Box>
    );
};

export default CardEditToolbar;
