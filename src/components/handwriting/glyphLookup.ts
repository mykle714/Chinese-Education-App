/**
 * The beginner keyboard's REVERSE LOOKUP: a buffer of submitted components in,
 * a ranked list of candidate characters (or words) out.
 *
 * LAYER: pure client logic. No network, no DOM, no React. Together with
 * glyphMatcher.ts this makes the whole keyboard offline — the lookup re-runs on
 * every component tap and every removal (§ 6r), and a network round-trip per tap
 * is not a keyboard, it is a search box.
 *
 * ⚠️ This supersedes § 6g's "server service" row, which put this lookup on the
 * server behind a thin read. Same algorithm, moved to the client; no endpoint,
 * no DAL, no migration.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6h (containment), § 6k (ranking),
 * § 6n (the atomic rescue), § 6q (the 2–4 character word fallback),
 * § 6z-4 (the hint bubble's common-character search).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A LINEAR SCAN AND NOT AN INVERTED INDEX
 *
 * § 6e describes an in-memory inverted index, which is the right shape for a
 * server holding one index for all users. On the client the whole corpus is
 * 9,855 characters — a full scan is a few hundred microseconds, far below the
 * frame budget, and it re-runs only on a tap. Posting lists would add a build
 * step, a second representation to keep consistent with the bags, and a few
 * hundred KB of memory to save time that was never being spent.
 *
 * The same reasoning covers the 99,199-word fallback pool: it is ~10× larger but
 * fires only when the character search returns EMPTY (§ 6q), and its bags are
 * derived once at parse rather than per query.
 */
import lookupUrl from '../../assets/handwriting/glyph-lookup.bin?url';
import wordsUrl from '../../assets/handwriting/glyph-words.bin?url';

const INDEX_MAGIC = 'HWLK';
const WORDS_MAGIC = 'HWWD';
/**
 * The two assets version independently (see the generator): index v2 added the
 * per-character reading and the COMMON flag; the word pool is still v1.
 */
const INDEX_VERSION = 2;
const WORDS_VERSION = 1;

/**
 * Flags byte, per character. Mirrored by `FLAG_*` in
 * server/scripts/backfill/chinese/generate-handwriting-lookup.js — change both together.
 */
const FLAG_DISCOVERABLE = 1;
/** § 6z-4: the character appears in a headword with `frequencyScore` ≥ 4. */
const FLAG_COMMON = 2;

export interface GlyphLookupIndex {
  /** Component character for component id i. */
  components: string[];
  /** Component character → id. */
  componentIds: Map<string, number>;
  /** Headword character for record i. */
  chars: string[];
  /** Character → record index, for the § 6n rescue's headword test. */
  charIndex: Map<string, number>;
  /** `frequencyScore`, 1–5, or 0 for NULL. */
  freq: Uint8Array;
  /** Flags bitfield; bit 0 = discoverable, bit 1 = common (§ 6z-4). */
  flags: Uint8Array;
  /** The row's default `pronunciation` (tone-marked pinyin), or '' when NULL. */
  readings: string[];
  /** In-corpus usage count — how many multi-character words contain it. */
  usage: Uint16Array;
  /** Index into `bags` where record i's components begin. */
  bagOffsets: Uint32Array;
  /** Component count for record i. 0 = atomic (§ 6n). */
  bagSizes: Uint8Array;
  /** All component ids, concatenated. */
  bags: Uint16Array;
}

export interface GlyphWordPool {
  /** The word text for record i. */
  words: string[];
  /** `frequencyScore`, 1–5, or 0 for NULL. */
  freq: Uint8Array;
  /** Index into `bags` where word i's derived components begin. */
  bagOffsets: Uint32Array;
  /** Derived component count for word i. */
  bagSizes: Uint16Array;
  /** All derived component ids, concatenated. */
  bags: Uint16Array;
}

