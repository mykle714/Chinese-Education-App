/**
 * The beginner keyboard's decision rules, as pure functions.
 *
 * LAYER: client feature logic. Deliberately separated from `useComposition` so
 * the rules can be tested without a DOM — the suite runs in a node environment,
 * and these are the parts most worth pinning: what a tap means, and which of the
 * two candidate sources is live.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6r (modality, commit semantics), § 6n, § 6x,
 * § 6z-4 (hint bubbles), § 6z-6 (buffer-fit re-ranking), § 6z-7 (look-alike
 * components share one chip), § 6z-8 (the direct-commit chip).
 */
import type { GlyphCandidate } from '../../components/handwriting/glyphMatcher';
import type { Ink } from '../../components/handwriting/types';
import type { HintCharacter, LookupCandidate } from '../../components/handwriting/glyphLookup';
import { canonicalComponent } from '../../components/handwriting/componentAliases';

export type CandidateMode = 'glyph' | 'result';

/**
 * § 6z-9 — the half-built character: what the learner has drawn and locked in.
 *
 * It belongs to the keyboard SESSION, not to one field. The provider holds it,
 * because the host is remounted per field (`fieldKey`), and moving focus between
 * eligible fields — opening the iw quick dictionary mid-character is the case
 * that found it — must not throw the learner's work away. It is cleared when the
 * keyboard actually closes, and by a commit.
 */
export interface CompositionDraft {
  buffer: string[];
  ink: Ink;
}

