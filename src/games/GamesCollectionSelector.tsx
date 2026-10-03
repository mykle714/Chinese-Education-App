import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Menu, MenuItem, ListSubheader } from "@mui/material";
import { styled } from "@mui/material/styles";
import { CollectionChip } from "../components/bento";
import { useAuth } from "../AuthContext";
import { fetchDecks, type DeckSummary } from "../api/decks";
import { collectionTitle, deckTileColors, type CollectionRef } from "../features/flashcards/collectionRef";
import {
    ALL_CARDS, clearSelectedDeckIfMissing, setSelectedCollection, useSelectedCollection,
} from "../features/flashcards/selectedCollection";
import { BAND_COLORS } from "../utils/categoryColors";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { SIZE, WEIGHT } from "../theme/scale";

/**
 * The Games hub's "Playing with …" collection selector.
 *
 * ── What it is ────────────────────────────────────────────────────────────────
 * One half-width `CollectionChip` (`.chipsel`) at the top of the hub (it spans the
 * right Bento column), naming the collection every game on this page will be
 * launched against, and a menu of All Cards plus the learner's decks. It replaces the per-collection "Study these cards → pick a
 * game" sheet that used to live on CollectionViewPage: choosing the CARDS and
 * choosing the GAME were two steps in the wrong order — a learner picks the
 * activity from the Games hub, so the card set belongs there too.
 *
 * ── How the choice reaches a game ─────────────────────────────────────────────
 * It does NOT. The selector only writes to the session store
 * (features/flashcards/selectedCollection.ts); GamesPage and WordSearchHubItem read
 * it and wrap their links in `withCollectionParams`, so a game still arrives with
 * `?deck=` / `?collection=` exactly as a launch from a collection page always did.
 * The selection is not persisted — it is gone on reload (see the store's header).
 *
 * ── Layer ─────────────────────────────────────────────────────────────────────
 * Feature component (src/games), rendered above the hub's Bento grid. It owns the
 * deck fetch for its own menu (`fetchDecks`, the same list the fdp renders — custom
 * decks AND generated Study Challenge decks).
 *
 * ── Deliberately narrower than the fdp ────────────────────────────────────────
 * The only built-in offered is All Cards. Learn Now and the Mastered collections
 * (core / reading / writing) were removed from this menu on 2026-10-03: the hub's
 * choice is "everything, or one deck I made / was given", and the mastery-derived
 * sets are browsed from the fdp and the Mastery Centers instead. Their routes and
 * `?collection=` ids still work — a game launched from a collection page still
 * honors them; the hub just no longer offers them.
 *
 * See docs/GAMES_FEATURE.md § "Collection selector", docs/DECKS_FEATURE.md,
 * docs/BENTO_SYSTEM.md.
 */

/** One row of the menu: a collection plus the dot color that identifies it
    elsewhere in the app (the same collection / bar / deck hues the decks-page tiles
    use, so a set is recognisable by color across both surfaces). */
interface CollectionOption {
    key: string;
    ref: CollectionRef;
    label: string;
    color: string;
    /** Section this option is listed under. All Cards sits alone and uncaptioned at
        the top; the decks follow under a "Decks" caption. */
    group: "All" | "Decks";
}

/** Small filled circle carrying a collection's identifying color. */
const ColorDot = styled(Box)<{ dotcolor: string }>(({ dotcolor }) => ({
    width: 12,
    height: 12,
    borderRadius: "50%",
    flexShrink: 0,
    backgroundColor: dotcolor,
}));