export interface LookupCandidate {
  /** The character or word to display. */
  text: string;
  /**
   * Extra components the candidate still needs — `bag size − buffer size`.
   * Containment guarantees this is ≥ 0; 0 means the buffer IS the candidate's
   * full bag.
   */
  distance: number;
  /** True when this came from the § 6q word fallback rather than the character index. */
  isWord: boolean;
}

function readHeader(buffer: ArrayBuffer, magic: string, label: string, expectedVersion: number) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const found = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (found !== magic) throw new Error(`${label}: bad magic "${found}" (expected "${magic}")`);
  const version = view.getUint8(4);
  if (version !== expectedVersion) {
    throw new Error(
      `${label}: format version ${version}, expected ${expectedVersion}. Regenerate ` +
        `(scripts/backfill/chinese/generate-handwriting-lookup.js).`,
    );
  }
  return view;
}

/** Decode the character index. Throws on header mismatch rather than reading on. */
export function parseGlyphLookup(buffer: ArrayBuffer): GlyphLookupIndex {
  const view = readHeader(buffer, INDEX_MAGIC, 'glyph-lookup.bin', INDEX_VERSION);
  const componentCount = view.getUint32(8, true);
  const charCount = view.getUint32(12, true);

  let cursor = 16;
  const components: string[] = new Array(componentCount);
  const componentIds = new Map<string, number>();
  for (let i = 0; i < componentCount; i++) {
    const component = String.fromCodePoint(view.getUint32(cursor, true));
    cursor += 4;
    components[i] = component;
    componentIds.set(component, i);
  }

  const chars: string[] = new Array(charCount);
  const charIndex = new Map<string, number>();
  const freq = new Uint8Array(charCount);
  const flags = new Uint8Array(charCount);
  const usage = new Uint16Array(charCount);
  const bagOffsets = new Uint32Array(charCount);
  const bagSizes = new Uint8Array(charCount);
  const readings: string[] = new Array(charCount);
  const utf8 = new TextDecoder('utf-8');
  const bytes = new Uint8Array(buffer);

  // First pass: fixed fields and bag sizes, so `bags` is one right-sized
  // allocation rather than a growing array.
  const recordStart = cursor;
  let total = 0;
  for (let i = 0; i < charCount; i++) {
    chars[i] = String.fromCodePoint(view.getUint32(cursor, true));
    freq[i] = view.getUint8(cursor + 4);
    flags[i] = view.getUint8(cursor + 5);
    usage[i] = view.getUint16(cursor + 6, true);
    const size = view.getUint8(cursor + 8);
    bagSizes[i] = size;
    bagOffsets[i] = total;
    total += size;
    charIndex.set(chars[i], i);
    cursor += 9 + size * 2;
    // v2: a length-prefixed UTF-8 reading trails the bag.
    const readingBytes = view.getUint8(cursor);
    readings[i] = readingBytes === 0 ? '' : utf8.decode(bytes.subarray(cursor + 1, cursor + 1 + readingBytes));
    cursor += 1 + readingBytes;
  }

  // Second pass: the bags themselves.
  const bags = new Uint16Array(total);
  cursor = recordStart;
  let write = 0;
  for (let i = 0; i < charCount; i++) {
    const size = view.getUint8(cursor + 8);
    cursor += 9;
    for (let k = 0; k < size; k++) {
      bags[write++] = view.getUint16(cursor, true);
      cursor += 2;
    }
    cursor += 1 + view.getUint8(cursor); // skip the reading, decoded in pass one
  }

  return { components, componentIds, chars, charIndex, freq, flags, readings, usage, bagOffsets, bagSizes, bags };
}

/**
 * Decode the word pool AND derive each word's component bag.
 *
 * The bag is the multiset union of the word's characters' bags (§ 6q) — it is
 * not stored, because storing it would duplicate the character index and add
 * something that can drift from it. Deriving it once here rather than per query
 * is what keeps the fallback a linear scan over precomputed data.
 *
 * A character outside the index contributes nothing, which is correct: it makes
 * the word's bag smaller and therefore easier to contain, never wrongly excluded.
 */
