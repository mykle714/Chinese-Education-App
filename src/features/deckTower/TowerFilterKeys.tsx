import { memo } from "react";
import { Box } from "@mui/material";
import Icon from "../../components/Icon";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { WEIGHT } from "../../theme/scale";
import { keycapPressSx } from "../../theme/keycapPress";
import { shadeHex } from "../../theme/shadeHex";
import { bandMaterial } from "./iso";
import { TOWER_DECKS, type TowerDeck } from "./towerDecks";
import { collectionGlyph } from "../flashcards/collectionGlyph";
import type { BuiltinCollectionEntry } from "../flashcards/builtinCollections";

/**
 * TowerFilterKeys — the Learning / Mastered filters on td's cards page
 * (docs/DECK_TOWER.md § "The cards page" → "Controls"): TWO-STATE KEYCAPS, keys that
 * once pressed STAY DOWN until pressed again.
 *
 *   up             the tile on a 5px wall, its cast shadow down-right on the sky
 *   up, held       sunk flush, no wall — the key bottoms out
 *   down (latched) sat 3px down-right on a 2px wall — it filters the grid
 *   down, held     sunk flush
 *
 * ── The wall is DIAGONAL, like the mini cards' card stock (2026-11-06) ──
 * The wall shows below AND to the right of the face — the key's thickness seen from the
 * tower's (1, 1) light, the same extrusion as `sortCardStock` → `panelWall` on the cards
 * grid right under these keys. box-shadow cannot slant, so it is the face's outline stepped
 * 1px at a time along (1, 1), one copy per px of wall, so it stays continuous. Every move
 * (latch, press) runs along that same diagonal, so the face always sinks along its wall.
 *
 * ── The tile (the old Home page's library tiles' shape, retained 2026-11-04) ──
 * 15px radius, `14px 14px 15px` padding, NO outline (dropped 2026-11-06 with the card
 * stock's — the key's edge is its wall and cast shadow, the tower style's rule), the 19px glyph on its own line at 0.72, the bold label with the figure
 * right-adjusted on its baseline, 9px between the pair.
 *
 * ── The COLOUR is the tower's floor plates' ──
 * A pastel `surface` tier washes out on the sky (the reason the plates moved to `mid` —
 * towerDecks.ts → `TowerDeck.band`), so each key is painted exactly like the plate of the
 * same deck: face = `TOWER_DECKS[deck].band` (`yelM` Learning, `bluM` Mastered — blue in
 * EVERY world, like the plate, even where the world's own Mastered hue is green or purple),
 * wall = the plate's right (front) wall (`plateWallSteps.right`, else `bandMaterial`'s),
 * the same face + wall pair the HTML plates draw (theme/towerPlate.ts). A key keeps that
 * colour in both states, so only the latch's HEIGHT says which key is down. Unlike the
 * plates, the keys are not washed for the time of day (the cards page is HTML, like the
 * flp session).
 *
 * ── State ──
 * The latch says "on" — the key sits down — and the latched key's glyph rises to full
 * ink. The keycap's wall + iso cast shadow are the tower's material. The cast shadow is the
 * page's `--tower-cards-ground-shadow` var (set from the sky), so a sky change never
 * re-renders the keys. The press is the app's raised-key press (theme/keycapPress.ts — it
 * snaps; the delegate gives it its minimum held time). The "stayed down" idiom is the
 * eip's Add key's (FlashcardsLearnPage/EipAddKey.tsx).
 *
 * Contract: at most one key down; pressing the down key lifts it (filter back to
 * `"all"`), pressing the other moves the latch across. That is
 * `useCardLibrary` → `toggleCardsFilter`; this file only draws it. `aria-pressed` carries it.
 *
 * Layer: feature page view (src/features/deckTower). Rendered by TowerCardsPage.
 */

/** The wall under an UP key, px. */
const WALL_UP_PX = 5;
/** The wall under a LATCHED key, px — it rests `WALL_UP_PX - WALL_DOWN_PX` lower. */
const WALL_DOWN_PX = 2;
/** How far the cast shadow reaches past an UP key's wall, right and down, px. */
const CAST_REACH_PX = 4;
/** The cast shadow's offset from an UP key's face, on both axes (wall + reach). */
const CAST_PX = WALL_UP_PX + CAST_REACH_PX;
/** The page's ground-shadow var (TowerCardsPage sets it from the sky). */
const GROUND_SHADOW = "var(--tower-cards-ground-shadow)";
/** The key's wall: a face shaded like its plate's right wall (`IsoFloorLabel` `wallSteps`). */
const plateWall = (deck: TowerDeck, face: string) =>
    deck.plateWallSteps ? shadeHex(face, deck.plateWallSteps.right) : bandMaterial(face).right;

/**
 * The key's diagonal wall and cast shadow, with the face `sunk` px down-right of its UP
 * position. The wall is the face's outline stepped 1px along (1, 1), `WALL_UP_PX - sunk`
 * copies (the card stock's `panelWall` technique, sortCardStock.ts). The shadow lies on the
 * ground, so it stays put while the face drops: its offset from the face shrinks by `sunk`
 * on both axes. Flush (`sunk` = WALL_UP_PX) leaves no wall, only the shadow under the face.
 */
