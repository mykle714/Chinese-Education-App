/**
 * PinyinToneKeyboard — the ā keyboard: tone-marked pinyin vowels, nothing else.
 *
 * LAYER: client feature, presentational + DOM-edit. Like BeginnerKeyboard it knows
 * nothing about the OS or about which field is focused beyond the one it is
 * handed; the host decides when it is up (`source === 'pinyin'`).
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6z-10 (the ā pad). Design: Claude Design
 * project "Tower Tier 2 - Time of Day", artboard "Dictionary · keyboard, pinyin
 * mode" — "A new ā tab beside 写 and ABC: accented pinyin keys only, grouped by
 * vowel. 写 is untouched."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE LAYOUT
 *
 *   ┌──────────────────────────────────────────────┐
 *   │   ā á ǎ à        ē é ě è                     │   one row = two vowels;
 *   │   ī í ǐ ì        ō ó ǒ ò                     │   the wide gap between the
 *   │   ū ú ǔ ù        ǖ ǘ ǚ ǜ                     │   groups is the ONLY thing
 *   │   [ ⌫ ]       [ ← ][ → ]      [ 🔍 Search ]  │   saying ā á ǎ à is one vowel
 *   └──────────────────────────────────────────────┘
 *
 * ⚠️ BACKSPACE IS BOTTOM-LEFT ON PURPOSE (decided 2026-10-29). The artboard
 * right-aligned it beside Search, which read as one oddly-split button. The two
 * keys now sit at opposite ends of the row, the same way they never touch on an
 * OS keyboard: a mis-tap between "delete" and "submit" is the costly one.
 *
 * ← → CARET KEYS sit between them (added 2026-10-29, user request): on a phone the
 * caret is hard to place by tapping, and a learner fixing one tone mark mid-word
 * needs to step back over it. They move by one code point and repeat when held,
 * like backspace (insertAtCaret.ts → moveCaret).
 *
 * VOWELS ONLY (decided 2026-10-29). There are no consonant keys: the learner types
 * "sh" on ABC and comes here for "í". Numbered pinyin (shi2) still works from ABC,
 * since the dictionary search accepts it.
 *
 * COLOUR. Each vowel group takes one ramp hue in the order the vowels are taught
 * (a→red, e→org, i→yel, o→grn, u→blu, ü→pur) — the same mapping as the older
 * inline PinyinKeypad (src/components/PinyinKeypad.tsx → ZH_ROWS), so a learner
 * who knows one pad knows the other. The artboard's keys are a pale fill on a
 * deeper lip (`oklch(.92 .07 h)` on `oklch(.82 .09 h)`); the framework's nearest
 * tiers are SURFACE for the face and MARK for the lip. MARK is more saturated than
 * the artboard's lip — flagged to the user, kept on-framework.
 */
import { useCallback, useEffect, useRef } from 'react';
import { Box } from '@mui/material';
import BackspaceOutlinedIcon from '@mui/icons-material/BackspaceOutlined';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import SearchIcon from '@mui/icons-material/Search';
import KeyboardReturnIcon from '@mui/icons-material/KeyboardReturn';
import { COLORS, FONTS, SIZE, WEIGHT } from '../../theme';
import { RAMP, type RampHue } from '../../theme/colors';
import { deleteBeforeCaret, insertAtCaret, moveCaret } from './insertAtCaret';
import { KEYBOARD_COLORS } from './keyboardColors';
import { keycapPressSx } from '../../theme/keycapPress';
import type { EditableField } from './eligibility';

/** One vowel's four tones, and the ramp hue the group is painted in. */
interface ToneGroup {
  keys: [string, string, string, string];
  hue: RampHue;
}

/** Two groups per row, three rows: a/e, i/o, u/ü. */
const TONE_ROWS: [ToneGroup, ToneGroup][] = [
  [{ keys: ['ā', 'á', 'ǎ', 'à'], hue: 'red' }, { keys: ['ē', 'é', 'ě', 'è'], hue: 'org' }],
  [{ keys: ['ī', 'í', 'ǐ', 'ì'], hue: 'yel' }, { keys: ['ō', 'ó', 'ǒ', 'ò'], hue: 'grn' }],
  [{ keys: ['ū', 'ú', 'ǔ', 'ù'], hue: 'blu' }, { keys: ['ǖ', 'ǘ', 'ǚ', 'ǜ'], hue: 'pur' }],
];

// Artboard `.tp` metrics. Widest row = 8·40 + 6·4 + 16 = 360px; on a narrower
// phone the keys shrink (each group is a 4-column grid) rather than overflow.
const KEY_HEIGHT = 44;
const KEY_MAX_WIDTH = 40;
const KEY_GAP = 4;
const GROUP_GAP = 16;
const ROW_GAP = 12;
const GRID_MAX_WIDTH = KEY_MAX_WIDTH * 8 + KEY_GAP * 6 + GROUP_GAP;
/** The keycap's bottom lip — the "raised key" read, the same 3px the artboard uses. */
const LIP = 3;

