/**
 * The author-only debug dump: everything the recognizer saw on one draw, in a
 * form that can be pasted into a terminal and replayed.
 *
 * LAYER: client feature logic. Pure — takes the composition's state and the
 * loaded assets, returns a string. No DOM, no console, no clipboard; the button
 * in `BeginnerKeyboard` does those.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6w.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SNAPSHOT AT ALL
 *
 * Every accuracy number in § 6h/§ 6j was measured against SYNTHETIC ink —
 * template medians replayed with noise and dropped strokes. That is a good proxy
 * for the shape of the problem and a poor one for a real learner's hand: stroke
 * order, hooks, ligatures and where a stroke starts are all things the synthetic
 * corpus gets right by construction and a beginner gets wrong constantly.
 *
 * So when a character misrecognizes on a real device there is no way to
 * reproduce it from a description. This dump closes that: it is the exact ink,
 * so `matchGlyphs` can be re-run against it offline and the ranking inspected.
 *
 * ⚠️ IT DUMPS BOTH CANDIDATE LISTS REGARDLESS OF MODE. The row is modal (§ 6r)
 * and shows one of them, but the interesting failures are precisely the ones
 * where the wrong mode's list is the one that looks right — a buffer that will
 * not resolve, or a glyph guess that was fine and a lookup that was not.
 *
 * ⚠️ THE INK IS IN CANVAS PIXELS, and the canvas size travels with it. The
 * matcher normalizes by the ink's own bounding box, so absolute scale does not
 * affect a score — but it does tell you how big the box was when they drew, which
 * is what separates "drew it tiny in a corner" from a genuine matcher failure.
 *
 * TIMESTAMPS ARE MADE RELATIVE to the first sampled point. Capture ms are
 * `performance.now()`-scale numbers that dominate the payload's size and carry
 * nothing absolute worth keeping.
 */
import type { Ink } from '../../components/handwriting/types';
import { explainGlyphMatch, matchGlyphs } from '../../components/handwriting/glyphMatcher';
import { expandGlyph, lookupBuffer } from '../../components/handwriting/glyphLookup';
import type { MatchExplanation } from '../../components/handwriting/glyphMatcher';
import type { GlyphTemplates } from '../../components/handwriting/glyphTemplates';
import type { GlyphLookupIndex, GlyphWordPool } from '../../components/handwriting/glyphLookup';
import type { CandidateMode } from './compositionRules';

/**
 * How deep the dump's candidate lists go.
 *
 * Deliberately far past `CANDIDATE_DISPLAY_LIMIT` (12). The question a dump is
 * usually answering is "where DID the right glyph rank?", and a list truncated at
 * what the learner could see cannot answer it — a glyph at rank 19 and a glyph
 * that scored nothing at all are the same absence on screen and completely
 * different bugs.
 */
export const DEBUG_CANDIDATE_LIMIT = 40;

/** Coordinate decimals kept. Sub-tenth-of-a-pixel precision is capture noise. */
const COORD_PRECISION = 1;

export interface DebugSnapshotInput {
  ink: Ink;
  buffer: readonly string[];
  mode: CandidateMode;
  /**
   * The character the author was TRYING to write, if they set one.
   *
   * Without it a dump says where the ink landed; with it, it says where the ink
   * landed *relative to the answer*, which is the only version that can tell a
   * near-miss from a total failure.
   */
  target?: string | null;
  /** Canvas edge length in CSS px, for scale context. */
  canvasSize: number;
  templates: GlyphTemplates | null;
  index: GlyphLookupIndex | null;
  words: GlyphWordPool | null;
}

/** One stroke, compacted. */
interface DumpedStroke {
  x: number[];
  y: number[];
  /** Ms since the first sampled point of the first stroke. */
  t: number[];
}

