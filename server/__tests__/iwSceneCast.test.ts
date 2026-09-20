import { describe, expect, it } from 'vitest';
import { resolveCastMember } from '../services/iw/sceneCast.js';
import { COMPANION_NPC_ID_BY_LANGUAGE, npcsForLanguage } from '../config/iwNpcs.js';
import type { IWScene } from '../contracts/iw.js';

/**
 * resolveCastMember — "is this NPC in this scene?", the question `takeNpcTurn` gates on.
 *
 * The case worth a suite of its own is the companion, who is in every scene while being cast
 * in none: `sceneValidation` REFUSES a stored cast row for him, so the row a turn needs has to
 * be derived from the scene's own `companionStart*` fields. Reading `npcCast` directly is what
 * made him unanswerable (2026-09-07), and it is the kind of bug that reappears the moment
 * somebody writes the obvious `.find()` again.
 */

const COMPANION = COMPANION_NPC_ID_BY_LANGUAGE.zh!;
/** A cast NPC who is not the companion, so the two paths are genuinely distinguished. */
const CAST_NPC = npcsForLanguage('zh').find(n => n.id !== COMPANION)!.id;

const scene = (over: Partial<IWScene> = {}): IWScene => ({
  language: 'zh',
  npcCast: [{ npcId: CAST_NPC, col: 2, row: 2, facing: 'south', actions: [] }],
  companionStartCol: 5,
  companionStartRow: 6,
  companionStartFacing: 'north',
  ...over,
} as unknown as IWScene);

describe('resolveCastMember', () => {
  it('returns the stored row for a cast NPC, untouched', () => {
    const member = resolveCastMember(scene(), CAST_NPC);
    expect(member).toMatchObject({ npcId: CAST_NPC, col: 2, row: 2, facing: 'south' });
  });

  it('derives a row for the companion, who is never cast', () => {
    const member = resolveCastMember(scene(), COMPANION);
    expect(member).not.toBeNull();
    expect(member!.npcId).toBe(COMPANION);
  });

  it('places the derived companion at the scene\'s own start cell', () => {
    // The single source of truth for where he stands — the same fields the client draws him
    // from, so the prompt and the board cannot disagree.
    expect(resolveCastMember(scene(), COMPANION)).toMatchObject({
      col: 5, row: 6, facing: 'north',
    });
  });

  it('gives the companion no authored actions', () => {
    // Not a stub: actions are per (scene, NPC) and he is native to no scene. He still performs
    // the scene's CONVERSATIONS, which are selected by npcId elsewhere.
    expect(resolveCastMember(scene(), COMPANION)!.actions).toEqual([]);
  });

  it('prefers a stored row over the derived one, if a scene somehow has both', () => {
    // The validator forbids writing one, but a scene saved before that rule, or edited by
    // hand, must not end up with two answers. The stored row wins because it is what the rest
    // of the scene was authored against.
    const withRow = scene({
      npcCast: [{ npcId: COMPANION, col: 1, row: 1, facing: 'east', actions: [] }],
    } as unknown as Partial<IWScene>);
    expect(resolveCastMember(withRow, COMPANION)).toMatchObject({ col: 1, row: 1 });
  });

  it('returns null for somebody who is simply not in the scene', () => {
    expect(resolveCastMember(scene(), 'nobody_here')).toBeNull();
  });

  it('does not treat the zh companion as present in an es scene', () => {
    // The exemption is keyed by the scene's LANGUAGE, not by the id alone. Spanish has no
    // companion yet, so nothing may slip through this branch.
    expect(resolveCastMember(scene({ language: 'es' } as Partial<IWScene>), COMPANION)).toBeNull();
  });

  it('does not treat a blank npcId as the companion in a language that has none', () => {
    // `COMPANION_NPC_ID_BY_LANGUAGE.es` is undefined; an empty id must not compare equal to it
    // and conjure a body out of nothing.
    expect(resolveCastMember(scene({ language: 'es' } as Partial<IWScene>), '')).toBeNull();
  });

  it('survives a scene with no cast array at all', () => {
    expect(resolveCastMember(scene({ npcCast: undefined } as unknown as Partial<IWScene>), CAST_NPC)).toBeNull();
    expect(resolveCastMember(scene({ npcCast: undefined } as unknown as Partial<IWScene>), COMPANION)).not.toBeNull();
  });
});
