/**
 * `buildPinyinSsml` — the SSML <phoneme> hint sent to Google TTS for Mandarin.
 * Docs: docs/AUDIO_PLAYBACK.md § 3 (the pinyin hint), docs/EXAMPLE_SENTENCES.md.
 */
import { describe, expect, it } from 'vitest';
import { buildPinyinSsml, hasErhuaSyllable } from '../services/TTSService.js';

const ph = (p: string, t: string) => `<phoneme alphabet="pinyin" ph="${p}">${t}</phoneme>`;

describe('buildPinyinSsml', () => {
  it('tags one phoneme per Han character', () => {
    expect(buildPinyinSsml('你好', 'nǐ hǎo')).toBe(`<speak>${ph('ni3', '你')}${ph('hao3', '好')}</speak>`);
  });

  it('passes punctuation through as text', () => {
    expect(buildPinyinSsml('好。', 'hǎo')).toBe(`<speak>${ph('hao3', '好')}。</speak>`);
  });

  it('bails on a syllable/character count mismatch', () => {
    expect(buildPinyinSsml('一会儿', 'yī huìr')).toBeNull();
  });

  describe('erhua fusion', () => {
    it('fuses a bare r into the previous syllable (一会儿 → hui4r)', () => {
      expect(buildPinyinSsml('一会儿', 'yī huì r'))
        .toBe(`<speak>${ph('yi1', '一')}${ph('hui4r', '会儿')}</speak>`);
    });

    it('fuses two-character erhua words', () => {
      expect(buildPinyinSsml('哪儿', 'nǎ r')).toBe(`<speak>${ph('na3r', '哪儿')}</speak>`);
    });

    it('fuses erhua mid-sentence and keeps later alignment', () => {
      expect(buildPinyinSsml('这儿好', 'zhè r hǎo'))
        .toBe(`<speak>${ph('zhe4r', '这儿')}${ph('hao3', '好')}</speak>`);
    });

    it('leaves a full-syllable 儿 alone (儿子 ér zi)', () => {
      expect(buildPinyinSsml('儿子', 'ér zi')).toBe(`<speak>${ph('er2', '儿')}${ph('zi5', '子')}</speak>`);
    });

    it('does not fuse across punctuation', () => {
      expect(buildPinyinSsml('好，儿', 'hǎo r'))
        .toBe(`<speak>${ph('hao3', '好')}，${ph('r5', '儿')}</speak>`);
    });
  });
});

describe('hasErhuaSyllable', () => {
  it('detects a bare r syllable', () => {
    expect(hasErhuaSyllable('yī huì r')).toBe(true);
    expect(hasErhuaSyllable('ér zi')).toBe(false);
    expect(hasErhuaSyllable('')).toBe(false);
  });
});
