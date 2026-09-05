import {
  IW_ACTION_STEP_KINDS,
  IW_ACTOR_COMPANION,
  IW_ACTOR_PLAYER,
  IW_FACINGS,
  IW_MAX_ACTION_COMMENT_LENGTH,
  IW_MAX_ACTION_NAME_LENGTH,
  IW_MAX_ACTION_STEPS,
  IW_MAX_ACTION_WHEN_LENGTH,
  IW_MAX_CAST,
  IW_MAX_COMPLICATIONS,
  IW_MAX_COMPLICATION_LENGTH,
  IW_MAX_CONVERSATIONS,
  IW_MAX_CONVERSATION_LINE_LENGTH,
  IW_MAX_CONVERSATION_TURNS,
  IW_MAX_LOCATIONS,
  IW_MAX_LOCATION_TAG_LENGTH,
  IW_MAX_NPC_ACTIONS,
  IW_MAX_SCENE_DIM,
  IW_MAX_SCENE_NAME_LENGTH,
  IW_MAX_WAIT_SECONDS,
  IW_MIN_SCENE_DIM,
  type IWActionStep,
  type IWActionStepKind,
  type IWConversation,
  type IWFacing,
  type IWNpcAction,
  type IWScene,
  type IWSceneCastMember,
  type IWSceneLayout,
} from '../../contracts/iw.js';
import { COMPANION_NPC_ID_BY_LANGUAGE, npcById } from '../../config/iwNpcs.js';

/**
 * iw scene validation — PURE. No database, no HTTP, no model.
 *
 * LAYER: service-layer helper, deliberately factored out of ImmersiveWorldSceneService so
 * every rule here is unit-testable without a connection. This is the same pure/impure line
 * docs/IMMERSIVE_WORLD.md § 8 draws for the runtime ("everything that decides *whether* an
 * NPC may speak is pure and unit-testable") applied to authoring: everything that decides
 * whether a scene is well-formed is pure.
 *
 * WHY IT IS THIS STRICT. § 12 phase 1's kill condition is "an author cannot assemble a
 * working scene without engineering help", and the failure that produces it is a scene that
 * SAVES and then misbehaves at runtime — a completer who isn't in the cast, an NPC id that
 * no longer resolves, a start cell off the board. Each of those is a silent runtime fault
 * and a loud save-time error, so they are all checked here.
 *
 * NPC IDS ARE CHECKED AGAINST CODE, NOT A TABLE. `npcById` is the only resolver
 * (migration 158's header); the database cannot enforce a reference into a code constant,
 * which is why the same check appears here (on write) and in `validateStoredNpcIds` (at
 * startup, for rows written before an NPC was deleted).
 *
 * Referenced by: server/services/ImmersiveWorldSceneService.ts,
 * server/services/iw/__tests__/sceneValidation.test.ts.
 * Documented in docs/IMMERSIVE_WORLD.md § 12 phase 1d.
 */

/** One problem with a submitted scene, addressed to the author. */
export interface IWSceneProblem {
  /** Dotted path into the payload ("npcCast[2].npcId"), so the editor can highlight a field. */
  field: string;
  message: string;
}

/** A "col,row" cell key as stored in every layout mask. */
const CELL_KEY = /^(\d+),(\d+)$/;

/** Parse a "col,row" key, or null when it is not one. */
export function parseCellKey(key: string): { col: number; row: number } | null {
  const m = CELL_KEY.exec(key);
  if (!m) return null;
  return { col: Number(m[1]), row: Number(m[2]) };
}

/** Is `n` an integer within [min,max]? Guards every geometry field. */
function isIntInRange(n: unknown, min: number, max: number): boolean {
  return typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;
}

/** Trim a string-ish value; non-strings become ''. */
function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Validate one scene payload end to end and return every problem found.
 *
 * Returns ALL problems rather than throwing on the first, because an author fixing a scene
 * one error per save round-trip is the tool being annoying in exactly the way phase 1's
 * kill condition describes.
 */
