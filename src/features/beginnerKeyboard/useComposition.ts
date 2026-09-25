/**
 * The beginner keyboard's state machine: the ink on the canvas, the buffer of
 * submitted components, and the one candidate list that is derived from
 * whichever of the two is active.
 *
 * LAYER: client feature hook. Pure state plus calls into the two recognizer
 * modules; no DOM, no fetch.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6r (layout and modes), § 6h/§ 6k (lookup and
 * ranking), § 6q (the word fallback), § 6z-4 (hint bubbles on glyph chips).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CANDIDATE ROW IS MODAL — ONE ROW, TWO MEANINGS
 *
 * § 6r calls this the one risk worth naming, so it is expressed here as a single
 * discriminated value rather than two lists the UI has to choose between:
 *
 *   ink on the canvas   → GLYPH mode: what did they just draw?
 *   canvas empty        → RESULT mode: what does the buffer spell?
 *
 * There is no third state and no overlap. Whatever is in the row, its `mode`
 * says what a tap means, and the UI paints from that rather than inferring.
 */
import { useCallback, useMemo, useState } from 'react';
import type { Ink } from '../../components/handwriting/types';
import { matchGlyphs } from '../../components/handwriting/glyphMatcher';
import { expandGlyph, findHintCharacter, lookupBuffer } from '../../components/handwriting/glyphLookup';
import type { GlyphTemplates } from '../../components/handwriting/glyphTemplates';
import type { GlyphLookupIndex, GlyphWordPool } from '../../components/handwriting/glyphLookup';
import {
  activeMode,
  bufferAfterRemove,
  bufferAfterSelect,
  toGlyphCandidates,
  toResultCandidates,
  withHints,
  type Candidate,
  type CandidateMode,
} from './compositionRules';

// Re-exported so consumers import the whole vocabulary from one place; the rules
// themselves live in compositionRules.ts because the test environment has no DOM.
export type { Candidate, CandidateMode };

/**
 * How many chips the row shows.
 *
 * § 6k is explicit that the DISPLAY truncates and the SEARCH does not — a
 * candidate's rank is only meaningful against the whole set, so both recognizers
 * rank everything and this cut is applied last. § 6j measured that ~12 is enough
 * at every buffer size.
 */
export const CANDIDATE_DISPLAY_LIMIT = 12;

export interface Composition {
  /**
   * The components the learner has submitted, in order — flat, and exactly what
   * the lookup searches on. A glyph drawn above the alphabet's granularity was
   * already expanded on the way in, so 尔 is two entries here, not one.
   */
  buffer: string[];
  /** Whether the row is showing ink guesses or buffer results. */
  mode: CandidateMode;
  /** The chips to paint, already truncated. */
  candidates: Candidate[];
  /** True when there is ink on the canvas. */
  hasInk: boolean;
  /**
   * The raw strokes currently on the canvas.
   *
   * Exposed only for the author debug dump (§ 6w) — the keyboard itself never
   * reads it, because `candidates` is already derived from it and a second
   * consumer of the same state is how the two drift apart.
   */
  ink: Ink;
  onInkChange: (ink: Ink) => void;
  /** Tap a chip. Returns text to commit, or null when the tap only appended. */
  selectCandidate: (candidate: Candidate) => string | null;
  /** Tap a component to remove that one component (§ 6r). */
  removeComponent: (position: number) => void;
  /** Drop the buffer and the ink — used after a commit, and by the host on close. */
  reset: () => void;
}

export interface CompositionDeps {
  templates: GlyphTemplates | null;
  index: GlyphLookupIndex | null;
  words: GlyphWordPool | null;
}

export function useComposition({ templates, index, words }: CompositionDeps): Composition {
  const [buffer, setBuffer] = useState<string[]>([]);
  const [ink, setInk] = useState<Ink>([]);

  const hasInk = ink.length > 0;

  /**
   * Ink → glyph candidates.
   *
   * A glyph that is a COMPONENT appends, even when it is also a standalone
   * character — 木 is both, and § 6n's rescue means appending it still gets the
   * learner to 木 in one more tap. Sending it straight to the text field instead
   * would make the commoner intent (木 as part of 想) unreachable.
   */
  const glyphCandidates = useMemo<Candidate[]>(() => {
    if (!templates || !hasInk) return [];
    return toGlyphCandidates(matchGlyphs(ink, templates, { limit: CANDIDATE_DISPLAY_LIMIT }));
  }, [ink, templates, hasInk]);

  /**
   * § 6z-4: the glyph chips, each carrying a hint bubble when it plus the buffer
   * is on track to spell a common character.
   *
   * A separate memo from the matcher's so a buffer change re-derives only the
   * hints (≤ 12 scans of the ~760 common records), not the ink match.
   */
  const hintedGlyphCandidates = useMemo<Candidate[]>(() => {
    if (!index) return glyphCandidates;
    return withHints(glyphCandidates, buffer, (current, glyph) => findHintCharacter(current, glyph, index));
  }, [glyphCandidates, buffer, index]);

  /**
   * Buffer → character candidates, falling back to words when empty (§ 6q).
   *
   * The buffer IS the component list — expansion happened at append time — so
   * this searches it directly, with nothing to flatten first.
   */
  const resultCandidates = useMemo<Candidate[]>(() => {
    if (!index || buffer.length === 0) return [];
    return toResultCandidates(lookupBuffer(buffer, index, words, CANDIDATE_DISPLAY_LIMIT));
  }, [buffer, index, words]);

  const mode = activeMode(hasInk);
  const candidates = hasInk ? hintedGlyphCandidates : resultCandidates;

  const reset = useCallback(() => {
    setBuffer([]);
    setInk([]);
  }, []);

  const selectCandidate = useCallback(
    (candidate: Candidate): string | null => {
      if (candidate.action === 'commit') {
        // § 6r: committing ALWAYS clears the buffer. A leftover component after a
        // commit would silently poison the next character's search, and the
        // learner has no way to see that it is still there.
        reset();
        return candidate.text;
      }
      // § 6x: translate the drawn glyph into the component alphabet on the way
      // in, and append the resulting components individually. Without an index
      // loaded there is nothing to translate against, so the glyph stands for
      // itself — degraded, but never wrong-by-omission.
      const expand = (glyph: string) => (index ? expandGlyph(glyph, index) : [glyph]);
      setBuffer((current) => bufferAfterSelect(current, candidate, expand));
      // § 6r, DECIDED: submission is the only way to empty the canvas, so a
      // submit always clears it. This is also what flips the row back out of
      // glyph mode, which is what makes the modality legible.
      setInk([]);
      return null;
    },
    [reset, index],
  );

  const removeComponent = useCallback((position: number) => {
    // Removal re-runs the search implicitly: `buffer` is the memo's dependency,
    // so the row repopulates without an explicit re-query (§ 6r).
    setBuffer((current) => bufferAfterRemove(current, position));
  }, []);

  return {
    buffer,
    mode,
    candidates,
    hasInk,
    ink,
    onInkChange: setInk,
    selectCandidate,
    removeComponent,
    reset,
  };
}
