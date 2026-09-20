import { apiPost, apiPostStream, type SseEvent } from '../../api/http';
import { iwLog, iwWarn } from './iwDebugLog';
import type { IWEmote, IWLineSegments, IWVolume } from '../../../server/contracts/iw';

/**
 * immersiveWorldTurnApi — the client half of the RUNTIME endpoint (§ 12 phase 2).
 *
 * LAYER: feature API module. Its sibling `immersiveWorldSceneApi.ts` covers AUTHORING; the
 * two are split the same way their services are, by lifecycle rather than by subject.
 *
 * ⚠️ **NO FUNCTION HERE TAKES A `token`** (FRONTEND_LAYERING). The Authorization header is
 * read at call time inside `api/http.ts`, so a silent refresh never changes a caller's
 * function identity — which is the rule that stops a mid-scene token rotation from resetting
 * a conversation the way it once reset a Word Search board.
 *
 * ⚠️ **THE TURN IS A STREAM, AND THE TERMINAL EVENT IS THE ANSWER.** A caller that ignores
 * `onDelta` entirely is still correct: `reply` carries the whole utterance. The deltas exist
 * for two specific things (§ 6.4 rule 1, § 5.3a's timer-paced fallback) and for nothing else
 * — in the normal case the bubble is painted by the AUDIO clock, not by the network.
 *
 * ⚠️ **`attemptIndex` IS NOT DECORATION.** It changes when Q7's ladder moves to another rung,
 * and a caller showing partial text MUST clear what it has when it does: a dead rung's three
 * characters are not the beginning of the live rung's sentence.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 5.2, § 5.3a, § 6.4, § 7, § 12 phase 2.
 */

/** What the client believes this NPC can perceive. The server trusts it — see § 4.1. */
export interface IWPerception {
  /** The learner's vocabulary, so the NPC speaks words they can read (§ 9.4). */
  knownWords: string[];
  /** Who is within earshot, nearest first — the client-side hearing gate's output (§ 4). */
  nearby: Array<{ label: string; distance: number; facingYou: boolean }>;
  /** Recent lines this NPC heard, for continuity. */
  heard: string[];
  /**
   * What the NPC is holding, in their own terms — a LIST, matching the prompt's shape
   * (`TurnStateInput.holding`). It was typed as a single string until 2026-09-06, which the
   * controller silently coerced; the endpoint still accepts a bare string as a one-item list.
   */
  holding?: string[];
  event:
    | { kind: 'utterance'; speaker: string; text: string; addressed: boolean; volume?: IWVolume }
    | { kind: 'approach'; who: string }
    | { kind: 'world'; description: string };
  spokeLastTurn?: boolean;
}

export interface IWTurnRequest {
  sceneId: string;
  /** Identifies one scene RUN for the § 7 session budget. See {@link newSessionId}. */
  sessionId: string;
  npcId: string;
  firedCues?: string[];
  /** Conversation ids already overheard this run — each plays at most once (§ 14 Q6). */
  playedConversations?: string[];
  perception: IWPerception;
}

/** The offer the model picked, resolved back to the thing the author wrote. */
export interface IWChosenOffer {
  name: string;
  kind: 'action' | 'conversation';
  id: string;
}

export interface IWTurnReplyEvent {
  say: string;
  /** An authored action NAME, or `'none'`. Never an invented verb (§ 5.4). */
  action: string;
  emote: IWEmote;
  /** Which tolerant-parser rules had to rescue this reply (§ 5.3). Usually empty. */
  rescued: string[];
  chosen: IWChosenOffer | null;
  rung: string;
  /** Turns left in this scene run, for the in-world HUD (§ 7). */
  remaining: number;
}

/** Why the server would not take the turn. Every case is a 429 with a JSON body. */
export interface IWTurnRefusal {
  code: 'utterance-too-long' | 'too-fast' | 'session-spent' | 'daily-cap';
  limit?: number;
  got?: number;
  retryAfterMs?: number;
  spent?: number;
}

