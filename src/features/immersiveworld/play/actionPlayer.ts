import type {
  IWActionStep, IWConversation, IWNpcAction, IWSceneCastMember,
} from '../../../../server/contracts/iw';
import { IW_ACTOR_COMPANION, IW_ACTOR_PLAYER } from '../../../../server/contracts/iw';
import { approachCells, cellKey, planScenePath, resolvePlaceTarget, type SceneGraph } from '../../../engine/iw/sceneGraph';

/**
 * iw action player — turning one AUTHORED action (§ 14 Q42) into things the host can do.
 *
 * LAYER: feature logic, and pure. It is NOT in `src/engine/iw/` even though it looks like it
 * belongs there, and the reason is the engine's own purity rule: an engine module may not
 * import the server contract (`enginePurity.test.ts` enforces it, and `sceneGraph.ts` declares
 * its own `SceneBoard` rather than importing `IWSceneLayout` for exactly this reason). This
 * module's whole input IS the contract — `IWActionStep` is a ten-member discriminated union —
 * so re-declaring it locally would be a copy that drifts the first time a step kind is added.
 * Interpreting authored data is a feature concern; walking a graph is an engine one.
 *
 * No clock, no rAF, no React. It answers one question at a time —
 * *given this step and where everybody is standing RIGHT NOW, what is the next instruction?* —
 * and the host executes it and comes back for the next.
 *
 * ⚠️ **ONE STEP AT A TIME, RESOLVED LATE, AND THAT IS THE WHOLE DESIGN.** Compiling a whole
 * action up front would be simpler and would be wrong: an action reads *walk to the counter,
 * say a line, then walk to the customer*, and by the time the third step runs the customer has
 * moved. Resolving each step against the current world is what makes a script describe
 * INTENTIONS rather than a recorded route.
 *
 * ⚠️ **A STEP THAT CANNOT BE RESOLVED IS SKIPPED, NOT THROWN.** The input is authored data out
 * of a jsonb column — a tag that was renamed, an actor who is not in this scene, a walk into a
 * pocket nothing can reach. Every one of those is a scene to fix, not a runtime to take down
 * in front of a learner, so they come back as {@link IWInstruction} `skip` carrying a reason a
 * debug overlay can print. The action then continues with its next step, because an NPC that
 * cannot reach the water station should still say the line it was going to say.
 *
 * WHAT IS DELIBERATELY NOT HERE:
 *   - **Pathing.** `planScenePath` and `resolvePlaceTarget` already exist and are tested; this
 *     module calls them and never re-implements a traversal.
 *   - **Movement.** A `walkTo` instruction is a destination, not an animation — `sceneActor.ts`
 *     walks it.
 *   - **`ai_walk`.** It needs a model call to choose a destination, which is a turn, not a
 *     step. It skips with a reason until that path exists (§ 12 phase 2's note on the step).
 *   - **Rendering a prompted line.** `prompt_npc` resolves to a `promptNpc` instruction naming
 *     WHO speaks and, at most, what about; the model call that turns that into Chinese is the
 *     host's, exactly as it is for a `say`.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 5.4, § 12 phase 2, § 14 Q42.
 */

/** The two non-NPC bodies an actor-aimed step can name, plus any cast npcId. */
export type IWActorRef = string;

/** What the host should do next. One per resolved step; the host reports back when it is done. */
export type IWInstruction =
  /** Walk to this cell, then face the way the last step of the path pointed. */
  | {
      kind: 'walkTo';
      cell: string;
      /** What the walk was FOR, so a blocked walk can be reported in character. */
      purpose: string;
      /**
       * The cell the walk was AIMED at, when that is not the cell being walked to.
       *
       * ⚠️ **A WALK TOWARD SOMETHING ENDS LOOKING AT IT.** `walk_to_actor` and `walk_to_tag`
       * both stop BESIDE their target — you do not walk into a person or onto a counter — so
       * without this the performer arrives with their back to the thing they crossed the room
       * for, which reads as the walk having gone somewhere else entirely. This is the same
       * rule the LEARNER's tap already follows (`approachAndFace` in `useIWSceneRuntime.ts`):
       * as close as the board allows, looking at what was aimed at. The host faces this cell
       * before setting off (so the intent is legible immediately) and again on arrival
       * (because both ends may have moved).
       */
      facing?: string;
    }
  /** Turn to look at this cell without moving. */
  | { kind: 'face'; cell: string }
  /**
   * Say a line.
   *
   * ⚠️ § 14 Q42 is explicit that a `comment` step's text is CONTENT, not a script — the model
   * is supposed to embellish it with the NPC's mood and history, which costs a model call.
   * Phase 2 does not make that call: the authored text is spoken verbatim, which is the
   * conservative half of the behaviour (the author's own words, never something invented) and
   * is why this instruction carries the raw text rather than a rendered one.
   */
  | { kind: 'say'; text: string }
  /**
   * Make a DIFFERENT body speak — the `prompt_npc` step resolved (2026-09-19).
   *
   * ⚠️ **THE ONE INSTRUCTION THAT IS NOT ABOUT THE PERFORMER.** Every other member of this
   * union is executed BY the actor whose action is running; this one names its own speaker,
   * so the host must render and speak it as `npcId` rather than as the performer.
   *
   * Both optional fields mean the same thing when absent — *the model decides* — which is
   * the step's contract, not a missing value to substitute a default for.
   */
  | { kind: 'promptNpc'; npcId: string; toward?: string; instruction?: string }
  /** Stand still for this long. */
  | { kind: 'wait'; ms: number }
  /** Play an authored NPC-to-NPC conversation (§ 14 Q6). */
  | { kind: 'conversation'; conversationId: string }
  /** Arm an authored event to fire no sooner than `ms` from now (migration 161). */
  | { kind: 'scheduleEvent'; eventId: string; ms: number }
  /** Hand the floor back to the learner. Always the last step of an action. */
  | { kind: 'awaitLearner' }
  /** The step could not be resolved. `reason` is for a debug overlay, never for a learner. */
  | { kind: 'skip'; reason: string };