export function validateScene(scene: IWScene): IWSceneProblem[] {
  const problems: IWSceneProblem[] = [];
  const add = (field: string, message: string) => problems.push({ field, message });

  // ── Identity ──────────────────────────────────────────────────────────────
  if (scene.language !== 'zh' && scene.language !== 'es') {
    add('language', 'Language must be zh or es');
  }
  const name = str(scene.name);
  if (!name) add('name', 'A scene needs a name');
  else if (name.length > IW_MAX_SCENE_NAME_LENGTH) {
    add('name', `Name must be ≤ ${IW_MAX_SCENE_NAME_LENGTH} characters`);
  }

  // ── Board geometry ────────────────────────────────────────────────────────
  const dimsOk =
    isIntInRange(scene.width, IW_MIN_SCENE_DIM, IW_MAX_SCENE_DIM) &&
    isIntInRange(scene.height, IW_MIN_SCENE_DIM, IW_MAX_SCENE_DIM);
  if (!dimsOk) {
    add('width', `Board must be between ${IW_MIN_SCENE_DIM} and ${IW_MAX_SCENE_DIM} cells on each side`);
  }

  // Every later cell check needs a board to be inside, so they only run once dims are sane.
  const onBoard = (col: unknown, row: unknown): boolean =>
    dimsOk && isIntInRange(col, 0, scene.width - 1) && isIntInRange(row, 0, scene.height - 1);

  if (!onBoard(scene.playerStartCol, scene.playerStartRow)) {
    add('playerStartCol', 'The player start cell is off the board');
  }
  if (!onBoard(scene.companionStartCol, scene.companionStartRow)) {
    add('companionStartCol', 'The companion start cell is off the board');
  }
  // Both bodies also face somewhere at scene open (migration 159). Checked exactly like a
  // cast member's `facing` below — the constraint is identical, only the storage differs.
  if (!IW_FACINGS.includes(scene.playerStartFacing as IWFacing)) {
    add('playerStartFacing', `Facing must be one of ${IW_FACINGS.join(', ')}`);
  }
  if (!IW_FACINGS.includes(scene.companionStartFacing as IWFacing)) {
    add('companionStartFacing', `Facing must be one of ${IW_FACINGS.join(', ')}`);
  }
  // Both starts are authored (migration 158): the companion does NOT spawn next to the
  // player, because the scene opens with an automatic walk from one to the other. Sharing
  // a cell would make that opening animation a no-op.
  if (
    scene.playerStartCol === scene.companionStartCol &&
    scene.playerStartRow === scene.companionStartRow
  ) {
    add('companionStartCol', 'The companion cannot start on the player’s cell');
  }

  problems.push(...validateLayout(scene.layout, scene.width, scene.height, dimsOk));

  // ── Cast ──────────────────────────────────────────────────────────────────
  const cast = Array.isArray(scene.npcCast) ? scene.npcCast : [];
  if (!Array.isArray(scene.npcCast)) add('npcCast', 'Cast must be a list');
  if (cast.length > IW_MAX_CAST) add('npcCast', `A scene may hold at most ${IW_MAX_CAST} NPCs`);

  const companionId = COMPANION_NPC_ID_BY_LANGUAGE[scene.language as 'zh' | 'es'];
  const seenNpcIds = new Set<string>();
  const occupied = new Map<string, string>(); // "col,row" → what already stands there

  if (onBoard(scene.playerStartCol, scene.playerStartRow)) {
    occupied.set(`${scene.playerStartCol},${scene.playerStartRow}`, 'the player');
  }
  if (onBoard(scene.companionStartCol, scene.companionStartRow)) {
    occupied.set(`${scene.companionStartCol},${scene.companionStartRow}`, 'the companion');
  }

  // The two things an authored action can point at (§ 14 Q42), gathered ONCE. Both are
  // computed from the draft rather than passed in, so a scene is always checked against its
  // own places and its own cast — never against a stale copy.
  const locationTags = new Set<string>(
    Object.values(scene.layout?.locations ?? {})
      .filter((t): t is string => typeof t === 'string' && !!t.trim())
      .map((t) => t.trim()),
  );
  const actorIds = new Set<string>([
    IW_ACTOR_PLAYER,
    IW_ACTOR_COMPANION,
    ...cast.map((m) => str(m?.npcId)).filter(Boolean),
  ]);
  const conversationIds = new Set<string>(
    (Array.isArray(scene.conversations) ? scene.conversations : [])
      .map((c) => str(c?.id)).filter(Boolean),
  );

  cast.forEach((member: IWSceneCastMember, i: number) => {
    const at = `npcCast[${i}]`;
    const npc = npcById(str(member?.npcId));
    if (!npc) {
      // The whole reason NPC ids are text: the referent is a code constant, so this is the
      // only place the reference can be checked on write.
      add(`${at}.npcId`, `No such NPC: "${str(member?.npcId) || '(blank)'}"`);
    } else {
      if (npc.language !== scene.language) {
        add(`${at}.npcId`, `${npc.name} is a ${npc.language} NPC and cannot appear in a ${scene.language} scene`);
      }
      if (seenNpcIds.has(npc.id)) add(`${at}.npcId`, `${npc.name} is already in this scene`);
      // THE COMPANION IS NOT CAST. He is in every scene by definition — a code constant
      // (COMPANION_NPC_ID_BY_LANGUAGE), placed by the scene's own companionStart cell, not
      // chosen and positioned like a stallkeeper. A cast row for him would be a SECOND,
      // desynchronizable answer to "where does he stand", and it would let an author build
      // a scene whose companion is somebody else's — which is not a thing a scene may say.
      if (companionId && npc.id === companionId) {
        add(`${at}.npcId`, `${npc.name} is the companion — he is in every scene already. Move him with the companion start cell instead of casting him.`);
      }
      seenNpcIds.add(npc.id);
    }

    if (!onBoard(member?.col, member?.row)) {
      add(`${at}.col`, 'This NPC stands off the board');
    } else {
      const key = `${member.col},${member.row}`;
      const taken = occupied.get(key);
      if (taken) add(`${at}.col`, `Cell ${key} is already occupied by ${taken}`);
      else occupied.set(key, npc ? npc.name : 'another NPC');
    }

    if (!IW_FACINGS.includes(member?.facing as IWFacing)) {
      add(`${at}.facing`, `Facing must be one of ${IW_FACINGS.join(', ')}`);
    }

    problems.push(...validateNpcActions(
      member?.actions, at, str(member?.npcId), locationTags, actorIds, conversationIds,
    ));
  });

  // ── The completion pair (§ 9.2) ───────────────────────────────────────────
  const completer = npcById(str(scene.completerNpcId));
  if (!completer) {
    add('completerNpcId', 'Pick the NPC whose action ends the scene');
  } else {
    if (!seenNpcIds.has(completer.id)) {
      // The single most damaging authoring error, which is why the pair is two lifted
      // columns rather than a field inside the cast blob (migration 158).
      add('completerNpcId', `${completer.name} must be in the cast to end the scene`);
    }
    if (!completer.completionRule) {
      // § 14 Q27: an NPC is told who it is, never what it is for. Without a completionRule
      // written in their own terms, the character has no idea what they would be agreeing to.
      add('completerNpcId', `${completer.name} has no completion rule and cannot end a scene`);
    }
    // ⚠️ NEWLY CHECKABLE (§ 14 Q42). Under the old design the completion action was a verb
    // the MODEL might emit, so nothing at authoring time could tell whether it ever would.
    // Now it names one of the completer's OWN authored actions, so "the action you nominated
    // to end this scene does not exist on this NPC" is a fact the editor can state before a
    // learner ever plays it. Reported on `completionAction`, because that is the field the
    // author would fix — the NPC is rarely the mistake.
    const completerMember = cast.find((m) => str(m?.npcId) === completer.id);
    if (completerMember) {
      const completingAction = (completerMember.actions ?? []).find(
        (a) => str(a?.id) === scene.completionAction,
      );
      if (!completingAction) {
        add(
          'completionAction',
          `${completer.name} has no action that ends the scene — program one (a payment, a handover) and choose it here`,
        );
      }
    }
    if (companionId && completer.id === companionId) {
      add('completerNpcId', 'The companion terminates nothing — he does not order, buy or ask on the learner’s behalf');
    }
  }
  // Only presence is checked here; that it names a real action on the completer is checked
  // above, where the completer is resolved. A blank is its own message because "choose one"
  // and "the one you chose is gone" are different mistakes.
  if (!str(scene.completionAction)) {
    add('completionAction', 'Choose the action that ends this scene');
  }

  // ── Complications (§ 14 Q31) ──────────────────────────────────────────────
  const complications = Array.isArray(scene.complications) ? scene.complications : [];
  if (!Array.isArray(scene.complications)) add('complications', 'Complications must be a list');
  if (complications.length > IW_MAX_COMPLICATIONS) {
    add('complications', `At most ${IW_MAX_COMPLICATIONS} complications`);
  }
  const seenComplicationIds = new Set<string>();
  complications.forEach((c, i) => {
    const at = `complications[${i}]`;
    const id = str(c?.id);
    // The id is stored on a run (`iw_scene_runs."complicationId"`), so a duplicate would
    // make a finished run ambiguous about what it actually drew.
    if (!id) add(`${at}.id`, 'Complication needs an id');
    else if (seenComplicationIds.has(id)) add(`${at}.id`, `Duplicate complication id "${id}"`);
    seenComplicationIds.add(id);

    const description = str(c?.description);
    if (!description) add(`${at}.description`, 'Complication needs a description');
    else if (description.length > IW_MAX_COMPLICATION_LENGTH) {
      add(`${at}.description`, `Description must be ≤ ${IW_MAX_COMPLICATION_LENGTH} characters`);
    }
  });

  // ── Authored NPC-to-NPC conversations (§ 14 Q6) ───────────────────────────
  problems.push(...validateConversations(scene.conversations, seenNpcIds));

  return problems;
}

