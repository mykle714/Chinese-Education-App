import type { Request, Response } from 'express';
import { ImmersiveWorldService } from '../services/ImmersiveWorldService.js';
import type { CollectGoal, HeardLine, TurnStateInput } from '../services/iw/turnState.js';
import {
  IW_COLLECT_TURNS_DEFAULT, IW_MAX_ACTION_INSTRUCTION_LENGTH, IW_MAX_COLLECT_GOAL_LENGTH, IW_MAX_COLLECT_TURNS,
  type IWDestinationCandidate, type IWDestinationTarget,
} from '../contracts/iw.js';
import { IW_MAX_DEST_CANDIDATES } from '../services/iw/destinationPicker.js';
import { IW_MAX_NEARBY_BODIES, IW_MAX_UTTERANCE_CHARS } from '../services/iw/turnBudget.js';
import { getUserLanguage } from '../utils/controllerUtils.js';
import { iwFault, iwLog } from '../services/iw/iwDebugLog.js';

/**
 * Immersive World Runtime Controller — the learner-facing half of iw (§ 12 phase 2).
 *
 * LAYER: HTTP. Its siblings under `controllers/` are thin because their services do the
 * work; this one is thin in the same way but has one extra job — it speaks **SSE**, so it
 * owns a response lifecycle rather than a single `res.json`.
 *
 * ⚠️ **WHY SSE AND NOT JSON.** § 6.4 makes audio the clock, so the bubble does NOT paint
 * from the deltas in the normal case — which makes streaming look pointless. It is not, for
 * two reasons. (1) Rule 1 of § 6.4's contract fires the TTS call at `sayDone`, not at turn
 * complete; only a stream lets the client know when line 1 closed. (2) § 5.3a's timer-paced
 * fallback exists for when audio is late or absent, and that path needs deltas or it stalls
 * for the whole turn. A JSON endpoint would work today and would have to be replaced by
 * this the first time either path matters.
 *
 * ⚠️ **AN SSE STREAM CANNOT CHANGE ITS STATUS CODE.** Once headers are flushed the response
 * is 200 forever, so every refusal — budget, unknown scene, unknown NPC, a bad body — must
 * be decided and sent as an ordinary JSON error BEFORE the first write. That ordering is
 * the reason `runTurn` checks the budget before it touches a model, and the reason this
 * controller validates the body itself rather than letting the service throw mid-stream.
 *
 * ⚠️ **THE CLIENT DECIDES WHO IS ASKED, AND THE SERVER CANNOT CHECK IT** (§ 4.1, § 4.2). The
 * endpoint takes one npcId; which one is the client's routing decision (`chooseAddressee`), so
 * a caller can ask for a turn from anybody in any scene. Earshot was the notional check and was
 * never enforceable here either (§ 4, withdrawn 2026-09-07). `ImmersiveWorldService` documents
 * this; the bound is § 7's budget, which is why the caps here are not optional.
 *
 * One thing DID improve on 2026-09-07: the client used to send N of these per utterance, so the
 * session counter drained N× too fast (§ 7). Routing means one utterance is one request, and
 * the number the learner is shown is now correct.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 5.2, § 5.3a, § 6.4, § 7, § 8, § 12 phase 2.
 */
export class ImmersiveWorldRuntimeController {
  constructor(private readonly service: ImmersiveWorldService) {}

