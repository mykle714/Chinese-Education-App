import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { proxyLimiter } from '../middleware/rateLimits.js';
import { icons8Controller, ttsController } from '../dal/setup.js';

import { handle } from './asyncHandler.js';

/**
 * Media proxy routes — TTS synthesis + icons8 catalog/search/images.
 *
 * LAYER: HTTP route layer (registration only). Split out of server.ts; paths unchanged.
 *
 * Every route that spends third-party quota (Google TTS, icons8 API) sits behind
 * proxyLimiter in addition to auth, so a runaway client loop can't burn quota.
 * See docs/CARD_ICON_LAYOUT.md for the icons8 flow.
 */
const router = Router();

// TTS: synthesize MP3 audio for a dictionary entry. Disk-cached with infinite TTL —
// once a given (voice, word) is on disk, all future requests are served from cache.
router.post('/api/tts/synthesize', authenticateToken, proxyLimiter, handle(ttsController.synthesize, ttsController));

// icons8 icon catalog: paginated list of downloaded icons for the avatar picker.
// Auth-gated — only logged-in users browse icons to set their avatar.
router.get('/api/icons8', authenticateToken, handle(icons8Controller.listIcons, icons8Controller));

// icons8 live search: proxy the icons8 API for the custom card icon layout's "add
// icon" dialog (docs/CARD_ICON_LAYOUT.md). Auth-gated. Returns ids+names only; tiles
// preview from the icons8 CDN and download-on-select via the ensure route below.
router.get('/api/icons8/search', authenticateToken, proxyLimiter, handle(icons8Controller.searchIcons, icons8Controller));

// icons8 default-results prefetch: return (and cache on first call) the icons8 search
// response for a card's default English query, so the picker shows results instantly on
// open. Auth-gated. Body { language, entryKey, pos?, term }. docs/CARD_ICON_LAYOUT.md
router.post('/api/icons8/defaultResults', authenticateToken, proxyLimiter, handle(icons8Controller.defaultResults, icons8Controller));

// icons8 download-on-select: cache an icon's SVG bytes locally so the image route can
// serve it. Auth-gated; idempotent. Called when a user picks a search result.
router.post('/api/icons8/:iconId/ensure', authenticateToken, proxyLimiter, handle(icons8Controller.ensureIcon, icons8Controller));

// icons8 icon image: stream the stored bytes for a downloaded icon by its icons8 id.
// PUBLIC (no auth) on purpose — loaded via <img src> in the discover flow, which can't
// attach an Authorization header; icons are non-sensitive public artwork. Served from
// icons8.assetBytes for now (see TODO(cdn) in Icons8Controller). Serves only local
// bytes (no upstream call), so it needs no proxy limiter.
router.get('/api/icons8/:iconId/image', handle(icons8Controller.getIconImage, icons8Controller));

export default router;
