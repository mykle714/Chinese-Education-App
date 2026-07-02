import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { gamesController, nightMarketController, communityLayoutController } from '../dal/setup.js';
import { leaderboardController } from '../controllers/LeaderboardController.js';

/**
 * Games / Night Market / Community / Leaderboard routes.
 *
 * LAYER: HTTP route layer (registration only). Split out of server.ts; paths unchanged.
 * See docs/GAMES_FEATURE.md, docs/NIGHT_MARKET_FEATURE.md, docs/COMMUNITY_PAGE.md.
 */
const router = Router();

// ── Games framework (one controller serves all games; :gameId scopes each request) ──

// List assets registered for a game (used by GameStage to preload textures)
// @ts-ignore
router.get('/api/games/:gameId/assets', authenticateToken, async (req, res) => {
  await gamesController.getAssets(req, res);
});

// Fetch the authenticated user's save state for a game
// @ts-ignore
router.get('/api/games/:gameId/progress', authenticateToken, async (req, res) => {
  await gamesController.getProgress(req, res);
});

// Upsert the authenticated user's save state for a game
// @ts-ignore
router.post('/api/games/:gameId/progress', authenticateToken, async (req, res) => {
  await gamesController.saveProgress(req, res);
});

// ── Night Market ──

// Get user's unlocked night market items (seeds base set on first call)
// @ts-ignore
router.get('/api/night-market/unlocks', authenticateToken, async (req, res) => {
  await nightMarketController.getUnlocks(req, res);
});

// Unlock the next random night market item
// @ts-ignore
router.post('/api/night-market/unlock', authenticateToken, async (req, res) => {
  await nightMarketController.unlockNext(req, res);
});

// ── Community — shareable advanced card-icon layouts (docs/COMMUNITY_PAGE.md) ──
// Feeds are POST so the growing exclude lists aren't bound by URL length.

// @ts-ignore
router.post('/api/community/learning-feed', authenticateToken, async (req, res) => {
  await communityLayoutController.learningFeed(req, res);
});
// @ts-ignore
router.post('/api/community/top-feed', authenticateToken, async (req, res) => {
  await communityLayoutController.topFeed(req, res);
});
// @ts-ignore
router.get('/api/community/my-votes', authenticateToken, async (req, res) => {
  await communityLayoutController.myVotes(req, res);
});
// @ts-ignore
router.post('/api/community/vote', authenticateToken, async (req, res) => {
  await communityLayoutController.vote(req, res);
});
// @ts-ignore
router.post('/api/community/unvote', authenticateToken, async (req, res) => {
  await communityLayoutController.unvote(req, res);
});
// @ts-ignore
router.post('/api/community/apply-design', authenticateToken, async (req, res) => {
  await communityLayoutController.applyDesign(req, res);
});

// ── Leaderboard ──

// Get leaderboard data
// @ts-ignore
router.get('/api/leaderboard', authenticateToken, async (req, res) => {
  await leaderboardController.getLeaderboard(req, res);
});

// Get top N users from leaderboard
// @ts-ignore
router.get('/api/leaderboard/top/:limit', authenticateToken, async (req, res) => {
  await leaderboardController.getTopUsers(req, res);
});

// Get leaderboard with specific user highlighted
// @ts-ignore
router.get('/api/leaderboard/user/:userId', authenticateToken, async (req, res) => {
  await leaderboardController.getLeaderboardForUser(req, res);
});

export default router;
