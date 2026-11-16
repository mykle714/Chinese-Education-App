/**
 * keyboardColors — the beginner keyboard's chrome colours: the standard grey keyboard,
 * on every page and at every time of day.
 *
 * LAYER: client feature constants. Plain `COLORS` tokens under keyboard-role names, so
 * the four surfaces that draw keyboard chrome agree on what "a key" or "the ground" is.
 *
 * NOT THEMED (owner, 2026-11-15). The keyboard used to borrow a Tier 2 page's time-of-day
 * look over the Dictionary (sky tint by day, slate at night, via `tier2Var`), § 6z-11.
 * That was removed: the keyboard is one consistent grey object everywhere. Its only
 * colour signals are content and mode — the ā pad's vowel ramp hues and the candidate
 * row's gold / blue mode grounds (org mid — the friend-code card's gold — and blu mid, the 写 switch key's face) — neither of which lives here.
 *
 * Read by: BeginnerKeyboard, ComponentBuffer, KeyboardSwitchBar, PinyinToneKeyboard,
 * CandidateRow, keycapStyle.
 * Docs: docs/BEGINNER_KEYBOARD.md § 6z-11, § 6z-12 (the keycap look).
 */
import { COLORS } from '../../theme';

export const KEYBOARD_COLORS = {
  /** The keyboard surface and the switch bar. */
  ground: COLORS.header,
  /** A white key's face (every utility key, parts chip and switch key — keycapStyle.ts). */
  key: COLORS.white,
  /** A raised key's drop lip. */
  keyEdge: COLORS.grey,
  /** Every key's 1px outline, and the keyboard's top rule. */
  outline: COLORS.border,
  /** Glyphs: primary, icons, muted labels, and the faintest caption (the buffer's "Parts"). */
  ink: COLORS.onSurface,
  ink2: COLORS.iconColor,
  muted: COLORS.textSecondary,
  faint: COLORS.textFaint,
} as const;