  /** The authenticated user id, answering 401 itself when there isn't one. */
  private userIdOr401(req: Request, res: Response): string | null {
    const userId = (req as any).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'User not authenticated', code: 'ERR_NOT_AUTHENTICATED' });
      return null;
    }
    return userId;
  }

  /**
   * GET /api/immersiveWorld/play/scenes → `{ scenes: IWSceneSummary[] }`
   *
   * The learner's list: PUBLISHED scenes in the language they are studying. It takes no
   * `?language=` — the editor's list does, because an author works across languages, whereas
   * a learner has exactly one active language and letting the client name it would be a way
   * to walk into a cast that does not speak to them.
   */
  async listScenes(req: Request, res: Response): Promise<void> {
    const userId = this.userIdOr401(req, res);
    if (!userId) return;
    const language = await getUserLanguage(userId);
    // iw has a cast for zh and es only (§ 14 Q8). Any other study language has no world yet,
    // which is an empty list rather than an error — the row simply offers nothing to open.
    if (language !== 'zh' && language !== 'es') {
      res.json({ scenes: [], language });
      return;
    }
    res.json({ scenes: await this.service.listPlayableScenes(language), language });
  }

  /**
   * GET /api/immersiveWorld/play/scenes/:id → `{ scene: IWScene, npcs: IWNpcOption[] }`
   *
   * The whole scene, once, at scene start — the read migration 158 shaped the five jsonb
   * columns around. 404 covers both "no such scene" and "not published"; see `openScene`.
   */
  async getScene(req: Request, res: Response): Promise<void> {
    const userId = this.userIdOr401(req, res);
    if (!userId) return;
    const payload = await this.service.openScene(req.params.id);
    if (!payload) {
      res.status(404).json({ error: 'Scene not found', code: 'ERR_IW_SCENE_NOT_FOUND' });
      return;
    }
    res.json(payload);
  }

  /**
   * POST /api/immersiveWorld/turn → `text/event-stream`
   *
   * Events, in order: any number of `delta`, then exactly one of `reply` | `frozen`, then
   * `end`. A client that only wants the answer can ignore `delta` entirely and still be
   * correct — the terminal event carries the whole reply.
   */
  async takeTurn(req: Request, res: Response): Promise<void> {
    const userId = this.userIdOr401(req, res);
    if (!userId) return;

    const parsed = parseTurnBody(req.body);
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error, code: 'ERR_IW_TURN_BAD_REQUEST' });
      return;
    }

    // Everything above this line can still answer with a status code. Nothing below can.
    const stream = openStream(req, res);
    const { send } = stream;

    iwLog('turn', `→ user=${userId} scene=${parsed.request.sceneId} npc=${parsed.request.npcId}`, {
      sessionId: parsed.request.sessionId,
      firedCues: parsed.request.firedCues,
      playedConversations: parsed.request.playedConversations,
      event: parsed.request.perception.event,
    });

    try {
      const result = await this.service.runTurn(userId, parsed.request, (say, attemptIndex, speechComplete) => {
        // `attemptIndex` changes when the ladder moves to another rung, and the client MUST
        // reset the bubble when it does — a dead rung's three characters are not the start
        // of the live rung's sentence (§ 14 Q7).
        if (!stream.gone) send('delta', { say, attemptIndex, speechComplete });
      });

      if (result.kind === 'refused') {
        // Refusals are the one branch that can still be a status code, because nothing has
        // been written yet: `runTurn` checks the budget before it opens a model call, and
        // no delta can precede a refusal.
        if (!stream.opened) {
          res.status(429).json({
            error: refusalMessage(result.refusal),
            code: 'ERR_IW_BUDGET',
            refusal: result.refusal,
            remaining: result.remaining,
          });
          return;
        }
        iwLog('turn', `refused code=${result.refusal.code} (mid-stream)`, result.refusal);
        send('refused', result);
      } else if (result.kind === 'no-scene') {
        // ⚠️ Not a refusal — the client and the server disagree about what exists. It travels
        // on the `refused` event only because an open stream has no other channel, and it
        // carries no `refusal.code`, so the learner sees the generic "Not right now." banner.
        iwFault('turn', `no-scene sceneId=${result.sceneId} — the client is holding a scene id that does not resolve`);
        if (!stream.opened) {
          res.status(404).json({ error: 'Scene not found', code: 'ERR_IW_SCENE_NOT_FOUND' });
          return;
        }
        send('refused', result);
      } else if (result.kind === 'reply') {
        iwLog('turn', `reply npc=${parsed.request.npcId} rung=${result.rung} remaining=${result.remaining}`, {
          say: result.reply.say, action: result.reply.action, emote: result.reply.emote, rescued: result.reply.rescued,
        });
        send('reply', {
          say: result.reply.say,
          action: result.reply.action,
          emote: result.reply.emote,
          rescued: result.reply.rescued,
          // Only meaningful when the client sent `perception.collect`; false otherwise, which
          // is what a client that never collects already ignores (§ 5.4).
          collected: result.reply.collected,
          chosen: result.chosen,
          rung: result.rung,
          remaining: result.remaining,
        });
        // § 5.3b — the tap-to-look-up data for the line just sent, as a SEPARATE, LATER
        // event. The ordering is the whole design: `reply` is what starts the TTS call and
        // the reveal (§ 6.4), so a dictionary round trip in front of it would be added
        // straight onto the 516 ms first-glyph figure phase 0 exists to protect. Sent after,
        // it lands during the reveal and the bubble upgrades from plain text to tappable
        // segments mid-sentence — or never, and stays exactly as it was before this existed.
        if (!stream.gone) {
          const language = await getUserLanguage(userId);
          const segmented = await this.service.segmentLines([result.reply.say], language);
          const line = segmented[result.reply.say];
          if (line && !stream.gone) send('segments', { say: result.reply.say, line });
        }
      } else if (result.kind === 'frozen') {
        iwFault('turn', `frozen npc=${parsed.request.npcId} — every rung of the ladder failed`, result.attempts);
        // § 14 Q7: no speech, no emote, no improvised cover line. The client freezes the
        // scene and shows a banner; it must NOT substitute anything of its own.
        send('frozen', { attempts: result.attempts, remaining: result.remaining });
      } else {
        // ⚠️ Same shape as `no-scene`: a FAULT on the refusal channel, with no code, so the
        // learner is told "Not right now." for what is really "that NPC is not in this
        // scene's cast, or the registry no longer defines him". The two halves of the check
        // live in `takeNpcTurn`; this is the only place the id is still in scope to name.
        iwFault('turn', `unknown-npc npcId=${result.npcId} scene=${parsed.request.sceneId} — not cast in this scene, or not in iwNpcs.ts`);
        send('refused', { kind: 'unknown-npc', npcId: result.npcId });
      }
    } catch (error: any) {
      // An escaped error after headers are out can only be reported inside the stream.
      if (stream.opened) send('frozen', { attempts: [], error: 'internal' });
      else {
        res.status(500).json({ error: 'Failed to take turn', code: 'ERR_IW_TURN_FAILED' });
        return;
      }
      console.error('[iw] turn failed:', error?.message ?? error);
    }

    send('end', {});
    res.end();
  }

  /**
   * Decide who the learner was talking to (§ 4.2). **Plain JSON, not SSE.**
   *
   * ⚠️ **THE ONE IW MODEL ENDPOINT THAT DOES NOT STREAM**, and the reason is the shape of the
   * answer rather than an oversight: a turn and a render both produce text a learner watches
   * appear, so the stream IS the feature; a route produces one identifier nobody sees. Opening
   * an SSE channel to deliver a single token would buy nothing and cost the client a parser.
   *
   * ⚠️ **IT NEVER 500s ON A ROUTING FAILURE.** A dead model, an UNCLEAR and an unresolvable
   * scene all come back `200 {"npcId": null}`, because the client has a free fallback for all
   * three and an error would only make it write one. The single non-200 is the daily cap (429),
   * which is a money bound and must be seen.
   */
  async routeAddressee(req: Request, res: Response): Promise<void> {
    const userId = this.userIdOr401(req, res);
    if (!userId) return;

    const parsed = parseRouteBody(req.body);
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error, code: 'ERR_IW_TURN_BAD_REQUEST' });
      return;
    }

    try {
      const result = await this.service.routeAddressee(userId, parsed.request);
      if (result.kind === 'refused') {
        res.status(429).json({
          error: refusalMessage(result.refusal),
          code: 'ERR_IW_BUDGET',
          refusal: result.refusal,
        });
        return;
      }
      if (result.kind === 'no-scene') {
        iwFault('route', `no-scene sceneId=${result.sceneId} — the client is holding a scene id that does not resolve`);
        res.json({ npcId: null, detail: 'no such scene' });
        return;
      }
      iwLog('route', `→ ${result.npcId ?? '(unclear)'} — ${result.detail}`, {
        utterance: parsed.request.utterance,
        cast: parsed.request.cast.map(m => m.npcId),
      });
      res.json({ npcId: result.npcId, detail: result.detail });
    } catch (error) {
      // Same rule as above: the caller can route itself, so a thrown router is a null answer
      // rather than an error. Logged loudly, because a router that always throws is invisible
      // from the outside — the scene keeps working on the fallback and nobody notices.
      iwFault('route', 'router threw — falling back to the client rules', error);
      res.json({ npcId: null, detail: 'router failed' });
    }
  }

  /**
   * POST /api/immersiveWorld/segment → `{ line: IWLineSegments | null }`
   *
   * The learner's OWN utterance, segmented for § 5.3b — the same treatment an NPC's line gets
   * on the turn stream, and for the same two reasons: pinyin over the characters, and a
   * tappable popup on every word.
   *
   * ⚠️ **IT IS A SEPARATE ROUND TRIP, NOT AN EVENT ON `/turn`, BECAUSE OF WHEN IT IS NEEDED.**
   * The learner's bubble goes up the instant they press Say, and it is REPLACED by the NPC's
   * bubble the moment the reply lands — so segmentation that arrived on the turn stream would
   * arrive after the only bubble it describes had gone. Firing it alongside the turn is what
   * makes it land while the learner's own words are still on screen. It also has to work for a
   * line that takes no turn at all (nobody was addressed).
   *
   * ⚠️ **PLAIN JSON, LIKE `/addressee`** — there is nothing to stream, and no failure here is
   * worth a status code the caller would act on: a null line is a bubble that renders exactly
   * as it did before this existed.
   */
  async segmentUtterance(req: Request, res: Response): Promise<void> {
    const userId = this.userIdOr401(req, res);
    if (!userId) return;

    const raw = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    // The same cap the turn enforces (§ 7). Not a courtesy: this opens a dictionary query, so
    // an unbounded string is an unbounded query.
    if (!raw || [...raw].length > IW_MAX_UTTERANCE_CHARS) {
      res.status(400).json({ error: 'text is required', code: 'ERR_IW_TURN_BAD_REQUEST' });
      return;
    }

    const language = await getUserLanguage(userId);
    // `segmentLines` never throws — a dictionary problem costs the learner a popup, not a line.
    const segmented = await this.service.segmentLines([raw], language);
    res.json({ line: segmented[raw] ?? null });
  }

  /**
   * POST /api/immersiveWorld/destination → `{ target: IWDestinationTarget | null, detail }`
   *
   * Where an `ai_walk` step sends its performer (§ 5.4, 2026-09-23). **Plain JSON**, for the
   * router's reason: the answer is one identifier nobody watches appear.
   *
   * ⚠️ **IT NEVER 500s ON A PICKING FAILURE.** A dead model, a NONE and a missing scene all
   * come back `200 {"target": null}` — the client skips the walk for all of them. The single
   * non-200 is the daily cap (429), because that is a money bound and must be visible.
   */
  async pickDestination(req: Request, res: Response): Promise<void> {
    const userId = this.userIdOr401(req, res);
    if (!userId) return;

    const parsed = parseDestinationBody(req.body);
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error, code: 'ERR_IW_TURN_BAD_REQUEST' });
      return;
    }

    try {
      const result = await this.service.pickDestination(userId, parsed.request);
      if (result.kind === 'refused') {
        res.status(429).json({
          error: refusalMessage(result.refusal),
          code: 'ERR_IW_BUDGET',
          refusal: result.refusal,
        });
        return;
      }
      if (result.kind === 'no-scene') {
        iwFault('destination', `no-scene sceneId=${result.sceneId} — the client is holding a scene id that does not resolve`);
        res.json({ target: null, detail: 'no such scene' });
        return;
      }
      iwLog('destination', `${parsed.request.npcId} → ${describeTarget(result.target)} — ${result.detail}`, {
        brief: parsed.request.brief,
        candidates: parsed.request.candidates.length,
      });
      res.json({ target: result.target, detail: result.detail });
    } catch (error) {
      // Logged loudly for the router's reason: a picker that always throws is invisible from
      // outside — every ai_walk just quietly stops walking.
      iwFault('destination', 'picker threw — the walk is skipped', error);
      res.json({ target: null, detail: 'picker failed' });
    }
  }

  /**
   * POST /api/immersiveWorld/line → `text/event-stream`
   *
   * The authored half of the world speaking (§ 14 Q42). Same event vocabulary as `takeTurn`
   * — any number of `delta`, then one of `line` | `frozen` | `refused`, then `end` — so the
   * client's transport is one reader rather than two.
   *
   * ⚠️ **`frozen` HERE DOES NOT MEAN THE SAME THING IT MEANS ON A TURN.** A frozen turn
   * freezes the scene and shows a banner, because the learner said something and got nothing
   * back. A frozen render means one authored beat could not be put into words; the script
   * skips it and plays on. The client must not treat them alike, and the two live on
   * different routes partly so that difference is impossible to miss.
   */
  async renderLine(req: Request, res: Response): Promise<void> {
    const userId = this.userIdOr401(req, res);
    if (!userId) return;

    const parsed = parseLineBody(req.body);
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error, code: 'ERR_IW_TURN_BAD_REQUEST' });
      return;
    }

    const stream = openStream(req, res);
    const { send } = stream;

    iwLog('line', `→ user=${userId} scene=${parsed.request.sceneId} npc=${parsed.request.npcId}`, {
      direction: parsed.request.direction,
      toward: parsed.request.toward,
    });

    try {
      const result = await this.service.runLine(userId, parsed.request, (text, attemptIndex, complete) => {
        if (!stream.gone) send('delta', { say: text, attemptIndex, speechComplete: complete });
      });

      if (result.kind === 'refused') {
        if (!stream.opened) {
          res.status(429).json({
            error: refusalMessage(result.refusal),
            code: 'ERR_IW_BUDGET',
            refusal: result.refusal,
          });
          return;
        }
        send('refused', result);
      } else if (result.kind === 'no-scene') {
        iwFault('line', `no-scene sceneId=${result.sceneId} — the client is holding a scene id that does not resolve`);
        if (!stream.opened) {
          res.status(404).json({ error: 'Scene not found', code: 'ERR_IW_SCENE_NOT_FOUND' });
          return;
        }
        send('refused', result);
      } else if (result.kind === 'line') {
        iwLog('line', `${parsed.request.npcId} rung=${result.rung}: ${result.text}`, {
          direction: parsed.request.direction,
        });
        send('line', { say: result.text, rung: result.rung });
        // Identical to the turn path, and deliberately so: § 5.3b's tappable bubble must not
        // depend on WHICH kind of call produced the line, or an authored beat would be the
        // one place in the scene a learner cannot look a word up.
        if (!stream.gone) {
          const language = await getUserLanguage(userId);
          const segmented = await this.service.segmentLines([result.text], language);
          const line = segmented[result.text];
          if (line && !stream.gone) send('segments', { say: result.text, line });
        }
      } else if (result.kind === 'frozen') {
        // NOT a scene freeze — see the header. The client skips the step.
        iwFault('line', `frozen npc=${parsed.request.npcId} — every rung failed to render an authored line`, result.attempts);
        send('frozen', { attempts: result.attempts });
      } else {
        iwFault('line', `unknown-npc npcId=${result.npcId} scene=${parsed.request.sceneId} — not cast in this scene, or not in iwNpcs.ts`);
        send('refused', { kind: 'unknown-npc', npcId: result.npcId });
      }
    } catch (error: any) {
      if (stream.opened) send('frozen', { attempts: [], error: 'internal' });
      else {
        res.status(500).json({ error: 'Failed to render line', code: 'ERR_IW_LINE_FAILED' });
        return;
      }
      console.error('[iw] line render failed:', error?.message ?? error);
    }

    send('end', {});
    res.end();
  }

  /**
   * POST /api/immersiveWorld/session/end — release a finished run's budget counter and close
   * its transcript row (§ 12 phase 3).
   *
   * ⚠️ **THE CLIENT SENDS THIS WITH `keepalive`, ON UNMOUNT, AND IT IS ALLOWED TO NEVER
   * ARRIVE.** A learner who kills the tab hard leaves the run OPEN; it is closed and
   * displaced by the next run they start in that language (`openRun`), so the durable state
   * is self-healing and this endpoint is an optimisation rather than a requirement.
   */
  async endSession(req: Request, res: Response): Promise<void> {
    const userId = this.userIdOr401(req, res);
    if (!userId) return;
    const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : '';
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required', code: 'ERR_IW_TURN_BAD_REQUEST' });
      return;
    }
    this.service.endSession(userId, sessionId);
    res.json({ ok: true });
  }
}

