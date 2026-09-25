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

// The learner's scene list — PUBLISHED scenes in their own study language. Deliberately a
// different path from the editor's `/scenes`, not a flag on it: different gate, different rows.
router.get('/api/immersiveWorld/play/scenes', authenticateToken, handle(immersiveWorldRuntimeController.listScenes, immersiveWorldRuntimeController));

// One whole scene to walk into. 404 for a draft as well as for a missing id.
router.get('/api/immersiveWorld/play/scenes/:id', authenticateToken, handle(immersiveWorldRuntimeController.getScene, immersiveWorldRuntimeController));

// One NPC turn. Streams `delta`* → (`reply` | `frozen` | `refused`) → `end`.
router.post('/api/immersiveWorld/turn', authenticateToken, handle(immersiveWorldRuntimeController.takeTurn, immersiveWorldRuntimeController));

// A scene run ended — drop its § 7 session counter.
// § 14 Q42 — an authored direction rendered into the NPC's own words. A SEPARATE route from
// /turn because its `frozen` means "skip this beat", not "freeze the scene".
router.post('/api/immersiveWorld/line', authenticateToken, handle(immersiveWorldRuntimeController.renderLine, immersiveWorldRuntimeController));
// § 4.2 — who was the learner talking to. Plain JSON (one id), unlike its two SSE neighbours.
router.post('/api/immersiveWorld/addressee', authenticateToken, handle(immersiveWorldRuntimeController.routeAddressee, immersiveWorldRuntimeController));
// § 5.4 — where an `ai_walk` step goes: an index into a closed list the client built and the
// server re-checks. Plain JSON, like /addressee.
router.post('/api/immersiveWorld/destination', authenticateToken, handle(immersiveWorldRuntimeController.pickDestination, immersiveWorldRuntimeController));
// § 5.3b — the learner's OWN line, segmented so their bubble carries pinyin and tappable
// words like an NPC's. Separate from /turn because the bubble it describes is replaced by the
// reply: on the turn stream it would arrive too late to paint anything.
router.post('/api/immersiveWorld/segment', authenticateToken, handle(immersiveWorldRuntimeController.segmentUtterance, immersiveWorldRuntimeController));
router.post('/api/immersiveWorld/session/end', authenticateToken, handle(immersiveWorldRuntimeController.endSession, immersiveWorldRuntimeController));

export default router;
