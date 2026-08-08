import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
    Box, TextField, InputAdornment, IconButton, Typography, Button, Menu, MenuItem,
    Dialog, DialogTitle, DialogContent, DialogActions, ListItemIcon,
} from "@mui/material";
import { Search, Clear } from "@mui/icons-material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import StyleOutlinedIcon from "@mui/icons-material/StyleOutlined";
import NodePage from "../../components/NodePage";
import { FooterSpacer } from "../../components/MobileFooter";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import MiniVocabCardGrid from "../../components/MiniVocabCardGrid";
import { useAuth } from "../../AuthContext";
import { API_BASE_URL } from "../../constants";
import type { VocabEntry } from "../../types";
import { filterVocabEntries } from "../../utils/vocabSearch";
import { usePageTitle } from "../../hooks/usePageTitle";
import { GAME_REGISTRY } from "../../games/registry";
import { fetchDeckCards, fetchDecks, renameDeck, deleteDeck } from "../../api/decks";
import {
    type CollectionRef, collectionTitle, withCollectionParams, parseBuiltinCollection,
} from "./collectionRef";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";

/**
 * ONE page for every collection of cards (docs/DECKS_FEATURE.md).
 *
 * It renders three things that used to exist only as the /flashcards/mastered
 * page and as an inline block on /decks:
 *
 *   /flashcards/collection/learn-now  — the sorted Learn Now deck
 *   /flashcards/collection/mastered   — the Mastered cards (this route replaces
 *                                       the old MasteredCardsPage)
 *   /flashcards/deck/:id              — one user-authored deck
 *
 * ── Why two routes and not one `:collectionId` ────────────────────────────────
 * A deck is addressed by its NUMERIC id under its own path segment, so a deck can
 * never collide with a built-in collection name — a user who names a deck
 * "mastered" gets `/flashcards/deck/42`, not a URL that shadows a real route.
 *
 * ── Layer ─────────────────────────────────────────────────────────────────────
 * Feature page (src/features/flashcards). It owns data fetching for the three
 * collection sources and the launch sheet; NodePage supplies the scroll container,
 * floating footer, back arrow and edge fade, and MiniVocabCardGrid owns the grid.
 *
 * This is a NODE PAGE (docs/UX_AND_NAVIGATION.md): it keeps the footer and uses
 * the LEFT back arrow + horizontal slide.
 */

/** The flp, listed alongside the games in the launch sheet. */
const FLP_LAUNCH = { id: "flp", title: "Flashcards", route: "/flashcards/learn" } as const;

