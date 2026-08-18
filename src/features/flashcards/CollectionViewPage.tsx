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
import CollectionSortControl from "./CollectionSortControl";
import { useAuth } from "../../AuthContext";
import type { VocabEntry } from "../../types";
import { filterVocabEntries } from "../../utils/vocabSearch";
import { sortVocabEntries, defaultSortKey, type VocabSortKey } from "../../utils/vocabSort";
import type { MasteryGoals } from "../../utils/masteryCompute";
import { usePageTitle } from "../../hooks/usePageTitle";
import { fetchDeckCards, fetchDecks, renameDeck, deleteDeck } from "../../api/decks";
import { fetchCollectionCards } from "../../api/collections";
import {
    type CollectionRef, collectionTitle, withCollectionParams, parseBuiltinCollection,
    builtinCollectionRef,
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
 * collection sources and the flp launch button; NodePage supplies the scroll container,
 * floating footer, back arrow and edge fade, and MiniVocabCardGrid owns the grid.
 *
 * This is a NODE PAGE (docs/UX_AND_NAVIGATION.md): it keeps the footer and uses
 * the LEFT back arrow + horizontal slide.
 */

/** Where "Study these cards" goes — the flp, and only the flp (see handleStudy). */
const FLP_ROUTE = "/flashcards/learn";

const CollectionViewPage: React.FC = () => {
    const navigate = useNavigate();
    // Card Detail (leaf) slides over this page; keep the collection held beneath.
    const slideNavigate = useSlideNavigate();
    const params = useParams();
    const { user, isAuthenticated } = useAuth();

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
    // Client-side ordering over the loaded collection (src/utils/vocabSort.ts). Held
    // per-visit rather than persisted: it is a way of LOOKING at the set, not a
    // property of it, and a collection always opens in its natural order.
    const [sortKey, setSortKey] = useState<VocabSortKey>(() => defaultSortKey(isDeck));
    // Whether this deck was generated for the user rather than authored by them.
    const [deckIsPreset, setDeckIsPreset] = useState(false);
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
        if (builtin) return builtinCollectionRef(builtin);
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
                // A different collection opens in ITS natural order — the routes for
                // a deck and a built-in collection render this same component, so
                // React can reuse the instance and carry a stale key across.
                setSortKey(defaultSortKey(isDeck));

                let cards: VocabEntry[] = [];
                if (isDeck) {
                    cards = await fetchDeckCards(deckId);
                    // The deck's name comes from the deck list rather than a second
                    // per-deck endpoint: the list is one indexed read the user has
                    // almost always just loaded, and it also tells us whether the
                    // deck still exists.
                    const decks = await fetchDecks();
                    const match = decks.find((d) => d.id === deckId);
                    if (!cancelled) {
                        setDeckName(match?.name ?? null);
                        // A GENERATED deck (a Study Challenge study deck, migration 148)
                        // is fully viewable and fully playable here — that is the point of
                        // it — but it may not be renamed or deleted, so the options menu
                        // that offers both is not rendered at all. Absence of the control
                        // IS the restriction (docs/STUDY_CHALLENGE.md § 4); a lock badge
                        // would invite a tap that does nothing.
                        setDeckIsPreset(match?.editMode === "preset");
                    }
                } else if (builtin) {
                    // ONE endpoint for all built-in collections — the id is the only
                    // thing that varies, and the server owns what each one means
                    // (`builtinCollectionClause`). Shared with the /decks sheet's
                    // inline Cards section via src/api/collections.ts.
                    cards = await fetchCollectionCards(builtin);
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
    // "Never reload on token refresh". The api layer resolves the header itself,
    // so no token is captured here at all.
    }, [isAuthenticated, isDeck, deckId, builtin]);

    // Stable tap handler so the memoized cards don't all re-render on parent renders.
    const handleCardClick = useCallback(
        (entry: VocabEntry) => slideNavigate(`/flashcards/card/${entry.id}`),
        [slideNavigate]
    );

    // The account's goal flags: they decide which mastery sort options are offered
    // (one pair per active bar) and which bars "Recently mastered" reads. Memoized so
    // the sort memo below isn't invalidated by a fresh object on every render.
    const goals: MasteryGoals = useMemo(
        () => ({ reading: user?.readingGoal === true, writing: user?.writingGoal === true }),
        [user?.readingGoal, user?.writingGoal]
    );

    // Filter, then order. Both are referentially stable while their inputs are
    // unchanged, so MiniVocabCardGrid's reveal cascade isn't restarted by an
    // unrelated re-render. Sorting AFTER filtering keeps the work proportional to
    // what is actually on screen while the user is typing a search.
    const filteredEntries = useMemo(
        () => filterVocabEntries(entries, searchInput),
        [entries, searchInput]
    );
    const visibleEntries = useMemo(
        () => sortVocabEntries(filteredEntries, sortKey),
        [filteredEntries, sortKey]
    );
    const isSearching = searchInput.trim().length > 0;

    // ── Launch ────────────────────────────────────────────────────────────────
    //
    // ONE destination: the flp. This button used to open a sheet listing the flp and
    // every registered game, which put the two choices in the wrong order — a learner
    // picks the ACTIVITY first. Choosing a card set for a GAME now happens in the
    // Games hub header (GamesCollectionSelector), so the sheet is gone and this is a
    // plain "study these cards as flashcards" button.
    //
    // withCollectionParams is still what makes the session stay inside this set; the
    // flp reads the params back via collectionFromSearch.
    const handleStudy = () => {
        navigate(withCollectionParams(FLP_ROUTE, collection));
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
            headerExtraActions={isDeck && !deckIsPreset && (
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
                    onClick={handleStudy}
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
                    Study these cards
                </Button>
            </Box>

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

            <CollectionSortControl
                classPrefix="collection-view"
                sortKey={sortKey}
                onSortKeyChange={setSortKey}
                language={user?.selectedLanguage}
                goals={goals}
                // "Date added" reads `deckAddedAt`, which only the deck read selects.
                allowDeckOnly={isDeck}
                // Right-aligned under the search field, on the same 364px column as
                // the grid.
                sx={{ width: 364, maxWidth: "100%", px: 3.5, pt: 1 }}
            />

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
                entries={visibleEntries}
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