export interface DebugSnapshot {
  /** Bumped to 2 when the buffer became a flat component list (2026-09-09). */
  v: 2;
  at: string;
  mode: CandidateMode;
  canvasSize: number;
  /**
   * The component buffer, flat — and so also the exact list the lookup searched
   * on. It used to be a list of drawn glyphs with a separate `leaves` field
   * holding what they expanded to; the two collapsed into one when the buffer
   * itself became flat.
   */
  buffer: string[];
  strokeCount: number;
  ink: DumpedStroke[];
  /** Matcher output for the ink. Empty when there is no ink or no templates. */
  suggested: { char: string; cost: number; kind: number; action: 'append' | 'commit' }[];
  /** Lookup output for the buffer. Empty when the buffer is empty or unloaded. */
  results: { text: string; distance: number; isWord: boolean }[];
  /**
   * The intended character, scored and explained — present only when the author
   * set a target. `expansion` is what selecting it would contribute (§ 6x), which
   * is what makes a "the ranking was fine, the decomposition was not" failure
   * visible.
   */
  target?: {
    char: string;
    expansion: string[];
    /** Rank of the target in the RESULT row, or -1 when the buffer cannot reach it. */
    resultRank: number;
    match: MatchExplanation;
  };
  /** Which assets were loaded, so a thin dump is not mistaken for a bad match. */
  assets: { templates: number | null; index: number | null; words: number | null };
}

function round(value: number): number {
  const factor = 10 ** COORD_PRECISION;
  return Math.round(value * factor) / factor;
}

/** Compact the ink, rebasing timestamps onto the first sampled point. */
function dumpInk(ink: Ink): DumpedStroke[] {
  const origin = ink[0]?.ts[0] ?? 0;
  return ink.map((stroke) => ({
    x: stroke.xs.map(round),
    y: stroke.ys.map(round),
    t: stroke.ts.map((t) => Math.round(t - origin)),
  }));
}

/**
 * Build the snapshot.
 *
 * Both recognizers are re-run here rather than reading the hook's memoized
 * lists, because those are truncated to what the row displays and strip the
 * matcher's cost — the two things a dump exists to show.
 */
export function buildDebugSnapshot({
  ink,
  buffer,
  mode,
  canvasSize,
  target,
  templates,
  index,
  words,
}: DebugSnapshotInput): DebugSnapshot {
  const matches =
    templates && ink.length > 0 ? matchGlyphs(ink, templates, { limit: DEBUG_CANDIDATE_LIMIT }) : [];
  // The FULL result list, not the display cut — the target's rank is the point,
  // and it is routinely past the row's 12 (that is the bug being chased).
  const allResults = index && buffer.length > 0 ? lookupBuffer(buffer, index, words, 0) : [];
  const results = allResults.slice(0, DEBUG_CANDIDATE_LIMIT);

  return {
    v: 2,
    at: new Date().toISOString(),
    mode,
    canvasSize,
    buffer: [...buffer],
    strokeCount: ink.length,
    ink: dumpInk(ink),
    suggested: matches.map((match) => ({
      char: match.char,
      // Six decimals: costs cluster tightly enough that three hides real ties.
      cost: Number(match.cost.toFixed(6)),
      kind: match.kind,
      // § 6x: the glyph row does exactly one thing now. Kept in the dump anyway
      // so a reader does not have to remember which side of that change it is on.
      action: 'append' as const,
    })),
    results: results.map((result) => ({
      text: result.text,
      distance: result.distance,
      isWord: result.isWord,
    })),
    ...(target && templates
      ? {
          target: {
            char: target,
            expansion: index ? expandGlyph(target, index) : [target],
            resultRank: allResults.findIndex((candidate) => candidate.text === target),
            match: explainGlyphMatch(ink, templates, target),
          },
        }
      : {}),
    assets: {
      templates: templates?.chars.length ?? null,
      index: index?.chars.length ?? null,
      words: words?.words.length ?? null,
    },
  };
}

/**
 * The snapshot as one pasteable block.
 *
 * Pretty-printed at the top level, but every LEAF block — a coordinate array, a
 * candidate object — is collapsed onto one line. Plain `JSON.stringify(_, 2)` of
 * a 12-stroke character with 40 candidates runs to well over a thousand lines and
 * stops being pasteable, which is the only thing this format has to be. It is
 * still valid JSON: the round trip is what makes a dump replayable offline.
 *
 * The regex is safe here only because no value in a snapshot can contain a
 * bracket or a brace — glyphs, characters and words are all CJK text. Do not
 * reuse it on arbitrary JSON.
 */
const LEAF_BLOCK = /([[{])\s+([^[\]{}]*?)\s*([\]}])/g;

export function formatDebugSnapshot(snapshot: DebugSnapshot): string {
  return JSON.stringify(snapshot, null, 2).replace(
    LEAF_BLOCK,
    (_match, open: string, body: string, close: string) =>
      `${open}${body.replace(/\s+/g, ' ')}${close}`,
  );
}