export type IWTurnOutcome =
  | { kind: 'reply'; reply: IWTurnReplyEvent }
  /**
   * Q7's ladder was exhausted. **Freeze the scene and show a banner.** The client must NOT
   * substitute a line of its own: a world quietly serving plausible filler through a real
   * outage is the failure mode that ran undetected for three days in 2026-08.
   */
  | { kind: 'frozen'; attempts: unknown[] }
  | { kind: 'refused'; refusal?: IWTurnRefusal; remaining?: number };

export interface TakeTurnHandlers {
  /**
   * The growing utterance. Called many times, and called for FAILED rungs too — reset your
   * bubble whenever `attemptIndex` changes.
   */
  onDelta?: (say: string, attemptIndex: number) => void;
  /**
   * Line 1 has closed — the moment to fire TTS (§ 6.4 rule 1), not turn completion.
   *
   * The server flags it on the delta that closed line 1, rather than the client watching for
   * a newline: the streaming parser is the only thing that knows a leading code fence is not
   * speech, and re-deriving that here would be a second implementation of § 5.3's rules that
   * could drift from the one under test.
   */
  onSayDone?: (say: string) => void;
  /**
   * The line's tap-to-look-up segmentation has arrived (§ 5.3b).
   *
   * ⚠️ **IT COMES AFTER `reply`, AND IT MAY NEVER COME.** The server looks the line up only
   * once the reply has been streamed, so this event lands DURING the reveal — the bubble
   * upgrades from plain text to tappable segments mid-sentence. A caller that ignores it is
   * still correct; a caller that WAITS for it has put a dictionary query in front of the
   * speech, which is exactly what the event ordering exists to avoid.
   */
  onSegments?: (line: IWLineSegments) => void;
  signal?: AbortSignal;
}

/**
 * Take one NPC turn.
 *
 * Resolves with the terminal outcome. Throws only on a transport failure or a pre-stream
 * refusal the server answered with a status code (`ApiError`, with the refusal in
 * `err.response.data`) — never for a `frozen` turn, which is a legitimate outcome and not
 * an error.
 */
