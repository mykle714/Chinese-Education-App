import { resolveDisplayDefinition, resolveDisplayPronunciation } from "../../utils/definitionUtils";
import { buildSentencePronunciation } from "../../utils/sentencePronunciation";
import type { Round } from "./types";

/**
 * Everything the prompt shows and says for one round — the CLUE, in other words.
 * The glyphs are the answer, so nothing here may contain them.
 */
export interface RoundPrompt {
    /** Big line: the pinyin the player has to map onto one of the two options. */
    pinyin: string;
    /** Small line: what it means. */
    english: string;
    /** What the speaker button (and the auto-narration) says. */
    speechText: string;
    /** Pinyin hint handed to cloud TTS; undefined ⇒ let the provider infer it. */
    speechPinyin?: string;
}

/**
 * Derive the prompt from the round. One function rather than two components
 * because the two round kinds differ ONLY in where the three strings come from —
 * the prompt's layout, clamping and speaker are identical.
 *
 * ── Word round ──────────────────────────────────────────────────────────────
 * The headword's pinyin and its displayed definition. Both MUST resolve through
 * `resolveDisplay*`: the game pool ships `definitionClusters` + `selectedSense`,
 * and reading `entry.definition`/`entry.pronunciation` raw would show a different
 * sense than the card the player has been studying (docs/GAMES_FEATURE.md §
 * Sense correctness).
 *
 * ── Sentence round ──────────────────────────────────────────────────────────
 * The SENTENCE's pinyin (per-segment, space separated) and the SENTENCE's English
 * translation, and the narration is the sentence rather than the bare word. The
 * clue therefore covers the whole line the player is about to read, including the
 * syllable that separates the two options.
 *
 * `buildSentencePronunciation` returns undefined when the sentence's segmentation
 * or any segment's pinyin is missing; the displayed line then falls back to the
 * empty string (the translation still carries the round) and TTS is left to infer
 * the reading.
 *
 * Referenced by: SpeedReadingPage (render + narration), SpeedReadingPrompt.
 * Documented in: docs/SPEED_READING_GAME.md § The prompt.
 */
export function roundPrompt(round: Round): RoundPrompt {
    if (round.kind === "sentence") {
        const pinyin = buildSentencePronunciation(round.sentence);
        return {
            pinyin: pinyin ?? "",
            english: round.sentence.english ?? "",
            speechText: round.sentence.foreignText,
            speechPinyin: pinyin,
        };
    }
    return {
        pinyin: resolveDisplayPronunciation(round.entry) ?? "",
        english: resolveDisplayDefinition(round.entry),
        speechText: round.entry.entryKey,
        speechPinyin: round.entry.pronunciation ?? undefined,
    };
}
