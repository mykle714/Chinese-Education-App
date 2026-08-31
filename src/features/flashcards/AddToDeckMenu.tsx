import { useState, useEffect, useCallback } from "react";
import {
    Box, IconButton, Menu, MenuItem, Checkbox, ListItemText, Divider,
    Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, Tooltip,
} from "@mui/material";
import LibraryAddOutlinedIcon from "@mui/icons-material/LibraryAddOutlined";
import { fetchDecks, fetchDeckMemberships, setDeckMemberships, createDeck, type DeckSummary } from "../../api/decks";
import Icon from "../../components/Icon";
import { COLORS } from "../../theme/colors";
import { CARD_OPS_CELL_SX, CARD_OPS_CELL_LABEL_SX } from "./cardOpsCell";

/**
 * "Add to deck" — an icon button that opens a CHECKBOX menu of the user's decks
 * (docs/DECKS_FEATURE.md).
 *
 * Mounted in exactly ONE place today: the card's operations rail (`CardOpsRail`,
 * artboard 21) as a rail cell, via `appearance: "rail"` — which both the flp and the cdp
 * now mount, so filing a card is the same control on every surface.
 *
 * It used to have two other hosts, both gone: the eip definition tab's action bar
 * (`InfoCardActionBar`, deleted — the panel is information-only now) and the cdp's header
 * actions (2026-08-28 — a card operation belongs ON the card, and the cdp's hero card
 * carries the rail). NOTE that this leaves the `button` appearance and the `color` /
 * `label` props with no caller; they are kept for the next host that wants a labelled or
 * bare-icon trigger.
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
    /**
     * When set, the trigger is a LABELLED outlined button carrying this text instead
     * of the bare icon button. Header hosts (cdp) omit it and keep the compact icon.
     *
     * Ignored by `appearance: "rail"`, which supplies its own fixed label.
     */
    label?: string;
    /**
     * `"rail"` renders the trigger as a cell on the flp card's operations rail
     * (`.crail`, artboard 21): the design's `library_add` glyph over an "add to deck"
     * micro-label, sized and coloured by `CARD_OPS_CELL_SX` so it is indistinguishable
     * from the rail's other two cells. Default `"button"` keeps the icon/labelled
     * shapes above.
     *
     * A third shape rather than a `trigger` render-prop: this component owns the deck
     * fetch, the tick state and the save-on-close, and every host wants exactly that
     * behaviour behind a differently-shaped button.
     */
    appearance?: "button" | "rail";
}

const AddToDeckMenu: React.FC<AddToDeckMenuProps> = ({ vocabEntryId, className, color, label, appearance = "button" }) => {
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
                // GENERATED decks are excluded from this menu (migration 148,
                // docs/STUDY_CHALLENGE.md § 4). Their membership is fixed at creation, so
                // a tickable row here would be a control that does nothing — and it is
                // precisely because they never appear in this menu that they are allowed
                // to share a name with each other (the deck-name uniqueness index is
                // partial on `editMode = 'custom'`).
                setDecks(allDecks.filter((deck) => deck.editMode === "custom"));
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

    // Shared by both trigger shapes: taps must not bubble to the flip/drag handlers of
    // any wrapping card (matches SpeakerButton's stop-propagation pattern).
    const openMenu = (e: React.MouseEvent<HTMLElement>) => {
        e.stopPropagation();
        setAnchor(e.currentTarget);
    };

    return (
        <>
            {appearance === "rail" ? (
                <Box
                    component="button"
                    type="button"
                    className={className ?? "add-to-deck__button add-to-deck__button--rail"}
                    aria-label="Add to deck"
                    onClick={openMenu}
                    onMouseDown={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                    onTouchEnd={(e) => e.stopPropagation()}
                    sx={CARD_OPS_CELL_SX}
                >
                    <Icon name="library_add" size={18} color={COLORS.onSurface} />
                    <Box component="em" sx={CARD_OPS_CELL_LABEL_SX}>add to deck</Box>
                </Box>
            ) : label ? (
                <Button
                    className={className ?? "add-to-deck__button"}
                    variant="outlined"
                    size="small"
                    startIcon={<LibraryAddOutlinedIcon />}
                    aria-label="Add to deck"
                    onClick={openMenu}
                    onMouseDown={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                    onTouchEnd={(e) => e.stopPropagation()}
                    sx={color ? { color } : undefined}
                >
                    {label}
                </Button>
            ) : (
                <Tooltip title="Add to deck">
                    <IconButton
                        className={className ?? "add-to-deck__button"}
                        size="small"
                        aria-label="Add to deck"
                        onClick={openMenu}
                        sx={color ? { color } : undefined}
                    >
                        <LibraryAddOutlinedIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
            )}

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
