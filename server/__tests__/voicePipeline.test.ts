/**
 * Pure pieces of the voice tutor pipeline (docs/VOICE_ASSISTANT.md § 4–7):
 * endpointing, sentence chunking + markdown stripping, note_recast validation, the prompt's
 * per-turn annotation, speaking rate, and MP3 duration.
 */
import { describe, it, expect } from 'vitest';
import { Endpointer, partialSuggestsHold, pcm16Rms, FRAME_MS } from '../services/voice/endpointer.js';
import { SentenceChunker, stripForSpeech } from '../services/voice/sentenceChunker.js';
import { parseRecastInput } from '../services/voice/voiceTools.js';
import { buildTurnAnnotation, buildUserTurnContent, buildProfileBlock, speakingRateForLevel } from '../services/voice/voicePrompt.js';
import { mp3DurationSeconds } from '../services/voice/VoiceTTS.js';
import { ENDPOINT_HOLD_MS, ENDPOINT_SILENCE_MS, SPEECH_START_MS } from '../services/voice/voiceConfig.js';

/** A 20 ms PCM16 frame of a constant amplitude (0 = silence). */
function frame(amplitude: number): Buffer {
  const b = Buffer.alloc(640);
  for (let i = 0; i < 320; i++) b.writeInt16LE(i % 2 ? amplitude : -amplitude, i * 2);
  return b;
}

function feed(ep: Endpointer, amplitude: number, ms: number) {
  const events = [];
  for (let t = 0; t < ms; t += FRAME_MS) {
    const ev = ep.push(frame(amplitude));
    if (ev) events.push(ev);
  }
  return events;
}

describe('pcm16Rms', () => {
  it('is 0 for silence and the amplitude for a square wave', () => {
    expect(pcm16Rms(frame(0))).toBe(0);
    expect(pcm16Rms(frame(1000))).toBeCloseTo(1000);
  });
});

describe('Endpointer', () => {
  it('opens after SPEECH_START_MS of voice and hands back the pre-roll', () => {
    const ep = new Endpointer();
    feed(ep, 0, 400);
    const events = feed(ep, 3000, SPEECH_START_MS);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('speechStart');
    expect((events[0] as any).preRoll.length).toBeGreaterThan(SPEECH_START_MS / FRAME_MS);
    expect(ep.speaking).toBe(true);
  });

  it('ignores a click shorter than SPEECH_START_MS', () => {
    const ep = new Endpointer();
    expect(feed(ep, 3000, SPEECH_START_MS - FRAME_MS)).toHaveLength(0);
    expect(feed(ep, 0, 200)).toHaveLength(0);
    expect(ep.speaking).toBe(false);
  });

  it('ends after ENDPOINT_SILENCE_MS of silence, not before', () => {
    const ep = new Endpointer();
    feed(ep, 3000, 600);
    expect(feed(ep, 0, ENDPOINT_SILENCE_MS - FRAME_MS)).toHaveLength(0);
    const end = feed(ep, 0, FRAME_MS);
    expect(end[0]).toMatchObject({ type: 'speechEnd', reason: 'silence' });
    expect((end[0] as any).speechMs).toBeGreaterThanOrEqual(600);
  });

  it('holds longer when the partial ends in a filler', () => {
    const ep = new Endpointer();
    feed(ep, 3000, 600);
    ep.setPartial('我昨天去了那个');
    expect(feed(ep, 0, ENDPOINT_SILENCE_MS + ENDPOINT_HOLD_MS - FRAME_MS)).toHaveLength(0);
    expect(feed(ep, 0, FRAME_MS)[0]).toMatchObject({ type: 'speechEnd' });
  });

  it('forceStart opens immediately (barge-in)', () => {
    const ep = new Endpointer();
    expect(ep.forceStart()).toMatchObject({ type: 'speechStart' });
    expect(ep.speaking).toBe(true);
    expect(ep.forceStart()).toBeNull();
  });
});

describe('partialSuggestsHold', () => {
  it.each([
    ['我昨天去了那个', true],
    ['就是…', true],
    ['我我', true],
    ['那个那个', true],
    ['I went to the the', true],
    ['I went um', true],
    ['我昨天去了超市。', false],
    ['好的', false],
    ['是啊', false],
    ['', false],
  ])('%s → %s', (partial, expected) => {
    expect(partialSuggestsHold(partial)).toBe(expected);
  });
});

