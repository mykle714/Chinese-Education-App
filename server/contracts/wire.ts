/**
 * wire.ts — THE single definition of every type that crosses the client↔server
 * boundary.
 *
 * Why it lives under `server/`: the backend Docker build context is `./server`
 * (docker-compose.yml `backend.build.context`), so a repo-root `shared/` directory
 * would not be copied into the backend image. The frontend image copies the whole
 * repo, so `src/` can reach in here but not the other way around. The server is the
 * contract owner; the client conforms.
 *
 * ── Rules for this file ────────────────────────────────────────────────────────
 * 1. NO relative value imports. It is consumed by two TypeScript programs with
 *    different module resolution (server: NodeNext, needs `.js` specifiers;
 *    client: bundler, does not). A leaf file sidesteps the mismatch entirely.
 *    Type-only imports with a `.js` specifier are safe in both and are the one
 *    exception (TypeScript substitutes `.ts`, and the import is erased).
 * 2. NO `enum`. `tsconfig.app.json` sets `erasableSyntaxOnly: true`, which rejects
 *    enums outright. Use a string union + a `const` lookup object instead.
 * 3. NO Node or DOM globals. This must typecheck under both tsconfigs.
 * 4. `Date` NEVER appears here. Dates serialize to strings over JSON; a field the
 *    server holds as a `Date` is declared `string` here and narrowed in
 *    `server/types/index.ts`.
 *
 * ── The Base/narrow pattern ────────────────────────────────────────────────────
 * Where the two sides genuinely differ, this file declares the permissive shape as
 * `<Name>Base` and each side narrows it by interface extension:
 *
 *   server/types/index.ts:  interface VocabEntry extends VocabEntryBase { createdAt: Date; userId: string }
 *   src/types.ts:           interface VocabEntry extends VocabEntryBase { createdAt: string }
 *
 * The server narrows optional→required because it is the producer and always
 * populates identity fields; the client keeps them optional because its
 * det-fallback adapters synthesize entries that have no vet row behind them.
 * Narrowing an optional property to required is legal in an `extends` clause, so
 * both sides stay exactly as strict as they were before — with one field list.
 *
 * Referenced by: server/types/index.ts, src/types.ts, server/contracts/mastery.ts.
 * See docs/ARCHITECTURE_REVIEW.md finding 2.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Language & scalar vocabulary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Language type for multi-language support.
 * Only Chinese and Spanish are user-selectable for now; ja/ko/vi are not yet
 * supported (their per-language dictionary tables don't exist — see CLAUDE.md).
 */
export type Language = 'zh' | 'es';

/** Every user-selectable language, in menu order. */
export const LANGUAGES: readonly Language[] = ['zh', 'es'] as const;

/**
 * Display names for a language.
 *
 * Bare language names, no parenthetical qualifier: 'Mandarin', not
 * 'Chinese (Mandarin)'. They appear inline in running copy (the friends
 * leaderboard's per-row subtitle), where a parenthetical reads as an aside about
 * the person rather than a label for the language.
 */
export const LANGUAGE_NAMES: Record<Language, string> = {
  zh: 'Mandarin',
  es: 'Spanish',
};

/**
 * Flag emoji per language, for compact "which language is this person studying"
 * badges (the friends leaderboard). A language is not a country — these are the
 * conventional flag for the language's principal standard variety, chosen for
 * recognisability, not political claim: Mandarin → PRC, Spanish → Spain.
 *
 * Rendering caveat: these are regional-indicator pairs, which Windows does NOT
 * render as flags (it shows the two letters, e.g. "ES"). That degradation is
 * acceptable — the letters still identify the language — but never make a flag the
 * ONLY carrier of meaning; always pair it with the language name or code.
 */
export const LANGUAGE_FLAGS: Record<Language, string> = {
  zh: '🇨🇳',
  es: '🇪🇸',
};

/**
 * The two-letter region code behind a language's flag: 'zh' → 'CN', 'es' → 'ES'.
 *
 * DERIVED from {@link LANGUAGE_FLAGS} rather than stored in a second table, because a
 * flag emoji IS its region code — two Regional Indicator Symbols, U+1F1E6..U+1F1FF,
 * mapping one-to-one onto A..Z. Decoding it means the badge and the flag can never
 * disagree, and changing a flag automatically changes the code beside it.
 *
 * This is also exactly what Windows renders in place of the flag it cannot draw, so a
 * "🇨🇳 CN" badge degrades to "CN CN" at worst — never to something unidentifiable.
 *
 * Returns '' for a language with no flag, so callers can fall back to their own label.
 */
export function languageRegionCode(language: Language): string {
  const flag = LANGUAGE_FLAGS[language];
  if (!flag) return '';
  // Spread, not charAt: each indicator is a surrogate pair, so index-based access
  // would split it in half.
  return [...flag]
    .map((ch) => {
      const cp = ch.codePointAt(0);
      if (cp === undefined || cp < 0x1f1e6 || cp > 0x1f1ff) return '';
      return String.fromCharCode('A'.charCodeAt(0) + cp - 0x1f1e6);
    })
    .join('');
}

/**
 * Generalized difficulty band stored in dictionaryentries_*.difficulty (drives the
 * discover band). One 1..6 integer scale for every language; the column is a
 * smallint (migration 92, finishing migration 79's intent), so these are NUMBERS:
 *   - zh: 1..6 — these ARE HSK levels (1 = HSK1 .. 6 = HSK6), shown as an
 *     "HSK 3" badge in the UI.
 *   - es: 1..6  (learner-acquisition difficulty, 1=easiest)
 */
export type DifficultyLevel = 1 | 2 | 3 | 4 | 5 | 6;

/** Verb tense label used by example-sentence form modification (docs/EXAMPLE_SENTENCES.md). */
export type TenseLabel = 'past' | 'present' | 'future';

/** Grammatical number label used by example-sentence form modification. */
export type NumberLabel = 'singular' | 'plural';

// ─────────────────────────────────────────────────────────────────────────────
// Segmentation payloads (shared by example sentences and long-definition runs)
// ─────────────────────────────────────────────────────────────────────────────

/** Particle or classifier annotation attached to a segmented character. */
export interface ParticleOrClassifierInfo {
  type: 'particle' | 'classifier';
  definition: string;
}

/**
 * Per-segment enrichment for one GSA-segmented foreign run. Keyed by segment text.
 * Produced server-side; the client renders it as cpcd with a tap/hover popup.
 */
export type SegmentMetadata = Record<
  string,
  {
    pronunciation?: string;
    definition?: string;
    particleOrClassifier?: ParticleOrClassifierInfo;
    wordForms?: Record<string, string>;
    /** Tap-to-drill chain: shorter det headwords inside this segment, longest-first. */
    drill?: SegmentDrillRung[];
  }
>;

/**
 * One rung of a segment's tap-to-drill chain (docs/SEGMENT_DRILL_DOWN.md). A det
 * headword that is a strict substring of its parent segment, at a known character
 * offset inside it. Produced by `buildDrillRungs`
 * (server/dal/shared/segmentString.ts) at read time — no stored column.
 */
export interface SegmentDrillRung {
  /** The sub-word, verbatim. */
  text: string;
  /** Character offset within the parent segment (0-based, code-point indexed). */
  offset: number;
  /** Gloss shown when this rung is selected; rungs without one are never emitted. */
  definition: string;
  /** Tone-marked pinyin, when the entry has one — narrated on select. */
  pronunciation?: string;
}

/**
 * One AI-generated example sentence with its tagging-pass metadata.
 *
 * Previously this object literal was inlined SIX times (three types × two sides).
 * `partOfSpeechDict` is optional here because the client's det-fallback adapters
 * build entries without it; every server producer sets it.
 * See docs/EXAMPLE_SENTENCES.md.
 */
export interface ExampleSentence {
  foreignText: string;
  english: string;
  /** English word/phrase in the translation that corresponds to the vocab word. */
  translatedVocab?: string;
  /** Exact definitionClusters sense label the target word carries here (zh only). */
  sense?: string;
  /** Authoritative GSA segmentation from the tagging pass; rendered verbatim when present. */
  segments?: string[];
  /**
   * Multi-character tokens the segmentation-audit pass judged NOT to be a single word
   * in THIS sentence (e.g. 真是 in a sentence where 真 and 是 act separately). Fed to
   * `segmentWithDict` as exclude tokens, so they can never be matched here — scoped to
   * this one sentence, unlike the entry-wide `matchException` column.
   * See docs/EXAMPLE_SENTENCES.md § Segmentation audit.
   */
  segmentExceptions?: string[];
  /** POS tag per GSA segment; drives form modification + particle/classifier annotation. */
  partOfSpeechDict?: Record<string, string>;
  /** Grammatical number per noun segment; selects the plural English form in the popup. */
  numberDict?: Record<string, NumberLabel>;
  /** Tense per verb segment; per-verb because one sentence can mix tenses. */
  tenseDict?: Record<string, TenseLabel>;
  /** definitionClusters sense label per segment; resolves each segment's dd. */
  senseDict?: Record<string, string>;
  /** Runtime GSA segmentation (fallback when `segments` is absent). */
  _segments?: string[];
  segmentMetadata?: SegmentMetadata;
  /**
   * Read-time: TRUE iff an approving `validations` row still matches this sentence's
   * current foreignText+english. Falsy ⇒ the client renders the AI-generated styling.
   * See docs/DATA_VALIDATION_SYSTEM.md.
   */
  humanApproved?: boolean;
}

/**
 * An English translation of ONE Chinese run cited inside a long definition or
 * comparison paragraph, keyed by the run's exact text. Stored in
 * dictionaryentries_zh."longDefinitionCitations" (migration 126) and
 * word_comparison_cache.citations (migration 127). See docs/DEFINITION_MAPPING.md.
 */
export interface LongDefinitionCitation {
  /** The embedded Chinese run, verbatim (the join key to a `foreign` part's foreignText). */
  zh: string;
  /** Its English translation, as one phrase/sentence. */
  en: string;
}

/**
 * One ordered piece of a long definition split into English prose vs. embedded
 * Chinese. `text` parts render as plain prose; `foreign` parts carry the same
 * segmentation payload as an example sentence so the client renders them as cpcd.
 */
export type LongDefinitionPart =
  | { type: 'text'; value: string }
  | {
      type: 'foreign';
      foreignText: string;
      _segments: string[];
      segmentMetadata: SegmentMetadata;
      /**
       * English translation of the WHOLE run, when one exists. Present flips the
       * client from per-segment popups to a whole-run highlight + this text.
       */
      translation?: string | null;
    };

/**
 * One sense's extended definition as SHIPPED to the client (zh): the stored
 * { sense, pos, definition } plus that text's own segmentation. Every sense is sent
 * so the client can follow the learner's sense pick without a refetch (the picker is
 * optimistic). See docs/DEFINITION_CLUSTERS.md.
 */
export interface LongDefinitionSenseView {
  /** Cluster `sense` label — matches definitionClusters/selectedSense. */
  sense: string;
  pos?: string | null;
  definition: string;
  /** Computed at runtime, same treatment as longDefinitionParts. */
  parts?: LongDefinitionPart[] | null;
}