const CollectionViewPage: React.FC = () => {
    const navigate = useNavigate();
    // Card Detail (leaf) slides over this page; keep the collection held beneath.
    const slideNavigate = useSlideNavigate();
    const params = useParams();
    const { user, token, isAuthenticated } = useAuth();

    // Which collection is this? Derived from the route, so the two routes share
    // every line below. `deckId` is NaN-guarded because the segment is user-typed.
    const builtin = parseBuiltinCollection(params.builtin);
    const deckId = params.id ? parseInt(params.id, 10) : NaN;
    const isDeck = Number.isInteger(deckId) && deckId > 0;

    const [entries, setEntries] = useState<VocabEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    // A deck's name isn't in the URL, so it arrives with the deck list. Held in
    // state (not derived) because renaming updates it without a refetch.
    const [deckName, setDeckName] = useState<string | null>(null);
    // Client-side search over the loaded collection. Supports the same query
    // formats as the dictionary search bars (CJK / numbered pinyin / toneless
    // pinyin / English) via filterVocabEntries — no network round trip, since the
    // collection is already in memory.
    const [searchInput, setSearchInput] = useState("");
    // Anchor for the "Play with these cards" sheet.
    const [launchAnchor, setLaunchAnchor] = useState<HTMLElement | null>(null);
    // Anchor for the deck-only overflow menu (rename / delete).
    const [deckMenuAnchor, setDeckMenuAnchor] = useState<HTMLElement | null>(null);
    const [renameOpen, setRenameOpen] = useState(false);
    const [renameValue, setRenameValue] = useState("");
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);

    // The collection this page represents. Memoized so the launch links and the
    // page title are referentially stable across unrelated re-renders.
    const collection: CollectionRef | null = useMemo(() => {
        if (isDeck) return { kind: "deck", deckId, name: deckName ?? undefined };
        if (builtin) return { kind: builtin };
        return null;
    }, [isDeck, deckId, builtin, deckName]);

    const title = collection ? collectionTitle(collection) : "Cards";
    usePageTitle(title);

    // ── Load the collection ───────────────────────────────────────────────────
    //
    // The three sources are three different endpoints, but all return the SAME
    // enriched VocabEntry[] shape — which is the whole reason one page can render
    // them (see DeckService.listDeckCards).
    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            try {
                setLoading(true);
                setError(null);

                let cards: VocabEntry[] = [];
                if (isDeck) {
                    cards = await fetchDeckCards(deckId);
                    // The deck's name comes from the deck list rather than a second
                    // per-deck endpoint: the list is one indexed read the user has
                    // almost always just loaded, and it also tells us whether the
                    // deck still exists.
                    const decks = await fetchDecks();
                    const match = decks.find((d) => d.id === deckId);
                    if (!cancelled) setDeckName(match?.name ?? null);
                } else if (builtin) {
                    // These two still go through raw fetch rather than src/api/http:
                    // they are the pre-existing OnDeck endpoints, untouched by this
                    // feature. Converting them is a separate cleanup.
                    const path = builtin === "mastered"
                        ? "/api/onDeck/masteredLibraryCards"
                        : "/api/onDeck/nonMasteredLibraryCards";
                    const response = await fetch(`${API_BASE_URL}${path}`, {
                        credentials: "include",
                        headers: { Authorization: `Bearer ${token}` },
                    });
                    if (!response.ok) throw new Error("Failed to fetch cards");
                    const data = await response.json();
                    cards = Array.isArray(data) ? data : [];
                }

                if (!cancelled) setEntries(cards);
            } catch (err: unknown) {
                console.error("Error loading collection:", err);
                if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load cards");
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        if (isAuthenticated) load();
        return () => { cancelled = true; };
    // Keyed on isAuthenticated — the stable auth-presence flag, not the `token`
    // string — so a silent refresh doesn't re-fetch mid-scroll. See CLAUDE.md
    // "Never reload on token refresh". `token` is read inside the callback only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthenticated, isDeck, deckId, builtin]);

    // Stable tap handler so the memoized cards don't all re-render on parent renders.
    const handleCardClick = useCallback(
        (entry: VocabEntry) => slideNavigate(`/flashcards/card/${entry.id}`),
        [slideNavigate]
    );

    // Apply the search filter. Referentially stable while the query and collection
    // are unchanged, so MiniVocabCardGrid's reveal cascade isn't restarted.
    const filteredEntries = useMemo(
        () => filterVocabEntries(entries, searchInput),
        [entries, searchInput]
    );
    const isSearching = searchInput.trim().length > 0;

    // ── Launch targets ────────────────────────────────────────────────────────
    //
    // The flp plus every registered game, minus the ones this learner's language
    // can't play — the same `languages` gate GamesPage applies, so Speed Reading
    // doesn't appear for a Spanish learner only to fail on arrival.
    const launchTargets = useMemo(() => {
        const games = GAME_REGISTRY.filter(
            (g) => !g.languages || !user?.selectedLanguage || g.languages.includes(user.selectedLanguage)
        ).map((g) => ({ id: g.gameId, title: g.title, route: g.route }));
        return [FLP_LAUNCH, ...games];
    }, [user?.selectedLanguage]);

    const handleLaunch = (route: string) => {
        setLaunchAnchor(null);
        // withCollectionParams is what makes the round stay inside this set; every
        // game and the flp read the params back via collectionFromSearch.
        navigate(withCollectionParams(route, collection));
    };

    // ── Deck-only actions ─────────────────────────────────────────────────────
    const handleRename = async () => {
        try {
            const updated = await renameDeck(deckId, renameValue);
            setDeckName(updated.name);
            setRenameOpen(false);
            setActionError(null);
        } catch (err: unknown) {
            setActionError(err instanceof Error ? err.message : "Could not rename this deck");
        }
    };

    const handleDelete = async () => {
        try {
            await deleteDeck(deckId);
            // Back to /decks rather than navigate(-1): the previous entry may be
            // this deck's own card detail, which would 404 now.
            navigate("/flashcards/decks", { replace: true });
        } catch (err: unknown) {
            setActionError(err instanceof Error ? err.message : "Could not delete this deck");
            setDeleteOpen(false);
        }
    };

    const emptyMessage = isSearching
        ? "No cards match your search."
        : isDeck
            ? "This deck is empty. Add cards from a card's detail page."
            : builtin === "mastered"
                ? "No mastered cards yet. Cards will appear here when you master them through study!"
                : "Please go to the Discover tab to select cards you would like to learn";

    return (
        // Back arrow slides right and returns to /decks (the previous history entry).
        <NodePage
            title={title}
            activePage="flashcards"
            onBack={() => navigate(-1)}
            contentClassName="collection-view-page-content"
            contentSx={{ alignItems: "center" }}
            headerExtraActions={isDeck && (
                <IconButton
                    className="collection-view__deck-menu-button"
                    aria-label="Deck options"
                    onClick={(e) => setDeckMenuAnchor(e.currentTarget)}
                    sx={{ color: COLORS.textSecondary }}
                >
                    <MoreVertIcon />
                </IconButton>
            )}
        >
            {/* Launch row — the FIRST thing on the page, per the feature's brief:
                from any collection you can drop straight into any surface with
                exactly these cards. */}
            <Box className="collection-view__launch" sx={{ width: 364, maxWidth: "100%", px: 3.5, pt: 1.5 }}>
                <Button
                    className="collection-view__launch-button"
                    fullWidth
                    startIcon={<PlayArrowIcon />}
                    onClick={(e) => setLaunchAnchor(e.currentTarget)}
                    sx={{
                        borderRadius: "8px",
                        padding: "14px 16px",
                        fontSize: SIZE.bodyLg,
                        fontWeight: WEIGHT.medium,
                        fontFamily: FONTS.sans,
                        textTransform: "none",
                        color: COLORS.onSurface,
                        backgroundColor: COLORS.greenAccent,
                        boxShadow: "2px 4px 4px rgba(0, 0, 0, 0.25)",
                        "&:hover": { backgroundColor: COLORS.greenAccent },
                    }}
                >
                    Play with these cards
                </Button>
            </Box>

            <Menu
                className="collection-view__launch-menu"
                anchorEl={launchAnchor}
                open={Boolean(launchAnchor)}
                onClose={() => setLaunchAnchor(null)}
            >
                {launchTargets.map((target) => (
                    <MenuItem
                        key={target.id}
                        className={`collection-view__launch-option collection-view__launch-option--${target.id}`}
                        onClick={() => handleLaunch(target.route)}
                    >
                        {target.title}
                    </MenuItem>
                ))}
            </Menu>

            {/* Client-side search, sized to the 364px card grid so the input lines
                up over the cards below it. Moved here from /decks, which now lists
                decks rather than cards. */}
            <Box className="collection-view__search" sx={{ width: 364, maxWidth: "100%", px: 3.5, pt: 1.5 }}>
                <TextField
                    className="collection-view__search-input"
                    fullWidth
                    size="small"
                    placeholder={`Search ${title}...`}
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    InputProps={{
                        startAdornment: (
                            <InputAdornment position="start">
                                <Search />
                            </InputAdornment>
                        ),
                        endAdornment: searchInput && (
                            <InputAdornment position="end">
                                <IconButton
                                    aria-label="clear search"
                                    onClick={() => setSearchInput("")}
                                    edge="end"
                                    size="small"
                                >
                                    <Clear />
                                </IconButton>
                            </InputAdornment>
                        ),
                    }}
                />
            </Box>

            {actionError && (
                <Typography
                    className="collection-view__action-error"
                    sx={{ color: COLORS.redAccent, fontSize: SIZE.body, fontFamily: FONTS.sans, pt: 1 }}
                >
                    {actionError}
                </Typography>
            )}

            <MiniVocabCardGrid
                containerClassName="collection-view__cards"
                classPrefix="collection-view"
                loading={loading}
                error={error}
                entries={filteredEntries}
                emptyMessage={emptyMessage}
                onCardClick={handleCardClick}
            />
            <FooterSpacer />

            {/* Deck-only overflow: renaming and deleting a deck live INSIDE the deck
                rather than on the /decks list, so the list stays a plain set of
                tappable rows with no per-row action affordance. */}
            <Menu
                className="collection-view__deck-menu"
                anchorEl={deckMenuAnchor}
                open={Boolean(deckMenuAnchor)}
                onClose={() => setDeckMenuAnchor(null)}
            >
                <MenuItem
                    className="collection-view__deck-menu-rename"
                    onClick={() => {
                        setRenameValue(deckName ?? "");
                        setRenameOpen(true);
                        setDeckMenuAnchor(null);
                    }}
                >
                    <ListItemIcon><StyleOutlinedIcon fontSize="small" /></ListItemIcon>
                    Rename deck
                </MenuItem>
                <MenuItem
                    className="collection-view__deck-menu-delete"
                    onClick={() => { setDeleteOpen(true); setDeckMenuAnchor(null); }}
                    sx={{ color: "#ef5350" }}
                >
                    Delete deck
                </MenuItem>
            </Menu>

            <Dialog className="collection-view__rename-dialog" open={renameOpen} onClose={() => setRenameOpen(false)}>
                <DialogTitle>Rename deck</DialogTitle>
                <DialogContent>
                    <TextField
                        className="collection-view__rename-input"
                        autoFocus
                        fullWidth
                        size="small"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        inputProps={{ maxLength: 64 }}
                        sx={{ mt: 1 }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRenameOpen(false)}>Cancel</Button>
                    <Button onClick={handleRename} disabled={!renameValue.trim()}>Save</Button>
                </DialogActions>
            </Dialog>

            <Dialog className="collection-view__delete-dialog" open={deleteOpen} onClose={() => setDeleteOpen(false)}>
                <DialogTitle>Delete this deck?</DialogTitle>
                <DialogContent>
                    {/* Stated explicitly because it is the user's first worry, and it
                        is genuinely true — deleting a deck drops membership rows only
                        (migration 141 / DeckDAL.deleteDeck). */}
                    <Typography sx={{ fontSize: SIZE.body, fontFamily: FONTS.sans }}>
                        Your cards are not deleted — only this deck. They stay in Learn Now
                        with all of their progress.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
                    <Button onClick={handleDelete} sx={{ color: "#ef5350" }}>Delete</Button>
                </DialogActions>
            </Dialog>
        </NodePage>
    );
};

export default CollectionViewPage;