/**
 * Open an SSE response, lazily.
 *
 * ⚠️ **`opened` IS THE WHOLE POINT.** Once headers flush the response is 200 forever, so
 * every caller has to know whether it may still answer with a status code. Writing the first
 * event is what commits; until then a refusal can still be a 429 or a 404. Two endpoints now
 * need exactly this dance, and copying it was how one of them would eventually get it wrong.
 *
 * `gone` tracks a client that navigated away. The model call is deliberately allowed to
 * finish — it is already billed, and aborting it buys nothing.
 */
function openStream(req: Request, res: Response): {
  send(event: string, data: unknown): void;
  readonly opened: boolean;
  readonly gone: boolean;
} {
  let opened = false;
  let gone = false;
  req.on('close', () => { gone = true; });
  return {
    get opened() { return opened; },
    get gone() { return gone; },
    send(event, data) {
      if (!opened) {
        opened = true;
        res.status(200);
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        // nginx buffers proxied responses by default, which would hold every delta until the
        // call finished and silently undo the whole point of streaming.
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();
      }
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
  };
}

/** A refusal in a sentence, for a client with nowhere better to put it. */
function refusalMessage(refusal: { code: string }): string {
  switch (refusal.code) {
    case 'utterance-too-long': return `Say a bit less — ${IW_MAX_UTTERANCE_CHARS} characters at a time.`;
    case 'too-fast': return 'Slow down a moment.';
    case 'session-spent': return 'The market is closing.';
    case 'daily-cap': return "That's enough for today.";
    default: return 'Not right now.';
  }
}

/**
 * Validate the request body into the service's shape.
 *
 * ⚠️ **IT IS NOT A SCHEMA VALIDATOR AND MUST NOT BECOME ONE.** What it guarantees is that
 * every field the service and the prompt READ is present and of the right primitive type,
 * because the alternative is a `TypeError` thrown halfway through a stream that has already
 * sent its headers. Fields the prompt merely quotes (`nearby` labels, `heard` lines) are
 * bounded rather than parsed — § 11 makes quoting untrusted text safe by construction, and
 * a strict schema here would reject a future client for adding a field.
 */
function parseTurnBody(body: any): { request: import('../services/ImmersiveWorldService.js').IWTurnHttpRequest } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'A JSON body is required' };
  const { sceneId, sessionId, npcId } = body;
  if (typeof sceneId !== 'string' || !sceneId) return { error: 'sceneId is required' };
  if (typeof sessionId !== 'string' || !sessionId) return { error: 'sessionId is required' };
  if (typeof npcId !== 'string' || !npcId) return { error: 'npcId is required' };

  const p = body.perception;
  if (!p || typeof p !== 'object') return { error: 'perception is required' };
  const event = p.event;
  if (!event || typeof event !== 'object' || typeof event.kind !== 'string') {
    return { error: 'perception.event is required' };
  }
  if (event.kind === 'utterance' && typeof event.text !== 'string') {
    return { error: 'perception.event.text is required for an utterance' };
  }

  const perception: Omit<TurnStateInput, 'offers'> = {
    ...parsePerception(p),
    event,
    spokeLastTurn: Boolean(p.spokeLastTurn),
    collect: parseCollect(p.collect),
  };

  return {
    request: {
      sceneId,
      sessionId,
      npcId,
      firedCues: strings(body.firedCues),
      playedConversations: strings(body.playedConversations),
      perception,
    },
  };
}

