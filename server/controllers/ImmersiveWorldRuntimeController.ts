import type { Request, Response } from 'express';
import { ImmersiveWorldService } from '../services/ImmersiveWorldService.js';
import type { TurnStateInput } from '../services/iw/turnState.js';
import { IW_MAX_LISTENERS_PER_UTTERANCE, IW_MAX_UTTERANCE_CHARS } from '../services/iw/turnBudget.js';

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
 * ⚠️ **THE CLIENT IS TRUSTED ABOUT EARSHOT** (§ 4, § 4.1). The hearing gate is pure client
 * geometry, so a caller can claim any NPC heard them. `ImmersiveWorldService` documents
 * this; the bound is § 7's budget, which is why the caps here are not optional.
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
    let opened = false;
    const open = (): void => {
      if (opened) return;
      opened = true;
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      // nginx buffers proxied responses by default, which would hold every delta until the
      // turn finished and silently undo the whole point of streaming.
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();
    };
    const send = (event: string, data: unknown): void => {
      open();
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // A client that navigates away mid-turn: stop writing, but let the model call finish —
    // it is already billed, and aborting it buys nothing.
    let gone = false;
    req.on('close', () => { gone = true; });

    try {
      const result = await this.service.runTurn(userId, parsed.request, (say, attemptIndex, speechComplete) => {
        // `attemptIndex` changes when the ladder moves to another rung, and the client MUST
        // reset the bubble when it does — a dead rung's three characters are not the start
        // of the live rung's sentence (§ 14 Q7).
        if (!gone) send('delta', { say, attemptIndex, speechComplete });
      });

      if (result.kind === 'refused') {
        // Refusals are the one branch that can still be a status code, because nothing has
        // been written yet: `runTurn` checks the budget before it opens a model call, and
        // no delta can precede a refusal.
        if (!opened) {
          res.status(429).json({
            error: refusalMessage(result.refusal),
            code: 'ERR_IW_BUDGET',
            refusal: result.refusal,
            remaining: result.remaining,
          });
          return;
        }
        send('refused', result);
      } else if (result.kind === 'no-scene') {
        if (!opened) {
          res.status(404).json({ error: 'Scene not found', code: 'ERR_IW_SCENE_NOT_FOUND' });
          return;
        }
        send('refused', result);
      } else if (result.kind === 'reply') {
        send('reply', {
          say: result.reply.say,
          action: result.reply.action,
          emote: result.reply.emote,
          rescued: result.reply.rescued,
          chosen: result.chosen,
          rung: result.rung,
          remaining: result.remaining,
        });
      } else if (result.kind === 'frozen') {
        // § 14 Q7: no speech, no emote, no improvised cover line. The client freezes the
        // scene and shows a banner; it must NOT substitute anything of its own.
        send('frozen', { attempts: result.attempts, remaining: result.remaining });
      } else {
        send('refused', { kind: 'unknown-npc', npcId: result.npcId });
      }
    } catch (error: any) {
      // An escaped error after headers are out can only be reported inside the stream.
      if (opened) send('frozen', { attempts: [], error: 'internal' });
      else {
        res.status(500).json({ error: 'Failed to take turn', code: 'ERR_IW_TURN_FAILED' });
        return;
      }
      console.error('[iw] turn failed:', error?.message ?? error);
    }

    send('end', {});
    res.end();
  }

  /** POST /api/immersiveWorld/session/end — release a finished run's budget counter. */
  async endSession(req: Request, res: Response): Promise<void> {
    const userId = this.userIdOr401(req, res);
    if (!userId) return;
    const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : '';
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required', code: 'ERR_IW_TURN_BAD_REQUEST' });
      return;
    }
    this.service.endSession(sessionId);
    res.json({ ok: true });
  }
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
    knownWords: strings(p.knownWords),
    // `nearby` is what the client's hearing gate produced. Capping it here is the server
    // side of § 4.1's cost story: the gate itself is client-side and cannot be trusted, and
    // an uncapped list is an uncapped prompt.
    nearby: Array.isArray(p.nearby) ? p.nearby.slice(0, IW_MAX_LISTENERS_PER_UTTERANCE * 3) : [],
    heard: Array.isArray(p.heard) ? p.heard.slice(0, 12) : [],
    holding: typeof p.holding === 'string' ? p.holding : undefined,
    event,
    spokeLastTurn: Boolean(p.spokeLastTurn),
  };

  return {
    request: {
      sceneId,
      sessionId,
      npcId,
      firedCues: strings(body.firedCues),
      perception,
    },
  };
}

/** Every string in an unknown array, or an empty list. Never throws on a hostile body. */
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}
