import { Box, Typography } from "@mui/material";
import Icon from "../../components/Icon";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { WEIGHT } from "../../theme/scale";
import { collectionGlyph } from "./collectionGlyph";
import { collectionPath } from "./collectionRef";
import type { BuiltinCollectionEntry } from "./builtinCollections";

/**
 * `LibraryDuo` — the design's `.duo` (artboard 2): the decks sheet opens on the
 * learner's two CONSTANTS, side by side, each carrying its figure.
 *
 * ── Why these two are not spines (a narrowing of D9) ──────────────────────────
 * D9 says the spine replaces the tile as the single visual for a set of cards, and it
 * still governs decks, challenges and bands. These two are the exception the artboard
 * makes, and the reason is what the surface is for rather than a change of mind:
 *
 *   Learn Now and Mastered are the only two sets whose SIZE is the thing the learner
 *   came to read. Every other shelf answers "which set?" and encodes its count as the
 *   spine's height — a comparison between neighbours, which is exactly right for a row
 *   of six decks. These two have no neighbours to be compared against; "612" and "208"
 *   are the figures, and a 74px spine cannot print a figure at a size worth reading.
 *
 * So they keep the shelf's MATERIAL and drop its geometry: same single pastel, same
 * inset white highlight, same dark strap down the left edge, same bottom-heavy corner
 * radius — a spine laid on its side and opened up far enough to hold a number. The
 * sheet still reads as one system; it just does not pretend a stat block is a spine.
 *
 * Rendered by `DecksPanelBody`, so all three of its hosts get it: the fdp sheet (lens
 * `core`) and the two Mastery Centers (lens `reading` / `writing`). The pair is
 * whatever `lensCollectionEntries` returns for the lens, so a Center's duo names that
 * skill's two sets rather than the core ones.
 *
 * ⚠️ The artboard prints "+17 this week" under Mastered. The app has no such figure —
 * `masteredAt` (migration 142) makes it derivable but no endpoint exposes it — so the
 * caption says what the set IS instead of how it moved. Tracked in
 * docs/DEFERRED_WORK.md; do not fake the delta from the client's own counts.
 *
 * Referenced by docs/SHELF_REDESIGN.md (entry 2, artboard 2) and docs/DECKS_FEATURE.md.
 */

/**
 * Sub-caption per collection kind. Says what the set is, in the artboard's own words
 * where it had them. Keyed on the ref's `kind`, not on the label, so a Center's
 * "Mastered Reading" tile picks up the same line as the core one.
 */
const SUBTITLES: Record<string, string> = {
    "learn-now": "Everything in rotation",
    mastered: "Finished — resting",
};

export interface LibraryDuoProps {
    /** The lens's two built-in collections, in display order (`lensCollectionEntries`). */
    entries: BuiltinCollectionEntry[];
    /** Figure for one tile; undefined while its count is still loading. */
    count: (entry: BuiltinCollectionEntry) => number | undefined;
    onOpenPath: (path: string) => void;
    /**
     * The sheet's grabber-drag binder. Spread onto the block so a vertical drag started
     * on a tile resizes the sheet like the grabber does — the duo is the first thing
     * under the grabber, so it is the most likely place for that drag to start.
     */
    headerDragBind?: () => Record<string, unknown>;
    className?: string;
}

export const LibraryDuo: React.FC<LibraryDuoProps> = ({
    entries,
    count,
    onOpenPath,
    headerDragBind,
    className,
}) => (
    <Box
        className={className ? `library-duo ${className}` : "library-duo"}
        {...(headerDragBind?.() ?? {})}
        sx={{ display: "flex", gap: "10px", padding: "11px 22px 0", width: "100%" }}
    >
        {entries.map((entry) => {
            const figure = count(entry);
            return (
                <Box
                    key={entry.key}
                    component="button"
                    type="button"
                    className={`library-duo__tile library-duo__tile--${entry.key}`}
                    onClick={() => onOpenPath(collectionPath(entry.ref))}
                    sx={{
                        position: "relative",
                        flex: 1,
                        minWidth: 0,
                        textAlign: "left",
                        border: "none",
                        cursor: "pointer",
                        backgroundColor: entry.colors.main,
                        // Bottom-heavy radius + the strap below: the spine's silhouette,
                        // turned on its side. See the header comment.
                        borderRadius: "14px 14px 5px 5px",
                        padding: "12px 13px 11px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "2px",
                        overflow: "hidden",
                        boxShadow: [
                            "2px 3px 9px rgba(20,18,26,0.14)",
                            "inset -6px 0 12px rgba(255,255,255,0.35)",
                            "inset 0 0 0 1px rgba(23,22,26,0.05)",
                        ].join(", "),
                        // The strap — the shelf's own darkened spine edge.
                        "&::after": {
                            content: '""',
                            position: "absolute",
                            left: 0,
                            top: 0,
                            bottom: 0,
                            width: "4px",
                            borderRadius: "14px 0 0 5px",
                            backgroundColor: "rgba(23,22,26,0.14)",
                        },
                    }}
                >
                    <Box className="library-duo__head" sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
                        <Typography
                            component="b"
                            className="library-duo__label"
                            sx={{
                                fontFamily: FONTS.sans,
                                fontSize: 15,
                                fontWeight: WEIGHT.bold,
                                letterSpacing: "-0.022em",
                                color: COLORS.onSurface,
                                minWidth: 0,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                            }}
                        >
                            {entry.label}
                        </Typography>
                        <Icon name={collectionGlyph(entry.ref)} size={17} sx={{ opacity: 0.65, flexShrink: 0 }} />
                    </Box>
                    <Typography
                        className="library-duo__figure"
                        sx={{
                            fontFamily: FONTS.sans,
                            fontSize: 31,
                            fontWeight: 800,
                            letterSpacing: "-0.04em",
                            lineHeight: 1.05,
                            marginTop: "5px",
                            color: COLORS.onSurface,
                            // An em dash while the count is in flight, not a 0 and not a
                            // spinner: 0 is a real answer this tile could legitimately
                            // give, so showing it before the fetch lands is a lie that
                            // corrects itself, and a spinner in a 31px slot reflows the
                            // whole tile when it resolves.
                            fontVariantNumeric: "tabular-nums",
                        }}
                    >
                        {figure === undefined ? "—" : figure.toLocaleString()}
                    </Typography>
                    <Typography
                        className="library-duo__sub"
                        sx={{ fontSize: 11, lineHeight: 1.35, color: COLORS.iconColor }}
                    >
                        {SUBTITLES[entry.ref.kind] ?? ""}
                    </Typography>
                </Box>
            );
        })}
    </Box>
);

export default LibraryDuo;
