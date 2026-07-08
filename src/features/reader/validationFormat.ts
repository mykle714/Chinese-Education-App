import type { ValidationField } from '../../types';

/**
 * Client mirror of the server's validation-body format guard
 * (`ValidationService.assertOnlyJsonValuesEdited`, docs/DATA_VALIDATION_SYSTEM.md).
 *
 * LAYER: reader feature util. A validation document body is a fixed sequence of
 * `<fieldName>:\n<pretty JSON>` blocks (see `ValidationService.composeBody`). A
 * validator is only allowed to edit the JSON leaf **values**. Everything else is
 * locked and rejected on save:
 *   - the outer document format — field headers, block order, block separators,
 *     valid-JSON-per-block (see `canonicalizeValidationBody`), and
 *   - the JSON **shape** — object key names/sets at every level (see
 *     `isValidationShapePreserved`). Renaming a key leaves valid JSON but the server
 *     would no longer recognize the field, so it must be blocked too.
 *
 * The server is the source of truth (it re-checks both on submit against the stored
 * original), but running the same checks client-side blocks a bad save up front.
 */

// Shown when a validation body's format OR JSON key shape was altered. Used by both
// edit surfaces' save-block and by the submit handler's rejection snackbar so the
// wording matches.
export const VALIDATION_FORMAT_MESSAGE =
  'The document format was changed. Only the JSON values may be edited (field/key names must stay the same) — please Revert and start over.';

/**
 * The ordered block field-names that a validation document body contains for a
 * given field — must stay in sync with the server's `expectedBlockFields`.
 */
function expectedBlockFields(field: ValidationField): string[] {
  return field === 'definitions'
    ? ['partsOfSpeech', 'definitions', 'longDefinition']
    : [field];
}

/**
 * Split a validation body into a `{ fieldName -> parsed JSON }` map, or `null` if the
 * block structure is wrong (missing/renamed/reordered/duplicated header, stray text)
 * or any block isn't valid JSON.
 *
 * Split strategy (identical to the server): a header line, trimmed, is exactly
 * `<fieldName>:`; pretty-printed JSON lines are always quoted strings or
 * bracket/brace tokens, so a data line can never trim to a bare `<fieldName>:`.
 */
function parseValidationBlocks(content: string, field: ValidationField): Record<string, unknown> | null {
  const expected = expectedBlockFields(field);
  const headers = new Set(expected.map((name) => `${name}:`));

  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const blocks: { name: string; body: string[] }[] = [];
  let current: { name: string; body: string[] } | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (headers.has(trimmed)) {
      current = { name: trimmed.slice(0, -1), body: [] };
      blocks.push(current);
    } else if (current) {
      current.body.push(line);
    } else if (trimmed !== '') {
      // Non-whitespace content before the first header ⇒ format changed.
      return null;
    }
  }

  // Exactly the expected headers, in the expected order.
  if (
    blocks.length !== expected.length ||
    blocks.some((block, i) => block.name !== expected[i])
  ) {
    return null;
  }

  const parsed: Record<string, unknown> = {};
  for (const block of blocks) {
    try {
      parsed[block.name] = JSON.parse(block.body.join('\n').trim());
    } catch {
      return null;
    }
  }
  return parsed;
}

/**
 * Re-emit `content` in the exact composed `<fieldName>:\n<pretty JSON>` form
 * (the same shape `ValidationService.composeBody` produces). Returns `null` if the
 * body doesn't match the expected block structure or a block isn't valid JSON.
 *
 * This is how we "lock" every character outside the JSON VALUES: canonicalizing
 * resets field headers, block separators, indentation, and stray whitespace to their
 * canonical form, so a whitespace/reformatting-only edit round-trips back to the
 * original byte-for-byte and therefore does NOT count as a change (no spurious flag).
 * The server's composed original is already canonical, so
 * `canonicalizeValidationBody(edited) === validationOriginalContent` ⟺ nothing but
 * whitespace changed.
 */
export function canonicalizeValidationBody(content: string, field: ValidationField): string | null {
  const parsed = parseValidationBlocks(content, field);
  if (!parsed) return null;
  return expectedBlockFields(field)
    .map((name) => `${name}:\n${JSON.stringify(parsed[name], null, 2)}`)
    .join('\n\n');
}

/**
 * True if `content` still matches the composed `<fieldName>:\n<JSON>` block structure
 * for `field` (valid headers/order + valid JSON per block). Does NOT check the JSON's
 * internal key shape — pair with `isValidationShapePreserved` for that.
 */
export function isValidationFormatIntact(content: string, field: ValidationField): boolean {
  return parseValidationBlocks(content, field) !== null;
}

/**
 * Structural shape comparison of two parsed JSON values. Object **key names/sets**
 * must be identical at every level and container types (object/array/primitive) must
 * match; only primitive leaf VALUES may differ, and array LENGTHS may differ (so a
 * validator can edit/add/remove string entries in `definitions`/`partsOfSpeech`, but
 * cannot rename a key in `longDefinition` or an example sentence).
 */
function sameJsonShape(a: unknown, b: unknown): boolean {
  const kind = (v: unknown): 'array' | 'object' | 'primitive' =>
    Array.isArray(v) ? 'array' : v !== null && typeof v === 'object' ? 'object' : 'primitive';

  const ka = kind(a);
  if (ka !== kind(b)) return false;

  if (ka === 'object') {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const keysA = Object.keys(ao).sort();
    const keysB = Object.keys(bo).sort();
    if (keysA.length !== keysB.length || keysA.some((k, i) => k !== keysB[i])) return false;
    return keysA.every((k) => sameJsonShape(ao[k], bo[k]));
  }

  if (ka === 'array') {
    // Array lengths may differ (element editing). Enforce that every element on both
    // sides shares one shape (our arrays are homogeneous — string[] here), so a
    // renamed/retyped element inside an array is still caught.
    const all = [...(a as unknown[]), ...(b as unknown[])];
    if (all.length <= 1) return true;
    return all.every((el) => sameJsonShape(all[0], el));
  }

  return true; // primitives: leaf value may differ
}

/**
 * True if `edited` preserves the JSON key shape of `original` for every block — i.e.
 * only leaf values changed, no object key was renamed/added/removed. Returns false if
 * `edited` doesn't parse (broken format). If `original` doesn't parse (shouldn't
 * happen — it's the server-composed body), shape is not enforced.
 */
export function isValidationShapePreserved(
  edited: string,
  original: string,
  field: ValidationField
): boolean {
  const editedBlocks = parseValidationBlocks(edited, field);
  if (!editedBlocks) return false;
  const originalBlocks = parseValidationBlocks(original, field);
  if (!originalBlocks) return true;
  return expectedBlockFields(field).every((name) =>
    sameJsonShape(originalBlocks[name], editedBlocks[name])
  );
}
