import Anthropic from '@anthropic-ai/sdk';
import { IDictionaryDAL } from '../dal/interfaces/IDictionaryDAL.js';
import { DictionaryEntry, VocabEntry, AiDictionaryEntry } from '../types/index.js';
import { ValidationError, RateLimitError } from '../types/dal.js';
import { getAllSubstrings, buildDictMap, buildExcludeSet, segmentWithDict } from '../dal/shared/segmentString.js';
import { DICTIONARY_AI_DAILY_LIMIT } from '../constants.js';

// One shared Anthropic client for the service's AI helpers (long definition,
// AI fallback). Constructed lazily so a missing ANTHROPIC_API_KEY only disables
// the AI paths (callers already null-check) instead of throwing at import time.
let anthropicClient: Anthropic | null = null;
function getAnthropicClient(): Anthropic | null {
  if (anthropicClient) return anthropicClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  anthropicClient = new Anthropic({ apiKey });
  return anthropicClient;
}

// Separate client for the dictionary AI synthetic-entry fallback (docs/DICTIONARY_AI_FALLBACK_SEARCH.md),
// keyed on its OWN DICT_AI_API_KEY so this feature's usage/billing is isolated from the enrichment
// helpers above. Missing key ⇒ the feature is silently disabled (no "AI" button ever offered).
let dictAiClient: Anthropic | null = null;
function getDictAiClient(): Anthropic | null {
  if (dictAiClient) return dictAiClient;
  const apiKey = process.env.DICT_AI_API_KEY;
  if (!apiKey) return null;
  dictAiClient = new Anthropic({ apiKey });
  return dictAiClient;
}

// A cached EMPTY AI result older than this is treated as a miss so the model is re-prompted.
const AI_EMPTY_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // ~3 months

// CJK-ideograph test (BMP + Ext-A), mirroring the client's textUtils.hasChinese. Used to route a
// query down the Chinese (vs pinyin) branch of the AI synthetic-entry fallback.
const hasChinese = (text: string): boolean => /[一-鿿㐀-䶿]/.test(text);

// The AI-fallback UI state a search resolves to (docs/DICTIONARY_AI_FALLBACK_SEARCH.md):
//   canAskAi  — offer the "AI" button (cache miss or stale-empty)
//   aiEntry   — a cached non-empty answer to auto-render (orange card)
//   aiNoMatch — a fresh cached EMPTY answer: the AI already found nothing → show the no-match note
// At most one of the three is "active" at a time.
interface AiFallbackState {
  canAskAi: boolean;
  aiEntry: AiDictionaryEntry | null;
  aiNoMatch: boolean;
}

/**
 * Dictionary Service - Contains business logic for dictionary operations
 * Handles CC-CEDICT dictionary lookups for the reader feature
 */
export class DictionaryService {
  constructor(private dictionaryDAL: IDictionaryDAL) {}

  /**
   * Look up a single term in the dictionary for a specific language
   */
  async lookupTerm(term: string, language: string): Promise<DictionaryEntry | null> {
    // Validation
    if (!term || term.trim().length === 0) {
      throw new ValidationError('Search term is required');
    }

    if (!language || language.trim().length === 0) {
      throw new ValidationError('Language is required');
    }

    const trimmedTerm = term.trim();
    
    const entry = await this.dictionaryDAL.findByWord1(trimmedTerm, language);
    if (!entry) return null;

    // characterRationale is a display-ready column — no runtime enrichment step needed.
    return entry;
  }

  /**
   * Look up multiple terms in the dictionary for a specific language
   * Used by reader feature to get all dictionary matches for a document
   */
  async lookupMultipleTerms(terms: string[], language: string): Promise<DictionaryEntry[]> {
    console.log(`[DICTIONARY-SERVICE] 🔄 Processing lookup request for ${terms?.length || 0} terms in ${language}`);
    const startTime = performance.now();

    // Validation
    if (!terms || terms.length === 0) {
      console.log(`[DICTIONARY-SERVICE] 📝 Empty terms array, returning empty result`);
      return [];
    }

    if (!language || language.trim().length === 0) {
      throw new ValidationError('Language is required');
    }

    // Filter and clean terms
    const cleanedTerms = terms
      .map(t => t.trim())
      .filter(t => t.length > 0);

    // Remove duplicates
    const uniqueTerms = [...new Set(cleanedTerms)];

    console.log(`[DICTIONARY-SERVICE] 🧹 Term processing:`, {
      originalCount: terms.length,
      afterCleaning: cleanedTerms.length,
      afterDeduplication: uniqueTerms.length,
      language: language
    });

    if (uniqueTerms.length === 0) {
      console.log(`[DICTIONARY-SERVICE] 📝 No valid terms found`);
      return [];
    }

    // Business rule: limit to prevent abuse
    if (uniqueTerms.length > 1000) {
      throw new ValidationError('Too many terms requested (maximum 1000)');
    }

    const entries = await this.dictionaryDAL.findMultipleByWord1(uniqueTerms, language);

    const totalTime = performance.now() - startTime;
    console.log(`[DICTIONARY-SERVICE] ✅ Lookup complete:`, {
      language: language,
      termsQueried: uniqueTerms.length,
      entriesFound: entries.length,
      matchRate: `${(entries.length / uniqueTerms.length * 100).toFixed(1)}%`,
      totalTime: `${totalTime.toFixed(2)}ms`
    });

    return entries;
  }

