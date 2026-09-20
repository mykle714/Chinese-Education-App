/**
 * addressee.test.ts — who the engine decides one utterance was aimed at (§ 4.2).
 *
 * The rules are a LADDER, so most of what is worth testing is precedence: which signal beats
 * which. Each rule is also tested in isolation, because a ladder that happens to agree with
 * itself proves nothing about the rung that fired.
 */

import { describe, it, expect } from 'vitest';
import { chooseAddressee, type AddresseeCandidate } from '../addressee';

const wang: AddresseeCandidate = { id: 'wang_shen', label: '王婶', distance: 1 };
const he: AddresseeCandidate = { id: 'he_laoshi', label: '何老师', distance: 6 };
const zhou: AddresseeCandidate = { id: 'lao_zhou', label: '老周', distance: 9 };
const CAST = [wang, he, zhou];

const zh = (over: Partial<{ focusedId: string | null; lastSpeakerId: string | null }> = {}) =>
  ({ focusedId: null, lastSpeakerId: null, language: 'zh' as const, ...over });

describe('chooseAddressee — degenerate cases', () => {
  it('returns null when there is nobody to address', () => {
    expect(chooseAddressee('你好', [], zh())).toBeNull();
  });

  it('does not deliberate over a cast of one', () => {
    const choice = chooseAddressee('你好', [he], zh({ focusedId: 'nobody' }));
    expect(choice?.id).toBe('he_laoshi');
  });
});

describe('chooseAddressee — rule 1, named', () => {
  it('routes on a full name anywhere in the utterance', () => {
    const choice = chooseAddressee('老周，你好', CAST, zh());
    expect(choice).toMatchObject({ id: 'lao_zhou', reason: 'named' });
  });

  it('routes on a bare title, because a beginner reaches for 老师 before a surname', () => {
    const choice = chooseAddressee('老师，这个字怎么念？', CAST, zh());
    expect(choice).toMatchObject({ id: 'he_laoshi', reason: 'named' });
  });

  it('routes on a name with the familiarity prefix dropped', () => {
    // 老周 → 周. The learner who writes 周，你好 means the man, not a week.
    const choice = chooseAddressee('周，你好', CAST, zh());
    expect(choice).toMatchObject({ id: 'lao_zhou', reason: 'named' });
  });

  it('BEATS the tapped body — a vocative is the only way to call across a room', () => {
    const choice = chooseAddressee('老师！', CAST, zh({ focusedId: 'wang_shen' }));
    expect(choice).toMatchObject({ id: 'he_laoshi', reason: 'named' });
  });

  it('prefers the more specific name when both appear at the same position', () => {
    const choice = chooseAddressee('何老师，你好', CAST, zh());
    expect(choice?.id).toBe('he_laoshi');
    expect(choice?.detail).toContain('何老师');
  });

  it('prefers the earliest mention when two different people are named', () => {
    expect(chooseAddressee('老周，王婶来了', CAST, zh())?.id).toBe('lao_zhou');
    expect(chooseAddressee('王婶，老周来了', CAST, zh())?.id).toBe('wang_shen');
  });

  /**
   * The rule that stops the title heuristic doing harm. With two teachers on stage, 老师 is a
   * word rather than a name, so it must not route at all — falling through to the tapped body
   * at least matches something the learner can see themselves having chosen.
   */
  it('ignores a title two cast members both answer to', () => {
    const other = { id: 'ma_shifu', label: '马老师', distance: 3 };
    const choice = chooseAddressee('老师，你好', [wang, he, other], zh({ focusedId: 'wang_shen' }));
    expect(choice).toMatchObject({ id: 'wang_shen', reason: 'focused' });
  });
});

