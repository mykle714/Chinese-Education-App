import { useState } from "react";
import {
    Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField,
} from "@mui/material";

/**
 * NewDeckDialog — the "name your deck" prompt behind the + button on every decks
 * panel (the fdp sheet and both Mastery Centers).
 *
 * ── Why it is a component ─────────────────────────────────────────────────────
 * It was inline in FlashcardsDecksPage, which was fine while the panel had one host.
 * Three hosts render the same + button, and a dialog copied three times would have
 * drifted on the one thing that matters here: the error path. The server owns the
 * naming rules (blank, duplicate, the 100-deck per-language cap) and its message is
 * shown VERBATIM — this component must never restate a rule, or the two definitions
 * disagree the first time the cap changes.
 *
 * The dialog owns only its own field and error state; the deck itself is created by
 * the caller's `onCreate` (useDecksPanel's `addDeck`), which is where the deck list
 * lives. It closes only on success, so a rejected name keeps what the user typed.
 *
 * Layer: feature component (src/features/flashcards). Presentation + local form state.
 * Docs: docs/DECKS_FEATURE.md.
 */
export interface NewDeckDialogProps {
    open: boolean;
    onClose: () => void;
    /** Creates the deck. Rejects with the server's message, which is shown as-is. */
    onCreate: (name: string) => Promise<void>;
    /** Class-name prefix so each host keeps distinct hooks. */
    classPrefix: string;
}

const NewDeckDialog: React.FC<NewDeckDialogProps> = ({ open, onClose, onCreate, classPrefix }) => {
    const [name, setName] = useState("");
    const [error, setError] = useState<string | null>(null);

    const handleCreate = async () => {
        try {
            await onCreate(name);
            setName("");
            setError(null);
            onClose();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Could not create the deck");
        }
    };

    return (
        <Dialog
            className={`${classPrefix}__new-deck-dialog`}
            open={open}
            // Reset on close so a reopened dialog never shows the last attempt's error
            // beside an empty field.
            onClose={() => { setError(null); onClose(); }}
        >
            <DialogTitle>New deck</DialogTitle>
            <DialogContent>
                <TextField
                    className={`${classPrefix}__new-deck-input`}
                    autoFocus
                    fullWidth
                    size="small"
                    placeholder="Deck name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    inputProps={{ maxLength: 64 }}
                    error={Boolean(error)}
                    // A blank line rather than no helper text, so the dialog does not
                    // change height when an error appears.
                    helperText={error ?? " "}
                    sx={{ mt: 1, minWidth: 260 }}
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={() => { setError(null); onClose(); }}>Cancel</Button>
                <Button onClick={handleCreate} disabled={!name.trim()}>Create</Button>
            </DialogActions>
        </Dialog>
    );
};

export default NewDeckDialog;
