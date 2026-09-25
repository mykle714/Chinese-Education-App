import type {
  IWActionStep, IWDestinationCandidate, IWDestinationTarget, IWInteractionStep,
} from '../../../../server/contracts/iw';
import { resolveActionStep, resolveDestination, type ActionWorld } from './actionPlayer';

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
  /**
   * Put an authored DIRECTION into this NPC's own words (§ 14 Q42). `null` = skip the beat.
   *
   * ⚠️ **A `null` IS NEVER A REASON TO SPEAK THE DIRECTION.** It is English prose about the
   * character; putting it on screen is the exact leak this call exists to close.
   *
   * Both optional arguments carry `prompt_npc`'s contract rather than a default (2026-09-19):
   * an absent `direction` asks the NPC to say whatever the moment calls for, and an absent
   * `towardActorId` lets it pick whom. `towardActorId` is an ACTOR ID — the host owns the
   * mapping to the in-world name the prompt sees, because that name is not the one the UI
   * prints over a head.
   */
  renderLine(actorId: string, direction?: string, towardActorId?: string): Promise<string | null>;
  /**
   * Ask the model where an `ai_walk` goes (§ 5.4, 2026-09-23). Resolves to one of
   * `candidates`, or `null` — NONE, a dead model, a refusal, a timeout — which skips the walk.
   *
   * ⚠️ **IT MUST NEVER RESOLVE TO SOMETHING OFF THE LIST.** The host checks the answer against
   * `candidates` before returning it; the script trusts it to have done so.
   */
  chooseDestination(
    actorId: string, brief: string, candidates: readonly IWDestinationCandidate[],
  ): Promise<IWDestinationTarget | null>;
  /** Play an authored NPC-to-NPC conversation to the end (§ 14 Q6). */
  playConversation(conversationId: string): Promise<void>;
  /** Arm an authored event. Fire-and-forget: the step does NOT wait for it (migration 161). */
  armEvent(eventId: string, ms: number): void;
  wait(ms: number): Promise<void>;
  /**
   * Park until the learner says something ROUTED TO THIS ACTOR (§ 4.2), then carry on.
   *
   * ⚠️ **IT IS A BARRIER, NOT A TERMINATOR** (2026-09-20). It used to end the action outright,
   * which made "hand the floor back" and "this is the last thing I do" the same step and
   * forced every authored beat that follows a learner's sentence into a second action the
   * author had to find another way to trigger. Now the script simply stops here and resumes
   * on the learner's next line to this NPC, so `say → wait → say` is one script again.
   *
   * ⚠️ **ROUTED TO THIS NPC, not merely "the learner spoke"** (2026-09-23). Everybody hears
   * every line (§ 4c withdrawn), so waking on any utterance would have an NPC treat an aside to
   * somebody else as the answer to its own question. It wakes when the addressee router (or its
   * rule fallback) picks this NPC. The consequence an author has to know is that talking only
   * to other people leaves it parked — until the scene is left or another action supersedes
   * the script, which are the only two other ways out.
   */
  awaitLearner(actorId: string): Promise<void>;
  /**
   * Park until the learner's next utterance to this NPC has been ANSWERED, and report whether the
   * answer contained what this NPC was after (§ 5.4's `get_information`).
   *
   * ⚠️ **IT RESOLVES LATER THAN {@link awaitLearner}, AND THAT IS THE POINT.** `awaitLearner`
   * resolves the moment the learner speaks; this one waits for the NPC's own turn on that
   * utterance to come back, because the verdict is part of that reply. A script resuming at
   * the earlier moment would be racing the line its own NPC is about to say.
   *
   * `attempt` is 1-based and reaches the prompt, so the NPC can ask again differently rather
   * than repeating itself. The host neither counts nor caps — {@link runAuthoredAction} owns
   * the loop, because the cap is a property of the authored step.
   */
  collect(actorId: string, goal: string, attempt: number, maxTurns: number): Promise<'got' | 'not-yet'>;
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
  // The one in-flight render, and which step it belongs to. See `nextPrefetchableComment`.
  let prefetch: { index: number; line: Promise<string | null> } | null = null;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (deps.cancelled()) return;

    // ⚠️ **START THE NEXT LINE'S RENDER AS EARLY AS IT IS PROVABLY SAFE TO** (§ 14 Q42). A
    // render is a model call, so a `comment` reached cold makes the NPC pause for a second in
    // the middle of a beat. Q42's answer was to generate a whole action's comments at once;
    // that is unsound (see `nextPrefetchableComment`), so instead the render is started at the
    // earliest step from which nothing can change what this NPC has heard. In the common
    // `walk_to_tag → wait → walk_to_actor → comment` shape that is the whole walk, which is
    // exactly the window Q42 wanted to hide the latency in.
    if (!prefetch) {
      const at = nextPrefetchableComment(steps, i);
      // `> i` only: a comment at `i` itself is rendered inline below, where its result is
      // needed immediately anyway and a prefetch would just be an extra variable.
      if (at !== null && at > i) {
        const text = (steps[at] as { text?: string }).text?.trim();
        if (text) prefetch = { index: at, line: deps.renderLine(actorId, text) };
      }
    }

    // Resolved HERE, immediately before performing it, so positions are the current ones —
    // see `actionPlayer.ts`'s "resolved late" note.
    let instruction = resolveActionStep(step, deps.worldFor(actorId));

    // ⚠️ **AN `ai_walk` IS RESOLVED IN TWO HALVES, AND THE MODEL CALL SITS BETWEEN THEM.** The
    // first half built the closed list; the model picks from it; the second half turns the pick
    // into the ordinary `walkTo`/`face` against the world as it is NOW — positions have moved
    // during the call. What comes out is performed by the same `walkTo` case below, so an AI
    // walk arrives and faces exactly like the authored walk it stands in for.
    if (instruction.kind === 'chooseDestination') {
      const target = await deps.chooseDestination(actorId, instruction.brief, instruction.candidates);
      if (deps.cancelled()) return;
      instruction = resolveDestination(target, deps.worldFor(actorId));
    }

    switch (instruction.kind) {
      case 'walkTo':
        // Faced BEFORE and AFTER, mirroring `approachAndFace`. Before, so the performer
        // visibly sets off toward something rather than sidling. After, because facing is a
        // DIRECTION and the performer has moved: the same target cell is on a different
        // bearing from the arrival cell than it was from where they started.
        //
        // ⚠️ Unlike the learner's version, `facing` is a SNAPSHOT — the cell the target stood
        // on when the step was resolved, not a getter. A target that walks off mid-step is
        // therefore faced at where it was. That is deliberate for now: the alternative needs
        // the instruction to carry the target's identity rather than its position, and a
        // shopkeeper looking at the tile you just left is a far smaller wrong than the
        // back-to-the-learner pose this replaced.
        if (instruction.facing) deps.face(actorId, instruction.facing);
        await deps.walk(actorId, instruction.cell);
        if (instruction.facing && !deps.cancelled()) deps.face(actorId, instruction.facing);
        break;
      case 'face':
        deps.face(actorId, instruction.cell);
        break;
      case 'say': {
        // `instruction.text` is the authored DIRECTION, not a line. It is rendered — here,
        // or already in flight from a prefetch started a few steps back — and only the
        // rendered Chinese is ever spoken.
        const line = prefetch?.index === i
          ? await prefetch.line
          : await deps.renderLine(actorId, instruction.text);
        prefetch = null;
        if (deps.cancelled()) return;
        // Skipped, never spoken as written. `renderLine` has already left the reason in the
        // note log, so the script simply moves on.
        if (line) await deps.say(actorId, line);
        break;
      }
      case 'promptNpc': {
        // ⚠️ RENDERED AND SPOKEN AS `instruction.npcId`, NOT AS `actorId` — this is the one
        // instruction whose subject is somebody else, and using the performer here would make
        // 王婶 speak the kitchen's line in her own bubble.
        //
        // NOT PREFETCHED, and it could not be: the prefetch window is "nothing can change what
        // this NPC has heard", and a cue is by definition another voice entering the scene. It
        // is a `RENDER_BARRIER` for the same reason.
        const line = await deps.renderLine(instruction.npcId, instruction.instruction, instruction.toward);
        if (deps.cancelled()) return;
        // A frozen render is silence, exactly as it is for `say`. The cue is dropped; the
        // performer's own script plays on.
        if (line) await deps.say(instruction.npcId, line);
        break;
      }
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
        // The floor goes back to the learner — and comes back here when they have used it.
        // Nothing runs while they compose (§ 14 Q29), which is the whole of what the old
        // "must be the final step" rule was protecting; the rest of the script simply waits.
        await deps.awaitLearner(actorId);
        if (deps.cancelled()) return;
        break;
      case 'collectInfo': {
        // ⚠️ **THE ONLY LOOP IN THE SCRIPT PLAYER.** Every other step runs once; this one runs
        // until the NPC has what it came for. The cap is what keeps that honest — the verdict
        // is the model's judgement, and the failure worth guarding is not a wrong answer but
        // an NPC that never accepts one (see `IW_COLLECT_TURNS_DEFAULT`).
        let got = false;
        for (let attempt = 1; attempt <= instruction.maxTurns; attempt++) {
          const outcome = await deps.collect(actorId, instruction.goal, attempt, instruction.maxTurns);
          if (deps.cancelled()) return;
          if (outcome === 'got') { got = true; break; }
        }
        if (!got) {
          // ⚠️ **GIVING UP IS SPOKEN, NOT SILENT.** A cap that merely released the floor would
          // be an NPC who asks twice and then stares while the script carries on around them.
          // The direction is an intention, exactly like a `comment`'s — the NPC's own register
          // decides the words, and a render that comes back empty is silence, not English.
          deps.note(actorId, `gave up asking after ${instruction.maxTurns} — "${instruction.goal}"`);
          const line = await deps.renderLine(
            actorId,
            `You could not find out ${instruction.goal}. Let it go and carry on without it.`,
          );
          if (deps.cancelled()) return;
          if (line) await deps.say(actorId, line);
        }
        break;
      }
      case 'skip':
        deps.note(actorId, instruction.reason);
        break;
      case 'chooseDestination':
        // Unreachable — resolved above. Listed so the switch stays exhaustive over the union.
        break;
    }
  }
}

