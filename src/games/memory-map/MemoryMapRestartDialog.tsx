import React from "react";
import {
    Box,
    Button,
    Dialog,
    DialogContent,
    DialogTitle,
    IconButton,
    Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { COLORS } from "../../theme/colors";
import { SIZE, WEIGHT } from "../../theme/scale";

/**
 * Memory Map's restart confirm, behind the header's restart button
 * (docs/MEMORY_MAP_GAME.md § 6).
 *
 * This was a settings SHEET behind a gear, whose only row was Restart — a drawer hiding
 * a single tool. The header now carries the restart icon directly and this is the
 * confirm step, which is the part that was actually doing the work: a run can be dozens
 * of prompts long, so destroying it must take a deliberate second tap
 * (Word Search's confirm-before-clobber).
 *
 * What Restart does NOT do is worth stating on the screen, and does: the map itself is
 * server state, so no amount of restarting can move a word. Only the colours go.
 */

interface MemoryMapRestartDialogProps {
    open: boolean;
    onClose: () => void;
    onRestart: () => void;
    /** How many words are coloured, so the confirm can say what is being thrown away. */
    answered: number;
}

const MemoryMapRestartDialog: React.FC<MemoryMapRestartDialogProps> = ({
    open,
    onClose,
    onRestart,
    answered,
}) => (
    <Dialog className="memory-map-restart-dialog" open={open} onClose={onClose} fullWidth maxWidth="xs">
        <DialogTitle
            sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: SIZE.bodyLg,
                fontWeight: WEIGHT.bold,
            }}
        >
            Restart?
            <IconButton
                className="memory-map-restart-dialog__close"
                size="small"
                onClick={onClose}
                aria-label="Close"
            >
                <CloseIcon fontSize="small" />
            </IconButton>
        </DialogTitle>

        <DialogContent sx={{ pb: 2 }}>
            {/* Names what is actually being destroyed. "Restart?" alone does not tell a
                player 40 prompts deep what it will cost them. */}
            <Typography sx={{ fontSize: SIZE.body, color: COLORS.onSurface, mb: 1 }}>
                {answered > 0
                    ? `This clears the ${answered} word${answered === 1 ? "" : "s"} you've coloured and shuffles again.`
                    : "This shuffles the words and starts over."}
            </Typography>
            <Typography sx={{ fontSize: SIZE.caption, color: COLORS.textSecondary, mb: 2 }}>
                Your map itself never changes — where each word sits is permanent.
            </Typography>

            <Box sx={{ display: "flex", gap: 1 }}>
                <Button
                    className="memory-map-restart-dialog__cancel"
                    fullWidth
                    variant="outlined"
                    onClick={onClose}
                >
                    Cancel
                </Button>
                <Button
                    className="memory-map-restart-dialog__confirm"
                    fullWidth
                    variant="contained"
                    color="error"
                    onClick={() => {
                        onRestart();
                        onClose();
                    }}
                >
                    Restart
                </Button>
            </Box>
        </DialogContent>
    </Dialog>
);

export default MemoryMapRestartDialog;