/**
 * Validate a line-render body (§ 14 Q42).
 *
 * The same "not a schema validator" contract as {@link parseTurnBody}, and it shares that
 * function's perception parsing — the two calls send the same perception because they must
 * see the same world (`renderContextSections` is literally shared), so parsing it twice by
 * hand would be the first place the two drifted.
 */
/**
 * The router's body (§ 4.2).
 *
 * ⚠️ **THE CLIENT SENDS IDS, NOT CHARACTERS.** Names, ages, trades and biographies are looked
 * up server-side from the registry, so a caller cannot describe an NPC into the router's
 * roster — and the sheets never cross the wire to do a job the server can do without them.
 * Same "not a schema validator" contract as {@link parseTurnBody}: reject what would produce a
 * nonsense prompt, coerce what would merely be untidy.
 */
function parseRouteBody(body: any): { request: import('../services/ImmersiveWorldService.js').IWRouteHttpRequest } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'A JSON body is required' };
  const { sceneId, utterance } = body;
  if (typeof sceneId !== 'string' || !sceneId) return { error: 'sceneId is required' };
  if (typeof utterance !== 'string' || !utterance.trim()) return { error: 'utterance is required' };
  if (!Array.isArray(body.cast) || body.cast.length === 0) return { error: 'cast is required' };
  // ⚠️ NO LENGTH CAP, BUT DEDUPED (2026-09-23). The router is shown the whole scene cast now
  // that there is no hearing gate (§ 4c withdrawn) — a cap would hide the farthest NPC from a
  // learner naming them. The real bound is the scene: `ImmersiveWorldService` drops any id
  // that is not one of its members. Deduping is what makes that bound hold against a crafted
  // body that repeats one real id a thousand times.
  const seen = new Set<string>();
  const cast = body.cast
    .filter((m: any) => m && typeof m.npcId === 'string' && m.npcId && !seen.has(m.npcId) && seen.add(m.npcId))
    .map((m: any) => ({
      npcId: m.npcId,
      distance: Number.isFinite(m.distance) ? Math.max(0, Math.trunc(m.distance)) : 0,
      // Geometry the client measured. Coerced rather than trusted as typed, for the same
      // reason `distance` is clamped: this is an HTTP body, and `=== true` is the whole
      // validation a boolean needs.
      facedByLearner: m.facedByLearner === true,
      facingLearner: m.facingLearner === true,
      focused: m.focused === true,
      spokeLast: m.spokeLast === true,
    }));
  if (cast.length === 0) return { error: 'cast is required' };
  return {
    request: {
      sceneId,
      // The same cap a turn puts on the prompt (§ 7) — the router quotes the learner verbatim
      // too, so an unbounded utterance is an unbounded call here as well.
      utterance: [...utterance.trim()].slice(0, IW_MAX_UTTERANCE_CHARS).join(''),
      cast,
      heard: Array.isArray(body.heard) ? body.heard.filter((h: any) => typeof h === 'string').slice(-8) : [],
    },
  };
}

