import type { IncomingMessage } from 'http';
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { WebSocket, RawData } from 'ws';
import { requireUserId, handleControllerError } from '../utils/controllerUtils.js';
import { RateLimitError } from '../types/dal.js';
import { isAllowedOrigin } from '../middleware/allowedOrigins.js';
import {
  VOICE_CLOSE_CAP_REACHED,
  VOICE_CLOSE_UNAUTHORIZED,
  VOICE_SPEAK_MAX_CHARS,
  toTutorVoiceRole,
  type VoiceClientMessage,
  type VoiceServerEvent,
} from '../contracts/voice.js';
import { LiveVoiceSession, type VoiceSocketSink } from '../services/voice/LiveVoiceSession.js';
import type { VoiceSessionService } from '../services/voice/VoiceSessionService.js';

/** How long a new socket may wait before sending `start`. */
const START_TIMEOUT_MS = 10_000;
/** Largest inbound frame accepted (a 20 ms PCM frame is 640 bytes; JSON control frames are tiny). */
const MAX_INBOUND_BYTES = 16 * 1024;

/**
 * VoiceSessionController — the voice tutor's transport layer (docs/VOICE_ASSISTANT.md § 2–3).
 *
 * WebSocket (`/api/voice/session`, attached by server/routes/voiceRoutes.ts):
 *   1. The socket opens unauthenticated. The FIRST text frame must be `start`, carrying the
 *      live access token (a browser WebSocket cannot set an Authorization header, and a token
 *      in the URL would land in proxy logs). The httpOnly access cookie on the upgrade is
 *      accepted as a fallback, but only from an allowed Origin — CORS does not cover a
 *      WebSocket handshake, so cookie auth without the Origin check would be cross-site
 *      hijackable.
 *   2. The service opens the session (cap check, learner profile) and a LiveVoiceSession takes
 *      over: binary frames → onAudio, JSON frames → the matching handler.
 *   The socket never re-authenticates mid-session: a token refresh during a 10-minute
 *   conversation must not tear it down (§ 8, CLAUDE.md "never reload on token refresh").
 *
 * REST (server/routes/voiceRoutes.ts): the saved-session list, one transcript, line replay,
 * and today's usage.
 *
 * Layer: controller — parses and validates, owns the socket lifecycle, calls only the service.
 */
export class VoiceSessionController {
  constructor(private readonly voiceSessionService: VoiceSessionService) {}

  // ── WebSocket ──────────────────────────────────────────────────────────────

  handleSocket(ws: WebSocket, req: IncomingMessage): void {
    let live: LiveVoiceSession | null = null;
    let starting = false;
    const cookieToken = isAllowedOrigin(req.headers.origin) ? readCookie(req.headers.cookie, 'token') : null;

    const send = (event: VoiceServerEvent) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
    };
    const sink: VoiceSocketSink = {
      sendEvent: send,
      sendAudio: (frame) => {
        if (ws.readyState === ws.OPEN) ws.send(frame, { binary: true });
      },
      close: (code = 1000, reason = '') => {
        if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close(code, reason);
      },
    };
    const fatal = (code: Extract<VoiceServerEvent, { type: 'error' }>['code'], message: string, closeCode: number) => {
      send({ type: 'error', code, message, fatal: true });
      sink.close(closeCode, code);
    };

    const startTimer = setTimeout(() => {
      if (!live) fatal('badRequest', 'No start message received.', 1008);
    }, START_TIMEOUT_MS);

    ws.on('message', (data: RawData, isBinary: boolean) => {
      const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
      if (buf.length > MAX_INBOUND_BYTES) return;
      if (isBinary) {
        live?.onAudio(buf);
        return;
      }
      let msg: VoiceClientMessage;
      try {
        msg = JSON.parse(buf.toString('utf8'));
      } catch {
        return; // a malformed control frame is ignored, not fatal
      }
      if (!msg || typeof msg !== 'object') return;

      if (!live) {
        if (msg.type !== 'start' || starting) return;
        starting = true;
        void this.startSession(msg, cookieToken, sink, fatal)
          .then((session) => {
            clearTimeout(startTimer);
            if (!session) return;
            if (ws.readyState !== ws.OPEN) {
              session.onClose();
              return;
            }
            live = session;
            live.start();
          })
          .catch((err) => {
            console.error('[voice] start failed:', err instanceof Error ? err.message : err);
            fatal('internal', 'Could not start the voice session.', 1011);
          });
        return;
      }

      switch (msg.type) {
        case 'interrupt':
          live.onInterrupt();
          break;
        case 'setVoice':
          live.onSetVoice(toTutorVoiceRole(msg.voice));
          break;
        case 'playbackEnded':
          if (Number.isInteger(msg.turnId)) live.onPlaybackEnded(msg.turnId);
          break;
        case 'cardAdded':
          if (typeof msg.word === 'string') live.onCardAdded(msg.word);
          break;
        case 'end':
          void live.onEnd().catch((err) => console.error('[voice] end failed:', err));
          break;
        default:
          break;
      }
    });