/**
 * One orthogonal sense cluster within a dictionary entry's `definitionClusters`
 * (zh: migration 90; es: migration 123). Glosses sharing one core meaning are
 * grouped and ordered prototypical→vernacular WITHIN the cluster; clusters
 * themselves are mutually orthogonal and ordered most→least useful.
 *
 * Each language keeps its homographs in ONE row, distinguished by the field that
 * carries its hard sense boundary: `reading` for Chinese (heteronyms — 会
 * hui4/kuai4), `gender` for Spanish (cura/m "priest" vs cura/f "cure"). The other
 * field is NULL. Migration 123 folded the old per-gender es det ROWS into these
 * clusters. See docs/DEFINITION_CLUSTERS.md.
 */
export interface DefinitionCluster {
  /** Short English label for the shared meaning. */
  sense: string;
  /** zh: numbered pinyin for THIS sense (e.g. 会计 → "kuai4"). NULL for es. */
  reading: string | null;
  /** Part(s) of speech for this sense (always an array; single-POS senses are length 1). */
  pos: string[] | null;
  /** es: grammatical gender of THIS sense (m/f/mf/…). NULL for zh. */
  gender?: string | null;
  /** 1–5 conversation frequency, scored independently per cluster (null = scoring failed). */
  frequencyScore: number | null;
  /** Verbatim source glosses, ordered prototypical→vernacular. */
  glosses: string[];
}

/** Per-character breakdown map (zh). `sense` = the component's cluster label for THIS word. */
export type BreakdownMap = Record<
  string,
  { definition: string; pronunciation?: string; sense?: string }
>;

// ─────────────────────────────────────────────────────────────────────────────
// Manual per-entry display overrides
// ─────────────────────────────────────────────────────────────────────────────

/** Override for display fields; stored as JSONB in dictionaryentries_zh. */
export interface ShortDefinitionPronunciationOverride {
  /** Replaces the computed shortDefinition. */
  definition?: string | null;
  /** Replaces DictionaryEntry.pronunciation (space-separated, e.g. "fēng kuáng"). */
  pronunciation?: string | null;
}