/** Where everybody is, so a step can be resolved against the world as it is this instant. */
export interface ActionWorld {
  graph: SceneGraph;
  /** The NPC performing the action — the implied subject of every step. */
  selfCell: string;
  /** Every body's current cell, keyed by actor id (`player`, `companion`, or an npcId). */
  cells: ReadonlyMap<IWActorRef, string>;
  /** Cells owned by other bodies, so a walk is not planned through somebody. */
  occupied?: ReadonlySet<string>;
  /** The scene's conversations, for validating a `start_conversation` reference. */
  conversations?: readonly IWConversation[];
  /** Valid event ids, for validating a `schedule_event` reference. */
  eventIds?: readonly string[];
}

/** Seconds → ms, rejecting a negative or non-finite authored number. */
const seconds = (value: number | undefined): number =>
  Number.isFinite(value) && (value as number) > 0 ? Math.round((value as number) * 1000) : 0;

/**
 * Where an actor-aimed step should send the performer.
 *
 * `walk_to_actor` stops BESIDE its target rather than on it — you do not walk into somebody —
 * which is `approachCells`' whole reason for existing.
 */
function approachActor(world: ActionWorld, targetCell: string): string | null {
  return approachCells(world.graph, world.selfCell, targetCell, { occupied: world.occupied })[0] ?? null;
}

/**
 * The furthest reachable cell AWAY from `targetCell` — `walk_away_from`'s destination.
 *
 * Greedy and deliberately cheap: it scans the performer's own 4-neighbourhood plus one more
 * ring and takes the reachable cell with the greatest Chebyshev distance from the target. A
 * proper "flee" would be a distance-transform over the whole board, and an NPC stepping back
 * two squares from a spilled drink is the entire use case.
 */
