/**
 * The beginner keyboard's decision rules, as pure functions.
 *
 * LAYER: client feature logic. Deliberately separated from `useComposition` so
 * the rules can be tested without a DOM — the suite runs in a node environment,
 * and these are the parts most worth pinning: what a tap means, and which of the
 * two candidate sources is live.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6r (modality, commit semantics), § 6n, § 6x,
 * § 6z-4 (hint bubbles).
 */
import type { GlyphCandidate } from '../../components/handwriting/glyphMatcher';
import type { HintCharacter, LookupCandidate } from '../../components/handwriting/glyphLookup';

export type CandidateMode = 'glyph' | 'result';

export interface Candidate {
  /** The glyph, character or word to paint on the chip. */
  text: string;
  /**
   * What tapping it does. `append` puts it in the component buffer; `commit`
   * sends it to the text field.
   */
  action: 'append' | 'commit';
  /** True for a § 6q word-fallback result, which the row may want to mark. */
  isWord: boolean;
  /**
   * § 6z-4: a common character this glyph, added to the buffer, is on track to
   * spell. Present only on GLYPH-mode chips, and only while the buffer is
   * non-empty; the row paints it as a tappable bubble over the chip.
   */
  hint?: HintCharacter;
}

/**
 * § 6z-4 — attach a hint bubble to each glyph chip.
 *
 * The gate is the spec's: ink on the canvas (the caller only passes glyph
 * candidates) AND at least one component already locked into the buffer. With an
 * empty buffer a single drawn glyph says too little about the target for a
 * suggestion to be anything but noise.
 *
 * `findHint` is injected, like `expand` in `bufferAfterSelect`, so the rule stays
 * testable without loading the binary index.
 */
export function withHints(
  candidates: readonly Candidate[],
  buffer: readonly string[],
  findHint: (buffer: readonly string[], glyph: string) => HintCharacter | null,
): Candidate[] {
  if (buffer.length === 0) return [...candidates];
  return candidates.map((candidate) => {
    const hint = findHint(buffer, candidate.text);
    return hint ? { ...candidate, hint } : candidate;
  });
}

/**
 * § 6z-4 — what tapping a hint bubble does: COMMIT the hinted character, exactly
 * as tapping its chip in the result row would. It goes through the same
 * `selectCandidate` path, so the § 6r rule that a commit clears buffer and ink
 * applies unchanged.
 */
export function hintCommit(hint: HintCharacter): Candidate {
  return { text: hint.text, action: 'commit', isWord: false };
}

/**
 * THE BUFFER IS A FLAT LIST OF COMPONENTS (2026-09-09 — this REPLACES the
 * `Submission` record § 6x introduced).
 *
 * The buffer used to remember both what the learner drew and what it
 * contributed, so a chip could read 尔 while the search saw `⺈ 小`. That extra
 * layer is gone: expansion still happens on the way in (§ 6x's rule is
 * untouched — the 895 components are still the alphabet), but what lands in the
 * buffer is the LEAVES, and each leaf is its own chip.
 *
 * So drawing 尔 appends two chips, `⺈` and `小`, and each is removable on its
 * own. The buffer now shows exactly what the search sees, which is the whole
 * point: there is one list, not a display list over a search list.
 *
 * The cost, accepted: a learner can remove half of what they drew and be left
 * holding a component they never drew and may not recognise. The row repopulates
 * from whatever is left, so it is recoverable rather than a dead end.
 */

/**
 * Which source feeds the row.
 *
 * The row is MODAL and has exactly two states with no overlap (§ 6r): ink on the
 * canvas means "what did you just draw", an empty canvas means "what does the
 * buffer spell". Expressed as one function so the views cannot invent a third.
 */
export function activeMode(hasInk: boolean): CandidateMode {
  return hasInk ? 'glyph' : 'result';
}

/**
 * Adapt matcher output to row chips.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ EVERY GLYPH APPENDS. THERE IS NO COMMIT IN THIS ROW (§ 6x, decided
 * 2026-09-07 — this REPLACES the earlier `glyphAction` rule.)
 *
 * The old rule was "carries the component bit → append, otherwise commit". It
 * cannot survive expansion, and the case that killed it is the motivating one:
 * 尔 is `kind = 2` (character only) AND discoverable, so every version of
 * "commit if it is a real character" sends 尔 to the text field — which is
 * precisely the bug § 6x exists to fix. There is no predicate on the glyph that
 * separates "they meant this as a part" from "they meant this as a word",
 * because for 尔 and 木 and 你 the answer is *both*.
 *
 * So the row does one thing. Committing moved entirely to the result row, which
 * is not a loss: appending a whole character puts its own bag in the buffer, so
 * that character comes back at distance 0, rank 0 — the first chip in the
 * result row. Drawing a whole character costs one extra tap, and the same two
 * taps every time.
 */
export function toGlyphCandidates(matches: readonly GlyphCandidate[]): Candidate[] {
  return matches.map((match) => ({ text: match.char, action: 'append', isWord: false }));
}

/** Adapt lookup output to row chips. Results always commit — that is the point of them. */
export function toResultCandidates(results: readonly LookupCandidate[]): Candidate[] {
  return results.map((result) => ({ text: result.text, action: 'commit', isWord: result.isWord }));
}

/**
 * The buffer after a tap.
 *
 * `expand` is injected rather than imported so this file stays pure and the rule
 * can be tested without loading a 125 KB binary index.
 *
 * ⚠️ A commit ALWAYS empties the buffer (§ 6r, decided). A leftover component
 * would silently poison the next character's search, and the learner has no way
 * to see that it is still there.
 */
export function bufferAfterSelect(
  buffer: readonly string[],
  candidate: Candidate,
  expand: (glyph: string) => string[],
): string[] {
  if (candidate.action === 'commit') return [];
  const leaves = expand(candidate.text);
  // An expander that returns nothing would leave the tap with no visible effect
  // at all — fall back to the glyph standing for itself.
  return [...buffer, ...(leaves.length > 0 ? leaves : [candidate.text])];
}

/**
 * The buffer after tapping a chip to remove it.
 *
 * Removal is by COMPONENT: one chip, one tap, one part gone. Drawing 尔 put two
 * chips in the buffer and each comes back independently.
 */
export function bufferAfterRemove(buffer: readonly string[], position: number): string[] {
  return buffer.filter((_, i) => i !== position);
}
