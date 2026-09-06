import { npcById } from '../config/iwNpcs.js';
import type { IWScene, IWSceneCastMember } from '../contracts/iw.js';
import { findMetaLanguage, renderNpcBlock } from './iw/npcPrompt.js';
import { getIwLadder } from './iw/modelLadder.js';
import { runNpcTurn, type IWModelRung, type IWRungAttempt, type IWTurnOutcome } from './iw/npcTurn.js';
import { buildTurnOffers, type TurnOffer } from './iw/turnOffers.js';
import { renderTurnState, type TurnStateInput } from './iw/turnState.js';
import { renderWorldRules } from './iw/worldRules.js';
import type { IWTurnReply } from './iw/turnParser.js';
import { iwTurnBudget, IWTurnBudget, type IWBudgetRefusal } from './iw/turnBudget.js';
import type { IImmersiveWorldDAL } from '../dal/interfaces/IImmersiveWorldDAL.js';

/**
 * ImmersiveWorldService — the runtime half of iw (§ 8, phase 2).
 *
 * LAYER: service. It assembles the prompt, runs the model call through the ladder, parses the
 * stream, and resolves the chosen action back to something the engine can execute. It writes
 * no SQL: the scene arrives from `ImmersiveWorldDAL` via the controller.
 *
 * Its sibling `ImmersiveWorldSceneService` owns AUTHORING (validation, the template-author
 * gate). The split is by lifecycle rather than by subject: authoring runs once per scene under
 * a human's eye and may refuse; this runs many times per second in front of a learner and may
 * never refuse — the worst it does is freeze with a banner (§ 14 Q7).
 *
 * ⚠️ **THE HEARING GATE IS NOT HERE.** § 4 puts audibility client-side, as pure geometry
 * running BEFORE any model call, so by the time a request reaches this service the client has
 * already decided who heard what. That is the correct place for it — the gate must be
 * inspectable and it is also the § 4.1 cost control — but it means this service TRUSTS the
 * client about who was in earshot. Phase 2 accepts that; the bound that actually exists is
 * § 7's per-user rate limit and daily cap, which is why those are not optional.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 5.4, § 5.5, § 8, § 14 Q7.
 */

/** Everything one NPC's turn needs, as the client perceived it. */
export interface NpcTurnRequest {
  scene: IWScene;
  npcId: string;
  /** Complication and event ids that have fired so far in this run. */
  firedCues?: readonly string[];
  /** Layer 3's contents minus the offers, which this service computes. */
  perception: Omit<TurnStateInput, 'offers'>;
  /** Override the ladder — tests and the CLI probe pass fakes. */
  rungs?: readonly IWModelRung[];
  onDelta?: (say: string, attemptIndex: number, speechComplete: boolean) => void;
}

/** What the engine gets back. */
export type NpcTurnResult =
  | {
      kind: 'reply';
      reply: IWTurnReply;
      /** The offer the model picked, resolved to its authored id — null when it chose `none`. */
      chosen: TurnOffer | null;
      rung: string;
      attempts: IWRungAttempt[];
      /** What was offered, for the log and for a debug overlay. */
      offers: TurnOffer[];
      suppressed: Array<{ name: string; reason: string }>;
    }
  /** The ladder was exhausted — freeze the scene and show the banner (§ 14 Q7). */
  | { kind: 'frozen'; attempts: IWRungAttempt[] }
  /** The request named somebody who is not in this scene, or an NPC that does not exist. */
  | { kind: 'unknown-npc'; npcId: string };

/**
 * The system block: layer 1 (world rules + reply contract) then layer 2 (the NPC sheet).
 *
 * ⚠️ ORDER IS THE CACHE ORDER (§ 5.5): stable → volatile, because any byte change invalidates
 * everything after it. Layer 1 is identical for every NPC, so it must come first; layer 2 is
 * frozen per NPC. Layer 3 is NOT here — it is the user message, which is both the cache
 * boundary and § 11's injection boundary.
 *
 * ⚠️ ONE IMPURITY IN AN OTHERWISE FROZEN PREFIX: the reply contract names the actions offered
 * THIS turn, so the front of layer 1 is stable and its contract line is not. That is a known
 * cost of Q42's authored actions and is why `prefix-size.js` measures the stem, not this.
 */
export function buildSystemBlock(npcId: string, offeredNames: readonly string[]): string | null {
  const npc = npcById(npcId);
  if (!npc) return null;
  return `${renderWorldRules(offeredNames)}\n\n${renderNpcBlock(npc)}`;
}

/**
 * Run one NPC's turn.
 *
 * The whole function is a pipeline of the pure modules beside it — offers, prompt layers,
 * ladder, parser — and its only judgement is resolving the model's chosen NAME back to the
 * authored thing. That resolution is where § 5.4's guarantee lands: the parser has already
 * restricted line 2 to the offered names, so `chosen` is either one of this scene's own
 * authored actions/conversations or null. There is no path to an invented action.
 */