function retreatCell(world: ActionWorld, targetCell: string): string | null {
  const [tc, tr] = targetCell.split(',').map(Number);
  const [sc, sr] = world.selfCell.split(',').map(Number);
  if ([tc, tr, sc, sr].some(n => !Number.isFinite(n))) return null;

  let best: string | null = null;
  let bestDistance = Math.max(Math.abs(sc - tc), Math.abs(sr - tr));
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const key = cellKey(sc + dc, sr + dr);
      if (!world.graph.walkable.has(key)) continue;
      if (world.occupied?.has(key)) continue;
      const distance = Math.max(Math.abs(sc + dc - tc), Math.abs(sr + dr - tr));
      if (distance <= bestDistance) continue;
      if (!planScenePath(world.graph, world.selfCell, key, { occupied: world.occupied })) continue;
      best = key;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Resolve ONE authored step into the instruction the host should execute next.
 *
 * Pure: same step + same world ⇒ same instruction. The host calls it again for the next step
 * once the current instruction has finished, so positions are always read fresh.
 */
export function resolveActionStep(step: IWActionStep, world: ActionWorld): IWInstruction {
  switch (step.kind) {
    case 'comment':
      return step.text?.trim()
        ? { kind: 'say', text: step.text.trim() }
        : { kind: 'skip', reason: 'a Say step with no text' };

    case 'wait':
      return { kind: 'wait', ms: seconds(step.seconds) };

    case 'wait_for_response':
      return { kind: 'awaitLearner' };

    case 'walk_to_tag': {
      const target = resolvePlaceTarget(world.graph, world.selfCell, step.tag, { occupied: world.occupied });
      // A place is usually unwalkable, so `target` is a cell BESIDE it; face the place itself.
      // `places` has no entry for an unknown tag, and then there is nothing to face — the
      // walk is still valid, it just aimed at a cell rather than at a thing.
      const place = world.graph.places.get(step.tag);
      return target
        ? { kind: 'walkTo', cell: target, purpose: step.tag, facing: place ?? undefined }
        // Both failures land here on purpose: an unknown tag and a walled-off one are the
        // same fact to the runtime — nobody is going there — and the reason says which.
        : { kind: 'skip', reason: `cannot reach the place "${step.tag}"` };
    }

    case 'ai_walk':
      // The destination is a MODEL choice from a closed list, which is a turn rather than a
      // step; nothing calls that path yet. The step stays authored, validated and inert.
      return { kind: 'skip', reason: 'ai_walk is not resolved in phase 2' };

    case 'prompt_npc': {
      // A speaker who is not here is the one fatal half — there is nobody to say it, so
      // there is no degraded version of the beat to play.
      if (!world.cells.has(step.npcId)) {
        return { kind: 'skip', reason: `"${step.npcId}" is not in this scene` };
      }
      const target = step.target?.trim();
      return {
        kind: 'promptNpc',
        npcId: step.npcId,
        // ⚠️ AN ADDRESSEE WHO IS NOT HERE IS DROPPED, NOT FATAL — and the fallback is not a
        // guess, it is the step's own documented no-target behaviour: the model picks whom.
        // A renamed or departed target should cost the line its aim, never the line.
        toward: target && world.cells.has(target) ? target : undefined,
        // Normalised to `undefined` so the empty-string and omitted cases reach the render
        // path as one thing — "no brief" — rather than as an empty quoted direction.
        instruction: step.instruction?.trim() || undefined,
      };
    }

    case 'start_conversation': {
      const known = !world.conversations || world.conversations.some(c => c.id === step.conversationId);
      return known
        ? { kind: 'conversation', conversationId: step.conversationId }
        : { kind: 'skip', reason: `no conversation "${step.conversationId}"` };
    }

    case 'schedule_event': {
      const known = !world.eventIds || world.eventIds.includes(step.eventId);
      return known
        ? { kind: 'scheduleEvent', eventId: step.eventId, ms: seconds(step.seconds) }
        : { kind: 'skip', reason: `no event "${step.eventId}"` };
    }

    // The three actor-aimed kinds share a shape and differ only in what they do with the cell.
    case 'walk_to_actor':
    case 'walk_away_from':
    case 'face': {
      const targetCell = world.cells.get(step.actor);
      if (!targetCell) return { kind: 'skip', reason: `"${step.actor}" is not in this scene` };
      if (step.kind === 'face') return { kind: 'face', cell: targetCell };
      const destination = step.kind === 'walk_to_actor'
        ? approachActor(world, targetCell)
        : retreatCell(world, targetCell);
      if (destination) {
        return {
          kind: 'walkTo',
          cell: destination,
          purpose: step.actor,
          // Only `walk_to_actor` faces its target. `walk_away_from` is the opposite intent:
          // backing off while staring at what you backed away from would undo the beat.
          facing: step.kind === 'walk_to_actor' ? targetCell : undefined,
        };
      }
      // ⚠️ **AN UNREACHABLE PERSON IS STILL LOOKED AT.** Boxed in, or already surrounded — a
      // shopkeeper who cannot get around the counter should turn to the learner and speak,
      // not stand facing a wall while their line comes out of nowhere. Skipping here used to
      // drop the turn AND the facing, so the whole beat read as a bug. `walk_away_from` keeps
      // skipping: there is no fallback pose for "flee" that is not just standing still.
      if (step.kind === 'walk_to_actor') return { kind: 'face', cell: targetCell };
      return { kind: 'skip', reason: `cannot get away from "${step.actor}"` };
    }

    default:
      // A step kind a newer authoring build wrote and this client does not know. Skipping is
      // the only honest answer; guessing would perform something nobody authored.
      return { kind: 'skip', reason: `unknown step kind "${(step as { kind: string }).kind}"` };
  }
}

/**
 * The action an NPC's cast entry holds under this id, or null.
 *
 * Here rather than at the call site because "which action did the model pick" is asked from
 * two places — a turn's `chosen` offer and an interaction's `npc_action` step — and both need
 * the same answer for the same reason (§ 5.4a: one behaviour, one definition, two ways in).
 */
export function actionById(member: IWSceneCastMember | undefined, actionId: string): IWNpcAction | null {
  return (member?.actions ?? []).find(a => a.id === actionId) ?? null;
}

/** The two well-known actor ids, re-exported so a host need not import the server contract. */
export const IW_PLAYER_ACTOR = IW_ACTOR_PLAYER;
export const IW_COMPANION_ACTOR = IW_ACTOR_COMPANION;