    ws.on('close', () => {
      clearTimeout(startTimer);
      live?.onClose();
    });
    ws.on('error', (err) => console.error('[voice] socket error:', err.message));
  }

  /** Authenticate the `start` frame and open a session. Null when it was refused (already reported). */
  private async startSession(
    msg: Extract<VoiceClientMessage, { type: 'start' }>,
    cookieToken: string | null,
    sink: VoiceSocketSink,
    fatal: (code: Extract<VoiceServerEvent, { type: 'error' }>['code'], message: string, closeCode: number) => void,
  ): Promise<LiveVoiceSession | null> {
    const userId = verifyToken(typeof msg.token === 'string' && msg.token ? msg.token : cookieToken);
    if (!userId) {
      fatal('unauthorized', 'Please sign in again.', VOICE_CLOSE_UNAUTHORIZED);
      return null;
    }
    // Spanish is paused (CLAUDE.md); the tutor is Chinese-only (§ 10).
    if (msg.language !== 'zh') {
      fatal('badRequest', 'The voice tutor only speaks Chinese for now.', 1008);
      return null;
    }
    const reason = this.voiceSessionService.unavailableReason();
    if (reason) {
      fatal('unavailable', reason, 1011);
      return null;
    }
    try {
      const ctx = await this.voiceSessionService.openSession(userId, {
        language: 'zh',
        voice: toTutorVoiceRole(msg.voice),
        tz: msg.tz,
      });
      return new LiveVoiceSession(this.voiceSessionService, ctx, sink);
    } catch (err) {
      if (err instanceof RateLimitError) {
        fatal('capReached', err.message, VOICE_CLOSE_CAP_REACHED);
        return null;
      }
      throw err;
    }
  }

  // ── REST ───────────────────────────────────────────────────────────────────

  /** GET /api/voice/sessions → VoiceSessionListItem[] (the learner's saved sessions, newest first). */
  async listSessions(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      res.json(await this.voiceSessionService.listSessions(userId, 'zh'));
    } catch (error) {
      handleControllerError(error, res, 'VoiceSessionController.listSessions');
    }
  }

  /** GET /api/voice/sessions/:id → VoiceSessionTranscript. */
  async getTranscript(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const id = String(req.params.id ?? '');
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        res.status(400).json({ error: 'Invalid session id', code: 'ERR_INVALID_INPUT' });
        return;
      }
      res.json(await this.voiceSessionService.getTranscript(userId, id));
    } catch (error) {
      handleControllerError(error, res, 'VoiceSessionController.getTranscript');
    }
  }

  /** POST /api/voice/speak { text, voice } → audio/mpeg — replay a line in the tutor's voice. */
  async speak(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      if (!text || text.length > VOICE_SPEAK_MAX_CHARS) {
        res.status(400).json({ error: `text must be 1–${VOICE_SPEAK_MAX_CHARS} characters`, code: 'ERR_INVALID_INPUT' });
        return;
      }
      if (!this.voiceSessionService.tts.available) {
        res.status(503).json({ error: 'Voice is not configured', code: 'ERR_UNAVAILABLE' });
        return;
      }
      const clip = await this.voiceSessionService.speakLine(text, toTutorVoiceRole(req.body?.voice), userId, 'zh');
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.send(clip.audio);
    } catch (error) {
      handleControllerError(error, res, 'VoiceSessionController.speak');
    }
  }

  /** GET /api/voice/usage?tz= → { available, reason, secondsUsed, secondsLimit }. */
  async usage(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const reason = this.voiceSessionService.unavailableReason();
      const { secondsUsed, secondsLimit } = await this.voiceSessionService.getUsage(userId, req.query.tz);
      res.json({ available: !reason, reason, secondsUsed, secondsLimit });
    } catch (error) {
      handleControllerError(error, res, 'VoiceSessionController.usage');
    }
  }
}

/** The userId in a valid access token, or null. Mirrors authMiddleware.authenticateToken. */
function verifyToken(token: string | null): string | null {
  if (!token || !process.env.JWT_SECRET) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET) as { userId?: string };
    return typeof decoded.userId === 'string' ? decoded.userId : null;
  } catch {
    return null;
  }
}

/** One cookie's value from a raw Cookie header. */
function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}
