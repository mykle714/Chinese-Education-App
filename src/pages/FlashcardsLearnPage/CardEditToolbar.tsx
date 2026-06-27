import React, { useEffect, useState } from "react";
import {
    Box,
    Button,
    CircularProgress,
    Collapse,
    Menu,
    Popover,
    Typography,
    useTheme,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import AutorenewIcon from "@mui/icons-material/Autorenew";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import TuneIcon from "@mui/icons-material/Tune";
import UndoIcon from "@mui/icons-material/Undo";
import RedoIcon from "@mui/icons-material/Redo";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CropSquareIcon from "@mui/icons-material/CropSquare";
import FlipIcon from "@mui/icons-material/Flip";
import LockIcon from "@mui/icons-material/Lock";
import LockOpenIcon from "@mui/icons-material/LockOpen";
import LayersIcon from "@mui/icons-material/Layers";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import GridOnIcon from "@mui/icons-material/GridOn";
import OpenWithIcon from "@mui/icons-material/OpenWith";
import RotateRightIcon from "@mui/icons-material/RotateRight";
import AspectRatioIcon from "@mui/icons-material/AspectRatio";
import CheckIcon from "@mui/icons-material/Check";
import { SIZE, WEIGHT } from "../../theme/scale";
import { ICON_LAYOUT_MAX_ITEMS, type IconLayoutItem } from "../../types";
import { ALIGN_ROTATION, type AlignDirection as AlignDir } from "./cardIconLayout";
import CardIconOrderList from "./CardIconOrderList";

// Shared transition timing for the editor's open/close motions (toolbar Slide, adv-rows
// Collapse, and the card push-down). Kept in one place so they animate in lockstep — same
// duration AND easing in BOTH directions. See docs/CARD_ICON_LAYOUT.md.
export const CARD_EDIT_ANIM_MS = 300;
export const CARD_EDIT_ANIM_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

// AlignDirection (the 4 cardinals + 4 diagonals) and its rotation map are defined alongside
// the geometry helpers in cardIconLayout.ts; re-exported here so existing importers (the page)
// keep getting it from the toolbar.
export type { AlignDirection } from "./cardIconLayout";

/**
 * CardEditToolbar — the floating bar shown just below the page header while the custom
 * card icon-layout editor is open (docs/CARD_ICON_LAYOUT.md).
 *
 * Two modes, toggled by the "adv" button (each keeps its own draft on the page, so
 * toggling never destroys the other view):
 *  - **Basic**: the card shows a single icon; the left button is **swap icon** (swap
 *    the one icon for another). This row is otherwise STATIC — the only thing that
 *    changes between modes is the left button's add-icon / swap-icon label + action.
 *  - **Advanced**: the gesture canvas is live (drag / resize / rotate); the left button
 *    is **add icon** (＋), and a **wrapping flex list** of per-icon tools drops in below
 *    (items hug their content and collect onto the next line when a row overflows), in this
 *    order: the `count/12` readout, then **delete** (remove the selected icon), **duplicate**
 *    (clone the selected icon at the default spawn spot), **undo** (history-stack revert),
 *    **redo** (replay an undone step), **mirror** (horizontal flip of the selected icon),
 *    **lock**, **align** (a 3×3 grid of direction arrows — center empty, 8 directions incl.
 *    the 45° diagonals — snapping the selected icon's orientation), **snap** (a dropdown of
 *    three independent toggles — move / rotate / resize — that quantize those operations to
 *    discrete increments), and
 *    **order** (a dropdown listing every icon in paint order with drag-to-reorder).
 *    Delete / duplicate / align / mirror / lock are disabled when no icon is selected;
 *    duplicate is also disabled at the 12-icon max; undo is disabled with an empty undo
 *    stack and redo with an empty redo stack.
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
    canRedo: boolean;
    onChangeIcon: () => void;
    onAddIcon: () => void;
    onToggleAdv: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onDeleteSelected: () => void;
    onDuplicate: () => void;
    onAlign: (dir: AlignDir) => void;
    onMirror: () => void;
    // Toggle the selected icon's lock (freezes it against translate/resize/rotate gestures).
    onToggleLock: () => void;
    // Whether the currently selected icon is locked (drives the lock button's active styling).
    selectedLocked: boolean;
    onReorder: (next: IconLayoutItem[]) => void;
    onReorderStart: () => void;
    // Select the icon at a given layout index (the order list selects on row press).
    onSelectIcon: (i: number) => void;
    // Snap toggles (move = grid, rotate = 11.25°, resize = 5%-of-width size) and their
    // current on/off state. Turning one on snaps every icon for that property immediately
    // (handled on the page) and keeps future gestures quantized.
    snapMove: boolean;
    snapRotate: boolean;
    snapResize: boolean;
    onToggleSnapMove: () => void;
    onToggleSnapRotate: () => void;
    onToggleSnapResize: () => void;
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
    canRedo,
    onChangeIcon,
    onAddIcon,
    onToggleAdv,
    onUndo,
    onRedo,
    onDeleteSelected,
    onDuplicate,
    onAlign,
    onMirror,
    onToggleLock,
    selectedLocked,
    onReorder,
    onReorderStart,
    onSelectIcon,
    snapMove,
    snapRotate,
    snapResize,
    onToggleSnapMove,
    onToggleSnapRotate,
    onToggleSnapResize,
    canReset,
    onReset,
    onSave,
    onCancel,
    saving,
}) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    const atMax = count >= ICON_LAYOUT_MAX_ITEMS;

    // Anchors for the three advanced-row dropdowns (alignment menu, order popover, snap menu).
    const [alignAnchor, setAlignAnchor] = useState<null | HTMLElement>(null);
    const [orderAnchor, setOrderAnchor] = useState<null | HTMLElement>(null);
    const [snapAnchor, setSnapAnchor] = useState<null | HTMLElement>(null);

    // Whether any snap toggle is on — drives the snap button's active (filled) styling.
    const anySnapOn = snapMove || snapRotate || snapResize;

    // The align/order dropdowns are rendered NON-MODAL (root `pointerEvents: none`,
    // paper `auto` — see their slotProps) so a press outside them is NOT swallowed by a
    // modal backdrop and falls straight through to the canvas/toolbar. That means MUI's
    // own backdrop-click `onClose` never fires, so we close them ourselves here: a single
    // capture-phase pointerdown anywhere outside the open dropdown closes it AND still
    // reaches the underlying target, so that one press both dismisses the menu and
    // performs its action (drag an icon, hit another tool, etc.).
    useEffect(() => {
        if (!alignAnchor && !orderAnchor && !snapAnchor) return;
        const onDocPointerDown = (e: PointerEvent) => {
            const t = e.target as Element | null;
            // Presses inside an open dropdown stay (reorder drag, align option, snap toggle, etc.).
            if (t?.closest(".card-edit-toolbar__align-menu, .card-edit-toolbar__order-popover, .card-edit-toolbar__snap-menu")) return;
            setAlignAnchor(null);
            setOrderAnchor(null);
            setSnapAnchor(null);
        };
        document.addEventListener("pointerdown", onDocPointerDown, true);
        return () => document.removeEventListener("pointerdown", onDocPointerDown, true);
    }, [alignAnchor, orderAnchor, snapAnchor]);

    const smallBtnSx = {
        minWidth: "unset",
        px: 1,
        py: 0.25,
        height: "30px",
        fontSize: SIZE.micro,
        textTransform: "lowercase" as const,
        borderRadius: "6px",
        color: fc.onSurface,
        // Without this, the buttons inherit `touch-action: auto`, so on a touchscreen the
        // browser holds each tap ~300ms to disambiguate a double-tap-to-zoom — which makes
        // rapid undo/redo taps feel like they must wait for the previous one to "finish"
        // before registering. `manipulation` opts out of double-tap zoom so taps fire
        // immediately. (Click handling itself was never blocked — this is the tap latency.)
        touchAction: "manipulation",
        // The explicit `color` above out-specifies MUI's default `.Mui-disabled` grey, so a
        // disabled button (e.g. redo at the top of the redo stack, undo with an empty stack)
        // would otherwise still look fully active. Re-assert the greyed-out look here so the
        // disabled state reads as uninteractable. (MUI already sets pointer-events:none.)
        "&.Mui-disabled": { color: fc.onSurface, opacity: 0.38 },
    };

    // The align dropdown renders as a 3×3 grid of direction cells with the CENTER cell empty
    // (8 directions total). Row-major order: top row, middle row (center hole), bottom row.
    // Each cell points an upward arrow toward its direction by rotating it `ALIGN_ROTATION`
    // degrees — the same angle the align action snaps the icon to, so arrow ⇔ result match.
    const alignGrid: (AlignDir | null)[] = [
        "up-left", "up", "up-right",
        "left", null, "right",
        "down-left", "down", "down-right",
    ];

    // The snap dropdown's three toggle rows. Each enables a discrete increment for its
    // operation: move → 5%-of-width grid, rotate → 11.25° steps, resize → 5%-of-width size.
    const snapRows: { key: string; label: string; icon: React.ReactNode; active: boolean; onToggle: () => void }[] = [
        { key: "move", label: "move", icon: <OpenWithIcon sx={{ fontSize: 16 }} />, active: snapMove, onToggle: onToggleSnapMove },
        { key: "rotate", label: "rotate", icon: <RotateRightIcon sx={{ fontSize: 16 }} />, active: snapRotate, onToggle: onToggleSnapRotate },
        { key: "resize", label: "resize", icon: <AspectRatioIcon sx={{ fontSize: 16 }} />, active: snapResize, onToggle: onToggleSnapResize },
    ];

    return (
        // Enter/exit slide (drop-in from behind the header, slide back up on close) is
        // owned by the <Slide> wrapper in FlashcardsLearnPage so it animates in BOTH
        // directions; this root is just the static container.
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
                    AutorenewIcon + replace). This is the ONLY thing that changes on this
                    row between modes — the count readout has moved to the advanced row so
                    the basic toolbar row is otherwise static. A fixed width keeps the button
                    itself from resizing as the label changes. */}
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
                    sx={{ ...smallBtnSx, minWidth: "60px", justifyContent: "flex-start", whiteSpace: "nowrap" }}
                >
                    {advMode ? "add icon" : "swap icon"}
                </Button>

                {/* Push the adv toggle + Save/Cancel to the right. */}
                <Box sx={{ flex: 1 }} />

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

            {/* Advanced toolbar — ALL per-icon tools merged into ONE menu, laid out as a
                wrapping flex LIST (the count readout, then delete, duplicate, undo, redo,
                mirror, lock, align, order). Items hug their content and collect onto the next
                line when a row overflows — no fixed columns. Drops in below the static basic
                row while advanced mode is on. Replaces the earlier pair of separate flex rows. */}
            {/* Reveal / collapse the menu via MUI <Collapse> (height transition) so it
                animates in BOTH directions — drop down on adv-on, collapse up on adv-off —
                at the same timing as the toolbar Slide and the card push-down. unmountOnExit
                keeps it out of the DOM in basic mode. The align/order dropdowns are portaled,
                so Collapse's height clipping doesn't affect them. */}
            <Collapse
                in={advMode}
                timeout={CARD_EDIT_ANIM_MS}
                easing={CARD_EDIT_ANIM_EASING}
                unmountOnExit
            >
                <Box
                    className="card-edit-toolbar__adv-menu"
                    sx={{
                        // A wrapping flex LIST (not a grid): each tool hugs its own content
                        // and items flow left-to-right, collecting onto the next line when the
                        // row overflows. No fixed columns, so the buttons aren't padded out to
                        // a uniform table width.
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: 0.5,
                        px: 1.5,
                        py: 0.75,
                        backgroundColor: fc.toggleInactiveBg,
                        borderBottom: "1px solid rgba(0,0,0,0.08)",
                    }}
                >
                    {/* Count readout — flows as the FIRST list item, vertically centered. */}
                    <Typography
                        className="card-edit-toolbar__count"
                        sx={{ fontSize: SIZE.micro, color: fc.onSurface, opacity: 0.7, alignSelf: "center", px: 0.5 }}
                    >
                        {count}/{ICON_LAYOUT_MAX_ITEMS}
                    </Typography>

                    {/* Tools flow as list items; each hugs its content via smallBtnSx. */}
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
                        className="card-edit-toolbar__duplicate"
                        size="small"
                        variant="text"
                        startIcon={<ContentCopyIcon sx={{ fontSize: "16px !important" }} />}
                        onClick={onDuplicate}
                        // Needs a selection to clone, and room under the 12-icon cap.
                        disabled={!hasSelection || atMax || saving}
                        sx={smallBtnSx}
                    >
                        duplicate
                    </Button>

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
                        className="card-edit-toolbar__redo"
                        size="small"
                        variant="text"
                        startIcon={<RedoIcon sx={{ fontSize: "16px !important" }} />}
                        onClick={onRedo}
                        disabled={!canRedo || saving}
                        sx={smallBtnSx}
                    >
                        redo
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

                    {/* Lock toggle — freezes the selected icon against translate/resize/
                        rotate gestures (it stays selectable). Label stays "lock" in both
                        states; the active (locked) state is shown by the filled golden
                        styling and the closed-padlock icon. */}
                    <Button
                        className={`card-edit-toolbar__lock${selectedLocked ? " card-edit-toolbar__lock--active" : ""}`}
                        size="small"
                        variant="text"
                        startIcon={
                            selectedLocked
                                ? <LockIcon sx={{ fontSize: "16px !important" }} />
                                : <LockOpenIcon sx={{ fontSize: "16px !important" }} />
                        }
                        onClick={onToggleLock}
                        disabled={!hasSelection || saving}
                        sx={{
                            ...smallBtnSx,
                            // Match the golden corner indicator the locked icon shows.
                            ...(selectedLocked
                                ? { color: "#E0A82E", backgroundColor: "rgba(224,168,46,0.14)" }
                                : {}),
                        }}
                    >
                        lock
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

                    {/* Snap dropdown — independent move / rotate / resize quantization
                        toggles. Filled when ANY snap is on. Disabled with no icons to snap. */}
                    <Button
                        className={`card-edit-toolbar__snap${anySnapOn ? " card-edit-toolbar__snap--active" : ""}`}
                        size="small"
                        variant="text"
                        startIcon={<GridOnIcon sx={{ fontSize: "16px !important" }} />}
                        onClick={(e) => setSnapAnchor(e.currentTarget)}
                        disabled={count === 0 || saving}
                        sx={{
                            ...smallBtnSx,
                            ...(anySnapOn
                                ? {
                                      backgroundColor: fc.toggleActiveBg,
                                      "&:hover": { backgroundColor: fc.toggleActiveBg },
                                  }
                                : {}),
                        }}
                    >
                        snap
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

                    {/* Alignment dropdown: a 3×3 grid of direction cells (center empty = 8
                        directions) that snap the selected icon's orientation, including the four
                        45° diagonals. Portaled (or null when closed), so it takes no slot in the
                        flex list. */}
                    <Menu
                        className="card-edit-toolbar__align-menu"
                        anchorEl={alignAnchor}
                        open={Boolean(alignAnchor)}
                        onClose={() => setAlignAnchor(null)}
                        // Non-modal: let presses outside the menu fall through to the
                        // canvas/toolbar (we close it from a document pointerdown above).
                        hideBackdrop
                        disableEnforceFocus
                        disableAutoFocus
                        slotProps={{
                            root: { sx: { pointerEvents: "none" } },
                            paper: { sx: { pointerEvents: "auto" } },
                        }}
                        // MUI's MenuList padding would offset the grid; strip it so the grid
                        // sits flush inside the paper.
                        MenuListProps={{ sx: { py: 0 } }}
                    >
                        <Box
                            className="card-edit-toolbar__align-grid"
                            sx={{
                                display: "grid",
                                gridTemplateColumns: "repeat(3, 36px)",
                                gridTemplateRows: "repeat(3, 36px)",
                                gap: 0.5,
                                p: 0.75,
                            }}
                        >
                            {alignGrid.map((dir) =>
                                dir === null ? (
                                    // Empty center cell — no direction lives here.
                                    <Box key="center" className="card-edit-toolbar__align-cell--center" />
                                ) : (
                                    <Box
                                        key={dir}
                                        className={`card-edit-toolbar__align-cell card-edit-toolbar__align-cell--${dir}`}
                                        onClick={() => {
                                            onAlign(dir);
                                            setAlignAnchor(null);
                                        }}
                                        sx={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            cursor: "pointer",
                                            borderRadius: "6px",
                                            border: "1px solid rgba(0,0,0,0.18)",
                                            color: fc.onSurface,
                                            "&:hover": { backgroundColor: fc.toggleInactiveBg },
                                        }}
                                    >
                                        {/* One upward arrow spun toward the cell's direction. */}
                                        <ArrowUpwardIcon
                                            fontSize="small"
                                            sx={{ transform: `rotate(${ALIGN_ROTATION[dir]}deg)` }}
                                        />
                                    </Box>
                                ),
                            )}
                        </Box>
                    </Menu>

                    {/* Snap dropdown: a vertical list of three independent toggle rows
                        (move / rotate / resize). Non-modal like align/order — pressing a row
                        toggles it WITHOUT closing the menu (the row is inside
                        `.card-edit-toolbar__snap-menu`, guarded by the document pointerdown
                        handler), so several can be toggled in one open. Portaled, so it takes
                        no slot in the flex list. */}
                    <Menu
                        className="card-edit-toolbar__snap-menu"
                        anchorEl={snapAnchor}
                        open={Boolean(snapAnchor)}
                        onClose={() => setSnapAnchor(null)}
                        hideBackdrop
                        disableEnforceFocus
                        disableAutoFocus
                        slotProps={{
                            root: { sx: { pointerEvents: "none" } },
                            paper: { sx: { pointerEvents: "auto" } },
                        }}
                        MenuListProps={{ sx: { py: 0 } }}
                    >
                        <Box
                            className="card-edit-toolbar__snap-list"
                            sx={{ display: "flex", flexDirection: "column", gap: 0.5, p: 0.75, minWidth: "132px" }}
                        >
                            {snapRows.map((row) => (
                                <Box
                                    key={row.key}
                                    className={`card-edit-toolbar__snap-row card-edit-toolbar__snap-row--${row.key}${row.active ? " card-edit-toolbar__snap-row--active" : ""}`}
                                    onClick={row.onToggle}
                                    sx={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 1,
                                        px: 1,
                                        py: 0.5,
                                        cursor: "pointer",
                                        borderRadius: "6px",
                                        color: fc.onSurface,
                                        backgroundColor: row.active ? fc.toggleActiveBg : "transparent",
                                        "&:hover": { backgroundColor: row.active ? fc.toggleActiveBg : fc.toggleInactiveBg },
                                    }}
                                >
                                    {row.icon}
                                    <Typography sx={{ fontSize: SIZE.micro, textTransform: "lowercase" }}>
                                        {row.label}
                                    </Typography>
                                    {/* Push the check to the right; shown only when the toggle is on. */}
                                    <Box sx={{ flex: 1 }} />
                                    <CheckIcon sx={{ fontSize: 14, opacity: row.active ? 1 : 0 }} />
                                </Box>
                            ))}
                        </Box>
                    </Menu>

                    {/* Render-order dropdown: drag-to-reorder list of all icons.
                        Portaled (or null when closed), so it takes no slot in the flex list. */}
                    <Popover
                        className="card-edit-toolbar__order-popover"
                        anchorEl={orderAnchor}
                        open={Boolean(orderAnchor)}
                        onClose={() => setOrderAnchor(null)}
                        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
                        // Non-modal: see the align Menu — presses outside fall through and
                        // we close it ourselves from the document pointerdown listener.
                        hideBackdrop
                        disableEnforceFocus
                        disableAutoFocus
                        slotProps={{
                            root: { sx: { pointerEvents: "none" } },
                            paper: { sx: { pointerEvents: "auto" } },
                        }}
                    >
                        <CardIconOrderList layout={layout} onReorder={onReorder} onReorderStart={onReorderStart} onSelectIcon={onSelectIcon} />
                    </Popover>
                </Box>
            </Collapse>
        </Box>
    );
};

export default CardEditToolbar;
