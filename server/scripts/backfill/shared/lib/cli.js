/**
 * Shared CLI argument parsing for backfill scripts (Chinese + Spanish).
 *
 * LAYER: data-enrichment (backfill) utility layer.
 *
 * Replaces the copy-pasted `--spot-check` / `--words=` / `--batch` parsing that
 * previously lived at the top of every script, and — importantly — replaces the
 * string-interpolated words filter with a PARAMETERIZED one (`= ANY($n)`), so
 * word lists never touch SQL text.
 *
 * Referenced by: every script under scripts/backfill/{chinese,spanish}/,
 * README_BACKFILL_SCRIPT.md.
 */

/**
 * Parse the standard backfill flags from argv.
 *
 * @param {string[]} [argv] - defaults to process.argv.slice(2)
 * @returns {{
 *   isSpotCheck: boolean,     // --spot-check → process ~5 entries only
 *   isBatch: boolean,         // --batch → run via the Message Batches API (50% price)
 *   targetWords: string[]|null, // --words=a,b,c → scope to specific words
 *   flags: string[],          // all raw --flags (for run-log / custom flags)
 * }}
 */
export function parseBackfillArgs(argv = process.argv.slice(2)) {
  const isSpotCheck = argv.includes('--spot-check');
  const isBatch = argv.includes('--batch');
  const wordsArg = argv.find(a => a.startsWith('--words='));
  const targetWords = wordsArg
    ? wordsArg.slice('--words='.length).split(',').map(s => s.trim()).filter(Boolean)
    : null;
  const flags = argv.filter(a => a.startsWith('--'));
  return { isSpotCheck, isBatch, targetWords, flags };
}

/**
 * Build a parameterized `AND <column> = ANY($n)` filter for a word scope.
 *
 * Usage:
 *   const params = [];
 *   const wordsFilter = wordsWhereClause('word1', targetWords, params);
 *   client.query(`SELECT ... WHERE language = 'zh' ${wordsFilter}`, params);
 *
 * @param {string} column        - column name (caller-controlled constant, not user input)
 * @param {string[]|null} words  - the --words list, or null for no filter
 * @param {any[]} params         - the query's params array; the word list is pushed onto it
 * @returns {string} '' when no filter, else `AND <column> = ANY($n)`
 */
export function wordsWhereClause(column, words, params) {
  if (!words || words.length === 0) return '';
  params.push(words);
  return `AND ${column} = ANY($${params.length})`;
}
