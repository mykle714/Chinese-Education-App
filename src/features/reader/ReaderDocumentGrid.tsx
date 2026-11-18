import { useState } from "react";
import { Box, Menu, MenuItem, Typography } from "@mui/material";
import Icon from "../../components/Icon";
import type { Text } from "../../types";
import { COLORS, RAMP } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { LEADING, SIZE, WEIGHT } from "../../theme/scale";
import { iconImageUrl } from "../../cardIcons/cardIconLayout";
import { readerMenuPaperSx } from "./readerStyles";
import type { Tier2Look } from "../../timeOfDay/tier2Look";
import { formatJournalDate, isJournal, readerDocumentGlyph, readerDocumentHue } from "./readerListOrder";

/**
 * The Reader's GRID view (`/reader`, the default — useReaderListView.ts): a 2-column grid
 * of flat 4:5 PORTRAIT cards (the time-of-day `look`'s surface: white by day, slate at night), each with the document's icon CENTRED in a pastel
 * tile and the title below it (wrapping to two lines, then an ellipsis); the pair is
 * centred vertically in the card.
 *
 *   - CARD SKIN — the `Row`'s (src/components/primitives/Row.tsx): the look's `surface`
 *     face and `line` hairline, 16px radius. Flat, so no rounded edge (that rule is for RAISED objects).
 *   - ICON TILE — the Row avatar scaled up: a 64px `RAMP[hue].mid` square with the
 *     mandatory `markOutline` inset ring (a pastel, so it stays the same at night) (docs/SHELF_REDESIGN.md § D2). The picked icon
 *     (texts."iconId") is drawn inside it; without one, the Row's fallback glyph
 *     (readerDocumentGlyph). Hue and glyph come from readerListOrder.ts — yellow /
 *     `auto_stories` for a journal entry, blue / `description` for the learner's own,
 *     grey / `menu_book` for a built-in — as in the list.
 *   - JOURNAL DATE — a journal entry's card shows its `createdAt` date under the title.
 *   - ⋯ MENU — top-right, on the learner's OWN documents only (a built-in text cannot be
 *     deleted). It holds one item, Delete, which asks the parent to confirm
 *     (`onRequestDelete` → DeleteDocumentDialog on ReaderPage). The swipe gesture of
 *     the list view does not exist here — it does not read on a 2-column grid.
 *
 * DOM note: the ⋯ button is a SIBLING of the card's tap target, not a child — a
 * <button> inside a <button> is invalid HTML and its tap would also open the document.
 *
 * Gutters / gap match the Documents / Journal Bento above it (16px sides, 10px gap) so the
 * grid's two columns line up with those two tiles.
 *
 * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § List views.
 * Layer: feature view (src/features/reader). Rendered by: TextSidebar.tsx.
 */

/** The card radius — the Row's 16px, so both views share one card corner. */
const CARD_RADIUS = "16px";
/** The centred icon tile, and its radius (the Row avatar's 36/12 scaled up). */
const ICON_TILE_PX = 64;
const ICON_TILE_RADIUS = "18px";

interface ReaderDocumentGridProps {
    /** The page's time-of-day look (ReaderPage → useTier2Look). */
    look: Tier2Look;
    texts: Text[];
    onTextSelect: (text: Text) => void;
    /** Delete chosen from a card's ⋯ menu — the parent confirms before deleting. */
    onRequestDelete: (text: Text) => void;
}

