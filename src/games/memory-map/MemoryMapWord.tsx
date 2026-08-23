import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import ForeignText from "../../components/ForeignText";
import { wordBoxSize, type TouchedSides } from "../../../server/services/memoryMapSpawn";
import type { MemoryMapWord as MemoryMapWordData } from "../../api/memoryMap";
import type { WordOutcome } from "./types";
import { COLORS } from "../../theme/colors";
import { PIXELS_PER_WORLD_UNIT } from "./constants";
import { useTapGesture } from "./useTapGesture";

/**
 * One word on the map (docs/MEMORY_MAP_GAME.md § 2.3, § 3.3).
 *
 * ── THE BOX IS AUTHORITATIVE, THE TEXT CONFORMS ──────────────────────────────
 * Its size comes from `wordBoxSize` — the SAME function the server placed it with —
 * not from the rendered text's natural width. That is what keeps tangent neighbours
 * actually tangent: if this drew at its natural width, every word whose real font
 * metrics disagreed with the estimate would visibly overlap or float away from the
 * island it is supposed to belong to.
 *
 * The text is therefore centred inside a fixed box and MEASURED-AND-SCALED to fit,
 * rather than the box being sized around the text.
 *
 * ── PARCELS AND FENCES ───────────────────────────────────────────────────────
 * The box is drawn: a white parcel on the blue water, with a border only on the edges
 * it SHARES with a neighbour (`borders`, from `touchedSidesForAll`). Tangent boxes abut
 * exactly, so an island's words sit shoulder to shoulder with their boundaries visible
 * and its coastline open to the water — which is what the tangent placement was always
 * for. All four corners are rounded (CORNER_RADIUS_PX), which softens the tiles at the
 * cost of small blue lenses at the interior junctions; see that constant.
 *
 * This replaced four corner brackets marking each box's extent. Corners stated the same
 * geometry but drew it twice wherever two words met, and drew it on the coast where
 * there is nothing to divide.
 *
 * ── NO PINYIN ON THE MAP, EVER ───────────────────────────────────────────────
 * `showPinyin={false}` is not a style choice — it is the game, and it matters MORE now
 * that the prompt bar shows the target's pronunciation than it did when nothing did.
 * With pinyin on both sides the player could match the prompt's romanization against
 * the map's, letter for letter, and never look at a character at all. The prompt gives
 * the sound; the map must make you find the characters that carry it.
 */

/**
 * Border weight between two abutting words, in world-layer px (the camera scales it).
 *
 * Off the 8px grid on purpose, and the game's ONLY exemption from it — a stroke is not
 * spacing, and an 8px fence between two words would be a wall (see the grid docblock in
 * ./constants).
 */
const BORDER_PX = 1.5;

/**
 * Corner radius, in world-layer px. Applied to ALL FOUR corners of every parcel.
 *
 * This was briefly coastline-only — rounded where a side faced open water, square where
 * it abutted a neighbour — to keep an island's interior seams flush. Owner-settled the
 * other way: round them all.
 *
 * The known consequence, so it is not later "fixed" as a rendering bug: at an interior
 * junction the two rounded parcels no longer meet edge to edge, so a small lens of blue
 * water shows through where their corners pull away from each other. An island therefore
 * reads as a cluster of tiles rather than as one fused landmass. That is a look, not a
 * fault — the geometry underneath is unchanged and the boxes are still exactly tangent.
 */
const CORNER_RADIUS_PX = 8;

/**
 * Weight of the ring drawn around the SELECTED word, in world-layer px.
 *
 * Heavier than a fence (BORDER_PX) because it has to be findable at MIN_ZOOM — the ring
 * is the only thing standing between a stray touch and a wrong answer, so it must not
 * be something the player has to squint for. Drawn as a box-shadow rather than a border
 * so it costs the parcel no layout: a border would have to eat into the box (hiding a
 * shared fence) or grow it (pushing tangent neighbours apart).
 */
const SELECT_RING_PX = 3;

/**
 * How much of the box the glyphs fill, on whichever axis binds first.
 *
 * The remainder is the word's margin inside its own parcel — without it, characters
 * would run right up to the fences they share with their neighbours.
 *
 * This IS the fill fraction, so it is the direct lever for "the text looks small". It
 * was not the only cause of that, though: see the ForeignText call below, where a
 * reserved pinyin row was inflating the measured height and costing far more than this
 * constant ever did.
 */
const TEXT_FIT = 0.92;

