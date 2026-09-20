/**
 * DebugDumpButton — the author-only "dump what the recognizer saw" control.
 *
 * LAYER: client feature view. Owns only the console/clipboard side effects; the
 * payload itself is built by the pure `buildDebugSnapshot`.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6w.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ GATED ON `users.isTemplateAuthor`, AND THE GATE IS NOT HERE
 *
 * The provider decides (it is the only layer in this feature holding auth) and
 * passes `debug` down. Same grant as the night-market and iw editors — this is a
 * tool for whoever is tuning the recognizer, not a user-facing feature.
 *
 * It is UX-only, exactly like every other `isTemplateAuthor` check on the client:
 * there is no server call behind it and nothing here is privileged. A determined
 * learner could produce the same dump from the console. The gate exists so the
 * button is not in everyone's way.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT SITS IN THE FOOTER ROW (revised 2026-09-07)
 *
 * It first FLOATED over the keyboard's top edge, on the reasoning that all three
 * regions (§ 6r) are load-bearing and a button in any of them would either steal
 * a candidate slot or shrink the canvas — and shrinking the canvas degrades
 * recognition, which is the one thing a debug tool must not do.
 *
 * That was wrong in practice: the strip above the keyboard is where the FOCUSED
 * FIELD sits. A floating chip covered the very text the author was typing, which
 * is exactly what they are trying to watch while debugging.
 *
 * The footer row solves it without costing the canvas anything — it already
 * exists for the `ABC` escape, in the left column under the component buffer,
 * and it is laid out beside the canvas rather than above it.
 *
 * ⚠️ IT MUST NOT TAKE FOCUS. The field keeps the caret the whole time the
 * keyboard is up; a tap that blurred it would break the next commit. The host's
 * surface already swallows `mousedown`, but this button repeats the guard because
 * it is the one control that could plausibly be moved out of that surface later.
 */
import { useCallback, useState } from 'react';
import { Box } from '@mui/material';
import { COLORS, FONTS, SIZE, WEIGHT } from '../../theme';
import type { Ink } from '../../components/handwriting/types';
import type { GlyphTemplates } from '../../components/handwriting/glyphTemplates';
import type { GlyphLookupIndex, GlyphWordPool } from '../../components/handwriting/glyphLookup';
import type { CandidateMode } from './compositionRules';
import { buildDebugSnapshot, formatDebugSnapshot } from './debugSnapshot';

/**
 * Where the target character is kept.
 *
 * `localStorage` on purpose: an author debugs one character over many attempts
 * across several fields and page reloads, and re-typing it every time is exactly
 * the friction that stops a debugging tool from being used.
 */
const TARGET_KEY = 'beginnerKeyboard.debugTarget';

function readTarget(): string | null {
  try {
    return window.localStorage.getItem(TARGET_KEY);
  } catch {
    // Private windows and blocked site data throw on access, not on read.
    return null;
  }
}

interface DebugDumpButtonProps {
  ink: Ink;
  buffer: readonly string[];
  mode: CandidateMode;
  canvasSize: number;
  templates: GlyphTemplates | null;
  index: GlyphLookupIndex | null;
  words: GlyphWordPool | null;
}

/** How long the button confirms a dump before going back to its label. */
const CONFIRM_MS = 1200;

export default function DebugDumpButton(props: DebugDumpButtonProps) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'logged'>('idle');
  const [target, setTarget] = useState<string | null>(readTarget);

  /**
   * Ask for the character the author meant.
   *
   * `window.prompt` rather than an inline field, deliberately: it borrows the OS
   * keyboard — the one with pinyin on it — so the author types 你 the ordinary
   * way, and it costs the footer no permanent width on a phone-sized surface.
   */
  const chooseTarget = useCallback(() => {
    const next = window.prompt('Character you were trying to write (blank to clear)', target ?? '');
    if (next === null) return; // cancelled — leave the current target alone
    const trimmed = next.trim();
    setTarget(trimmed || null);
    try {
      if (trimmed) window.localStorage.setItem(TARGET_KEY, trimmed);
      else window.localStorage.removeItem(TARGET_KEY);
    } catch {
      // Not persisting is survivable; the target still holds for this mount.
    }
  }, [target]);

  const dump = useCallback(() => {
    const snapshot = buildDebugSnapshot({ ...props, target });
    const text = formatDebugSnapshot(snapshot);

    // Logged unconditionally, and logged as a plain string rather than an object:
    // devtools collapses an object and pretty-prints it back with its own
    // formatting, which is not what gets pasted anywhere.
    console.log(
      `--- beginner keyboard debug dump (${snapshot.strokeCount} strokes, buffer [${snapshot.buffer.join('')}]) ---\n${text}`,
    );

    // The clipboard is the point on a phone, where there is no console to select
    // from — but it needs a secure context, so the log above is the fallback and
    // the label says which one the author got.
    const clipboard = navigator.clipboard;
    if (!clipboard) {
      setStatus('logged');
    } else {
      clipboard.writeText(text).then(
        () => setStatus('copied'),
        () => setStatus('logged'),
      );
    }
    setTimeout(() => setStatus('idle'), CONFIRM_MS);
  }, [props, target]);

  const label =
    status === 'copied'
      ? 'copied'
      : status === 'logged'
        ? 'in console'
        : target
          ? `dump→${target}`
          : 'dump';

  // Shared chrome: the two controls are one tool and must not read as unrelated.
  const chip = {
    px: 1.25,
    // Matches the `ABC` key they sit beside.
    height: 32,
    flexShrink: 0,
    border: `1px solid ${COLORS.warnInk}`,
    borderRadius: 2,
    backgroundColor: COLORS.white,
    cursor: 'pointer',
    fontFamily: FONTS.sans,
    fontSize: SIZE.caption,
    fontWeight: WEIGHT.semibold,
    color: COLORS.warnInk,
  } as const;

  // Never let a tap here move focus off the field — the caret is where insertion
  // happens, and the host's surface guard should not be the only thing holding it.
  const keepFocus = (event: React.MouseEvent) => event.preventDefault();

  return (
    <>
    <Box
      component="button"
      type="button"
      className="beginner-keyboard__debug-dump"
      onMouseDown={keepFocus}
      onClick={dump}
      sx={chip}
    >
      {label}
    </Box>
    <Box
      component="button"
      type="button"
      className="beginner-keyboard__debug-target"
      onMouseDown={keepFocus}
      onClick={chooseTarget}
      aria-label="Set the character you were trying to write"
      sx={{ ...chip, px: 0.75 }}
    >
      🎯
    </Box>
    </>
  );
}
