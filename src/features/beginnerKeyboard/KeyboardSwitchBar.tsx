/**
 * KeyboardSwitchBar — the one row that lets a learner change keyboards.
 *
 * LAYER: client feature, presentational. It holds no state and knows nothing
 * about fields, carets or the OS; the host decides which keyboard is up and what
 * each control does.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6z-2.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A BAR RATHER THAN A KEY INSIDE THE KEYBOARD
 *
 * `ABC` used to live in the handwriting keyboard's own footer row, which made it
 * a ONE-WAY door: it was reachable only while our keyboard was up, so a learner
 * who took the OS keyboard back had no way to return short of tapping out of the
 * field and back into it. The switch is a property of the FIELD, not of either
 * keyboard, so it now sits in a bar that outlives both — it is the same object in
 * both states, and the close chevron came up with it so that dismissing works
 * identically whichever keyboard is on screen.
 *
 * The toggle shows EVERY destination (写 · ā · abc) rather than flipping one
 * label, so the choice is legible before the learner needs it.
 *
 * THREE RAISED KEYS (restyled 2026-11-15, owner's choice; was a sunken well with one
 * filled segment). Each destination is its own hued keycap (写 blu · ā grn · abc red,
 * keycapStyle.ts → hueKeySx), the same object as the keys below it. The keyboard on
 * screen is the key LATCHED DOWN — sitting where a pressed key sits, lip gone, ink
 * label — the way a hardware mode key stays down; the others stand on their lips. The
 * close chevron is a raised white key, so everything tappable reads as a key.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ THE SLOT CLIPS, AND THAT IS THE WHOLE ANIMATION
 *
 * The bar is a fixed-height slot with `overflow: hidden` and an inner row that
 * starts translated fully DOWN inside it. So the row is not "invisible then
 * visible" — it is physically behind the keyboard's top edge and slides out of
 * it, in both modes and without either mode having to know where the keyboard's
 * pixels are:
 *
 *   • over our keyboard, the slot sits directly on top of the surface, so the
 *     hidden row is behind the keyboard's own first KEYBOARD_SWITCH_BAR_HEIGHT px
 *   • over the OS keyboard, the slot is anchored at the keyboard's measured top
 *     edge, so the hidden row is inside the occluded band the browser is not
 *     painting anyway
 *
 * Clipping rather than z-index painting on purpose: the OS keyboard is not our
 * DOM and cannot be stacked against, so a z-index approach would have needed two
 * different implementations of the same effect.
 */
import { Box } from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { FONTS, SIZE, WEIGHT } from '../../theme';
import { switchBarTransition } from './transition';
import { KEYBOARD_COLORS } from './keyboardColors';
import { KEY_LIP, hueKeySx, keyWidthForShownAspect, latchedKeySx, whiteKeySx } from './keycapStyle';
import { RAMP, type RampHue } from '../../theme/colors';

/**
 * The slot's height in CSS px — FIXED at 44, and the key is what gives (owner,
 * 2026-11-15: "bring the size back, just add 4px of padding" — the bar keeps its 44 and
 * the 4px the 40px experiment took off the keys goes into the air around them instead).
 * A flat 40 before the keys were raised.
 *
 * A constant rather than a measurement because the host has to reserve the space
 * and position the OS-mode slot BEFORE the bar has rendered anything to measure.
 */
export const KEYBOARD_SWITCH_BAR_HEIGHT = 44;

/** The 1px top rule that separates the bar from whatever is above it. */
const SWITCH_BAR_RULE = 1;

/**
 * The air above a key's face and below its LIP, px. Equal on purpose: the lip is part of
 * the key's visual mass, so a key centred on its box alone would look low. 8px — the
 * original 6 plus 2 a side, the 4px of padding the owner asked for.
 */
const SWITCH_BAR_PAD = 8;

/**
 * The key face's height: whatever the slot leaves after the rule, both airs and the
 * lip — 44 − 1 − 8 − 3 − 8 = 24.
 */
const SWITCH_KEY_HEIGHT = KEYBOARD_SWITCH_BAR_HEIGHT - SWITCH_BAR_RULE - SWITCH_BAR_PAD - KEY_LIP - SWITCH_BAR_PAD;

