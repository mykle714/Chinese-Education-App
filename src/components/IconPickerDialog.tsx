import { useCallback, useEffect, useRef, useState } from "react";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Box,
    TextField,
    Typography,
    CircularProgress,
    Alert,
    InputAdornment,
    IconButton,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import { useAuth } from "../AuthContext";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { SIZE, WEIGHT } from "../theme/scale";
import { searchIcons8, listIcons8, ensureIcon8 } from "../pages/FlashcardsLearnPage/cardIconApi";
import { iconImageUrl, iconCdnPreviewUrl } from "../pages/FlashcardsLearnPage/cardIconLayout";

interface IconItem { id: string; name: string }

// Page size per infinite-scroll fetch (matches the server clamp on both endpoints).
const PAGE_SIZE = 48;
// Debounce (ms) before firing a search for the typed term. (List mode is immediate.)
const SEARCH_DEBOUNCE_MS = 350;

interface IconPickerDialogProps {
    open: boolean;
    onClose: () => void;
    /** Dialog heading (e.g. "Add an icon" / "Choose your avatar"). */
    title: string;
    /**
     * Called with the chosen, now-cached icon id (we always ensure-download before
     * invoking this, so the icon is guaranteed renderable via our own image endpoint).
     * May be async — the tile spinner stays until it resolves.
     */
    onPick: (iconId: string) => void | Promise<void>;
    /** Pre-fills the search box on open. Empty (default) opens in browse-all mode. */
    initialTerm?: string;
    /**
     * Optional pre-fetched first page of results for the default query. When the box's
     * term matches `prefetched.term`, page 0 renders from here with NO network fetch
     * (instant open); typing a different term — or paging past page 0 — falls back to
     * the live icons8 search as usual. See docs/CARD_ICON_LAYOUT.md.
     */
    prefetched?: { term: string; icons: IconItem[] } | null;
    /** When provided, the matching tile is highlighted (avatar's current selection). */
    currentIconId?: string | null;
    /** When provided, a left-aligned action (e.g. "Remove avatar") is shown. */
    onRemove?: () => Promise<void>;
    /** Label for the optional remove action. */
    removeLabel?: string;
}

/**
 * IconPickerDialog — the shared icon search + browser used by both the custom card
 * icon layout editor (flp, docs/CARD_ICON_LAYOUT.md) and the avatar picker (Account).
 *
 * One search box, default empty:
 *   • Empty query → browse all *downloaded* icons (GET /api/icons8), rendered through
 *     our cached image endpoint. This is the avatar picker's classic behavior.
 *   • Non-empty query → live icons8 search (GET /api/icons8/search), rendered from the
 *     icons8 CDN preview (un-cached). This is the editor's add-icon behavior.
 * Both modes page via the same sentinel/IntersectionObserver. On select we always
 * download+cache the SVG into our DB (ensure) before handing the id to onPick, so a
 * freshly-searched icon is immediately servable from our own endpoint.
 *
 * Layer: presentation. Data via cardIconApi (searchIcons8 / listIcons8 / ensureIcon8).
 */
