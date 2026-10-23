import React from "react";
import { Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button } from "@mui/material";
import { SIZE, WEIGHT } from "../../theme/scale";
import { FOCUS_DAILY_CARDS } from "../../../server/contracts/focusMode";
import type { MasteryWorldId } from "../../../server/contracts/wire";
import { FOCUS_WORLD_NAMES } from "./focusWorldNames";

/**
 * FocusDialog — every focus-mode popup (docs/FOCUS_MODE.md § 5), one component so their
 * look and wording stay one family:
 *
 *   turn-on       the lever was pulled while focus is off: what focus mode does + confirm.
 *   turn-off      the lever was tapped while focus is on: confirm switching it off.
 *   ended         the server switched focus off by itself (the pile is back under FOCUS_DAILY_CARDS).
 *   game-blocked  a game was tapped in a focused world with too few of today's cards left.
 *
 * Same MUI Dialog treatment as the app's other confirms (NewGameConfirmDialog).
 * Callers: src/features/deckTower/useFocusLever.ts (turn-on / turn-off),
 * FocusEndedNoticeHost.tsx (ended), useFocusGameGate.tsx (game-blocked).
 */

export type FocusDialogContent =
    | { kind: "turn-on"; world: MasteryWorldId; readyCount: number }
    | { kind: "turn-off"; world: MasteryWorldId }
    | { kind: "ended"; worlds: MasteryWorldId[] }
    | { kind: "game-blocked"; world: MasteryWorldId; gameTitle: string; remaining: number; needed: number };

interface FocusDialogProps {
    /** null = closed. */
    content: FocusDialogContent | null;
    /** The dismissive answer (Not now / Keep it on / OK), and a backdrop tap. */
    onClose: () => void;
    /** The confirming answer — only turn-on and turn-off have one. */
    onConfirm?: () => void;
    /** A confirm is in flight: its button is disabled. */
    busy?: boolean;
}

/** "the Main world" / "the Main and Reading worlds". */
function worldsPhrase(worlds: MasteryWorldId[]): string {
    const names = worlds.map((w) => FOCUS_WORLD_NAMES[w]);
    if (names.length <= 1) return `the ${names[0] ?? "Main"} world`;
    return `the ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} worlds`;
}

function copyFor(content: FocusDialogContent): { title: string; body: string; dismiss: string; confirm?: string } {
    switch (content.kind) {
        case "turn-on":
            return {
                title: "Turn on focus mode?",
                body:
                    `You have ${content.readyCount} cards ready in ${worldsPhrase([content.world])}. ` +
                    `Focus mode keeps it manageable: each day you'll see at most ${FOCUS_DAILY_CARDS} of them, ` +
                    `and a card you get right is done for the day. It turns itself off once you're back ` +
                    `under ${FOCUS_DAILY_CARDS} ready cards.`,
                dismiss: "Not now",
                confirm: "Turn on",
            };
        case "turn-off":
            return {
                title: "Turn off focus mode?",
                body: `${worldsPhrase([content.world]).replace(/^the/, "The")} will show every ready card again.`,
                dismiss: "Keep it on",
                confirm: "Turn off",
            };
        case "ended":
            return {
                title: "Focus mode is off",
                body:
                    `You've worked your way back to a manageable pile in ${worldsPhrase(content.worlds)}, ` +
                    `so focus mode has turned itself off.`,
                dismiss: "Nice",
            };
        case "game-blocked":
            return {
                title: "Not enough focus cards",
                body:
                    `Focus mode is on in ${worldsPhrase([content.world])}, and ${content.remaining} of today's ` +
                    `cards ${content.remaining === 1 ? "is" : "are"} left. ${content.gameTitle} needs ${content.needed}. ` +
                    `Come back tomorrow, or turn focus mode off on the Deck tab.`,
                dismiss: "OK",
            };
    }
}

const FocusDialog: React.FC<FocusDialogProps> = ({ content, onClose, onConfirm, busy = false }) => {
    // Keep the last content while the dialog animates closed, so its text does not blank.
    const lastContent = React.useRef<FocusDialogContent | null>(content);
    if (content) lastContent.current = content;
    const shown = content ?? lastContent.current;
    const copy = shown ? copyFor(shown) : null;
    return (
        <Dialog className="focus-dialog" open={content !== null} onClose={onClose} maxWidth="xs">
            {copy && (
                <>
                    <DialogTitle className="focus-dialog__title" sx={{ fontSize: SIZE.bodyLg, fontWeight: WEIGHT.bold }}>
                        {copy.title}
                    </DialogTitle>
                    <DialogContent className="focus-dialog__content">
                        <DialogContentText className="focus-dialog__body" sx={{ fontSize: SIZE.body }}>
                            {copy.body}
                        </DialogContentText>
                    </DialogContent>
                    <DialogActions className="focus-dialog__actions" sx={{ px: 3, pb: 2 }}>
                        <Button
                            className="focus-dialog__dismiss"
                            onClick={onClose}
                            size="small"
                            variant={copy.confirm ? "text" : "contained"}
                        >
                            {copy.dismiss}
                        </Button>
                        {copy.confirm && onConfirm && (
                            <Button
                                className="focus-dialog__confirm"
                                onClick={onConfirm}
                                disabled={busy}
                                variant="contained"
                                size="small"
                            >
                                {copy.confirm}
                            </Button>
                        )}
                    </DialogActions>
                </>
            )}
        </Dialog>
    );
};

export default FocusDialog;
