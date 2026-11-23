/**
 * Turns Claude's streamed text deltas into speakable sentences (docs/VOICE_ASSISTANT.md § 4.4).
 *
 *   - Buffers deltas until a sentence boundary (`。！？.!?` and their full-width forms, or a
 *     newline), or until SENTENCE_MAX_CHARS characters have piled up with no boundary — then
 *     it breaks at the last comma/space so a long sentence still starts playing early.
 *   - Each emitted sentence is stripped of markdown (`stripForSpeech`): the system prompt
 *     forbids markdown, this is the belt to that braces (§ 6.2).
 *
 * Sentence N+1 is synthesized while N plays, which is what keeps time-to-first-audio low;
 * the chunker's job is only to hand sentences over as early as is safe.
 *
 * Layer: service (pure). Tested by server/__tests__/voiceSentenceChunker.test.ts.
 */
import { SENTENCE_MAX_CHARS } from './voiceConfig.js';

const BOUNDARY = /[。！？!?\n]|\.(?=\s|$)/u;
const SOFT_BREAK = /[，,、；;：:\s]/u;

/** Remove markdown and other things that should never be read aloud. */
export function stripForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export class SentenceChunker {
  private buffer = '';

  /** Add a text delta; returns every sentence it completed (possibly none). */
  push(delta: string): string[] {
    this.buffer += delta;
    const out: string[] = [];
    for (;;) {
      const match = BOUNDARY.exec(this.buffer);
      if (match) {
        const end = match.index + match[0].length;
        this.emit(this.buffer.slice(0, end), out);
        this.buffer = this.buffer.slice(end);
        continue;
      }
      if ([...this.buffer].length > SENTENCE_MAX_CHARS) {
        // No boundary yet but the buffer is long: break at the last soft break, if any.
        const chars = [...this.buffer];
        let cut = -1;
        for (let i = chars.length - 1; i >= Math.floor(SENTENCE_MAX_CHARS / 2); i--) {
          if (SOFT_BREAK.test(chars[i])) { cut = i + 1; break; }
        }
        if (cut === -1) cut = SENTENCE_MAX_CHARS;
        this.emit(chars.slice(0, cut).join(''), out);
        this.buffer = chars.slice(cut).join('');
        continue;
      }
      break;
    }
    return out;
  }

  /** The stream ended: return whatever is left as a final sentence. */
  flush(): string[] {
    const out: string[] = [];
    this.emit(this.buffer, out);
    this.buffer = '';
    return out;
  }

  private emit(raw: string, out: string[]): void {
    const clean = stripForSpeech(raw);
    // Skip fragments with nothing speakable (lone punctuation, whitespace).
    if (/[\p{L}\p{N}]/u.test(clean)) out.push(clean);
  }
}
