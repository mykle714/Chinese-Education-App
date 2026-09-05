import { describe, it, expect } from 'vitest';
import { validateScene, parseCellKey } from '../services/iw/sceneValidation.js';
import type { IWScene } from '../contracts/iw.js';

/**
 * Tests for the pure iw scene validator (docs/IMMERSIVE_WORLD.md § 12 phase 1d).
 *
 * These run with no database, matching this suite's rule (server/vitest.config.ts):
 * `validateScene` is pure precisely so the rules that decide whether a scene is
 * well-formed can be tested without one.
 *
 * The fixture uses REAL NPC ids from `server/config/iwNpcs.ts`, deliberately: the
 * validator's whole job is checking references into that code constant, so a fake id
 * would test nothing. If a test here starts failing because an NPC was renamed, that is
 * the check working — and the same breakage `validateStoredNpcIds` reports for rows.
 */

/** A minimal well-formed scene: 王婶 on a 6×6 board, the companion beside the player. */
function validScene(): IWScene {
  return {
    language: 'zh',
    name: 'Noodle stall',
    published: false,
    completerNpcId: 'wang_shen',
    completionAction: 'pay',
    playerStartCol: 0,
    playerStartRow: 0,
    playerStartFacing: 's',
    companionStartCol: 1,
    companionStartRow: 0,
    companionStartFacing: 's',
    width: 6,
    height: 6,
    layout: { terrain1: ['0,0', '1,0'], terrain2: [], decor: { '2,2': 'tree_1' } },
    // The companion is NOT cast — he is in every scene by definition and is positioned by
    // companionStartCol/Row above. Casting him is a refusal (see the test below).
    npcCast: [
      {
        npcId: 'wang_shen', col: 3, row: 3, facing: 's',
        // The completer must OWN the action the scene nominates as its completion, or the
        // scene could never end — a check the pre-Q42 design could not make (§ 14 Q42).
        // Taking payment is not an engine primitive; it is this little script.
        actions: [{
          id: 'pay',
          name: 'take payment',
          steps: [
            { kind: 'walk_to_actor', actor: 'player' },
            { kind: 'comment', text: 'Five yuan, please.' },
            { kind: 'wait_for_response' },
          ],
        }],
      },
    ],
    complications: [{ id: 'rain', description: 'It starts raining and the stall’s awning leaks.' }],
    conversations: [
      { id: 'chat', title: 'Weather', turns: [{ npcId: 'wang_shen', text: '下雨了。' }] },
    ],
  };
}

describe('parseCellKey', () => {
  it('parses a "col,row" key', () => {
    expect(parseCellKey('3,7')).toEqual({ col: 3, row: 7 });
  });
  it('rejects anything else', () => {
    expect(parseCellKey('3,7,1')).toBeNull();
    expect(parseCellKey('-1,0')).toBeNull();
    expect(parseCellKey('a,b')).toBeNull();
  });
});

