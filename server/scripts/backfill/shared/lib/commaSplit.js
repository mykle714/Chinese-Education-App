/**
 * Comma-splitting primitives for definition glosses.
 *
 * WHY THIS EXISTS
 * The Spanish det source (Wiktionary-derived `doozan/spanish_data`) packs several
 * interchangeable glosses into ONE string separated by commas — "later, afterwards,
 * afterward, post" — where the Chinese source (CEDICT) delimits with "/" into separate
 * array elements. 22.7% of discoverable es rows have a comma in `definitions[0]` vs
 * 0.9% for zh, so every consumer keyed off `definitions[0]` (dd, the icons8 search
 * term, the cluster partition) inherits a whole synonym list where it expects one
 * gloss. See docs/DEFINITION_MAPPING.md.
 *
 * WHY A MODEL DECIDES, AND THIS MODULE ONLY CHECKS
 * A comma is not always a delimiter, and the difference is semantic rather than
 * lexical: "to break the law, rule, order" delimits the OBJECTS of one verb (splitting
 * it invents "to rule" and "to order"), while ", especially of a house" and ", e.g.
 * well or poorly" are prose continuations. No regex separates those, so the split
 * decision belongs to a model (the split pass in
 * scripts/backfill/spanish/backfill-process-definitions-array.js).
 *
 * This module is the GUARD on that decision: `isExactPartition` accepts a proposed
 * split only if the pieces are an exact, in-order partition of the gloss's top-level
 * comma segments, so the model can choose WHERE to cut but can never invent, reword,
 * drop, or reorder text.
 *
 * Consumed by: scripts/backfill/spanish/backfill-process-definitions-array.js
 * Tested by:   scripts/backfill/shared/lib/commaSplit.test.mjs
 */

// A parenthetical or bracketed note at the START of a gloss scopes the WHOLE run
// ("(of food) bad, spoiled, rotten"), so each split piece may carry it.
const LEADING_NOTE_RE = /^\s*(\([^)]*\)|\[[^\]]*\])\s*/;

/**
 * Split on commas at bracket depth 0 only, so a comma inside a parenthetical
 * ("to look up (in a search engine, dictionary, etc.)") never breaks the gloss.
 * Commas between digits (thousands separators) are also left alone.
 * Returns the trimmed, non-empty segments in source order.
 */
export function splitTopLevelCommas(text) {
  const segments = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);

    const numeric = /\d/.test(text[i - 1] ?? '') && /\d/.test(text[i + 1] ?? '');
    if (ch === ',' && depth === 0 && !numeric) {
      segments.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  segments.push(current.trim());
  return segments.filter(Boolean);
}

/**
 * Strip the leading note (which scopes the whole run) and return { note, segments }.
 * Every other helper here goes through this, so they cannot drift apart.
 */
export function splitParts(gloss) {
  const noteMatch = gloss.match(LEADING_NOTE_RE);
  const note = noteMatch ? noteMatch[1] : '';
  const body = noteMatch ? gloss.slice(noteMatch[0].length) : gloss;
  return { note, segments: splitTopLevelCommas(body) };
}

/** Is there anything here to split at all? Gates the split pass's API call. */
export function hasSplittableComma(gloss) {
  return splitParts(gloss).segments.length > 1;
}