describe('chooseAddressee — rules 2 to 5', () => {
  it('routes to the tapped body over the nearest one', () => {
    const choice = chooseAddressee('你好', CAST, zh({ focusedId: 'lao_zhou' }));
    expect(choice).toMatchObject({ id: 'lao_zhou', reason: 'focused' });
  });

  it('routes to the tapped body over whoever spoke last', () => {
    const choice = chooseAddressee('你好', CAST, zh({ focusedId: 'lao_zhou', lastSpeakerId: 'he_laoshi' }));
    expect(choice).toMatchObject({ id: 'lao_zhou', reason: 'focused' });
  });

  it('answers whoever spoke last when nobody has been tapped', () => {
    const choice = chooseAddressee('你好', CAST, zh({ lastSpeakerId: 'he_laoshi' }));
    expect(choice).toMatchObject({ id: 'he_laoshi', reason: 'replying' });
  });

  it('falls back to the nearest body, which is the head of the list', () => {
    const choice = chooseAddressee('你好', CAST, zh());
    expect(choice).toMatchObject({ id: 'wang_shen', reason: 'nearest' });
  });

  it('ignores a focus or a last speaker who has left the scene', () => {
    const choice = chooseAddressee('你好', CAST, zh({ focusedId: 'gone', lastSpeakerId: 'also_gone' }));
    expect(choice).toMatchObject({ id: 'wang_shen', reason: 'nearest' });
  });

  // Rung 4. The point of the rung is that it can DISAGREE with distance — a learner standing
  // between two people and turned toward the further one means the further one.
  it('prefers the body the learner is turned toward over a nearer one', () => {
    const choice = chooseAddressee('你好', [wang, { ...he, facedByLearner: true }, zhou], zh());
    expect(choice).toMatchObject({ id: 'he_laoshi', reason: 'facing' });
  });

  it('takes the nearest of several bodies the learner is turned toward', () => {
    const cast = [{ ...wang, facedByLearner: true }, { ...he, facedByLearner: true }, zhou];
    expect(chooseAddressee('你好', cast, zh())).toMatchObject({ id: 'wang_shen', reason: 'facing' });
  });

  it('lets a tap beat a facing, because a tap is the more deliberate act', () => {
    const cast = [wang, { ...he, facedByLearner: true }, zhou];
    const choice = chooseAddressee('你好', cast, zh({ focusedId: 'lao_zhou' }));
    expect(choice).toMatchObject({ id: 'lao_zhou', reason: 'focused' });
  });

  it('lets a name beat a facing — a vocative is the only way to call across a room', () => {
    const cast = [{ ...wang, facedByLearner: true }, he, zhou];
    expect(chooseAddressee('何老师！', cast, zh())).toMatchObject({ id: 'he_laoshi', reason: 'named' });
  });
});

describe('chooseAddressee — Spanish', () => {
  const cast: AddresseeCandidate[] = [
    { id: 'ana', label: 'Ana', distance: 2 },
    { id: 'marco', label: 'Marco', distance: 4 },
  ];
  const es = { focusedId: null, lastSpeakerId: null, language: 'es' as const };

  it('matches a name case-insensitively', () => {
    expect(chooseAddressee('hola marco, ¿qué tal?', cast, es)?.id).toBe('marco');
  });

  /** The title/prefix heuristics are zh-only; an es name matches as written or not at all. */
  it('does not invent Spanish nicknames', () => {
    expect(chooseAddressee('hola', cast, es)).toMatchObject({ id: 'ana', reason: 'nearest' });
  });
});

/**
 * The reason is not decoration — it is what makes "why did SHE answer?" answerable, which is
 * the argument for a rule ladder over a router model in the first place.
 */
describe('chooseAddressee — every choice explains itself', () => {
  it('carries a printable detail on all five rungs', () => {
    const cases = [
      chooseAddressee('老师！', CAST, zh()),
      chooseAddressee('你好', CAST, zh({ focusedId: 'he_laoshi' })),
      chooseAddressee('你好', CAST, zh({ lastSpeakerId: 'he_laoshi' })),
      chooseAddressee('你好', [wang, { ...he, facedByLearner: true }, zhou], zh()),
      chooseAddressee('你好', CAST, zh()),
    ];
    expect(cases.map(c => c?.reason)).toEqual(['named', 'focused', 'replying', 'facing', 'nearest']);
    for (const c of cases) expect(c?.detail).toBeTruthy();
  });
});