/**
 * Layout masks and decor keys must be "col,row" strings inside the board. An off-board
 * cell is invisible in the editor (nothing renders it) but survives every save, so it can
 * only ever be found here.
 */
function validateLayout(
  layout: IWSceneLayout | undefined,
  width: number,
  height: number,
  dimsOk: boolean,
): IWSceneProblem[] {
  const problems: IWSceneProblem[] = [];
  if (!layout || typeof layout !== 'object') {
    return [{ field: 'layout', message: 'Layout must be an object' }];
  }

  // Only the two terrain layers are cell lists now: a scene paints no walkability class
  // (see IWSceneLayout's header — every cell is walkable unless blocking decor stands on it).
  const masks: Array<keyof IWSceneLayout> = ['terrain1', 'terrain2'];
  for (const mask of masks) {
    const cells = layout[mask];
    if (!Array.isArray(cells)) {
      problems.push({ field: `layout.${mask}`, message: `${mask} must be a list of "col,row" cells` });
      continue;
    }
    for (const cell of cells as string[]) {
      const parsed = typeof cell === 'string' ? parseCellKey(cell) : null;
      if (!parsed) {
        problems.push({ field: `layout.${mask}`, message: `"${String(cell)}" is not a "col,row" cell` });
      } else if (dimsOk && (parsed.col >= width || parsed.row >= height)) {
        problems.push({ field: `layout.${mask}`, message: `Cell ${cell} is off the board` });
      }
    }
  }

  if (layout.decor && typeof layout.decor === 'object') {
    for (const [cell, stem] of Object.entries(layout.decor)) {
      const parsed = parseCellKey(cell);
      if (!parsed) {
        problems.push({ field: 'layout.decor', message: `"${cell}" is not a "col,row" cell` });
      } else if (dimsOk && (parsed.col >= width || parsed.row >= height)) {
        problems.push({ field: 'layout.decor', message: `Decor at ${cell} is off the board` });
      }
      if (typeof stem !== 'string' || !stem) {
        problems.push({ field: 'layout.decor', message: `Decor at ${cell} has no sprite` });
      }
    }
  } else if (layout.decor !== undefined) {
    problems.push({ field: 'layout.decor', message: 'Decor must be an object keyed by cell' });
  }

  // Named places (§ 14 Q42). Keyed by cell, so one cell has at most one tag; several cells
  // may legitimately share a tag, and `walk_to_tag` heads for the nearest.
  if (layout.locations && typeof layout.locations === 'object') {
    const entries = Object.entries(layout.locations);
    if (entries.length > IW_MAX_LOCATIONS) {
      problems.push({ field: 'layout.locations', message: `At most ${IW_MAX_LOCATIONS} named places` });
    }
    for (const [cell, tag] of entries) {
      const parsed = parseCellKey(cell);
      if (!parsed) {
        problems.push({ field: 'layout.locations', message: `"${cell}" is not a "col,row" cell` });
      } else if (dimsOk && (parsed.col >= width || parsed.row >= height)) {
        problems.push({ field: 'layout.locations', message: `The place at ${cell} is off the board` });
      }
      if (typeof tag !== 'string' || !tag.trim()) {
        problems.push({ field: 'layout.locations', message: `The place at ${cell} has no name` });
      } else if (tag.length > IW_MAX_LOCATION_TAG_LENGTH) {
        problems.push({
          field: 'layout.locations',
          message: `Place names must be ≤ ${IW_MAX_LOCATION_TAG_LENGTH} characters`,
        });
      }
    }
  } else if (layout.locations !== undefined) {
    problems.push({ field: 'layout.locations', message: 'Places must be an object keyed by cell' });
  }

  return problems;
}

