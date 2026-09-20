/**
 * Loads the three binary assets the beginner keyboard runs on, and reports which
 * of them have landed.
 *
 * LAYER: client feature hook. Wraps the loaders in
 * `src/components/handwriting/` so the UI never touches fetch or parse directly.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6t (templates), § 6u (lookup).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THREE ASSETS ARRIVE INDEPENDENTLY, AND THAT IS THE POINT
 *
 *   glyph-templates.bin  1.25 MB  ink → ranked glyphs. Nothing works without it.
 *   glyph-lookup.bin     125 KB   components → characters. Needed to commit.
 *   glyph-words.bin      700 KB   the § 6q word fallback. Needed only on empty.
 *
 * They are fetched in parallel and consumed as they arrive rather than gated
 * behind one combined promise: the keyboard becomes usable the moment the first
 * two land, and the fallback is simply inert until the largest one does. Gating
 * on all three would make the biggest, least-needed file decide when the learner
 * can start drawing.
 *
 * All three are session-cached inside their loaders, so mounting the keyboard a
 * second time re-reads memory rather than the network.
 */
import { useEffect, useState } from 'react';
import { loadGlyphTemplates, type GlyphTemplates } from '../../components/handwriting/glyphTemplates';
import {
  loadGlyphLookup,
  loadGlyphWords,
  type GlyphLookupIndex,
  type GlyphWordPool,
} from '../../components/handwriting/glyphLookup';

export interface GlyphAssets {
  /** Stroke templates. Until this lands, drawing produces no candidates. */
  templates: GlyphTemplates | null;
  /** The component→character index. Until this lands, the buffer cannot resolve. */
  index: GlyphLookupIndex | null;
  /** The word pool. Null is a valid steady state — the § 6q fallback stays inert. */
  words: GlyphWordPool | null;
  /** True once the keyboard can do its core job (draw → candidates → commit). */
  ready: boolean;
  /** First load failure, if any. The keyboard should offer the OS keyboard back. */
  error: Error | null;
}

export function useGlyphAssets(enabled: boolean): GlyphAssets {
  const [templates, setTemplates] = useState<GlyphTemplates | null>(null);
  const [index, setIndex] = useState<GlyphLookupIndex | null>(null);
  const [words, setWords] = useState<GlyphWordPool | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!enabled) return;
    // Guards every setState: the keyboard can be dismissed mid-fetch, and the
    // word asset in particular takes long enough for that to be routine.
    let live = true;

    // Each promise settles on its own so a slow or failed asset cannot hold up
    // one that already arrived.
    loadGlyphTemplates().then(
      (value) => live && setTemplates(value),
      (err) => live && setError(err),
    );
    loadGlyphLookup().then(
      (value) => live && setIndex(value),
      (err) => live && setError(err),
    );
    // The word pool is the one asset whose failure is NOT fatal — the fallback
    // just never fires — so it does not raise `error`.
    loadGlyphWords().then(
      (value) => live && setWords(value),
      () => {},
    );

    return () => {
      live = false;
    };
  }, [enabled]);

  return { templates, index, words, ready: templates !== null && index !== null, error };
}
