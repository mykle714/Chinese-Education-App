/**
 * Shared document-content sanitizer.
 *
 * LAYER: server utility (defense-in-depth for the Reader/document + data-validation
 * write paths). Applied to every document body/description saved through TextService
 * (create + update) and to every validation submission's `content` before it is
 * persisted to the `validations` table.
 *
 * Rationale: document bodies were previously stored verbatim. They are only ever
 * rendered into React text nodes / a controlled `<TextField value>` (never
 * `dangerouslySetInnerHTML`) and written via parameterized SQL, so the live XSS/SQLi
 * surface is low — but there was no explicit content check at all. This closes that
 * gap and normalizes bodies that later flows (e.g. AI segmentation of a flagged
 * suggestion) may re-render or re-process.
 *
 * The sanitizer is intentionally conservative and dependency-free:
 *   - drops NUL and control characters (except \n and \t) that can corrupt display
 *     or terminals downstream,
 *   - normalizes CRLF/CR line endings to \n.
 *
 * It deliberately does NOT HTML-escape (`<`/`>`/`&`). This content is only ever
 * rendered as React text nodes / a `<TextField value>`, which escape on render, so
 * escaping at rest would double-encode — e.g. "Definitions & Parts of Speech" would
 * be stored (and displayed) as "Definitions &amp; Parts of Speech". XSS is handled
 * at render (React), SQLi by parameterized queries; entity-encoding text that is
 * shown as text only corrupts it. Any future raw-HTML sink must escape at that sink.
 *
 * It does NOT trim or enforce length — callers keep their existing length caps.
 *
 * Depended on by: server/services/TextService.ts (validate/create/update),
 * server/services/ValidationService.ts (submitValidation content),
 * server/dal/implementations/DictionaryDAL.ts (isSentenceHumanApproved /
 * isDefinitionsHumanApproved — compare current det data against stored approval
 * content, so they must mirror this sanitizer exactly; this function IS idempotent,
 * so sanitizing once vs. re-sanitizing an already-sanitized value is equivalent),
 * docs/DATA_VALIDATION_SYSTEM.md.
 */

// Control chars to strip: U+0000-U+0008, U+000B, U+000C, U+000E-U+001F, U+007F.
// (Deliberately preserves \t = U+0009 and \n = U+000A.) Built from an ASCII-only
// escape string so this source file contains no literal control bytes.
const CONTROL_CHARS = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]', 'g');

/**
 * Sanitize a user-supplied document body / description / suggestion.
 * Returns the cleaned string. Passing a non-string returns an empty string so
 * callers never propagate `undefined` into a NOT NULL column.
 */
export function sanitizeDocumentContent(input: unknown): string {
  if (typeof input !== 'string') return '';

  return input
    // Normalize Windows/old-Mac line endings first so control-char stripping
    // doesn't leave a lone \r behind.
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS, '');
}

export default sanitizeDocumentContent;
