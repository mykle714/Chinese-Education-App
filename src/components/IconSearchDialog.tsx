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
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import { useAuth } from "../AuthContext";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { SIZE, WEIGHT } from "../theme/scale";
import { searchIcons8, ensureIcon8 } from "../pages/FlashcardsLearnPage/cardIconApi";
import { iconCdnPreviewUrl } from "../pages/FlashcardsLearnPage/cardIconLayout";

interface IconSearchItem { id: string; name: string }

// Page size per infinite-scroll fetch (matches the server clamp).
const PAGE_SIZE = 48;
// Debounce (ms) before firing a search for the typed term.
const SEARCH_DEBOUNCE_MS = 350;

/**
 * IconSearchDialog — modal icons8 search for the custom card icon layout's "add icon"
 * flow (docs/CARD_ICON_LAYOUT.md). Type a term → live icons8 search; tiles preview
 * from the icons8 CDN (un-cached). On select, the icon's SVG is downloaded+cached into
 * our DB (ensure) and handed back via onPick to append to the canvas.
 *
 * Layer: presentation. Data via GET /api/icons8/search + POST /api/icons8/:id/ensure.
 */
function IconSearchDialog({
    open,
    onClose,
    onPick,
    initialTerm = "",
}: {
    open: boolean;
    onClose: () => void;
    /** Called with the chosen (now-cached) icon id. Resolve once it's been added. */
    onPick: (iconId: string) => void;
    /** Pre-fills the search box on open (e.g. the card's English text) so results show
     *  immediately for the word being studied. */
    initialTerm?: string;
}) {
    const { token } = useAuth();

    const [term, setTerm] = useState("");
    const [icons, setIcons] = useState<IconSearchItem[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(false);
    // Errors from the SELECT/ensure step (downloading a chosen icon) still surface as
    // an alert. Search failures do NOT — they fall through to the neutral "No icons
    // found" empty state (per product: a search never shows a fetch error).
    const [error, setError] = useState<string | null>(null);
    // Icon id mid-download (disables the grid + shows a spinner on that tile).
    const [savingId, setSavingId] = useState<string | null>(null);

    const sentinelRef = useRef<HTMLDivElement | null>(null);
    const offsetRef = useRef(0);
    // The term the current results belong to (read inside loadMore without re-creating it).
    const termRef = useRef("");

    // Fetch the next page for the active term. Guarded against overlapping fires.
    const loadMore = useCallback(async () => {
        const activeTerm = termRef.current.trim();
        if (!activeTerm || loading || !hasMore) return;
        setLoading(true);
        setError(null);
        try {
            const data = await searchIcons8(token, activeTerm, offsetRef.current, PAGE_SIZE);
            setIcons((prev) => [...prev, ...data.icons]);
            offsetRef.current += data.icons.length;
            setHasMore(data.hasMore);
        } catch {
            // Search failure → stop paging; the already-shown results stay.
            setHasMore(false);
        } finally {
            setLoading(false);
        }
    }, [token, loading, hasMore]);

    // Debounced new search whenever the term changes (while open). Resets paging.
    useEffect(() => {
        if (!open) return;
        const t = term.trim();
        termRef.current = t;
        offsetRef.current = 0;
        setIcons([]);
        setError(null);
        if (!t) {
            setHasMore(false);
            return;
        }
        setLoading(true);
        const handle = setTimeout(async () => {
            try {
                const data = await searchIcons8(token, t, 0, PAGE_SIZE);
                // Ignore if the term changed while we were fetching.
                if (termRef.current !== t) return;
                setIcons(data.icons);
                offsetRef.current = data.icons.length;
                setHasMore(data.hasMore);
            } catch {
                if (termRef.current !== t) return;
                // Treat a failed search like an empty one — the empty-state message
                // ("No icons found") shows instead of a fetch error.
                setIcons([]);
                setHasMore(false);
            } finally {
                if (termRef.current === t) setLoading(false);
            }
        }, SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(handle);
    }, [term, open, token]);

    // Reset each time the dialog opens, pre-filling the search with the card's English
    // text so results appear immediately. The search effect above reacts to the term.
    useEffect(() => {
        if (!open) return;
        setTerm(initialTerm.trim());
        setIcons([]);
        setHasMore(false);
        setError(null);
        setSavingId(null);
        offsetRef.current = 0;
        termRef.current = "";
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
        try {
            // Download-on-select: cache the SVG into our DB so the canvas can render it
            // via our own image endpoint.
            await ensureIcon8(token, id);
            onPick(id);
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to add icon");
            setSavingId(null);
        }
    };

    return (
        <Dialog
            className="icon-search-dialog"
            open={open}
            onClose={onClose}
            maxWidth="xs"
            fullWidth
            PaperProps={{ sx: { height: "80vh" } }}
        >
            <DialogTitle
                className="icon-search-dialog__title"
                sx={{ fontFamily: FONTS.sans, fontWeight: WEIGHT.medium, fontSize: SIZE.body, pb: 1 }}
            >
                Add an icon
            </DialogTitle>

            <DialogContent className="icon-search-dialog__content" dividers sx={{ p: 1.5 }}>
                <TextField
                    className="icon-search-dialog__search"
                    fullWidth
                    autoFocus
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
                    }}
                />

                {error && (
                    <Alert className="icon-search-dialog__error" severity="error" sx={{ mb: 1.5 }}>
                        {error}
                    </Alert>
                )}

                <Box
                    className="icon-search-dialog__grid"
                    sx={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1 }}
                >
                    {icons.map((icon) => {
                        const isSaving = savingId === icon.id;
                        return (
                            <Box
                                key={icon.id}
                                className="icon-search-dialog__tile"
                                role="button"
                                aria-label={`Add ${icon.name}`}
                                title={icon.name}
                                onClick={() => savingId === null && handlePick(icon.id)}
                                sx={{
                                    position: "relative",
                                    aspectRatio: "1 / 1",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    borderRadius: 2,
                                    p: 1,
                                    cursor: savingId === null ? "pointer" : "default",
                                    border: `1px solid ${COLORS.border}`,
                                    "&:hover": { backgroundColor: COLORS.rowHoverBg },
                                }}
                            >
                                <Box
                                    component="img"
                                    className="icon-search-dialog__tile-image"
                                    src={iconCdnPreviewUrl(icon.id)}
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
                    className="icon-search-dialog__sentinel"
                    sx={{ display: "flex", justifyContent: "center", py: 2, minHeight: 32 }}
                >
                    {loading && <CircularProgress size={24} />}
                    {!loading && term.trim() && icons.length === 0 && !error && (
                        <Typography sx={{ fontSize: SIZE.caption, color: COLORS.textSecondary, fontFamily: FONTS.sans }}>
                            No icons found
                        </Typography>
                    )}
                    {!loading && !term.trim() && (
                        <Typography sx={{ fontSize: SIZE.caption, color: COLORS.textSecondary, fontFamily: FONTS.sans }}>
                            Type to search icons
                        </Typography>
                    )}
                </Box>
            </DialogContent>

            <DialogActions className="icon-search-dialog__actions" sx={{ px: 2, py: 1.5 }}>
                <Button className="icon-search-dialog__cancel" size="small" onClick={onClose} disabled={savingId !== null}>
                    Cancel
                </Button>
            </DialogActions>
        </Dialog>
    );
}

export default IconSearchDialog;