describe('validateScene', () => {
  it('accepts a well-formed scene', () => {
    expect(validateScene(validScene())).toEqual([]);
  });

  it('rejects an NPC id that does not resolve in the registry', () => {
    const scene = validScene();
    scene.npcCast[0].npcId = 'nobody';
    const fields = validateScene(scene).map((p) => p.field);
    expect(fields).toContain('npcCast[0].npcId');
  });

  it('rejects a completer who is not in the cast', () => {
    const scene = validScene();
    scene.npcCast = [{ npcId: 'michael', col: 4, row: 3, facing: 'w' }];
    const messages = validateScene(scene).map((p) => p.message);
    expect(messages.some((m) => m.includes('must be in the cast'))).toBe(true);
  });

  it('rejects a completer with no completion rule', () => {
    // 小陈 is the difficulty setting, not a vendor who takes money — she has no
    // completionRule, so she cannot be told what she is agreeing to (§ 14 Q27).
    const scene = validScene();
    scene.completerNpcId = 'xiao_chen';
    scene.npcCast.push({ npcId: 'xiao_chen', col: 2, row: 4, facing: 'n' });
    const messages = validateScene(scene).map((p) => p.message);
    expect(messages.some((m) => m.includes('no completion rule'))).toBe(true);
  });

  it('refuses to let the companion end a scene', () => {
    const scene = validScene();
    scene.completerNpcId = 'michael';
    const messages = validateScene(scene).map((p) => p.message);
    expect(messages.some((m) => m.includes('companion terminates nothing'))).toBe(true);
  });

  it('refuses to cast the companion', () => {
    // He is in every scene by definition and is positioned by the scene's own companion
    // start cell, so a cast row for him would be a second answer to "where does he stand".
    const scene = validScene();
    scene.npcCast = [...scene.npcCast, { npcId: 'michael', col: 4, row: 4, facing: 's' }];
    const problems = validateScene(scene);
    expect(problems.map((p) => p.field)).toContain('npcCast[1].npcId');
    expect(problems.some((p) => p.message.includes('is the companion'))).toBe(true);
  });

  // ── Authored NPC actions (§ 14 Q42) ─────────────────────────────────────────
  describe('authored NPC actions', () => {
    /** The worked example from the design: fetch water, deliver it, offer more. */
    function withBringWater(): IWScene {
      const scene = validScene();
      scene.layout.locations = { '5,5': 'water station' };
      scene.npcCast[0].actions = [...scene.npcCast[0].actions!, {
        id: 'a1',
        name: 'bring water',
        when: 'The learner looks thirsty, or asks for a drink.',
        steps: [
          { kind: 'walk_to_tag', tag: 'water station' },
          { kind: 'wait', seconds: 5 },
          { kind: 'walk_to_actor', actor: 'companion' },
          { kind: 'comment', text: 'I brought you water.' },
          { kind: 'wait', seconds: 2 },
          { kind: 'walk_to_actor', actor: 'player' },
          { kind: 'wait', seconds: 2 },
          { kind: 'comment', text: 'Is there anything else I can get you?' },
          { kind: 'wait_for_response' },
        ],
      }];
      return scene;
    }

    it('accepts the worked example', () => {
      expect(validateScene(withBringWater())).toEqual([]);
    });

    it('rejects a walk to a place nothing is tagged with', () => {
      const scene = withBringWater();
      scene.layout.locations = {};
      const messages = validateScene(scene).map((p) => p.message);
      expect(messages.some((m) => m.includes('tagged "water station"'))).toBe(true);
    });

    it('rejects a walk to somebody who is not in the scene', () => {
      const scene = withBringWater();
      scene.npcCast[0].actions![1].steps[2] = { kind: 'walk_to_actor', actor: 'lao_zhou' };
      const messages = validateScene(scene).map((p) => p.message);
      expect(messages.some((m) => m.includes('is not in this scene'))).toBe(true);
    });

    it('rejects an NPC walking to itself', () => {
      const scene = withBringWater();
      scene.npcCast[0].actions![1].steps[2] = { kind: 'walk_to_actor', actor: 'wang_shen' };
      const messages = validateScene(scene).map((p) => p.message);
      expect(messages.some((m) => m.includes('cannot aim this at itself'))).toBe(true);
    });

    it('rejects anything after waiting for the learner', () => {
      const scene = withBringWater();
      scene.npcCast[0].actions![1].steps.push({ kind: 'wait', seconds: 1 });
      const messages = validateScene(scene).map((p) => p.message);
      expect(messages.some((m) => m.includes('must be the last step'))).toBe(true);
    });

    it('rejects two actions sharing a name, because the model chooses by name', () => {
      const scene = withBringWater();
      scene.npcCast[0].actions!.push({
        id: 'a2', name: 'Bring Water', steps: [{ kind: 'wait', seconds: 1 }],
      });
      const messages = validateScene(scene).map((p) => p.message);
      expect(messages.some((m) => m.includes('already called'))).toBe(true);
    });

    it('rejects an out-of-range wait and an empty script', () => {
      const scene = withBringWater();
      scene.npcCast[0].actions![1].steps[1] = { kind: 'wait', seconds: 0 };
      scene.npcCast[0].actions!.push({ id: 'a3', name: 'do nothing', steps: [] });
      const fields = validateScene(scene).map((p) => p.field);
      expect(fields).toContain('npcCast[0].actions[1].steps[1].seconds');
      expect(fields).toContain('npcCast[0].actions[2].steps');
    });

    it('refuses a completer that does not own the nominated completion action', () => {
      // The check the pre-Q42 design could not make: completion used to be a verb the model
      // MIGHT emit, so nothing at authoring time could tell whether it ever would.
      const scene = validScene();
      scene.npcCast[0].actions = [{
        id: 'chat', name: 'chat', steps: [{ kind: 'comment', text: 'Nice day.' }],
      }];
      const messages = validateScene(scene).map((p) => p.message);
      expect(messages.some((m) => m.includes('has no action that ends the scene'))).toBe(true);
    });

    it('rejects a start_conversation step naming a conversation that does not exist', () => {
      const scene = validScene();
      scene.npcCast[0].actions!.push({
        id: 'gossip', name: 'gossip', steps: [{ kind: 'start_conversation', conversationId: 'nope' }],
      });
      const messages = validateScene(scene).map((p) => p.message);
      expect(messages.some((m) => m.includes('no conversation "nope"'))).toBe(true);
    });

    it('accepts a refusal authored out of ordinary steps', () => {
      // There is no `refuse` primitive — turning someone away IS a comment plus a walk.
      const scene = validScene();
      scene.npcCast[0].actions!.push({
        id: 'no', name: 'turn them away',
        steps: [
          { kind: 'comment', text: 'Sorry, we are out of that.' },
          { kind: 'walk_away_from', actor: 'player' },
        ],
      });
      expect(validateScene(scene)).toEqual([]);
    });

    it('rejects a place tagged off the board', () => {
      const scene = withBringWater();
      scene.layout.locations!['99,0'] = 'far away';
      const messages = validateScene(scene).map((p) => p.message);
      expect(messages.some((m) => m.includes('off the board'))).toBe(true);
    });
  });

  it('rejects a completion action the completer does not have', () => {
    const scene = validScene();
    scene.completionAction = 'nonexistent';
    expect(validateScene(scene).map((p) => p.field)).toContain('completionAction');
  });

  it('rejects a blank completion action', () => {
    const scene = validScene();
    scene.completionAction = '';
    expect(validateScene(scene).map((p) => p.message)).toContain('Choose the action that ends this scene');
  });

  it('rejects two actors on one cell', () => {
    const scene = validScene();
    // A second castable NPC (小陈 — not the companion, who cannot be cast at all).
    scene.npcCast = [...scene.npcCast, { npcId: 'xiao_chen', col: 5, row: 5, facing: 'n' }];
    scene.npcCast[1].col = scene.npcCast[0].col;
    scene.npcCast[1].row = scene.npcCast[0].row;
    const messages = validateScene(scene).map((p) => p.message);
    expect(messages.some((m) => m.includes('already occupied'))).toBe(true);
  });

  it('rejects a companion standing on the player start cell', () => {
    const scene = validScene();
    scene.companionStartCol = scene.playerStartCol;
    scene.companionStartRow = scene.playerStartRow;
    const messages = validateScene(scene).map((p) => p.message);
    expect(messages.some((m) => m.includes('cannot start on the player'))).toBe(true);
  });

  it('rejects off-board cells in a layout mask and in decor', () => {
    const scene = validScene();
    scene.layout.terrain1.push('99,0');
    scene.layout.decor['0,99'] = 'tree_1';
    const messages = validateScene(scene).map((p) => p.message);
    expect(messages.filter((m) => m.includes('off the board')).length).toBe(2);
  });

  it('rejects a conversation line spoken by someone not in the scene', () => {
    const scene = validScene();
    scene.conversations[0].turns[0].npcId = 'lao_zhou';
    const messages = validateScene(scene).map((p) => p.message);
    expect(messages.some((m) => m.includes('is not in this scene'))).toBe(true);
  });

  it('refuses to let the COMPANION speak in an overheard conversation', () => {
    // He walks in with the learner, so he is never a voice the learner OVERHEARS — an
    // exchange he is part of is one he is having, which is the live NPC path.
    const scene = validScene();
    scene.conversations[0].turns[0].npcId = 'michael';
    const messages = validateScene(scene).map((p) => p.message);
    expect(messages.some((m) => m.includes('is not in this scene'))).toBe(true);
  });

  it('rejects duplicate complication ids (a run stores the id and would be ambiguous)', () => {
    const scene = validScene();
    scene.complications.push({ id: 'rain', description: 'A queue forms.' });
    const messages = validateScene(scene).map((p) => p.message);
    expect(messages.some((m) => m.includes('Duplicate complication id'))).toBe(true);
  });

  it('reports every problem at once rather than stopping at the first', () => {
    const scene = validScene();
    scene.name = '';
    scene.completionAction = '';
    scene.completerNpcId = 'nobody';
    expect(validateScene(scene).length).toBeGreaterThanOrEqual(3);
  });
});