export async function takeNpcTurn(
  request: IWTurnRequest,
  handlers: TakeTurnHandlers = {}
): Promise<IWTurnOutcome> {
  // ⚠️ The DEFAULT is `frozen`, so a stream that ends without a terminal event is reported as
  // an outage rather than as success. Traced because that default is invisible otherwise: the
  // client cannot tell "the server froze" from "the server said nothing at all".
  let outcome: IWTurnOutcome = { kind: 'frozen', attempts: [] };
  let lastAttempt = 0;
  let sayDoneFired = false;
  let sawTerminal = false;

  iwLog('turn', `→ POST /api/immersiveWorld/turn npc=${request.npcId}`, {
    sceneId: request.sceneId,
    sessionId: request.sessionId,
    npcId: request.npcId,
    firedCues: request.firedCues,
    playedConversations: request.playedConversations,
    event: request.perception.event,
    nearby: request.perception.nearby,
  });

  try {
  await apiPostStream(
    '/api/immersiveWorld/turn',
    request,
    (event: SseEvent) => {
      // A loose record rather than a per-event type: the payload is whatever the server sent,
      // and every read below already guards for a missing field. Narrowing it here would be a
      // second copy of the wire shape that a newer server could silently contradict.
      const data = (event.data ?? {}) as Record<string, unknown>;
      // Every frame, verbatim. `delta` is chatty by design — it is the only way to see the
      // ladder change rungs mid-turn (`attemptIndex`) — so it logs at a shorter shape.
      if (event.event === 'delta') iwLog('sse', `delta attempt=${String(data.attemptIndex)} complete=${String(data.speechComplete)}`, data.say);
      else iwLog('sse', `event: ${event.event}`, data);
      switch (event.event) {
        case 'delta': {
          const say = typeof data.say === 'string' ? data.say : '';
          // A new rung means a fresh sentence: forget any sayDone we fired for the dead one,
          // or a rescued turn would speak the abandoned half and never the real line.
          const attemptIndex = typeof data.attemptIndex === 'number' ? data.attemptIndex : 0;
          if (attemptIndex !== lastAttempt) { sayDoneFired = false; lastAttempt = attemptIndex; }
          handlers.onDelta?.(say, lastAttempt);
          // § 6.4 rule 1: fire TTS when line 1 CLOSES, not when the turn completes. The
          // server derives `speechComplete` from the parser, which is the only thing that
          // knows a leading code fence is not speech.
          if (data.speechComplete && !sayDoneFired && say) {
            sayDoneFired = true;
            handlers.onSayDone?.(say);
          }
          break;
        }
        case 'reply':
          sawTerminal = true;
          outcome = { kind: 'reply', reply: data as unknown as IWTurnReplyEvent };
          // Belt and braces: a turn whose whole reply arrived in one delta never showed us
          // line 1 closing, and TTS must still fire.
          if (!sayDoneFired && typeof data.say === 'string' && data.say) {
            sayDoneFired = true;
            handlers.onSayDone?.(data.say);
          }
          break;
        case 'segments': {
          // Keyed by `say` on the wire so a late event can be matched to its line rather
          // than assumed to be the current one — the client checks that before painting.
          const line = data.line as IWLineSegments | undefined;
          if (line && typeof line.foreignText === 'string' && Array.isArray(line.segments)) {
            handlers.onSegments?.(line);
          }
          break;
        }
        case 'frozen':
          sawTerminal = true;
          outcome = { kind: 'frozen', attempts: Array.isArray(data.attempts) ? data.attempts : [] };
          break;
        case 'refused':
          sawTerminal = true;
          // ⚠️ A `refused` frame carrying NO `refusal` is not a refusal at all — it is the
          // server reporting `no-scene` or `unknown-npc` down the only channel an open stream
          // has left. The caller can only render its generic fallback, so the diagnosis has to
          // happen here, where `data.kind` is still readable.
          if (!data.refusal) {
            iwWarn('turn', `refused with NO refusal code — this is a fault, not a decline (kind=${String(data.kind)})`, data);
          }
          outcome = {
            kind: 'refused',
            refusal: data.refusal as IWTurnRefusal | undefined,
            remaining: typeof data.remaining === 'number' ? data.remaining : undefined,
          };
          break;
        default:
          break; // `end`, and anything a future server adds
      }
    },
    { signal: handlers.signal }
  );
  } catch (error) {
    // Rethrown untouched — a pre-stream refusal reaches the caller as an `ApiError` with the
    // refusal in its body, and swallowing it here would turn a 429 into a silent freeze.
    iwLog('turn', `✗ threw for npc=${request.npcId}`, error);
    throw error;
  }

  if (!sawTerminal) iwWarn('turn', `stream closed with no terminal event for npc=${request.npcId} — reporting frozen by default`);
  iwLog('turn', `← outcome=${outcome.kind} npc=${request.npcId}`, outcome);
  return outcome;
}

/** An authored direction, and everything the NPC delivering it perceives (§ 14 Q42). */
export interface IWLineRequest {
  sceneId: string;
  sessionId: string;
  npcId: string;
  /**
   * The authored direction — an INTENTION, not the words. It is never spoken as written.
   *
   * ⚠️ OPTIONAL SINCE 2026-09-19, and an omitted one is a REQUEST rather than a gap: a
   * `prompt_npc` step with no brief means *say whatever this moment calls for*, and the NPC
   * answers from character and perception alone.
   */
  direction?: string;
  /** Who the line is aimed at, as this NPC would name them. Omitted = the NPC picks. */
  toward?: string;
  /** The same perception a turn sends, minus the event — there is no event to react to. */
  perception: Omit<IWPerception, 'event' | 'spokeLastTurn'>;
}

export type IWLineOutcome =
  | { kind: 'line'; say: string; rung: string }
  /**
   * The ladder was exhausted, or the server would not render it.
   *
   * ⚠️ **THIS IS NOT A SCENE FREEZE.** A turn that freezes leaves the learner with no answer
   * to something they said, and the world stops. A render that fails cost one authored beat;
   * the script skips it and plays on. The caller must NOT speak the direction instead — it is
   * English prose about the NPC, and putting it on screen is the exact leak Q42 fixed.
   */
  | { kind: 'skipped'; reason: string };