/** Override for example-sentence segment popups; stored as JSONB in dictionaryentries_zh. */
export interface ExampleSentenceDefinitionPronunciationOverride {
  /** Shown verbatim in the segment popup instead of the context-matched definition. */
  definition?: string | null;
  /** Shown verbatim in the segment popup instead of the stored pronunciation. */
  pronunciation?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation (docs/DATA_VALIDATION_SYSTEM.md)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which field of a dictionary entry a validation targets.
 * 'definitions'      = the definitions[] + longDefinition bundle;
 * 'exampleSentenceN' = exampleSentences[N] (foreignText + english);
 * 'partsOfSpeech'    = the POS tag list (split out of the definitions bundle by
 *                      migration 132);
 * 'difficulty'       = the 1–6 difficulty level (HSK level for zh);
 * 'frequencyScore'   = the 1–5 conversational-commonality score ("Commonality") of the
 *                      ENTRY — shown only on a word with no sense choice to make;
 * 'senseFrequencyScore' = the 1–5 score of ONE definitionCluster (migration 139).
 *                      This is the number the eip/cdp Commonality chip shows on a
 *                      CLUSTERED word, because a polyseme's entry-level score is a
 *                      lie (干 "to do" = 5, 干 "shield" = 1).
 * The last four are INLINE-ONLY: never handed out by the Reader-document queue
 * (composeValidationDoc), only by the chip-level Approve/Flag buttons.
 */
export type ValidationField =
  | 'definitions'
  | 'exampleSentence0'
  | 'exampleSentence1'
  | 'exampleSentence2'
  | 'partsOfSpeech'
  | 'difficulty'
  | 'frequencyScore'
  | 'senseFrequencyScore';

/**
 * The validation fields addressed by a `senseLabel` (a `definitionClusters[].sense`)
 * rather than by the entry alone — migration 139. Everything NOT listed here is an
 * entry-level field whose `validations."senseLabel"` is the empty string.
 *
 * The controller uses this to decide whether `senseLabel` is REQUIRED on a request,
 * and ValidationService to decide whether to compose a per-sense body.
 */
export const PER_SENSE_VALIDATION_FIELDS = [
  'senseFrequencyScore',
] as const satisfies readonly ValidationField[];

/** Narrowing helper — keeps the "is this field addressed by a sense?" test in one place. */
export function isPerSenseValidationField(field: ValidationField): boolean {
  return (PER_SENSE_VALIDATION_FIELDS as readonly ValidationField[]).includes(field);
}

/**
 * The validation fields that describe the ENTRY AS A WHOLE (as opposed to
 * `exampleSentenceN`, which is per-sentence). These are exactly the fields
 * `DictionaryDAL.enrichFieldApprovalsBatch` resolves in one pass into
 * `EntryApprovalFlags`, so the two must always list the same set.
 */
export const ENTRY_LEVEL_VALIDATION_FIELDS = [
  'definitions',
  'partsOfSpeech',
  'difficulty',
  'frequencyScore',
] as const satisfies readonly ValidationField[];

/**
 * Read-time approval flags attached to every entry the client renders. TRUE means a
 * validator approved that field AND the approval still matches the current det data;
 * falsy means the surface renders the AI-generated treatment.
 */
export interface EntryApprovalFlags {
  definitionsApproved: boolean;
  partsOfSpeechApproved: boolean;
  difficultyApproved: boolean;
  frequencyScoreApproved: boolean;
  /**
   * Per-SENSE commonality approvals (migration 139) — the `definitionClusters[].sense`
   * labels whose cluster `frequencyScore` a validator approved AND whose approval still
   * matches today's cluster data. A LIST rather than a boolean because the granularity
   * is one cluster, not the entry: 会 hui4 may be reviewed while 会 kuai4 is not.
   *
   * Resolved in the same pass as the four booleans (one join, one batch), which is why
   * it rides on this interface despite not being entry-level.
   */
  approvedSenseFrequencyLabels: readonly string[];
}

/** All-false EntryApprovalFlags — the shape used whenever there is nothing to look up. */
export const NO_APPROVALS: EntryApprovalFlags = {
  definitionsApproved: false,
  partsOfSpeechApproved: false,
  difficultyApproved: false,
  frequencyScoreApproved: false,
  // Frozen: NO_APPROVALS is SPREAD onto many entries, so all of them would otherwise
  // share this one array instance.
  approvedSenseFrequencyLabels: Object.freeze([]),
};

// ─────────────────────────────────────────────────────────────────────────────
// Mastery (docs/MASTERY_REWORK.md) — the type vocabulary; the FORMULA is in
// contracts/mastery.ts
// ─────────────────────────────────────────────────────────────────────────────

/** One review outcome. */
export interface ReviewMark {
  /** ISO-8601 date string. */
  timestamp: string;
  isCorrect: boolean;
}

/**
 * The four mastery mark types. A mark's type is decided by the surface that
 * produced it (docs/MASTERY_REWORK.md §1):
 *   recognition — flp foreign-first review (pinyin shown) + Bubble Match
 *   production  — flp English-first review + Word Search "Pinyin" mode
 *   reading     — flp foreign-first review with pinyin OFF + Word Search "No Pinyin"
 *                 mode + Speed Reading
 *   writing     — Practice Writing drill
 */
export type MarkType = 'recognition' | 'production' | 'reading' | 'writing';

export const MARK_TYPES: readonly MarkType[] = [
  'recognition',
  'production',
  'reading',
  'writing',
] as const;

/**
 * Which track the flp's FOREIGN-FIRST face exercises for one session
 * (docs/MASTERY_REWORK.md § "The flp's foreign-first face is per-session").
 *
 * A zh card shown foreign-first WITH pinyin can be answered off the phonetic aid, so
 * it tests recognition of the meaning. With "Show pinyin" off, the learner must get
 * there from the characters alone — which is exactly what the reading track means, and
 * why Word Search's No-Pinyin mode already emits `reading`.
 *
 * Chinese only: 'es' has no phonetic layer to hide, so the toggle changes nothing on
 * an es card and its foreign-first face stays `recognition`.
 */
export type FlpForeignTrack = Extract<MarkType, 'recognition' | 'reading'>;

export const FLP_FOREIGN_TRACKS: readonly FlpForeignTrack[] = ['recognition', 'reading'] as const;

/**
 * The two tracks an flp session can present, given its foreign-first track. THE one
 * definition — the server cools/steers on it, the client maps its faces through it, so
 * the face a learner sees can never disagree with the mark that gets written.
 *
 * English-first is always `production`; only the foreign-first half varies.
 */
export const flpMarkTypes = (foreignTrack: FlpForeignTrack): readonly MarkType[] =>
  [foreignTrack, 'production'];

/**
 * THE rule that decides a foreign→meaning drill's track, shared by every surface that
 * shows one: the flp's Chinese-side-one face and Bubble Match (§ 1a).
 *
 * `showPinyin` is the learner's own display setting. Latin-script languages pass
 * through as `recognition` whatever it says — 'es' has no phonetic layer to hide, so
 * the toggle changes nothing on the card and must not silently move their marks to
 * another track.
 */
export function foreignPromptTrack(
  language: string | null | undefined,
  showPinyin: boolean
): FlpForeignTrack {
  return language === 'zh' && !showPinyin ? 'reading' : 'recognition';
}

/**
 * Narrow a raw wire value (`?foreignTrack=` / the mark body's `foreignTrack`) to a
 * track. Anything unrecognized — absent, misspelled, or a non-flp mark type — falls
 * back to 'recognition', the historical foreign-first face. Deliberately permissive:
 * a bad value may only mis-steer which face a card shows, never fail a review.
 */
export function parseFlpForeignTrack(raw: unknown): FlpForeignTrack {
  return FLP_FOREIGN_TRACKS.includes(raw as FlpForeignTrack)
    ? (raw as FlpForeignTrack)
    : 'recognition';
}

/**
 * Per-card typed mark streams: each type keeps its own <=8 most-recent marks.
 * Stored in vet."typedMarkHistory" (migration 101). An absent/empty track means no
 * marks of that type yet (which the pbh math treats as all-negative).
 */
export type TypedMarkHistory = Partial<Record<MarkType, ReviewMark[]>>;

/**
 * The up-to-three INDEPENDENT mastery bars a card carries (migration 143,
 * docs/MASTERY_REWORK.md § "Three bars").
 *
 *   core    — recognition + production, blended. ALWAYS active; this is the bar
 *             every whole-card question means (deck counts, level estimate, the
 *             mini-card chip, the community Learning feed).
 *   reading — the reading track alone. Active only when `users.readingGoal`.
 *   writing — the writing track alone. Active only when `users.writingGoal`.
 *
 * Each bar bands independently, so one card can be Mastered up to three times.
 * A mark belongs to exactly ONE bar (see `barForMarkType`), so a single MARK can
 * never move two bars at once. A single review ACTION can, where a surface emits more
 * than one typed mark for it — Word Search's No-Pinyin find writes reading and
 * production as two separate marks (docs/WORD_SEARCH_GAME.md).
 */
export type MasteryBarId = 'core' | 'reading' | 'writing';

export const MASTERY_BARS: readonly MasteryBarId[] = ['core', 'reading', 'writing'] as const;

/**
 * The `?collection=` wire value for each bar's Mastered collection — one built-in
 * collection per bar, since a card can now be mastered up to three times.
 *
 * `core` keeps the bare `mastered` value it has always had, so every existing link,
 * bookmark and in-flight client request keeps resolving to the same set.
 */
export const MASTERED_COLLECTION_IDS: Record<MasteryBarId, string> = {
  core: 'mastered',
  reading: 'mastered-reading',
  writing: 'mastered-writing',
};

/**
 * Which bar's Mastered collection a `?collection=` value names, or null if it names
 * none. Null must always mean "unrestricted" at the call sites — an unrecognized
 * collection name may never silently narrow a round to some other set.
 */
/** Narrow a raw string to a bar id, or null if it names none. */
export function parseMasteryBar(raw: string | null | undefined): MasteryBarId | null {
  return MASTERY_BARS.includes(raw as MasteryBarId) ? (raw as MasteryBarId) : null;
}

export function masteredCollectionBar(raw: string | null | undefined): MasteryBarId | null {
  if (!raw) return null;
  for (const bar of MASTERY_BARS) {
    if (MASTERED_COLLECTION_IDS[bar] === raw) return bar;
  }
  return null;
}

/**
 * The `?collection=` wire value for each bar's Learn Now collection — the mirror
 * image of MASTERED_COLLECTION_IDS above.
 *
 * "Learn Now" means "sorted, and not yet finished IN THIS BAR", so it is per-bar for
 * exactly the reason Mastered is: a card whose recognition is done but whose reading
 * has never been touched is finished for one bar and outstanding for another. The
 * Reading/Writing Centers (docs/DECKS_FEATURE.md § "Mastery Centers") list the
 * per-bar sets; the fdp lists the core one.
 *
 * `core` keeps the bare `learn-now` value it has always had, so existing links and
 * bookmarks keep resolving to the same set.
 */
export const LEARN_NOW_COLLECTION_IDS: Record<MasteryBarId, string> = {
  core: 'learn-now',
  reading: 'learn-now-reading',
  writing: 'learn-now-writing',
};

/**
 * Which bar's Learn Now collection a `?collection=` value names, or null if it names
 * none. Same null-means-unrestricted rule as `masteredCollectionBar`.
 */
export function learnNowCollectionBar(raw: string | null | undefined): MasteryBarId | null {
  if (!raw) return null;
  for (const bar of MASTERY_BARS) {
    if (LEARN_NOW_COLLECTION_IDS[bar] === raw) return bar;
  }
  return null;
}

/** Every sorted card the learner holds, mastered or not. */
export const ALL_COLLECTION_ID = 'all';

/**
 * NOTE — the BAND collections are GONE.
 *
 * `unfamiliar` / `target` / `comfortable` used to be built-in collections, one per
 * unmastered utcm band of the core bar, and they were the fdp's top tile row. The
 * collection vocabulary is now deliberately three ideas wide — every card (`all`),
 * the ones still being learned (`learn-now`), and the ones finished in a given bar
 * (`mastered*`) — because a BAND is a property of a single card's progress, not a set
 * a learner wants to study: nobody opens "my Target cards" to drill them, and a set
 * whose membership changes under you on every mark is a poor thing to launch a round
 * against. The bands still exist everywhere they mean something (the utcm category on
 * a card, the Account page's bucket row, the mini-card chip) — just not as collections.
 *
 * Consequence: `?collection=target` no longer resolves and falls back to `learn-now`
 * (OnDeckVocabController), and `/flashcards/collection/target` renders nothing.
 */

/**
 * Per-bar mastery crossing timestamps — the shape of vet."masteredAt" (jsonb since
 * migration 143; a bare timestamptz before it, when there was only one bar).
 *
 * A key is absent or null until that bar's crossing is observed. ISO strings on the
 * wire; Postgres stores them as jsonb strings, so unlike the old column pg hands
 * back strings rather than `Date`s on both sides.
 */
export type MasteredAtByBar = Partial<Record<MasteryBarId, string | null>>;

/** How many most-recent marks each type retains (the sliding-window size). */
export const MARK_WINDOW_SIZE = 8;

/**
 * The utcm band a card sits in, computed from typedMarkHistory + the account's
 * goal flags.
 *
 * This was an `enum` on the server and a string union on the client — one of the
 * six drifted contracts. It is a union here because `tsconfig.app.json` sets
 * `erasableSyntaxOnly: true`, which rejects enums outright. `FLASHCARD_CATEGORY`
 * below preserves the `FlashcardCategory.MASTERED` call-style the server used.
 */
export type FlashcardCategory = 'Unfamiliar' | 'Target' | 'Comfortable' | 'Mastered';

/**
 * Named constants for `FlashcardCategory`, replacing the old server-side enum.
 * `as const satisfies` keeps the values pinned to the union.
 */
export const FLASHCARD_CATEGORY = {
  UNFAMILIAR: 'Unfamiliar',
  TARGET: 'Target',
  COMFORTABLE: 'Comfortable',
  MASTERED: 'Mastered',
} as const satisfies Record<string, FlashcardCategory>;

/** Every utcm band, in ascending mastery order. */
export const FLASHCARD_CATEGORIES: readonly FlashcardCategory[] = [
  'Unfamiliar',
  'Target',
  'Comfortable',
  'Mastered',
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// User
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The user shape as it crosses the wire — i.e. everything EXCEPT the password hash.
 *
 * This replaces three divergent declarations (server `User`, `src/types.ts` `User`,
 * and a private non-exported `interface User` inside `src/AuthContext.tsx` that was
 * the only one with the current field set). `server/types/index.ts` adds `password`
 * for the DB model; nothing else re-declares it.
 */
export interface UserProfile {
  /** uniqueidentifier in SQL. */
  id: string;
  email: string;
  name: string;
  selectedLanguage?: Language;
  /** Whether the user appears on the public leaderboard. */
  isPublic?: boolean;
  /** May download/validate dictionary entries (migration 104, docs/DATA_VALIDATION_SYSTEM.md). */
  isValidator?: boolean;
  /** May author Night Market templates (migration 115). Distinct from isValidator. */
  isTemplateAuthor?: boolean;
  /** FK to icons8("icons8Id") — the icon chosen as profile avatar (migration 77). */
  avatarIconId?: string | null;
  /** Account opts into the Reading mastery goal (migration 101, docs/MASTERY_REWORK.md). */
  readingGoal?: boolean;
  /** Account opts into the Writing mastery goal (migration 101, docs/MASTERY_REWORK.md). */
  writingGoal?: boolean;
  /** Display pref: gap between word segments in segmented sentences (migration 129). */
  showSegmentSpaces?: boolean;
  /**
   * Display pref: which typeface renders Chinese characters, one of
   * CHINESE_FONT_IDS (migration 157). See docs/CJK_TYPEFACE_LAB.md.
   */
  chineseFont?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dictionary entries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dictionary entry, as shipped to the client.
 *
 * The client previously re-declared this and was missing 21 fields. It now extends
 * this base (see the Base/narrow note at the top). The server narrows
 * `discoverable`/`createdAt` to required and adds the transient `longDefinitionRaw`
 * carrier, which never reaches the client.
 */
export interface DictionaryEntryBase {
  id: number;
  language: Language;
  script?: string | null;
  /** Whether the entry appears in vocab discovery. Undiscoverable entries are lookup-only. */
  discoverable?: boolean;

  // ── Word forms and pronunciation ──
  /** Primary word (simplified/kanji/hangul/word). */
  word1: string;
  /** Secondary word (traditional/kana/hanja/null). */
  word2: string | null;
  /** Pronunciation (pinyin/romaji/romanization/null). */
  pronunciation: string | null;
  /** Numbered pinyin notation (e.g. "gan1 huo4"). */
  numberedPinyin?: string | null;
  /** Tone digits derived from pronunciation (e.g. "12" for fēng kuáng). */
  tone?: string | null;

  // ── Classification ──
  partsOfSpeech?: string[] | null;
  difficulty?: DifficultyLevel | null;

  // ── Definitions ──
  /** Parsed JSON array (flat cache; owned by backfill-process-definitions-array.js). */
  definitions: string[];
  /** Orthogonal sense clusters (migration 90); see docs/DEFINITION_CLUSTERS.md. */
  definitionClusters?: DefinitionCluster[] | null;
  /**
   * Computed at read time: the REQUESTING user's saved sense pick for this word from
   * their vet row. NOT a det column — it makes a lookup's dd match that user's
   * flashcard. See docs/DEFINITION_CLUSTERS.md.
   */
  selectedSense?: string | null;
  shortDefinitionPronunciationOverride?: ShortDefinitionPronunciationOverride | null;
  /** Resolved at runtime: override.definition ?? generateShortDefinition(). */
  shortDefinition?: string | null;
  exampleSentenceDefinitionPronunciationOverride?: ExampleSentenceDefinitionPronunciationOverride | null;
  /** Hydrated at read time from the JSONB column, narrowed to the card's CURRENT sense. */
  longDefinition?: string | null;
  /**
   * Raw `longDefinitionCitations` column (zh, migration 126). Folded onto the matching
   * `foreign` parts by enrichLongDefinitionMetadataBatch, which then drops this field.
   */
  longDefinitionCitations?: LongDefinitionCitation[] | null;
  /** Computed at runtime: longDefinition split into English + cpcd-able Chinese runs. */
  longDefinitionParts?: LongDefinitionPart[] | null;
  /**
   * Computed at runtime (zh): EVERY sense's definition + parts, so the client can
   * follow the sense picker without a refetch. NULL for es/legacy per-POS rows.
   */
  longDefinitionSenses?: LongDefinitionSenseView[] | null;

  /**
   * Computed at read time (DictionaryDAL.enrichFieldApprovalsBatch): each is TRUE iff
   * an approving `validations` row matches the entry's CURRENT raw det columns.
   * `definitionsApproved` covers the definitions[] + longDefinition bundle; the other
   * three each cover a single column. Falsy ⇒ AI-generated styling.
   * See docs/DATA_VALIDATION_SYSTEM.md.
   */
  definitionsApproved?: boolean;
  partsOfSpeechApproved?: boolean;
  difficultyApproved?: boolean;
  frequencyScoreApproved?: boolean;
  /**
   * Per-SENSE commonality approvals — the `definitionClusters[].sense` labels whose own
   * frequencyScore is human-approved AND still current (migration 139). Absent/empty ⇒
   * every sense renders the AI-generated styling.
   */
  approvedSenseFrequencyLabels?: readonly string[];

  // ── AI-enriched content ──
  breakdown?: BreakdownMap | null;
  synonyms?: string[] | null;
  exampleSentences?: ExampleSentence[] | null;
  /** Multi-char tokens to suppress during GSA segmentation. */
  matchException?: string[] | null;
  /** Higher = more frequent in everyday conversation; used by GSA to prefer common words. */
  frequencyScore?: number | null;
  /** AI-generated English conjugation map (e.g. {past: "ran", present: "runs"}). */
  wordForms?: Record<string, string> | null;

  /** ISO-8601 creation timestamp. */
  createdAt?: string;
}

/**
 * Display-only AI-synthesized dictionary entry (docs/DICTIONARY_AI_FALLBACK_SEARCH.md)
 * — surfaced when a pinyin query matches no real det row. Rendered as an unclickable
 * orange card; it is NOT a real DictionaryEntry (no id / metadata).
 */
export interface AiDictionaryEntry {
  word1: string;
  /** Tone-marked pinyin. */
  pronunciation: string;
  /** One concise, complete gloss (no length cap; migration 98). */
  definition: string;
  /** Tags provenance. */
  source: 'ai';
}

/**
 * The eip Compare tab's response shape (docs/WORD_COMPARE_FEATURE.md): the raw AI
 * paragraph plus its GSA segmentation. The PARTS are not persisted (recomputed on
 * every serve); the paragraph and its run translations are, in
 * `word_comparison_cache.comparison` / `.citations` (migration 127).
 */
export interface WordComparisonResult {
  comparison: string;
  comparisonParts: LongDefinitionPart[] | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vocab entries (flashcards)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Starter pack bucket — the value stored in vocabentries."starterPackBucket".
 *
 * Only 'library' persists in vet: "Skip for now" deferrals moved to the
 * discover_skips table (migration 80), so 'skip' is no longer a vet bucket value.
 * (The discover API still ACCEPTS 'skip'/'already-learned' as input bucket NAMES;
 * they just don't map to this stored type — see `DiscoverSortBucket`.) The client
 * previously declared `'library' | 'skip'` here, which was the drift.
 *
 * Presented to users as "Learn Now"; the identifier stays `library` because it is a
 * backend contract (CLAUDE.md § Terminology).
 *
 * 'provisional' (migration 140) is a TEMPORARY card the server auto-granted so a
 * game or flp could meet its baseline (see CARD_BASELINES below). It is a real vet
 * row — it has an id and accepts marks — but the user never chose it, so it is
 * hidden from every "my cards" read until they sort it. See docs/PROVISIONAL_CARDS.md.
 */
export type StarterPackBucket = 'library' | 'provisional';

// ─────────────────────────────────────────────────────────────────────────────
// Card baselines (docs/PROVISIONAL_CARDS.md)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every surface that draws a set of cards to play/study with.
 *
 * These were five independently-declared minimum-card constants that each BLOCKED
 * entry when the user's deck was too small. They are now BASELINES: the number of
 * playable cards the surface wants, which the server tops up with provisional cards
 * rather than refusing to start. Nothing may block a game or flp on card count.
 */
export type CardBaselineSurface =
  | 'bubble-match'
  | 'match-speed'
  | 'speed-reading'
  | 'word-search'
  | 'flp';

/**
 * How many playable cards each surface needs before it can build a round.
 *
 * Single source of truth — previously duplicated across
 * `src/games/bubble-match/constants.ts` (distribution sum), `match-speed/constants.ts`
 * (ENTRY_GATE_CARDS), `speed-reading/constants.ts` (ENTRY_GATE_CARDS),
 * `word-search/constants.ts` (TOTAL_WORDS) and
 * `src/features/flashcards/FlashcardsDecksPage.tsx` (MIN_LIBRARY_CARDS), where they
 * could drift apart from the distributions the server actually served.
 *
 * Word Search is 9 rather than 20 because its grid holds nine words (10 → 12 on
 * 2026-08-23, then 12 → 9 on 2026-08-28 when the board shrank to 7×6); it
 * additionally needs those words to have mutually distinct characters, which a flat
 * count cannot express — see PROVISION_RETRY_FACTOR.
 */
export const CARD_BASELINES: Record<CardBaselineSurface, number> = {
  'bubble-match': 20,
  'match-speed': 20,
  'speed-reading': 20,
  'word-search': 9,
  flp: 20,
};

/**
 * Surfaces whose ENTIRE supply model is the partial refill.
 *
 * Background. `GET /api/onDeck/gamePool` treats a request carrying `need` as a
 * mid-session top-up and, historically, refused to lend on it: Bubble Match's
 * "Play Again" keeps the pairs you missed and refills the ones you cleared, and
 * lending there would quietly grow the player's deck on every tap.
 *
 * That rule assumes a game rolls its board ONCE and refills are the exception.
 * Hydra Bubbles inverts it — it is endless, it fetches every spawn as a refill,
 * and it declares no baseline at all, so under the blanket exemption it could
 * never lend a single card at any point in a run (docs/HYDRA_BUBBLES.md § 6.1).
 *
 * So the exemption becomes opt-out rather than universal: a surface listed here
 * may lend on a refill. Nothing else changes — the collection/deck restriction
 * still blocks lending outright, because a deck round made of non-deck words is
 * not that deck.
 *
 * Deliberately NOT folded into `CardBaselineSurface`: these are orthogonal
 * questions ("how many cards do you need up front?" vs "may you lend mid-run?"),
 * and Hydra answers the first with "none". Memory Map sets the same precedent by
 * staying out of `CARD_BASELINES` entirely rather than declaring a baseline of 0.
 */
export type RollingSupplySurface = 'hydra-bubbles';

export const ROLLING_SUPPLY_SURFACES: readonly RollingSupplySurface[] = ['hydra-bubbles'];

/** Narrow an untrusted `?surface=` value to a rolling-supply surface. */
export function isRollingSupplySurface(raw: string | null | undefined): boolean {
  return ROLLING_SUPPLY_SURFACES.includes(raw as RollingSupplySurface);
}

/**
 * Ceiling on over-provisioning, as a multiple of the surface's baseline.
 *
 * Word Search can be handed exactly `baseline` cards and still fail to build a grid,
 * because it needs ten words with mutually DISTINCT characters and a provisioning
 * query that only counts rows cannot guarantee that. So the grid builder is allowed
 * to ask for another batch and retry, up to this multiple, before giving up. Other
 * surfaces only ever provision to 1× baseline.
 */
export const PROVISION_RETRY_FACTOR = 3;

/**
 * Whether a surface can NAME the temporary cards it was given.
 *
 * Before play starts, a surface that was topped up tells the player so. Where the
 * played set is fixed and known up front, the notice lists the exact words it lent
 * them. Where the surface streams cards continuously — Match Speed deals from a
 * rolling buffer, flp refills the working loop as you go — the set is not known in
 * advance, so those show the generic "here are some temporary cards" message with no
 * word list.
 *
 * The client derives the words themselves from the served cards
 * (`card.starterPackBucket === 'provisional'`), so there is no separate notice
 * payload on the wire — only this policy, shared so both sides agree.
 */
export const CARD_BASELINE_ITEMIZED: Record<CardBaselineSurface, boolean> = {
  'bubble-match': true,
  'match-speed': false,
  'speed-reading': true,
  'word-search': true,
  flp: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// Memory Map (docs/MEMORY_MAP_GAME.md)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How many words a Memory Map may hold at once.
 *
 * Deliberately NOT in `CARD_BASELINES`: a baseline is a floor the server tops up to
 * with lent cards, and Memory Map declares no floor at all (§ 10 — a small library is
 * simply a small map). This is the opposite quantity, a CEILING, and it exists for two
 * unrelated reasons that happen to agree on the same number:
 *
 *   1. Performance. 100 absolutely-positioned DOM nodes need no viewport culling, so
 *      the whole rendering layer stays "a CSS transform over a world div" (§ 7).
 *   2. A run has to end. "Colour the entire map" is only a playable goal if the map
 *      is bounded; a learner with 4,000 cards would otherwise face a run that never
 *      finishes (§ 2.2).
 *
 * Shared rather than duplicated because BOTH sides need it: the server enforces it
 * when topping the map up, and the client renders it as the `23 / 100` header count.
 */
export const MEMORY_MAP_CAPACITY = 100;

/**
 * The random size multiplier drawn once per word at spawn and then FROZEN forever
 * (§ 2.3). Server-side only in practice — the client just renders what it is given —
 * but it lives on the wire so the range is documented next to the field it fills.
 *
 * Size carries NO meaning. It is not word length, not frequency, not mastery. It
 * exists so the archipelago looks hand-drawn rather than typeset, and it is frozen
 * because a size that tracked mastery would reflow every neighbouring word every time
 * the learner studied — the map's stability is what makes it memorable.
 *
 * ── WHAT THIS RANGE ACTUALLY CONTROLS ────────────────────────────────────────
 * Its RATIO, not its magnitude. The camera fits the whole map on load, so scaling every
 * word by the same factor grows the map's world extent and shrinks the fitted zoom by
 * exactly as much — a wash on screen. Only max/min changes what a player sees: it is the
 * SIZE CONTRAST between the biggest and smallest words on the map.
 *
 * Widened from 0.7–1.6 (ratio 2.3) to 0.95–1.8 (ratio 1.9), so the smallest words read
 * comfortably rather than as specks beside their neighbours.
 *
 * To make EVERYTHING bigger on screen instead, the lever is the camera, not this:
 * `FIT_PADDING` in the game's constants decides how tightly the fitted map fills the
 * viewport.
 */
export const MEMORY_MAP_SCALE_RANGE = { min: 0.95, max: 1.8 } as const;

/**
 * One word's permanent spot on the map, as stored and as sent to the client.
 *
 * `x`/`y` are the CENTRE of the word's axis-aligned bounding box in world
 * coordinates, which are continuous and unitless — the client picks the pixels-per-
 * world-unit at render time. `width`/`height` are NOT stored: they are derived from
 * the rendered text and the frozen `scale`, and the server recomputes them the same
 * way when it needs to place a neighbour (see server/services/memoryMapSpawn.ts).
 */
export interface MemoryMapPlacement {
  /** vet id. Unique per user across the map, and the FK target of the placement row. */
  vocabEntryId: number;
  x: number;
  y: number;
  scale: number;
}

/**
 * A placed word with everything the client needs to draw and prompt it.
 *
 * `definition` is the dd, already resolved through the learner's `selectedSense` —
 * the games-wide sense-correctness rule. Resolving it server-side (rather than
 * shipping the raw cluster set and letting the game pick) is what stops a prompt
 * showing a gloss the learner's own flashcard does not read.
 */
export interface MemoryMapWord extends MemoryMapPlacement {
  entryKey: string;
  pronunciation: string | null;
  definition: string;
  language: string;
}

/** GET /api/memoryMap — the whole map, plus what just changed about it. */
export interface MemoryMapResponse {
  words: MemoryMapWord[];
  /**
   * vet ids of the words placed BY THIS REQUEST, so the client can announce growth
   * ("3 new words joined your map", § 2.5). Without it the map's growth is invisible,
   * which is the feature's entire emotional payload.
   */
  newlyPlaced: number[];
  /** `MEMORY_MAP_CAPACITY`, echoed so the header count needs no second import path. */
  capacity: number;
}

/**
 * POST /api/memoryMap/graduate — a word left the map, so refill it.
 *
 * Called after a mark leaves the word reading-mastered (§ 3.6). The server deletes the
 * placement and immediately spawns the next word in priority order into the freed
 * space, returning it so the client can drop it straight into the running queue.
 */
export interface MemoryMapGraduateResponse {
  /** True when the word was in fact reading-mastered and its row was deleted. */
  graduated: boolean;
  /** The word spawned to replace it, or null if the eligible pool is exhausted. */
  replacement: MemoryMapWord | null;
}

/** The bucket NAMES the discover sort endpoint accepts as input (not all of them persist). */
export type DiscoverSortBucket = 'library' | 'skip' | 'already-learned';

/**
 * Used-in item: a multi-char word that contains a given single character.
 * `vocabEntryId` is null when the item came from the det fallback (not in the user's vet).
 */
export interface UsedInItem {
  vocabEntryId: number | null;
  entryKey: string;
  pronunciation: string | null;
  definition: string | null;
  frequencyScore: number | null;
}

/**
 * One placed icon in a custom flashcard icon arrangement (vet."iconLayout",
 * migration 82; see docs/CARD_ICON_LAYOUT.md). Coordinates are NORMALIZED so a saved
 * layout survives the card being rendered at different pixel sizes across viewports.
 */
export interface IconLayoutItem {
  /** icons8 natural key (icons8."icons8Id"); rendered via /api/icons8/<id>/image. */
  iconId: string;
  /** Icon CENTER as a fraction of card WIDTH [0..1]. */
  x: number;
  /** Icon CENTER as a fraction of card HEIGHT [0..1]. */
  y: number;
  /** Multiplier on the base icon box (~0.28 * cardWidth); clamped ~[0.25, 3]. */
  scale: number;
  /** Degrees. */
  rotation: number;
  /** Paint order (higher = front). */
  z: number;
  /** Horizontal mirror; omitted/false = not mirrored. */
  flipX?: boolean;
  /** When true the icon ignores canvas translate/resize/rotate gestures. */
  locked?: boolean;
}

/** Max icons allowed in one custom arrangement (shared client/server cap). */
export const ICON_LAYOUT_MAX_ITEMS = 12;

/**
 * Per-card snap toggles for the flashcard icon editor (vet."snapConfig", migration
 * 88). Each flag quantizes one editor gesture to a discrete increment (move grid /
 * 22.5° rotation / 5%-of-width size). NULL on the row = all off.
 */
export interface SnapConfig {
  move: boolean;
  rotate: boolean;
  resize: boolean;
}

/**
 * One side of a per-card text-color override (vet."textColors", migration 89).
 * 'theme' follows the device/app theme (the default), 'dark' forces black, 'light'
 * forces white.
 */
export type TextColorMode = 'theme' | 'dark' | 'light';

/**
 * Per-card flashcard text-color overrides (vet."textColors", migration 89).
 * `foreign` colors the foreign-word GLYPHS (the pinyin overlay is never affected);
 * `english` colors the English definition. NULL on the row = both 'theme'.
 */
export interface TextColors {
  foreign: TextColorMode;
  english: TextColorMode;
}

/** Which back-face text block a movable-text placement targets (migration 91). */
export type TextBlock = 'foreign' | 'english';

/**
 * One movable text block's placement (vet."textLayout", migration 91). NORMALIZED
 * coords like IconLayoutItem; no iconId (not an icon), no flipX (mirrored text is
 * unreadable), no z (text always paints above the icon layer).
 */
export interface TextLayoutItem {
  /** Block CENTER as a fraction of card WIDTH [0..1]. */
  x: number;
  /** Block CENTER as a fraction of card HEIGHT [0..1]. */
  y: number;
  /** Multiplier on the block's base font size; clamped ~[0.5, 3]. */
  scale: number;
  /** Degrees. */
  rotation: number;
  /** When true the block ignores canvas translate/resize/rotate gestures. */
  locked?: boolean;
}

/**
 * Per-card movable-text placement for the two back-face text blocks (vet."textLayout",
 * migration 91). Each block optional (absent = default spot); NULL on the row = both
 * at default.
 */
export interface TextLayout {
  foreign?: TextLayoutItem;
  english?: TextLayoutItem;
}

/**
 * The exact set of EXPLICIT card-background fills the fie "card" menu offers
 * (vet."cardColor", migration 94). Any incoming cardColor is validated against this
 * list (else NULL) so only these hexes — or NULL (the "auto" option = follow theme) —
 * are ever stored.
 *
 * `src/utils/cardColor.ts` builds the SWATCH LIST (labels + design tokens) separately,
 * because the UI needs names and re-themeable tokens that a bare hex list cannot carry.
 * The two are no longer hand-synced on trust: `src/__tests__/cardColor.test.ts` asserts
 * that the palette's non-null values are exactly this set. See docs/CARD_ICON_LAYOUT.md.
 * Repainted 2026-08-22 with the app-wide token repaint (the pastel BODY hues moved to
 * near-white TINTS). Migration 153 remaps every already-stored old hex to its new
 * counterpart, so no learner's saved fill is orphaned by the change.
 *   grey #E7E7EA · beige #F5EBE0 · white #FFFFFF · black #000000 · red #FFF2F2 ·
 *   green #F0FAF0 · blue #EEF8FF · yellow #FFF5EA · purple #F8F4FF
 */
/**
 * Every selectable Chinese typeface id — the allow-list for `users."chineseFont"`
 * (migration 157) and the validator behind PUT /api/users/displaySettings.
 *
 * IDS, NOT FAMILY NAMES, are stored. A stored CSS family name would strand every row
 * the day a face is renamed or re-sourced; an id is a stable key the client maps to a
 * family + stylesheet URL.
 *
 * The client's `src/theme/cjkFontOptions.ts` builds the OPTION LIST (labels, native
 * names, stylesheet hrefs, blurbs) separately, because the UI needs presentation the
 * server has no business knowing. The two are not hand-synced on trust:
 * `src/__tests__/chineseFont.test.ts` asserts the catalog's selectable ids are exactly
 * this set — the same guard `cardColor.test.ts` provides for CARD_COLOR_VALUES.
 *
 * Every face here is OFL. `FZKai-Z03` (方正楷体) was evaluated and REMOVED from the
 * catalog entirely on 2026-09-04 — Founder's grant is non-commercial only, so it could
 * never ship, and keeping it as a lab benchmark was a standing temptation with no
 * payoff. `lxgw-wenkai` is the free kai that replaced it.
 *
 * ORDER MATTERS: DEFAULT_CHINESE_FONT_ID leads the list, because Settings shows the
 * default first and badges it. See docs/CJK_TYPEFACE_LAB.md.
 */
export const CHINESE_FONT_IDS: readonly string[] = [
  '975-maru',
  'noto-sans-sc',
  'lxgw-wenkai',
  'xiaolai-sc',
  'yozai',
  'maoken-zhuyuan',
];

/**
 * The face new accounts get, and the fallback whenever a stored id is unrecognised
 * (a row written before a face was retired, say). Mirrors the DEFAULT on
 * `users."chineseFont"` in migration 157 — keep the two in lock-step.
 *
 * NOT the historical face: accounts that existed before migration 157 were explicitly
 * backfilled to 'noto-sans-sc' so nobody's app changed typeface under them.
 */
export const DEFAULT_CHINESE_FONT_ID = '975-maru';

export const CARD_COLOR_VALUES: readonly string[] = [
  '#E7E7EA',
  '#F5EBE0',
  '#FFFFFF',
  '#000000',
  '#FFF2F2',
  '#F0FAF0',
  '#EEF8FF',
  '#FFF5EA',
  '#F8F4FF',
];

/** A related library word surfaced on the card detail page. */
export interface RelatedWord {
  id: number;
  entryKey: string;
  pronunciation: string | null;
  definition: string | null;
}

/**
 * Hard cap on a card note (`VocabEntryBase.note`, vet column, migration 155), in
 * characters. Shared so the on-card editor's counter and the server's truncation agree
 * on one number — a client that lets the learner type past the cap would silently lose
 * the tail on save. Enforced in code, not as a `varchar(n)`, so raising it is a code
 * deploy rather than a table rewrite. See docs/CARD_NOTES.md.
 */
export const CARD_NOTE_MAX_LENGTH = 100;

/**
 * Vocab entry (flashcard), as shipped to the client.
 *
 * Identity fields (`userId`, `language`, `starterPackBucket`) are optional HERE and
 * narrowed to required in `server/types/index.ts`, because the client also builds
 * synthetic entries from det rows via `dictEntryAdapter` that have no vet row behind
 * them. See the Base/narrow note at the top of this file.
 */
export interface VocabEntryBase {
  id: number;
  /** Absent on client-side det-fallback (non-vet) entries. */
  userId?: string;
  entryKey: string;
  /** det.definitions[0] — joined from dictionaryentries_* at read time. */
  definition?: string | null;
  /** Absent on client-side det-fallback entries. */
  language?: Language;
  script?: string;
  pronunciation?: string | null;
  /** Tone digits derived from pronunciation (e.g. "12" for fēng kuáng). */
  tone?: string | null;
  difficulty?: DifficultyLevel | null;
  /** POS tags from the det row (e.g. ["noun", "verb"]). */
  partsOfSpeech?: string[] | null;

  /**
   * Read-time approval flags (enrichFieldApprovalsBatch), same semantics as on
   * DictionaryEntryBase. See docs/DATA_VALIDATION_SYSTEM.md.
   */
  definitionsApproved?: boolean;
  partsOfSpeechApproved?: boolean;
  difficultyApproved?: boolean;
  frequencyScoreApproved?: boolean;
  /** Per-SENSE commonality approvals; see DictionaryEntryBase. */
  approvedSenseFrequencyLabels?: readonly string[];

  /** 1 = would stop the conversation … 5 = everyday (from the det row). */
  frequencyScore?: number | null;
  /** Orthogonal sense clusters, joined from det via DICT_JOIN. */
  definitionClusters?: DefinitionCluster[] | null;
  /** Per-card chosen cluster `sense` label (vet column, migration 99). NULL = default. */
  selectedSense?: string | null;
  /**
   * The learner's own free-text note about this card (vet column, migration 155).
   * At most CARD_NOTE_MAX_LENGTH characters; NULL/absent = no note. Rendered at the
   * bottom of the card's answer face only. See docs/CARD_NOTES.md.
   */
  note?: string | null;

  /** Per-type mark streams (migration 101); see docs/MASTERY_REWORK.md. */
  typedMarkHistory?: TypedMarkHistory;
  /**
   * The CORE bar's utcm level (recognition + production), computed from
   * typedMarkHistory. Goal-independent since migration 143 — the reading/writing
   * goals now raise their own bars instead of re-weighting this one.
   */
  category?: FlashcardCategory;
  /**
   * When each bar LAST crossed into its `mastered` band (vet column; jsonb keyed by
   * bar since migration 143, a single timestamptz in migration 142).
   *
   * Sticky per bar — a later regression does not clear it — so "recently mastered"
   * stays a usable ordering for a card that dipped. A key is missing/null for every
   * bar whose crossing was never observed, which includes every card mastered before
   * migration 142 (the crossing moment is not recoverable from the rolling
   * `typedMarkHistory` window, so it is deliberately not backfilled).
   *
   * See docs/MASTERY_REWORK.md § "masteredAt".
   */
  masteredAt?: MasteredAtByBar | null;
  /**
   * When this card was added to the DECK currently being read (`deck_cards.addedAt`,
   * migration 141). Present ONLY on rows from `OnDeckVocabService.getDeckCards` —
   * absent on Learn Now, Mastered, game pools and dictionary lookups, because deck
   * membership is a property of a (deck, card) pair rather than of the card.
   * Powers the deck-only "Recently added to this deck" sort.
   */
  deckAddedAt?: Date | string | null;
  /**
   * The game-pool bucket this card was drawn from, stamped only by
   * `getGameVocabPool` (absent everywhere else). NOT the same thing as `category`
   * above: this is the PER-MARK-TYPE category the game selected on (recognition for
   * Bubble Match / Match Speed, reading for Word Search No-Pinyin), whereas
   * `category` is the goal-blended overall utcm level the decks page renders. It
   * reports the bucket actually drained, so it stays accurate when a short bucket is
   * topped up from the fallback order. Match Speed sorts its per-category card
   * buffer by it; the other games ignore it.
   * See docs/MATCH_SPEED_GAME.md § Backend change and docs/MASTERY_REWORK.md.
   */
  gameCategory?: FlashcardCategory;
  /**
   * flp face-steering (docs/MASTERY_REWORK.md § Per-type cooldown): the subset of
   * flp-reviewable mark types ('recognition'/'production') whose PER-TYPE cooldown has
   * elapsed. The client shows the matching face; both present ⇒ a weighted flip
   * biased toward the track with less progress (src/utils/flpFaceSteering.ts). Absent on
   * cards not routed through flp selection (games, dictionary lookups).
   */
  readyMarkTypes?: MarkType[];
  /** Starter pack sorting bucket. Required on the server; absent on det-fallback entries. */
  starterPackBucket?: StarterPackBucket | null;

  breakdown?: BreakdownMap | null;
  synonyms?: string[] | null;
  /** Computed at runtime by batch-reading from the det table. */
  synonymsMetadata?: Record<string, { definition: string; pronunciation: string }> | null;

  /** AI-generated extended definition, narrowed to the card's current sense. */
  longDefinition?: string | null;
  /** Raw det column (migration 126); folded onto the `foreign` parts then dropped. */
  longDefinitionCitations?: LongDefinitionCitation[] | null;
  longDefinitionParts?: LongDefinitionPart[] | null;
  longDefinitionSenses?: LongDefinitionSenseView[] | null;

  /** Representative icons8 icon joined from det; rendered via /api/icons8/<id>/image. */
  iconId?: string | null;
  /** Custom icon arrangement (migration 82). NULL = default centered iconId. */
  iconLayout?: IconLayoutItem[] | null;
  /** Per-card icon-editor snap toggles (migration 88). NULL = all off. */
  snapConfig?: SnapConfig | null;
  /** Per-card text-color overrides (migration 89). NULL = both 'theme'. */
  textColors?: TextColors | null;
  /** Per-card movable-text placement (migration 91). NULL = default lower-third. */
  textLayout?: TextLayout | null;
  /** Per-card background fill, one of CARD_COLOR_VALUES (migration 94). NULL = theme. */
  cardColor?: string | null;

  exampleSentences?: ExampleSentence[];
  /** Related library words (computed dynamically). */
  relatedWords?: RelatedWord[];
  /** Single-char zh only: multi-char words containing this character. Computed at runtime. */
  usedIn?: UsedInItem[] | null;
  /**
   * Pre-warm result from TTSService.synthesize — false means synthesis failed and the
   * client should fall back to Web Speech. Absent means no prewarm ran (treat as true).
   */
  hasAudio?: boolean;
  /**
   * Whether the source det row is discoverable. Carried through dictEntryAdapter so the
   * dictionary eip can hide "+ to Learn Now" for undiscoverable lookups. Absent on real
   * vet rows (already in the library by definition).
   */
  discoverable?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Discover / sort flow (docs/SORT_CARDS_REQUIREMENTS.md)
// ─────────────────────────────────────────────────────────────────────────────

/** Discover Card — a curated dictionary entry shaped for the sort-cards UI. */
export interface DiscoverCard {
  /** dictionaryEntry.id — sent in the sort POST. */
  id: number;
  /** word1. */
  entryKey: string;
  /** definitions[0]. */
  definition: string;
  pronunciation?: string | null;
  tone?: string | null;
  language: Language;
  word2?: string | null;
  script?: string | null;
  difficulty?: DifficultyLevel | null;
  /**
   * Conversational commonality for the whole entry (1 = would stop the conversation …
   * 5 = everyday), read straight from the det `frequencyScore` column.
   * Drives the sort-flow supply ordering (most frequent first) and the mini-card badge.
   */
  frequencyScore?: number | null;
  breakdown?: BreakdownMap | null;
  synonyms?: string[] | null;
  exampleSentences?: ExampleSentence[] | null;
  /** Multi-char tokens to suppress during GSA segmentation. */
  matchException?: string[] | null;
  /** English word/phrase in a translation corresponding to the vocab word. */
  translatedVocab?: string | null;
  /** Optional icons8 icon id; rendered via /api/icons8/<id>/image. Null when unassigned. */
  iconId?: string | null;
  /**
   * Sort-pack card state (set by getNextPacks; absent in the legacy single-card flow).
   * `sorted` → the user already has a library vet row: renders locked with a "sorted!"
   * watermark, not draggable. `skipped` → currently in discover_skips but shown inside
   * an authored pack, so it is draggable again.
   */
  sorted?: boolean;
  skipped?: boolean;
}

/**
 * A sort pack: the on-deck unit of the discover sort flow — up to 3 cards to sort
 * (docs/SORT_CARDS_REQUIREMENTS.md §4.5). Authored packs come from `sort_packs`;
 * system fallback packs-of-1 are built on the fly.
 */
export interface SortPack {
  /** Stable client identity: "pack:<id>" (authored) | "single:<cardId>" (fallback). */
  packKey: string;
  /** sort_packs.id for authored packs; null for fallback packs-of-1. */
  packId: number | null;
  level: number;
  cards: DiscoverCard[];
}

/**
 * GET /api/starterPacks/:language response — the initial FIFO queue fill.
 * The CLIENT owns adaptive leveling after this call; the server only seeds a
 * cold-start level when the request omits one.
 */
export interface DiscoverFetchResponse {
  /** The client holds a short FIFO queue of packs (on-deck + buffer). */
  packs: SortPack[];
  /** True only when the whole discoverable dictionary is sorted. */
  exhausted: boolean;
  /** The level supply was centered on — echoed back to seed the client's target. */
  level: number;
}

/** POST /api/starterPacks/nextPack response: one replacement pack for the FIFO tail. */
export interface DiscoverNextPackResponse {
  /** Null when exhausted. */
  nextPack: SortPack | null;
  exhausted: boolean;
  /** Echoes the level the request centered on. */
  level: number;
}

/** POST /api/starterPacks/sort response (pack mode, per-card). */
export interface DiscoverSortResponse {
  success: boolean;
  bucket: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reader documents
// ─────────────────────────────────────────────────────────────────────────────

/** Text model for the reader feature. */
export interface TextBase {
  id: string;
  /** uniqueidentifier in SQL, nullable for system texts. */
  userId?: string | null;
  title: string;
  description: string;
  content: string;
  language: Language;
  characterCount: number;
  /** Distinguishes user-created from system texts. */
  isUserCreated: boolean;
  /**
   * Validation-doc linkage (migration 104). NULL/undefined ⇒ ordinary user document.
   * When set, this text reviews dictionaryentries_<validationLanguage>.id =
   * validationEntryId (det id is a SERIAL integer).
   */
  validationEntryId?: number | null;
  validationLanguage?: Language | null;
  validationField?: ValidationField | null;
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Community (docs/COMMUNITY_PAGE.md)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A community-shared advanced card-icon design. Identity = (ownerUserId, entryKey,
 * language). Carries just enough det fields to render the read-only mini card / zoom.
 */
export interface CommunityDesign {
  ownerUserId: string;
  ownerName?: string | null;
  /** Who DESIGNED the layout (the owner when unattributed) — feeds dedupe + credit. */
  authorUserId: string;
  /** The author's display name; null if that account is gone (fall back to ownerName). */
  authorName?: string | null;
  entryKey: string;
  language: Language;
  iconLayout: IconLayoutItem[] | null;
  pronunciation?: string | null;
  tone?: string | null;
  script?: string | null;
  definition?: string | null;
  /** Votes since the viewer's current week boundary. */
  voteCountThisWeek: number;
  /** Whether the viewer already has this word saved (drives the apply-button label). */
  inLibrary: boolean;
}

/** A design the viewer voted on this week (identity key only) — used to grey voted designs. */
export interface VotedDesignKey {
  ownerUserId: string;
  entryKey: string;
  language: Language;
}

export type VoteResult = 'recorded' | 'already-voted';
export type ApplyDesignResult = 'applied' | 'added-and-applied' | 'would-override';

// ─────────────────────────────────────────────────────────────────────────────
// Speed Reading game (docs/SPEED_READING_GAME.md)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One distractor candidate drawn from the player's own library — a REAL
 * character the game substitutes into the word to make the wrong option.
 */
export interface DistractorChar {
  char: string;
  /**
   * The character's intrinsic difficulty band, 1–6 (= HSK level for zh), from
   * `dictionaryentries_zh.difficulty`. Used to prefer a same-level distractor.
   *
   * NULL when the character has no standalone dictionary entry — it only ever
   * appears inside multi-character words — in which case no level preference is
   * possible and the fallback ladder drops straight to the next rung.
   */
  difficultyBand: number | null;
  /**
   * Whether the player has mastered this character's READING track.
   *
   * Reported rather than filtered out server-side: these are the LAST RUNG of
   * the client's fallback ladder. A mastered character makes a weak distractor
   * (the player rejects it instantly), but "weak distractor" beats "no round at
   * all" for a small library — and only the client, which knows the prompt word,
   * can tell whether the earlier rungs produced a candidate.
   */
  readingMastered: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Envelopes
// ─────────────────────────────────────────────────────────────────────────────

/** Generic API response envelope. */
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  code?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Arena (docs/ARENA_FEATURE.md)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Exactly 25 members per arena, humans plus synthetic padding (§ 6).
 *
 * The number is load-bearing, not cosmetic: promotion takes the top 5 and
 * relegation the bottom 5, so an arena must be comfortably larger than 10 or the
 * two zones meet and every member both promotes and relegates. 25 also fits a
 * scrollable board without paging.
 */
export const ARENA_SIZE = 25;

/** Rungs on the ladder, 1 (bottom) through 12 (top). */
export const ARENA_DIVISION_COUNT = 12;

/** Top N promote, bottom N relegate (§ 7). Synthetic members occupy real ranks. */
export const ARENA_PROMOTE_COUNT = 5;
export const ARENA_RELEGATE_COUNT = 5;

/**
 * Length of a geohash cell stored in `users."geoCell"` — 5 characters, a tile of
 * roughly 5 km x 5 km (§ 5.2).
 *
 * This is the privacy contract, not a tuning knob. Five characters name a
 * neighbourhood and cannot name a home; the client truncates to this length
 * before transmitting, and the DB CHECK refuses anything else.
 */
export const ARENA_GEOCELL_LENGTH = 5;

// ─────────────────────────────────────────────────────────────────────────────
// Study Challenge (docs/STUDY_CHALLENGE.md) — migration 148
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Words in a challenge set — fixed at 9, deliberately not a choice (Q27, § 8.4).
 *
 * Set size decides how many points are available, so both players must use the
 * same number anyway; making it selectable would add a negotiation round trip to
 * buy nothing. Being a constant, it changes globally with no schema or protocol
 * change — 10 → 12 on 2026-08-17 and 12 → 9 on 2026-08-28 were each exactly this
 * edit plus copy.
 *
 * ⚠️ ONE THING IS DERIVED FROM IT RATHER THAN STORED, and it moves when this does:
 * the CONTESTED CEILING per round — `contestedHit` × this count, so 900 at 9 (the
 * § 5.3/5.4 prose still quotes the ceiling in words; the specs below carry only the
 * per-event values, which is why they need no edit here).
 *
 * WORD SEARCH's board (`TOTAL_WORDS`, src/games/word-search/constants.ts) also
 * holds 9, and the two are separately declared — nothing derives one from the
 * other, they simply landed on the same number again on 2026-08-28. A challenge
 * round now plays on the SAME 7×6 grid as an ordinary board (the old roomier 8×8
 * challenge grid was removed): one size, one density, one tuning. § 5.2 still
 * requires every contested word to appear in every round — an obligation on the
 * round runner (src/games/runtime/useChallengeRound.ts), which IS built.
 */
export const CHALLENGE_WORD_COUNT = 9;

/**
 * Rounds (games) in a test — 3, drawn without repetition from the eligible pool.
 *
 * A CEILING, not a guarantee. When fewer games qualify the test is simply that
 * many rounds: an es-vs-es challenge has two eligible games today because Word
 * Search is zh-only, and a cross-language pair likewise (§ 5.1, § 8.3). The
 * format bends; it never blocks.
 */
export const CHALLENGE_ROUND_COUNT = 3;

/**
 * How many challenges one learner may be committed to at once, PER (user,
 * language) — six decks and up to eighteen rounds in a weekend, which is already
 * past the point where any of them gets real preparation (Q65, § 1).
 *
 * Two properties that are easy to lose in an implementation:
 *
 * 1. It counts challenges you are COMMITTED to — issued-and-still-pending, plus
 *    accepted — in either role. **Incoming invitations do not count until you
 *    accept.** If they did, one friend could fill your quota with invitations you
 *    never asked for and lock you out of challenging anyone. So the cap is checked
 *    TWICE, on issue and again on accept, and is only ever spent by your own
 *    decisions.
 * 2. It is per (user, language), like decks, minute points (migration 130) and the
 *    vet layer. A single account-wide budget was rejected because it would be the
 *    only place in the app where two languages compete for a resource.
 */
export const MAX_ACTIVE_CHALLENGES = 6;

/**
 * How a surface wants its short card pool topped up
 * (docs/PROVISIONAL_CARDS.md, § 5.2).
 *
 * 'default'        — nearest level → commonality → id. Everything today.
 * 'mastered-first' — exhaust the player's OWN cards, hardest-known first, before
 *                    borrowing: Mastered (most recently mastered first, via
 *                    `masteredAt`, migration 142) → Comfortable → Target →
 *                    Unfamiliar → and only then 'default' lending.
 *
 * Study Challenge needs the second mode because a round plays against a 10-card
 * deck, so every game will be short and will lend heavily — and filler must not
 * be a source of difficulty. A challenge measures the ten contested words;
 * padding the board with words the player has never seen would add noise and,
 * worse, reward whoever got luckier filler. Filler the player already owns is
 * near-free points for both sides, which is why it scores 20 rather than 100.
 *
 * Every step degrades silently to the next, so no caller ever has to check
 * whether a player has mastered cards.
 */
export type ProvisionMode = 'default' | 'mastered-first';

/** `'same_word'`: one negotiated set used by both. `'different_word'`: one set each (§ 8). */
export type ChallengeVariant = 'same_word' | 'different_word';

/**
 * Lifecycle of a challenge (§ 6, § 8.2).
 *
 * `expired` and `no_contest` are deliberately DISTINCT (Q17): an expired
 * challenge never had a word set both players agreed to and never created a deck,
 * whereas a no_contest was fully agreed and simply ran out of window (or was
 * ended by an unfriend, Q41).
 *
 * There is no "accepted but unpicked" state — the challengee picks their words
 * before the challenge is accepted, so the backend never holds a set-less
 * accepted challenge.
 */
export type ChallengeStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'complete'
  | 'no_contest';

/**
 * One entry in a challenge's game sequence.
 *
 * A `(gameId, mode)` PAIR, never a bare id: eligibility is per MODE, so Word
 * Search qualifies as *Pinyin* (production) and not as *No Pinyin* (reading). A
 * bare id would let a challenge draw the ineligible mode
 * (docs/GAMES_FEATURE.md § Challenge-eligible games).
 *
 * `mode` is null for a game that has only one.
 */
export interface ChallengeGameRef {
  gameId: string;
  mode: string | null;
}

/**
 * One of the ten contested words, as stored on the challenge.
 *
 * `word1` + `language` is the identity, denormalised, so history survives a det
 * data deploy — det ids are not stable across re-imports (Q49).
 *
 * `vocabEntryId` is filled in when the set is materialised on accept (§ 3.3) and
 * is null before then. It is a CONVENIENCE POINTER, never an identity and never a
 * claim of library membership, and it may dangle: the challenge owns "which ten
 * words", the vet row owns "is this word in the user's library" (Q54). A player
 * who deletes a contested card mid-challenge still plays it — they just lose the
 * ability to study it.
 */
export interface ChallengeWord {
  position: number;
  word1: string;
  language: Language;
  vocabEntryId: number | null;
  /**
   * READ-PATH ONLY, and never persisted. The stored row carries identity alone
   * (Q49); `toSummary` resolves these from the det on the way out
   * (`findDisplayFieldsByWords`) so every surface that draws a challenge word can
   * render the SAME mini preview card a candidate renders — pinyin through
   * ForeignText, the English lead gloss, the conversation-frequency badge, the icon,
   * and a det id to strike by. All absent on the stored jsonb, and all absent for a
   * word whose det row has since gone away, which draws as a bare word rather than
   * failing the read.
   */
  pronunciation?: string | null;
  definition?: string | null;
  frequencyScore?: number | null;
  iconId?: string | null;
  dictionaryEntryId?: number | null;
}

/**
 * A round of a test — CLAIMED at the player's first mark, FINALISED when the run
 * ends or they walk away from it (§ 5.1a).
 *
 * ⚠️ `completedAt === null` IS THE IN-PROGRESS FLAG. There is deliberately no
 * separate `status`: two fields that encode the same fact are two fields that can
 * disagree, and every row written before this shape existed carries a
 * `completedAt`, so they all read as completed with no backfill.
 *
 * The lifecycle the rest of the feature is built on:
 *
 *   absent            → the round has not been started; its board may be issued
 *   completedAt null  → CLAIMED. The attempt is spent. The board is never issued
 *                       again, `score`/`breakdown` hold the run so far, and the
 *                       row is still writable.
 *   completedAt set   → FINAL. Nothing may write it again (Q40, no replays).
 *
 * Claiming on the first mark rather than on submit is what makes the one-attempt
 * rule survive the client: quitting the app, reloading the tab or clearing local
 * state all leave the claim standing, so there is nothing to re-roll. The score
 * banked by a player who never comes back is whatever their last mark had earned.
 *
 * `gameId`/`mode` are stored per round even though they are derivable from the
 * challenge's `gameSequence`, so the history page's game filter does not have to
 * correlate two arrays (§ 1).
 *
 * `breakdown` must be derived from the SAME accumulator as `score`, never
 * recomputed for display, or the two can disagree on screen with nothing to
 * arbitrate (§ 5.6). It is an open shape on purpose — the results page renders
 * whatever lines the game's spec produced, and a game may enrich it later without
 * a migration.
 */
export interface ChallengeRound {
  gameId: string;
  mode: string | null;
  score: number;
  breakdown: ChallengeScoreBreakdown;
  /** When the first mark of this round was made. Absent on rows written before this shape. */
  startedAt?: string;
  /** null while the round is in progress; the stamp makes it final. */
  completedAt: string | null;
}

/**
 * The canned taunts (§ 6a, design F17). A player who has finished a completed
 * challenge may send exactly ONE of these to their opponent; it renders on that
 * opponent's card on the results screen.
 *
 * ⚠️ A CLOSED LIST, NOT FREE TEXT, and that is the whole design. A message box
 * between two named accounts is a harassment surface that would need moderation, a
 * report path and a review queue — for a feature whose entire job is one joke after
 * a game. A fixed list gets the rivalry with none of that, and it can be reworded in
 * a deploy because the stored value is the KEY, never the line.
 *
 * ⚠️ IDS ARE PERMANENT. `tauntId` is stored on `study_challenges.taunts`
 * (migration 156), so renaming a key orphans every taunt already sent. Rewording a
 * `text` is free; changing an `id` is not. To retire a line, delete it — an unknown
 * id degrades to "no taunt", which is why the client must tolerate one.
 */
export const CHALLENGE_TAUNTS: readonly { id: string; text: string }[] = [
  { id: 'eight-of-nine', text: "Nine words. I only needed eight of them." },
  { id: 'stay-honest', text: "I'd say good game, but let's stay honest." },
  { id: 'deck-called', text: "Your deck called. It wants a rematch without you." },
  { id: 'hopes-popped', text: "Bubbles popped, hopes too." },
  { id: 'posterity', text: "Screenshot saved. For posterity." },
  { id: 'studied-browsed', text: "I studied. You browsed." },
  { id: 'rounding-error', text: "Rounding error, sure. In your favour." },
  { id: 'same-nine', text: "Same nine words. Different outcomes." },
] as const;

/** Look up a taunt's line. `null` for an id this build no longer knows. */
export function challengeTauntText(tauntId: string): string | null {
  return CHALLENGE_TAUNTS.find((taunt) => taunt.id === tauntId)?.text ?? null;
}

/** One player's sent taunt, as stored under their own user id. */
export interface ChallengeTaunt {
  /** A `CHALLENGE_TAUNTS` id. Never a user-authored string. */
  tauntId: string;
  sentAt: string;
}

/**
 * The itemised lines the between-games scoreboard (§ 5.5) and the results page
 * render, plus the total they must sum to.
 *
 * `lines` is ordered for display and each entry is already resolved to points, so
 * the card can never disagree with the number it is showing.
 */
export interface ChallengeScoreBreakdown {
  lines: ChallengeScoreLine[];
  total: number;
}

/** One row of a score breakdown, e.g. `contested matches  7 × 100  +700`. */
export interface ChallengeScoreLine {
  /** Stable key of the rule that produced this line, e.g. `contestedHit`. */
  ruleId: string;
  /** Display label, e.g. "contested matches". */
  label: string;
  /** How many times it fired. Null for a one-off line such as a survival bonus. */
  count: number | null;
  /** Points per occurrence. Null when the line is not a simple multiple. */
  unitPoints: number | null;
  /** The line's contribution to the total. May be negative. */
  points: number;
}

/**
 * How one challenge-eligible game turns events into points (§ 5.4, Q76).
 *
 * ⚠️ DECLARATIVE DATA, NOT A CALLBACK — this is the single constraint that decides
 * the shape, and it is easy to violate accidentally by "just" exporting a scoring
 * function. Live mode (phase 2) must be able to score the same events SERVER-SIDE
 * with no game page mounted: a callback is code the server cannot reuse, a spec is
 * a table of numbers it can.
 *
 * Three rules a spec must respect:
 *  * **Nothing may depend on mastery.** Contested/filler is fixed when the board
 *    is generated and never re-read. A challenge round writes real marks, so bands
 *    move DURING a round and band-dependent scoring would be non-deterministic.
 *  * **The board must not reveal which words are contested** (Q74) — the split is
 *    invisible until the results screen.
 *  * **A run can end without completing** (live forfeit), so the score must be
 *    running, never computed only in an end-of-run branch.
 */
export interface ChallengeScoringSpec {
  /** Points for matching / mistaking one of the challenge's ten words. */
  contestedHit: number;
  contestedMiss: number;
  /** Points for matching / mistaking any other card on the board. */
  fillerHit: number;
  fillerMiss: number;
  /**
   * When true, a miss is charged AT MOST ONCE per foreign word per run — the
   * per-run set is keyed by the foreign word, not the card id, so es and zh
   * behave identically (§ 5.4).
   */
  missChargedOncePerWord: boolean;
  /** Per-game extras: Bubble Match's survival bonus, Word Search's time penalty. */
  bonuses?: ChallengeScoringBonus[];
}

/**
 * A per-game scoring extra, expressed as data so the server can evaluate it too.
 *
 * `survival` — awarded `points` at `trigger`, held flat for `graceMs`, then decaying
 *   `decayPoints` every `decayIntervalMs` down to `floor`, and forfeited entirely if
 *   the run is LOST. Bubble Match's +500 is deliberately large and all-or-nothing
 *   (Q68): Bubble Match *is* a survival game, so a challenge score that ignored
 *   survival would be scoring a different game than the one played.
 *
 *   ⚠️ THE KIND IS NAMED FOR ITS FIRST USER, NOT FOR WHAT IT DOES. What it actually
 *   expresses is "a decaying pot, armed by an event and forfeited on a loss", which
 *   is why Hydra's CLEAR BONUS (`trigger: 'runStart'`) also uses it: there the pot is
 *   armed at t=0 and the loss condition is "did not clear the challenge set", so the
 *   decay is simply time-to-clear. `decayingPot` would be the honest name.
 * `elapsedPenalty` — `points` (negative) per `decayIntervalMs` after
 *   `graceMs` of ACCUMULATED ACTIVE time. Word Search's −10/s after 1:00.
 * `perUse` — `points` each time the player uses something. Word Search's −20 hint.
 *
 * ⚠️ Every time-based bonus rides ACCUMULATED ACTIVE TIME, never
 * `now − startedAt`, so it honours both pause sources — input-blocking popups and
 * backgrounding (docs/GAMES_FEATURE.md). Otherwise reading a pre-round
 * provisional notice costs the player points.
 */
export interface ChallengeScoringBonus {
  ruleId: string;
  label: string;
  kind: 'survival' | 'elapsedPenalty' | 'perUse';
  points: number;
  /**
   * `survival` only: what arms the pot. `ceilingDrop` is Bubble Match's dropping
   * ceiling; `runStart` arms it at t=0, which is what turns the decay into a
   * time-to-finish measure (Hydra's clear bonus).
   */
  trigger?: 'ceilingDrop' | 'runStart';
  decayPoints?: number;
  decayIntervalMs?: number;
  floor?: number;
  /**
   * Free time before the decay/penalty starts accruing, in ACTIVE ms. On
   * `elapsedPenalty` it is measured from the start of the run; on `survival` it is
   * measured from the moment the pot was armed.
   */
  graceMs?: number;
  /** `survival` only: forfeit the whole bonus when the run is lost. */
  forfeitOnLoss?: boolean;
}

/**
 * One challenge-eligible game (or game MODE), with the spec it is scored by.
 *
 * `languages` omitted = playable in every language. Word Search is the outlier
 * because its grid is built from characters.
 */
export interface ChallengeGameSpec {
  gameId: string;
  /** Null for a game with one mode; the mode's id for a moded game. */
  mode: string | null;
  /** Display name including the mode, e.g. "Word Search (Pinyin)". */
  title: string;
  /** Must be 'recognition' or 'production' — reading/writing games are not eligible. */
  markType: Extract<MarkType, 'recognition' | 'production'>;
  languages?: Language[];
  scoring: ChallengeScoringSpec;
}

/**
 * THE challenge-eligible pool (§ 5.1) — the games a test may draw from, with the
 * numbers each is scored by.
 *
 * ⚠️ WHY THIS LIVES IN THE CONTRACT AND NOT ONLY IN `src/games/registry.ts`.
 * docs/GAMES_FEATURE.md says eligibility is "derived from the registry, never
 * hand-listed", and that is still how a game becomes eligible — but the registry
 * cannot be the physical home of these numbers, because THE SERVER DRAWS THE GAME
 * SEQUENCE (at issue time, § 5.1b) and `src/games/registry.ts` imports lazy React
 * components that the Node build cannot load. Live mode (phase 2) additionally has
 * to score these same events server-side with no game page mounted, which is the
 * constraint that made the spec declarative data in the first place (Q76).
 *
 * So: this table is the source of truth, the registry attaches each entry to its
 * `GameDef.challengeScoring` by lookup, and `src/games/__tests__/challengePool.test.ts`
 * fails if a recognition/production game exists in the registry without an entry
 * here. That test is what preserves "derived from the registry" — adding a game and
 * forgetting this table is a red test, not a silently ineligible game.
 *
 * Four entries today, so a draw of 3 finally has real choice in it — Hydra Bubbles
 * was the fourth. The draw is without repetition, and a fifth recognition/production
 * game joins the rotation with no code change beyond its own entry.
 */
export const CHALLENGE_GAMES: readonly ChallengeGameSpec[] = [
  {
    gameId: 'bubble-match',
    mode: null,
    title: 'Bubble Match',
    markType: 'recognition',
    scoring: {
      contestedHit: 100,
      contestedMiss: -100,
      fillerHit: 20,
      fillerMiss: -20,
      missChargedOncePerWord: true,
      bonuses: [
        {
          ruleId: 'survival',
          label: 'survival bonus',
          kind: 'survival',
          points: 500,
          trigger: 'ceilingDrop',
          decayPoints: -100,
          decayIntervalMs: 2000,
          floor: 0,
          // Losing forfeits the whole thing (Q68). Bubble Match IS a survival
          // game, so a challenge score that ignored survival would be scoring a
          // different game than the one played — and the cliff is what makes the
          // last thirty seconds tense.
          forfeitOnLoss: true,
        },
      ],
    },
  },
  {
    gameId: 'match-speed',
    mode: null,
    title: 'Match Speed',
    markType: 'recognition',
    scoring: {
      contestedHit: 100,
      contestedMiss: -100,
      fillerHit: 20,
      fillerMiss: -20,
      missChargedOncePerWord: true,
      // No bonus. Match Speed's challenge shape is the ALTERNATION RULE instead
      // (§ 5.3): every other pair dealt must be contested, and when the contested
      // words run out the alternation lapses to filler rather than recycling them.
      // That gives its contested score a hard ceiling of
      // CHALLENGE_WORD_COUNT × contestedHit (900 at 9) and makes CLEARING THE SET
      // the goal of the round rather than raw taps-per-second.
    },
  },
  {
    gameId: 'hydra-bubbles',
    mode: null,
    title: 'Hydra Bubbles',
    markType: 'recognition',
    scoring: {
      contestedHit: 100,
      contestedMiss: -100,
      // FILLER PAYS NOTHING HERE — the one game where it does not (2026-09-02).
      // Everywhere else filler is near-free points that cannot decide the match. In
      // Hydra it could: the run ends on the LAST contested clear and nothing charges
      // for time, so a player who cleared eight of nine and then farmed filler bubbles
      // outscored one who finished cleanly and fast. Overflow forfeits nothing either
      // (there is no survival bonus to lose), so the farm had no downside beyond the
      // risk of a wrong match. Zeroing the reward removes the incentive at the source;
      // the clear bonus below then makes dawdling actively expensive rather than
      // merely unprofitable.
      //
      // `fillerMiss` deliberately STAYS negative: filler clears are not optional — a
      // drain clear is how the board is kept off the ceiling — so filler must remain
      // pure risk rather than becoming inert. Right earns nothing, wrong still costs.
      fillerHit: 0,
      fillerMiss: -20,
      missChargedOncePerWord: true,
      bonuses: [
        {
          ruleId: 'clearBonus',
          label: 'clear bonus',
          // The `survival` KIND, not a survival bonus — see the kind's own note. Here
          // it is a decaying pot armed at t=0 and forfeited unless the set is cleared,
          // which is how Hydra finally scores TIME (O2, docs/HYDRA_BUBBLES.md § 11).
          kind: 'survival',
          trigger: 'runStart',
          points: 300,
          // Full pot for the first minute, then −25 every 15 s, reaching 0 at 4:00 of
          // ACTIVE time. The grace exists because we have no telemetry on real clear
          // times (nothing stores a round's duration), so the numbers are a first
          // guess: a flat head start means a guess that is too aggressive cannot
          // punish a genuinely fast run, only fail to separate it.
          graceMs: 60_000,
          decayPoints: -25,
          decayIntervalMs: 15_000,
          floor: 0,
          // THE WHOLE REASON THIS IS SAFE. A naive per-second penalty charged every
          // run would pay players to fail fast: a run that ends on a wrong match at
          // 0:30 has a better clock than one that clears all nine in 4:00, because
          // finishing takes longer than quitting BY DEFINITION. Forfeiting on a loss
          // means the term exists only for runs that are actually comparable — every
          // player holding it cleared the same nine words — so it can separate
          // finishers from each other without ever inverting the contested ranking.
          forfeitOnLoss: true,
        },
      ],
      // NO SURVIVAL BONUS in the Bubble Match sense, which is the opposite call from
      // Bubble Match's, on purpose. Bubble Match's run has a fixed length (its 20
      // pairs), so "how long did you last" is a comparable number. Hydra is ENDLESS: a
      // free-play run ends only when the player errs, so survival time is unbounded
      // and would swamp every other term. The clear bonus above measures the opposite
      // thing — how fast the run was FINISHED — and only for runs that were.
      //
      // Instead the challenge SHAPE carries the difficulty, exactly as Match Speed's
      // alternation rule does (docs/HYDRA_BUBBLES.md § 7.5): challenge words ride the
      // BLOOM slot (yellow was removed in the 2026-08-21 two-colour rework), the run
      // ends the moment the LAST of them is cleared, and a wrong match ends it early
      // with the unmatched words scoring zero. That makes CLEARING THE SET the goal —
      // a player who cleared 8 of 9 outranks one who cleared 3, which speed alone
      // could not express — and with filler at 0 the round's score IS the contested
      // ledger: a hard ceiling of CHALLENGE_WORD_COUNT × contestedHit, in steps of 100.
      //
      // ⚠️ THE BONUS CANNOT INVERT THE WORD RANKING, and this is worth checking rather
      // than assuming. A complete run scores 900 + bonus ≥ 900. The best possible
      // PARTIAL run is eight contested clears and the miss that ended it: 800 − 100 =
      // 700. So every complete run outranks every partial one no matter how the pot is
      // tuned, and the pot's size is purely a statement about how much speed should
      // separate two players who both cleared the set. 300 against 900 puts it in the
      // same register as Bubble Match's 500 against 900 (O2, resolved 2026-09-02).
    },
  },
  {
    gameId: 'word-search',
    mode: 'pinyin',
    title: 'Word Search (Pinyin)',
    // Eligible as Pinyin ONLY. The No-Pinyin mode is a reading game, so a bare
    // gameId here would let a challenge draw the ineligible mode.
    markType: 'production',
    languages: ['zh'],
    scoring: {
      contestedHit: 100,
      // No mistake penalty: a Word Search selection either spells a word or it does
      // not, so there is no "mismatch" event to charge for the way the two matching
      // games have. Time is the penalty here instead.
      contestedMiss: 0,
      fillerHit: 20,
      fillerMiss: 0,
      missChargedOncePerWord: false,
      bonuses: [
        {
          ruleId: 'timePenalty',
          label: 'time penalty',
          kind: 'elapsedPenalty',
          points: -10,
          decayIntervalMs: 1000,
          // Free until 1:00 of ACCUMULATED ACTIVE time — so reading a pre-round
          // provisional notice, or backgrounding the app, costs nothing.
          graceMs: 60_000,
        },
        {
          ruleId: 'hintUsed',
          label: 'hints used',
          kind: 'perUse',
          points: -20,
        },
      ],
    },
  },
] as const;

/**
 * The eligible pool for one language pair, in the order it is drawn from.
 *
 * Cross-language challenges (different-word only, § 8) can draw only games
 * playable in BOTH languages, which is why this takes two languages rather than
 * one. A zh-vs-es challenge therefore has two eligible games today and plays two
 * rounds — the format bends rather than blocking (§ 8.3).
 */
export function challengeGamesForLanguages(
  languageA: Language,
  languageB: Language
): ChallengeGameSpec[] {
  return CHALLENGE_GAMES.filter((game) =>
    !game.languages
      || (game.languages.includes(languageA) && game.languages.includes(languageB))
  );
}
