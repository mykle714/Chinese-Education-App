import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { usageDashboardController } from '../dal/setup.js';
import { handle } from './asyncHandler.js';

/**
 * Admin routes — /api/admin/*
 *
 * LAYER: HTTP route layer (registration only).
 *
 * Cross-user operator reads. Every handler here must be gated on `users.isAdmin`
 * (migration 168) INSIDE its service — authenticateToken only proves who the caller
 * is, not that they may see other accounts. See docs/USAGE_DASHBOARD.md.
 */
const router = Router();

// The User Usage dashboard (tester dashboard section). ?days=7|30|90|0.
router.get('/api/admin/usage', authenticateToken, handle(usageDashboardController.getUsage, usageDashboardController));

export default router;