function ReaderDocumentGrid({ look, texts, onTextSelect, onRequestDelete }: ReaderDocumentGridProps) {
    // The ⋯ menu is one shared MUI Menu anchored to whichever card's button opened it.
    const [menu, setMenu] = useState<{ anchor: HTMLElement; text: Text } | null>(null);

    return (
        <Box
            className="reader-document-grid"
            sx={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: "10px",
                padding: "13px 16px 0",
            }}
        >
            {texts.map((text) => {
                const hue = readerDocumentHue(text);
                return (
                    <Box className="reader-document-grid__item" key={text.id} sx={{ position: "relative", minWidth: 0 }}>
                        {/* The card itself — the tap target that opens the document. */}
                        <Box
                            component="button"
                            type="button"
                            className="reader-document-grid__card"
                            onClick={() => onTextSelect(text)}
                            sx={{
                                width: "100%",
                                // A 4:5 PORTRAIT cell (owner's call 2026-11-17, after 2:3 and A4 read too tall), so every
                                // card is the same size whatever its title's length.
                                aspectRatio: "4 / 5",
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                // The icon + title group sits in the card's vertical middle.
                                justifyContent: "center",
                                gap: "10px",
                                // Extra top room so a long title never runs under the ⋯.
                                padding: "22px 12px 14px",
                                backgroundColor: look.surface,
                                border: `1px solid ${look.line}`,
                                borderRadius: CARD_RADIUS,
                                cursor: "pointer",
                                font: "inherit",
                                color: "inherit",
                                // Opts out of the ~300ms double-tap-zoom delay.
                                touchAction: "manipulation",
                            }}
                        >
                            <Box
                                className="reader-document-grid__icon-tile"
                                sx={{
                                    width: ICON_TILE_PX,
                                    height: ICON_TILE_PX,
                                    borderRadius: ICON_TILE_RADIUS,
                                    flexShrink: 0,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    backgroundColor: RAMP[hue].mid,
                                    // Mandatory on a pastel mark — see Row.tsx's header note.
                                    boxShadow: `inset 0 0 0 1px ${COLORS.markOutline}`,
                                }}
                            >
                                {text.iconId ? (
                                    <Box
                                        component="img"
                                        className="reader-document-grid__icon-image"
                                        src={iconImageUrl(text.iconId)}
                                        alt=""
                                        // icons8 artwork carries its own padding, hence a
                                        // little larger than the glyph.
                                        sx={{ width: 40, height: 40, objectFit: "contain", display: "block" }}
                                    />
                                ) : (
                                    <Icon
                                        name={readerDocumentGlyph(text)}
                                        size={30}
                                        color={COLORS.onSurface}
                                    />
                                )}
                            </Box>
                            <Typography
                                className="reader-document-grid__title"
                                sx={{
                                    fontFamily: FONTS.sans,
                                    fontSize: 14.5,
                                    fontWeight: WEIGHT.semibold,
                                    letterSpacing: "-0.01em",
                                    lineHeight: LEADING.tight,
                                    color: look.ink,
                                    textAlign: "center",
                                    width: "100%",
                                    overflowWrap: "anywhere",
                                    // Two lines, then an ellipsis.
                                    display: "-webkit-box",
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: "vertical",
                                    overflow: "hidden",
                                }}
                            >
                                {text.title}
                            </Typography>
                            {/* A journal entry's date (its createdAt), under the title. */}
                            {isJournal(text) && (
                                <Typography
                                    className="reader-document-grid__journal-date"
                                    sx={{
                                        fontFamily: FONTS.sans,
                                        fontSize: SIZE.caption,
                                        color: look.muted,
                                        lineHeight: LEADING.tight,
                                        // The title gives up its space first; the date stays one line.
                                        marginTop: "-4px",
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    {formatJournalDate(text.createdAt)}
                                </Typography>
                            )}
                        </Box>

                        {/* ⋯ — own documents only. */}
                        {text.isUserCreated && (
                            <Box
                                component="button"
                                type="button"
                                className="reader-document-grid__more-button"
                                aria-label={`More actions for ${text.title}`}
                                aria-haspopup="menu"
                                onClick={(e: React.MouseEvent<HTMLElement>) => setMenu({ anchor: e.currentTarget, text })}
                                sx={{
                                    position: "absolute",
                                    top: 4,
                                    right: 4,
                                    width: 32,
                                    height: 32,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    padding: 0,
                                    border: "none",
                                    borderRadius: "10px",
                                    background: "transparent",
                                    cursor: "pointer",
                                    touchAction: "manipulation",
                                }}
                            >
                                <Icon name="more_horiz" size={20} color={look.ink2} />
                            </Box>
                        )}
                    </Box>
                );
            })}

            {/* The card ⋯ menu — flat Reader look (readerStyles.ts): the look's surface, hairline, no elevation. */}
            <Menu
                className="reader-document-grid__menu"
                anchorEl={menu?.anchor ?? null}
                open={menu !== null}
                onClose={() => setMenu(null)}
                anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                transformOrigin={{ vertical: "top", horizontal: "right" }}
                slotProps={{
                    paper: { elevation: 0, sx: { ...readerMenuPaperSx(look), minWidth: 148 } },
                }}
            >
                <MenuItem
                    className="reader-document-grid__menu-delete"
                    onClick={() => {
                        const target = menu?.text;
                        setMenu(null);
                        if (target) onRequestDelete(target);
                    }}
                    sx={{ gap: "10px", py: 1.25 }}
                >
                    {/* dangerInk is plain ink in v2, so the look's ink (light at night). */}
                    <Icon name="delete" size={19} color={look.ink} />
                    <Typography
                        className="reader-document-grid__menu-delete-label"
                        sx={{ fontFamily: FONTS.sans, fontSize: SIZE.body, fontWeight: WEIGHT.medium, color: look.ink }}
                    >
                        Delete
                    </Typography>
                </MenuItem>
            </Menu>
        </Box>
    );
}

export default ReaderDocumentGrid;
