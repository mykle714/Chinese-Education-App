const TONE_MARK_MAP: Record<string, number> = {
  'ā': 1, 'á': 2, 'ǎ': 3, 'à': 4,
  'ē': 1, 'é': 2, 'ě': 3, 'è': 4,
  'ī': 1, 'í': 2, 'ǐ': 3, 'ì': 4,
  'ō': 1, 'ó': 2, 'ǒ': 3, 'ò': 4,
  'ū': 1, 'ú': 2, 'ǔ': 3, 'ù': 4,
  'ǖ': 1, 'ǘ': 2, 'ǚ': 3, 'ǜ': 4,
};

/**
 * Tone -> color. The four tones are their own semantic axis: a tone color does NOT mean
 * "this syllable is comfortable" just because it shares a hue with a band. The hues are
 * shared for palette economy only.
 *
 * ⚠️ These five hexes are LITERAL ON PURPOSE — do not re-point them at the OKLCH ramp
 * in `theme/colors.ts`. The design owns this set exactly as written: the tone
 * exploration board lists it as the `current` set in tone order
 * (`['#EF476F','#05C793','#779BE7','#FF8E47']`) and every artboard that renders pinyin
 * spells these values inline (dictionary rows, card faces, the cpcd, the flp sense
 * rail). The redesign moved SURFACES to the pastel ramp; it did not move the tones.
 *
 * One deliberate departure from that board (2026-09-05): tone 4 was warmed from the
 * board's orange `#FF8E47` to gold `#EB9721` at the user's request — same OKLCH
 * lightness band, hue rotated 50° → 68° toward yellow, chroma held. Darkening the
 * lightness slightly (0.757 → 0.745) pays for the hue move, so contrast against the
 * warm `--paper` ground actually IMPROVES (2.19:1 → 2.24:1; 2.13 → 2.18 on `cardFace`).
 * Pure yellow is not available here: at this chroma, hues past ~80° cannot hold that
 * contrast without going muddy.
 * A previous pass aliased these to `COLORS.redA/grnA/bluA/orgA` and that was wrong —
 * those inks are a different, darker hue set and pinyin stopped matching the design.
 *
 * Cited by docs/SHELF_REDESIGN.md (D2) and docs/CPCD_PINYIN_SHIFT.md.
 */
export const TONE_COLORS: Record<number, string> = {
  1: '#EF476F', // red    — tone 1
  2: '#05C793', // green  — tone 2
  3: '#779BE7', // blue   — tone 3
  4: '#EB9721', // gold   — tone 4
  0: '#9E9E9E', // grey   — neutral tone
};

export function getToneColor(pinyin: string): string {
  for (const char of pinyin) {
    const tone = TONE_MARK_MAP[char];
    if (tone !== undefined) return TONE_COLORS[tone];
  }
  return TONE_COLORS[0];
}
