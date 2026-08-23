import { useEffect, useState } from "react";
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from "@mui/material";
import { setArenaMessage } from "../../api/arena";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { errorTextSx, joinButtonSx, secondaryButtonSx } from "./arenaStyles";

/**
 * The arena message editor (docs/ARENA_FEATURE.md § 2.1a).
 *
 * Reached from the edit action in the /arena header, which is why it lives here as its
 * own component: the page is already a four-state switch, and an inline dialog would add
 * a fifth thing for it to hold. It is deliberately available in EVERY state — someone who
 * is not currently racing should still be able to write the line their next board shows.
 *
 * ── THE SERVER'S ANSWER IS WHAT GETS RENDERED ────────────────────────────────────────
 * `setArenaMessage` returns what was STORED, not what was typed: the service trims,
 * collapses runs of whitespace and strips control characters. We hand that value back to
 * the page rather than our own draft, so what the user sees after saving is what the 24
 * strangers on their board will see.
 *
 * ⚠️ There is no moderation behind this box. The cap and the sanitiser are shape checks,
 * not judgement — see docs/DEFERRED_WORK.md for the system that has to exist before this
 * is safe at scale.
 */
const MESSAGE_MAX = 80;

export default function ArenaMessageDialog({
    open,
    initialMessage,
    onClose,
    onSaved,
}: {
    open: boolean;
    /** The stored message, or null. */
    initialMessage: string | null;
    onClose: () => void;
    /** Handed the value the SERVER stored, so the caller can update its own copy. */
    onSaved: (stored: string | null) => void;
}) {
    const [draft, setDraft] = useState(initialMessage ?? "");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Re-seed each time the dialog opens rather than only on mount: the page stays
    // mounted between openings, so without this a cancelled edit would still be sitting
    // in the box the next time it is opened.
    useEffect(() => {
        if (open) {
            setDraft(initialMessage ?? "");
            setError(null);
        }
    }, [open, initialMessage]);

    const save = async (value: string | null) => {
        setBusy(true);
        setError(null);
        try {
            onSaved(await setArenaMessage(value));
            onClose();
        } catch (err: unknown) {
            setError((err as Error)?.message ?? "Could not save your message.");
        } finally {
            setBusy(false);
        }
    };

    const remaining = MESSAGE_MAX - draft.length;

    return (
        <Dialog className="arena-message-dialog" open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
            <DialogTitle sx={{ fontFamily: FONTS.sans, fontSize: SIZE.subtitle, fontWeight: WEIGHT.bold }}>
                Your arena message
            </DialogTitle>
            <DialogContent>
                <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.micro, color: COLORS.textSecondary, mb: 1.5 }}>
                    One line, shown next to your name on the board. Everyone in your arena can
                    read it.
                </Typography>
                <TextField
                    className="arena-message-dialog__input"
                    autoFocus
                    fullWidth
                    multiline
                    // Two rows of BOX for one line of TEXT: the field is wider than the row
                    // it will be shown in, so a message that fits the board can still wrap
                    // here, and a single-row input would scroll it out of sight while typing.
                    minRows={2}
                    maxRows={3}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value.slice(0, MESSAGE_MAX))}
                    placeholder="Trying to hold my division this week."
                    disabled={busy}
                    slotProps={{ htmlInput: { maxLength: MESSAGE_MAX } }}
                />
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mt: 0.75 }}>
                    <Typography sx={{ ...errorTextSx, visibility: error ? "visible" : "hidden" }}>
                        {error ?? "placeholder"}
                    </Typography>
                    <Typography
                        className="arena-message-dialog__counter"
                        sx={{
                            fontFamily: FONTS.mono,
                            fontSize: SIZE.micro,
                            // Counts DOWN and only turns urgent near the end: a counter that
                            // is red the whole time is one more thing to ignore.
                            color: remaining <= 10 ? COLORS.dangerInk : COLORS.textFaint,
                        }}
                    >
                        {remaining}
                    </Typography>
                </Box>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
                {/* Clearing is a first-class action, not "save an empty box": a line 24
                    strangers can read has to be retractable in one tap. */}
                <Button
                    className="arena-message-dialog__clear"
                    sx={{ ...secondaryButtonSx, mr: "auto" }}
                    onClick={() => save(null)}
                    disabled={busy || (!initialMessage && draft.trim().length === 0)}
                >
                    Clear
                </Button>
                <Button className="arena-message-dialog__cancel" sx={secondaryButtonSx} onClick={onClose} disabled={busy}>
                    Cancel
                </Button>
                <Button
                    className="arena-message-dialog__save"
                    sx={joinButtonSx}
                    onClick={() => save(draft)}
                    disabled={busy}
                >
                    {busy ? "Saving…" : "Save"}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