interface MemoryMapWordProps {
    word: MemoryMapWordData;
    /** Which edges this word shares with a neighbour — the only edges that get a line. */
    borders: TouchedSides;
    /** The colour it has earned this run, or undefined while still uncoloured. */
    outcome?: WordOutcome;
    /** True for the failed target: it pulses until tapped (§ 3.3). */
    pulsing: boolean;
    /** True for the word the player has armed but not yet committed (§ 3.3a). */
    selected: boolean;
    /** True for a word that just took a wrong tap — a brief red flash. */
    flashing: boolean;
    /** True while it dissolves off the map after graduating (§ 3.6). */
    fading: boolean;
    onTap: (word: MemoryMapWordData) => void;
}

/** Hue per outcome. Hue ALONE carries the result — no icons, no patterns (Q23). */
const OUTCOME_COLOR: Record<WordOutcome, string> = {
    green: COLORS.successInk,
    orange: COLORS.warnInk,
    red: COLORS.dangerInk,
};

const MemoryMapWord: React.FC<MemoryMapWordProps> = ({
    word,
    borders,
    outcome,
    pulsing,
    selected,
    flashing,
    fading,
    onTap,
}) => {
    const box = wordBoxSize(word.entryKey, word.scale, word.language);
    const widthPx = box.width * PIXELS_PER_WORLD_UNIT;
    const heightPx = box.height * PIXELS_PER_WORLD_UNIT;
    /**
     * Shrink the glyphs to fit inside the box.
     *
     * NECESSARY, not cosmetic: the box is sized by `wordBoxSize` (~40px per Chinese
     * glyph at scale 1) while ForeignText renders its `md` preset at a 50px column —
     * roughly 25% wider. With a transparent background that overflow was invisible;
     * now that each word sits on a white parcel with fences on its shared edges, text
     * would visibly spill across its neighbours.
     *
     * MEASURED rather than derived from CPCDRow's constants, because those are private
     * to that component and differ again for Latin script. `offsetWidth`/`offsetHeight`
     * are LAYOUT values and ignore CSS transforms, so neither the camera's zoom nor the
     * scale applied here feeds back into the measurement.
     *
     * This is the same principle as the whole feature: geometry is authoritative and
     * typography conforms to it.
     */
    const glyphRef = useRef<HTMLDivElement | null>(null);
    const [textScale, setTextScale] = useState(1);

    useLayoutEffect(() => {
        const el = glyphRef.current;
        if (!el) return;
        const naturalWidth = el.offsetWidth;
        const naturalHeight = el.offsetHeight;
        if (naturalWidth === 0 || naturalHeight === 0) return;
        setTextScale(
            Math.min(
                (widthPx * TEXT_FIT) / naturalWidth,
                (heightPx * TEXT_FIT) / naturalHeight
            )
        );
    }, [word.entryKey, widthPx, heightPx]);

    // A flash overrides the resting colour so a wrong tap is legible even on a word
    // that already wears one — though in practice only uncoloured words can be hit.
    const color = flashing ? COLORS.dangerInk : outcome ? OUTCOME_COLOR[outcome] : COLORS.onSurface;

    // Fences are drawn in a neutral line colour rather than the word's hue: a boundary
    // belongs to BOTH parcels, so colouring it by one of them would make an answered
    // word appear to claim its neighbour's edge.
    const fence = `${BORDER_PX}px solid ${COLORS.rowBorder}`;

    const tap = useTapGesture(
        useCallback(
            (event: React.PointerEvent) => {
                // Stop the tap reaching the world layer, which reads a pointer on open
                // water as "deselect" (§ 3.3a) and treats a drag there as a pan.
                event.stopPropagation();
                onTap(word);
            },
            [onTap, word]
        )
    );

    return (
        <Box
            className={[
                "memory-map-word",
                `memory-map-word--${outcome ?? "unanswered"}`,
                selected ? "memory-map-word--selected" : "",
                pulsing ? "memory-map-word--pulsing" : "",
                fading ? "memory-map-word--fading" : "",
            ]
                .filter(Boolean)
                .join(" ")}
            // ── A PAN THAT CROSSES A WORD IS NOT A TAP ON IT ────────────────
            // On a dense map most drags START on a word, and a bare onPointerUp
            // handler fires for every one of them — so panning across the board
            // answered the prompt (wrongly) with whatever word happened to be under
            // the finger. `useTapGesture` records the press position and only calls
            // back when the pointer barely moved; the world's deselect-on-water tap
            // uses the same hook, so the two ends cannot drift apart.
            {...tap}
            sx={{
                position: "absolute",
                // World coordinates are the box CENTRE, so the node is offset by half
                // its own size rather than positioned from a corner.
                left: word.x * PIXELS_PER_WORLD_UNIT - widthPx / 2,
                top: word.y * PIXELS_PER_WORLD_UNIT - heightPx / 2,
                width: widthPx,
                height: heightPx,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                // ── LAND ─────────────────────────────────────────────────────
                // A white parcel on the blue water. Tangent boxes share edges exactly,
                // so a whole island fuses into one continuous landmass rather than a
                // scatter of cards — which is the entire reason the boxes are placed
                // tangent in the first place.
                //
                backgroundColor: COLORS.background,
                // ── FENCES ───────────────────────────────────────────────────
                // A line ONLY where this word actually abuts a neighbour. The coastline
                // stays open to the water, and because both boxes in a pair draw their
                // shared edge the seam sits exactly on the boundary.
                borderTop: borders.top ? fence : undefined,
                borderRight: borders.right ? fence : undefined,
                borderBottom: borders.bottom ? fence : undefined,
                borderLeft: borders.left ? fence : undefined,
                // All four corners, interior junctions included (see CORNER_RADIUS_PX).
                borderRadius: `${CORNER_RADIUS_PX}px`,
                // Borders must not grow the parcel, or fenced words would push their
                // neighbours apart and open gaps along every shared edge.
                boxSizing: "border-box",
                // The map owns its gestures; the browser must not pan or zoom for us.
                touchAction: "none",
                // Colour transitions are what make an answer feel like it landed.
                transition: "opacity 0.6s ease, filter 0.3s ease",
                opacity: fading ? 0 : 1,
                // Fading words are on their way out and must not accept another tap.
                pointerEvents: fading ? "none" : "auto",
                // ── THE ARMED RING ───────────────────────────────────────────
                // The first tap does not answer; it ARMS the word, and this ring is the
                // whole affordance for that (§ 3.3a). Deliberately BLUE rather than any
                // of the three outcome hues: green/orange/red are results, and a word
                // that is merely selected has no result yet — borrowing one of those
                // colours would say the answer had already been graded.
                //
                // Outside the box (`0 0 0 Npx`, no inset) so it never covers a shared
                // fence, and lifted above the neighbours it abuts so half the ring is
                // not painted over by whichever parcel renders after it.
                boxShadow: selected ? `0 0 0 ${SELECT_RING_PX}px ${COLORS.infoInk}` : "none",
                zIndex: selected ? 2 : undefined,
                "&.memory-map-word--pulsing": {
                    animation: "memory-map-pulse 1.1s ease-in-out infinite",
                },
                "@keyframes memory-map-pulse": {
                    // Glow rather than scale: scaling would make a word overlap the
                    // neighbours it was carefully placed tangent to.
                    "0%, 100%": { filter: `drop-shadow(0 0 2px ${COLORS.dangerInk})` },
                    "50%": { filter: `drop-shadow(0 0 12px ${COLORS.dangerInk})` },
                },
            }}
        >
            <Box
                className="memory-map-word__glyphs"
                ref={glyphRef}
                sx={{
                    transform: `scale(${textScale})`,
                    transformOrigin: "center",
                    pointerEvents: "none",
                    // Measured at its natural size, so it must not be laid out inside the
                    // box's constraints — otherwise the box would clamp the measurement
                    // and the fit would converge on the wrong number.
                    whiteSpace: "nowrap",
                    // ── WHY THE GLYPH CELLS ARE UNPADDED HERE ────────────────
                    // CPCDRow gives every character cell an ASYMMETRIC vertical padding:
                    // 8px on top (VERTICAL_PADDING at `md`) and, once the pinyin row is
                    // gone, 0 on the bottom. Flex-centring centres the padded BOX, so the
                    // glyph inside it sits 8px low — and the fit measurement counts that
                    // padding as text, shrinking the characters to pay for empty space.
                    //
                    // Dropping both paddings makes the measured box the line box, which
                    // IS symmetric about the glyph (line-height distributes its leading
                    // evenly), so centring the box centres the character. The padding is
                    // CPCDRow's own inter-row breathing room and has no job inside a
                    // single-word parcel that supplies its own margin via TEXT_FIT.
                    "& .cpcd-row__char-cell": { paddingTop: 0, paddingBottom: 0 },
                }}
            >
                {/* NO `pronunciation` PROP, and that is load-bearing rather than tidy.
                    CPCDRow reserves vertical space for the pinyin row whenever an item
                    HAS a pinyin — even with showPinyin={false} — so that toggling pinyin
                    visibility doesn't shift surrounding layout. Passing it here bought us
                    22px of invisible padding under every glyph at `md`, which the fit
                    measurement below dutifully counted: the text came out filling barely
                    half its parcel's height, and sat high in it because the padding hung
                    off the bottom. The map never shows pinyin, so it simply must not be
                    handed any. `showPinyin={false}` stays as a belt-and-braces guard. */}
                <ForeignText
                    text={word.entryKey}
                    language={word.language as never}
                    size="md"
                    // The whole point of a reading drill (see the docblock).
                    showPinyin={false}
                    bold
                    characterColor={color}
                />
            </Box>
        </Box>
    );
};

export default MemoryMapWord;
