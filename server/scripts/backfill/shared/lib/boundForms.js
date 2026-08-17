/**
 * Phrase-bound Chinese headwords that must never enter det or ship as flashcards.
 *
 * LAYER: data-enrichment (backfill) shared lib — consulted by the import and the
 * promotion gate, so a bound base cannot re-enter det from either direction.
 *
 * WHAT THIS IS ABOUT
 * ------------------
 * These are the "huìzi class": multi-syllable words that cannot stand alone. They
 * only ever occur inside a fixed frame headed by 一 or a demonstrative (这/那/好一):
 *
 *     一会子 / 好一会子   ✅        会子   ❌ (never bare)
 *     这家子 / 那家子     ✅        家子   ❌
 *     一辈子 / 半辈子     ✅        辈子   ❌
 *
 * They are NOT classifiers or units. A unit takes any numeral (三分钟, 五海里 are
 * both fine); a phrase-bound noun takes only 一 and the demonstratives — *三会子
 * and *三辈子 are ungrammatical. That contrast is the discriminator, and it is why
 * 分钟/海里/秒/位 are absent from this list even though they always follow a number.
 *
 * WHY A HARDCODED LIST AND NOT A DETECTOR
 * ---------------------------------------
 * CC-CEDICT cannot tell us. Its two boundness markers — `(bound form)` and
 * `used in <hanzi>[pinyin]` — are ~99.8% a SINGLE-CHARACTER device (703 of 704
 * cross-refs; 484 of 487 `(bound form)` tags), because they exist to flag
 * characters that are not free morphemes. There is no representation for a
 * multi-syllable word that is bound at the PHRASE level. Worse, the source is
 * inconsistent about whether such a base gets a headword at all: 會子 has one,
 * while 會兒, 下子, 陣兒 and 些子 have none.
 *
 * The class is also closed and tiny (~15-25 items in the whole language) because
 * the construction is not productive — modern Mandarin builds new duration
 * expressions from free nouns (时间, 期间), not from new bound 子-bases. A denylist
 * is therefore the right weight of tool; a general boundness detector would be
 * heavy machinery for a set that fits on one screen and does not grow.
 *
 * HOW THE LIST WAS DERIVED (2026-08-17 audit of prod det, 114,774 rows)
 * Two complementary detectors, neither sufficient alone:
 *   A. Example-sentence host analysis — the char immediately preceding the headword
 *      across its generated sentences. Never sentence-initial + only 一/这/那 hosts
 *      (and never a true numeral) ⇒ bound. Caught 会子, 家子.
 *   B. Host-prefix co-existence — a base X is bound when 一X/这X/那X/好X/半X exists
 *      as its own det headword and adds no meaning. Caught 辈子, 阵子.
 * A missed 辈子/阵子 (not discoverable ⇒ no example sentences); B missed 会子
 * (一会子 is not in CC-CEDICT at all). Hence both, plus a hand check of the
 * remaining 子/儿-final candidates.
 *
 * Referenced by:
 *   - server/scripts/import-cedict-pg.ts       (skips these lines on import)
 *   - server/scripts/backfill/promote-discoverable.js  (refuses to promote)
 *   - docs/BOUND_FORM_WORDS.md                 (the class, and the teaching work item)
 */

/**
 * Simplified-form bases that are phrase-bound. Keyed by the bare base; `hosts`
 * lists the frames it actually appears in, and `note` says why it is here.
 *
 * Entries marked `inDet: false` were never in CC-CEDICT and so never reached det —
 * they are listed anyway so a future dictionary source cannot introduce them
 * silently.
 */
export const ZH_BOUND_FORMS = [
  // --- Removed from prod det on 2026-08-17 (all six existed as headwords) ---
  { base: '会子', hosts: ['一会子', '好一会子'],           gloss: 'a while',        inDet: true,  removed: '2026-08-17' },
  { base: '家子', hosts: ['一家子', '这家子', '那家子'],   gloss: 'household',      inDet: true,  removed: '2026-08-17' },
  { base: '辈子', hosts: ['一辈子', '半辈子', '这辈子'],   gloss: 'lifetime',       inDet: true,  removed: '2026-08-17' },
  { base: '阵子', hosts: ['一阵子', '这阵子', '那阵子'],   gloss: 'period of time', inDet: true,  removed: '2026-08-17' },
  { base: '程子', hosts: ['一程子', '这程子'],             gloss: 'a while (Beijing dialect)', inDet: true, removed: '2026-08-17' },
  { base: '当儿', hosts: ['这当儿', '那当儿', '一当儿'],   gloss: 'the very moment', inDet: true, removed: '2026-08-17' },

  // --- Never in CC-CEDICT, so never in det. Listed to keep the class complete. ---
  { base: '会儿', hosts: ['一会儿', '这会儿', '那会儿', '待会儿'], gloss: 'a moment',      inDet: false },
  { base: '下子', hosts: ['一下子'],                       gloss: 'all at once',    inDet: false },
  { base: '阵儿', hosts: ['一阵儿', '这阵儿'],             gloss: 'a spell',        inDet: false },
  { base: '些子', hosts: ['一些子'],                       gloss: 'a little',       inDet: false },
  { base: '溜儿', hosts: ['一溜儿'],                       gloss: 'a row of',       inDet: false },
  { base: '忽儿', hosts: ['一忽儿'],                       gloss: 'a moment',       inDet: false },
  { base: '霎儿', hosts: ['一霎儿'],                       gloss: 'an instant',     inDet: false },
  { base: '半会儿', hosts: ['一半会儿', '三天半会儿'],     gloss: 'a short while',  inDet: false },
];

/** Fast membership set over the bare bases. */
const BOUND_SET = new Set(ZH_BOUND_FORMS.map((e) => e.base));

/**
 * True when `word1` is a phrase-bound base that must not be stored or promoted.
 * Only meaningful for zh; callers for other languages should not consult this.
 */
export function isZhBoundForm(word1) {
  return BOUND_SET.has(word1);
}

/** The frames a bound base legitimately appears in — for error messages and UI copy. */
export function zhBoundFormHosts(word1) {
  return ZH_BOUND_FORMS.find((e) => e.base === word1)?.hosts ?? [];
}
