import { useState, useEffect, useCallback } from "react";
import {
    IconButton, Menu, MenuItem, Checkbox, ListItemText, Divider,
    Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, Tooltip,
} from "@mui/material";
import LibraryAddOutlinedIcon from "@mui/icons-material/LibraryAddOutlined";
import { fetchDecks, fetchDeckMemberships, setDeckMemberships, createDeck, type DeckSummary } from "../../api/decks";

/**
 * "Add to deck" — an icon button that opens a CHECKBOX menu of the user's decks
 * (docs/DECKS_FEATURE.md).
 *
 * Mounted in two places, both of which already have the card in hand:
 *   • the cdp header actions (VocabCardDetailPage), and
 *   • the eip header action grid (InfoCardPanelBody).
 *
 * ── Why a whole-set save on close, not a write per tick ───────────────────────
 * Ticking three boxes would otherwise be three requests, and a half-completed
 * sequence leaves membership in a state the user never chose. The menu therefore
 * holds the ticks locally and PUTs the resulting SET once, when it closes — which
 * matches the server's whole-set endpoint (SetDeckMembershipsBody). The response
 * is adopted rather than the optimistic state, so a deck deleted while the menu
 * was open silently drops out instead of appearing ticked forever.
 *
 * ── Why it self-hides without a vocab entry ───────────────────────────────────
 * A deck holds vet rows. The eip can be opened on a DICTIONARY entry the user has
 * not saved (no vet row, so no id), and there is nothing to add — the button is
 * simply absent there rather than opening a menu that cannot save.
 */
interface AddToDeckMenuProps {
    /**
     * The vet row id to add. Pass null/undefined when the entry has no vocab row
     * (dictionary-only); the component renders nothing.
     */
    vocabEntryId?: number | null;
    /** Optional class for the trigger button, so each host can scope its styling. */
    className?: string;
    /** Icon color, so the button matches whichever header it sits in. */
    color?: string;
}

const AddToDeckMenu: React.FC<AddToDeckMenuProps> = ({ vocabEntryId, className, color }) => {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const [decks, setDecks] = useState<DeckSummary[]>([]);
    // The ticked set, held locally while the menu is open (see the class comment).
    const [checked, setChecked] = useState<Set<number>>(new Set());
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [newDeckOpen, setNewDeckOpen] = useState(false);
    const [newDeckName, setNewDeckName] = useState("");

    const open = Boolean(anchor);

    // Load the deck list and this card's current membership together when the menu
    // opens — not on mount. The button appears on every card detail and every eip
    // panel, so loading eagerly would fire two requests per card view for a menu
    // most users never open.
    useEffect(() => {
        if (!open || !vocabEntryId) return;
        let cancelled = false;

        (async () => {
            try {
                setLoading(true);
                setError(null);
                const [allDecks, memberships] = await Promise.all([
                    fetchDecks(),
                    fetchDeckMemberships(vocabEntryId),
                ]);
                if (cancelled) return;
                setDecks(allDecks);
                setChecked(new Set(memberships));
            } catch (err: unknown) {
                if (!cancelled) setError(err instanceof Error ? err.message : "Could not load your decks");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [open, vocabEntryId]);

    const toggle = (deckId: number) => {
        setChecked((prev) => {
            const next = new Set(prev);
            if (next.has(deckId)) next.delete(deckId);
            else next.add(deckId);
            return next;
        });
    };

    // Save on close. Fire-and-await inside a try so a failed save surfaces rather
    // than being swallowed — the menu stays closed either way, because reopening it
    // re-reads the server's truth.
    const handleClose = useCallback(async () => {
        setAnchor(null);
        if (!vocabEntryId) return;
        try {
            const saved = await setDeckMemberships(vocabEntryId, [...checked]);
            setChecked(new Set(saved));
        } catch (err: unknown) {
            console.error("Could not save deck membership:", err);
            setError(err instanceof Error ? err.message : "Could not save");
        }
    }, [vocabEntryId, checked]);

    const handleCreateDeck = async () => {
        try {
            const deck = await createDeck(newDeckName);
            // A deck made from this menu is ticked immediately: the user opened it
            // to file THIS card, so creating a deck and not adding the card would
            // require a second interaction to finish the thing they started.
            setDecks((prev) => [deck, ...prev]);
            setChecked((prev) => new Set(prev).add(deck.id));
            setNewDeckOpen(false);
            setNewDeckName("");
            setError(null);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Could not create the deck");
        }
    };

    // Nothing to file — see the class comment.
    if (!vocabEntryId) return null;

    return (
        <>
            <Tooltip title="Add to deck">
                <IconButton
                    className={className ?? "add-to-deck__button"}
                    size="small"
                    aria-label="Add to deck"
                    onClick={(e) => {
                        // Match SpeakerButton's stop-propagation pattern so taps don't
                        // bubble to flip/drag handlers in any wrapping card.
                        e.stopPropagation();
                        setAnchor(e.currentTarget);
                    }}
                    sx={color ? { color } : undefined}
                >
                    <LibraryAddOutlinedIcon fontSize="small" />
                </IconButton>
            </Tooltip>

            <Menu
                className="add-to-deck__menu"
                anchorEl={anchor}
                open={open}
                onClose={handleClose}
            >
                {loading && <MenuItem className="add-to-deck__loading" disabled>Loading…</MenuItem>}
                {!loading && error && <MenuItem className="add-to-deck__error" disabled>{error}</MenuItem>}
                {!loading && !error && decks.length === 0 && (
                    <MenuItem className="add-to-deck__empty" disabled>No decks yet</MenuItem>
                )}
                {!loading && decks.map((deck) => (
                    <MenuItem
                        key={deck.id}
                        className="add-to-deck__deck-option"
                        onClick={() => toggle(deck.id)}
                    >
                        <Checkbox
                            className="add-to-deck__deck-checkbox"
                            edge="start"
                            size="small"
                            checked={checked.has(deck.id)}
                            tabIndex={-1}
                            disableRipple
                        />
                        <ListItemText primary={deck.name} secondary={`${deck.cardCount} cards`} />
                    </MenuItem>
                ))}
                <Divider />
                <MenuItem
                    className="add-to-deck__new-deck"
                    onClick={() => { setNewDeckName(""); setNewDeckOpen(true); }}
                >
                    New deck…
                </MenuItem>
            </Menu>

            <Dialog
                className="add-to-deck__new-deck-dialog"
                open={newDeckOpen}
                onClose={() => setNewDeckOpen(false)}
            >
                <DialogTitle>New deck</DialogTitle>
                <DialogContent>
                    <TextField
                        className="add-to-deck__new-deck-input"
                        autoFocus
                        fullWidth
                        size="small"
                        placeholder="Deck name"
                        value={newDeckName}
                        onChange={(e) => setNewDeckName(e.target.value)}
                        inputProps={{ maxLength: 64 }}
                        error={Boolean(error)}
                        helperText={error ?? " "}
                        sx={{ mt: 1, minWidth: 260 }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setNewDeckOpen(false)}>Cancel</Button>
                    <Button onClick={handleCreateDeck} disabled={!newDeckName.trim()}>Create</Button>
                </DialogActions>
            </Dialog>
        </>
    );
};

export default AddToDeckMenu;