describe('SentenceChunker', () => {
  it('emits on Chinese and English sentence ends', () => {
    const c = new SentenceChunker();
    expect(c.push('你好！今天')).toEqual(['你好！']);
    expect(c.push('想聊什么？Great.')).toEqual(['今天想聊什么？', 'Great.']);
    expect(c.flush()).toEqual([]);
  });

  it('breaks a long run at a soft break', () => {
    const c = new SentenceChunker();
    const out = c.push('我昨天去了一家很大的超市，买了很多新鲜的蔬菜和水果，还有一些我很喜欢吃的东西和一瓶果汁');
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0].endsWith('，')).toBe(true);
  });

  it('does not emit lone punctuation and flushes the tail', () => {
    const c = new SentenceChunker();
    expect(c.push('。')).toEqual([]);
    c.push('最后一句');
    expect(c.flush()).toEqual(['最后一句']);
  });

  it('does not split on a decimal point', () => {
    const c = new SentenceChunker();
    expect(c.push('3.5块')).toEqual([]);
  });
});

describe('stripForSpeech', () => {
  it('removes markdown, list markers and emoji', () => {
    expect(stripForSpeech('**超市** is *good* 😀')).toBe('超市 is good');
    expect(stripForSpeech('- 第一\n1. 第二')).toBe('第一\n第二');
  });
});

describe('parseRecastInput', () => {
  it('accepts a valid input and keeps only new words found in the better line', () => {
    expect(parseRecastInput({ learnerSaid: '我去了 grocery store', better: '我去了超市', newWords: ['超市', '蔬菜', '超市'] }))
      .toEqual({ learnerSaid: '我去了 grocery store', better: '我去了超市', newWords: ['超市'] });
  });
  it('rejects missing or mistyped fields', () => {
    expect(parseRecastInput(null)).toBeNull();
    expect(parseRecastInput({ learnerSaid: 'x', better: '' , newWords: [] })).toBeNull();
    expect(parseRecastInput({ learnerSaid: 'x', better: 'y', newWords: 'z' })).toBeNull();
  });
  it('caps new words at two', () => {
    const r = parseRecastInput({ learnerSaid: 'a', better: '超市蔬菜水果', newWords: ['超市', '蔬菜', '水果'] });
    expect(r?.newWords).toEqual(['超市', '蔬菜']);
  });
});

describe('voice prompt builders', () => {
  it('annotation is sorted and deterministic', () => {
    expect(buildTurnAnnotation({ 菜: 'known', 超市: 'learning' }, ['蔬菜'])).toBe('[cards: 菜=known, 超市=learning; lowConfidence: 蔬菜]');
    expect(buildTurnAnnotation({}, [])).toBe('');
  });
  it('marks uncertain words with [?]', () => {
    expect(buildUserTurnContent('我买了蔬菜', {}, ['蔬菜'])).toBe('我买了蔬菜[?]\n[lowConfidence: 蔬菜]');
  });
  it('profile block is stable for the same input', () => {
    const p = { level: 2, bandCounts: { unfamiliar: 1, target: 2, comfortable: 3, mastered: 4 }, knownWords: ['你好', '谢谢'] };
    expect(buildProfileBlock(p)).toBe(buildProfileBlock({ ...p }));
    expect(buildProfileBlock(p)).toContain('你好、谢谢');
  });
  it('speaking rate rises with level', () => {
    expect(speakingRateForLevel(1)).toBe(0.8);
    expect(speakingRateForLevel(6)).toBe(1);
  });
});

describe('mp3DurationSeconds', () => {
  it('reads a 32 kbps MPEG-2 Layer III header (Chirp3-HD output)', () => {
    const header = Buffer.from([0xff, 0xf3, 0x44, 0xc4]);
    const clip = Buffer.concat([header, Buffer.alloc(4000 - 4)]);
    expect(mp3DurationSeconds(clip)).toBeCloseTo(1.0, 5);
  });
});
