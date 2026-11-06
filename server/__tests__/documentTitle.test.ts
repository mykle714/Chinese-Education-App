import { describe, it, expect } from 'vitest';
import { deriveDocumentTitle, documentTitleSource, UNTITLED_DOCUMENT_TITLE } from '../utils/documentTitle.js';
import { segmentWithDict } from '../dal/shared/segmentString.js';

// A tiny det stand-in: the gsa prefers these multi-char words over single chars.
const dict = new Map(
  ['图书馆', '我们', '今天', '去', '学习', '中文', '你好', '世界', '非常', '喜欢'].map((w) => [w, { frequencyScore: 5 }])
);
const segment = (run: string) => segmentWithDict(run, dict as never, new Set());

describe('deriveDocumentTitle', () => {
  it('returns Untitled for empty or whitespace-only content', () => {
    expect(deriveDocumentTitle('', segment)).toBe(UNTITLED_DOCUMENT_TITLE);
    expect(deriveDocumentTitle('  \n\t\n ', segment)).toBe(UNTITLED_DOCUMENT_TITLE);
  });

  it('keeps short content whole', () => {
    expect(deriveDocumentTitle('你好，世界！', segment)).toBe('你好，世界！');
  });

  it('uses only the first non-empty line', () => {
    expect(deriveDocumentTitle('\n\n  第一行  \n第二行', segment)).toBe('第一行');
  });

  it('never cuts a Chinese word at the 20-char budget', () => {
    // 18 chars of filler then 图书馆 (would straddle 18..21) → dropped whole.
    const filler = '我们今天去学习中文我们今天去学习中文'; // 18 chars
    expect([...filler].length).toBe(18);
    expect(deriveDocumentTitle(filler + '图书馆很大', segment)).toBe(filler);
  });

  it('never cuts a space-delimited word', () => {
    expect(deriveDocumentTitle('The quick brown fox jumps over', segment)).toBe('The quick brown fox');
  });

  it('hard-cuts when the first word alone exceeds the budget', () => {
    expect(deriveDocumentTitle('Supercalifragilisticexpialidocious', segment)).toBe('Supercalifragilistic');
  });

  it('handles mixed scripts', () => {
    expect(deriveDocumentTitle('HSK 我非常喜欢图书馆 and more words', segment)).toBe('HSK 我非常喜欢图书馆 and');
  });
});

describe('documentTitleSource', () => {
  it('collapses inner whitespace', () => {
    expect(documentTitleSource('  a   b\tc ')).toBe('a b c');
  });
});