// Hold-to-repeat (backspace and the ← → caret keys), matching the feel of an OS
// keyboard's held delete.
const REPEAT_DELAY_MS = 400;
const REPEAT_INTERVAL_MS = 70;

/**
 * The keycap outline: the app's 1px `COLORS.border` ring (CLAUDE.md § Buttons &
 * cards — every tappable carries it) drawn as an inset shadow so it does not
 * change the key's box, plus the raised lip beneath.
 */
const keycapShadow = (lip: string, outline: string = COLORS.border) => `inset 0 0 0 1px ${outline}, 0 ${LIP}px 0 ${lip}`;

/**
 * A key's resting shadow + the app's raised-key press (theme/keycapPress.ts): it snaps
 * down onto its lip while held, keeping its outline, and snaps back on release — no
 * transition.
 */
const keyPressSx = (lip: string, outline: string = COLORS.border) =>
  keycapPressSx({
    restShadow: keycapShadow(lip, outline),
    pressedShadow: `inset 0 0 0 1px ${outline}`,
    pressedY: LIP,
  });

/**
 * What the action key says and does, read off the FIELD rather than hard-coded
 * to "Search": the pad is app-wide (every zh keyboard field), and a field that
 * declares `enterkeyhint` already told the OS keyboard what its return key means.
 */
function actionFor(field: EditableField): { label: string; icon: 'search' | 'return' | null } {
  if (field instanceof HTMLTextAreaElement) return { label: 'Return', icon: 'return' };
  switch (field.enterKeyHint) {
    case 'search': return { label: 'Search', icon: 'search' };
    case 'go': return { label: 'Go', icon: null };
    case 'send': return { label: 'Send', icon: null };
    case 'next': return { label: 'Next', icon: null };
    default: return { label: 'Done', icon: null };
  }
}

interface PinyinToneKeyboardProps {
  /** The focused field the pad edits. */
  field: EditableField;
  /** Total height in CSS px — the host passes the handwriting keyboard's height so 写 ⇄ ā never jumps. */
  height: number;
  /** Fires with a tone vowel to insert at the caret. */
  onCommit: (text: string) => void;
  /** The action key finished on a single-line field: put the keyboard away. */
  onDismiss: () => void;
}

