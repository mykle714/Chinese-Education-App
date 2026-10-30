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
 * The toggle shows EVERY destination (写 · ā · ABC) rather than flipping one
 * label, so the choice is legible before the learner needs it. The active
 * segment is filled.
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
 *     hidden row is behind the keyboard's own first 40px
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

/**
 * The slot's height in CSS px.
 *
 * A constant rather than a measurement because the host has to reserve the space
 * and position the OS-mode slot BEFORE the bar has rendered anything to measure.
 */
export const KEYBOARD_SWITCH_BAR_HEIGHT = 40;

/**
 * Which keyboard is currently on screen.
 *
 *   ours    — the 写 handwriting IME (BeginnerKeyboard)
 *   pinyin  — the ā tone-vowel pad (PinyinToneKeyboard, added 2026-10-29). Vowels
 *             only: the learner types consonants on ABC and comes here for the
 *             tone-marked vowel. Suppresses the OS keyboard exactly like `ours`.
 *   os      — the system keyboard; all that is ours is this bar
 */
export type KeyboardSource = 'ours' | 'pinyin' | 'os';

/** The switch bar's segments, left to right: 写 · ā · ABC (artboard "Dictionary · keyboard, pinyin mode"). */
const SEGMENTS: { source: KeyboardSource; label: string; ariaLabel: string; cjk: boolean; modifier: string }[] = [
  { source: 'ours', label: '写', ariaLabel: 'Handwriting keyboard', cjk: true, modifier: 'handwriting' },
  { source: 'pinyin', label: 'ā', ariaLabel: 'Pinyin tone keyboard', cjk: false, modifier: 'pinyin' },
  { source: 'os', label: 'ABC', ariaLabel: 'System keyboard', cjk: false, modifier: 'abc' },
];

interface KeyboardSwitchBarProps {
  /** The keyboard the learner is on now; the other segment is the offer. */
  source: KeyboardSource;
  /** False parks the row behind the keyboard; true slides it out. */
  up: boolean;
  /** Switch to another keyboard. Never called for the one already up. */
  onSelect: (source: KeyboardSource) => void;
  /** Put every keyboard away and leave the field unfocused but intact. */
  onDismiss: () => void;
}

export default function KeyboardSwitchBar({ source, up, onSelect, onDismiss }: KeyboardSwitchBarProps) {
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
          alignItems: 'center',
          gap: 1,
          px: 1.25,
          backgroundColor: KEYBOARD_COLORS.ground,
          borderTop: `1px solid ${KEYBOARD_COLORS.outline}`,
          // A keyboard is a fixed surface; nothing in this row scrolls or selects.
          touchAction: 'none',
          userSelect: 'none',
          transform: up ? 'translateY(0)' : `translateY(${KEYBOARD_SWITCH_BAR_HEIGHT}px)`,
          transition: switchBarTransition(up),
        }}
      >
        <Box
          className="keyboard-switch-bar__toggle"
          role="group"
          aria-label="Keyboard"
          sx={{
            display: 'flex',
            alignItems: 'center',
            p: '2px',
            gap: '2px',
            borderRadius: 2,
            backgroundColor: KEYBOARD_COLORS.well,
          }}
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
              active={source === segment.source}
              onClick={() => onSelect(segment.source)}
            />
          ))}
        </Box>

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
            width: 40,
            height: 28,
            p: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            borderRadius: 2,
            backgroundColor: 'transparent',
            cursor: 'pointer',
            color: KEYBOARD_COLORS.ink2,
          }}
        >
          <KeyboardArrowDownIcon sx={{ fontSize: 20 }} />
        </Box>
      </Box>
    </Box>
  );
}

/** One side of the segmented toggle. Filled when it is the keyboard on screen. */
function SwitchSegment({
  className,
  label,
  ariaLabel,
  fontFamily,
  active,
  onClick,
}: {
  className: string;
  label: string;
  ariaLabel: string;
  fontFamily: string;
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
        minWidth: 44,
        height: 28,
        px: 1.25,
        border: 'none',
        borderRadius: '6px',
        backgroundColor: active ? KEYBOARD_COLORS.key : 'transparent',
        cursor: active ? 'default' : 'pointer',
        fontFamily,
        fontSize: SIZE.caption,
        fontWeight: WEIGHT.semibold,
        lineHeight: 1,
        color: active ? KEYBOARD_COLORS.ink : KEYBOARD_COLORS.muted,
      }}
    >
      {label}
    </Box>
  );
}