export function parseGlyphWords(buffer: ArrayBuffer, index: GlyphLookupIndex): GlyphWordPool {
  const view = readHeader(buffer, WORDS_MAGIC, 'glyph-words.bin', WORDS_VERSION);
  const wordCount = view.getUint32(8, true);

  const words: string[] = new Array(wordCount);
  const freq = new Uint8Array(wordCount);
  const bagOffsets = new Uint32Array(wordCount);
  const bagSizes = new Uint16Array(wordCount);

  // Decode the text first; the bags need the characters to look up.
  let cursor = 12;
  const units: number[] = [];
  for (let i = 0; i < wordCount; i++) {
    freq[i] = view.getUint8(cursor++);
    const unitCount = view.getUint8(cursor++);
    units.length = 0;
    for (let k = 0; k < unitCount; k++) {
      units.push(view.getUint16(cursor, true));
      cursor += 2;
    }
    words[i] = String.fromCharCode(...units);
  }

  // Size the bag array, then fill it — two passes over the same cheap lookup
  // rather than one growing array across ~660k entries.
  let total = 0;
  for (let i = 0; i < wordCount; i++) {
    let size = 0;
    for (const ch of words[i]) {
      const record = index.charIndex.get(ch);
      if (record !== undefined) size += index.bagSizes[record];
    }
    bagSizes[i] = size;
    bagOffsets[i] = total;
    total += size;
  }

  const bags = new Uint16Array(total);
  let write = 0;
  for (let i = 0; i < wordCount; i++) {
    for (const ch of words[i]) {
      const record = index.charIndex.get(ch);
      if (record === undefined) continue;
      const start = index.bagOffsets[record];
      for (let k = 0; k < index.bagSizes[record]; k++) bags[write++] = index.bags[start + k];
    }
  }

  return { words, freq, bagOffsets, bagSizes, bags };
}

/**
 * Turn a buffer of component characters into counts by component id.
 *
 * Returns null when the buffer contains a component the index does not know —
 * such a buffer can match nothing, and saying so here keeps the scan loops from
 * having to represent "impossible".
 */