/**
 * EVERY key in the bar is one shape, locked (owner, 2026-11-15): 11 : 7 AS SHOWN — face
 * plus lip, keycapStyle.ts → keyWidthForShownAspect — with the width solved from the
 * face height: (24 + 3 lip) × 11/7 ≈ 42.43 wide, so a raised key shows ≈42.43×27.
 * (Earlier that day, on a 28px face: 40×28, then 56×28 at 2 : 1 and 42×28 at 3 : 2
 * measured on the face alone, then 3 : 2, 2 : 1, 5 : 4, 5 : 3, 10 : 7 and 11 : 7 shown;
 * the flat bar's segments were 44×28.)
 */
const SWITCH_KEY_SHOWN_ASPECT = 11 / 7;
const SWITCH_KEY_WIDTH = keyWidthForShownAspect(SWITCH_KEY_HEIGHT, SWITCH_KEY_SHOWN_ASPECT);

/**
 * Which keyboard is currently on screen.
 *
 *   ours    — the 写 handwriting IME (BeginnerKeyboard)
 *   pinyin  — the ā tone-vowel pad (PinyinToneKeyboard, added 2026-10-29). Vowels
 *             only: the learner types consonants on abc and comes here for the
 *             tone-marked vowel. Suppresses the OS keyboard exactly like `ours`.
 *   os      — the system keyboard; all that is ours is this bar
 */
export type KeyboardSource = 'ours' | 'pinyin' | 'os';

/** The switch bar's segments, left to right: 写 · ā · abc (artboard "Dictionary · keyboard, pinyin mode"). */
//
// Each keyboard has its own hue, in the Friends page's tile order left to right —
// Send blu · Accept grn · Remove red (owner, 2026-11-15: "blue green red order like
// they are on the friends page"). The hue is positional, not a meaning: 写 blu, ā grn,
// abc red. The label is lowercase `abc` (owner, 2026-11-15) — it names the Latin
// keyboard, not an acronym.
const SEGMENTS: { source: KeyboardSource; label: string; ariaLabel: string; cjk: boolean; modifier: string; hue: RampHue }[] = [
  { source: 'ours', label: '写', ariaLabel: 'Handwriting keyboard', cjk: true, modifier: 'handwriting', hue: 'blu' },
  { source: 'pinyin', label: 'ā', ariaLabel: 'Pinyin tone keyboard', cjk: false, modifier: 'pinyin', hue: 'grn' },
  { source: 'os', label: 'abc', ariaLabel: 'System keyboard', cjk: false, modifier: 'abc', hue: 'red' },
];

interface KeyboardSwitchBarProps {
  /** The keyboard the learner is on now; the other segment is the offer. */
  source: KeyboardSource;
  /**
   * False hides the 写 · ā · abc toggle and leaves only the close chevron — for a
   * field locked to one keyboard (§ 6z-3b, `data-beginner-keyboard-lock`), where a
   * toggle with one usable segment would be a control that does nothing.
   */
  showToggle?: boolean;
  /** False parks the row behind the keyboard; true slides it out. */
  up: boolean;
  /** Switch to another keyboard. Never called for the one already up. */
  onSelect: (source: KeyboardSource) => void;
  /** Put every keyboard away and leave the field unfocused but intact. */
  onDismiss: () => void;
}

