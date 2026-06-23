import { useCallback, useEffect, useRef, useState } from "react";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Box,
    Typography,
    CircularProgress,
    Alert,
} from "@mui/material";
import { useAuth } from "../AuthContext";
import { API_BASE_URL } from "../constants";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { SIZE, WEIGHT } from "../theme/scale";

// One catalog row from GET /api/icons8.
interface IconListItem {
    id: string;
    name: string;
}

// Page size requested per infinite-scroll fetch. Kept modest so each batch of
// <img> loads is light on mobile.
const PAGE_SIZE = 48;

// Build the public image URL for an icon id (same convention as the discover flow).
const iconImageUrl = (id: string) =>
    `${API_BASE_URL}/api/icons8/${encodeURIComponent(id)}/image`;

interface AvatarPickerDialogProps {
    open: boolean;
    onClose: () => void;
    /** Currently-selected icon id (highlighted), or null when none chosen. */
    currentIconId: string | null;
    /** Persist the pick (id) or clear it (null). Should resolve once saved. */
    onSelect: (iconId: string | null) => Promise<void>;
}

/**
 * AvatarPickerDialog — modal grid of all downloaded icons8 icons, paged via infinite
 * scroll. Tapping an icon saves it as the user's avatar and closes the dialog; the
 * "Remove avatar" action clears it back to the name-initial fallback.
 *
 * Layer: presentation. Data comes from GET /api/icons8 (offset/limit); each icon is
 * rendered through the public image endpoint /api/icons8/<id>/image.
 */
function AvatarPickerDialog({ open, onClose, currentIconId, onSelect }: AvatarPickerDialogProps) {
    const { token } = useAuth();

    const [icons, setIcons] = useState<IconListItem[]>([]);
    const [hasMore, setHasMore] = useState(true);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Which icon id is mid-save (disables the grid + shows a spinner on that tile).
    const [savingId, setSavingId] = useState<string | null>(null);

    // Sentinel observed by the IntersectionObserver to trigger the next page.
    const sentinelRef = useRef<HTMLDivElement | null>(null);
    // Latest icons.length, read inside the fetch callback without re-creating it
    // (keeps the IntersectionObserver effect from re-subscribing every page).
    const offsetRef = useRef(0);

    // Fetch the next page from the current offset. Guarded so overlapping scroll
    // events / observer fires don't double-load the same slice.
    const loadMore = useCallback(async () => {
        if (loading || !hasMore) return;
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(
                `${API_BASE_URL}/api/icons8?offset=${offsetRef.current}&limit=${PAGE_SIZE}`,
                {
                    credentials: "include",
                    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                }
            );
            if (!res.ok) throw new Error(`Failed to load icons (${res.status})`);
            const data: { icons: IconListItem[]; total: number; hasMore: boolean } = await res.json();
            setIcons((prev) => [...prev, ...data.icons]);
            offsetRef.current += data.icons.length;
            setHasMore(data.hasMore);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load icons");
            // Stop trying to auto-load more after an error; the user can reopen.
            setHasMore(false);
        } finally {
            setLoading(false);
        }
    }, [loading, hasMore, token]);

    // Reset + load the first page each time the dialog opens (so a reopen reflects
    // any catalog changes and starts at the top).
    useEffect(() => {
        if (!open) return;
        setIcons([]);
        setHasMore(true);
        setError(null);
        offsetRef.current = 0;
        // Kick off the first page; subsequent pages come from the observer below.
        loadMore();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Infinite scroll: load the next page when the sentinel scrolls into view.
    useEffect(() => {
        if (!open) return;
        const node = sentinelRef.current;
        if (!node) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0]?.isIntersecting) loadMore();
            },
            { threshold: 0.1 }
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, [open, loadMore]);

    const handlePick = async (id: string | null) => {
        setSavingId(id ?? "__remove__");
        try {
            await onSelect(id);
            onClose();
        } catch {
            // Error surfaced via AuthContext; keep the dialog open so the user can retry.
            setSavingId(null);
        }
    };

    return (
        <Dialog
            className="avatar-picker-dialog"
            open={open}
            onClose={onClose}
            maxWidth="xs"
            fullWidth
            // Cap height so the grid scrolls internally rather than growing the dialog.
            PaperProps={{ sx: { height: "80vh" } }}
        >
            <DialogTitle
                className="avatar-picker-dialog__title"
                sx={{ fontFamily: FONTS.sans, fontWeight: WEIGHT.medium, fontSize: SIZE.body }}
            >
                Choose your avatar
            </DialogTitle>

            <DialogContent className="avatar-picker-dialog__content" dividers sx={{ p: 1.5 }}>
                {error && (
                    <Alert className="avatar-picker-dialog__error" severity="error" sx={{ mb: 1.5 }}>
                        {error}
                    </Alert>
                )}

                <Box
                    className="avatar-picker-dialog__grid"
                    sx={{
                        display: "grid",
                        gridTemplateColumns: "repeat(4, 1fr)",
                        gap: 1,
                    }}
                >
                    {icons.map((icon) => {
                        const isSelected = icon.id === currentIconId;
                        const isSaving = savingId === icon.id;
                        return (
                            <Box
                                key={icon.id}
                                className="avatar-picker-dialog__icon-tile"
                                role="button"
                                aria-label={`Select ${icon.name}`}
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
                                    className="avatar-picker-dialog__icon-image"
                                    src={iconImageUrl(icon.id)}
                                    alt={icon.name}
                                    loading="lazy"
                                    sx={{ width: "100%", height: "100%", objectFit: "contain", opacity: isSaving ? 0.4 : 1 }}
                                />
                                {isSaving && (
                                    <CircularProgress
                                        className="avatar-picker-dialog__tile-spinner"
                                        size={20}
                                        sx={{ position: "absolute" }}
                                    />
                                )}
                            </Box>
                        );
                    })}
                </Box>

                {/* Sentinel + loading row: the observer watches this to fetch the next page. */}
                <Box
                    ref={sentinelRef}
                    className="avatar-picker-dialog__sentinel"
                    sx={{ display: "flex", justifyContent: "center", py: 2, minHeight: 32 }}
                >
                    {loading && <CircularProgress size={24} />}
                    {!loading && !hasMore && icons.length > 0 && (
                        <Typography
                            className="avatar-picker-dialog__end-text"
                            sx={{ fontSize: SIZE.caption, color: COLORS.textSecondary, fontFamily: FONTS.sans }}
                        >
                            That's all the icons
                        </Typography>
                    )}
                </Box>
            </DialogContent>

            <DialogActions className="avatar-picker-dialog__actions" sx={{ px: 2, py: 1.5, justifyContent: "space-between" }}>
                {/* Clear back to the name-initial fallback (only offered when one is set). */}
                <Button
                    className="avatar-picker-dialog__remove-button"
                    color="error"
                    size="small"
                    disabled={!currentIconId || savingId !== null}
                    onClick={() => handlePick(null)}
                >
                    Remove avatar
                </Button>
                <Button
                    className="avatar-picker-dialog__cancel-button"
                    size="small"
                    onClick={onClose}
                    disabled={savingId !== null}
                >
                    Cancel
                </Button>
            </DialogActions>
        </Dialog>
    );
}

export default AvatarPickerDialog;