export default function PinyinToneKeyboard({ field, height, onCommit, onDismiss }: PinyinToneKeyboardProps) {
  const action = actionFor(field);

  // ── Hold-to-repeat (backspace, ← →) ─────────────────────────────────────────
  // Timers live in refs so a re-render mid-hold does not orphan them; every exit
  // (lift, leave, cancel, unmount) funnels through stopRepeat.
  const delayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopRepeat = useCallback(() => {
    if (delayTimer.current) clearTimeout(delayTimer.current);
    if (repeatTimer.current) clearInterval(repeatTimer.current);
    delayTimer.current = null;
    repeatTimer.current = null;
  }, []);
  useEffect(() => stopRepeat, [stopRepeat]);

  // Runs `step` once on press, then again every REPEAT_INTERVAL_MS after
  // REPEAT_DELAY_MS of holding. `step` returns false when it has nothing left to do
  // (field empty, caret at the end), which ends the repeat instead of ticking on.
  const startRepeat = useCallback(
    (event: React.PointerEvent, step: () => boolean) => {
      // preventDefault keeps focus (and so the caret) in the field.
      event.preventDefault();
      stopRepeat();
      if (!step()) return;
      delayTimer.current = setTimeout(() => {
        repeatTimer.current = setInterval(() => {
          if (!step()) stopRepeat();
        }, REPEAT_INTERVAL_MS);
      }, REPEAT_DELAY_MS);
    },
    [stopRepeat],
  );
  const deleteStep = useCallback(() => deleteBeforeCaret(field) !== null, [field]);

  // Pointer + keyboard wiring shared by the three repeating keys. Enter/Space on the
  // focused button (keyboard access) has no pointer events, so it steps once.
  const repeatKeyProps = (step: () => boolean) => ({
    onPointerDown: (event: React.PointerEvent) => startRepeat(event, step),
    onPointerUp: stopRepeat,
    onPointerLeave: stopRepeat,
    onPointerCancel: stopRepeat,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') step();
    },
  });

  // ── The action key ──────────────────────────────────────────────────────────
  // A textarea gets a newline. A single-line field gets the Enter a real keyboard
  // would send (so any onKeyDown handler runs), an implicit form submit if a
  // form owns it, and then the keyboard goes away, as an OS keyboard's Search does.
  const handleAction = useCallback(() => {
    if (field instanceof HTMLTextAreaElement) {
      insertAtCaret(field, '\n');
      return;
    }
    const enter = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
    const proceed = field.dispatchEvent(enter);
    if (proceed && field.form) field.form.requestSubmit();
    onDismiss();
  }, [field, onDismiss]);

  return (
    <Box
      className="pinyin-tone-keyboard"
      sx={{
        height,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: `${ROW_GAP}px`,
        px: 1.25,
        // Room under the last row for the home indicator, as on the 写 surface.
        pb: 1,
        // Same ground + top rule as BeginnerKeyboard, so switching 写 ⇄ ā swaps
        // only the keys and never the surface.
        // A Tier 2 page's ground over the Dictionary (keyboardColors).
        backgroundColor: KEYBOARD_COLORS.ground,
        borderTop: `1px solid ${KEYBOARD_COLORS.outline}`,
        touchAction: 'none',
        userSelect: 'none',
      }}
    >
      {TONE_ROWS.map((row, rowIndex) => (
        <Box
          key={rowIndex}
          className="pinyin-tone-keyboard__row"
          sx={{ display: 'flex', gap: `${GROUP_GAP}px`, width: '100%', maxWidth: GRID_MAX_WIDTH, mx: 'auto' }}
        >
          {row.map((group) => (
            <Box
              key={group.hue}
              className={`pinyin-tone-keyboard__group pinyin-tone-keyboard__group--${group.hue}`}
              sx={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: `${KEY_GAP}px` }}
            >
              {group.keys.map((vowel) => (
                <Box
                  key={vowel}
                  component="button"
                  type="button"
                  className="pinyin-tone-keyboard__key"
                  aria-label={vowel}
                  onClick={() => onCommit(vowel)}
                  sx={{
                    height: KEY_HEIGHT,
                    minWidth: 0,
                    p: 0,
                    border: 'none',
                    borderRadius: '9px',
                    backgroundColor: RAMP[group.hue].surface,
                    fontFamily: FONTS.sans,
                    fontSize: SIZE.subtitle,
                    fontWeight: WEIGHT.medium,
                    lineHeight: 1,
                    color: COLORS.onSurface,
                    cursor: 'pointer',
                    ...keyPressSx(RAMP[group.hue].mark),
                  }}
                >
                  {vowel}
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      ))}

      {/* Utility row: backspace at the far LEFT, the ← → caret pair in the middle,
          the action at the far right. */}
      <Box
        className="pinyin-tone-keyboard__utility-row"
        sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', maxWidth: GRID_MAX_WIDTH, mx: 'auto' }}
      >
        <Box
          component="button"
          type="button"
          className="pinyin-tone-keyboard__backspace"
          aria-label="Delete"
          {...repeatKeyProps(deleteStep)}
          sx={utilityKeySx({ width: 88 })}
        >
          <BackspaceOutlinedIcon sx={{ fontSize: 22 }} />
        </Box>
        <Box className="pinyin-tone-keyboard__caret-keys" sx={{ display: 'flex', gap: `${KEY_GAP}px` }}>
          <Box
            component="button"
            type="button"
            className="pinyin-tone-keyboard__caret-key pinyin-tone-keyboard__caret-key--left"
            aria-label="Move cursor left"
            {...repeatKeyProps(() => moveCaret(field, -1))}
            sx={utilityKeySx({ width: 48 })}
          >
            <ChevronLeftIcon sx={{ fontSize: 24 }} />
          </Box>
          <Box
            component="button"
            type="button"
            className="pinyin-tone-keyboard__caret-key pinyin-tone-keyboard__caret-key--right"
            aria-label="Move cursor right"
            {...repeatKeyProps(() => moveCaret(field, 1))}
            sx={utilityKeySx({ width: 48 })}
          >
            <ChevronRightIcon sx={{ fontSize: 24 }} />
          </Box>
        </Box>
        <Box
          component="button"
          type="button"
          className="pinyin-tone-keyboard__action"
          onClick={handleAction}
          sx={utilityKeySx({ px: 1.75, gap: 0.625 })}
        >
          {action.icon === 'search' && <SearchIcon sx={{ fontSize: 20 }} />}
          {action.icon === 'return' && <KeyboardReturnIcon sx={{ fontSize: 20 }} />}
          {action.label}
        </Box>
      </Box>
    </Box>
  );
}

/**
 * The white utility keycap (backspace, ← →, action) — artboard `.tp .tpl b`. Slate at night
 * over a Tier 2 page (keyboardColors); the vowel keys keep their ramp colours.
 */
function utilityKeySx(extra: Record<string, unknown>) {
  return {
    height: KEY_HEIGHT,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    borderRadius: '9px',
    backgroundColor: KEYBOARD_COLORS.key,
    fontFamily: FONTS.sans,
    fontSize: SIZE.body,
    fontWeight: WEIGHT.semibold,
    color: KEYBOARD_COLORS.ink2,
    cursor: 'pointer',
    ...keyPressSx(KEYBOARD_COLORS.keyEdge, KEYBOARD_COLORS.outline),
    ...extra,
  } as const;
}
