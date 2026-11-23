/**
 * voiceSocket.ts — the app's one WebSocket opener: the voice tutor's live session
 * (docs/VOICE_ASSISTANT.md § 3).
 *
 * Auth: a browser WebSocket cannot set an Authorization header, so the live access token is
 * read at call time from authStorage (never passed in — FRONTEND_LAYERING "no API function
 * takes a token") and sent in the first `start` frame. The server also accepts the httpOnly
 * access cookie on the upgrade when the token slot is empty.
 *
 * The socket is NOT re-opened on a silent token refresh: the server authenticates once at
 * `start`, so a refresh mid-conversation changes nothing (CLAUDE.md "never reload on token
 * refresh").
 *
 * URL: derived from API_BASE_URL — the backend directly in dev (ws://localhost:5000), the
 * page's own origin through nginx on PPE (wss://…).
 *
 * Caller: src/features/voice/useVoiceSession.ts.
 */
import { API_BASE_URL } from '../constants';
import * as authStorage from '../utils/authStorage';
import {
    VOICE_SOCKET_PATH,
    type TutorVoiceRole,
    type VoiceClientMessage,
    type VoiceStartMessage,
} from '../../server/contracts/voice';

function socketUrl(): string {
    const base = API_BASE_URL || window.location.origin;
    const url = new URL(VOICE_SOCKET_PATH, base);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.toString();
}

/** Open the voice socket and send `start` as soon as it connects. */
export function openVoiceSocket(voice: TutorVoiceRole): WebSocket {
    const ws = new WebSocket(socketUrl());
    ws.binaryType = 'arraybuffer';
    ws.addEventListener(
        'open',
        () => {
            const start: VoiceStartMessage = {
                type: 'start',
                token: authStorage.getToken(),
                language: 'zh',
                voice,
                tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
            };
            ws.send(JSON.stringify(start));
        },
        { once: true },
    );
    return ws;
}

/** Send a control message if the socket is open (silently dropped otherwise). */
export function sendVoiceMessage(ws: WebSocket | null, message: VoiceClientMessage): void {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}
