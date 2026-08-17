import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { studyChallengeController } from '../dal/setup.js';
import { handle } from './asyncHandler.js';

/**
 * Study Challenge routes — /api/studyChallenges/*
 *
 * LAYER: HTTP route layer (registration only). See docs/STUDY_CHALLENGE.md.
 *
 * ⚠️ ORDERING MATTERS HERE, exactly as it does in `friendRoutes`. Every STATIC
 * segment is declared ABOVE the parameterized `/:id` routes, because "badge",
 * "history", "candidates", "strike" and "blocks" are all legal values for an `:id`
 * segment and a mis-ordered route would swallow them. The service also rejects a
 * non-UUID id (so a mis-ordered match would 400 rather than act on the wrong
 * challenge), but ordering is the real guarantee.
 *
 * camelCase path segment (`studyChallenges`), per docs/BACKEND_LAYERING.md.
 */
const router = Router();

// ── Static segments — MUST stay above /:id ──
router.get('/api/studyChallenges/badge', authenticateToken, handle(studyChallengeController.getBadge, studyChallengeController));
router.get('/api/studyChallenges/history', authenticateToken, handle(studyChallengeController.getHistory, studyChallengeController));
router.get('/api/studyChallenges/candidates', authenticateToken, handle(studyChallengeController.getCandidates, studyChallengeController));
router.post('/api/studyChallenges/strike', authenticateToken, handle(studyChallengeController.strikeWord, studyChallengeController));
// The per-pair opt-out. Keyed by the FRIEND's user id, not by a friendship id: the
// client holds friend ids everywhere and has no reason to know friendship ids.
router.put('/api/studyChallenges/blocks/:friendUserId', authenticateToken, handle(studyChallengeController.setBlock, studyChallengeController));

// ── The challenges page and issuing ──
router.get('/api/studyChallenges', authenticateToken, handle(studyChallengeController.getChallengesPage, studyChallengeController));
router.post('/api/studyChallenges', authenticateToken, handle(studyChallengeController.issueChallenge, studyChallengeController));

// ── One challenge ──
router.get('/api/studyChallenges/:id', authenticateToken, handle(studyChallengeController.getChallenge, studyChallengeController));
router.post('/api/studyChallenges/:id/accept', authenticateToken, handle(studyChallengeController.acceptChallenge, studyChallengeController));
router.post('/api/studyChallenges/:id/decline', authenticateToken, handle(studyChallengeController.declineChallenge, studyChallengeController));
// Withdraw. A DELETE because the row genuinely goes away — nothing was agreed, so
// there is nothing to record (§ 1). Decline, by contrast, KEEPS the row so it holds
// the pair's week as the cooldown.
router.delete('/api/studyChallenges/:id', authenticateToken, handle(studyChallengeController.withdrawChallenge, studyChallengeController));
router.post('/api/studyChallenges/:id/rounds', authenticateToken, handle(studyChallengeController.submitRound, studyChallengeController));

export default router;