export async function takeNpcTurn(request: NpcTurnRequest): Promise<NpcTurnResult> {
  const { scene, npcId } = request;

  // Both halves must hold: the NPC has to be CAST in this scene (so it has actions and a
  // position) and has to exist in the registry (so it has a sheet). A scene can name an npcId
  // the code no longer defines — the cast is TEXT, not a foreign key, because the referent is
  // code — so the two checks are genuinely different failures with one answer.
  const member = (scene.npcCast ?? []).find((m: IWSceneCastMember) => m.npcId === npcId);
  if (!member || !npcById(npcId)) return { kind: 'unknown-npc', npcId };

  const firedCues = new Set(request.firedCues ?? []);
  const { offers, names, suppressed } = buildTurnOffers(scene, member, firedCues);

  const user = renderTurnState({ ...request.perception, offers });
  const outcome: IWTurnOutcome = await runNpcTurn({
    rungs: request.rungs ?? getIwLadder(),
    request: { system: buildSystemBlock(npcId, names)!, user },
    // The SAME array the prompt rendered — offering one list and validating another grades a
    // fiction (§ 5.4).
    offered: names,
    onDelta: request.onDelta,
  });

  if (outcome.kind === 'frozen') return { kind: 'frozen', attempts: outcome.attempts };

  const chosen = offers.find(o => o.name === outcome.reply.action) ?? null;
  return {
    kind: 'reply',
    reply: outcome.reply,
    chosen,
    rung: outcome.rung,
    attempts: outcome.attempts,
    offers,
    suppressed,
  };
}

/**
 * Lint every NPC referenced by a scene for meta language (§ 14 Q27).
 *
 * ⚠️ THIS IS A LINT, NOT A RUNTIME GATE, and it belongs at scene-save time and in a test —
 * not on the turn path, where it would cost a full prompt render per turn to answer a question
 * whose answer cannot change between turns. An NPC that mentions the game is a bug that shows
 * up as an NPC explaining itself to a learner.
 */
export function findSceneMetaLanguage(scene: IWScene): Array<{ npcId: string; terms: string[] }> {
  const hits: Array<{ npcId: string; terms: string[] }> = [];
  for (const member of scene.npcCast ?? []) {
    const npc = npcById(member.npcId);
    if (!npc) continue;
    const terms = findMetaLanguage(renderNpcBlock(npc));
    if (terms.length) hits.push({ npcId: member.npcId, terms });
  }
  return hits;
}

// ─────────────────────────────────────────────────────────────────────────────
// The runtime service (§ 7, § 8) — the stateful half, wrapping the pure one above
// ─────────────────────────────────────────────────────────────────────────────

/** One send from the client: who is speaking, to whom, and what they perceived. */
export interface IWTurnHttpRequest {
  sceneId: string;
  /** Identifies one scene RUN, for the § 7 session budget. Client-generated. */
  sessionId: string;
  npcId: string;
  firedCues?: readonly string[];
  perception: Omit<TurnStateInput, 'offers'>;
}

export type IWRuntimeResult =
  | { kind: 'refused'; refusal: IWBudgetRefusal; remaining: number }
  | { kind: 'no-scene'; sceneId: string }
  | (NpcTurnResult & { remaining: number });

/**
 * The runtime service — everything `takeNpcTurn` deliberately does not know about: which
 * scene this is, who is asking, and whether they may.
 *
 * LAYER: service. It reads the scene through the DAL and writes no SQL of its own.
 *
 * ⚠️ **IT RE-READS THE SCENE ON EVERY TURN.** One indexed primary-key read per turn, next
 * to a ~1 s model call, so it does not show up — and the alternative (a process-local scene
 * cache) is a correctness hazard the moment an author saves a scene someone is playing.
 * Revisit only with a measurement, not on instinct.
 *
 * ⚠️ **THE BUDGET IS CHECKED BEFORE THE CALL AND SPENT AFTER IT.** A turn the ladder could
 * not answer (§ 14 Q7's `frozen`) costs the learner nothing, because they got nothing. This
 * is the same check-then-write shape as `dictionary_ai_usage` and has the same TOCTOU: two
 * concurrent turns can both pass a check that only one should. That is tolerable for a
 * money BOUND — the overshoot is one turn — and would not be for a currency.
 */
export class ImmersiveWorldService {
  constructor(
    private readonly iwDAL: IImmersiveWorldDAL,
    private readonly budget: IWTurnBudget = iwTurnBudget,
    /**
     * Override the model ladder. Defaults to the process ladder (`getIwLadder`).
     *
     * It exists so this class is testable at all: without it every test of the budget, the
     * scene lookup or the result mapping would need a network and a key, which is exactly
     * the shape of test that stops being run.
     */
    private readonly rungs?: readonly IWModelRung[],
  ) {}

  /**
   * Run one NPC turn on behalf of an authenticated learner.
   *
   * `onDelta` is threaded straight through so a streaming transport (SSE) can paint the
   * bubble as it arrives; a caller that wants one JSON object simply omits it.
   */
  async runTurn(
    userId: string,
    request: IWTurnHttpRequest,
    onDelta?: (say: string, attemptIndex: number, speechComplete: boolean) => void,
  ): Promise<IWRuntimeResult> {
    // The learner's own words are the only unbounded input on this path (§ 7, Q4c).
    const spoken =
      request.perception.event.kind === 'utterance' ? request.perception.event.text : undefined;

    const verdict = this.budget.check(userId, request.sessionId, spoken);
    if (verdict.refusal) return { kind: 'refused', refusal: verdict.refusal, remaining: verdict.remaining };

    const scene = await this.iwDAL.findSceneById(request.sceneId);
    if (!scene) return { kind: 'no-scene', sceneId: request.sceneId };

    const result = await takeNpcTurn({
      scene,
      npcId: request.npcId,
      firedCues: request.firedCues,
      perception: request.perception,
      rungs: this.rungs,
      onDelta,
    });

    // Only a turn that produced words is billed to the session (see the header).
    if (result.kind === 'reply') this.budget.spend(userId, request.sessionId);
    return { ...result, remaining: this.budget.remaining(request.sessionId) };
  }

  /** A scene run ended — release its budget counter (see {@link IWTurnBudget.endSession}). */
  endSession(sessionId: string): void {
    this.budget.endSession(sessionId);
  }
}