const GamesCollectionSelector: React.FC<{ className?: string }> = ({ className }) => {
    const { isAuthenticated, user } = useAuth();
    const selected = useSelectedCollection();
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const [anchorNode, setAnchorNode] = useState<HTMLElement | null>(null);
    const [decks, setDecks] = useState<DeckSummary[]>([]);

    const loadDecks = useCallback(async () => {
        try {
            const list = await fetchDecks();
            setDecks(list);
            // A deck selected before a delete / language switch would send a dead
            // `?deck=` to every game; fall back to All Cards instead.
            clearSelectedDeckIfMissing(list.map((d) => d.id));
        } catch (err: unknown) {
            // A failed deck list is not worth an error state on the hub: the
            // All Cards row still works, and the user's decks are one
            // tap away on /decks. Log and carry on with an empty Decks section.
            console.error("Error loading decks for the games collection selector:", err);
            setDecks([]);
        }
    }, []);

    // Keyed on isAuthenticated (+ the selected language, which decides WHICH decks
    // exist) — never on `token`, which rotates on every silent refresh.
    // See CLAUDE.md "Never reload/reset a page on a silent token refresh".
    useEffect(() => {
        if (isAuthenticated) loadDecks();
    }, [isAuthenticated, user?.selectedLanguage, loadDecks]);

    // The full option list: All Cards, then the user's decks (custom + challenge) in
    // the order `fetchDecks` returns them. See the header for why no other built-in
    // collection is offered here.
    const options: CollectionOption[] = useMemo(() => {
        const allCards: CollectionOption = {
            key: "all",
            ref: ALL_CARDS,
            label: collectionTitle(ALL_CARDS),
            // The All Cards tile's saturated tone; the dot has no room for the two-tone pair.
            color: BAND_COLORS.All.main,
            group: "All",
        };
        const deckOptions: CollectionOption[] = decks.map((deck) => ({
            key: `deck-${deck.id}`,
            ref: { kind: "deck", deckId: deck.id, name: deck.name },
            label: deck.name,
            // The deck tile's SATURATED tone (not its pastel accent) — every other
            // dot here is a `.main`, so a deck's would read as washed out beside them.
            color: deckTileColors(deck.id).main,
            group: "Decks",
        }));
        return [allCards, ...deckOptions];
    }, [decks]);

    // The pill's own label/color. Looked up in `options` rather than read off the
    // stored ref so a renamed deck relabels itself on the next load; falls back to
    // the ref's own title while the deck list is still in flight.
    const current = options.find((o) => refsEqual(o.ref, selected));
    const currentLabel = current?.label ?? collectionTitle(selected);
    const currentColor = current?.color ?? COLORS.card;

    const handlePick = (ref: CollectionRef) => {
        setSelectedCollection(ref);
        setAnchor(null);
    };

    // Nothing to choose: with no decks the menu would hold All Cards alone, so the
    // chip is not rendered at all (the hub then plays with All Cards, the store's
    // default). Also covers the deck fetch in flight or failed, and accounts with no
    // decks yet — the chip appears once a deck exists. Placed after every hook so the
    // hook order stays fixed across renders.
    if (decks.length === 0) return null;

    return (
        <>
            {/* The chip's own anchor. CollectionChip is a presentational primitive, so
                the menu's anchorEl comes from this wrapper rather than the chip. */}
            <Box
                ref={setAnchorNode}
                onClick={() => setAnchor(anchorNode)}
                role="button"
                aria-haspopup="listbox"
                aria-label={`Playing with ${currentLabel}. Change collection`}
                className="games-collection-selector__anchor"
                // HALF-WIDTH, RIGHT-JUSTIFIED: the chip spans the right Bento column
                // only. `marginLeft: auto` pushes the wrapper to the row's right edge;
                // its width is sized so the chip's left edge sits 2px inside the right
                // tile's left edge — the same 2px border inset its 18px side margin
                // already applies on the right (Bento: 16px gutter, 10px gap ⇒ right
                // column starts at 50% + 5px; wrapper starts at 50% − 11px, chip at
                // 50% − 11px + 18px = 50% + 7px).
                sx={{ width: "calc(50% + 11px)", marginLeft: "auto" }}
            >
                <CollectionChip
                    className={className ?? "games-collection-selector"}
                    icon="style"
                    label={currentLabel}
                    /* The collection's identifying colour. The artboard draws only the
                       leading glyph here, but the dot is the one thing tying this chip to
                       the same set's tile on the decks page — dropping it would make the
                       hub the only surface where a collection has no colour. */
                    trailing={<ColorDot className="games-collection-selector__dot" dotcolor={currentColor} />}
                />
            </Box>

            <Menu
                className="games-collection-selector__menu"
                anchorEl={anchor}
                open={Boolean(anchor)}
                onClose={() => setAnchor(null)}
                // The list can run long (bands + bars + up to 100 decks), so cap it
                // and let it scroll inside the phone frame rather than overflow it.
                slotProps={{ paper: { sx: { maxHeight: 360, minWidth: 220 } } }}
                // Right-aligned to the chip: it sits in the right column, so a
                // left-anchored 220px menu would run past the screen edge.
                anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                transformOrigin={{ vertical: "top", horizontal: "right" }}
            >
                {options.map((option, index) => [
                    // "Decks" caption above the first deck. All Cards is a single row
                    // and needs no caption of its own.
                    option.group === "Decks" && options[index - 1]?.group !== "Decks" ? (
                        <ListSubheader
                            key={`${option.key}-header`}
                            className={`games-collection-selector__group games-collection-selector__group--${option.group.toLowerCase()}`}
                            sx={{ fontSize: SIZE.body, fontWeight: WEIGHT.medium, fontFamily: FONTS.sans, color: COLORS.textSecondary, lineHeight: 2 }}
                        >
                            {option.group}
                        </ListSubheader>
                    ) : null,
                    <MenuItem
                        key={option.key}
                        className={`games-collection-selector__option games-collection-selector__option--${option.key}`}
                        selected={refsEqual(option.ref, selected)}
                        onClick={() => handlePick(option.ref)}
                        sx={{ gap: 1.25, fontSize: SIZE.body, fontFamily: FONTS.sans }}
                    >
                        <ColorDot dotcolor={option.color} />
                        {option.label}
                    </MenuItem>,
                ])}
            </Menu>
        </>
    );
};

/** Structural equality for two CollectionRefs — they are plain value objects, and
    the stored one is never the same instance as a freshly-built option. */
function refsEqual(a: CollectionRef, b: CollectionRef): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === "deck" && b.kind === "deck") return a.deckId === b.deckId;
    if (a.kind === "mastered" && b.kind === "mastered") return a.bar === b.bar;
    return true;
}

export default GamesCollectionSelector;
