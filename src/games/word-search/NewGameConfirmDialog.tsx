import React from "react";
import { Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button } from "@mui/material";
import { SIZE, WEIGHT } from "../../theme/scale";
import { modeLabel } from "./constants";
import { savedWordCount, type SavedWordSearchState } from "./gameStateStorage";

interface NewGameConfirmDialogProps {
    open: boolean;
    /** The parked board a new game would erase — named in the warning. */
    savedGame: SavedWordSearchState | null;
    onCancel: () => void;
    onConfirm: () => void;
    /** BEM block of the launching surface, so each surface keeps its own class names. */
    classPrefix: string;
}

/**
 * "Start a new game?" — the clobber confirm shown when a launch surface's fresh-game
 * action would overwrite a parked Word Search board (one save slot per mode, §5b).
 * Shared by both launch surfaces: the Games hub's mode tile (`WordSearchHubItem`,
 * Pinyin slot) and the Reading Center carousel's play button (`ReadingGamesCarousel`,
 * No Pinyin slot). The caller clears the slot and navigates in `onConfirm`.
 *
 * Docs: docs/WORD_SEARCH_GAME.md §3 / §5b, docs/READING_WRITING_CENTERS.md.
 */
const NewGameConfirmDialog: React.FC<NewGameConfirmDialogProps> = ({ open, savedGame, onCancel, onConfirm, classPrefix }) => (
    <Dialog className={`${classPrefix}__confirm-dialog`} open={open} onClose={onCancel} maxWidth="xs">
        <DialogTitle sx={{ fontSize: SIZE.bodyLg, fontWeight: WEIGHT.bold }}>Start a new game?</DialogTitle>
        <DialogContent>
            <DialogContentText sx={{ fontSize: SIZE.body }}>
                Starting a new game will erase your saved Word Search game
                {savedGame ? ` (${modeLabel(savedGame.mode)}, ${savedGame.found.length}/${savedWordCount(savedGame)} found)` : ""}.
                This can't be undone.
            </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button className={`${classPrefix}__confirm-cancel`} onClick={onCancel} size="small">
                Cancel
            </Button>
            <Button className={`${classPrefix}__confirm-start`} onClick={onConfirm} variant="contained" color="error" size="small">
                Start new game
            </Button>
        </DialogActions>
    </Dialog>
);

export default NewGameConfirmDialog;