  /**
   * Search dictionary entries with pagination
   */
  async searchDictionary(
    searchTerm: string,
    language: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<{ entries: DictionaryEntry[], total: number } & AiFallbackState> {
    // Validation
    if (!searchTerm || searchTerm.trim().length === 0) {
      throw new ValidationError('Search term is required');
    }

    if (!language || language.trim().length === 0) {
      throw new ValidationError('Language is required');
    }

    if (limit < 1 || limit > 100) {
      throw new ValidationError('Limit must be between 1 and 100');
    }

    if (offset < 0) {
      throw new ValidationError('Offset must be non-negative');
    }

    const trimmedTerm = searchTerm.trim();

    const result = await this.dictionaryDAL.searchByWord1(trimmedTerm, language, limit, offset);

    // AI synthetic-entry fallback (docs/DICTIONARY_AI_FALLBACK_SEARCH.md): only when stages 1–2
    // found nothing. Surface either a cached AI answer (auto-shown orange card) or the flag that
    // tells the client to offer the "AI" button. Qualification is language-aware (pinyin/English →
    // Chinese, English/Spanish → Spanish) — see qualifiesForAiFallback.
    let canAskAi = false;
    let aiEntry: AiDictionaryEntry | null = null;
    let aiNoMatch = false;
    if (result.total === 0 && this.qualifiesForAiFallback(trimmedTerm, language)) {
      ({ canAskAi, aiEntry, aiNoMatch } = await this.resolveAiCache(trimmedTerm, language));
    }

    return {
      entries: result.entries,
      total: result.total,
      canAskAi,
      aiEntry,
      aiNoMatch,
    };
  }

  /**
   * Does a zero-result `/search` query qualify for the AI synthetic-entry fallback button?
   * (docs/DICTIONARY_AI_FALLBACK_SEARCH.md). The `/search` path only ever receives NON-CJK input
   * (CJK routes to `/segment`, gated separately by resolveChineseAiFallback), so a qualifying query
   * is any Latin text ≥2 chars in a supported language:
   *   • zh — pinyin (pinyin→Chinese) OR an English word/phrase (English→Chinese translation)
   *   • es — an English or Spanish word/phrase (English→Spanish translation, or a missing headword)
   * The single-character floor keeps trivial one-letter searches from ever offering a paid lookup.
   */
  private qualifiesForAiFallback(term: string, language: string): boolean {
    const trimmed = (term || '').trim();
    if (trimmed.length < 2 || hasChinese(trimmed)) return false;
    return language === 'zh' || language === 'es';
  }

  /**
   * AI-fallback state for a Chinese segment-mode query with no complete-word match
   * (docs/DICTIONARY_AI_FALLBACK_SEARCH.md). The /segment path only ever surfaces breakdown /
   * prefix matches, so when the full typed string isn't itself a headword we offer the same "AI"
   * button as the pinyin path. `hasCompleteMatch` is computed by the caller from the segment groups.
   */
  async resolveChineseAiFallback(
    term: string,
    language: string,
    hasCompleteMatch: boolean
  ): Promise<AiFallbackState> {
    const trimmed = (term || '').trim();
    if (language !== 'zh' || hasCompleteMatch || !hasChinese(trimmed)) {
      return { canAskAi: false, aiEntry: null, aiNoMatch: false };
    }
    return this.resolveAiCache(trimmed, language);
  }

  /**
   * Resolve the AI-fallback state for a qualifying zero-/no-match query (the caller has already
   * decided the query qualifies — valid pinyin, or Chinese with no complete match). See
   * docs/DICTIONARY_AI_FALLBACK_SEARCH.md:
   *   • cached non-empty hit           → show the cached orange card (no button)
   *   • cached empty hit, fresh (<3mo) → nothing (AI already found no meaning)
   *   • cached empty hit, stale (>3mo) → offer the button again (re-prompt on tap)
   *   • cache miss                     → offer the button
   */
  private async resolveAiCache(
    term: string,
    language: string
  ): Promise<AiFallbackState> {
    const cached = await this.dictionaryDAL.getAiCacheEntry(term, language);
    if (!cached) {
      return { canAskAi: true, aiEntry: null, aiNoMatch: false };
    }
    if (cached.word1) {
      return {
        canAskAi: false,
        aiEntry: { word1: cached.word1, pronunciation: cached.pinyin || '', definition: cached.definition || '', source: 'ai' },
        aiNoMatch: false,
      };
    }
    // Empty cached result: re-offer the button only once it has gone stale. While it's fresh, the AI
    // already checked and found nothing — surface the "no match" note (no button), same as a live ask.
    const stale = Date.now() - new Date(cached.queriedAt).getTime() > AI_EMPTY_CACHE_TTL_MS;
    return { canAskAi: stale, aiEntry: null, aiNoMatch: !stale };
  }

  /**
   * Button-triggered AI synthetic-entry generation (docs/DICTIONARY_AI_FALLBACK_SEARCH.md). Given a
   * pinyin query with no real det match, ask Sonnet for one likely Chinese word (Han + tone-marked
   * pinyin + a ≤100-char gloss), cache the answer (empty result cached as word1 NULL), and return
   * the display-only entry (or null for "no likely meaning" / feature disabled / invalid input).
   *
   * Idempotent against the cache: a fresh cached row short-circuits the model call, so repeated
   * taps (or concurrent requests) don't re-bill.
   */
  async generateAiEntry(
    term: string,
    language: string,
    userId: string,
    usageDate: string,
  ): Promise<AiDictionaryEntry | null> {
    const trimmed = (term || '').trim();
    if (trimmed.length < 2) return null;
    // Supported inputs (docs/DICTIONARY_AI_FALLBACK_SEARCH.md):
    //   • zh — pinyin, Chinese characters (segment "no complete match"), OR an English query.
    //   • es — an English or Spanish query (non-CJK).
    // The per-language prompt (buildAiSystemPrompt) decides how to interpret it.
    const supported = language === 'zh' || (language === 'es' && !hasChinese(trimmed));
    if (!supported) return null;

    // Re-check the cache: honor a fresh row (empty or not) without hitting the model again.
    // NOTE: this short-circuit is BEFORE the daily-limit check, so re-viewing a cached answer
    // is always free and never consumes a slot.
    const cached = await this.dictionaryDAL.getAiCacheEntry(trimmed, language);
    if (cached) {
      if (cached.word1) {
        return { word1: cached.word1, pronunciation: cached.pinyin || '', definition: cached.definition || '', source: 'ai' };
      }
      const fresh = Date.now() - new Date(cached.queriedAt).getTime() <= AI_EMPTY_CACHE_TTL_MS;
      if (fresh) return null; // AI already found no meaning recently
    }

    const anthropic = getDictAiClient();
    if (!anthropic) return null; // feature disabled (no DICT_AI_API_KEY)

    // Daily abuse limit: a cache MISS is about to bill a model call (+ up to 3 web searches).
    // Reject once the user has spent their DICTIONARY_AI_DAILY_LIMIT completed calls for their
    // local streak-day (migration 99). Thrown BEFORE the try/catch below so it propagates as a
    // 429 rather than being swallowed into a null "no result". Small concurrency race is fine for
    // an abuse limit; the debounced single-user UI won't stack requests.
    const usedToday = await this.dictionaryDAL.getAiUsageCount(userId, usageDate);
    if (usedToday >= DICTIONARY_AI_DAILY_LIMIT) {
      throw new RateLimitError(
        `You've reached your daily limit of ${DICTIONARY_AI_DAILY_LIMIT} AI lookups. Try again tomorrow.`,
      );
    }

    try {
      // Instructions are static per language → live in a cache_control system block so repeated
      // calls in a 5-min window share the cached prefix; only the query varies per call.
      const systemText = this.buildAiSystemPrompt(language);

      // Give the model a web_search tool so it can identify current/obscure referents (recent
      // singers, places, brands) beyond its training cutoff (docs/DICTIONARY_AI_FALLBACK_SEARCH.md).
      // The model decides when to search (stable words won't trigger one); max_uses caps cost at
      // 3 searches/tap. A search-heavy turn can be paused (stop_reason 'pause_turn') — we echo the
      // assistant content back to continue until it finishes.
      const messages: Anthropic.MessageParam[] = [{ role: 'user', content: `Query: ${trimmed}` }];
      let response: Anthropic.Message | null = null;
      for (let i = 0; i < 5; i++) {
        response = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 512,
          temperature: 0.2,
          system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }],
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
          messages,
        });
        if (response.stop_reason !== 'pause_turn') break;
        messages.push({ role: 'assistant', content: response.content });
      }
      if (!response) return null;

      // A model call completed (regardless of whether it yields a word, an empty result, or an
      // unparseable one below) — it was billed, so it counts against the daily limit.
      await this.dictionaryDAL.incrementAiUsage(userId, usageDate);

      // Concatenate the final turn's text blocks (with web search, content also holds
      // server_tool_use / web_search_tool_result blocks we ignore) and pull out the JSON object.
      // Our JSON is flat (no nested braces), so match each {...} and take the last that parses.
      const content = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('\n');
      const candidates = content.match(/\{[^{}]*\}/g) || [];
      let parsed: any = null;
      for (let i = candidates.length - 1; i >= 0; i--) {
        try {
          const obj = JSON.parse(candidates[i]);
          if (obj && Object.prototype.hasOwnProperty.call(obj, 'word1')) { parsed = obj; break; }
        } catch { /* not valid JSON — try an earlier candidate */ }
      }
      if (!parsed) return null; // couldn't parse a result — transient, don't cache

      // Validate: an empty result (word1 null/missing) is a legitimate, cacheable outcome.
      const word1 = typeof parsed.word1 === 'string' ? parsed.word1.trim() : '';
      if (!word1) {
        await this.dictionaryDAL.upsertAiCacheEntry(trimmed, language, null);
        return null;
      }
      const pinyin = typeof parsed.pinyin === 'string' ? parsed.pinyin.trim() : '';
      // No length cap — the column is unbounded text (migration 98) and the card wraps the full
      // gloss; the prompt asks the model to keep it concise and complete.
      const definition = typeof parsed.definition === 'string' ? parsed.definition.trim() : '';

      await this.dictionaryDAL.upsertAiCacheEntry(trimmed, language, { word1, pinyin, definition });
      return { word1, pronunciation: pinyin, definition, source: 'ai' };
    } catch (error: any) {
      console.error(`Failed to generate AI dictionary entry for "${trimmed}":`, error.message);
      return null;
    }
  }

  /**
   * The static system prompt for the AI synthetic-entry fallback, per language
   * (docs/DICTIONARY_AI_FALLBACK_SEARCH.md). Both variants ask for the SAME flat JSON shape
   * ({word1, pinyin, definition}) so the cache row, client type, and orange card are language-
   * agnostic. The query may arrive in the target language OR in English; the model infers which and
   * always resolves to a single TARGET-language headword with an English gloss.
   *   • zh — pinyin / Han / English → one Chinese word (tone-marked pinyin in `pinyin`).
   *   • es — English / Spanish → one Spanish word (`pinyin` left empty; Spanish has no such field).
   */
  private buildAiSystemPrompt(language: string): string {
    if (language === 'es') {
      return `You are a Spanish dictionary. You are given a query that is EITHER an English word/phrase OR a Spanish word/phrase. Return the single Spanish word/expression the query denotes.

You have a web_search tool. Use it to identify real people, places, brands, works, or any current/recent information you are not certain about — SEARCH before falling back to a generic description. Never fabricate facts; if you're unsure who or what a proper noun refers to, search for it first.

Your FINAL message must be ONLY a JSON object, no other prose and no citations, in exactly this format:
{"word1": "palabra", "pinyin": "", "definition": "one concise English gloss"}

Rules:
- Treat the query as CORRECT exactly as written. Do NOT correct, "fix", or reinterpret it as an apparent typo, and do NOT substitute a similar-looking word. Match the query exactly.
- For an English query: return the most common everyday Spanish translation (the lemma/dictionary form; for a noun, prefer the bare lemma without an article unless the article is idiomatic).
- For a Spanish query: return that Spanish word itself (e.g. a rare, regional, or new word simply missing from the dictionary), identified by an English gloss. If it names a real, identifiable entity (person/place/brand/work), identify THAT entity — say who or what it is — using web_search when unsure.
- Respond with {"word1": null} ONLY if the query maps to no coherent Spanish concept at all (e.g. a meaningless jumble).
- "word1": the Spanish word/expression (dictionary/lemma form, simplified accents preserved).
- "pinyin": always the empty string "" (Spanish has no separate pronunciation field).
- "definition": ONE short, COMPLETE English gloss — a single phrase or clause of at most ~12 words (never more than 100 characters). Identify the core meaning and stop; it must read as finished, not trailing off. E.g. "serendipity" → "casualidad, a fortunate accidental discovery" is too much; just "casualidad — a happy accident/lucky find" (concise). Prefer noting a noun's gender briefly, e.g. "la casualidad (f), a happy accident".`;
    }

    // Default: Mandarin Chinese (zh). Accepts pinyin, Han, or an English query.
    return `You are a Mandarin Chinese dictionary. You are given a query that is EITHER Hanyu Pinyin (tone digits may be present: 1–4 = tones, 0/5 = neutral; or absent = any tone), OR Chinese characters, OR an English word/phrase. Return the single Chinese word/expression the query denotes.

You have a web_search tool. Use it to identify real people, places, brands, works, or any current/recent information you are not certain about — SEARCH before falling back to a generic description. Never fabricate facts; if you're unsure who or what a proper noun refers to, search for it first.

Your FINAL message must be ONLY a JSON object, no other prose and no citations, in exactly this format:
{"word1": "汉字", "pinyin": "tone-marked pinyin", "definition": "one concise English gloss"}

Rules:
- A Latin-letter query is EITHER Hanyu Pinyin OR English — infer which from whether it reads as valid pinyin syllables; when a query is a recognizable English word/phrase, treat it as English.
- Treat the query as CORRECT exactly as written. Assume pinyin is spelled correctly — do NOT correct, "fix", or reinterpret it as an apparent typo, and do NOT substitute a similar-sounding or similar-looking word. Match the query exactly.
- Return a result for ANY query that maps to a valid concept. This includes ordinary words and expressions AND proper nouns — real people, place names, brand/company names, titles of works.
- When a query names a real, identifiable entity, identify THAT entity — say who or what it is (e.g. "Taiwanese singer, member of ...", "city in Jiangsu, China", "smartphone brand"). This is what the user wants: the referent, not a character breakdown. If you don't already know it, use web_search to find out before answering.
- Only fall back to describing a name generically (its being a personal name + the literal meanings of its characters, e.g. "Chinese given name; 翊 'assist' + 恩 'grace/kindness'") when even a web search cannot identify a specific real-world referent. Do NOT fabricate biographical facts (roles, groups, dates).
- For a pinyin query: the answer's pronunciation must match the given pinyin exactly (including any specified tones). If no word, name, or concept has exactly this pinyin, respond with {"word1": null}.
- For a Chinese-character query: interpret exactly those characters. Respond with {"word1": null} ONLY if the characters map to no coherent concept at all (e.g. a random, meaningless jumble of unrelated characters).
- For an English query: return the single Chinese word/expression that best translates it (the most common everyday equivalent). Respond with {"word1": null} only if the English is meaningless or has no reasonable Chinese equivalent.
- "word1": the Chinese characters (simplified).
- "pinyin": tone-marked Hanyu Pinyin with diacritics (e.g. "jiàn shēn"), matching word1.
- "definition": ONE short, COMPLETE English gloss — a single phrase or clause of at most ~12 words (and never more than 100 characters). Identify the core meaning and stop; do NOT write a multi-clause sentence stacking "founded in…", "known for…", examples, or dates. It must read as finished, not trailing off. E.g. 喜茶 → "Heytea, a popular Chinese premium tea drink chain" (good), NOT "Heytea; popular Chinese tea chain founded in 2012, known for cheese tea and fruit tea…" (too long).`;
  }

  /**
   * Segment input text using the GSA, then for each segment fetch all dictionary entries
   * whose word1 starts with that segment (prefix search).
   *
   * Returns groups ordered by segment character length (longest first). Within each group,
   * entries are ordered by the DAL's default relevance ordering.
   * Groups with no matching entries are silently dropped.
   */
  async segmentAndLookup(text: string, language: string): Promise<Array<{ segment: string; exactEntries: DictionaryEntry[]; prefixEntries: DictionaryEntry[] }>> {
    if (!text.trim()) return [];

    const trimmed = text.trim();

    // Step 1: collect all candidate substrings for a single-round-trip DB query to feed the GSA
    const candidates = getAllSubstrings(trimmed);
    const exactEntries = await this.dictionaryDAL.findMultipleByWord1(candidates, language);

    // Step 2: build GSA structures and segment the input
    const dictMap = buildDictMap(exactEntries);
    const excludeSet = buildExcludeSet(exactEntries);
    const rawSegments = segmentWithDict(trimmed, dictMap, excludeSet);

    // Step 3: track each segment's character offset in the original string (first occurrence)
    const segmentPosition = new Map<string, number>();
    let charOffset = 0;
    for (const seg of rawSegments) {
      if (!segmentPosition.has(seg)) {
        segmentPosition.set(seg, charOffset);
      }
      charOffset += [...seg].length;
    }

    // Step 4: deduplicate, preserving first-occurrence GSA order
    const seen = new Set<string>();
    const uniqueSegments: string[] = [];
    for (const seg of rawSegments) {
      if (!seen.has(seg)) {
        seen.add(seg);
        uniqueSegments.push(seg);
      }
    }

    // Step 5: sort by position in the string (ASC), then by segment length (DESC) as tiebreaker
    uniqueSegments.sort((a, b) => {
      const posDiff = (segmentPosition.get(a) ?? 0) - (segmentPosition.get(b) ?? 0);
      if (posDiff !== 0) return posDiff;
      return [...b].length - [...a].length;
    });

    // Step 6: build the result groups.
    //
    // Prefix ("starts-with") search is applied ONLY to the full typed string, so that
    // e.g. "阿尔" surfaces 阿尔泰/阿尔法/阿尔卑斯 even though "阿尔" isn't itself a headword.
    // Each individual GSA segment contributes only its EXACT match (word1 === segment) —
    // no per-segment prefix expansion.
    const groups: Array<{ segment: string; exactEntries: DictionaryEntry[]; prefixEntries: DictionaryEntry[] }> = [];

    // 6a. Full-input prefix group (first). Split the prefix-search rows into the exact
    // match (word1 === trimmed) and the starts-with matches (word1 !== trimmed).
    const { entries: fullInputEntries } = await this.dictionaryDAL.searchByWord1(trimmed, language, 50, 0);
    if (fullInputEntries.length > 0) {
      groups.push({
        segment: trimmed,
        exactEntries: fullInputEntries.filter(e => e.word1 === trimmed),
        prefixEntries: fullInputEntries.filter(e => e.word1 !== trimmed),
      });
    }

    // 6b. Exact-only group per GSA segment. Reuse the exact entries already fetched in
    // Step 1 (findMultipleByWord1 over all candidate substrings) — no extra DB round-trips.
    const exactByWord1 = new Map<string, DictionaryEntry[]>();
    for (const entry of exactEntries) {
      const bucket = exactByWord1.get(entry.word1);
      if (bucket) bucket.push(entry);
      else exactByWord1.set(entry.word1, [entry]);
    }

    // Track which segments have already been emitted so the per-character pass below
    // doesn't duplicate a group already produced by the full-input or GSA passes.
    const emittedSegments = new Set<string>();
    emittedSegments.add(trimmed);

    for (const seg of uniqueSegments) {
      // The full-input group already covers this case (its exact + prefix entries).
      if (seg === trimmed) continue;
      const segExact = exactByWord1.get(seg);
      if (!segExact || segExact.length === 0) continue;
      groups.push({ segment: seg, exactEntries: segExact, prefixEntries: [] });
      emittedSegments.add(seg);
    }

    // 6c. Exact-only group per individual character in the query, in first-occurrence
    // order. GSA may merge characters into multi-char words (e.g. "学生" → ["学生"]), so
    // this guarantees each single character (学, 生) still gets its own exact match.
    // Skips characters already emitted as a full-input/GSA segment.
    const seenChars = new Set<string>();
    for (const ch of [...trimmed]) {
      if (seenChars.has(ch)) continue;
      seenChars.add(ch);
      if (emittedSegments.has(ch)) continue;
      const charExact = exactByWord1.get(ch);
      if (!charExact || charExact.length === 0) continue;
      groups.push({ segment: ch, exactEntries: charExact, prefixEntries: [] });
      emittedSegments.add(ch);
    }

    return groups;
  }

  /**
   * Get total count of dictionary entries
   */
  async getTotalCount(): Promise<number> {
    return await this.dictionaryDAL.getTotalCount();
  }

  /**
   * Generate character breakdown for a Chinese word
   * Looks up each character in the dictionary and returns a JSON object with definitions only.
   * Pronunciation is derived at read time from vocabentries.pronunciation (space-separated pinyin).
   * Returns null for non-Chinese words or if language is not 'zh'
   */
  async generateBreakdown(word: string, language: string): Promise<Record<string, { definition: string }> | null> {
    // Only generate breakdown for Chinese language
    if (!language || language !== 'zh') {
      return null;
    }

    if (!word || word.trim().length === 0) {
      return null;
    }

    const trimmedWord: string = word.trim();

    // Split the word into individual characters
    const characters: string[] = [...trimmedWord]; // Spread operator properly handles multi-byte characters

    if (characters.length === 0) {
      return null;
    }

    // Look up each character in the dictionary. The method is already guarded to
    // zh above, but pass the param through rather than re-hardcoding the literal.
    const characterEntries: DictionaryEntry[] = await this.dictionaryDAL.findMultipleByWord1(characters, language);

    // Build the breakdown object with definition only (pronunciation is derived from vocabentries.pronunciation at read time)
    const breakdown: Record<string, { definition: string }> = {};

    for (const char of characters) {
      // Find the dictionary entry for this character
      const entry: DictionaryEntry | undefined = characterEntries.find(e => e.word1 === char);

      if (entry && entry.definitions && entry.definitions.length > 0) {
        breakdown[char] = {
          definition: entry.definitions[0],
        };
      } else {
        breakdown[char] = {
          definition: 'No definition',
        };
      }
    }

    return breakdown;
  }

  /**
   * Extract parts of speech from dictionary definitions
   * Parses definition strings for common POS markers
   */
  async extractPartsOfSpeech(word: string, language: string): Promise<string[]> {
    if (!language || language !== 'zh') {
      return [];
    }

    const entry: DictionaryEntry | null = await this.lookupTerm(word, language);
    if (!entry || !entry.definitions || entry.definitions.length === 0) {
      return [];
    }

    const posSet: Set<string> = new Set();
    const posPatterns: Record<string, RegExp> = {
      'noun': /\bn\b|\bnoun\b/i,
      'verb': /\bv\b|\bverb\b/i,
      'adjective': /\badj\b|\badjective\b/i,
      'adverb': /\badv\b|\badverb\b/i,
      'preposition': /\bprep\b|\bpreposition\b/i,
      'conjunction': /\bconj\b|\bconjunction\b/i,
      'pronoun': /\bpron\b|\bpronoun\b/i,
      'interjection': /\binterj\b|\binterjection\b/i,
      'particle': /\bparticle\b/i,
      'classifier': /\bclassifier\b|\bmeasure word\b/i,
    };

    for (const definition of entry.definitions) {
      for (const [pos, pattern] of Object.entries(posPatterns)) {
        if (pattern.test(definition)) {
          posSet.add(pos);
        }
      }
    }

    return Array.from(posSet);
  }

  /**
   * Find synonyms for a Chinese word by searching for other words with similar definitions
   */
  async findSynonyms(word: string, language: string): Promise<string[]> {
    if (!language || language !== 'zh') {
      return [];
    }

    const entry: DictionaryEntry | null = await this.lookupTerm(word, language);
    if (!entry || !entry.definitions || entry.definitions.length === 0) {
      return [];
    }

    // Take first definition and search for other words with matching definitions
    const primaryDefinition: string = entry.definitions[0].toLowerCase();
    
    // Search for entries with similar definitions (this is a simple approach)
    // In a production system, you might want more sophisticated similarity matching
    const searchResults = await this.dictionaryDAL.searchByWord1(word, language, 20, 0);
    
    const synonyms: string[] = [];
    for (const result of searchResults.entries) {
      // Skip the original word
      if (result.word1 === word) continue;
      
      // Check if any definition overlaps significantly
      for (const def of result.definitions) {
        const defLower: string = def.toLowerCase();
        // Simple overlap check - if definitions share key words
        if (defLower.includes(primaryDefinition.split(' ')[0]) || 
            primaryDefinition.includes(defLower.split(' ')[0])) {
          synonyms.push(result.word1);
          break;
        }
      }
      
      if (synonyms.length >= 5) break;
    }

    return synonyms;
  }

  /**
   * Generate example sentences for a Chinese word
   * Creates 3 sentences showing different grammatical uses
   */
  async generateExampleSentences(word: string, language: string): Promise<Array<{ foreignText: string; english: string; usage: string }>> {
    if (!language || language !== 'zh') {
      return [];
    }

    const entry: DictionaryEntry | null = await this.lookupTerm(word, language);
    if (!entry) {
      return [];
    }

    // Get English translation for use in sentences
    const englishMeaning: string = entry.definitions && entry.definitions.length > 0 
      ? entry.definitions[0].replace(/\(.*?\)/g, '').trim() 
      : word;

    // Generate 3 template-based sentences
    const sentences = [
      {
        foreignText: `我很喜欢${word}。`,
        english: `I really like ${englishMeaning}.`,
        usage: 'object'
      },
      {
        foreignText: `${word}很有用。`,
        english: `${englishMeaning} is very useful.`,
        usage: 'subject'
      },
      {
        foreignText: `这是一个关于${word}的故事。`,
        english: `This is a story about ${englishMeaning}.`,
        usage: 'prepositional'
      }
    ];

    return sentences;
  }

  /**
   * Generate a long definition (25–150 chars) for a Chinese word using Claude Haiku AI.
   * When partsOfSpeech is provided, the prompt instructs the model to address each
   * grammatical role the word can take so the definition is accurate across all its uses.
   * Returns null for non-Chinese words or if AI call fails.
   */
  async generateLongDefinition(word: string, language: string, partsOfSpeech?: string[]): Promise<string | null> {
    if (!language || language !== 'zh') {
      return null;
    }

    if (!word || word.trim().length === 0) {
      return null;
    }

    const anthropic = getAnthropicClient();
    if (!anthropic) {
      return null;
    }

    try {
      const posList = Array.isArray(partsOfSpeech) ? partsOfSpeech.filter(Boolean) : [];
      const posLine = posList.length > 0
        ? `\nParts of speech: ${posList.join(', ')}\n- Address each grammatical role in the definition where meaningful.`
        : '';

      // Static rules in a cache_control system block; per-word data (word + POS)
      // stays in the user message so the cached prefix is byte-identical.
      const systemText = `You are a Chinese language expert providing dictionary definitions.
Write a single English definition that is between 25 and 150 characters long.
Goals (address whichever are most relevant to this word):
- Dispel common misconceptions or mistranslations
- Clarify how this word differs from similar or easily confused concepts
Hard constraints (must follow exactly — output will be rejected otherwise):
- Output English only. The response must not contain any Chinese characters, pinyin, or non-ASCII letters. Do not include the original word, transliterations, or literal-translation glosses in quotes.
- Do not use the phrase "rather than" anywhere in the output. Also avoid equivalent contrastive constructions like "instead of", "as opposed to", "not just X but Y", or "X, not Y". Describe what the word means directly without contrasting it against what it does not mean.
Respond with only the definition text — no quotes, no extra text.`;

      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        temperature: 0.3,
        system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: `Word: ${word.trim()}${posLine}` }]
      });

      const text = (response.content[0] as { type: string; text: string }).text.trim();
      return text.length > 0 ? text : null;
    } catch (error: any) {
      console.error(`Failed to generate long definition for "${word}":`, error.message);
      return null;
    }
  }

  /**
   * Batch-fetch synonym metadata (pronunciation + first definition) from dictionaryentries_zh.
   * Returns a map of { [word]: { definition, pronunciation } } for each found synonym.
   */
  async buildSynonymMetadata(
    synonymWords: string[],
    language: string
  ): Promise<Record<string, { definition: string; pronunciation: string }>> {
    if (!synonymWords || synonymWords.length === 0) {
      return {};
    }

    const entries = await this.dictionaryDAL.findMultipleByWord1(synonymWords, language);

    const metadata: Record<string, { definition: string; pronunciation: string }> = {};
    for (const entry of entries) {
      metadata[entry.word1] = {
        definition: entry.definitions?.[0] ?? '',
        pronunciation: entry.pronunciation ?? '',
      };
    }

    return metadata;
  }

  /**
   * Enrich an array of VocabEntry objects with computed synonymsMetadata.
   * Collects all synonym words across entries, batch-fetches their metadata
   * from dictionaryentries_zh, and attaches it to each entry.
   */

  /**
   * Enrich each example sentence with `_segments` and `segmentMetadata` on-the-fly.
   * Delegates to the DAL batch method, which makes one DB query across all sentences.
   *
   * @param entries - Objects with optional `exampleSentences` field
   * @param language - Language filter (default: 'zh')
   */
  async enrichExampleSentencesMetadataBatch<T extends {
    exampleSentences?: Array<{ foreignText: string; english: string; [key: string]: any }> | null;
  }>(entries: T[], language: string = 'zh'): Promise<T[]> {
    return this.dictionaryDAL.enrichExampleSentencesMetadataBatch(entries, language);
  }

  /**
   * Enrich entries with `longDefinitionParts` — the long definition split into English
   * prose + cpcd-able Chinese runs. Delegates to the DAL batch method (one DB query).
   *
   * @param entries - Objects with optional `longDefinition` field
   * @param language - Language filter (default: 'zh')
   */
  async enrichLongDefinitionMetadataBatch<T extends {
    longDefinition?: string | null;
  }>(entries: T[], language: string = 'zh'): Promise<T[]> {
    return this.dictionaryDAL.enrichLongDefinitionMetadataBatch(entries, language);
  }

  async enrichEntriesWithSynonymMetadata(entries: VocabEntry[], language: string = 'zh'): Promise<VocabEntry[]> {
    // Collect all unique synonym words across all entries
    const allSynonyms = new Set<string>();
    for (const entry of entries) {
      if (entry.synonyms?.length) {
        for (const syn of entry.synonyms) {
          allSynonyms.add(syn);
        }
      }
    }

    if (allSynonyms.size === 0) return entries;

    // Single batch query for all synonym metadata, scoped to the caller's language.
    // Defaults to 'zh' for legacy callers since synonyms are currently Chinese-only.
    const metadata = await this.buildSynonymMetadata([...allSynonyms], language);

    // Attach metadata to each entry that has synonyms
    return entries.map(entry => {
      if (!entry.synonyms?.length) return entry;

      const entryMetadata: Record<string, { definition: string; pronunciation: string }> = {};
      for (const syn of entry.synonyms) {
        if (metadata[syn]) {
          entryMetadata[syn] = metadata[syn];
        }
      }

      return {
        ...entry,
        synonymsMetadata: Object.keys(entryMetadata).length > 0 ? entryMetadata : null,
      };
    });
  }

}