/**
 * The destination picker's body (§ 5.4's `ai_walk`).
 *
 * Same "not a schema validator" contract as {@link parseTurnBody}. Candidates are coerced to
 * the two target shapes and bounded; whether each one belongs to the scene is the SERVICE's
 * check (`resolveCandidates`), because that needs the scene row and this does not have it.
 */
function parseDestinationBody(body: any): { request: import('../services/ImmersiveWorldService.js').IWDestinationHttpRequest } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'A JSON body is required' };
  const { sceneId, npcId, brief } = body;
  if (typeof sceneId !== 'string' || !sceneId) return { error: 'sceneId is required' };
  if (typeof npcId !== 'string' || !npcId) return { error: 'npcId is required' };
  if (typeof brief !== 'string' || !brief.trim()) return { error: 'brief is required' };
  if (!Array.isArray(body.candidates)) return { error: 'candidates is required' };

  const candidates: IWDestinationCandidate[] = [];
  for (const c of body.candidates.slice(0, IW_MAX_DEST_CANDIDATES * 2)) {
    if (!c || typeof c !== 'object') continue;
    const distance = Number.isFinite(c.distance) ? Math.max(0, Math.trunc(c.distance)) : 0;
    if (c.kind === 'place' && typeof c.tag === 'string' && c.tag) {
      candidates.push({ kind: 'place', tag: c.tag, distance });
    } else if (c.kind === 'actor' && typeof c.actorId === 'string' && c.actorId) {
      candidates.push({ kind: 'actor', actorId: c.actorId, distance });
    }
  }

  return {
    request: {
      sceneId,
      npcId,
      brief: brief.trim().slice(0, IW_MAX_ACTION_INSTRUCTION_LENGTH),
      candidates,
      heard: heardLines(body.heard),
    },
  };
}

