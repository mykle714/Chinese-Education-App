import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { immersiveWorldRuntimeController, immersiveWorldSceneController } from '../dal/setup.js';
import { handle } from './asyncHandler.js';

/**
 * Immersive World routes — /api/immersiveWorld/*
 *
 * LAYER: HTTP route layer (registration only). Template-author status is enforced in
 * ImmersiveWorldSceneService, not here — the same split
 * `nightMarketTemplateRoutes.ts` makes, and for the same reason (a gate in a route is one
 * forgotten middleware away from being absent).
 *
 * Two groups live here: AUTHORING (phase 1, the scene editor) and the learner-facing
 * RUNTIME (phase 2, `/turn` and `/session/end`). They are deliberately in one file and one
 * router because they share a URL prefix; they do NOT share a service — see the lifecycle
 * split in ImmersiveWorldService's header.
 *
 * ⚠️ `/turn` answers `text/event-stream`, not JSON (§ 5.2, § 6.4). It is the app's only
 * streaming endpoint, so nothing in the shared client fetch helpers handles it — see
 * `src/features/immersiveworld/immersiveWorldTurnApi.ts`.
 *
 * See docs/IMMERSIVE_WORLD.md § 12 phase 1d/1e and phase 2.
 */
const router = Router();

// The NPC picker's source — the cast for one language, projected to what a choice needs.
router.get('/api/immersiveWorld/npcs', authenticateToken, handle(immersiveWorldSceneController.listNpcs, immersiveWorldSceneController));

// Scene summaries for the editor's load list.
router.get('/api/immersiveWorld/scenes', authenticateToken, handle(immersiveWorldSceneController.listScenes, immersiveWorldSceneController));

// Is a scene name free within its language? MUST be registered before `/scenes/:id`, or
// "nameAvailable" is captured as a scene id.
router.get('/api/immersiveWorld/scenes/nameAvailable', authenticateToken, handle(immersiveWorldSceneController.checkNameAvailable, immersiveWorldSceneController));

// One whole scene (blobs inline) for the editor.
router.get('/api/immersiveWorld/scenes/:id', authenticateToken, handle(immersiveWorldSceneController.getScene, immersiveWorldSceneController));

// Create (no id in the payload) or overwrite (id present) one scene.
router.post('/api/immersiveWorld/scenes', authenticateToken, handle(immersiveWorldSceneController.saveScene, immersiveWorldSceneController));

// Delete a scene. Refused with 409 once the scene has been played (ON DELETE RESTRICT).
router.delete('/api/immersiveWorld/scenes/:id', authenticateToken, handle(immersiveWorldSceneController.deleteScene, immersiveWorldSceneController));

// ── Runtime (§ 12 phase 2) ───────────────────────────────────────────────────

// One NPC turn. Streams `delta`* → (`reply` | `frozen` | `refused`) → `end`.
router.post('/api/immersiveWorld/turn', authenticateToken, handle(immersiveWorldRuntimeController.takeTurn, immersiveWorldRuntimeController));

// A scene run ended — drop its § 7 session counter.
router.post('/api/immersiveWorld/session/end', authenticateToken, handle(immersiveWorldRuntimeController.endSession, immersiveWorldRuntimeController));

export default router;