export default function KeyboardSwitchBar({ source, showToggle = true, up, onSelect, onDismiss }: KeyboardSwitchBarProps) {
  return (
    <Box
      className="keyboard-switch-bar__slot"
      sx={{
        position: 'relative',
        height: KEYBOARD_SWITCH_BAR_HEIGHT,
        // The clip that makes the row emerge from behind the keyboard rather
        // than fading in over it. See the header note.
        overflow: 'hidden',
      }}
    >
      <Box
        className="keyboard-switch-bar"
        sx={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: KEYBOARD_SWITCH_BAR_HEIGHT,
          display: 'flex',
          // Hung from the top padding rather than centred, so the air below is
          // measured from the LIP (SWITCH_BAR_PAD) — see KEYBOARD_SWITCH_BAR_HEIGHT.
          alignItems: 'flex-start',
          pt: `${SWITCH_BAR_PAD}px`,
          boxSizing: 'border-box',
          gap: 1,
          px: 1.25,
          backgroundColor: KEYBOARD_COLORS.ground,
          borderTop: `${SWITCH_BAR_RULE}px solid ${KEYBOARD_COLORS.outline}`,
          // A keyboard is a fixed surface; nothing in this row scrolls or selects.
          touchAction: 'none',
          userSelect: 'none',
          transform: up ? 'translateY(0)' : `translateY(${KEYBOARD_SWITCH_BAR_HEIGHT}px)`,
          transition: switchBarTransition(up),
        }}
      >
        {showToggle && (
          <Box
            className="keyboard-switch-bar__toggle"
            role="group"
            aria-label="Keyboard"
            // Separate keys 6px apart: raised keys need air between their lips, and
            // the gap is what makes them three choices rather than one split slab.
            sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}
          >
            {SEGMENTS.map((segment) => (
              <SwitchSegment
                key={segment.source}
                className={`keyboard-switch-bar__segment keyboard-switch-bar__segment--${segment.modifier}`}
                label={segment.label}
                ariaLabel={segment.ariaLabel}
                // 写 takes the app's CJK face rather than ForeignText: this is a key
                // CAP, not a word the learner is being taught, so it must not carry
                // pinyin above it.
                fontFamily={segment.cjk ? FONTS.cjk : FONTS.sans}
                hue={segment.hue}
                active={source === segment.source}
                onClick={() => onSelect(segment.source)}
              />
            ))}
          </Box>
        )}

        {/* Pushes the dismissal to the far edge, away from the switch: the two
            are different kinds of exit and a mis-tap between them is costly —
            one changes how you type, the other stops you typing. */}
        <Box sx={{ flex: 1 }} />

        <Box
          component="button"
          type="button"
          className="keyboard-switch-bar__close"
          aria-label="Hide the keyboard"
          // Every control here guards focus: the caret is where insertion
          // happens, and a pointer that steals it silently breaks the next commit.
          onMouseDown={(event: React.MouseEvent) => event.preventDefault()}
          onClick={onDismiss}
          sx={{
            // A plain white key (owner, 2026-11-15): it is not a keyboard, so it
            // takes none of the three destination hues. Briefly org "gold" that day.
            ...whiteKeySx(),
            width: SWITCH_KEY_WIDTH,
            height: SWITCH_KEY_HEIGHT,
            p: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: KEYBOARD_COLORS.ink2,
          }}
        >
          <KeyboardArrowDownIcon sx={{ fontSize: 20 }} />
        </Box>
      </Box>
    </Box>
  );
}

/** One switch key. Latched down (keycapStyle → latchedKeySx) when it is the keyboard on screen. */
function SwitchSegment({
  className,
  label,
  ariaLabel,
  fontFamily,
  hue,
  active,
  onClick,
}: {
  className: string;
  label: string;
  ariaLabel: string;
  fontFamily: string;
  hue: RampHue;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Box
      component="button"
      type="button"
      className={active ? `${className} ${className}--active` : className}
      aria-label={ariaLabel}
      aria-pressed={active}
      onMouseDown={(event: React.MouseEvent) => event.preventDefault()}
      // Tapping the side you are already on is a no-op rather than a disabled
      // key: a segmented control that greys out half of itself reads as broken.
      onClick={active ? undefined : onClick}
      sx={{
        // Raised when on offer, latched down when it is the keyboard on screen.
        ...hueKeySx(hue),
        ...(active ? latchedKeySx(RAMP[hue].mid) : null),
        width: SWITCH_KEY_WIDTH,
        height: SWITCH_KEY_HEIGHT,
        flexShrink: 0,
        p: 0,
        cursor: active ? 'default' : 'pointer',
        fontFamily,
        fontSize: SIZE.caption,
        fontWeight: WEIGHT.semibold,
        lineHeight: 1,
        // Ink on every hued face (the framework's rule: text on a ramp fill is ink);
        // the offers are a step lighter so the latched key still leads.
        color: active ? KEYBOARD_COLORS.ink : KEYBOARD_COLORS.ink2,
      }}
    >
      {label}
    </Box>
  );
}