const keyShadow = (wall: string, sunk: number) => {
    const wallPx = WALL_UP_PX - sunk;
    const steps = Array.from({ length: wallPx }, (_, i) => `${i + 1}px ${i + 1}px 0 ${wall}`);
    const cast = CAST_PX - sunk;
    return [...steps, `${cast}px ${cast}px 0 ${GROUND_SHADOW}`].join(", ");
};

interface TowerFilterKeysProps {
    /** The lens's two built-in collections, in display order (`useCardLibrary` → `collections`). */
    entries: BuiltinCollectionEntry[];
    /** Figure for one key; undefined while its count is still loading. */
    count: (entry: BuiltinCollectionEntry) => number | undefined;
    /** `key` of the latched entry (the one filtering the grid), or null. */
    activeKey: string | null;
    /** Latch a key, or lift it when it is the latched one (`toggleCardsFilter`). */
    onToggle: (entry: BuiltinCollectionEntry) => void;
}

const TowerFilterKeys = memo(function TowerFilterKeys({ entries, count, activeKey, onToggle }: TowerFilterKeysProps) {
    return (
        <Box
            className="tower-filter-keys"
            role="group"
            aria-label="Filter cards"
            // The bottom padding is the keys' wall + cast shadow, which paint outside the box
            // (they reach CAST_PX right as well; the page's 22px side padding holds that). The
            // gap leaves 3px of sky between the left key's cast shadow and the right key.
            sx={{ display: "flex", gap: `${CAST_PX + 3}px`, pb: `${CAST_PX}px` }}
        >
            {entries.map((entry) => {
                const latched = activeKey === entry.key;
                // The plate of the same deck (see the header).
                const deck = TOWER_DECKS[entry.ref.kind === "mastered" ? "mastered" : "learn-now"];
                // One colour in both states: only HEIGHT says which key is down.
                const face = deck.band;
                const wall = plateWall(deck, face);
                const restSunk = latched ? WALL_UP_PX - WALL_DOWN_PX : 0;
                const figure = count(entry);
                return (
                    <Box
                        key={entry.key}
                        component="button"
                        type="button"
                        className={`tower-filter-keys__key tower-filter-keys__key--${entry.key}${latched ? " tower-filter-keys__key--latched" : ""}`}
                        aria-pressed={latched}
                        onClick={() => onToggle(entry)}
                        sx={{
                            flex: 1,
                            minWidth: 0,
                            display: "flex",
                            flexDirection: "column",
                            gap: "9px",
                            alignItems: "stretch",
                            textAlign: "left",
                            cursor: "pointer",
                            // The tile: radius, padding, fill (see the header). No outline; the
                            // padding carries the old 1px hairline so the content stays put.
                            borderRadius: "15px",
                            border: "none",
                            padding: "14px 14px 15px",
                            backgroundColor: face,
                            color: COLORS.onSurface,
                            fontFamily: FONTS.sans,
                            WebkitTapHighlightColor: "transparent",
                            ...keycapPressSx({
                                restShadow: keyShadow(wall, restSunk),
                                pressedShadow: keyShadow(wall, WALL_UP_PX),
                                // Latch and press both move along the wall's (1, 1) diagonal.
                                restX: restSunk,
                                restY: restSunk,
                                pressedX: WALL_UP_PX,
                                pressedY: WALL_UP_PX,
                            }),
                            // Only the fill eases (the mute); the press itself snaps.
                            transition: "background-color 160ms ease",
                        }}
                    >
                        <Icon
                            name={collectionGlyph(entry.ref)}
                            size={19}
                            className="tower-filter-keys__glyph"
                            sx={{ flexShrink: 0, opacity: latched ? 1 : 0.72 }}
                        />
                        <Box
                            className="tower-filter-keys__line"
                            sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px", minWidth: 0 }}
                        >
                            <Box
                                component="b"
                                className="tower-filter-keys__label"
                                sx={{
                                    fontSize: 14.5,
                                    fontWeight: WEIGHT.bold,
                                    letterSpacing: "-0.022em",
                                    minWidth: 0,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                }}
                            >
                                {entry.label}
                            </Box>
                            <Box
                                component="span"
                                className="tower-filter-keys__figure"
                                sx={{
                                    flexShrink: 0,
                                    fontSize: 22,
                                    fontWeight: 800,
                                    letterSpacing: "-0.035em",
                                    lineHeight: 1,
                                    // Tabular so 99 → 100 does not re-space the line.
                                    fontVariantNumeric: "tabular-nums",
                                }}
                            >
                                {/* An em dash while loading — 0 is a real answer. */}
                                {figure === undefined ? "\u2014" : figure.toLocaleString()}
                            </Box>
                        </Box>
                    </Box>
                );
            })}
        </Box>
    );
});

export default TowerFilterKeys;
