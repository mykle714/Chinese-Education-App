import { Box, Typography } from "@mui/material";
import Icon from "../../components/Icon";
import { COLORS, RAMP } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { WEIGHT } from "../../theme/scale";
import { SHADOW } from "../../theme/shadows";
import { collectionGlyph } from "./collectionGlyph";
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
 * ── Why they are the CENTERS RAIL's object, not their own ─────────────────────
 * They are now built from exactly the material the fdp's Reading / Writing tiles use
 * (`flashcards-decks__center-tile`, FlashcardsDecksPage): the hand's hairline border
 * and RESTING elevation, a 15px radius, `13px 13px 14px` of padding, a 19px glyph at
 * 0.72 opacity on its own line, and the same 9px gap between the pair. The two rails
 * sit a thumb's width apart on the same screen — the duo at the top of the sheet, the
 * Centers just above it — so two different pastel-rectangle idioms read as two
 * different KINDS of destination when they are in fact the same kind: a place to go
 * look at a set of cards. One object, one material.
 *
 * The one thing the duo adds is the FIGURE, which is the reason above. It is
 * RIGHT-ADJUSTED on the label's line: the label grows leftward from a fixed edge and
 * the number ends at the tile's right margin, so both counts land on one vertical
 * rule and can be compared at a glance without the eye hunting for where each one
 * starts. (A figure under a left-aligned label put the two numbers at different x
 * positions the moment the labels differed in length.)
 *
 * ── They are FILTERS, not links ───────────────────────────────────────────────
 * A tile narrows the panel's own card grid to that set; it does not navigate. The
 * collection PAGES still exist and their routes still work — the Games hub links to
 * them — but reaching one from here cost a navigation to see a grid the panel was
 * already holding in memory, under a search box and a sort menu it also already had.
 *
 * The pair therefore behaves as a two-button toggle group over `CardsFilter`:
 * tapping the active tile returns to `"all"`, so there is no state the learner can be
 * stuck in and no third "clear" control to find. `aria-pressed` says so to a screen
 * reader, which is why these stayed `<button>`s rather than becoming links.
 *
 * ── Saying which one is on ────────────────────────────────────────────────────
 * A 93% pastel cannot carry "active" on its own — the four fills are ~1.15:1 against
 * the paper and the difference between two of them is not a state change anyone will
 * notice. So the active tile takes its hue's SATURATED INK (`RAMP[entry.hue].ink`, the
 * reason an entry carries a hue key at all): a 2px ring of it, its glyph and its
 * figure in it. And the OTHER tile drops from the 93% fill to the 97.5% tint, so the
 * pair separates on two channels at once — the on tile gains ink, the off tile loses
 * colour — rather than asking the eye to compare two near-white rectangles.
 *
 * Rendered by `DecksPanelBody`, so all three of its hosts get it: the fdp sheet (lens
 * `core`) and the two Mastery Centers (lens `reading` / `writing`). The pair is
 * whatever `lensCollectionEntries` returns for the lens, so a Center's duo names that
 * skill's two sets rather than the core ones.
 *
 * ⚠️ The artboard prints "+17 this week" under Mastered. The app has no such figure —
 * `masteredAt` (migration 142) makes it derivable but no endpoint exposes it — and the
 * tile now carries NO sub-caption at all (label + figure only), so there is no line to
 * put it on. Tracked in docs/DEFERRED_WORK.md; do not fake the delta from the client's
 * own counts.
 *
 * Referenced by docs/SHELF_REDESIGN.md (entry 2, artboard 2) and docs/DECKS_FEATURE.md.
 */

