import { apiPost, apiPostStream, type SseEvent } from '../../api/http';
import type { IWEmote } from '../../../server/contracts/iw';

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
  holding?: string;
  event:
    | { kind: 'utterance'; speaker: string; text: string; addressed: boolean }
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
  let outcome: IWTurnOutcome = { kind: 'frozen', attempts: [] };
  let lastAttempt = 0;
  let sayDoneFired = false;

  await apiPostStream(
    '/api/immersiveWorld/turn',
    request,
    (event: SseEvent) => {
      const data = event.data as any;
      switch (event.event) {
        case 'delta': {
          const say: string = data?.say ?? '';
          // A new rung means a fresh sentence: forget any sayDone we fired for the dead one,
          // or a rescued turn would speak the abandoned half and never the real line.
          if (data?.attemptIndex !== lastAttempt) { sayDoneFired = false; lastAttempt = data?.attemptIndex ?? 0; }
          handlers.onDelta?.(say, lastAttempt);
          // § 6.4 rule 1: fire TTS when line 1 CLOSES, not when the turn completes. The
          // server derives `speechComplete` from the parser, which is the only thing that
          // knows a leading code fence is not speech.
          if (data?.speechComplete && !sayDoneFired && say) {
            sayDoneFired = true;
            handlers.onSayDone?.(say);
          }
          break;
        }
        case 'reply':
          outcome = { kind: 'reply', reply: data as IWTurnReplyEvent };
          // Belt and braces: a turn whose whole reply arrived in one delta never showed us
          // line 1 closing, and TTS must still fire.
          if (!sayDoneFired && data?.say) { sayDoneFired = true; handlers.onSayDone?.(data.say); }
          break;
        case 'frozen':
          outcome = { kind: 'frozen', attempts: data?.attempts ?? [] };
          break;
        case 'refused':
          outcome = { kind: 'refused', refusal: data?.refusal, remaining: data?.remaining };
          break;
        default:
          break; // `end`, and anything a future server adds
      }
    },
    { signal: handlers.signal }
  );

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
