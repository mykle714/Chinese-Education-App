import { describe, it, expect } from 'vitest';
import { validateScene, parseCellKey, isBlocking } from '../services/iw/sceneValidation.js';
import { IW_MAX_UNLOCK_CUES, type IWScene } from '../contracts/iw.js';

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
    sceneNotes: '王婶’s noodle stall at closing time. “counter” is where she takes payment.',
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
    // “counter” is a NAMED PLACE (§ 14 Q42) and it is also INTERACTIVE (migration 162) —
    // the interaction below hangs off this tag, so the two have to stay in step.
    layout: {
      terrain1: ['0,0', '1,0'], terrain2: [], decor: { '2,2': 'tree_1' },
      places: { counter: '4,4' },
    },
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
    // An authored EVENT (migration 161): scheduled, never drawn. This one is armed by the
    // scene itself 20s in; a `schedule_event` step could arm it too.
    events: [{ id: 'food_ready', description: 'The kitchen sends out the noodles.', atStartSeconds: 20 }],
    conversations: [
      // SELECTABLE (2026-09-06): 王婶 speaks first, so 王婶 is who may start it. A
      // conversation that is neither selectable nor started by a step is unreachable, and
      // the validator now says so — see the "nothing plays this" test below.
      {
        id: 'chat', title: 'Remark on the weather', selectable: true,
        turns: [{ npcId: 'wang_shen', text: '下雨了。' }],
      },
    ],
    // Walking up to the counter makes 王婶 run her own authored script (migration 162). Note
    // the reference rather than an inline line: the same action stays choosable by the model.
    interactions: {
      counter: [{ kind: 'npc_action', npcId: 'wang_shen', actionId: 'pay' }],
    },
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
      // Keeps “counter”, which the fixture's interaction hangs off — replacing the whole map
      // would strand that script under a tag nothing names and make every assertion here
      // fail for an unrelated reason.
      scene.layout.places = { ...scene.layout.places, 'water station': '5,5' };
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
      scene.layout.places = {};
      const messages = validateScene(scene).map((p) => p.message);
      expect(messages.some((m) => m.includes('no place named "water station"'))).toBe(true);
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

    it('accepts an ai_walk whose destination only the model will know', () => {
      // The one step with no authored referent to check — only the brief is checkable, and
      // the scene must have at least one named place for the choice to be worth making.
      const scene = withBringWater();
      scene.npcCast[0].actions!.push({
        id: 'go', name: 'go where needed',
        steps: [{ kind: 'ai_walk', instruction: 'to whoever has been waiting longest' }],
      });
      expect(validateScene(scene)).toEqual([]);
    });

    it('rejects an ai_walk with no brief, and warns when there is nowhere to choose from', () => {
      const scene = withBringWater();
      scene.npcCast[0].actions!.push({
        id: 'go', name: 'go where needed', steps: [{ kind: 'ai_walk', instruction: '  ' }],
      });
      expect(validateScene(scene).map((p) => p.field))
        .toContain('npcCast[0].actions[2].steps[0].instruction');

      const noPlaces = validScene();
      noPlaces.layout.places = {};
      noPlaces.npcCast[0].actions!.push({
        id: 'go', name: 'go where needed',
        steps: [{ kind: 'ai_walk', instruction: 'to the counter' }],
      });
      const messages = validateScene(noPlaces).map((p) => p.message);
      expect(messages.some((m) => m.includes('no named places'))).toBe(true);
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
      scene.layout.places!['far away'] = '99,0';
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

  it('lets the COMPANION speak in an overheard conversation (2026-09-05)', () => {
    // He is not cast, but he stands on the board in every scene, so an authored exchange
    // between him and a cast member is one the learner can walk up on like any other.
    const scene = validScene();
    scene.conversations[0].turns[0].npcId = 'michael';
    const messages = validateScene(scene).map((p) => p.message);
    expect(messages.some((m) => m.includes('is not in this scene'))).toBe(false);
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

describe('validateScene events (migration 161)', () => {
  it('accepts a scene whose action schedules one of its own events', () => {
    const scene = validScene();
    scene.npcCast[0].actions![0].steps.splice(1, 0, {
      kind: 'schedule_event', eventId: 'food_ready', seconds: 20,
    });
    expect(validateScene(scene)).toEqual([]);
  });

  it('rejects scheduling an event the scene does not have', () => {
    // The silent-failure case the whole step-validation exists for: the script would run to
    // the end and the world would simply never do the thing the author was counting on.
    const scene = validScene();
    scene.npcCast[0].actions![0].steps.push({
      kind: 'schedule_event', eventId: 'fire_alarm', seconds: 10,
    });
    const messages = validateScene(scene).map((p) => p.message);
    expect(messages.some((m) => m.includes('no event "fire_alarm"'))).toBe(true);
  });

  it('rejects a delay that is not whole seconds in range', () => {
    const scene = validScene();
    scene.npcCast[0].actions![0].steps.push({
      kind: 'schedule_event', eventId: 'food_ready', seconds: 10_000,
    });
    const fields = validateScene(scene).map((p) => p.field);
    expect(fields.some((f) => f.endsWith('.seconds'))).toBe(true);
  });

  it('rejects duplicate event ids (a step names an event by id)', () => {
    const scene = validScene();
    scene.events.push({ id: 'food_ready', description: 'The kitchen sends out a second bowl.' });
    const messages = validateScene(scene).map((p) => p.message);
    expect(messages.some((m) => m.includes('Duplicate event id'))).toBe(true);
  });

  it('treats an omitted atStartSeconds as script-armed, and 0 as valid', () => {
    const scene = validScene();
    delete scene.events[0].atStartSeconds;
    expect(validateScene(scene)).toEqual([]);
    scene.events[0].atStartSeconds = 0;
    expect(validateScene(scene)).toEqual([]);
  });
});

/**
 * SEVERITY (2026-09-05). A half-built scene must SAVE — authoring happens over several
 * sittings — so only what the row physically cannot hold blocks the write. These tests pin
 * that line, because the temptation when adding a rule is to make it blocking "just in case",
 * which is how the editor becomes the thing that stops an author finishing a scene.
 */
describe('validateScene severity', () => {
  const blocking = (scene: IWScene) => validateScene(scene).filter(isBlocking).map((p) => p.field);

  it('never blocks over an unfinished scene', () => {
    const scene = validScene();
    scene.npcCast[0].npcId = 'nobody';          // an id that does not resolve
    scene.completerNpcId = '';                  // no completer chosen yet
    scene.completionAction = '';                // nor an ending action
    scene.npcCast[0].actions![0].steps = [{ kind: 'walk_to_tag', tag: 'nowhere' }];
    scene.conversations[0].turns[0].text = '';
    expect(validateScene(scene).length).toBeGreaterThan(0);
    expect(blocking(scene)).toEqual([]);
  });

  it('blocks only on what the row cannot hold', () => {
    const scene = validScene();
    scene.name = '';
    expect(blocking(scene)).toEqual(['name']);

    const badLanguage = validScene();
    (badLanguage as { language: string }).language = 'fr';
    expect(blocking(badLanguage)).toEqual(['language']);

    const badBoard = validScene();
    badBoard.width = 0;
    expect(blocking(badBoard)).toEqual(['width']);

    const fractionalStart = validScene();
    fractionalStart.playerStartCol = 1.5;
    expect(blocking(fractionalStart)).toEqual(['playerStartCol']);

    const noLayout = validScene();
    (noLayout as { layout: unknown }).layout = 'nope';
    expect(blocking(noLayout)).toEqual(['layout']);
  });

  it('warns — but does not block — when a start cell falls off a shrunken board', () => {
    // The author narrowed the board before re-placing the bodies. Mid-task, not wrong.
    const scene = validScene();
    scene.playerStartCol = 5;
    scene.width = 4;
    scene.height = 4;
    const problems = validateScene(scene);
    expect(problems.some((p) => p.field === 'playerStartCol' && !isBlocking(p))).toBe(true);
    expect(blocking(scene)).toEqual([]);
  });
});

describe('validateScene interactions (migration 162)', () => {
  /** Field paths of every complaint, so a test can assert on where a rule fired. */
  const fields = (scene: IWScene) => validateScene(scene).map((p) => p.field);

  it('accepts a place whose interaction performs an action its NPC owns', () => {
    expect(validateScene(validScene())).toHaveLength(0);
  });

  it('rejects an interaction keyed by a tag no place defines', () => {
    const scene = validScene();
    scene.interactions = { nowhere: [{ kind: 'wait', seconds: 2 }] };
    expect(fields(scene)).toContain('interactions.nowhere');
  });

  it('accepts two interactive places on one cell — a walk there runs both', () => {
    // Several tags naming one cell has always been legal (IWSceneLayout.locations says so).
    // Two of them carrying SCRIPTS is a composition rather than an ambiguity: both fire, in
    // the order § 5.4a fixes. A proposed refusal here was overruled by the author, 2026-09-05.
    const scene = validScene();
    scene.layout.places = { counter: '4,4', 'where the tea is': '4,4' };
    scene.interactions = {
      counter: [{ kind: 'wait', seconds: 2 }],
      'where the tea is': [{ kind: 'wait', seconds: 2 }],
    };
    expect(validateScene(scene)).toHaveLength(0);
  });

  it('rejects an npc_action naming an action that NPC does not own', () => {
    // The pair is checked together on purpose: an action id is unique only within an NPC,
    // so checking the two separately would accept one NPC performing another's script.
    const scene = validScene();
    scene.interactions = { counter: [{ kind: 'npc_action', npcId: 'wang_shen', actionId: 'ghost' }] };
    expect(fields(scene)).toContain('interactions.counter.steps[0].actionId');
  });

  it('rejects an npc_action naming somebody who is not in the cast', () => {
    const scene = validScene();
    scene.interactions = { counter: [{ kind: 'npc_action', npcId: 'nobody', actionId: 'pay' }] };
    expect(fields(scene)).toContain('interactions.counter.steps[0].npcId');
  });

  it('rejects a popup with no picture, and one whose id is a path', () => {
    const scene = validScene();
    scene.interactions = { counter: [{ kind: 'popup', imageId: '' }] };
    expect(fields(scene)).toContain('interactions.counter.steps[0].imageId');

    scene.interactions = { counter: [{ kind: 'popup', imageId: '../secrets/x.png' }] };
    expect(fields(scene)).toContain('interactions.counter.steps[0].imageId');
  });

  it('accepts a captioned popup with a plain stem', () => {
    const scene = validScene();
    scene.interactions = { counter: [{ kind: 'popup', imageId: 'tea_menu', caption: 'The day’s menu' }] };
    expect(validateScene(scene)).toHaveLength(0);
  });

  it('rejects a scheduled event the scene does not have, and an out-of-range delay', () => {
    const scene = validScene();
    scene.interactions = { counter: [{ kind: 'schedule_event', eventId: 'nope', seconds: 9999 }] };
    const found = fields(scene);
    expect(found).toContain('interactions.counter.steps[0].eventId');
    expect(found).toContain('interactions.counter.steps[0].seconds');
  });

  it('rejects a step kind borrowed from the ACTION vocabulary', () => {
    // `walk_to_tag` is a perfectly good action step and a meaningless interaction step: an
    // interaction has no performer to be the subject of the walk.
    const scene = validScene();
    scene.interactions = { counter: [{ kind: 'walk_to_tag', tag: 'counter' } as never] };
    expect(fields(scene)).toContain('interactions.counter.steps[0].kind');
  });

  it('does not complain about an empty script', () => {
    // Deleting the last step is how a place goes back to being an ordinary walk destination;
    // the editor drops the entry when it happens, so an empty list is transient, not wrong.
    const scene = validScene();
    scene.interactions = { counter: [] };
    expect(validateScene(scene)).toHaveLength(0);
  });

  it('never blocks a save — every interaction complaint is a warning', () => {
    const scene = validScene();
    scene.interactions = { nowhere: [{ kind: 'popup', imageId: '' }] };
    expect(validateScene(scene).some(isBlocking)).toBe(false);
  });
});

/**
 * Selectability (2026-09-06) — the three shared `IWSelectable` fields, plus the two
 * per-type flags whose polarity is deliberately opposite.
 *
 * These are the rules that decide what the model is even OFFERED, so every failure here is
 * silent at run time: an action nobody can reach, a gate that never opens, a conversation
 * nothing plays. That is the whole reason they are authoring-time checks.
 */
describe('validateScene selectability (2026-09-06)', () => {
  const actionAt = 'npcCast[0].actions[0]';

  describe('a choosable title collides with an action name', () => {
    // Both are offered to the SAME NPC as one flat list of names, and the model answers with
    // a name — so two identical strings are a choice the engine cannot read. `turnOffers`
    // resolves it in the action's favour, meaning the conversation silently never plays.
    it('flags a conversation titled the same as one of its first speaker\'s actions', () => {
      const scene = validScene();
      const actionName = scene.npcCast[0].actions![0].name;
      const conv = scene.conversations[0];
      conv.selectable = true;
      conv.turns[0].npcId = scene.npcCast[0].npcId;
      conv.title = actionName;
      expect(validateScene(scene)).toContainEqual(expect.objectContaining({
        field: 'conversations[0].title',
        message: expect.stringContaining('the action wins'),
      }));
    });

    it('allows the same title when a DIFFERENT NPC owns the action', () => {
      // The offer list is per NPC, so two casts may reuse a name without ambiguity.
      const scene = validScene();
      const conv = scene.conversations[0];
      conv.selectable = true;
      conv.title = scene.npcCast[0].actions![0].name;
      conv.turns[0].npcId = 'he_laoshi';
      expect(validateScene(scene)).not.toContainEqual(expect.objectContaining({
        message: expect.stringContaining('the action wins'),
      }));
    });
  });

  describe('unlockedBy — dependent actions and conversations', () => {
    it('accepts a gate naming a complication or an event', () => {
      const scene = validScene();
      scene.npcCast[0].actions![0].unlockedBy = ['rain', 'food_ready'];
      expect(validateScene(scene)).toHaveLength(0);
    });

    it('rejects a cue that is neither a complication nor an event', () => {
      const scene = validScene();
      scene.npcCast[0].actions![0].unlockedBy = ['the_moon'];
      const problems = validateScene(scene);
      expect(problems).toContainEqual(expect.objectContaining({
        field: `${actionAt}.unlockedBy`,
        message: expect.stringContaining('no complication or event'),
      }));
    });

    it('flags the same cue listed twice', () => {
      const scene = validScene();
      scene.npcCast[0].actions![0].unlockedBy = ['rain', 'rain'];
      expect(validateScene(scene)).toContainEqual(expect.objectContaining({
        field: `${actionAt}.unlockedBy`,
        message: expect.stringContaining('listed twice'),
      }));
    });

    it('caps the number of cues', () => {
      const scene = validScene();
      scene.npcCast[0].actions![0].unlockedBy = Array(IW_MAX_UNLOCK_CUES + 1).fill('rain');
      expect(validateScene(scene)).toContainEqual(expect.objectContaining({
        field: `${actionAt}.unlockedBy`,
        message: expect.stringContaining(`At most ${IW_MAX_UNLOCK_CUES}`),
      }));
    });

    // The reason the two pools are merged for `unlockedBy` but kept apart everywhere else:
    // a shared id makes the gate unanswerable, so it has to be caught here.
    it('flags an id shared by a complication and an event', () => {
      const scene = validScene();
      scene.events.push({ id: 'rain', description: 'The awning finally gives way.' });
      expect(validateScene(scene)).toContainEqual(expect.objectContaining({
        field: 'events',
        message: expect.stringContaining('both an event and a complication'),
      }));
    });

    it('treats an omitted gate as always available', () => {
      const scene = validScene();
      delete scene.npcCast[0].actions![0].unlockedBy;
      expect(validateScene(scene)).toHaveLength(0);
    });
  });

  describe('interactionOnly — an action hidden from the model', () => {
    // The fixture's interaction already performs `pay`, so hiding it from the model still
    // leaves it reachable. This is the shape PPE's first scene wanted and wrote as prose.
    it('accepts one that a place interaction performs', () => {
      const scene = validScene();
      scene.npcCast[0].actions![0].interactionOnly = true;
      expect(validateScene(scene)).toHaveLength(0);
    });

    it('flags one nothing can trigger', () => {
      const scene = validScene();
      scene.interactions = {};
      scene.npcCast[0].actions![0].interactionOnly = true;
      expect(validateScene(scene)).toContainEqual(expect.objectContaining({
        field: `${actionAt}.interactionOnly`,
        message: expect.stringContaining('Nothing can trigger this'),
      }));
    });

    // Checked as a PAIR: another NPC's identically-named action must not satisfy the gate.
    it('does not count another NPC’s action of the same id', () => {
      const scene = validScene();
      scene.npcCast[0].actions![0].interactionOnly = true;
      scene.interactions = { counter: [{ kind: 'npc_action', npcId: 'xiao_chen', actionId: 'pay' }] };
      expect(validateScene(scene)).toContainEqual(expect.objectContaining({
        field: `${actionAt}.interactionOnly`,
      }));
    });

    it('flags urgency and gating on it as contradictions', () => {
      const scene = validScene();
      scene.npcCast[0].actions![0].interactionOnly = true;
      scene.npcCast[0].actions![0].urgent = true;
      scene.npcCast[0].actions![0].unlockedBy = ['rain'];
      const problems = validateScene(scene);
      expect(problems).toContainEqual(expect.objectContaining({ field: `${actionAt}.urgent` }));
      expect(problems).toContainEqual(expect.objectContaining({ field: `${actionAt}.unlockedBy` }));
    });
  });

  describe('selectable — a conversation its first speaker may start', () => {
    it('flags a conversation that nothing plays', () => {
      const scene = validScene();
      scene.conversations[0].selectable = false;
      expect(validateScene(scene)).toContainEqual(expect.objectContaining({
        field: 'conversations[0].selectable',
        message: expect.stringContaining('Nothing plays this'),
      }));
    });

    // The other way in. A script-fired conversation is not meant to be spontaneous, which is
    // exactly the case `selectable`'s opt-IN polarity protects.
    it('accepts a non-selectable conversation a step starts', () => {
      const scene = validScene();
      scene.conversations[0].selectable = false;
      scene.npcCast[0].actions![0].steps.unshift({ kind: 'start_conversation', conversationId: 'chat' });
      expect(validateScene(scene)).toHaveLength(0);
    });

    it('accepts one an INTERACTION starts', () => {
      const scene = validScene();
      scene.conversations[0].selectable = false;
      scene.interactions = {
        counter: [
          { kind: 'npc_action', npcId: 'wang_shen', actionId: 'pay' },
          { kind: 'start_conversation', conversationId: 'chat' },
        ],
      };
      expect(validateScene(scene)).toHaveLength(0);
    });

    it('needs a first speaker before it can be chosen', () => {
      const scene = validScene();
      scene.conversations[0].turns = [];
      expect(validateScene(scene)).toContainEqual(expect.objectContaining({
        field: 'conversations[0].selectable',
        message: expect.stringContaining('whoever speaks first'),
      }));
    });

    // The field whose audience the flag changes: an author-facing label becomes the handle
    // the model chooses by.
    it('needs a title, because that is what the NPC chooses it by', () => {
      const scene = validScene();
      scene.conversations[0].title = '';
      expect(validateScene(scene)).toContainEqual(expect.objectContaining({
        field: 'conversations[0].title',
        message: expect.stringContaining('chooses it by'),
      }));
    });

    it('gates a conversation on a cue like an action', () => {
      const scene = validScene();
      scene.conversations[0].unlockedBy = ['nope'];
      expect(validateScene(scene)).toContainEqual(expect.objectContaining({
        field: 'conversations[0].unlockedBy',
      }));
    });
  });
});

/**
 * The `locations` → `places` rename (2026-09-06). `layout` is jsonb, so a row written before
 * the rename can still arrive carrying the old key — and the failure mode if it is not read
 * is loud but misleading: every `walk_to_tag` in a finished scene reported as pointing at a
 * place that does not exist.
 */
describe('validateScene places/locations compatibility', () => {
  it('reads a layout that still carries the old `locations` key', () => {
    const scene = validScene();
    scene.layout.locations = scene.layout.places;
    delete scene.layout.places;
    expect(validateScene(scene)).toHaveLength(0);
  });

  it('prefers `places` when a row somehow carries both', () => {
    const scene = validScene();
    scene.layout.locations = { somewhere_else: '1,1' };
    expect(validateScene(scene)).toHaveLength(0);
  });
});
