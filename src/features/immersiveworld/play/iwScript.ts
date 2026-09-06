import type { IWActionStep, IWInteractionStep } from '../../../../server/contracts/iw';
import { resolveActionStep, type ActionWorld } from './actionPlayer';

/**
 * iwScript — playing an authored script, one step at a time.
 *
 * LAYER: feature logic. It is the loop between `actionPlayer.ts` (which resolves ONE step
 * against the world) and the runtime hook (which owns bodies, bubbles and audio). Neither of
 * those wants to be the thing that knows a script is a sequence.
 *
 * ⚠️ **IT IS `async`/`await` RATHER THAN A STATE MACHINE, AND THAT IS A CHOICE.** Every step
 * is "do a thing, wait for it to finish, do the next" — a walk that ends on arrival, a line
 * that ends when the bubble finishes revealing, a wait that ends on a timer. Written as an
 * FSM, each of those becomes a state plus a resumption point, and the reader has to
 * reassemble the script's order out of a switch. Written as a loop, the code IS the script.
 * The cost of that choice is that cancellation has to be explicit, which is what
 * {@link IWScriptDeps.cancelled} is: it is checked after EVERY await, because a learner can
 * leave the scene during any of them.
 *
 * ⚠️ **A SCRIPT NEVER THROWS AT A LEARNER.** An unresolvable step is skipped with a reason
 * (`actionPlayer.ts`'s contract) and the script continues — an NPC that cannot reach the water
 * station should still say the line it was going to say.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 5.4, § 5.4a, § 12 phase 2, § 14 Q42, § 14 Q43.
 */

/** How the host performs each kind of instruction. Every promise resolves when the beat ends. */
export interface IWScriptDeps {
  /** Positions as they are RIGHT NOW, from the performer's point of view. */
  worldFor(actorId: string): ActionWorld;
  /** Walk and resolve on arrival — or on `blocked`, which ends the walk but not the script. */
  walk(actorId: string, cell: string): Promise<'arrived' | 'blocked'>;
  /** Turn to look at a cell. Instant, so it is not awaited. */
  face(actorId: string, cell: string): void;
  /** Show and speak a line; resolves when the bubble has finished revealing (§ 5.3a). */
  say(actorId: string, text: string): Promise<void>;
  /** Play an authored NPC-to-NPC conversation to the end (§ 14 Q6). */
  playConversation(conversationId: string): Promise<void>;
  /** Arm an authored event. Fire-and-forget: the step does NOT wait for it (migration 161). */
  armEvent(eventId: string, ms: number): void;
  wait(ms: number): Promise<void>;
  /** A step that could not be performed. For a debug overlay — never shown to a learner. */
  note(actorId: string, reason: string): void;
  /** True once this script has been superseded or the scene has been left. */
  cancelled(): boolean;
}

/** What an INTERACTION can do beyond what an action can (§ 14 Q43). */
export interface IWInteractionDeps extends IWScriptDeps {
  /** Show the learner a picture. Resolves when they dismiss it. */
  showPopup(imageId: string, caption?: string): Promise<void>;
  /** Make a cast member perform one of their OWN authored actions. */
  performNpcAction(npcId: string, actionId: string): Promise<void>;
}

/**
 * Play one authored action to the end.
 *
 * `actorId` is the performer and the implied subject of every step — an action hangs off a
 * cast entry, so "walk to the counter" always means *this NPC walks*.
 */
export async function runAuthoredAction(
  actorId: string,
  steps: readonly IWActionStep[],
  deps: IWScriptDeps,
): Promise<void> {
  for (const step of steps) {
    if (deps.cancelled()) return;
    // Resolved HERE, immediately before performing it, so positions are the current ones —
    // see `actionPlayer.ts`'s "resolved late" note.
    const instruction = resolveActionStep(step, deps.worldFor(actorId));

    switch (instruction.kind) {
      case 'walkTo':
        await deps.walk(actorId, instruction.cell);
        break;
      case 'face':
        deps.face(actorId, instruction.cell);
        break;
      case 'say':
        await deps.say(actorId, instruction.text);
        break;
      case 'wait':
        await deps.wait(instruction.ms);
        break;
      case 'conversation':
        await deps.playConversation(instruction.conversationId);
        break;
      case 'scheduleEvent':
        // Deliberately NOT awaited: the step arms a timer and the NPC walks on (migration
        // 161). Awaiting it would turn every scheduled beat into a `wait`.
        deps.armEvent(instruction.eventId, instruction.ms);
        break;
      case 'awaitLearner':
        // The floor goes back to the learner, and an action's own contract puts this last.
        return;
      case 'skip':
        deps.note(actorId, instruction.reason);
        break;
    }
  }
}

/**
 * Play one place's interaction script (§ 14 Q43).
 *
 * ⚠️ **IT HAS NO PERFORMER.** An interaction is the world answering a poke, so every
 * subject-relative step is meaningless here and the one step that needs a subject names it
 * (`npc_action`). That is why this is a second, smaller loop rather than a call into
 * {@link runAuthoredAction} with a fake actor: giving it a performer would make `walk_to_tag`
 * expressible, and there is nobody for it to move.
 */
export async function runInteraction(
  steps: readonly IWInteractionStep[],
  deps: IWInteractionDeps,
): Promise<void> {
  for (const step of steps) {
    if (deps.cancelled()) return;
    switch (step.kind) {
      case 'popup':
        await deps.showPopup(step.imageId, step.caption);
        break;
      case 'npc_action':
        // A REFERENCE, not an inline script: the same authored action is both something the
        // model may choose and something this poke fires. One behaviour, one definition.
        await deps.performNpcAction(step.npcId, step.actionId);
        break;
      case 'start_conversation':
        await deps.playConversation(step.conversationId);
        break;
      case 'schedule_event':
        deps.armEvent(step.eventId, Math.max(0, Math.round((step.seconds ?? 0) * 1000)));
        break;
      case 'wait':
        await deps.wait(Math.max(0, Math.round((step.seconds ?? 0) * 1000)));
        break;
      default:
        deps.note('world', `unknown interaction step "${(step as { kind: string }).kind}"`);
    }
  }
}
