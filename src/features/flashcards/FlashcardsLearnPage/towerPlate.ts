import { SHADOW } from "../../../theme/shadows";
import { COLORS } from "../../../theme/colors";
import { WEIGHT } from "../../../theme/scale";
import { FONTS } from "../../../theme/fonts";
import type { PlateTones } from "./flpTowerHost";

/**
 * towerPlate — the Deck Tower's floor-plate push button, redrawn in HTML for the flp's
 * page-level buttons (`Write it`, `Compare`, `More Info`, and — slab only — the header's
 * audio chip) while the session runs inside the tower (FlpTowerHost; docs/DECK_TOWER.md § "Studying the tower" → "The buttons").
 *
 * The plate in the scene (IsoFloorLabel `raised`, pressed by usePlatePress) is a thin slab
 * in its band's three tones: face on top, walls a shade or two down, a contact shadow under
 * it. It sinks flush when pressed and springs back up with a small overshoot. The study
 * camera looks straight down, so here the slab shows its face and ONE wall — a solid band
 * under the face — and the press is the face sliding down onto where the wall was.
 *
 * Same numbers as the scene's plate so the two read as one control:
 *   - `PLATE_WALL_PX` ≈ the scene plate's `RAISED_HEIGHT` (0.25 world units ≈ 5 px);
 *   - the press is `PRESS_MS` 80 ease-out, the pop `POP_MS` 220 with an ease-out-back
 *     overshoot (usePlatePress.ts → `easeOutBack`, k = 1.6 ≈ the bezier below);
 *   - the print is the plate's: ink, bold, upper-case, tracked out.
 *
 * Pure CSS (`:active`), not usePlatePress: these are ordinary HTML buttons whose click
 * already fires on release, and a rAF-ticked height would re-render the whole flp page.
 * The one behaviour not copied is the plate's "wait to bottom out before firing" — an 80 ms
 * delay on opening a popup or a sheet would only read as lag.
 *
 * No 1px `COLORS.border` outline (the CLAUDE.md "Buttons & cards" rule): like the scene's
 * plate, its edge is its wall and shadow.
 *
 * Layer: feature style (src/features/flashcards). `towerPlateSx` is used by
 * FlashcardsLearnPage.tsx (passed to WordToolsRail `pillSx`) and styled.ts →
 * `MoreInfoPill` (`plate`). `towerPlatePressSx` + `TOWER_PLATE_PRINT` are its two halves,
 * exported for a control that wants only one of them (none does today — the study
 * header's audio chip used both until it became bare text, 2026-10-26).
 */

/** The slab's visible wall, px — the scene plate's RAISED_HEIGHT at the tower's scale. */
export const PLATE_WALL_PX = 5;

/** The press (usePlatePress `PRESS_MS`, ease-out). */
const PRESS_TRANSITION = "80ms cubic-bezier(0, 0, 0.58, 1)";
/** The pop back up (usePlatePress `POP_MS`, ease-out-back ≈ its `easeOutBack`). */
const POP_TRANSITION = "220ms cubic-bezier(0.34, 1.56, 0.64, 1)";

/** Rest: the wall under the face, then the contact shadow. Pressed: flush, no wall, no shadow. */
const restShadow = (tones: PlateTones) => `0 ${PLATE_WALL_PX}px 0 ${tones.right}, ${SHADOW.chip}`;
const pressedShadow = (tones: PlateTones) => `0 0 0 ${tones.right}`;

/**
 * The plate's SLAB alone — fill, wall, contact shadow and the push-down — with none of
 * its print. For a control that keeps its own type but should press like a plate: the
 * study header's audio chip (TowerStudyHeader), which keeps its own grey-tone ink and
 * takes the print separately (`TOWER_PLATE_PRINT`).
 *
 * `baseTransform` is whatever the control already positions itself with (MoreInfoPill
 * is centred by `translateX(-50%)`), so the press composes with it.
 */
export function towerPlatePressSx(tones: PlateTones, baseTransform = "") {
    const at = (y: number) => `${baseTransform} translateY(${y}px)`.trim();
    return {
        backgroundColor: tones.top,
        border: "none",
        transform: at(0),
        boxShadow: restShadow(tones),
        // `opacity` kept for MoreInfoPill's ghost-until-flipped fade.
        transition: `transform ${POP_TRANSITION}, box-shadow ${POP_TRANSITION}, opacity 0.35s ease`,
        "&:active": {
            transform: at(PLATE_WALL_PX),
            boxShadow: pressedShadow(tones),
            transition: `transform ${PRESS_TRANSITION}, box-shadow ${PRESS_TRANSITION}, opacity 0.35s ease`,
            // Belt and braces: an animation would own `transform` and hide the press.
            // (MoreInfoPill's hint pulse is already off for plate pills — styled.ts.)
            animation: "none",
        },
        "@media (prefers-reduced-motion: reduce)": { transition: "none", "&:active": { transition: "none" } },
    } as const;
}

/**
 * The plate's print — ink-set in the UI sans, bold, upper-case, tracked out. Its own
 * fragment so a control that takes only the slab (`towerPlatePressSx`) can still set its
 * type to match the plates: the study header's audio chip.
 */
export const TOWER_PLATE_PRINT = {
    fontFamily: FONTS.sans,
    fontWeight: WEIGHT.bold,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
} as const;

/**
 * The plate's full skin — the slab plus the plate's print — as an sx fragment, layered
 * OVER a pill's own sx (WORD_TOOL_PILL_SX, or MoreInfoPill's base).
 */
export function towerPlateSx(tones: PlateTones, baseTransform = "") {
    return {
        ...towerPlatePressSx(tones, baseTransform),
        ...TOWER_PLATE_PRINT,
        color: COLORS.onSurface,
    } as const;
}

/**
 * The tower session's word-tools rail (`Write it` · `Compare`) at a smaller size than
 * WORD_TOOL_PILL_SX's 11px-padded, 12.5px pill: over the tower the plates sit between
 * the study header and the card, and full-size pills (plus the plate's 5 px wall) read
 * as heavier than the card they caption. Layered after `towerPlateSx` in
 * FlashcardsLearnPage.tsx → `towerPlatePillSx`; NOT applied to `MoreInfoPill`.
 *
 * The glyph is resized through `.ms` because both pills pass a fixed `size` to Icon;
 * the two-class selector outranks Icon's own `fontSize`. Icon clamps `opsz` to ≥ 20,
 * so the smaller glyph keeps the same optical size it had at 17 px.
 *
 * Width: a fixed `TOWER_RAIL_PILL_WIDTH` each instead of WORD_TOOL_PILL_SX's `flex: 1`
 * (which stretches the pair across the card), so the two sit as a centred pair and
 * stay the same width as each other. `Write it` is wrapped in a star Badge whose root is
 * the rail's flex child, so the rail must pin that root too — `TOWER_RAIL_SX`.
 */
export const TOWER_RAIL_PILL_WIDTH = 104;

export const TOWER_RAIL_PILL_SIZE_SX = {
    flex: `0 0 ${TOWER_RAIL_PILL_WIDTH}px`,
    padding: "7px 0",
    gap: "5px",
    fontSize: 11,
    "& .ms": { fontSize: 15 },
} as const;

/**
 * The rail container's half of the tower sizing: pins `Write it`'s Badge root (the
 * rail's own sx stretches it with `flex: 1`) to the same width as `Compare`.
 * Merged into WordToolsRail `sx` by FlashcardsLearnPage.tsx while in the tower.
 */
export const TOWER_RAIL_SX = {
    "& .MuiBadge-root": { flex: `0 0 ${TOWER_RAIL_PILL_WIDTH}px` },
} as const;
