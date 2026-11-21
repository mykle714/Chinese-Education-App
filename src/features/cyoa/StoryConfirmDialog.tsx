import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from "@mui/material";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { LEADING, SIZE, WEIGHT } from "../../theme/scale";
import type { Tier2Look } from "../../timeOfDay/tier2Look";
import { CYOA_CARD_RADIUS, cyoaPillButtonSx } from "./cyoaStyles";

/**
 * StoryConfirmDialog — the editor's "are you sure?" for a destructive step (delete a story,
 * delete a passage). docs/CYOA_FEATURE.md § 5.
 *
 * The Reader's delete dialog look (src/features/reader/DeleteDocumentDialog.tsx — mirrored,
 * not imported, per docs/FRONTEND_LAYERING.md): a flat card on the host's time-of-day
 * `look` (the dialog portals to <body>, so the host hands its look in), sentence-case title,
 * Cancel as the neutral pill and the action as the red MID pill. The action itself and its
 * error line belong to the host (useStoryEdit's notice), so this stays presentational.
 *
 * Layer: feature presentation (src/features/cyoa). Rendered by StoryEditorPage,
 * PassageEditorPage.
 */

interface StoryConfirmDialogProps {
    look: Tier2Look;
    open: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    /** Disables both buttons while the action runs. */
    busy: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}

function StoryConfirmDialog({ look, open, title, message, confirmLabel, busy, onCancel, onConfirm }: StoryConfirmDialogProps) {
    return (
        <Dialog
            className="story-confirm-dialog"
            open={open}
            onClose={busy ? undefined : onCancel}
            maxWidth="xs"
            fullWidth
            PaperProps={{
                elevation: 0,
                sx: { backgroundColor: look.surface, border: `1px solid ${look.line}`, borderRadius: CYOA_CARD_RADIUS, mx: 2 },
            }}
        >
            <DialogTitle
                className="story-confirm-dialog__title"
                sx={{ fontFamily: FONTS.sans, fontSize: SIZE.subtitle, fontWeight: WEIGHT.bold, lineHeight: LEADING.tight, color: look.ink, pb: 1 }}
            >
                {title}
            </DialogTitle>
            <DialogContent className="story-confirm-dialog__content" sx={{ pb: 1 }}>
                <DialogContentText
                    className="story-confirm-dialog__message"
                    sx={{ fontFamily: FONTS.sans, fontSize: SIZE.body, lineHeight: LEADING.normal, color: look.muted }}
                >
                    {message}
                </DialogContentText>
            </DialogContent>
            <DialogActions className="story-confirm-dialog__actions" sx={{ px: 3, pb: 2.5 }}>
                <Button className="story-confirm-dialog__cancel" onClick={onCancel} disabled={busy} sx={cyoaPillButtonSx(look)}>
                    Cancel
                </Button>
                <Button className="story-confirm-dialog__confirm" onClick={onConfirm} disabled={busy} sx={cyoaPillButtonSx(look, COLORS.redM)}>
                    {confirmLabel}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

export default StoryConfirmDialog;
