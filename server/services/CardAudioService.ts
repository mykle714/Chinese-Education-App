import type { IDictionaryDAL } from '../dal/interfaces/IDictionaryDAL.js';
import type { DefinitionCluster } from '../types/index.js';
import { resolveDisplayPronunciation } from '../utils/definitions.js';
import type { SynthesisResult, TTSService, TTSVoiceKey } from './TTSService.js';

/**
 * Card audio — the app-level layer over `TTSService`.
 *
 * `TTSService` only knows the provider and the disk cache: text in, MP3 out. This service
 * adds the two things that involve the APP's data:
 *
 *   1. **Pre-warm** (`prewarm`): synthesize a batch of cards' audio before an endpoint
 *      responds, so the client's later `/api/tts/synthesize` for each word is a disk-cache
 *      hit. Used by the flp working loop, the game boards, and acp pack refills.
 *   2. **The `ttsVoice` stamp** (`recordAudioVoice`): mark a det row as having cached audio.
 *      ONE policy for every caller, where there used to be two hand-written UPDATEs with
 *      different rules (the controller overwrote, the pre-warm only filled NULLs).
 *
 * Layering: service. Writes go through `IDictionaryDAL.stampTtsVoice`; no SQL here.
 *
 * Referenced by: docs/AUDIO_PLAYBACK.md § 4 ("acp pack audio is fetched ahead") and § 6
 * (default-voice-only pre-warm and stamp).
 */
export class CardAudioService {
  constructor(
    private ttsService: TTSService,
    private dictionaryDAL: IDictionaryDAL
  ) {}

  /**
   * Serve one `/api/tts/synthesize` request: synthesize (disk-cache aware) and, on a cache
   * MISS, stamp the det row. A cache hit skips the stamp: the column was written when the
   * clip was first synthesized, and skipping it keeps the hot audio path free of writes.
   *
   * `stamp: false` is for text that is not a headword (a sentence), where the UPDATE could
   * only ever match zero rows — see TTSRequest.stamp on the client.
   */
  async synthesizeForRequest(
    text: string,
    language: string,
    pronunciation: string | null,
    voiceKey: TTSVoiceKey,
    stamp: boolean
  ): Promise<SynthesisResult> {
    const ttsLang = toTtsLang(language);
    const result = await this.ttsService.synthesize(text, ttsLang, pronunciation, voiceKey);
    if (stamp && !result.cacheHit) {
      await this.recordAudioVoice(text, language, voiceKey, result.voice);
    }
    return result;
  }

  /**
   * Ensures each entry's audio is on disk, in parallel, stamping `hasAudio` on each entry
   * (false when its synthesis failed — the client then skips its prefetch). A cache hit
   * is one `fs.access` and no DB write (`TTSService.ensureCached`); only a fresh synthesis
   * stamps det `ttsVoice`.
   *
   * Synthesizes the DEFAULT voice only: the learner's voice choice is per-device
   * (localStorage), so the server cannot know it (docs/AUDIO_PLAYBACK.md § 6).
   *
   * Never throws for a single entry — a failed synth costs that card latency, nothing more.
   */
  async prewarm<T extends {
    entryKey: string; language?: string; pronunciation?: string | null; hasAudio?: boolean;
    definitionClusters?: DefinitionCluster[] | null; selectedSense?: string | null;
  }>(entries: T[]): Promise<T[]> {
    await Promise.all(entries.map(async entry => {
      const language = entry.language || 'zh';
      try {
        // Pinyin resolved through the same sense-aware rule the client's useTTS applies
        // before it requests audio, so the pre-warmed cache key (text + pinyin) is the one
        // the client actually hits — and a heteronym is voiced as its chosen/default sense,
        // not as the raw column's reading. buildPinyinSsml inside TTSService falls back to
        // plain text if the pinyin doesn't align.
        const result = await this.ttsService.ensureCached(
          entry.entryKey, toTtsLang(language), resolveDisplayPronunciation(entry)
        );
        entry.hasAudio = true;
        if (!result.cacheHit) await this.recordAudioVoice(entry.entryKey, language, 'default', result.voice);
      } catch (err) {
        console.warn(`[CardAudioService.prewarm] synthesis failed for "${entry.entryKey}":`, err);
        entry.hasAudio = false;
      }
    }));
    return entries;
  }

  /**
   * The one `ttsVoice` stamp policy, called only after a FRESH synthesis (a cache miss) —
   * whose voice is authoritative, so it overwrites (e.g. after `GOOGLE_TTS_VOICE_*`
   * changes). Cache hits never write: nothing in the app reads the column today, so
   * re-filling it on every hit was a pool client and an UPDATE per card for nothing.
   * Best-effort: a failed write is logged, never thrown, because the audio itself was
   * produced and the column is only a hint.
   *
   * ⛔ **Default voice only.** The stamp records the RESOLVED voice name into shared
   * dictionary data, so one learner who picked the male voice in /settings would otherwise
   * rewrite the column for everybody, and `ttsVoice` would stop meaning "this row has audio
   * in the voice the app reads with".
   */
  private async recordAudioVoice(
    word: string,
    language: string,
    voiceKey: TTSVoiceKey,
    resolvedVoice: string
  ): Promise<void> {
    if (!this.ttsService.isDefaultVoice(toTtsLang(language), voiceKey)) return;
    try {
      await this.dictionaryDAL.stampTtsVoice(word, language, resolvedVoice);
    } catch (err) {
      console.warn(`[CardAudioService] failed to stamp ttsVoice for "${word}":`, err);
    }
  }
}

/** Short language code → the BCP-47 tag TTSService expects. Expand as new langs get TTS. */
function toTtsLang(language: string): string {
  return language === 'zh' ? 'zh-CN' : language;
}
