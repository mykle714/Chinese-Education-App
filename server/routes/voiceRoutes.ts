import type { Server } from 'http';
import { Router } from 'express';
import { WebSocketServer } from 'ws';
import { authenticateToken } from '../authMiddleware.js';
import { voiceSessionController } from '../dal/setup.js';
import { VOICE_SOCKET_PATH } from '../contracts/voice.js';
import { handle } from './asyncHandler.js';

/**
 * Voice Assistant routes — /api/voice/* (docs/VOICE_ASSISTANT.md § 2, § 9).
 *
 * LAYER: HTTP route layer (registration only). Mounted in server/server.ts only when
 * FEATURE_FLAGS.voiceAssistant is on (docs/FEATURE_FLAGS.md); `attachVoiceSocket` is applied
 * under the same flag. Handlers live on VoiceSessionController.
 *
 * This is the app's FIRST WebSocket (Q3). The client derives the socket URL from
 * API_BASE_URL (src/api/voiceSocket.ts): in dev that is the backend directly
 * (http://localhost:5000), so no dev proxy is involved; on PPE it is same-origin through the
 * frontend nginx, whose `/api` block already forwards `Upgrade`/`Connection` (nginx.conf).
 * See docs/VOICE_ASSISTANT_DEPLOY_RUNBOOK.md for PPE.
 */
const router = Router();

router.get('/api/voice/sessions', authenticateToken, handle(voiceSessionController.listSessions, voiceSessionController));
router.get('/api/voice/sessions/:id', authenticateToken, handle(voiceSessionController.getTranscript, voiceSessionController));
router.post('/api/voice/speak', authenticateToken, handle(voiceSessionController.speak, voiceSessionController));
router.get('/api/voice/usage', authenticateToken, handle(voiceSessionController.usage, voiceSessionController));

/**
 * Attach the voice WebSocket to the HTTP server. Only upgrades on VOICE_SOCKET_PATH are
 * accepted; any other upgrade is refused (no other WebSocket exists in the app).
 * Auth happens in the first frame (VoiceSessionController.handleSocket), not at upgrade time.
 */
export function attachVoiceSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== VOICE_SOCKET_PATH) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => voiceSessionController.handleSocket(ws, req));
  });
}

export default router;
