/**
 * keyboardColors — the beginner keyboard's chrome colours, each one a Tier 2 page's
 * time-of-day colour with the keyboard's own default behind it.
 *
 * LAYER: client feature constants. The values are CSS strings
 * (`var(--tier2-…, <default>)`, src/timeOfDay/tier2Chrome.ts → tier2Var): over a Tier 2 page
 * (the Dictionary) the keyboard takes that page's ground, keys and ink — tinted at dawn,
 * day and sunset, slate at night — and everywhere else the variables are unset and it keeps
 * the grey `COLORS.header` surface it always had (owner's choice 2026-10-29: "only on Tier 2
 * pages").
 *
 * Deliberately NOT themed: the vowel keys' ramp colours (content, like a card's tone
 * colours), the handwriting canvas (stays white paper — the stroke ink is dark), and the
 * candidate row's blue/green mode tints (the tint IS the mode signal).
 *
 * Read by: BeginnerKeyboard, ComponentBuffer, KeyboardSwitchBar, PinyinToneKeyboard.
 * Docs: docs/BEGINNER_KEYBOARD.md § 6z-11.
 */
import { COLORS } from '../../theme';
import { tier2Var } from '../../timeOfDay/tier2Chrome';

export const KEYBOARD_COLORS = {
  /** The keyboard surface and the switch bar. */
  ground: tier2Var('ground', COLORS.header),
  /** The switch bar's sunken segment track. */
  well: tier2Var('well', COLORS.card),
  /** A white key / chip, and the active switch segment. */
  key: tier2Var('surface', COLORS.white),
  /** A raised key's drop lip. */
  keyEdge: tier2Var('surfaceEdge', COLORS.grey),
  /** Every key's 1px outline, and the keyboard's top rule. */
  outline: tier2Var('outline', COLORS.border),
  /** A pressed chip's tint. */
  pressed: tier2Var('pressed', COLORS.rowHoverBg),
  /** Glyphs: primary, icons, muted labels. */
  ink: tier2Var('ink', COLORS.onSurface),
  ink2: tier2Var('ink2', COLORS.iconColor),
  muted: tier2Var('muted', COLORS.textSecondary),
} as const;