/**
 * Do `pieces` form an EXACT, IN-ORDER partition of `gloss`'s top-level comma segments?
 *
 * Checking each piece for "is it a legal rendering of SOME segment group" independently
 * is NOT enough, and the gap is silent data loss: for "later, afterwards, post", the
 * pieces ["later", "post"] are each individually legal yet together they DROP
 * "afterwards"; ["post", "later, afterwards"] are each legal yet reorder the sense
 * list. Only a partition check catches those — every segment must be consumed, exactly
 * once, left to right.
 *
 * A piece may re-attach either or both of the two markers that scope the whole run and
 * would otherwise be lost on the trailing pieces:
 *   - the leading note — "(of food) bad, spoiled" → "(of food) spoiled", without which
 *     a restrictive/regional/vulgar marker silently vanishes and the ranking rules that
 *     demote it stop firing;
 *   - the infinitive "to " — "to eat away, corrode" → "to corrode", matching the dd
 *     convention that verb glosses read "to X" (2,205 es glosses have this gap).
 * The "to" is only offered when the FIRST segment carries it, i.e. the run really is
 * "to X, Y, Z" rather than a noun list.
 *
 * Matches with backtracking because a piece may span several segments — a PARTIAL split
 * is legal and often better ("to break, break open, (new ground, a game, etc.)" →
 * ["to break", "to break open, (new ground, a game, etc.)"], since the dangling note
 * belongs with "break open"). Segment counts are small (under ~10), so the search is
 * trivial.
 */
export function isExactPartition(gloss, pieces) {
  const { note, segments } = splitParts(gloss);
  if (segments.length < 2 || pieces.length < 2) return false;
  const infinitiveRun = /^to\s+/i.test(segments[0]);

  // Every string the segment range [start, end) may legally be rendered as.
  const renderings = (start, end) => {
    const group = segments.slice(start, end).join(', ');
    const bases = infinitiveRun && !/^to\s+/i.test(group) ? [group, `to ${group}`] : [group];
    const out = new Set();
    for (const base of bases) {
      out.add(base);
      if (note) out.add(`${note} ${base}`);
    }
    return out;
  };

  const solve = (pieceIndex, segmentIndex) => {
    if (pieceIndex === pieces.length) return segmentIndex === segments.length;
    for (let end = segmentIndex + 1; end <= segments.length; end++) {
      if (renderings(segmentIndex, end).has(pieces[pieceIndex]) && solve(pieceIndex + 1, end)) return true;
    }
    return false;
  };
  return solve(0, 0);
}

/**
 * Apply a model's split decisions to `definitions`, in place and in order: each split
 * gloss is replaced by its pieces at the same position; everything else is untouched.
 * Later duplicates are dropped keeping the first occurrence, because two runs can
 * legitimately share a synonym ("to open, open up" and "to start, open, open up, set
 * up" both yield "to open up") and the definitions array is semantically a set.
 *
 * Each proposed split must satisfy `isExactPartition`, so a hallucinated, reworded,
 * dropped, or reordered piece is refused here rather than silently entering the
 * definitions array; the gloss simply stays whole.
 *
 * `splits` is the model's payload: [{ from: "<exact original gloss>", into: [...] }].
 * Returns { expanded, applied, rejected } — `applied` feeds the review log, `rejected`
 * explains everything refused so a run never discards a decision silently.
 */
export function applySplits(definitions, splits) {
  const bySource = new Map();
  const rejected = [];

  for (const entry of Array.isArray(splits) ? splits : []) {
    const from = entry?.from;
    const into = Array.isArray(entry?.into) ? entry.into.filter(p => typeof p === 'string' && p.trim()) : [];
    if (typeof from !== 'string' || !definitions.includes(from)) {
      rejected.push({ from, reason: 'not an original gloss' });
      continue;
    }
    if (into.length < 2) {
      rejected.push({ from, reason: 'fewer than 2 pieces' });
      continue;
    }
    if (!isExactPartition(from, into)) {
      rejected.push({ from, reason: `pieces are not an exact in-order partition: ${JSON.stringify(into)}` });
      continue;
    }
    bySource.set(from, into);
  }

  const seen = new Set();
  const expanded = [];
  const applied = [];
  for (const gloss of definitions) {
    const pieces = bySource.get(gloss);
    if (pieces) applied.push({ from: gloss, into: pieces });
    for (const piece of pieces ?? [gloss]) {
      if (seen.has(piece)) continue;
      seen.add(piece);
      expanded.push(piece);
    }
  }
  return { expanded, applied, rejected };
}
