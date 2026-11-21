import { useRef, useState } from "react";
import { Box, Menu, MenuItem, Typography } from "@mui/material";
import Icon from "../../components/Icon";
import { HeaderIconButton } from "../../components/PageHeader";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { readerMenuPaperSx } from "../../reading/readerStyles";
import type { Tier2Look } from "../../timeOfDay/tier2Look";
import { READER_SORT_OPTIONS, type ReaderSortKey } from "./readerListOrder";

/**
 * The `/reader` list toolbar's SORT icon and its menu: Newest first (default) · Oldest first ·
 * Title A–Z · Recently edited · Longest first. The current order wears a check; picking
 * one closes the menu. The ordering itself is `sortTexts` (readerListOrder.ts), and the
 * choice persists per device (useReaderListSort).
 *
 * The icon sits left of the grid/list toggle in ReaderListToolbar, in the same `outlined`
 * HeaderIconButton skin. Its glyph stays `sort` whatever the order — the menu's check
 * carries the current choice.
 *
 * Coloured by the page's time-of-day `look` (ReaderPage → useTier2Look): the button's
 * glyph and ring, and the portalled menu's paper and text, turn slate at night.
 *
 * HeaderIconButton's onClick carries no event, so the menu anchors to a wrapper span.
 *
 * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Sorting".
 * Layer: feature view (src/features/reader). Rendered by: ReaderListToolbar.tsx.
 */
interface ReaderSortMenuProps {
    look: Tier2Look;
    sortKey: ReaderSortKey;
    onChange: (key: ReaderSortKey) => void;
}

function ReaderSortMenu({ look, sortKey, onChange }: ReaderSortMenuProps) {
    const anchorRef = useRef<HTMLSpanElement>(null);
    const [open, setOpen] = useState(false);

    return (
        <>
            <Box component="span" ref={anchorRef} className="reader-page__sort-anchor" sx={{ display: "inline-flex" }}>
                <HeaderIconButton
                    className="reader-page__sort-button"
                    variant="outlined"
                    color={look.ink2}
                    outlineColor={look.outline}
                    icon="sort"
                    label="Sort documents"
                    pressed={open}
                    onClick={() => setOpen(true)}
                />
            </Box>
            <Menu
                className="reader-page__sort-menu"
                anchorEl={anchorRef.current}
                open={open}
                onClose={() => setOpen(false)}
                anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                transformOrigin={{ vertical: "top", horizontal: "right" }}
                slotProps={{ paper: { elevation: 0, sx: { ...readerMenuPaperSx(look), minWidth: 200 } } }}
            >
                {READER_SORT_OPTIONS.map((option) => {
                    const selected = option.key === sortKey;
                    return (
                        <MenuItem
                            key={option.key}
                            className={`reader-page__sort-option reader-page__sort-option--${option.key}${selected ? " reader-page__sort-option--selected" : ""}`}
                            selected={selected}
                            onClick={() => {
                                setOpen(false);
                                onChange(option.key);
                            }}
                            sx={{
                                gap: "10px",
                                py: 1.25,
                                // The check marks the choice; MUI's grey selected wash would
                                // be a second, off-framework signal.
                                "&.Mui-selected, &.Mui-selected:hover": { backgroundColor: "transparent" },
                            }}
                        >
                            <Icon name={option.icon} size={19} color={look.ink2} />
                            <Typography
                                className="reader-page__sort-option-label"
                                sx={{
                                    flex: 1,
                                    fontFamily: FONTS.sans,
                                    fontSize: SIZE.body,
                                    fontWeight: selected ? WEIGHT.semibold : WEIGHT.medium,
                                    color: look.ink,
                                }}
                            >
                                {option.label}
                            </Typography>
                            {/* Fixed-width slot so labels don't shift when the check moves. */}
                            <Box className="reader-page__sort-option-check" sx={{ width: 19, display: "flex" }}>
                                {selected && <Icon name="check" size={19} color={look.ink} />}
                            </Box>
                        </MenuItem>
                    );
                })}
            </Menu>
        </>
    );
}

export default ReaderSortMenu;
