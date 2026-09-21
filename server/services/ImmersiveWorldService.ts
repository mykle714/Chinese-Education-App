import { npcById } from '../config/iwNpcs.js';
import type { IWScene, IWSceneSummary } from '../contracts/iw.js';
import { findMetaLanguage, renderNpcBlock } from './iw/npcPrompt.js';
import { getIwLadder } from './iw/modelLadder.js';
import { runNpcTurn, type IWModelRung, type IWRungAttempt, type IWTurnOutcome } from './iw/npcTurn.js';
import { buildTurnOffers, type TurnOffer } from './iw/turnOffers.js';
import { renderTurnState, type IWContextInput, type TurnStateInput } from './iw/turnState.js';
import { buildLineSystemBlock, renderNpcLine, type IWLineOutcome } from './iw/lineRender.js';
import { routeAddressee, type RouterCastMember } from './iw/addresseeRouter.js';
import { renderWorldRules } from './iw/worldRules.js';
import type { IWTurnReply } from './iw/turnParser.js';
import { iwTurnBudget, IWTurnBudget, type IWBudgetOptions, type IWBudgetRefusal } from './iw/turnBudget.js';
import type { IImmersiveWorldDAL } from '../dal/interfaces/IImmersiveWorldDAL.js';
import { npcOptionsForLanguage } from './iw/npcOptions.js';
import { resolveCastMember } from './iw/sceneCast.js';
import type { IWLineSegments, IWNpcOption, IWTranscriptEntry } from '../contracts/iw.js';
import { IW_ACTOR_PLAYER } from '../contracts/iw.js';
import { SceneTranscript } from './iw/sceneTranscript.js';
import type { IDictionaryDAL } from '../dal/interfaces/IDictionaryDAL.js';
import type { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import { partsToLineSegments } from './iw/lineSegments.js';

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
 * ⚠️ **THE CLIENT DECIDES WHO IS ASKED, AND THIS SERVICE CANNOT CHECK IT.** The endpoint
 * takes one npcId per call and the client fans out, so a caller can ask for a turn from any
 * NPC in any scene, claiming any perception. That was true when § 4's earshot gate stood in
 * front of it and is no less true now the gate is withdrawn (2026-09-07) — the gate was
 * client-side geometry either way. What changed is that there is no longer a *shape* of
 * request the server could in principle validate: the honest audience is now the whole cast,
 * so the only bounds are § 7's per-user rate limit, listener cap and daily cap. They are not
 * optional; they are the entire defence.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 5.4, § 5.5, § 8, § 14 Q7.
 */

/** Everything one NPC's turn needs, as the client perceived it. */
export interface NpcTurnRequest {
  scene: IWScene;
  npcId: string;
  /** Complication and event ids that have fired so far in this run. */
  firedCues?: readonly string[];
  /**
   * Conversation ids already overheard in this run — each plays at most once (`turnOffers`).
   *
   * Client-held, like `firedCues`, and for the same reason: it is per-RUN state and the run
   * lives in the browser tab. A reload starts a new run and hears them again, which is
   * correct — it is a new scene, not a resumed one.
   */
  playedConversations?: readonly string[];
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
export function buildSystemBlock(
  npcId: string,
  offeredNames: readonly string[],
  collecting = false,
): string | null {
  const npc = npcById(npcId);
  if (!npc) return null;
  // `collecting` adds the contract's fourth line (§ 5.4's `get_information`). It moves with
  // the offered names, in the half of layer 1 that was already per-turn — see the note above.
  return `${renderWorldRules(offeredNames, collecting)}\n\n${renderNpcBlock(npc)}`;
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

  // Both halves must hold: the NPC has to be IN this scene (so it has actions and a position)
  // and has to exist in the registry (so it has a sheet). A scene can name an npcId the code
  // no longer defines — the cast is TEXT, not a foreign key, because the referent is code — so
  // the two checks are genuinely different failures with one answer.
  //
  // "In this scene" is `resolveCastMember`, not a lookup in `npcCast`, because the COMPANION is
  // in every scene without being cast in any of them (§ 14 Q25). Reading the stored list
  // directly is what made him unanswerable.
  const member = resolveCastMember(scene, npcId);
  if (!member || !npcById(npcId)) return { kind: 'unknown-npc', npcId };

  const firedCues = new Set(request.firedCues ?? []);
  const played = new Set(request.playedConversations ?? []);
  const { offers, names, suppressed } = buildTurnOffers(scene, member, firedCues, played);

  const user = renderTurnState({ ...request.perception, offers });
  const outcome: IWTurnOutcome = await runNpcTurn({
    rungs: request.rungs ?? getIwLadder(),
    request: { system: buildSystemBlock(npcId, names, Boolean(request.perception.collect))!, user },
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

/** One authored direction to put into an NPC's own words (§ 14 Q42). */
export interface NpcLineRequest {
  scene: IWScene;
  npcId: string;
  /**
   * The authored direction — an intention in the author's language, never a line.
   *
   * Optional since 2026-09-19: an unbriefed `prompt_npc` cue sends none, and the NPC speaks
   * from character and perception alone. See {@link renderLineDirection} for the two closers.
   */
  direction?: string;
  /** Who it is aimed at, as this NPC would name them. Omitted = the NPC picks. */
  toward?: string;
  /** What this NPC perceives. The SAME shape a turn takes, minus the event. */
  perception: IWContextInput;
  rungs?: readonly IWModelRung[];
  onDelta?: (text: string, attemptIndex: number, complete: boolean) => void;
}

export type NpcLineResult =
  | { kind: 'line'; text: string; rung: string; attempts: IWRungAttempt[] }
  | { kind: 'frozen'; attempts: IWRungAttempt[] }
  | { kind: 'unknown-npc'; npcId: string };

/**
 * Render one authored direction as something this NPC would actually say (§ 14 Q42).
 *
 * The same two-part membership check a turn makes, and for the same reason — a scene's cast
 * is TEXT, so "in this scene" and "exists in the registry" are different failures with one
 * answer — routed through `resolveCastMember` so the COMPANION is renderable too (§ 14 Q25).
 * He is the NPC whose lines are most often authored, so getting this wrong would silence the
 * one character every scene has.
 */
export async function takeNpcLine(request: NpcLineRequest): Promise<NpcLineResult> {
  const { scene, npcId } = request;
  const member = resolveCastMember(scene, npcId);
  const npc = npcById(npcId);
  if (!member || !npc) return { kind: 'unknown-npc', npcId };

  const outcome: IWLineOutcome = await renderNpcLine({
    rungs: request.rungs ?? getIwLadder(),
    system: buildLineSystemBlock(renderNpcBlock(npc)),
    direction: { ...request.perception, direction: request.direction, toward: request.toward },
    onDelta: request.onDelta,
  });
  return outcome;
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
  playedConversations?: readonly string[];
  perception: Omit<TurnStateInput, 'offers'>;
}

/** One line render from the client: whose line, what it means, and what they perceive. */
/** What the client asks the addressee router (§ 4.2). Sheets are NOT sent — see the service. */
export interface IWRouteHttpRequest {
  sceneId: string;
  utterance: string;
  cast: readonly RouterCastMember[];
  heard: readonly string[];
}

/**
 * ⚠️ `routed` WITH A NULL `npcId` IS A SUCCESS, not a failure. It means "the model had no
 * opinion, use your own rules" — which the client can always do, and which is why this shape
 * has no `frozen` case the way a turn does.
 */
export type IWRouteRuntimeResult =
  | { kind: 'routed'; npcId: string | null; detail: string }
  | { kind: 'refused'; refusal: IWBudgetRefusal }
  | { kind: 'no-scene'; sceneId: string };

export interface IWLineHttpRequest {
  sceneId: string;
  sessionId: string;
  npcId: string;
  /** Optional since 2026-09-19 — an unbriefed cue. See {@link NpcLineRequest.direction}. */
  direction?: string;
  toward?: string;
  perception: IWContextInput;
}

export type IWLineRuntimeResult =
  | { kind: 'refused'; refusal: IWBudgetRefusal }
  | { kind: 'no-scene'; sceneId: string }
  | NpcLineResult;

/** What a learner needs to open a scene: the scene itself, and who is in it. */
export interface IWScenePlayPayload {
  scene: IWScene;
  npcs: IWNpcOption[];
  /**
   * ⚠️ **ALWAYS EMPTY SINCE 2026-09-07, AND KEPT ONLY AS A WIRE FIELD.**
   *
   * It used to carry every authored line the scene could speak, segmented up front for
   * § 5.3b's tap-to-look-up — one batched dictionary query at scene open instead of a round
   * trip in front of each one. § 14 Q42 removed the premise: there ARE no authored lines any
   * more. What a scene stores is a DIRECTION, which is rendered by the model into Chinese at
   * the moment it is spoken, so the string that reaches the bubble does not exist until then
   * and arrives with its own `segments` event, exactly like a turn's.
   *
   * The field stays so an older client keeps parsing the payload. Remove it once none are
   * left, along with `IWScenePlayPayload.lineSegments` on the client.
   */
  lineSegments: Record<string, IWLineSegments>;
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
    /**
     * The dictionary, for § 5.3b's segmented bubbles. OPTIONAL, and the feature degrades to
     * plain text without it rather than failing — a scene that cannot be looked up is still
     * a scene you can walk around and talk in, and every test of the turn pipeline would
     * otherwise need a dictionary it has no opinion about.
     */
    private readonly dictionaryDAL?: IDictionaryDAL,
    /**
     * Where a run's conversation is kept (§ 12 phase 3). Defaulted rather than injected at
     * every call site for the same reason `budget` is: every existing construction and every
     * existing test predates it, and a transcript is not something a caller opts into.
     */
    private readonly transcript: SceneTranscript = new SceneTranscript(iwDAL),
    /**
     * The users table, for the template-author budget exemption ONLY (§ 7).
     *
     * OPTIONAL, and its absence means "nobody is exempt" rather than an error — every
     * pre-existing construction and every test of this class predates it and has no opinion
     * about accounts. It is the same DAL and the same grant the authoring sibling takes
     * (`ImmersiveWorldSceneService`), but a different QUESTION: that one asks "may you author?"
     * and refuses; this one asks "are you the person building this?" and relaxes a ceiling.
     */
    private readonly userDAL?: IUserDAL,
  ) {}

  /**
   * Resolve the caller's § 7 budget exemption — `users.isTemplateAuthor` (migration 115).
   *
   * ⚠️ **ONE INDEXED PK READ PER MODEL CALL**, sitting next to a ~1 s model call, so it does
   * not show up — the same trade this class already makes for re-reading the scene every turn
   * (see the header). It is deliberately NOT cached: a process-local cache would mean a grant
   * revoked on PPE kept working until the next rebuild, which is the wrong side to fail on for
   * a cost bound.
   *
   * A lookup that throws or comes back empty resolves to NOT exempt. This is a ceiling being
   * lifted, not a permission being granted, so the safe default is the learner's one.
   */
  private async budgetOptions(userId: string): Promise<IWBudgetOptions> {
    if (!this.userDAL) return {};
    try {
      const user = await this.userDAL.findById(userId);
      return { unlimited: !!user?.isTemplateAuthor };
    } catch {
      return {};
    }
  }

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

    const budgetOpts = await this.budgetOptions(userId);
    const verdict = this.budget.check(userId, request.sessionId, spoken, budgetOpts);
    if (verdict.refusal) return { kind: 'refused', refusal: verdict.refusal, remaining: verdict.remaining };

    const scene = await this.iwDAL.findSceneById(request.sceneId);
    if (!scene) return { kind: 'no-scene', sceneId: request.sceneId };

    const result = await takeNpcTurn({
      scene,
      npcId: request.npcId,
      firedCues: request.firedCues,
      playedConversations: request.playedConversations,
      perception: request.perception,
      rungs: this.rungs,
      onDelta,
    });

    // Only a turn that produced words is billed to the session (see the header).
    if (result.kind === 'reply') this.budget.spend(userId, request.sessionId);

    // ⚠️ **THE LEARNER'S LINE IS KEPT ONLY WHEN THE TURN PRODUCED A REPLY, AND THE PAIRING IS
    // WHY.** A frozen turn is a line that was said into a scene that did not answer; storing
    // the half of it we have would put an unanswered utterance in the transcript that reads
    // as an NPC ignoring the learner, which is a different — and untrue — story. The one
    // genuine gap this leaves is § 4c's no-audience case: an utterance nobody could hear
    // never reaches this endpoint at all, so nothing here can keep it.
    if (result.kind === 'reply') {
      this.transcript.record(userId, request.sessionId, { sceneId: request.sceneId, language: scene.language }, [
        ...(spoken ? [entry(IW_ACTOR_PLAYER, spoken)] : []),
        entry(request.npcId, result.reply.say),
      ]);
    }
    return { ...result, remaining: this.budget.remaining(request.sessionId, budgetOpts) };
  }

  /**
   * Render one authored direction on behalf of an authenticated learner (§ 14 Q42).
   *
   * ⚠️ **A FROZEN RENDER IS NOT BILLED AND NOT SPOKEN.** Same shape as a turn: the cap is
   * checked before the call and spent only when words came back, because a learner who got
   * nothing should not be charged for it. The difference is what the caller does with the
   * failure — a frozen TURN freezes the scene, a frozen RENDER just skips the step, because
   * the rest of the script is still perfectly playable without that one beat.
   */
  async runLine(
    userId: string,
    request: IWLineHttpRequest,
    onDelta?: (text: string, attemptIndex: number, complete: boolean) => void,
  ): Promise<IWLineRuntimeResult> {
    const refusal = this.budget.checkSceneCall(userId, await this.budgetOptions(userId));
    if (refusal) return { kind: 'refused', refusal };

    const scene = await this.iwDAL.findSceneById(request.sceneId);
    if (!scene) return { kind: 'no-scene', sceneId: request.sceneId };

    const result = await takeNpcLine({
      scene,
      npcId: request.npcId,
      direction: request.direction,
      toward: request.toward,
      perception: request.perception,
      rungs: this.rungs,
      onDelta,
    });
    if (result.kind === 'line') {
      this.budget.spendSceneCall(userId);
      // An authored beat is as much a part of the conversation as a turn is — since § 14 Q42
      // it IS generated speech, in the same voice, and a transcript missing it would read as
      // the learner talking to themselves between replies.
      this.transcript.record(userId, request.sessionId, { sceneId: request.sceneId, language: scene.language }, [entry(request.npcId, result.text)]);
    }
    return result;
  }

  /**
   * Decide which single NPC a learner's utterance was aimed at (§ 4.2).
   *
   * ⚠️ **A FAILURE HERE IS NOT AN ERROR — IT IS `npcId: null`, AND THE CLIENT ROUTES ITSELF.**
   * Every other model call in iw has a caller who needs the words; this one has a caller with
   * a perfectly good free answer already in hand (`play/addressee.ts`'s rule ladder). So a
   * dead rung, an UNCLEAR, a bad reply and a missing scene all resolve to the same thing, and
   * none of them is worth a non-200. The one case that DOES refuse is the daily cap, because
   * that is a money bound and must be visible.
   *
   * ⚠️ **BILLED ONLY WHEN IT ANSWERS.** `spendSceneCall` runs on a real id, not on UNCLEAR or
   * a timeout — the learner got no routing out of those and the fallback did the work.
   */
  async routeAddressee(userId: string, request: IWRouteHttpRequest): Promise<IWRouteRuntimeResult> {
    const refusal = this.budget.checkSceneCall(userId, await this.budgetOptions(userId));
    if (refusal) return { kind: 'refused', refusal };

    const scene = await this.iwDAL.findSceneById(request.sceneId);
    if (!scene) return { kind: 'no-scene', sceneId: request.sceneId };

    // Only bodies the scene actually contains may be routed to. The client sends ids and
    // distances; the SHEETS come from the registry here, so the roster the model reads cannot
    // be shaped by the caller — and the names, ages and trades it routes on never have to
    // cross the wire in the first place.
    const cast = request.cast.filter(m => resolveCastMember(scene, m.npcId) !== null);
    const outcome = await routeAddressee({ rungs: this.rungs ?? getIwLadder(), input: { ...request, cast } });
    if (outcome.npcId) this.budget.spendSceneCall(userId);
    return { kind: 'routed', npcId: outcome.npcId, detail: outcome.detail };
  }

  /**
   * The scenes a LEARNER may open, newest-updated first.
   *
   * ⚠️ **PUBLISHED ONLY, and that is the whole difference from the editor's list.**
   * `ImmersiveWorldSceneService.listScenes` gates on `users.isTemplateAuthor` and returns
   * drafts too, because an author has to be able to load the half-built thing they are
   * building. A learner must not, so this method exists rather than the runtime relaxing that
   * gate — the header of the authoring service asks for exactly this ("add the runtime's own
   * method"), and the two lists answer genuinely different questions.
   *
   * The filter is applied here rather than in the DAL because `published` is a POLICY about
   * who sees what, and the DAL's job is to return rows. One extra row per draft crossing a
   * process boundary is not worth a second query shape.
   */
  async listPlayableScenes(language: 'zh' | 'es'): Promise<IWSceneSummary[]> {
    const scenes = await this.iwDAL.listScenes(language);
    return scenes.filter(scene => scene.published);
  }

  /**
   * One whole scene for a learner to walk into, WITH the cast projection needed to draw it —
   * or null.
   *
   * Returns null for an UNPUBLISHED scene as well as a missing one, deliberately: the two are
   * the same fact to a learner ("there is nothing here"), and distinguishing them would let
   * anybody enumerate an author's drafts by id.
   *
   * ⚠️ It opens no RUN and draws no complication — and the RUN part is deliberate rather
   * than unbuilt. Since 2026-09-08 a run row exists, but it is opened by the first model
   * call of the session (`SceneTranscript`), not here: a scene walked into and left in
   * silence has no conversation to keep, and a GET that inserts a row is a GET a page
   * refresh can spam. The complication draw is still phase 3 (§ 12).
   */
  async openScene(sceneId: string): Promise<IWScenePlayPayload | null> {
    const scene = await this.iwDAL.findSceneById(sceneId);
    if (!scene || !scene.published) return null;
    // The cast rides along rather than being a second request: a name over a head and the
    // right body sprite are needed before the first frame is drawn, and the alternative is a
    // scene that renders as unlabelled squares for one round trip. It is the SAME projection
    // the editor's picker gets (§ 11's layer-1 boundary — no NPC prose crosses the wire).
    return {
      scene,
      npcs: npcOptionsForLanguage(scene.language),
      // Empty by construction — see the field's note. Segmenting the authored DIRECTIONS
      // would be a dictionary query over English prose nobody will ever tap.
      lineSegments: {},
    };
  }

  /**
   * Segment spoken lines for § 5.3b's tappable bubbles, keyed by the line's exact text.
   *
   * ⚠️ **IT NEVER THROWS AT A CALLER.** A dictionary that is slow, missing or broken must
   * cost the learner a popup, not a scene — and on the turn path it runs AFTER the reply has
   * already been streamed, where an exception would take down a response the learner is
   * already listening to. So the failure mode is an empty map and one log line.
   *
   * One batched query for the whole array (`DictionaryDAL.segmentTexts`), which is why the
   * scene's authored lines are collected up front rather than looked up one at a time.
   */
  async segmentLines(texts: string[], language: string): Promise<Record<string, IWLineSegments>> {
    const out: Record<string, IWLineSegments> = {};
    if (!this.dictionaryDAL || texts.length === 0) return out;
    try {
      const partsByText = await this.dictionaryDAL.segmentTexts(texts, language);
      texts.forEach((text, i) => {
        const line = partsToLineSegments(text, partsByText[i]);
        if (line) out[text] = line;
      });
    } catch (error: any) {
      console.error('[iw] line segmentation failed:', error?.message ?? error);
    }
    return out;
  }

  /**
   * A scene run ended — release its budget counter (see {@link IWTurnBudget.endSession}) and
   * close its run row.
   *
   * ⚠️ **IT TAKES A `userId` NOW.** The budget keys on the client-generated `sessionId`
   * alone, which was safe while the counter was the only thing behind it; a RUN is a row in
   * somebody's history, so the session id — a string a caller chooses — must never be the
   * whole key to one.
   */
  endSession(userId: string, sessionId: string): void {
    this.budget.endSession(sessionId);
    this.transcript.end(userId, sessionId);
  }

  /** Await a session's pending transcript writes and hand back its run id. Test seam. */
  flushTranscript(userId: string, sessionId: string): Promise<string | null> {
    return this.transcript.flush(userId, sessionId);
  }
}

/**
 * One transcript entry, stamped now.
 *
 * Free-standing rather than a method because it is the only thing the two record sites
 * share, and it has no business being on the service's surface — see `IWTranscriptEntry`
 * for why the speaker is an id and the text is not segmented.
 */
function entry(speaker: string, text: string): IWTranscriptEntry {
  return { speaker, text, at: new Date().toISOString() };
}