/**
 * Steps that make a prefetched render WRONG, rather than merely early.
 *
 * A render is written against what the NPC has heard. Anything that can add to that list
 * between now and the comment invalidates a line generated in advance:
 *
 *   - **`get_information`** is `wait_for_response` several times over, and the NPC speaks on
 *     every one of those turns. Both halves of the barrier at once.
 *   - **`wait_for_response`** hands the floor to the learner. This is the case that sinks
 *     Q42's batch-per-action plan outright — a script straddles the learner's own sentences,
 *     and a line written before them would answer something nobody said. It stayed a barrier
 *     when the step became resumable (2026-09-20): a comment on the far side of it is now
 *     reachable, and rendering it in advance would write the NPC's answer before the question.
 *   - **`comment`** is a line this same NPC is about to speak, which the next one should be
 *     able to build on rather than repeat.
 *   - **`start_conversation`** is several other NPCs speaking.
 *   - **`prompt_npc`** is exactly one other NPC speaking, which is the same fact in smaller
 *     form: a line the performer is about to answer cannot have been written before it.
 */
const RENDER_BARRIERS: ReadonlySet<string> = new Set([
  'wait_for_response', 'comment', 'start_conversation', 'prompt_npc', 'get_information',
]);

/**
 * The next `comment` reachable from `from` without crossing a barrier, or null.
 *
 * `from` is the step ABOUT TO BE PERFORMED, so it is examined like any other — a
 * `wait_for_response` sitting at `from` is exactly the barrier this is looking for. The
 * `comment` test runs first, so a comment at `from` returns `from` rather than being read as
 * its own barrier; the caller uses the `> from` test to decide whether prefetching it is
 * worth anything.
 */
export function nextPrefetchableComment(steps: readonly IWActionStep[], from: number): number | null {
  for (let i = from; i < steps.length; i++) {
    if (steps[i].kind === 'comment') return i;
    if (RENDER_BARRIERS.has(steps[i].kind)) return null;
  }
  return null;
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
