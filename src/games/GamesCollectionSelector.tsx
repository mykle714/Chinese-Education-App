import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Typography, Menu, MenuItem, ListSubheader } from "@mui/material";
import { styled } from "@mui/material/styles";
import StyleOutlinedIcon from "@mui/icons-material/StyleOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useAuth } from "../AuthContext";
import type { MasteryGoals } from "../utils/masteryCompute";
import { fetchDecks, type DeckSummary } from "../api/decks";
import { collectionTitle, deckTileColors, type CollectionRef } from "../features/flashcards/collectionRef";
import {
    builtinCollectionEntries, type CollectionGroup,
} from "../features/flashcards/builtinCollections";
import {
    clearSelectedDeckIfMissing, setSelectedCollection, useSelectedCollection,
} from "../features/flashcards/selectedCollection";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { SIZE, WEIGHT, LEADING } from "../theme/scale";

/**
 * The Games hub's "Playing with …" collection selector.
 *
 * ── What it is ────────────────────────────────────────────────────────────────
 * One full-width pill in the hub header (above the TipBox) naming the collection
 * every game on this page will be launched against, and a menu of every set the
 * decks page offers. It replaces the per-collection "Study these cards → pick a
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
 * Feature component (src/games), rendered into HubMenu's `header` slot. It owns the
 * deck fetch for its own menu; the built-in options come from
 * `features/flashcards/builtinCollections.ts` and the decks from `fetchDecks` — the
 * SAME two sources the fdp renders, which is what makes the fdp the source of truth
 * for what a collection is. This file decides only how they look as menu rows.
 *
 * See docs/GAMES_FEATURE.md § "Collection selector", docs/DECKS_FEATURE.md,
 * docs/HUB_MENU_SYSTEM.md.
 */

/** One row of the menu: a collection plus the dot color that identifies it
    elsewhere in the app (the same collection / bar / deck hues the decks-page tiles
    use, so a set is recognisable by color across both surfaces). */
interface CollectionOption {
    key: string;
    ref: CollectionRef;
    label: string;
    color: string;
    /** Section this option is listed under, matching the decks page's sections.
        "Mastered" appears only when the fdp shows it as a section too — with core
        alone, the shared list files that collection under "Cards". */
    group: CollectionGroup | "Decks";
}

const SelectorPill = styled(Box)(() => ({
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: "80%",          // same width/rhythm as the TipBox it sits above
    margin: "0 auto",
    padding: "12px 18px",
    borderRadius: "20px",
    backgroundColor: COLORS.header,
    border: `1px solid ${COLORS.rowBorder}`,
    cursor: "pointer",
    userSelect: "none",
    transition: "filter 120ms ease, transform 120ms ease",
    "&:hover": { filter: "brightness(0.97)" },
    "&:active": { transform: "scale(0.98)" },
}));

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
            // built-in collections below still work, and the user's decks are one
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

    // The full option list, in the decks page's own order and grouping: the built-in
    // collections exactly as that page lists them, then the user's decks. Nothing
    // about WHICH collections exist is decided here.
    const options: CollectionOption[] = useMemo(() => {
        const goals: MasteryGoals = {
            reading: user?.readingGoal === true,
            writing: user?.writingGoal === true,
        };
        const builtins: CollectionOption[] = builtinCollectionEntries(goals).map((entry) => ({
            key: entry.key,
            ref: entry.ref,
            label: entry.label,
            // The tile's saturated tone; the dot has no room for the two-tone pair.
            color: entry.colors.main,
            group: entry.group,
        }));
        const deckOptions: CollectionOption[] = decks.map((deck) => ({
            key: `deck-${deck.id}`,
            ref: { kind: "deck", deckId: deck.id, name: deck.name },
            label: deck.name,
            // The deck tile's SATURATED tone (not its pastel accent) — every other
            // dot here is a `.main`, so a deck's would read as washed out beside them.
            color: deckTileColors(deck.id).main,
            group: "Decks",
        }));
        return [...builtins, ...deckOptions];
    }, [decks, user?.readingGoal, user?.writingGoal]);

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

    return (
        <>
            <SelectorPill
                className={className ?? "games-collection-selector"}
                onClick={(e) => setAnchor(e.currentTarget)}
                role="button"
                aria-haspopup="listbox"
                aria-label={`Playing with ${currentLabel}. Change collection`}
            >
                <StyleOutlinedIcon sx={{ color: COLORS.textSecondary, fontSize: 22, flexShrink: 0 }} />
                <Box className="games-collection-selector__labels" sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                        className="games-collection-selector__caption"
                        sx={{ fontSize: SIZE.caption, color: COLORS.textSecondary, fontFamily: FONTS.sans, lineHeight: LEADING.normal }}
                    >
                        Playing with
                    </Typography>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
                        <ColorDot className="games-collection-selector__dot" dotcolor={currentColor} />
                        <Typography
                            className="games-collection-selector__value"
                            noWrap
                            sx={{ fontSize: SIZE.bodyLg, fontWeight: WEIGHT.medium, color: COLORS.onSurface, fontFamily: FONTS.sans, lineHeight: LEADING.normal }}
                        >
                            {currentLabel}
                        </Typography>
                    </Box>
                </Box>
                <ExpandMoreIcon sx={{ color: COLORS.textSecondary, flexShrink: 0 }} />
            </SelectorPill>

            <Menu
                className="games-collection-selector__menu"
                anchorEl={anchor}
                open={Boolean(anchor)}
                onClose={() => setAnchor(null)}
                // The list can run long (bands + bars + up to 100 decks), so cap it
                // and let it scroll inside the phone frame rather than overflow it.
                slotProps={{ paper: { sx: { maxHeight: 360, minWidth: 220 } } }}
            >
                {options.map((option, index) => [
                    // Section caption whenever the group changes — the same three
                    // bands the decks page stacks (Cards / Mastered / Decks).
                    option.group !== options[index - 1]?.group ? (
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
