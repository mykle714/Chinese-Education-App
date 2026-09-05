import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { immersiveWorldSceneController } from '../dal/setup.js';
import { handle } from './asyncHandler.js';

/**
 * Immersive World routes — /api/immersiveWorld/*
 *
 * LAYER: HTTP route layer (registration only). Template-author status is enforced in
 * ImmersiveWorldSceneService, not here — the same split
 * `nightMarketTemplateRoutes.ts` makes, and for the same reason (a gate in a route is one
 * forgotten middleware away from being absent).
 *
 * Everything registered today is AUTHORING. The learner-facing runtime (start a run, take
 * a turn, finish and grade) is phase 2+ and gets its own routes in this file.
 *
 * See docs/IMMERSIVE_WORLD.md § 12 phase 1d/1e.
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

export default router;