/** A target in a log line. */
function describeTarget(target: IWDestinationTarget | null): string {
  if (!target) return '(nowhere)';
  return target.kind === 'place' ? `place "${target.tag}"` : `actor ${target.actorId}`;
}

function parseLineBody(body: any): { request: import('../services/ImmersiveWorldService.js').IWLineHttpRequest } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'A JSON body is required' };
  const { sceneId, sessionId, npcId, direction, toward } = body;
  if (typeof sceneId !== 'string' || !sceneId) return { error: 'sceneId is required' };
  if (typeof sessionId !== 'string' || !sessionId) return { error: 'sessionId is required' };
  if (typeof npcId !== 'string' || !npcId) return { error: 'npcId is required' };
  // ⚠️ NO LONGER REQUIRED (2026-09-19). An unbriefed `prompt_npc` cue legitimately sends
  // none — "say whatever this moment calls for" — so only a direction of the WRONG TYPE is a
  // bad request. Absent and empty collapse to the same thing the render path calls "no brief".
  if (direction !== undefined && typeof direction !== 'string') return { error: 'direction must be a string' };
  if (!body.perception || typeof body.perception !== 'object') return { error: 'perception is required' };

  return {
    request: {
      sceneId,
      sessionId,
      npcId,
      // Bounded for the same reason the learner's utterance is: it is content reaching a
      // prompt. An author typed it, which makes it a little more trusted and not unbounded.
      direction: direction?.trim() ? direction.trim().slice(0, 400) : undefined,
      toward: typeof toward === 'string' && toward.trim() ? toward.trim().slice(0, 80) : undefined,
      perception: parsePerception(body.perception),
    },
  };
}