export interface LibraryDuoProps {
    /** The lens's two built-in collections, in display order (`lensCollectionEntries`). */
    entries: BuiltinCollectionEntry[];
    /** Figure for one tile; undefined while its count is still loading. */
    count: (entry: BuiltinCollectionEntry) => number | undefined;
    /** `key` of the entry currently filtering the grid, or null when none is. */
    activeKey?: string | null;
    /** Turn a tile's filter on, or off again when it is the active one. */
    onToggle: (entry: BuiltinCollectionEntry) => void;
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
    activeKey = null,
    onToggle,
    headerDragBind,
    className,
}) => (
    <Box
        className={className ? `library-duo ${className}` : "library-duo"}
        {...(headerDragBind?.() ?? {})}
        // 9px between the pair — the Centers rail's gap, not a second one.
        sx={{ display: "flex", gap: "9px", padding: "11px 22px 0", width: "100%" }}
    >
        {entries.map((entry) => {
            const figure = count(entry);
            const hue = RAMP[entry.hue];
            const isActive = activeKey === entry.key;
            // "Some OTHER tile is on." The off tile is only muted while a filter is
            // actually running; with no filter both tiles sit at their normal fill.
            const isMuted = activeKey !== null && !isActive;
            return (
                <Box
                    key={entry.key}
                    component="button"
                    type="button"
                    className={[
                        "library-duo__tile",
                        `library-duo__tile--${entry.key}`,
                        isActive ? "library-duo__tile--active" : "",
                    ].filter(Boolean).join(" ")}
                    aria-pressed={isActive}
                    onClick={() => onToggle(entry)}
                    sx={{
                        flex: 1,
                        minWidth: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: "9px",
                        alignItems: "stretch",
                        textAlign: "left",
                        // ── The Centers rail's tile, verbatim ──────────────────────
                        // hairline + resting elevation + 15px radius + 13/13/14
                        // padding. Kept in sync with `flashcards-decks__center-tile`
                        // in FlashcardsDecksPage: these are the same kind of object
                        // (a place to go look at a set), so they are the same object.
                        cursor: "pointer",
                        borderRadius: "15px",
                        // The ACTIVE ring is 2px of the hue's ink; the resting border
                        // is the hand's 1px hairline. The padding drops by 1px to
                        // match, so a tile does not grow by 2px when it is switched on
                        // and shove its neighbour's label into an ellipsis.
                        border: isActive ? `2px solid ${hue.ink}` : `1px solid ${COLORS.border}`,
                        padding: isActive ? "12px 12px 13px" : "13px 13px 14px",
                        // Fill: the hue's 93% pastel normally, its 97.5% tint while the
                        // OTHER tile is the one filtering. See the header.
                        backgroundColor: isMuted ? hue.tint : entry.colors.main,
                        // Active tiles also sit UP: the resting elevation plus a soft
                        // halo in the hue's own ink, so "on" is legible at a glance
                        // from across the sheet and not only by reading the border.
                        boxShadow: isActive
                            ? `${SHADOW.cardRest}, 0 0 0 4px ${hue.fill}`
                            : SHADOW.cardRest,
                        // The state change is a filter being applied, so it should read
                        // as one movement rather than four properties landing at once.
                        transition: "background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease",
                    }}
                >
                    <Icon
                        name={collectionGlyph(entry.ref)}
                        size={19}
                        sx={{
                            // Ink at full strength when active — the glyph is the tile's
                            // one non-text mark, so it is the cheapest place to spend a
                            // second signal. Otherwise the Centers rail's 0.72 grey.
                            color: isActive ? hue.ink : undefined,
                            opacity: isActive ? 1 : 0.72,
                            flexShrink: 0,
                        }}
                    />
                    {/* Label and figure share one line, the figure pinned to the tile's
                        right margin so both tiles' counts line up on one rule.
                        `alignItems: baseline` sits the two type sizes on the same
                        baseline rather than centring a 22px figure against a 14.5px
                        label. */}
                    <Box
                        className="library-duo__line"
                        sx={{
                            display: "flex",
                            alignItems: "baseline",
                            justifyContent: "space-between",
                            gap: "8px",
                            minWidth: 0,
                        }}
                    >
                        <Box
                            component="b"
                            className="library-duo__label"
                            sx={{
                                fontFamily: FONTS.sans,
                                fontSize: 14.5,
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
                        </Box>
                        <Typography
                            component="span"
                            className="library-duo__figure"
                            sx={{
                                fontFamily: FONTS.sans,
                                fontSize: 22,
                                fontWeight: 800,
                                letterSpacing: "-0.035em",
                                lineHeight: 1,
                                // The figure carries the hue's ink while active: it is
                                // the number the filter is about.
                                color: isActive ? hue.ink : COLORS.onSurface,
                                flexShrink: 0,
                                // Tabular figures so a count changing from 99 to 100
                                // does not re-space the ones already on screen.
                                fontVariantNumeric: "tabular-nums",
                            }}
                        >
                            {/* An em dash while the count is in flight, not a 0 and not
                                a spinner: 0 is a real answer this tile could legitimately
                                give, so showing it before the fetch lands is a lie that
                                corrects itself, and a spinner in this slot reflows the
                                line when it resolves. */}
                            {figure === undefined ? "\u2014" : figure.toLocaleString()}
                        </Typography>
                    </Box>
                </Box>
            );
        })}
    </Box>
);

export default LibraryDuo;