function bufferCounts(buffer: readonly string[], index: GlyphLookupIndex) {
  const counts = new Map<number, number>();
  for (const component of buffer) {
    const id = index.componentIds.get(component);
    if (id === undefined) return null;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Multiset containment: does the bag at [start, start+size) hold at least as many
 * of every component as the buffer does?
 *
 * ⚠️ This is deliberately NOT what `jsonb @>` gives you (§ 6e). Bare containment
 * discards multiplicity, so a buffer of 人人 would match 人 itself. Counting is
 * the whole point: submitting 人 twice must keep 从 and 众 and drop 人.
 *
 * `scratch` is a caller-owned counter array indexed by component id, reused
 * across every candidate so the scan allocates nothing.
 */
function contains(
  bags: Uint16Array,
  start: number,
  size: number,
  counts: Map<number, number>,
  scratch: Int32Array,
): boolean {
  for (let k = 0; k < size; k++) scratch[bags[start + k]]++;
  let ok = true;
  for (const [id, needed] of counts) {
    if (scratch[id] < needed) {
      ok = false;
      break;
    }
  }
  // Reset only what was touched — clearing all 895 slots per candidate would
  // cost more than the test itself.
  for (let k = 0; k < size; k++) scratch[bags[start + k]] = 0;
  return ok;
}

/**
 * § 6k's ordering, as a comparator.
 *
 * 1. distance ascending — an exact bag beats a longer one that merely contains it
 * 2. frequencyScore descending, NULLS LAST
 * 3. discoverable first — floats the 258 characters the app actually teaches up
 *    inside the huge NULL-frequency tie group
 * 4. in-corpus usage descending — the tie-break that carries the ordering today
 *
 * ⚠️ Level 2's NULLS-LAST behaviour is why the generator stores NULL as 0: a
 * plain descending sort then puts unscored characters last automatically, which
 * is the opposite of what Postgres would do with a bare `ORDER BY … DESC`.
 *
 * Level 4 is not a stopgap. `frequencyScore` is a 1–5 integer even when fully
 * backfilled, so it will always leave large tie groups needing an ordering.
 */
function compareCharacters(
  a: { record: number; distance: number },
  b: { record: number; distance: number },
  index: GlyphLookupIndex,
): number {
  if (a.distance !== b.distance) return a.distance - b.distance;
  if (index.freq[a.record] !== index.freq[b.record]) return index.freq[b.record] - index.freq[a.record];
  const aDiscoverable = index.flags[a.record] & FLAG_DISCOVERABLE;
  const bDiscoverable = index.flags[b.record] & FLAG_DISCOVERABLE;
  if (aDiscoverable !== bDiscoverable) return bDiscoverable - aDiscoverable;
  return index.usage[b.record] - index.usage[a.record];
}

/**
 * Characters whose component bag contains the buffer, ranked by § 6k.
 *
 * `limit` caps the RETURNED list, never the search — § 6k is explicit that the
 * display truncates and the query does not, because a candidate's rank is only
 * meaningful against the whole set.
 */
export function lookupCharacters(
  buffer: readonly string[],
  index: GlyphLookupIndex,
  limit = 0,
): LookupCandidate[] {
  if (buffer.length === 0) return [];
  const counts = bufferCounts(buffer, index);
  if (counts === null) return [];

  const scratch = new Int32Array(index.components.length);
  const hits: { record: number; distance: number }[] = [];

  for (let i = 0; i < index.chars.length; i++) {
    const size = index.bagSizes[i];
    // Containment can only hold if the candidate has at least as many components
    // as the buffer — a cheap reject that skips most of the corpus, and the
    // reason atomic characters cost nothing to carry here.
    if (size < buffer.length) continue;
    if (contains(index.bags, index.bagOffsets[i], size, counts, scratch)) {
      hits.push({ record: i, distance: size - buffer.length });
    }
  }

  // § 6n: an atomic character is structurally invisible to containment — its bag
  // holds nothing, so it can never contain a buffer. A one-component buffer
  // whose component is itself a headword therefore enters at distance 0, which
  // is what makes 人 口 木 大 子 reachable at all.
  if (buffer.length === 1) {
    const self = index.charIndex.get(buffer[0]);
    if (self !== undefined && !hits.some((hit) => hit.record === self)) {
      hits.push({ record: self, distance: 0 });
    }
  }

  hits.sort((a, b) => compareCharacters(a, b, index));
  const ranked = hits.map(({ record, distance }) => ({
    text: index.chars[record],
    distance,
    isWord: false,
  }));
  return limit > 0 ? ranked.slice(0, limit) : ranked;
}

/**
 * Words whose derived component bag contains the buffer, ranked by § 6k.
 *
 * ⚠️ Distance-first is load-bearing here, not cosmetic. Containment is superset
 * matching, so admitting 3- and 4-character words inflates what a 2-character
 * learner sees ninefold (median 1 → 9 candidates). That is survivable only
 * because an exact-length match always precedes a longer word that merely
 * contains the buffer. If this ordering ever stops leading with distance, § 6q's
 * 2–4 extension must be re-measured before shipping.
 */
export function lookupWords(
  buffer: readonly string[],
  index: GlyphLookupIndex,
  pool: GlyphWordPool,
  limit = 0,
): LookupCandidate[] {
  if (buffer.length === 0) return [];
  const counts = bufferCounts(buffer, index);
  if (counts === null) return [];

  const scratch = new Int32Array(index.components.length);
  const hits: { record: number; distance: number }[] = [];

  for (let i = 0; i < pool.words.length; i++) {
    const size = pool.bagSizes[i];
    if (size < buffer.length) continue;
    if (contains(pool.bags, pool.bagOffsets[i], size, counts, scratch)) {
      hits.push({ record: i, distance: size - buffer.length });
    }
  }

  // Words carry no usage count, so the key is distance then frequency; the
  // generator emits them in a stable order, so equal keys stay deterministic.
  hits.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    return pool.freq[b.record] - pool.freq[a.record];
  });

  const ranked = hits.map(({ record, distance }) => ({
    text: pool.words[record],
    distance,
    isWord: true,
  }));
  return limit > 0 ? ranked.slice(0, limit) : ranked;
}

