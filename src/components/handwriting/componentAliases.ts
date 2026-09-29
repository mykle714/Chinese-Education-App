/**
 * Look-alike components the beginner keyboard treats as ONE component.
 *
 * LAYER: pure client utility — a constant table and two lookups, no imports.
 * Read by glyphLookup.ts (the index remaps each alias's bag slots onto its
 * canonical form at parse) and compositionRules.ts (the glyph row merges an
 * alias's chip into its canonical form's chip).
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6z-7.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY MERGE RATHER THAN DISTINGUISH
 *
 * Each pair differs in ROLE or PROPORTION, not in stroke shape: 囗 is 口 drawn as
 * a frame around the whole character; 曰 is 日 drawn wide; 士 is 土 with the long
 * horizontal on top; 卩 and 阝 share a template to within 0.027. The matcher
 * normalizes every drawing to its own bounding box — which is exactly what erases
 * size and proportion — so no threshold on the ink can reliably tell the members
 * apart, and a wrong guess is silent: tap 口 for 国's frame, add 玉, and 国 simply
 * never appears.
 *
 * So the search stops asking. A drawn box finds 国 and 叫 alike, and the learner
 * resolves the ambiguity by tapping the character they meant — the keyboard's
 * standing rule (§ 6h: "ambiguity is resolved by the learner, not the system").
 * The accepted cost: 口 土 now answers both 吉 (口士) and 吐 (口土).
 *
 * ⚠️ This is a KEYBOARD-ONLY view. `dictionaryentries_zh.components` still says
 * 囗 for 国, and every other feature reading that column is unaffected.
 *
 * The CANONICAL form of each pair is the one that builds more characters in the
 * index (measured 2026-09-27: 口 880 vs 囗 80, 阝 137 vs 卩 18, 日 313 vs 曰 15,
 * 土 320 vs 士 40), so the chip and buffer show the shape a learner most expects.
 */

/** alias → canonical. Keep each class to ONE canonical form (no chains). */
export const COMPONENT_ALIASES: Readonly<Record<string, string>> = {
  囗: '口',
  卩: '阝',
  曰: '日',
  士: '土',
};

/** The form the keyboard shows and searches for `glyph` — itself when it has no alias. */
export function canonicalComponent(glyph: string): string {
  return COMPONENT_ALIASES[glyph] ?? glyph;
}

/**
 * Every glyph the keyboard treats as `glyph` — its canonical form first, then its
 * aliases. A glyph outside the table is a class of one.
 */
export function aliasClass(glyph: string): string[] {
  const canonical = canonicalComponent(glyph);
  return [
    canonical,
    ...Object.keys(COMPONENT_ALIASES).filter((alias) => COMPONENT_ALIASES[alias] === canonical),
  ];
}
