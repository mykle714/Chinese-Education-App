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

/** Display names for the language picker. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  zh: 'Chinese (Mandarin)',
  es: 'Spanish',
};

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
  }
>;

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
 * 'frequencyScore'   = the 1–5 everyday-conversation score ("Commonality") of the
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
 *   recognition — flp foreign-first review + Bubble Match
 *   production  — flp English-first review + Word Search "Pinyin" mode
 *   reading     — Word Search "No Pinyin" mode
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
 * A mark belongs to exactly ONE bar (see `barForMarkType`), so a single review
 * can never move two bars at once.
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
 * The BAND collections: one per unmastered utcm band of the CORE bar, plus `all`.
 *
 * These are the fdp's top deck row. `Mastered` deliberately has no band collection —
 * that band is already three collections (one per bar, above), and a fourth id
 * meaning "core-mastered" would be a second name for `mastered`.
 *
 * Lowercased ids rather than the band's own capitalisation, so a URL segment matches
 * the rest of the route vocabulary (`learn-now`, `mastered-reading`).
 */
export const BAND_COLLECTION_IDS = {
  Unfamiliar: 'unfamiliar',
  Target: 'target',
  Comfortable: 'comfortable',
} as const;

export type BandCollectionCategory = keyof typeof BAND_COLLECTION_IDS;

export const BAND_COLLECTION_CATEGORIES: readonly BandCollectionCategory[] = [
  'Unfamiliar',
  'Target',
  'Comfortable',
] as const;

/** Every sorted card the learner holds, mastered or not. */
export const ALL_COLLECTION_ID = 'all';

/**
 * Which core band a `?collection=` value names, or null if it names none.
 * Null must always mean "unrestricted" at the call sites — an unrecognized collection
 * name may never silently narrow a round to some other set.
 */
export function bandCollectionCategory(
  raw: string | null | undefined
): BandCollectionCategory | null {
  if (!raw) return null;
  for (const category of BAND_COLLECTION_CATEGORIES) {
    if (BAND_COLLECTION_IDS[category] === raw) return category;
  }
  return null;
}

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
 * Word Search is 10 rather than 20 because its grid holds ten words; it additionally
 * needs those words to have mutually distinct characters, which a flat count cannot
 * express — see PROVISION_RETRY_FACTOR.
 */
export const CARD_BASELINES: Record<CardBaselineSurface, number> = {
  'bubble-match': 20,
  'match-speed': 20,
  'speed-reading': 20,
  'word-search': 10,
  flp: 20,
};

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
 *   grey #D8D8DC · beige #F5EBE0 · white #FFFFFF · black #000000 · red #F2BAC9 ·
 *   green #BAF2D8 · blue #BAD7F2 · yellow #F2E2BA · purple #D8BAF2
 */
export const CARD_COLOR_VALUES: readonly string[] = [
  '#D8D8DC',
  '#F5EBE0',
  '#FFFFFF',
  '#000000',
  '#F2BAC9',
  '#BAF2D8',
  '#BAD7F2',
  '#F2E2BA',
  '#D8BAF2',
];

/** A related library word surfaced on the card detail page. */
export interface RelatedWord {
  id: number;
  entryKey: string;
  pronunciation: string | null;
  definition: string | null;
}

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

  /** 1 = almost never spoken … 5 = constant in daily speech (from the det row). */
  frequencyScore?: number | null;
  /** Orthogonal sense clusters, joined from det via DICT_JOIN. */
  definitionClusters?: DefinitionCluster[] | null;
  /** Per-card chosen cluster `sense` label (vet column, migration 99). NULL = default. */
  selectedSense?: string | null;

  /** Per-type mark streams (migration 101); see docs/MASTERY_REWORK.md. */
  typedMarkHistory?: TypedMarkHistory;
  /** Total cumulative count of all marks. */
  totalMarkCount?: number;
  /** Lifetime count of correct marks. */
  totalCorrectCount?: number;
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
   * elapsed. The client shows the matching face; both present ⇒ random. Absent on
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
   * Everyday-conversation frequency for the whole entry (1 = almost never spoken …
   * 5 = constant in daily speech), read straight from the det `frequencyScore` column.
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