/**
 * One NPC's authored actions (§ 14 Q42).
 *
 * WHY EACH RULE EXISTS — every one of these is a way to author a script that would fail
 * SILENTLY at playback rather than loudly, which is the worst kind of authoring bug:
 * a walk toward a place nobody tagged, or toward somebody who is not in the scene, is an
 * NPC that simply stands still and says nothing while the learner waits for a turn.
 *
 * `tags` is the set of place names the scene actually defines; `actorIds` is who is
 * present. Both are computed once by the caller rather than per action.
 */
function validateNpcActions(
  actions: IWNpcAction[] | undefined,
  at: string,
  selfNpcId: string,
  tags: Set<string>,
  actorIds: Set<string>,
  conversationIds: Set<string>,
): IWSceneProblem[] {
  const problems: IWSceneProblem[] = [];
  if (actions === undefined) return problems;
  if (!Array.isArray(actions)) {
    return [{ field: `${at}.actions`, message: 'Actions must be a list' }];
  }
  if (actions.length > IW_MAX_NPC_ACTIONS) {
    problems.push({ field: `${at}.actions`, message: `At most ${IW_MAX_NPC_ACTIONS} actions per NPC` });
  }

  const seenIds = new Set<string>();
  const seenNames = new Set<string>();

  actions.forEach((action, a) => {
    const actionAt = `${at}.actions[${a}]`;

    const id = str(action?.id);
    if (!id) problems.push({ field: `${actionAt}.id`, message: 'Action needs an id' });
    else if (seenIds.has(id)) problems.push({ field: `${actionAt}.id`, message: `Duplicate action id "${id}"` });
    seenIds.add(id);

    // The NAME is what the model chooses by, so two actions with one name is not a tidiness
    // problem — it is an ambiguous choice the model cannot express a preference between.
    const name = str(action?.name).trim();
    if (!name) {
      problems.push({ field: `${actionAt}.name`, message: 'Give the action a name the model can choose by' });
    } else if (seenNames.has(name.toLowerCase())) {
      problems.push({ field: `${actionAt}.name`, message: `Another action is already called "${name}"` });
    } else if (name.length > IW_MAX_ACTION_NAME_LENGTH) {
      problems.push({ field: `${actionAt}.name`, message: `Name must be ≤ ${IW_MAX_ACTION_NAME_LENGTH} characters` });
    }
    seenNames.add(name.toLowerCase());

    if (str(action?.when).length > IW_MAX_ACTION_WHEN_LENGTH) {
      problems.push({ field: `${actionAt}.when`, message: `Guidance must be ≤ ${IW_MAX_ACTION_WHEN_LENGTH} characters` });
    }

    const steps: IWActionStep[] = Array.isArray(action?.steps) ? action.steps : [];
    if (!Array.isArray(action?.steps) || steps.length === 0) {
      problems.push({ field: `${actionAt}.steps`, message: 'An action needs at least one step' });
    }
    if (steps.length > IW_MAX_ACTION_STEPS) {
      problems.push({ field: `${actionAt}.steps`, message: `At most ${IW_MAX_ACTION_STEPS} steps` });
    }

    steps.forEach((step, t) => {
      const stepAt = `${actionAt}.steps[${t}]`;
      const kind = str(step?.kind) as IWActionStepKind;
      if (!IW_ACTION_STEP_KINDS.includes(kind)) {
        problems.push({ field: `${stepAt}.kind`, message: `"${kind || '(blank)'}" is not a step kind` });
        return;
      }

      switch (kind) {
        case 'comment': {
          const text = str((step as { text?: unknown }).text);
          if (!text.trim()) {
            problems.push({ field: `${stepAt}.text`, message: 'Say what, roughly? The NPC paraphrases this.' });
          } else if (text.length > IW_MAX_ACTION_COMMENT_LENGTH) {
            problems.push({ field: `${stepAt}.text`, message: `Must be ≤ ${IW_MAX_ACTION_COMMENT_LENGTH} characters` });
          }
          break;
        }
        case 'walk_to_tag': {
          const tag = str((step as { tag?: unknown }).tag).trim();
          if (!tag) problems.push({ field: `${stepAt}.tag`, message: 'Pick a place to walk to' });
          else if (!tags.has(tag)) {
            problems.push({ field: `${stepAt}.tag`, message: `No cell in this scene is tagged "${tag}"` });
          }
          break;
        }
        case 'start_conversation': {
          const convId = str((step as { conversationId?: unknown }).conversationId).trim();
          if (!convId) {
            problems.push({ field: `${stepAt}.conversationId`, message: 'Pick a conversation to play' });
          } else if (!conversationIds.has(convId)) {
            problems.push({ field: `${stepAt}.conversationId`, message: `This scene has no conversation "${convId}"` });
          }
          break;
        }
        case 'wait': {
          const seconds = (step as { seconds?: unknown }).seconds;
          if (!isIntInRange(seconds, 1, IW_MAX_WAIT_SECONDS)) {
            problems.push({ field: `${stepAt}.seconds`, message: `Wait must be 1–${IW_MAX_WAIT_SECONDS} whole seconds` });
          }
          break;
        }
        // Every step aimed at a person — move toward, move away, turn — asks the same
        // question, so it gets one check.
        case 'walk_to_actor':
        case 'walk_away_from':
        case 'face': {
          const actor = str((step as { actor?: unknown }).actor).trim();
          if (!actor) {
            problems.push({ field: `${stepAt}.actor`, message: 'Pick who this is aimed at' });
          } else if (actor === selfNpcId) {
            // Cheap to author by accident from a dropdown, and a walk would deadlock.
            problems.push({ field: `${stepAt}.actor`, message: 'An NPC cannot aim this at itself' });
          } else if (!actorIds.has(actor)) {
            problems.push({ field: `${stepAt}.actor`, message: `"${actor}" is not in this scene` });
          }
          break;
        }
        case 'wait_for_response': {
          // Anything after it would fire while the learner is still composing — the one
          // thing § 14 Q29 forbids the world from doing.
          if (t !== steps.length - 1) {
            problems.push({
              field: `${stepAt}.kind`,
              message: 'Waiting for the learner must be the last step — nothing may run while they are answering',
            });
          }
          break;
        }
      }
    });
  });

  return problems;
}

