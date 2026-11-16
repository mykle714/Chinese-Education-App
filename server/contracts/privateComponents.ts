/**
 * Private-use component ids — character parts that Unicode cannot encode.
 *
 * LAYER: shared contract (read by BOTH halves). The decomposition pipeline writes these
 * ids into `dictionaryentries_zh.components`; the client draws them (they have no font
 * glyph) and names them for assistive tech.
 *
 * Consumers:
 *   - server/scripts/backfill/chinese/lib/decompose.js → WRITTEN_FORM_OVERRIDES (stores them)
 *   - src/components/handwriting/ComponentGlyph.tsx (aria label; the outline itself is in
 *     componentDisplayForms.generated.ts)
 *   - src/features/beginnerKeyboard/compositionRules.ts → toGlyphCandidates (no
 *     self-"covers" bubble: there is no font glyph to show in it)
 * Spec: docs/BEGINNER_KEYBOARD.md § 6z-15.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A PRIVATE-USE CODEPOINT
 *
 * Every component is ONE character end to end: the template asset stores a u32
 * codepoint per glyph, the lookup index keys parts by character, and a chip's `text`
 * is what enters the buffer. A part Unicode cannot encode (it exists only as an IDS
 * description) therefore takes a codepoint from the Private Use Area (U+E000–U+F8FF),
 * which no font maps — so it must ALWAYS be drawn from its outline, never printed.
 */

/**
 * U+E000 — the "meat" radical ⺼ as written in 然 祭 炙: 夕 with a second dot (cjkvi IDS
 * `⿴𠂊冫`; 夕 itself is `⿴𠂊丶`). Four strokes, the same count as 月/⺼, but shaped like
 * 夕, so neither a 月 chip nor a 夕 chip shows what the learner sees.
 */
export const MEAT_TWO_DOT_FORM = '';

/** Human-readable name per private component — for aria labels and logs. */
export const PRIVATE_COMPONENT_NAMES: Readonly<Record<string, string>> = {
  [MEAT_TWO_DOT_FORM]: '夕 with a second dot, the top-left of 然',
};

/** True when `glyph` is a Private Use Area codepoint (no font can print it). */
export function isPrivateComponent(glyph: string): boolean {
  const codePoint = glyph.codePointAt(0);
  return glyph.length === 1 && codePoint !== undefined && codePoint >= 0xe000 && codePoint <= 0xf8ff;
}
