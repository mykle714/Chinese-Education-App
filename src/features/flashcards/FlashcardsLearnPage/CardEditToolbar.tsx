import React from "react";
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
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import GridOnIcon from "@mui/icons-material/GridOn";
import OpenWithIcon from "@mui/icons-material/OpenWith";
import ControlCameraIcon from "@mui/icons-material/ControlCamera";
import StyleIcon from "@mui/icons-material/Style";
import BlockIcon from "@mui/icons-material/Block";
import RotateRightIcon from "@mui/icons-material/RotateRight";
import RotateLeftIcon from "@mui/icons-material/RotateLeft";
import RemoveIcon from "@mui/icons-material/Remove";
import AspectRatioIcon from "@mui/icons-material/AspectRatio";
import CheckIcon from "@mui/icons-material/Check";
import { SIZE, WEIGHT } from "../../../theme/scale";
import { COLORS } from "../../../theme/colors";
import { ICON_LAYOUT_MAX_ITEMS, type IconLayoutItem, type TextColorMode } from "../../../types";
import { CARD_COLOR_OPTIONS } from "../../../utils/cardColor";
import { ALIGN_ROTATION, type AlignDirection as AlignDir } from "../../../cardIcons/cardIconLayout";
import CardIconOrderList from "./CardIconOrderList";
import { useToolbarMenus } from "./useToolbarMenus";

// Shared transition timing for the editor's open/close motions (toolbar Slide, adv-rows
// Collapse, and the card push-down). Kept in one place so they animate in lockstep — same
// duration AND easing in BOTH directions. See docs/CARD_ICON_LAYOUT.md.
export const CARD_EDIT_ANIM_MS = 300;
export const CARD_EDIT_ANIM_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

// AlignDirection (the 4 cardinals + 4 diagonals) and its rotation map are defined alongside
// the geometry helpers in cardIconLayout.ts; re-exported here so existing importers (the page)
// keep getting it from the toolbar.
export type { AlignDirection } from "../../../cardIcons/cardIconLayout";

// The portaled-dropdown class selector lives in its own module (so useToolbarMenus can use it
// without a circular import). Re-exported here for callers that import it from this file
// (e.g. FlashcardsLearnPage's outside-tap deselect). See toolbarDropdownSelector.ts.
export { TOOLBAR_DROPDOWN_SELECTOR } from "./toolbarDropdownSelector";

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
 *    order: **delete** (remove the selected icon), **duplicate** (clone the selected icon at
 *    the default spawn spot), **mirror** (horizontal flip of the selected icon), **undo**
 *    (history-stack revert), **redo** (replay an undone step), **lock**, **shift** (a 3×3
 *    step-nudge pad — corners rotate/resize, cardinals translate, center shows "snap is on"),
 *    **card** (labeled "card"; internal key stays `contrast`): a per-card appearance menu —
 *    a **background** swatch row (six card fills, migration 94) plus two text-color rows
 *    (foreign word + English, each a theme/dark/light control), **align** (a 3×3 grid of
 *    direction arrows — center empty, 8 directions incl.
 *    the 45° diagonals — snapping the selected icon's orientation), **snap** (a dropdown of
 *    three independent toggles — move / rotate / resize — that quantize those operations to
 *    discrete increments), **order** (a dropdown listing every icon in paint order with
 *    drag-to-reorder), and finally the `count/12` readout.
 *    Delete / duplicate / mirror / lock / shift / align are disabled when no icon is selected;
 *    duplicate is also disabled at the 12-icon max; undo is disabled with an empty undo stack
 *    and redo with an empty redo stack; the card menu (which styles the card — text colors +
 *    background — not icons) needs no selection.
 *
 * **Reset** (resets to the default icon) is a standalone button in the right cluster,
 * available in both modes (it clears the saved arrangement back to the default icon).
 */