/**
 * Conversations are played back by the engine with NO model calls, so an author error here
 * is a broken playback rather than an off-character line: a speaker who is not in the scene
 * simply never says their turn.
 *
 * ONLY THE CAST MAY SPEAK — and the companion is not cast (2026-09-05). He walks in with the
 * learner, so he is never a voice the learner OVERHEARS; an exchange he is part of is one he
 * is having, which is the live NPC path, not this authored playback. Casting him is refused
 * in the cast loop, and this is the other half of the same rule.
 */
function validateConversations(
  conversations: IWConversation[] | undefined,
  castIds: Set<string>,
): IWSceneProblem[] {
  const problems: IWSceneProblem[] = [];
  if (!Array.isArray(conversations)) {
    return conversations === undefined ? [] : [{ field: 'conversations', message: 'Conversations must be a list' }];
  }
  if (conversations.length > IW_MAX_CONVERSATIONS) {
    problems.push({ field: 'conversations', message: `At most ${IW_MAX_CONVERSATIONS} conversations` });
  }

  const seenIds = new Set<string>();
  conversations.forEach((conv, i) => {
    const at = `conversations[${i}]`;
    const id = str(conv?.id);
    if (!id) problems.push({ field: `${at}.id`, message: 'Conversation needs an id' });
    else if (seenIds.has(id)) problems.push({ field: `${at}.id`, message: `Duplicate conversation id "${id}"` });
    seenIds.add(id);

    const turns = Array.isArray(conv?.turns) ? conv.turns : [];
    if (turns.length === 0) {
      problems.push({ field: `${at}.turns`, message: 'A conversation needs at least one line' });
    }
    if (turns.length > IW_MAX_CONVERSATION_TURNS) {
      problems.push({ field: `${at}.turns`, message: `At most ${IW_MAX_CONVERSATION_TURNS} lines` });
    }

    turns.forEach((turn, t) => {
      const turnAt = `${at}.turns[${t}]`;
      const speakerId = str(turn?.npcId);
      if (!castIds.has(speakerId)) {
        problems.push({
          field: `${turnAt}.npcId`,
          message: `"${speakerId || '(blank)'}" is not in this scene and cannot speak here`,
        });
      }
      const text = str(turn?.text);
      if (!text) problems.push({ field: `${turnAt}.text`, message: 'Blank line' });
      else if (text.length > IW_MAX_CONVERSATION_LINE_LENGTH) {
        problems.push({
          field: `${turnAt}.text`,
          message: `Line must be ≤ ${IW_MAX_CONVERSATION_LINE_LENGTH} characters`,
        });
      }
    });
  });

  return problems;
}