/**
 * Render one authored direction into the line this NPC would actually say (§ 14 Q42).
 *
 * Same stream vocabulary as {@link takeNpcTurn}, so `onDelta`/`onSayDone`/`onSegments` mean
 * exactly what they mean there and a caller can drive a bubble the same way.
 *
 * ⚠️ **IT NEVER THROWS.** A turn's throw is meaningful — the learner said something and the
 * server refused it, and they have to be told. A render happens inside a script the learner
 * did not ask for, so a transport failure is a skipped beat, not an error to surface. Every
 * failure path collapses to `skipped` with a reason for the log.
 */
export async function renderNpcLine(
  request: IWLineRequest,
  handlers: TakeTurnHandlers = {}
): Promise<IWLineOutcome> {
  // Built through a helper rather than an object literal so its declared type is the whole
  // union: an inline literal lets TypeScript narrow `outcome` to `skipped` for the rest of
  // the function, because it cannot see that the SSE callback assigns to it.
  const skipped = (reason: string): IWLineOutcome => ({ kind: 'skipped', reason });
  let outcome: IWLineOutcome = skipped('the stream closed with no line');
  let lastAttempt = 0;
  let sayDoneFired = false;

  iwLog('line', `→ POST /api/immersiveWorld/line npc=${request.npcId}`, {
    direction: request.direction, toward: request.toward,
  });

  try {
    await apiPostStream(
      '/api/immersiveWorld/line',
      request,
      (event: SseEvent) => {
        const data = (event.data ?? {}) as Record<string, unknown>;
        if (event.event !== 'delta') iwLog('sse', `line event: ${event.event}`, data);
        switch (event.event) {
          case 'delta': {
            const say = typeof data.say === 'string' ? data.say : '';
            const attemptIndex = typeof data.attemptIndex === 'number' ? data.attemptIndex : 0;
            if (attemptIndex !== lastAttempt) { sayDoneFired = false; lastAttempt = attemptIndex; }
            handlers.onDelta?.(say, lastAttempt);
            if (data.speechComplete && !sayDoneFired && say) {
              sayDoneFired = true;
              handlers.onSayDone?.(say);
            }
            break;
          }
          case 'line': {
            const say = typeof data.say === 'string' ? data.say : '';
            outcome = say
              ? { kind: 'line', say, rung: String(data.rung ?? '') }
              : skipped('the server returned an empty line');
            if (say && !sayDoneFired) { sayDoneFired = true; handlers.onSayDone?.(say); }
            break;
          }
          case 'segments': {
            const line = data.line as IWLineSegments | undefined;
            if (line && typeof line.foreignText === 'string' && Array.isArray(line.segments)) {
              handlers.onSegments?.(line);
            }
            break;
          }
          case 'frozen':
            outcome = skipped('every rung of the ladder failed to render it');
            break;
          case 'refused':
            outcome = skipped(`the server refused it (${String(data.kind ?? (data.refusal as { code?: string } | undefined)?.code ?? 'no code')})`);
            break;
          default:
            break;
        }
      },
      { signal: handlers.signal }
    );
  } catch (error) {
    // Swallowed on purpose — see the header. A pre-stream 429 (the daily cap) arrives here.
    const reason = error instanceof Error ? error.message : String(error);
    iwWarn('line', `✗ render failed for npc=${request.npcId} — the beat is skipped, NOT spoken`, {
      direction: request.direction, reason,
    });
    return skipped(reason);
  }

  if (outcome.kind === 'skipped') {
    iwWarn('line', `no line for npc=${request.npcId} — ${outcome.reason}`, { direction: request.direction });
  } else {
    iwLog('line', `← "${outcome.say}" npc=${request.npcId} rung=${outcome.rung}`, { direction: request.direction });
  }
  return outcome;
}

