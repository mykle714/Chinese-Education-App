import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { nightMarketTemplateController } from '../dal/setup.js';
import { handle } from './asyncHandler.js';

/**
 * Night Market Template routes — /api/nightMarketTemplates/*
 *
 * LAYER: HTTP route layer (registration only). Validator-status is enforced in
 * NightMarketTemplateService, not here. See docs/NIGHT_MARKET_TEMPLATE_EDITOR.md.
 */
const router = Router();

// List all templates (name-ordered summaries) for the editor Load dropdown.
router.get('/api/nightMarketTemplates', authenticateToken, handle(nightMarketTemplateController.listTemplates, nightMarketTemplateController));

// Is a template name free? Backs the editor Properties-popup rename gate.
// NOTE: must be registered BEFORE the `/:id` route so it is not captured as an id.
router.get('/api/nightMarketTemplates/nameAvailable', authenticateToken, handle(nightMarketTemplateController.checkNameAvailable, nightMarketTemplateController));

// Suggest a free default name ("template{index}") — pre-fills the Properties popup for a
// fresh (unnamed) template.
router.get('/api/nightMarketTemplates/suggestName', authenticateToken, handle(nightMarketTemplateController.suggestName, nightMarketTemplateController));

// Gallery: one entry per name with the full definition of its most-conditions version,
// for the editor's visual Load picker. Registered BEFORE `/load` (both are fixed paths, so
// order is not strictly required, but grouped with the other GETs).
router.get('/api/nightMarketTemplates/gallery', authenticateToken, handle(nightMarketTemplateController.listTemplateGallery, nightMarketTemplateController));

// Load one template version (full definition + availableVersions) by name+version.
router.get('/api/nightMarketTemplates/load', authenticateToken, handle(nightMarketTemplateController.getTemplate, nightMarketTemplateController));

// Save a template version — upsert by (name, version) (create OR overwrite).
router.post('/api/nightMarketTemplates', authenticateToken, handle(nightMarketTemplateController.saveTemplate, nightMarketTemplateController));

// Delete a SINGLE version of a template — the editor's "Delete Version" button.
// Version 0 is rejected (it is the base); use the name-level delete for that.
router.delete('/api/nightMarketTemplates/version', authenticateToken, handle(nightMarketTemplateController.deleteTemplateVersion, nightMarketTemplateController));

// Delete a whole template (all versions of the name) — the editor's "Delete Template" button.
router.delete('/api/nightMarketTemplates', authenticateToken, handle(nightMarketTemplateController.deleteTemplate, nightMarketTemplateController));

export default router;
