import {
  IW_ACTION_STEP_KINDS,
  IW_ACTOR_COMPANION,
  IW_ACTOR_PLAYER,
  IW_FACINGS,
  IW_MAX_ACTION_COMMENT_LENGTH,
  IW_MAX_ACTION_INSTRUCTION_LENGTH,
  IW_MAX_ACTION_NAME_LENGTH,
  IW_MAX_ACTION_STEPS,
  IW_MAX_ACTION_WHEN_LENGTH,
  IW_MAX_CAST,
  IW_MAX_COMPLICATIONS,
  IW_MAX_COMPLICATION_LENGTH,
  IW_MAX_EVENTS,
  IW_MAX_EVENT_DELAY_SECONDS,
  IW_MAX_EVENT_LENGTH,
  IW_MAX_INTERACTION_STEPS,
  IW_MAX_POPUP_CAPTION_LENGTH,
  IW_POPUP_IMAGE_ID,
  IW_INTERACTION_STEP_KINDS,
  IW_MAX_CONVERSATIONS,
  IW_MAX_CONVERSATION_LINE_LENGTH,
  IW_MAX_CONVERSATION_TURNS,
  IW_MAX_PLACE_TAG_LENGTH,
  IW_MAX_UNLOCK_CUES,
  IW_MAX_NPC_ACTIONS,
  IW_MAX_SCENE_DIM,
  IW_MAX_SCENE_NAME_LENGTH,
  IW_MAX_SCENE_NOTES_LENGTH,
  IW_MAX_WAIT_SECONDS,
  IW_MIN_SCENE_DIM,
  type IWActionStep,
  type IWActionStepKind,
  type IWConversation,
  type IWFacing,
  type IWInteractionStep,
  type IWInteractionStepKind,
  type IWSceneInteractions,
  type IWNpcAction,
  type IWSceneEvent,
  type IWScene,
  type IWSceneCastMember,
  type IWSceneLayout,
  type IWSelectable,
  scenePlaces,
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
 * WARNINGS, NOT REFUSALS (2026-09-05). § 12 phase 1's kill condition is "an author cannot
 * assemble a working scene without engineering help", and a validator that REFUSES a save is
 * itself a way to hit it: a scene is authored over several sittings, and a half-built one —
 * a completer with no action yet, a place named but not placed — is a normal intermediate
 * state, not a mistake. So almost everything here is `severity: 'warning'`: it is reported
 * against the field, shown in the editor, and the scene still saves. The author, not the
 * validator, decides when the scene is finished.
 *
 * WHAT STILL BLOCKS (`severity: 'error'`) is only what would make the WRITE itself wrong —
 * a value the row physically cannot hold or that would corrupt reads of it: a language that
 * is neither zh nor es (every scene read is language-scoped), a blank or over-long name (the
 * NOT NULL VARCHAR(120) the author picks the scene by), board dimensions or start cells that
 * are not whole numbers in range (INTEGER columns), and a layout that is not an object.
 * Everything else — an unresolvable NPC id, a completer who is not cast, a walk toward a
 * place nobody tagged — is a scene that saves fine and misbehaves only if it is PUBLISHED
 * and played, which is a later decision the author makes deliberately.
 *
 * NPC IDS ARE CHECKED AGAINST CODE, NOT A TABLE. `npcById` is the only resolver
 * (migration 158's header); the database cannot enforce a reference into a code constant,
 * which is why the same check appears here (on write) and in `validateStoredNpcIds` (at
 * startup, for rows written before an NPC was deleted).
 *
 * Referenced by: server/services/ImmersiveWorldSceneService.ts,
 * server/__tests__/iwSceneValidation.test.ts.
 * Documented in docs/IMMERSIVE_WORLD.md § 12 phase 1d.
 */

/** One problem with a submitted scene, addressed to the author. */
export interface IWSceneProblem {
  /** Dotted path into the payload ("npcCast[2].npcId"), so the editor can highlight a field. */
  field: string;
  message: string;
  /**
   * How hard this bites. OMITTED MEANS 'warning' — the overwhelming majority — so a rule is
   * blocking only where it deliberately says so, and adding a new rule cannot accidentally
   * start refusing saves.
   */
  severity?: 'error' | 'warning';
}

/** Does this problem refuse the save? Only structural ones do (see the header). */
export function isBlocking(problem: IWSceneProblem): boolean {
  return problem.severity === 'error';
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
 * Validate one scene payload end to end and return every problem found, each tagged with a
 * severity — a handful of blocking `'error'`s and, for everything else, warnings the caller
 * shows and saves through anyway (see the header).
 *
 * Returns ALL problems rather than throwing on the first, because an author fixing a scene
 * one complaint per save round-trip is the tool being annoying in exactly the way phase 1's
 * kill condition describes.
 */
export function validateScene(scene: IWScene): IWSceneProblem[] {
  const problems: IWSceneProblem[] = [];
  /** Report against a field WITHOUT refusing the save — the default (see the header). */
  const add = (field: string, message: string) => problems.push({ field, message });
  /** Report against a field AND refuse the save. Structural faults only. */
  const block = (field: string, message: string) =>
    problems.push({ field, message, severity: 'error' });

  // ── Identity ──────────────────────────────────────────────────────────────
  // BLOCKING: the column is VARCHAR(10) NOT NULL and every scene read is scoped by it, so a
  // third value would write a row nothing ever lists again.
  if (scene.language !== 'zh' && scene.language !== 'es') {
    block('language', 'Language must be zh or es');
  }
  // BLOCKING: VARCHAR(120) NOT NULL, and the name is the author's only handle on the scene
  // in the load list — an unnamed save is a scene they cannot find their way back to.
  const name = str(scene.name);
  if (!name) block('name', 'A scene needs a name');
  else if (name.length > IW_MAX_SCENE_NAME_LENGTH) {
    block('name', `Name must be ≤ ${IW_MAX_SCENE_NAME_LENGTH} characters`);
  }

  // The scene brief (migration 160). Only its LENGTH is checked, and only as a warning: it
  // is prose for a model, so there is nothing else here that could be true or false about it.
  // An empty brief is fine — the scene simply tells the model nothing extra.
  if (str(scene.sceneNotes).length > IW_MAX_SCENE_NOTES_LENGTH) {
    add('sceneNotes', `Scene notes must be ≤ ${IW_MAX_SCENE_NOTES_LENGTH} characters`);
  }

  // ── Board geometry ────────────────────────────────────────────────────────
  // BLOCKING: INTEGER columns, and the whole editor (and every cell key in the layout) is
  // meaningless without a board to be inside.
  const dimsOk =
    isIntInRange(scene.width, IW_MIN_SCENE_DIM, IW_MAX_SCENE_DIM) &&
    isIntInRange(scene.height, IW_MIN_SCENE_DIM, IW_MAX_SCENE_DIM);
  if (!dimsOk) {
    block('width', `Board must be between ${IW_MIN_SCENE_DIM} and ${IW_MAX_SCENE_DIM} cells on each side`);
  }

  // Every later cell check needs a board to be inside, so they only run once dims are sane.
  const onBoard = (col: unknown, row: unknown): boolean =>
    dimsOk && isIntInRange(col, 0, scene.width - 1) && isIntInRange(row, 0, scene.height - 1);

  // The two starts split by severity, because the two failures are different in kind: a
  // non-integer cannot go into an INTEGER column at all (blocking), while an integer that
  // happens to sit off a shrunken board is an ordinary half-finished edit (warning) — an
  // author who narrows the board before re-placing the bodies is mid-task, not wrong.
  const wholeCell = (col: unknown, row: unknown): boolean =>
    Number.isInteger(col as number) && Number.isInteger(row as number);

  if (!wholeCell(scene.playerStartCol, scene.playerStartRow)) {
    block('playerStartCol', 'The player start cell must be whole numbers');
  } else if (!onBoard(scene.playerStartCol, scene.playerStartRow)) {
    add('playerStartCol', 'The player start cell is off the board');
  }
  if (!wholeCell(scene.companionStartCol, scene.companionStartRow)) {
    block('companionStartCol', 'The companion start cell must be whole numbers');
  } else if (!onBoard(scene.companionStartCol, scene.companionStartRow)) {
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
  const placeTags = new Set<string>(
    Object.keys(scenePlaces(scene.layout))
      .filter((t) => !!t.trim())
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
  // The third thing an authored action can point at (migration 161), gathered the same way:
  // a `schedule_event` step names one of the scene's OWN events, never a free-text one.
  const eventIds = new Set<string>(
    (Array.isArray(scene.events) ? scene.events : [])
      .map((e) => str(e?.id)).filter(Boolean),
  );
  // The fourth (2026-09-06): the CUES a dependent action or conversation may be unlocked by.
  // Complications and events are one pool here because "has this happened yet" is the same
  // question about both — an `unlockedBy` entry does not care which list its cue came from.
  // Gathered up front rather than in the complication loop below, because the CAST is
  // validated first and its actions are what reference the cues.
  const complicationIds = new Set<string>(
    (Array.isArray(scene.complications) ? scene.complications : [])
      .map((c) => str(c?.id)).filter(Boolean),
  );
  const cueIds = new Set<string>([...complicationIds, ...eventIds]);
  // ONE POOL MEANS IDS MUST NOT COLLIDE ACROSS THE TWO LISTS. `complications` and `events`
  // each police their own duplicates, and neither could ever see the other's — but an
  // `unlockedBy` naming an id both lists define cannot say which one it is waiting for.
  // Reported once, against `events`, because the event lists were authored second.
  for (const id of eventIds) {
    if (complicationIds.has(id)) {
      add('events', `"${id}" is the id of both an event and a complication — a dependent action cannot say which it is waiting for`);
    }
  }

  // What INTERACTIONS reach, gathered before the cast loop because two rules below need it
  // and neither can wait for `validateInteractions` (which runs last, by design, since it is
  // the only check that needs everything else resolved).
  //
  // A `npc_action` reference is keyed by the PAIR, not by the action id: an action id is
  // unique only within an NPC, so a bare id set would report 王婶's interaction-only action as
  // reachable because 小陈 happens to have an `act3` too.
  const interactionSteps: IWInteractionStep[] = Object.values(
    (scene.interactions && typeof scene.interactions === 'object' && !Array.isArray(scene.interactions))
      ? scene.interactions : {},
  ).flatMap((steps) => (Array.isArray(steps) ? steps : []));
  // Every conversation a SCRIPT starts — from an authored action's step or an interaction's.
  // Used to tell a conversation with no way in from one that is merely not spontaneous.
  const startedConversationIds = new Set<string>([
    ...cast.flatMap((m) => (Array.isArray(m?.actions) ? m.actions : []))
      .flatMap((a) => (Array.isArray(a?.steps) ? a.steps : []))
      .filter((st) => str(st?.kind) === 'start_conversation')
      .map((st) => str((st as { conversationId?: unknown }).conversationId)),
    ...interactionSteps
      .filter((st) => str(st?.kind) === 'start_conversation')
      .map((st) => str((st as { conversationId?: unknown }).conversationId)),
  ].filter(Boolean));
  const interactionTriggeredActions = new Set<string>(
    interactionSteps
      .filter((st) => str(st?.kind) === 'npc_action')
      .map((st) => `${str((st as { npcId?: unknown }).npcId)}::${str((st as { actionId?: unknown }).actionId)}`),
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
      member?.actions, at, str(member?.npcId), placeTags, actorIds, conversationIds, eventIds,
      cueIds, interactionTriggeredActions,
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

  // ── Authored events (migration 161) ───────────────────────────────────────
  // Checked exactly like complications — same shape, same one-line-fact role — plus the one
  // field a complication has no equivalent of: `atStartSeconds`, the scene arming its own
  // event. Duplicate ids matter here for two reasons, not one: a run stores what fired, AND
  // a `schedule_event` step names an event by id, so a duplicate makes the step ambiguous.
  problems.push(...validateEvents(scene.events));

  // ── Authored overheard conversations (§ 14 Q6) ────────────────────────────
  // Speakers are the cast PLUS the companion: he is not cast (he is placed by the scene's
  // own companionStart cell, not by an entry), but he is present in every scene, so an
  // exchange between him and an NPC is one the learner can walk up on like any other.
  const speakerIds = new Set<string>(seenNpcIds);
  if (companionId) speakerIds.add(companionId);
  // Action NAMES, per NPC — a selectable conversation's title is offered beside them and
  // must not collide (see `turnOffers.buildTurnOffers`, which resolves a tie in the action's
  // favour rather than coin-flipping in front of a player).
  const actionNamesByNpc = new Map<string, Set<string>>();
  for (const member of cast) {
    const npcId = str(member?.npcId);
    if (!npcId) continue;
    const names = actionNamesByNpc.get(npcId) ?? new Set<string>();
    for (const action of Array.isArray(member?.actions) ? member.actions : []) {
      const name = str(action?.name);
      if (name) names.add(name);
    }
    actionNamesByNpc.set(npcId, names);
  }
  problems.push(...validateConversations(
    scene.conversations, speakerIds, cueIds, startedConversationIds, actionNamesByNpc,
  ));

  // ── Place interactions (migration 162, § 14 Q43) ──────────────────────────
  // Runs LAST because it is the only check that needs everything else resolved at once: a
  // step names a place, an NPC, one of that NPC's own actions, a conversation and an event.
  problems.push(...validateInteractions(
    scene.interactions,
    scenePlaces(scene.layout),
    cast,
    conversationIds,
    eventIds,
  ));

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
  // BLOCKING: the JSONB column holds an object, and every mask read below assumes one.
  if (!layout || typeof layout !== 'object') {
    return [{ field: 'layout', message: 'Layout must be an object', severity: 'error' }];
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

  // Named places (§ 14 Q42). Read through `scenePlaces` rather than off `layout.places`, so
  // a row still carrying the pre-2026-09-06 `locations` key is validated against its real
  // places rather than against an empty set (which would flag every `walk_to_tag` in it).
  // Reported against `layout.places` either way — that is the field the editor renders.
  const places = layout.places ?? layout.locations;
  // Keyed by TAG, so a tag names exactly one cell; several tags
  // may legitimately name the SAME cell. A tag whose cell does not parse is one the author
  // named but never placed — the empty-string sentinel the editor stores — and it is
  // rejected here so a `walk_to_tag` can never point at a place with no destination.
  if (places && typeof places === 'object') {
    const entries = Object.entries(places);
    for (const [tag, cell] of entries) {
      const label = tag.trim() ? `“${tag}”` : 'A place';
      if (!tag.trim()) {
        problems.push({ field: 'layout.places', message: 'A place has no name' });
      } else if (tag.length > IW_MAX_PLACE_TAG_LENGTH) {
        problems.push({
          field: 'layout.places',
          message: `Place names must be ≤ ${IW_MAX_PLACE_TAG_LENGTH} characters`,
        });
      }
      const parsed = typeof cell === 'string' ? parseCellKey(cell) : null;
      if (!parsed) {
        problems.push({ field: 'layout.places', message: `${label} is not on the board yet` });
      } else if (dimsOk && (parsed.col >= width || parsed.row >= height)) {
        problems.push({ field: 'layout.places', message: `${label} is off the board` });
      }
    }
  } else if (places !== undefined) {
    problems.push({ field: 'layout.places', message: 'Places must be an object keyed by place name' });
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
  eventIds: Set<string>,
  cueIds: Set<string>,
  interactionTriggeredActions: Set<string>,
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

    // `when` / `urgent` / `unlockedBy` are shared with conversations — see the helper.
    problems.push(...validateSelectable(action, actionAt, cueIds));

    // ── The action-only half of selectability (2026-09-06) ──────────────────
    if (action?.interactionOnly) {
      // Removing an action from the model's candidate list without giving it another way in
      // is the same silent failure every other rule in this function guards: nothing happens,
      // and nothing says why. Checked as the PAIR, so another NPC's identically-named action
      // cannot satisfy it.
      if (!interactionTriggeredActions.has(`${selfNpcId}::${id}`)) {
        problems.push({
          field: `${actionAt}.interactionOnly`,
          message: 'Nothing can trigger this: it is hidden from the model, and no place interaction performs it',
        });
      }
      // Both combinations are contradictions rather than mere redundancies, which is why they
      // are worth a message: they say the author believes this action is still on offer.
      if (action?.urgent) {
        problems.push({
          field: `${actionAt}.urgent`,
          message: 'Interaction-only actions are never offered to the model, so urgency has nothing to act on',
        });
      }
      if (Array.isArray(action?.unlockedBy) && action.unlockedBy.length > 0) {
        problems.push({
          field: `${actionAt}.unlockedBy`,
          message: 'Interaction-only actions are never offered to the model, so unlocking them changes nothing',
        });
      }
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
            problems.push({ field: `${stepAt}.tag`, message: `This scene has no place named "${tag}"` });
          }
          break;
        }
        case 'ai_walk': {
          // Only the BRIEF is checkable here. The destination is chosen at run time from the
          // scene's places and bodies, so there is no authored referent to verify — which is
          // the whole point of the step. What CAN go wrong at authoring time is an empty or
          // runaway instruction, and a scene with nothing to choose between: with no named
          // places the model's only options are the bodies, which is legal but almost never
          // what the author meant by "walk to the appropriate place".
          const instruction = str((step as { instruction?: unknown }).instruction);
          if (!instruction.trim()) {
            problems.push({ field: `${stepAt}.instruction`, message: 'Describe where they should go — the model picks from this scene’s places and people.' });
          } else if (instruction.length > IW_MAX_ACTION_INSTRUCTION_LENGTH) {
            problems.push({ field: `${stepAt}.instruction`, message: `Must be ≤ ${IW_MAX_ACTION_INSTRUCTION_LENGTH} characters` });
          }
          if (tags.size === 0) {
            problems.push({ field: `${stepAt}.instruction`, message: 'This scene has no named places, so the model can only choose a person to walk to' });
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
        case 'schedule_event': {
          // Arms a timer and moves on — it does NOT hold the NPC, which is what `wait` is
          // for. Both halves are checked: an event that exists, and a delay the engine can
          // actually hold. A missing event is the silent failure this whole function exists
          // to catch — the script would run to the end and the world would simply never do
          // the thing the author was counting on.
          const eventId = str((step as { eventId?: unknown }).eventId).trim();
          if (!eventId) {
            problems.push({ field: `${stepAt}.eventId`, message: 'Pick an event to schedule' });
          } else if (!eventIds.has(eventId)) {
            problems.push({ field: `${stepAt}.eventId`, message: `This scene has no event "${eventId}"` });
          }
          const delay = (step as { seconds?: unknown }).seconds;
          if (!isIntInRange(delay, 0, IW_MAX_EVENT_DELAY_SECONDS)) {
            problems.push({
              field: `${stepAt}.seconds`,
              message: `Delay must be 0–${IW_MAX_EVENT_DELAY_SECONDS} whole seconds`,
            });
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
 * The three fields shared by everything a model may CHOOSE (2026-09-06) — an NPC's authored
 * action, and a selectable overheard conversation.
 *
 * ONE FUNCTION RATHER THAN TWO COPIES, for the same reason `IWSelectable` is one interface:
 * the rules are not merely similar, they are the same rules about the same question. The
 * fields each type does NOT share — an action's `interactionOnly`, a conversation's
 * `selectable` — are checked at their own call sites, because their meanings are mirror
 * images rather than one shape.
 *
 * `cueIds` is the scene's complications and events in one set. A cue naming neither is the
 * silent failure this whole file exists to catch: a dependent action whose gate can never
 * open is an action the learner will simply never be offered, with nothing on screen to say
 * so — strictly worse than one that misfires, because there is no symptom to chase.
 */
function validateSelectable(
  sel: IWSelectable | undefined,
  at: string,
  cueIds: Set<string>,
): IWSceneProblem[] {
  const problems: IWSceneProblem[] = [];

  if (str(sel?.when).length > IW_MAX_ACTION_WHEN_LENGTH) {
    problems.push({ field: `${at}.when`, message: `Guidance must be ≤ ${IW_MAX_ACTION_WHEN_LENGTH} characters` });
  }

  const cues = sel?.unlockedBy;
  if (cues === undefined || cues === null) return problems;
  if (!Array.isArray(cues)) {
    problems.push({ field: `${at}.unlockedBy`, message: 'Unlocking cues must be a list' });
    return problems;
  }
  if (cues.length > IW_MAX_UNLOCK_CUES) {
    problems.push({ field: `${at}.unlockedBy`, message: `At most ${IW_MAX_UNLOCK_CUES} unlocking cues` });
  }
  const seen = new Set<string>();
  cues.forEach((cue) => {
    const id = str(cue);
    if (!id) {
      problems.push({ field: `${at}.unlockedBy`, message: 'Pick the complication or event that unlocks this' });
    } else if (!cueIds.has(id)) {
      problems.push({ field: `${at}.unlockedBy`, message: `This scene has no complication or event "${id}"` });
    } else if (seen.has(id)) {
      // Harmless at run time (the gate is an ANY over a set), but it is always a mis-click,
      // and a list showing the same cue twice reads as a rule the author did not write.
      problems.push({ field: `${at}.unlockedBy`, message: `"${id}" is listed twice` });
    }
    seen.add(id);
  });

  return problems;
}

/**
 * The scene's authored EVENT pool (migration 161).
 *
 * An event is a complication with a different trigger, so this is deliberately the same set of
 * checks as the complication loop above — plus `atStartSeconds`, which a complication has no
 * equivalent of because nothing schedules a complication.
 *
 * NOTE WHAT IS NOT CHECKED: whether anything ever fires the event. An event with no
 * `atStartSeconds` and no `schedule_event` step pointing at it is dead weight, but it is also
 * exactly what a half-written scene looks like — the pool is usually authored before the
 * scripts that arm it. Flagging it would fire on every scene in progress.
 */
function validateEvents(events: IWSceneEvent[] | undefined): IWSceneProblem[] {
  const problems: IWSceneProblem[] = [];
  if (!Array.isArray(events)) {
    return events === undefined ? [] : [{ field: 'events', message: 'Events must be a list' }];
  }
  if (events.length > IW_MAX_EVENTS) {
    problems.push({ field: 'events', message: `At most ${IW_MAX_EVENTS} events` });
  }

  const seenIds = new Set<string>();
  events.forEach((event, i) => {
    const at = `events[${i}]`;
    const id = str(event?.id);
    if (!id) problems.push({ field: `${at}.id`, message: 'Event needs an id' });
    else if (seenIds.has(id)) problems.push({ field: `${at}.id`, message: `Duplicate event id "${id}"` });
    seenIds.add(id);

    const description = str(event?.description);
    if (!description) problems.push({ field: `${at}.description`, message: 'Event needs a description' });
    else if (description.length > IW_MAX_EVENT_LENGTH) {
      problems.push({
        field: `${at}.description`,
        message: `Description must be ≤ ${IW_MAX_EVENT_LENGTH} characters`,
      });
    }

    // Omitted means "only a script arms this". Present means the scene arms it itself, and 0
    // is a legitimate value — the first legal moment after the scene opens.
    const atStart = event?.atStartSeconds;
    if (atStart !== undefined && atStart !== null
        && !isIntInRange(atStart, 0, IW_MAX_EVENT_DELAY_SECONDS)) {
      problems.push({
        field: `${at}.atStartSeconds`,
        message: `Opening delay must be 0–${IW_MAX_EVENT_DELAY_SECONDS} whole seconds`,
      });
    }
  });

  return problems;
}

/**
 * Conversations are played back by the engine with NO model calls, so an author error here
 * is a broken playback rather than an off-character line: a speaker who is not in the scene
 * simply never says their turn.
 *
 * WHO MAY SPEAK: the cast, PLUS the companion (2026-09-05). The companion is still not
 * castable — he is placed by the scene's own companionStart cell rather than by a cast
 * entry — but he is on the board in every scene, so an authored exchange between him and a
 * cast member is a perfectly ordinary thing for the learner to overhear. The caller passes
 * the union; `speakerIds` is not the cast set.
 */
function validateConversations(
  conversations: IWConversation[] | undefined,
  speakerIds: Set<string>,
  cueIds: Set<string>,
  startedConversationIds: Set<string>,
  actionNamesByNpc: Map<string, Set<string>>,
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

    // `when` / `urgent` / `unlockedBy` — the same three fields an action has, checked by the
    // same helper (2026-09-06).
    problems.push(...validateSelectable(conv, at, cueIds));

    const turns = Array.isArray(conv?.turns) ? conv.turns : [];
    if (turns.length === 0) {
      problems.push({ field: `${at}.turns`, message: 'A conversation needs at least one line' });
    }

    // ── The conversation-only half of selectability (2026-09-06) ────────────
    // A selectable conversation is offered to whoever speaks FIRST, so both halves of that
    // sentence have to exist: somebody has to speak first, and the model has to have a handle
    // to choose it by.
    if (conv?.selectable) {
      const owner = str(turns[0]?.npcId);
      if (!owner) {
        problems.push({
          field: `${at}.selectable`,
          message: 'Write the first line before making this choosable — whoever speaks first is who may start it',
        });
      }
      const title = str(conv?.title);
      if (!title) {
        // The one field whose AUDIENCE changes with this flag: an author-facing label becomes
        // the thing the model picks by, exactly like an action's name.
        problems.push({
          field: `${at}.title`,
          message: 'A choosable conversation needs a title — it is what the NPC chooses it by',
        });
      } else if (owner && actionNamesByNpc.get(owner)?.has(title)) {
        // Both are offered to the SAME NPC as one flat list of names, and the model answers
        // with a name — so two identical strings are a choice the engine cannot read. It
        // resolves deterministically in the action's favour at runtime, which means the
        // conversation silently never plays; better to say so while it can still be renamed.
        problems.push({
          field: `${at}.title`,
          message: `"${title}" is also the name of one of this NPC's actions — the action wins and this would never play`,
        });
      }
    } else if (id && !startedConversationIds.has(id)) {
      // NOT SELECTABLE AND NOT STARTED BY ANYTHING = unreachable. This is newly worth saying:
      // before `selectable` existed there was exactly one way in, and a conversation waiting
      // for its `start_conversation` step to be authored was an ordinary half-built scene. Now
      // there are two ways in and neither is taken, which is a scene that will never play a
      // conversation somebody wrote — the failure prod's own "Welcoming back a regular" has.
      problems.push({
        field: `${at}.selectable`,
        message: 'Nothing plays this: no action or interaction starts it, and it is not choosable',
      });
    }
    if (turns.length > IW_MAX_CONVERSATION_TURNS) {
      problems.push({ field: `${at}.turns`, message: `At most ${IW_MAX_CONVERSATION_TURNS} lines` });
    }

    turns.forEach((turn, t) => {
      const turnAt = `${at}.turns[${t}]`;
      const speakerId = str(turn?.npcId);
      if (!speakerIds.has(speakerId)) {
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

/**
 * Place INTERACTIONS (migration 162, § 14 Q43) — what runs when the learner walks up to a
 * named place.
 *
 * THE RULES ARE THE SAME KIND AS `validateNpcActions`'s, and for the same reason: every one
 * of them is a way to author a poke that would fail SILENTLY at playback. A learner who walks
 * up to a thing and gets nothing cannot tell a broken script from an inert prop, so an
 * interaction that points at a deleted action or a place nobody placed is worth saying out
 * loud at authoring time.
 *
 * ONE RULE IS THIS FUNCTION'S OWN: **the tag must be a place the scene defines.** An
 * interaction is a property OF a place (see {@link IWSceneInteractions}); keyed by a tag
 * nothing names, it is a script with no trigger. The draft hook's cascades normally make this
 * unreachable — deleting a place deletes its interaction — so a hit here means a hand-edited
 * payload or an older row.
 *
 * ⚠️ **TWO INTERACTIVE TAGS ON ONE CELL IS LEGAL** (decided 2026-09-05, by the author, over a
 * proposed refusal). Several tags may already name one cell, and where two of them carry
 * scripts, **walking there runs both** — so this is a composition, not an ambiguity, and there
 * is nothing here to complain about. What it obliges the runtime to fix is ORDER: see § 5.4a.
 *
 * `cast` is passed whole rather than as a set of ids, because `npc_action` has to check the
 * pair — that the NPC is here AND that this action is one of theirs. An action id is unique
 * only within an NPC, so checking them separately would accept 王婶 performing 小陈's script.
 */
function validateInteractions(
  interactions: IWSceneInteractions | undefined,
  places: Record<string, string>,
  cast: IWSceneCastMember[],
  conversationIds: Set<string>,
  eventIds: Set<string>,
): IWSceneProblem[] {
  const problems: IWSceneProblem[] = [];
  if (interactions === undefined || interactions === null) return problems;
  if (typeof interactions !== 'object' || Array.isArray(interactions)) {
    return [{ field: 'interactions', message: 'Interactions must be an object keyed by place name' }];
  }

  for (const [tag, steps] of Object.entries(interactions)) {
    const at = `interactions.${tag}`;
    const label = tag.trim() ? `“${tag}”` : 'A place';

    if (!(tag in places)) {
      problems.push({ field: at, message: `${label} is not a place in this scene, so nothing can trigger this` });
    }
    // NOTHING is checked about the tag's CELL. Two interactive tags on one cell both run
    // (see the header), and an unplaced tag is already `layout.places`'s complaint.

    if (!Array.isArray(steps)) {
      problems.push({ field: at, message: `${label}'s interaction must be a list of steps` });
      continue;
    }
    // An EMPTY script is not an error the way an empty action is. Deleting the last step of
    // an interaction is how an author turns a place back into an ordinary walk destination,
    // and the editor drops the entry when they do — so an empty list here is a transient
    // shape, not a mistake to shout about.
    if (steps.length > IW_MAX_INTERACTION_STEPS) {
      problems.push({ field: at, message: `At most ${IW_MAX_INTERACTION_STEPS} steps per interaction` });
    }

    steps.forEach((step: IWInteractionStep, i: number) => {
      const stepAt = `${at}.steps[${i}]`;
      const kind = str((step as { kind?: unknown })?.kind) as IWInteractionStepKind;
      if (!IW_INTERACTION_STEP_KINDS.includes(kind)) {
        problems.push({ field: `${stepAt}.kind`, message: `"${kind || '(blank)'}" is not an interaction step` });
        return;
      }

      switch (kind) {
        case 'popup': {
          // The catalogue is CLIENT art (src/assets/iw-popups/) and the server cannot see it,
          // so only the SHAPE of the id is checkable here — which is enough to stop a path or
          // a URL reaching the column. A stem that no longer resolves is an authoring trap the
          // editor shows as a missing picture (§ 14 Q42 sub-answer 3: traps are the author's).
          const imageId = str((step as { imageId?: unknown }).imageId);
          if (!imageId) {
            problems.push({ field: `${stepAt}.imageId`, message: 'Pick a picture to show' });
          } else if (!IW_POPUP_IMAGE_ID.test(imageId)) {
            problems.push({ field: `${stepAt}.imageId`, message: `"${imageId}" is not a picture name` });
          }
          const caption = str((step as { caption?: unknown }).caption);
          if (caption.length > IW_MAX_POPUP_CAPTION_LENGTH) {
            problems.push({
              field: `${stepAt}.caption`,
              message: `Caption must be ≤ ${IW_MAX_POPUP_CAPTION_LENGTH} characters`,
            });
          }
          break;
        }
        case 'npc_action': {
          // Checked as a PAIR: an action id is unique only within an NPC, so verifying the two
          // separately would accept one NPC performing another's script.
          const npcId = str((step as { npcId?: unknown }).npcId);
          const actionId = str((step as { actionId?: unknown }).actionId);
          const member = cast.find((m) => str(m?.npcId) === npcId);
          if (!npcId) {
            problems.push({ field: `${stepAt}.npcId`, message: 'Pick who performs this' });
          } else if (!member) {
            problems.push({ field: `${stepAt}.npcId`, message: `"${npcId}" is not in this scene` });
          }
          if (!actionId) {
            problems.push({ field: `${stepAt}.actionId`, message: 'Pick the action to perform' });
          } else if (member && !(member.actions ?? []).some((a) => str(a?.id) === actionId)) {
            problems.push({
              field: `${stepAt}.actionId`,
              message: `${npcId} has no action "${actionId}" any more`,
            });
          }
          break;
        }
        case 'start_conversation': {
          const convId = str((step as { conversationId?: unknown }).conversationId);
          if (!convId) {
            problems.push({ field: `${stepAt}.conversationId`, message: 'Pick a conversation to play' });
          } else if (!conversationIds.has(convId)) {
            problems.push({ field: `${stepAt}.conversationId`, message: `This scene has no conversation "${convId}"` });
          }
          break;
        }
        case 'schedule_event': {
          // Identical to the authored-action step of the same name, down to the delay bounds:
          // an interaction arms the same queue at the same earliest-legal-moment semantics.
          const eventId = str((step as { eventId?: unknown }).eventId);
          if (!eventId) {
            problems.push({ field: `${stepAt}.eventId`, message: 'Pick an event to schedule' });
          } else if (!eventIds.has(eventId)) {
            problems.push({ field: `${stepAt}.eventId`, message: `This scene has no event "${eventId}"` });
          }
          const delay = (step as { seconds?: unknown }).seconds;
          if (!isIntInRange(delay, 0, IW_MAX_EVENT_DELAY_SECONDS)) {
            problems.push({
              field: `${stepAt}.seconds`,
              message: `Delay must be 0–${IW_MAX_EVENT_DELAY_SECONDS} whole seconds`,
            });
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
      }
    });
  }

  return problems;
}