/**
 * The perception block, shared by both endpoints.
 *
 * Caps are the server side of § 4.1's cost story: the client assembles this block and cannot
 * be trusted, and an uncapped list is an uncapped prompt.
 */
function parsePerception(p: any): import('../services/iw/turnState.js').IWContextInput {
  return {
    knownWords: strings(p.knownWords),
    nearby: Array.isArray(p.nearby) ? p.nearby.slice(0, IW_MAX_NEARBY_BODIES) : [],
    heard: heardLines(p.heard),
    holding: holdingList(p.holding),
  };
}

/**
 * `heard`, normalized to the prompt's `{ speaker, text }` shape (`turnState.ts` → `HeardLine`).
 *
 * ⚠️ **THE CLIENT SENDS STRINGS, AND FOR A WHILE NOTHING NOTICED** (found 2026-09-23). The
 * runtime keeps memory as pre-labelled lines — `"the customer: 你好"` (`useIWSceneRuntime`'s
 * `heardRef`) — and this used to pass them straight through as if they were `HeardLine`
 * objects. `renderContextSections` then printed every one as `undefined said: "undefined"`,
 * so in live play every NPC turn and every authored line was written with NO memory of the
 * scene. The bench never saw it because it builds `HeardLine` objects directly.
 *
 * Both shapes are accepted: a string is split at its FIRST `": "` (a label never contains
 * one; Chinese speech uses the full-width `：`, so a colon inside the line survives), and an
 * object is taken field by field. Anything else is dropped. Bounded like every other list here.
 */