export const EMPTY_DRAFT: CompositionDraft = { buffer: [], ink: [] };

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
 * § 6z-6 — how much a glyph's match cost is discounted when tapping it would put
 * the buffer on track to a COMMON character. Multipliers on the matcher's cost
 * (lower cost ranks higher).
 *
 * WHY: the ink alone cannot tell a flat, hurried ⺈ from 冖 (2026-09-27 dump:
 * buffer `[亻, 小]`, the learner drawing 你's missing piece, 冖 ranked first). But
 * the buffer can — 你 is exactly one ⺈ away, and 冖 completes nothing. The hint
 * bubble already knew that; this lets the ranking know it too.
 *
 * WHY THESE VALUES: a discount of ×0.5 can only overturn a top match that was at
 * best half as good, so a CONFIDENT drawing is never overridden by the prior — it
 * steps in only where the ink was genuinely ambiguous. The one-short tier is
 * gentler because "on track" is a weaker claim than "completes".
 *
 * ⚠️ Tuned on one real sample. Revisit with every new debug dump (§ 6w).
 */
export const BUFFER_FIT_DISCOUNT = {
  /** buffer + glyph IS a common character's whole bag. */
  completes: 0.5,
  /** buffer + glyph is one component short of a common character. */
  oneShort: 0.75,
} as const;

/** The multiplier a glyph earns from its hint — 1 when it earns nothing. */
export function bufferFitFactor(hint: HintCharacter | null): number {
  if (!hint) return 1;
  if (hint.distance === 0) return BUFFER_FIT_DISCOUNT.completes;
  if (hint.distance === 1) return BUFFER_FIT_DISCOUNT.oneShort;
  return 1;
}

/** One matcher survivor, with the hint it earned and the cost it is ranked by. */
export interface RankedGlyph {
  match: GlyphCandidate;
  /** § 6z-4's bubble — null with an empty buffer or when nothing is on track. */
  hint: HintCharacter | null;
  /** `match.cost × bufferFitFactor(hint)` — what the row sorts by. */
  cost: number;
}

/**
 * § 6z-4 + § 6z-6 — attach each glyph's hint and re-rank the row by buffer fit.
 *
 * Hints and ranking come from ONE pass over the same `hintFor` answer, so a chip
 * that jumped up the row always carries the bubble that explains why.
 *
 * The gate is § 6z-4's: at least one component already in the buffer. With an
 * empty buffer a single drawn glyph says too little about the target for either a
 * suggestion or a re-rank to be anything but noise, so the matcher's order stands.
 *
 * Pass the WHOLE matcher output, not the display cut — a glyph that fits the
 * buffer can climb from well past the 12th slot (⺈ did), and truncating first
 * would drop it before it had the chance.
 *
 * `hintFor` is injected (from `makeHintFinder`), like `expand` in
 * `bufferAfterSelect`, so the rule stays testable without the binary index.
 */
export function rankGlyphs(
  rawMatches: readonly GlyphCandidate[],
  buffer: readonly string[],
  hintFor: ((glyph: string) => HintCharacter | null) | null,
): RankedGlyph[] {
  const matches = mergeLookAlikes(rawMatches);
  if (buffer.length === 0 || !hintFor) {
    return matches.map((match) => ({ match, hint: null, cost: match.cost }));
  }
  const ranked = matches.map((match) => {
    const hint = hintFor(match.char);
    return { match, hint, cost: match.cost * bufferFitFactor(hint) };
  });
  // Array.prototype.sort is stable, so undiscounted glyphs keep the matcher's order.
  return ranked.sort((a, b) => a.cost - b.cost);
}

/**
 * § 6z-7 — fold each look-alike component's chip into its canonical form's.
 *
 * A drawn box scores against both 口 and 囗; since the search now treats them as
 * one component, two chips would be one choice shown twice. The merged chip
 * reads the canonical glyph and keeps the BETTER of the two costs, so the merge
 * can only lift a glyph, never bury it. The merged chip sits where the class
 * first appeared, which for the matcher's (ascending) output is its best slot.
 */
function mergeLookAlikes(matches: readonly GlyphCandidate[]): GlyphCandidate[] {
  const slotOf = new Map<string, number>();
  const merged: GlyphCandidate[] = [];
  for (const match of matches) {
    const char = canonicalComponent(match.char);
    const slot = slotOf.get(char);
    if (slot === undefined) {
      slotOf.set(char, merged.length);
      merged.push(char === match.char ? match : { ...match, char });
    } else if (match.cost < merged[slot].cost) {
      merged[slot] = { ...match, char };
    }
  }
  return merged;
}

/**
 * § 6z-8 — the direct-commit chip: the green section leading the glyph row, so a
 * learner who drew a whole character can send it straight to the field.
 *
 * WHY: since § 6x every glyph chip APPENDS — drawing 我 puts 我's parts in the
 * buffer, and the learner then finds 我 again in the (green) result row. Two taps
 * for one character they drew whole. § 6x rejected a per-glyph "commit if it is a
 * character" rule because no predicate can tell "meant as a part" from "meant as a
 * word". This does not try to: it offers BOTH. The same glyph stays first in the
 * blue section for the learner who wanted its parts.
 *
 * The rule (confirmed 2026-09-28):
 *   - ONLY the top guess — the first chip the blue section shows (after § 6z-7's
 *     merge), so the green chip always repeats something visible beside it;
 *   - only when that character appears in a multi-character det word
 *     (`appearsInWord`, injected) — 我 and 口 qualify, 亻 氵 冖 do not;
 *   - only with an EMPTY buffer. A commit clears the buffer (§ 6r), so offering it
 *     mid-character would silently discard the learner's parts, and the § 6z-4
 *     bubbles already offer the commits that make sense there.
 *
 * Returns a `commit` candidate, which `selectCandidate` already handles.
 */
export function directCommitCandidate(
  ranked: readonly RankedGlyph[],
  buffer: readonly string[],
  appearsInWord: (char: string) => boolean,
): Candidate | null {
  if (buffer.length > 0) return null;
  const top = ranked[0];
  if (!top || !appearsInWord(top.match.char)) return null;
  return { text: top.match.char, action: 'commit', isWord: false };
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
 * Adapt ranked matcher output to row chips (truncate BEFORE calling — the row
 * shows `CANDIDATE_DISPLAY_LIMIT`).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ EVERY GLYPH CHIP APPENDS (§ 6x, decided 2026-09-07 — this REPLACES the
 * earlier `glyphAction` rule.) Committing while drawing is offered SEPARATELY,
 * by the one green direct-commit chip in front of these (§ 6z-8,
 * `directCommitCandidate`) — never by changing what a glyph chip does.
 *
 * The old rule was "carries the component bit → append, otherwise commit". It
 * cannot survive expansion, and the case that killed it is the motivating one:
 * 尔 is `kind = 2` (character only) AND discoverable, so every version of
 * "commit if it is a real character" sends 尔 to the text field — which is
 * precisely the bug § 6x exists to fix. There is no predicate on the glyph that
 * separates "they meant this as a part" from "they meant this as a word",
 * because for 尔 and 木 and 你 the answer is *both*.
 *
 * So a glyph chip does one thing. Appending a whole character puts its own bag
 * in the buffer, so that character comes back at distance 0, rank 0 — the first
 * chip in the result row. That route still works; § 6z-8's direct chip is the
 * one-tap shortcut beside it for the empty-buffer case.
 */
export function toGlyphCandidates(ranked: readonly RankedGlyph[]): Candidate[] {
  return ranked.map(({ match, hint }) =>
    hint
      ? { text: match.char, action: 'append', isWord: false, hint }
      : { text: match.char, action: 'append', isWord: false },
  );
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
