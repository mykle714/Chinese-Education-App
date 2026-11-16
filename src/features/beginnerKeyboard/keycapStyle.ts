/**
 * keycapStyle — the beginner keyboard's one raised-keycap look, shared by every key it draws.
 *
 * LAYER: client feature constants / sx builders. No state, no DOM.
 *
 * Originally private to the ā pad (PinyinToneKeyboard → artboard "Dictionary · keyboard,
 * pinyin mode"); lifted here 2026-11-15 when the 写 surface and the switch bar were
 * restyled to match it (owner's request), so that every key on the keyboard — vowel,
 * utility, ink key, parts chip, candidate chip, switch key — stands on the same lip and
 * makes the same press.
 *
 * A key is: a face, the 1px outline ring (CLAUDE.md § Buttons & cards) drawn as an INSET
 * shadow so it never changes the key's box, the hairline rounded edge just inside it
 * (theme/roundedEdge.ts, straight-lip form), and a solid KEY_LIP-px lip beneath. Held, it
 * snaps down onto the lip (theme/keycapPress.ts) — no transition.
 *
 * ⚠️ THE LIP PAINTS OUTSIDE THE KEY'S BOX. A key inside an `overflow` container needs
 * KEY_LIP px of room below it, or the lip is clipped and the key looks flat
 * (CandidateRow's scroller pads its bottom for exactly this).
 *
 * Read by: PinyinToneKeyboard, BeginnerKeyboard (ink keys), ComponentBuffer (parts chips),
 * CandidateRow (candidate chips + scroll arrows), KeyboardSwitchBar (switch + close keys).
 * Docs: docs/BEGINNER_KEYBOARD.md § 6z-12 (the keycap look).
 */
import { RAMP, type RampHue } from '../../theme/colors';
import { keycapPressSx } from '../../theme/keycapPress';
import { roundedEdgeFilletDown, roundedEdgeRimLightTop } from '../../theme/roundedEdge';
import { KEYBOARD_COLORS } from './keyboardColors';

/** The keycap's bottom lip in px — the "raised key" read, the same 3px the artboard uses. */
export const KEY_LIP = 3;

/**
 * SHOWN aspect ratios — the key as the eye reads it, face PLUS the KEY_LIP beneath it.
 *
 * A raised key's lip paints below its box (see ⚠️ above), so a 42×28 face looks 42×31.
 * When the owner asks for a key "at 3 : 2" they mean the shape they see, so these two
 * helpers solve for the missing side with the lip counted in. `aspect` is always
 * width ÷ shown height: 3/2 is landscape, 2/3 portrait. A LATCHED key (latchedKeySx)
 * has no lip, so it shows its bare face and reads a little flatter than its neighbours.
 *
 * Read by: KeyboardSwitchBar (switch + close keys), CandidateRow (scroll arrows).
 */
/** The face width that makes a key of this face height SHOW `aspect` once its lip is added. */
export const keyWidthForShownAspect = (faceHeight: number, aspect: number) => (faceHeight + KEY_LIP) * aspect;

/** The face height that makes a key this wide SHOW `aspect` once its lip is added. */
export const keyFaceHeightForShownAspect = (width: number, aspect: number) => width / aspect - KEY_LIP;

/**
 * The face of a key that holds one character, px — square. Shared so the 写 surface's
 * keys read as one family (owner, 2026-11-15: "the tool buttons at the bottom are the
 * same size as the char buttons"). Read by CandidateRow (candidate chips; a multi-glyph
 * chip grows wider) and BeginnerKeyboard (the Clear / Undo / Redo ink keys).
 * Docs: docs/BEGINNER_KEYBOARD.md § 6z-12.
 */
export const CHAR_KEY_FACE = 38;

/** Every keyboard key's corner radius (artboard `.tp` keys). */
export const KEY_RADIUS = '9px';

/**
 * The resting shadow: outline ring, rim light, fillet, lip. `ringPx` is the outline's
 * width — 2 for the candidate row's commit chip, whose heavier ring is its "this
 * commits" signal; 1 everywhere else.
 */
export const keycapShadow = (face: string, lip: string, outline: string = KEYBOARD_COLORS.outline, ringPx = 1) =>
  `inset 0 0 0 ${ringPx}px ${outline}, ${roundedEdgeRimLightTop(face, ringPx)}, ${roundedEdgeFilletDown(face, lip)}, 0 ${KEY_LIP}px 0 ${lip}`;

/** The bottomed-out shadow: the lip is gone, ring + rim light stay. */
const pressedShadow = (face: string, outline: string, ringPx: number) =>
  `inset 0 0 0 ${ringPx}px ${outline}, ${roundedEdgeRimLightTop(face, ringPx)}`;

/** A raised key's resting shadow + the app's snap press. Spread into the key's `sx`. */
export const keyPressSx = (face: string, lip: string, outline: string = KEYBOARD_COLORS.outline, ringPx = 1) =>
  keycapPressSx({
    restShadow: keycapShadow(face, lip, outline, ringPx),
    pressedShadow: pressedShadow(face, outline, ringPx),
    pressedY: KEY_LIP,
  });

/**
 * A key LATCHED down — resting where a pressed key sits (no lip, sunk KEY_LIP px). The
 * switch bar draws the keyboard currently on screen this way: it is the key you already
 * pressed. Tapping it again is a no-op, so it carries no press of its own.
 */
export const latchedKeySx = (face: string, outline: string = KEYBOARD_COLORS.outline) =>
  ({
    transform: `translateY(${KEY_LIP}px)`,
    boxShadow: pressedShadow(face, outline, 1),
    transition: 'none',
  }) as const;

/**
 * The white utility key: face, lip and outline from the keyboard chrome. Used by the ā
 * pad's ⌫ / ← → / action keys, the 写 ink keys, the parts chips and the switch bar.
 */
export const whiteKeySx = () => ({
  border: 'none',
  borderRadius: KEY_RADIUS,
  backgroundColor: KEYBOARD_COLORS.key,
  cursor: 'pointer',
  ...keyPressSx(KEYBOARD_COLORS.key, KEYBOARD_COLORS.keyEdge),
});

/**
 * A hued key: the ramp's MID tier for the face (the bento tiles' fill — the Friends
 * page's Send / Accept / Remove tiles are blu / grn / red mids) on its MARK tier for the
 * lip. Used by the switch bar's destination keys: 写 blu, ā grn, abc red (the close key
 * is a plain white key). The ā vowel keys use the
 * paler SURFACE face instead, so a key that types reads differently from one that
 * switches.
 */
export const hueKeySx = (hue: RampHue) => ({
  border: 'none',
  borderRadius: KEY_RADIUS,
  backgroundColor: RAMP[hue].mid,
  cursor: 'pointer',
  ...keyPressSx(RAMP[hue].mid, RAMP[hue].mark),
});