export function heardLines(value: unknown): HeardLine[] {
  if (!Array.isArray(value)) return [];
  const out: HeardLine[] = [];
  for (const h of value.slice(-12)) {
    if (typeof h === 'string') {
      const at = h.indexOf(': ');
      if (at > 0) out.push({ speaker: h.slice(0, at).slice(0, 80), text: h.slice(at + 2).slice(0, IW_MAX_UTTERANCE_CHARS * 2) });
      else if (h.trim()) out.push({ speaker: 'somebody', text: h.slice(0, IW_MAX_UTTERANCE_CHARS * 2) });
    } else if (h && typeof h === 'object' && typeof (h as any).speaker === 'string' && typeof (h as any).text === 'string') {
      out.push({ speaker: (h as any).speaker.slice(0, 80), text: (h as any).text.slice(0, IW_MAX_UTTERANCE_CHARS * 2) });
    }
  }
  return out;
}

/**
 * `holding`, normalized to the prompt's list shape — or undefined, which renders as nothing.
 *
 * Accepts a bare string as a one-item list because that is what the client's older
 * `IWPerception` type declared; an empty list becomes undefined so `renderTurnState` omits
 * the line entirely rather than printing an empty bullet.
 */
function holdingList(value: unknown): string[] | undefined {
  if (typeof value === 'string') return value.trim() ? [value] : undefined;
  const items = strings(value);
  return items.length ? items : undefined;
}

/**
 * The `get_information` errand this NPC is in the middle of, or undefined (§ 5.4).
 *
 * Clamped rather than rejected, in the same spirit as the rest of this file: a bad `attempt`
 * from a future or broken client should cost the prompt a line of pressure, never a 400 in
 * front of somebody mid-sentence. An empty goal is dropped entirely — with nothing to ask
 * for, the block would render as an instruction to find out nothing.
 */
function parseCollect(value: unknown): CollectGoal | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as { goal?: unknown; attempt?: unknown; maxTurns?: unknown };
  const goal = typeof raw.goal === 'string' ? raw.goal.trim().slice(0, IW_MAX_COLLECT_GOAL_LENGTH) : '';
  if (!goal) return undefined;
  const clamp = (n: unknown, lo: number, hi: number, fallback: number): number =>
    (typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback);
  return {
    goal,
    attempt: clamp(raw.attempt, 1, IW_MAX_COLLECT_TURNS, 1),
    maxTurns: clamp(raw.maxTurns, 1, IW_MAX_COLLECT_TURNS, IW_COLLECT_TURNS_DEFAULT),
  };
}

/** Every string in an unknown array, or an empty list. Never throws on a hostile body. */
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}