/**
 * Tell the server a scene run is over, so its § 7 counter is released.
 *
 * Fire-and-forget by design — a failure here leaks one integer on the server and nothing
 * the learner can see, so it must never block leaving a scene.
 */
export function endIwSession(sessionId: string): void {
  void apiPost('/api/immersiveWorld/session/end', { sessionId }, { keepalive: true }).catch(() => {});
}

/**
 * A fresh scene-run id.
 *
 * Client-generated because phase 2 has no run row — § 12 defers scene runs, transcripts and
 * the report to phase 3, and the session budget only needs an identifier that is unique per
 * run, not one anybody stores. `crypto.randomUUID` is available in every browser the app
 * supports; the fallback exists for a non-secure context, where it is absent.
 */
export function newSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `iw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 4.2 — who was the learner talking to
// ─────────────────────────────────────────────────────────────────────────────

/** One body offered to the router. Ids only: the server holds the character sheets. */
export interface IWRouteCastMember {
  npcId: string;
  distance: number;
  /** The learner's avatar is turned toward them. */
  facedByLearner?: boolean;
  /** They are turned toward the learner. */
  facingLearner?: boolean;
  focused?: boolean;
  spokeLast?: boolean;
}

export interface IWRouteRequest {
  sceneId: string;
  utterance: string;
  cast: readonly IWRouteCastMember[];
  /** Recent lines, oldest first — the router reads them to spot a continuing exchange. */
  heard: readonly string[];
}

/**
 * Ask the server who one utterance was aimed at (§ 4.2).
 *
 * ⚠️ **IT NEVER THROWS AND NEVER BLOCKS THE SCENE.** Returns `null` for every failure — a
 * refusal, a timeout, a dead router, an honest UNCLEAR — because the caller has a complete
 * offline answer in `chooseAddressee` and there is nothing else it could usefully do with the
 * distinction. Anything that makes this function `throw` makes a learner's sentence disappear
 * over a decision that had a free answer.
 *
 * ⚠️ **THE CALLER MUST IMPOSE ITS OWN DEADLINE.** The server's router has one, but a hung
 * *connection* is not covered by it, and the whole point of routing is that it is quick. See
 * `useIWSceneRuntime.say`, which races this against `IW_ROUTE_CLIENT_DEADLINE_MS`.
 */
export async function routeAddressee(request: IWRouteRequest): Promise<string | null> {
  try {
    const data = await apiPost<{ npcId?: string | null; detail?: string }>(
      '/api/immersiveWorld/addressee',
      request,
    );
    iwLog('route', `→ ${data?.npcId ?? '(unclear)'}`, { detail: data?.detail });
    return typeof data?.npcId === 'string' && data.npcId ? data.npcId : null;
  } catch (error) {
    // `iwWarn`, not `iwFault`: falling back to the rules is a working scene, not a broken one.
    iwWarn('route', 'router unavailable — falling back to the client rules', error);
    return null;
  }
}

/**
 * Segment the learner's OWN utterance (§ 5.3b), so their bubble shows pinyin over the
 * characters and opens the same popup an NPC's line does.
 *
 * ⚠️ **IT NEVER THROWS**, for the same reason `routeAddressee` does not: this is an
 * enhancement to a bubble that is already on screen. A failure means the line stays as plain
 * characters, which is exactly how every learner bubble rendered before this existed — never
 * a lost sentence.
 *
 * ⚠️ **IT IS FIRED ALONGSIDE THE TURN, NOT AFTER IT.** The learner's bubble is replaced by
 * the NPC's reply, so anything that waits for the turn describes a bubble that has gone.
 */
export async function segmentUtterance(text: string): Promise<IWLineSegments | null> {
  try {
    const data = await apiPost<{ line?: IWLineSegments | null }>(
      '/api/immersiveWorld/segment',
      { text },
    );
    return data?.line ?? null;
  } catch (error) {
    iwWarn('turn', 'utterance segmentation failed — the learner bubble stays plain', error);
    return null;
  }
}