function IconPickerDialog({
    open,
    onClose,
    title,
    onPick,
    initialTerm = "",
    prefetched = null,
    currentIconId = null,
    onRemove,
    removeLabel = "Remove",
}: IconPickerDialogProps) {
    const { token } = useAuth();

    const [term, setTerm] = useState("");
    const [icons, setIcons] = useState<IconItem[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(false);
    // Errors from the SELECT/ensure step always surface as an alert. Search failures
    // do NOT — they fall through to the neutral "No icons found" empty state. A
    // browse-all (list) failure DOES surface, since that's an unexpected server error.
    const [error, setError] = useState<string | null>(null);
    // Icon id mid-action (disables the grid + shows a spinner on that tile). The
    // remove action uses the "__remove__" sentinel.
    const [savingId, setSavingId] = useState<string | null>(null);

    const sentinelRef = useRef<HTMLDivElement | null>(null);
    const offsetRef = useRef(0);
    // The term the current results belong to (read inside loadMore without re-creating it).
    const termRef = useRef("");

    // Whether the current results are search results (CDN preview) vs the downloaded
    // catalog (our cached image endpoint). Drives both the tile <img> src and the
    // empty/end-of-list messaging.
    const searching = term.trim().length > 0;

    // Fetch one page for the active term: icons8 search when typed, the downloaded
    // catalog when empty. Both return { icons, hasMore }.
    const fetchPage = useCallback(
        (activeTerm: string, offset: number) =>
            activeTerm
                ? searchIcons8(token, activeTerm, offset, PAGE_SIZE)
                : listIcons8(token, offset, PAGE_SIZE),
        [token]
    );

    // Fetch the next page for the active term. Guarded against overlapping fires.
    const loadMore = useCallback(async () => {
        if (loading || !hasMore) return;
        setLoading(true);
        setError(null);
        const activeTerm = termRef.current.trim();
        try {
            const data = await fetchPage(activeTerm, offsetRef.current);
            setIcons((prev) => [...prev, ...data.icons]);
            offsetRef.current += data.icons.length;
            setHasMore(data.hasMore);
        } catch (err) {
            setHasMore(false);
            // Browse-all failures are unexpected → surface them. Search paging failures
            // are silent (the already-shown results stay).
            if (!activeTerm) setError(err instanceof Error ? err.message : "Failed to load icons");
        } finally {
            setLoading(false);
        }
    }, [loading, hasMore, fetchPage]);

    // (Re)load the first page whenever the term changes (while open). Search is
    // debounced; browse-all (empty term) fires immediately. Resets paging.
    useEffect(() => {
        if (!open) return;
        const t = term.trim();
        termRef.current = t;
        offsetRef.current = 0;
        setIcons([]);
        setError(null);
        setHasMore(false);

        // Default-query fast path: if this term is the prefetched default query, render
        // its first page immediately with no network hit. Paging past it falls back to
        // the live search (fetchPage at offsetRef), so "load more" continues seamlessly.
        if (t && prefetched && prefetched.term.trim() === t && prefetched.icons.length > 0) {
            console.log(`[IconPicker] using cached icons8 response for "${t}" (${prefetched.icons.length} icons, no network)`);
            setIcons(prefetched.icons);
            offsetRef.current = prefetched.icons.length;
            setHasMore(prefetched.icons.length >= PAGE_SIZE);
            setLoading(false);
            return;
        }

        setLoading(true);
        const handle = setTimeout(async () => {
            try {
                const data = await fetchPage(t, 0);
                // Ignore if the term changed while we were fetching.
                if (termRef.current !== t) return;
                setIcons(data.icons);
                offsetRef.current = data.icons.length;
                setHasMore(data.hasMore);
            } catch (err) {
                if (termRef.current !== t) return;
                setHasMore(false);
                // Search failures → neutral empty state; browse-all failures → alert.
                if (t) setIcons([]);
                else setError(err instanceof Error ? err.message : "Failed to load icons");
            } finally {
                if (termRef.current === t) setLoading(false);
            }
        }, t ? SEARCH_DEBOUNCE_MS : 0);
        return () => clearTimeout(handle);
    }, [term, open, fetchPage, prefetched]);

    // Reset each time the dialog opens, pre-filling the search with initialTerm (the
    // term effect above reacts to it). Empty initialTerm → opens in browse-all mode.
    //
    // This effect deliberately owns ONLY `term` and `savingId`. The term effect above
    // runs on every open (it depends on `open`) and already resets icons/offset/hasMore/
    // error/termRef before (re)loading. Because effects fire in declaration order, the
    // term effect runs first and this one second — so if this one also reset icons it
    // would clobber the page the term effect just loaded. That clobber was invisible on
    // the first open (term genuinely changed from "" → initialTerm, re-triggering the
    // term effect AFTER this one), but on a re-open with the same initialTerm the
    // setTerm is a no-op, nothing re-triggers the term effect, and the grid was left
    // empty. Keeping the reset of shared state solely in the term effect avoids the race.
    useEffect(() => {
        if (!open) return;
        setTerm(initialTerm.trim());
        setSavingId(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Infinite scroll: next page when the sentinel scrolls into view.
    useEffect(() => {
        if (!open) return;
        const node = sentinelRef.current;
        if (!node) return;
        const observer = new IntersectionObserver(
            (entries) => { if (entries[0]?.isIntersecting) loadMore(); },
            { threshold: 0.1 }
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, [open, loadMore]);

    const handlePick = async (id: string) => {
        setSavingId(id);
        setError(null);
        try {
            // Download-on-select: cache the SVG into our DB so it can be served from our
            // own image endpoint (idempotent for icons already in the catalog).
            await ensureIcon8(token, id);
            await onPick(id);
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to add icon");
            setSavingId(null);
        }
    };

    const handleRemove = async () => {
        if (!onRemove) return;
        setSavingId("__remove__");
        setError(null);
        try {
            await onRemove();
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to remove");
            setSavingId(null);
        }
    };

    return (
        <Dialog
            className="icon-picker-dialog"
            open={open}
            onClose={onClose}
            maxWidth="xs"
            fullWidth
            PaperProps={{ sx: { height: "80vh" } }}
        >
            <DialogTitle
                className="icon-picker-dialog__title"
                sx={{ fontFamily: FONTS.sans, fontWeight: WEIGHT.medium, fontSize: SIZE.body, pb: 1 }}
            >
                {title}
            </DialogTitle>

            <DialogContent className="icon-picker-dialog__content" dividers sx={{ p: 1.5 }}>
                <TextField
                    className="icon-picker-dialog__search"
                    fullWidth
                    size="small"
                    placeholder="Search icons (e.g. cat, house, star)"
                    value={term}
                    onChange={(e) => setTerm(e.target.value)}
                    sx={{ mb: 1.5 }}
                    InputProps={{
                        startAdornment: (
                            <InputAdornment position="start">
                                <SearchIcon fontSize="small" />
                            </InputAdornment>
                        ),
                        // Clear button — only shown while there is text to clear.
                        endAdornment: term ? (
                            <InputAdornment position="end">
                                <IconButton
                                    className="icon-picker-dialog__clear"
                                    size="small"
                                    aria-label="Clear search"
                                    onClick={() => setTerm("")}
                                    edge="end"
                                >
                                    <ClearIcon fontSize="small" />
                                </IconButton>
                            </InputAdornment>
                        ) : undefined,
                    }}
                />

                {error && (
                    <Alert className="icon-picker-dialog__error" severity="error" sx={{ mb: 1.5 }}>
                        {error}
                    </Alert>
                )}

                <Box
                    className="icon-picker-dialog__grid"
                    // minmax(0, 1fr) (not a bare 1fr, which is minmax(auto, 1fr)) lets each
                    // column shrink below the intrinsic width of its icon image. Without it,
                    // the large CDN-preview images keep the 3 columns from shrinking and the
                    // grid overflows its container → horizontal scroll on narrow screens.
                    sx={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 1 }}
                >
                    {icons.map((icon) => {
                        const isSaving = savingId === icon.id;
                        const isSelected = icon.id === currentIconId;
                        return (
                            <Box
                                key={icon.id}
                                className="icon-picker-dialog__tile"
                                role="button"
                                aria-label={`Select ${icon.name}`}
                                title={icon.name}
                                onClick={() => savingId === null && handlePick(icon.id)}
                                sx={{
                                    position: "relative",
                                    aspectRatio: "1 / 1",
                                    // Belt-and-suspenders with the grid's minmax(0,1fr): a grid
                                    // item's default min-width is auto, so pin it to 0 so the
                                    // tile can shrink to its track instead of overflowing.
                                    minWidth: 0,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    borderRadius: 2,
                                    p: 1,
                                    cursor: savingId === null ? "pointer" : "default",
                                    border: isSelected
                                        ? `2px solid ${COLORS.blueMain}`
                                        : `1px solid ${COLORS.border}`,
                                    backgroundColor: isSelected ? "rgba(119,155,231,0.12)" : "transparent",
                                    transition: "background-color 0.15s ease, border-color 0.15s ease",
                                    "&:hover": { backgroundColor: COLORS.rowHoverBg },
                                }}
                            >
                                <Box
                                    component="img"
                                    className="icon-picker-dialog__tile-image"
                                    // Search results aren't in our DB yet → preview from the
                                    // icons8 CDN; downloaded catalog items → our cached endpoint.
                                    src={searching ? iconCdnPreviewUrl(icon.id) : iconImageUrl(icon.id)}
                                    alt={icon.name}
                                    loading="lazy"
                                    sx={{ width: "100%", height: "100%", objectFit: "contain", opacity: isSaving ? 0.4 : 1 }}
                                />
                                {isSaving && (
                                    <CircularProgress size={20} sx={{ position: "absolute" }} />
                                )}
                            </Box>
                        );
                    })}
                </Box>

                <Box
                    ref={sentinelRef}
                    className="icon-picker-dialog__sentinel"
                    sx={{ display: "flex", justifyContent: "center", py: 2, minHeight: 32 }}
                >
                    {loading && <CircularProgress size={24} />}
                    {!loading && searching && icons.length === 0 && !error && (
                        <Typography sx={{ fontSize: SIZE.caption, color: COLORS.textSecondary, fontFamily: FONTS.sans }}>
                            No icons found
                        </Typography>
                    )}
                    {!loading && !searching && !hasMore && icons.length > 0 && (
                        <Typography sx={{ fontSize: SIZE.caption, color: COLORS.textSecondary, fontFamily: FONTS.sans }}>
                            That's all the icons
                        </Typography>
                    )}
                </Box>
            </DialogContent>

            {/* No explicit dismiss control: tapping the backdrop closes the dialog
                (onClose). The only action shown is the optional "Remove" (avatar). */}
            {onRemove && (
                <DialogActions className="icon-picker-dialog__actions" sx={{ px: 2, py: 1.5 }}>
                    <Button
                        className="icon-picker-dialog__remove-button"
                        color="error"
                        size="small"
                        disabled={!currentIconId || savingId !== null}
                        onClick={handleRemove}
                    >
                        {removeLabel}
                    </Button>
                </DialogActions>
            )}
        </Dialog>
    );
}

export default IconPickerDialog;
