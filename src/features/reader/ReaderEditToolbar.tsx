import { Box, Button, CircularProgress, IconButton } from "@mui/material";
import Icon from "../../components/Icon";
import { COLORS } from "../../theme/colors";
import { readerPillButtonSx } from "../../reading/readerStyles";
import { iconImageUrl } from "../../cardIcons/cardIconLayout";
import type { Tier2Look } from "../../timeOfDay/tier2Look";

// READER EDIT TOOLBAR — drops in below the document header while the Edit
// toggle is on (docs/LEAF_NODE_PAGES.md § Reader). Undo/redo and the document-icon
// button on the left, cancel/save on the right.
//
// The icon button (docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Document icon") is a small
// outlined square showing a live preview of the DRAFT icon — the one Save will store,
// not necessarily the saved one — or a muted placeholder glyph when there is none.
// Tapping it asks the host to open the shared IconPickerDialog; the host owns the draft.
//
// Flat look (readerStyles.ts), like the Friends panel, coloured by the page's
// time-of-day `look` (ReaderDocumentPage → useTier2Look; slate at night): the strip is
// the page ground over a hairline, undo/redo are bare icon buttons (ink2, the app's other
// bare icon buttons), and Cancel / Save are pills — Cancel the neutral surface pill, Save
// the blue MID fill the Friends tab's Send button wears (a pastel by day and night). (Until 2026-11-16 these were
// lowercase MUI text buttons on the grey header strip, with Save in white-on-infoInk —
// white text on a hue, which the palette rules out.)
const ReaderEditToolbar: React.FC<{
    look: Tier2Look;
    canUndo: boolean;
    canRedo: boolean;
    onUndo: () => void;
    onRedo: () => void;
    onCancel: () => void;
    onSave: () => void;
    saving: boolean;
    // Save is disabled with nothing to save, e.g. a still-blank new document
    // (ReaderDocumentPage) — creating an empty document would be pointless.
    saveDisabled?: boolean;
    // The draft document icon (icons8 id) previewed in the icon button; null = none.
    iconId: string | null;
    // Opens the icon picker (ReaderDocumentPage owns the dialog and the draft).
    onPickIcon: () => void;
}> = ({ look, canUndo, canRedo, onUndo, onRedo, onCancel, onSave, saving, saveDisabled = false, iconId, onPickIcon }) => {
    // Icon does not inherit `color` (it defaults to COLORS.iconColor), so each <Icon>
    // below also takes `look.ink2` directly; this `color` covers the ripple only.
    const iconButtonSx = {
        color: look.ink2,
        // See CardEditToolbar.tsx: opts out of the ~300ms double-tap-zoom delay so
        // rapid undo/redo taps register immediately on touch devices.
        touchAction: "manipulation",
        "&.Mui-disabled": { color: look.ink2, opacity: 0.35 },
    } as const;

    return (
        <Box
            className="reader-edit-toolbar"
            // ⚠️ THE TOOLBAR MUST NOT TAKE FOCUS. While editing, the text field holds the
            // caret and a keyboard (OS or BeginnerKeyboard) is up; a tap anywhere on this
            // strip — a button or the empty gap — would otherwise blur the field, drop the
            // keyboard, and the keyboard inset going to 0 unfolds the page's lead
            // (ReaderDocumentPage's KEYBOARD LIFT `Collapse`: dictionary card + display
            // strip) in the middle of an edit. Swallowing `mousedown` keeps focus where it
            // is without stopping the `click`, so the buttons still fire. Same guard as
            // the beginner keyboard's own keys (BeginnerKeyboard.tsx → `keepFocus`).
            // Cancel/Save need no exception: leaving edit mode swaps the field out anyway.
            onMouseDown={(event: React.MouseEvent) => event.preventDefault()}
            sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                px: 2,
                py: 1,
                backgroundColor: look.ground,
                borderBottom: `1px solid ${look.line}`,
            }}
        >
            <IconButton
                className="reader-edit-toolbar__undo"
                size="small"
                aria-label="Undo"
                onClick={onUndo}
                disabled={!canUndo || saving}
                sx={iconButtonSx}
            >
                <Icon name="undo" size={20} color={look.ink2} />
            </IconButton>
            <IconButton
                className="reader-edit-toolbar__redo"
                size="small"
                aria-label="Redo"
                onClick={onRedo}
                disabled={!canRedo || saving}
                sx={iconButtonSx}
            >
                <Icon name="redo" size={20} color={look.ink2} />
            </IconButton>

            {/* Document icon — outlined (the app's tappable-object rule, CLAUDE.md
                "Buttons & cards") because, unlike undo/redo, it is a filled object
                rather than a bare glyph. 32px square with a 22px preview. */}
            <IconButton
                className={`reader-edit-toolbar__icon-button${iconId ? " reader-edit-toolbar__icon-button--set" : ""}`}
                size="small"
                aria-label={iconId ? "Change document icon" : "Choose document icon"}
                title={iconId ? "Change document icon" : "Choose document icon"}
                onClick={onPickIcon}
                disabled={saving}
                sx={{
                    ...iconButtonSx,
                    ml: 0.5,
                    width: 32,
                    height: 32,
                    p: 0,
                    borderRadius: "10px",
                    border: `1px solid ${look.outline}`,
                    backgroundColor: look.surface,
                    // Hover keeps the surface (a pressed tint over slate would need a blend).
                    "&:hover": { backgroundColor: look.surface },
                }}
            >
                {iconId ? (
                    <Box
                        component="img"
                        className="reader-edit-toolbar__icon-preview"
                        src={iconImageUrl(iconId)}
                        alt=""
                        sx={{ width: 22, height: 22, objectFit: "contain", display: "block" }}
                    />
                ) : (
                    <Icon name="add_photo_alternate" size={18} color={look.ink2} className="reader-edit-toolbar__icon-placeholder" />
                )}
            </IconButton>

            <Box className="reader-edit-toolbar__spacer" sx={{ flex: 1 }} />

            <Button
                className="reader-edit-toolbar__cancel"
                onClick={onCancel}
                disabled={saving}
                sx={readerPillButtonSx(look)}
            >
                Cancel
            </Button>
            <Button
                className="reader-edit-toolbar__save"
                onClick={onSave}
                disabled={saving || saveDisabled}
                sx={readerPillButtonSx(look, COLORS.bluM)}
            >
                {saving ? (
                    <CircularProgress size={14} thickness={5} sx={{ color: COLORS.onSurface }} className="reader-edit-toolbar__save-spinner" />
                ) : (
                    "Save"
                )}
            </Button>
        </Box>
    );
};

export default ReaderEditToolbar;