/**
 * Translate a selected glyph into the component alphabet the index is keyed on.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ THE PROBLEM THIS SOLVES (found in real use, 2026-09-07)
 *
 * A learner writing 你 draws 亻 and then 尔, because that is how a human sees the
 * character. But `components` decomposes 你 to level-1 leaves — `[亻, ⺈, 小]` —
 * and 尔 is not a component at all; it is itself `[⺈, 小]`. So the buffer the
 * learner built could never match, and expecting them to know the canonical
 * decomposition is not reasonable: nothing on screen teaches it.
 *
 * The fix: the 895 components are the ALPHABET, and anything the learner selects
 * from outside it is translated into that alphabet on the way into the buffer.
 * Drawing 亻 then 尔 now yields `[亻, ⺈, 小]` — exactly 你's stored bag.
 *
 * ⚠️ IT IS ONE LEVEL, AND IT IS CONDITIONAL. Two mistakes to avoid:
 *
 *   1. NOT "always expand". 丁 IS a registered component (of 打), and also a
 *      headword decomposing to `[一]`. Expanding it would destroy 打. So a glyph
 *      that is already in the alphabet is passed through untouched.
 *   2. NOT recursive. The stored bags are already at leaf granularity —
 *      `想 → [木, 目, 心]` and none of those decompose further. Recursing anyway
 *      would shred bags past the granularity the index is keyed on.
 *
 * A glyph that is neither a component nor a decomposable headword (209 atomic
 * headwords, plus 114 template glyphs absent from the index) returns itself. The
 * atomic case is correct — § 6n's rescue handles it — and the absent case is
 * best-effort: it will simply not match anything.
 */
export function expandGlyph(glyph: string, index: GlyphLookupIndex): string[] {
  // Already in the alphabet: pass through. This branch is what protects 丁.
  if (index.componentIds.has(glyph)) return [glyph];

  const record = index.charIndex.get(glyph);
  if (record === undefined) return [glyph];
  const size = index.bagSizes[record];
  if (size === 0) return [glyph];

  const start = index.bagOffsets[record];
  const out: string[] = [];
  for (let i = 0; i < size; i++) out.push(index.components[index.bags[start + i]]);
  return out;
}

export interface HintCharacter {
  /** The suggested character. */
  text: string;
  /** Its default reading, for the ForeignText row in the bubble ('' when unknown). */
  pronunciation: string;
  /** Components still missing after buffer + glyph — 0 means the pair completes it. */
  distance: number;
}

/**
 * Record indices of the COMMON characters, built once per index.
 *
 * The hint search runs once per glyph candidate on every stroke (up to 12 scans
 * per ink change), so it scans only the ~760 common records rather than all
 * ~9,900. A WeakMap keyed on the index keeps this cache from outliving it.
 */
const commonRecordCache = new WeakMap<GlyphLookupIndex, Uint32Array>();

function commonRecords(index: GlyphLookupIndex): Uint32Array {
  let records = commonRecordCache.get(index);
  if (!records) {
    const list: number[] = [];
    for (let i = 0; i < index.chars.length; i++) if (index.flags[i] & FLAG_COMMON) list.push(i);
    records = Uint32Array.from(list);
    commonRecordCache.set(index, records);
  }
  return records;
}