const CardEditToolbar: React.FC<{
    advMode: boolean;
    count: number;
    layout: IconLayoutItem[];
    // Whether ANYTHING is selected (an icon OR a text block) — enables the tools that apply to
    // both (move / resize / rotate via shift, align, lock).
    hasSelection: boolean;
    // What KIND of object is selected. 'text' blocks are intrinsic (always two, never added),
    // so the icon-only tools — delete / duplicate / mirror — are disabled for them. null = none.
    selectionKind: "icon" | "text" | null;
    // Undo/redo state + handlers. The buttons sit between mirror and lock in the advanced
    // menu. See docs/CARD_ICON_LAYOUT.md.
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
    // Toggle the lock of a specific icon (by layout index) from the order list's per-row
    // lock symbol — independent of the current selection.
    onToggleLockAt: (layoutIdx: number) => void;
    // Select the icon at a given layout index (the order list selects on row press).
    onSelectIcon: (i: number) => void;
    // Layout index of the currently selected icon (or null), so the order list can
    // mark its row with the same dashed-outline indicator the canvas uses.
    selectedIndex: number | null;
    // Snap toggles (move = 5%-of-width grid, rotate = 22.5°, resize = 5%-of-width size) and their
    // current on/off state. Turning one on snaps every icon for that property immediately
    // (handled on the page) and keeps future gestures quantized.
    snapMove: boolean;
    snapRotate: boolean;
    snapResize: boolean;
    onToggleSnapMove: () => void;
    onToggleSnapRotate: () => void;
    onToggleSnapResize: () => void;
    // Shift menu — fine step-nudges of the selected icon. Each step honors the matching snap
    // toggle (one snap unit when on, a fine 1px/1° nudge when off — magnitudes computed on
    // the page). move = cardinal translate; rotate = CCW/CW; resize = minus/plus size.
    onNudgeMove: (dir: "up" | "down" | "left" | "right") => void;
    onRotateStep: (ccw: boolean) => void;
    onResizeStep: (increase: boolean) => void;
    // Contrast menu — per-card text-color overrides. Two rows: the foreign word (label =
    // the card's characters) and the English (label = the card's definition), each settable
    // to theme / dark / light. Applies to the card text regardless of basic/advanced mode.
    foreignLabel: string;
    englishLabel: string;
    textForeign: TextColorMode;
    textEnglish: TextColorMode;
    onSetTextForeign: (mode: TextColorMode) => void;
    onSetTextEnglish: (mode: TextColorMode) => void;
    // Card background fill (vet.cardColor, migration 94) — a swatch row in the same "card"
    // dropdown as the text colors. null = the theme default (grey). See docs/CARD_ICON_LAYOUT.md.
    cardColor: string | null;
    onSetCardColor: (color: string | null) => void;
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
    selectionKind,
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
    onToggleLockAt,
    onSelectIcon,
    selectedIndex,
    snapMove,
    snapRotate,
    snapResize,
    onToggleSnapMove,
    onToggleSnapRotate,
    onToggleSnapResize,
    onNudgeMove,
    onRotateStep,
    onResizeStep,
    foreignLabel,
    englishLabel,
    textForeign,
    textEnglish,
    onSetTextForeign,
    onSetTextEnglish,
    cardColor,
    onSetCardColor,
    canReset,
    onReset,
    onSave,
    onCancel,
    saving,
}) => {
        const theme = useTheme();
        const fc = theme.palette.flashcard;
        const atMax = count >= ICON_LAYOUT_MAX_ITEMS;

        // Dropdown open/close state + coordination (5 anchors, sticky-order outside-press
        // handling, mutually-exclusive transient toggling) lives in useToolbarMenus.
        const {
            alignAnchor,
            orderAnchor,
            snapAnchor,
            shiftAnchor,
            shiftFlipUp,
            contrastAnchor,
            setAlignAnchor,
            setOrderAnchor,
            setSnapAnchor,
            setShiftAnchor,
            setContrastAnchor,
            toggleDropdown,
        } = useToolbarMenus();

        // Whether any snap toggle is on — drives the snap button's active (filled) styling.
        const anySnapOn = snapMove || snapRotate || snapResize;

        const smallBtnSx = {
            minWidth: "unset",
            px: 0.5,
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
            // Tighten the gap between the startIcon and the label (MUI defaults to an 8px margin
            // between them); pull them closer so each button hugs its content.
            "& .MuiButton-startIcon": { marginRight: "2px" },
            // The explicit `color` above out-specifies MUI's default `.Mui-disabled` grey, so a
            // disabled button (e.g. redo at the top of the redo stack, undo with an empty stack)
            // would otherwise still look fully active. Re-assert the greyed-out look here so the
            // disabled state reads as uninteractable. (MUI already sets pointer-events:none.)
            "&.Mui-disabled": { color: fc.onSurface, opacity: 0.38 },
        };

        // Shared sizing for every tool button's startIcon (kept in one place so all the
        // advanced-row icons stay visually consistent).
        const iconSx = { fontSize: "16px !important" } as const;

        // The advanced-menu tool buttons, in render order. Each tool is a plain config object
        // consumed by ONE <Button> renderer in the JSX below — so the markup is DRY (size /
        // variant / icon sizing / smallBtnSx live in a single spot) and reordering, adding, or
        // removing a tool is a one-line list edit instead of a block copy.
        //  - `onClick` receives the click event (the dropdown tools read `e.currentTarget` for
        //    their anchor; the plain actions just ignore it).
        //  - `sx` (optional) merges onto smallBtnSx — used by the toggle-styled tools (lock,
        //    snap) for their active-state fill.
        // Each snap operation gets a distinct app accent color, reused EVERYWHERE that
        // operation is highlighted — the snap dropdown's active row, the matching Shift-pad
        // cells, AND the snap button's segmented highlight (below) — so the surfaces read as
        // the same setting at a glance: move/grid = light green, rotate = light blue,
        // resize/size = light orange. Keyed by the snap group.
        const SNAP_GROUP_COLOR: Record<"move" | "rotate" | "resize", string> = {
            move: COLORS.greenAccent,
            rotate: COLORS.blueAccent,
            resize: COLORS.yellowAccent,
        };

        // The snap button's fill is a three-segment highlight that mirrors the snap dropdown's
        // three toggles in order: the LEFT third lights green when MOVE snap is on, the MIDDLE
        // third lights blue when ROTATE is on, the RIGHT third lights orange when RESIZE is on.
        // Each segment shows its accent only while its toggle is active (transparent otherwise),
        // so the button reads as a live miniature of which snaps are engaged — multiple thirds
        // can light at once. Built as a hard-stop linear-gradient (no blending between thirds).
        const seg = (on: boolean, color: string) => (on ? color : "transparent");
        const snapHighlightBg = anySnapOn
            ? `linear-gradient(to right, ` +
              `${seg(snapMove, SNAP_GROUP_COLOR.move)} 0% 33.333%, ` +
              `${seg(snapRotate, SNAP_GROUP_COLOR.rotate)} 33.333% 66.666%, ` +
              `${seg(snapResize, SNAP_GROUP_COLOR.resize)} 66.666% 100%)`
            : undefined;

        const advButtons: {
            key: string;
            className: string;
            icon: React.ReactNode;
            label: string;
            onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
            disabled: boolean;
            sx?: object;
        }[] = [
            {
                key: "delete",
                className: "card-edit-toolbar__delete",
                icon: <DeleteOutlineIcon sx={iconSx} />,
                label: "delete",
                onClick: onDeleteSelected,
                // Icon-only: text blocks are intrinsic and can't be deleted (migration 91).
                disabled: selectionKind !== "icon" || saving,
            },
            {
                key: "mirror",
                className: "card-edit-toolbar__mirror",
                icon: <FlipIcon sx={iconSx} />,
                label: "mirror",
                onClick: onMirror,
                // Icon-only: mirrored text is unreadable, so mirror is disabled for text.
                disabled: selectionKind !== "icon" || saving,
            },
            {
                // The "card" menu — per-card appearance settings: the text-color overrides
                // (foreign word + English) AND the card background fill. Independent of icon
                // selection (it styles the card, not icons), so only disabled while saving.
                // NOTE: the internal key / class / anchor stay "contrast" (the menu machinery,
                // CSS selectors, and useToolbarMenus are keyed on it); only the user-facing
                // label + icon read "card". See docs/CARD_ICON_LAYOUT.md.
                key: "contrast",
                className: "card-edit-toolbar__contrast",
                icon: <StyleIcon sx={iconSx} />,
                label: "card",
                onClick: (e) => toggleDropdown("contrast", e),
                disabled: saving,
            },
            {
                key: "undo",
                className: "card-edit-toolbar__undo",
                icon: <UndoIcon sx={iconSx} />,
                label: "undo",
                onClick: onUndo,
                disabled: !canUndo || saving,
            },
            {
                key: "redo",
                className: "card-edit-toolbar__redo",
                icon: <RedoIcon sx={iconSx} />,
                label: "redo",
                onClick: onRedo,
                disabled: !canRedo || saving,
            },
            {
                key: "duplicate",
                className: "card-edit-toolbar__duplicate",
                icon: <ContentCopyIcon sx={iconSx} />,
                label: "duplicate",
                onClick: onDuplicate,
                // Icon-only: text blocks are a fixed pair, so they can't be duplicated. Needs a
                // selected icon and room under the 12-icon cap.
                disabled: selectionKind !== "icon" || atMax || saving,
            },
            {
                // Lock toggle — freezes the selected icon against translate/resize/rotate
                // gestures (it stays selectable). Label stays "lock" in both states; the active
                // (locked) state shows the filled golden styling + the closed-padlock icon.
                key: "lock",
                className: `card-edit-toolbar__lock${selectedLocked ? " card-edit-toolbar__lock--active" : ""}`,
                icon: selectedLocked ? <LockIcon sx={iconSx} /> : <LockOpenIcon sx={iconSx} />,
                label: "lock",
                onClick: onToggleLock,
                disabled: !hasSelection || saving,
                // Match the golden corner indicator the locked icon shows.
                sx: selectedLocked ? { color: "#E0A82E", backgroundColor: "rgba(224,168,46,0.14)" } : undefined,
            },
            {
                key: "align",
                className: "card-edit-toolbar__align",
                icon: <CropSquareIcon sx={iconSx} />,
                label: "align",
                onClick: (e) => toggleDropdown("align", e),
                disabled: !hasSelection || saving,
            },
            {
                // 3×3 step-nudge pad — corners rotate/resize, cardinals translate, center shows
                // "snap is on" when any snap is active. Disabled with no selection.
                key: "shift",
                className: "card-edit-toolbar__shift",
                icon: <ControlCameraIcon sx={iconSx} />,
                label: "shift",
                onClick: (e) => toggleDropdown("shift", e),
                disabled: !hasSelection || saving,
            },
            {
                // Independent move / rotate / resize quantization toggles. Filled when ANY snap
                // Snap applies to both icons AND the two movable text blocks (always present in
                // advanced mode), so it stays available even on a card with no icons.
                key: "snap",
                className: `card-edit-toolbar__snap${anySnapOn ? " card-edit-toolbar__snap--active" : ""}`,
                icon: <GridOnIcon sx={iconSx} />,
                label: "snap",
                onClick: (e) => toggleDropdown("snap", e),
                disabled: saving,
                // Segmented highlight: left/middle/right thirds light green/blue/orange for
                // move/rotate/resize when each is on (see snapHighlightBg). `background` (not
                // `backgroundColor`) so the gradient takes; pin it on hover too so it doesn't
                // flash to the default hover fill.
                sx: anySnapOn
                    ? { background: snapHighlightBg, "&:hover": { background: snapHighlightBg } }
                    : undefined,
            },
            {
                key: "order",
                className: "card-edit-toolbar__order",
                icon: <LayersIcon sx={iconSx} />,
                label: "order",
                onClick: (e) => toggleDropdown("order", e),
                disabled: count === 0 || saving,
            },
        ];

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
        // operation: move → 5%-of-width grid, rotate → 22.5° steps, resize → 5%-of-width size.
        const snapRows: { key: "move" | "rotate" | "resize"; label: string; icon: React.ReactNode; active: boolean; onToggle: () => void }[] = [
            { key: "move", label: "grid", icon: <OpenWithIcon sx={{ fontSize: 16 }} />, active: snapMove, onToggle: onToggleSnapMove },
            { key: "rotate", label: "rotate", icon: <RotateRightIcon sx={{ fontSize: 16 }} />, active: snapRotate, onToggle: onToggleSnapRotate },
            { key: "resize", label: "size", icon: <AspectRatioIcon sx={{ fontSize: 16 }} />, active: snapResize, onToggle: onToggleSnapResize },
        ];

        // The Shift dropdown is a 3×3 nudge pad (row-major). The four corners rotate (CCW/CW)
        // and resize (−/＋); the four cardinals translate; the center is null (it shows the
        // "snap is on" hint when any snap is active). Each cell declares which snap GROUP it
        // belongs to so the menu can highlight every cell whose snap is currently on
        // (move → cardinals, rotate → CCW/CW corners, resize → −/＋ corners).
        type ShiftGroup = "move" | "rotate" | "resize";
        const shiftCell = (key: string, icon: React.ReactNode, group: ShiftGroup, onClick: () => void) => ({ key, icon, group, onClick });
        const shiftGrid: (ReturnType<typeof shiftCell> | null)[] = [
            shiftCell("rotate-ccw", <RotateLeftIcon sx={{ fontSize: 18 }} />, "rotate", () => onRotateStep(true)),
            shiftCell("up", <ArrowUpwardIcon sx={{ fontSize: 18 }} />, "move", () => onNudgeMove("up")),
            shiftCell("rotate-cw", <RotateRightIcon sx={{ fontSize: 18 }} />, "rotate", () => onRotateStep(false)),
            shiftCell("left", <ArrowBackIcon sx={{ fontSize: 18 }} />, "move", () => onNudgeMove("left")),
            null, // center: the "snap is on" hint
            shiftCell("right", <ArrowForwardIcon sx={{ fontSize: 18 }} />, "move", () => onNudgeMove("right")),
            shiftCell("size-minus", <RemoveIcon sx={{ fontSize: 18 }} />, "resize", () => onResizeStep(false)),
            shiftCell("down", <ArrowDownwardIcon sx={{ fontSize: 18 }} />, "move", () => onNudgeMove("down")),
            shiftCell("size-plus", <AddIcon sx={{ fontSize: 18 }} />, "resize", () => onResizeStep(true)),
        ];
        // Per-group "is this snap on" lookup, for highlighting the matching cells.
        const shiftGroupActive: Record<ShiftGroup, boolean> = { move: snapMove, rotate: snapRotate, resize: snapResize };

        // The Contrast dropdown's two rows — one per text run on the card. Each row's label is
        // the actual card text (so the learner sees what they're recoloring) and a 3-way
        // segmented control (theme / dark / light). 'theme' follows the device/app theme.
        const contrastRows: { key: string; label: string; value: TextColorMode; onSet: (m: TextColorMode) => void }[] = [
            { key: "foreign", label: foreignLabel, value: textForeign, onSet: onSetTextForeign },
            { key: "english", label: englishLabel, value: textEnglish, onSet: onSetTextEnglish },
        ];
        const contrastModes: TextColorMode[] = ["theme", "dark", "light"];

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
                            gap: "3px",
                            px: 1.5,
                            py: 0.75,
                            backgroundColor: fc.toggleInactiveBg,
                            borderBottom: "1px solid rgba(0,0,0,0.08)",
                        }}
                    >
                        {/* Count readout — flows as the FIRST list item, vertically centered. */}
                        <Typography
                            className="card-edit-toolbar__count"
                            sx={{
                                fontSize: SIZE.micro,
                                color: fc.onSurface,
                                opacity: 0.7,
                                alignSelf: "center",
                                px: 0.5,
                                // Reserve enough width for the widest readout ("12/12") and use
                                // tabular figures so the count never changes width as digits roll
                                // over (1→12) — otherwise the whole tool row would shift right.
                                minWidth: "6ch",
                                textAlign: "center",
                                fontVariantNumeric: "tabular-nums",
                            }}
                        >
                            {count}/{ICON_LAYOUT_MAX_ITEMS}
                        </Typography>

                        {/* Tools flow as list items; each hugs its content via smallBtnSx.
                        Rendered from the advButtons config (order = list order); per-tool
                        active-state overrides merge onto smallBtnSx via `btn.sx`. */}
                        {advButtons.map((btn) => (
                            <Button
                                key={btn.key}
                                className={btn.className}
                                size="small"
                                variant="text"
                                startIcon={btn.icon}
                                onClick={btn.onClick}
                                disabled={btn.disabled}
                                sx={btn.sx ? { ...smallBtnSx, ...btn.sx } : smallBtnSx}
                            >
                                {btn.label}
                            </Button>
                        ))}

                        {/* Alignment dropdown: a 3×3 grid of direction cells (center empty = 8
                        directions) that snap the selected icon's orientation, including the four
                        45° diagonals. Unlike snap / Shift / Contrast, picking a direction closes
                        the menu (one-shot action). Portaled (or null when closed), so it takes no
                        slot in the flex list. */}
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
                                            // Active row tints with its operation's accent color
                                            // (green/blue/orange), matching the Shift-pad cells.
                                            backgroundColor: row.active ? SNAP_GROUP_COLOR[row.key] : "transparent",
                                            "&:hover": { backgroundColor: row.active ? SNAP_GROUP_COLOR[row.key] : fc.toggleInactiveBg },
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

                        {/* Shift dropdown: a 3×3 step-nudge pad. Non-modal AND stays open on an
                        inside press (like the snap menu — its cells live inside
                        `.card-edit-toolbar__shift-menu`), so a learner can tap several nudges in
                        one open. Cells whose snap group is on are highlighted; the center shows
                        the two-line "snap is on" hint while any snap is active. Portaled, so it
                        takes no slot in the flex list. */}
                        <Menu
                            className="card-edit-toolbar__shift-menu"
                            anchorEl={shiftAnchor}
                            open={Boolean(shiftAnchor)}
                            onClose={() => setShiftAnchor(null)}
                            // Default (MUI's own top/left, top/left) opens below the button, same
                            // as align/snap. When that would cover the current selection (decided
                            // once at open time — see `computeShiftFlipUp`), flip the paper's
                            // origin to its BOTTOM edge so it opens ABOVE the button instead.
                            {...(shiftFlipUp
                                ? {
                                      anchorOrigin: { vertical: "top", horizontal: "left" },
                                      transformOrigin: { vertical: "bottom", horizontal: "left" },
                                  }
                                : {})}
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
                                className="card-edit-toolbar__shift-grid"
                                sx={{
                                    display: "grid",
                                    gridTemplateColumns: "repeat(3, 36px)",
                                    gridTemplateRows: "repeat(3, 36px)",
                                    gap: 0.5,
                                    p: 0.75,
                                }}
                            >
                                {shiftGrid.map((cell) =>
                                    cell === null ? (
                                        // Center cell — the two-line "snap is on" hint, shown only
                                        // while any snap toggle is active (otherwise empty).
                                        <Box
                                            key="center"
                                            className="card-edit-toolbar__shift-cell--center"
                                            sx={{
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                textAlign: "center",
                                                lineHeight: 1.1,
                                            }}
                                        >
                                            {anySnapOn && (
                                                <Typography
                                                    className="card-edit-toolbar__shift-snap-hint"
                                                    sx={{ fontSize: "9px", color: fc.onSurface, opacity: 0.7, lineHeight: 1.1 }}
                                                >
                                                    snap
                                                    <br />
                                                    is on
                                                </Typography>
                                            )}
                                        </Box>
                                    ) : (
                                        <Box
                                            key={cell.key}
                                            className={`card-edit-toolbar__shift-cell card-edit-toolbar__shift-cell--${cell.key}${shiftGroupActive[cell.group] ? " card-edit-toolbar__shift-cell--snapped" : ""}`}
                                            onClick={cell.onClick}
                                            sx={{
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                cursor: "pointer",
                                                borderRadius: "6px",
                                                border: "1px solid rgba(0,0,0,0.18)",
                                                color: fc.onSurface,
                                                // Highlight cells whose snap group is on, using
                                                // that group's accent color (green/blue/orange)
                                                // so they visibly match the snap dropdown row.
                                                backgroundColor: shiftGroupActive[cell.group] ? SNAP_GROUP_COLOR[cell.group] : "transparent",
                                                "&:hover": { backgroundColor: shiftGroupActive[cell.group] ? SNAP_GROUP_COLOR[cell.group] : fc.toggleInactiveBg },
                                            }}
                                        >
                                            {cell.icon}
                                        </Box>
                                    ),
                                )}
                            </Box>
                        </Menu>

                        {/* Contrast dropdown: two rows (foreign word + English), each a 3-way
                        theme/dark/light segmented control. Non-modal AND stays open on an
                        inside press (cells live inside `.card-edit-toolbar__contrast-menu`), so
                        both rows can be set in one open. Portaled, so it takes no slot in the
                        flex list. */}
                        <Menu
                            className="card-edit-toolbar__contrast-menu"
                            anchorEl={contrastAnchor}
                            open={Boolean(contrastAnchor)}
                            onClose={() => setContrastAnchor(null)}
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
                                className="card-edit-toolbar__contrast-list"
                                sx={{ display: "flex", flexDirection: "column", gap: 1, p: 0.75, minWidth: "200px" }}
                            >
                                {/* Card background fill (migration 94) — swatch chips laid out in
                                TWO rows (5 per row). The FIRST chip is **auto** (value null): the
                                theme default / no override, drawn as the red circle-with-slash
                                "no-fill" glyph rather than a color. The rest are explicit fills
                                (grey / beige / pink / blue / green / yellow / white / black). The
                                active chip shows an accent ring. Tapping one previews it live on
                                the card and stays open (like the text rows below). */}
                                <Box
                                    className="card-edit-toolbar__card-color-row"
                                    sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}
                                >
                                    <Typography
                                        className="card-edit-toolbar__card-color-label"
                                        sx={{ fontSize: SIZE.micro, color: fc.onSurface, opacity: 0.85 }}
                                    >
                                        background
                                    </Typography>
                                    <Box
                                        className="card-edit-toolbar__card-color-swatches"
                                        sx={{
                                            // Fixed 5-column grid → the 9 chips fall into two rows (5 + 4).
                                            display: "grid",
                                            gridTemplateColumns: "repeat(5, 26px)",
                                            gap: 0.75,
                                            justifyContent: "start",
                                        }}
                                    >
                                        {CARD_COLOR_OPTIONS.map((opt) => {
                                            const active = (cardColor ?? null) === opt.value;
                                            return (
                                                <Box
                                                    key={opt.label}
                                                    className={`card-edit-toolbar__card-color-swatch card-edit-toolbar__card-color-swatch--${opt.label}${active ? " card-edit-toolbar__card-color-swatch--active" : ""}`}
                                                    onClick={() => onSetCardColor(opt.value)}
                                                    title={opt.label}
                                                    sx={{
                                                        width: 26,
                                                        height: 26,
                                                        borderRadius: "50%",
                                                        cursor: "pointer",
                                                        display: "flex",
                                                        alignItems: "center",
                                                        justifyContent: "center",
                                                        // Auto chip carries no color fill (the glyph is the affordance);
                                                        // explicit chips paint their swatch color.
                                                        backgroundColor: opt.auto ? "transparent" : opt.swatch,
                                                        // Auto chip has no hairline border (its glyph already reads as a
                                                        // circle); explicit chips get a subtle border so pale fills stay
                                                        // visible. Either way the active chip gets an outer accent ring.
                                                        border: opt.auto
                                                            ? (active ? `2px solid ${fc.onSurface}` : "none")
                                                            : (active ? `2px solid ${fc.onSurface}` : "1px solid rgba(0,0,0,0.18)"),
                                                        boxShadow: active ? `0 0 0 2px ${fc.toggleActiveBg}` : "none",
                                                    }}
                                                >
                                                    {/* Auto = "use the theme color" — the red no-fill (prohibition) glyph. */}
                                                    {opt.auto && (
                                                        <BlockIcon
                                                            className="card-edit-toolbar__card-color-auto-glyph"
                                                            sx={{ fontSize: 24, color: COLORS.redMain }}
                                                        />
                                                    )}
                                                </Box>
                                            );
                                        })}
                                    </Box>
                                </Box>
                                {contrastRows.map((row) => (
                                    <Box
                                        key={row.key}
                                        className={`card-edit-toolbar__contrast-row card-edit-toolbar__contrast-row--${row.key}`}
                                        sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}
                                    >
                                        {/* The card's actual text for this run, ellipsized so a long
                                        word/definition doesn't blow out the menu width. */}
                                        <Typography
                                            className="card-edit-toolbar__contrast-label"
                                            sx={{
                                                fontSize: SIZE.micro,
                                                color: fc.onSurface,
                                                opacity: 0.85,
                                                whiteSpace: "nowrap",
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                                maxWidth: "100%",
                                            }}
                                        >
                                            {row.label || (row.key === "foreign" ? "word" : "english")}
                                        </Typography>
                                        {/* 3-way segmented control: theme | dark | light. */}
                                        <Box
                                            className="card-edit-toolbar__contrast-modes"
                                            sx={{ display: "flex", gap: 0.5 }}
                                        >
                                            {contrastModes.map((mode) => {
                                                const active = row.value === mode;
                                                return (
                                                    <Box
                                                        key={mode}
                                                        className={`card-edit-toolbar__contrast-mode card-edit-toolbar__contrast-mode--${mode}${active ? " card-edit-toolbar__contrast-mode--active" : ""}`}
                                                        onClick={() => row.onSet(mode)}
                                                        sx={{
                                                            flex: 1,
                                                            textAlign: "center",
                                                            px: 1,
                                                            py: 0.5,
                                                            cursor: "pointer",
                                                            borderRadius: "6px",
                                                            border: "1px solid rgba(0,0,0,0.18)",
                                                            fontSize: SIZE.micro,
                                                            textTransform: "lowercase",
                                                            color: fc.onSurface,
                                                            backgroundColor: active ? fc.toggleActiveBg : "transparent",
                                                            "&:hover": { backgroundColor: active ? fc.toggleActiveBg : fc.toggleInactiveBg },
                                                        }}
                                                    >
                                                        {mode}
                                                    </Box>
                                                );
                                            })}
                                        </Box>
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
                            <CardIconOrderList layout={layout} onReorder={onReorder} onReorderStart={onReorderStart} onToggleLockAt={onToggleLockAt} onSelectIcon={onSelectIcon} selectedIndex={selectedIndex} />
                        </Popover>
                    </Box>
                </Collapse>
            </Box>
        );
    };

export default CardEditToolbar;
