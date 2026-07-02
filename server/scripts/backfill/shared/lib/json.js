/**
 * Shared model-output JSON extraction for backfill scripts.
 *
 * LAYER: data-enrichment (backfill) utility layer.
 *
 * Replaces the copy-pasted "strip markdown fences, regex out the outermost
 * JSON value, JSON.parse" block that previously appeared in every script.
 *
 * Referenced by: scripts under scripts/backfill/{chinese,spanish}/,
 * README_BACKFILL_SCRIPT.md.
 */

/** Strip a leading/trailing markdown code fence (``` or ```json) if present. */
export function stripCodeFences(text) {
  return String(text ?? '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

/**
 * Extract the outermost balanced JSON object or array from model output text.
 * Walks the string tracking brace/bracket depth (string-and-escape aware), so
 * nested structures and braces inside string values are handled — unlike the
 * old per-script regexes, which broke on nesting.
 *
 * @param {string} text - raw model output (fences are stripped first)
 * @returns {string|null} the JSON slice, or null if no balanced value found
 */
export function extractJsonSlice(text) {
  const s = stripCodeFences(text);
  const start = s.search(/[{[]/);
  if (start === -1) return null;
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parse the outermost JSON value from model output. Returns null (never throws)
 * on garbage — backfill loops treat null as a per-entry failure and move on.
 *
 * @param {string} text - raw model output
 * @returns {any|null}
 */
export function parseModelJson(text) {
  const slice = extractJsonSlice(text);
  if (slice == null) return null;
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}