/**
 * § 6z-4 — the hint bubble over a glyph candidate: the best COMMON character that
 * the buffer plus this glyph is on track to spell.
 *
 * "On track" is the same multiset containment the result row uses (§ 6h), applied
 * to the buffer the learner WOULD have if they tapped this glyph — i.e. the glyph
 * goes through `expandGlyph` exactly as `selectCandidate` would put it in the
 * buffer, so a hint can never promise a character the tap would not lead to.
 *
 * Ranked by § 6k (fewest missing components first, then frequency, discoverable,
 * usage), restricted to characters flagged COMMON (in a freq 4–5 headword).
 *
 * ⚠️ There is no § 6n atomic rescue here, on purpose: the hint only fires with a
 * non-empty buffer, so the would-be buffer always holds ≥ 2 components and an
 * atomic character (empty bag) can never be what it spells.
 *
 * Returns null when no common character contains the would-be buffer.
 */
export function findHintCharacter(
  buffer: readonly string[],
  glyph: string,
  index: GlyphLookupIndex,
): HintCharacter | null {
  const prospective = [...buffer, ...expandGlyph(glyph, index)];
  const counts = bufferCounts(prospective, index);
  if (counts === null) return null;

  const scratch = new Int32Array(index.components.length);
  let best: { record: number; distance: number } | null = null;
  for (const record of commonRecords(index)) {
    const size = index.bagSizes[record];
    if (size < prospective.length) continue;
    if (!contains(index.bags, index.bagOffsets[record], size, counts, scratch)) continue;
    const hit = { record, distance: size - prospective.length };
    if (best === null || compareCharacters(hit, best, index) < 0) best = hit;
  }
  if (best === null) return null;
  return {
    text: index.chars[best.record],
    pronunciation: index.readings[best.record],
    distance: best.distance,
  };
}

/**
 * The full lookup the keyboard calls: characters, falling back to words.
 *
 * ⚠️ The fallback fires on EMPTY, not on "few" (§ 6q). The learner has no way to
 * signal "this character is finished", so a buffer can accumulate parts spanning
 * two characters — nothing single-character contains it, the bar goes empty, and
 * the feature looks broken at the exact moment the learner is being reasonable.
 * Firing on a *small* list instead would flood the common case with words.
 *
 * `pool` may be null: the word asset is ~6× the index and loads separately, so
 * the fallback simply does not fire until it lands.
 */
export function lookupBuffer(
  buffer: readonly string[],
  index: GlyphLookupIndex,
  pool: GlyphWordPool | null,
  limit = 0,
): LookupCandidate[] {
  const characters = lookupCharacters(buffer, index, limit);
  if (characters.length > 0 || !pool) return characters;
  return lookupWords(buffer, index, pool, limit);
}

let cachedIndex: Promise<GlyphLookupIndex> | null = null;
let cachedWords: Promise<GlyphWordPool> | null = null;

async function fetchBuffer(url: string, label: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  return response.arrayBuffer();
}

/** Fetch and decode the character index, once per session. */
export function loadGlyphLookup(): Promise<GlyphLookupIndex> {
  if (!cachedIndex) {
    cachedIndex = fetchBuffer(lookupUrl, 'glyph-lookup.bin')
      .then(parseGlyphLookup)
      // A REJECTED promise is cleared, so a transient network failure does not
      // permanently disable the keyboard for the session.
      .catch((err) => {
        cachedIndex = null;
        throw err;
      });
  }
  return cachedIndex;
}

/**
 * Fetch and decode the word pool, once per session.
 *
 * Depends on the index, since the bags are derived from it. Callers should start
 * this alongside the index rather than waiting for it — the keyboard is fully
 * usable before it resolves, and only the § 6q fallback is inert until then.
 */
export function loadGlyphWords(): Promise<GlyphWordPool> {
  if (!cachedWords) {
    cachedWords = Promise.all([loadGlyphLookup(), fetchBuffer(wordsUrl, 'glyph-words.bin')])
      .then(([index, buffer]) => parseGlyphWords(buffer, index))
      .catch((err) => {
        cachedWords = null;
        throw err;
      });
  }
  return cachedWords;
}
