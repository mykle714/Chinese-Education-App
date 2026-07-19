import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { nightMarketTemplateController } from '../dal/setup.js';

/**
 * Night Market Template routes — /api/nightmarket-templates/*
 *
 * LAYER: HTTP route layer (registration only). Validator-status is enforced in
 * NightMarketTemplateService, not here. See docs/NIGHT_MARKET_TEMPLATE_EDITOR.md.
 */
const router = Router();

// List all templates (name-ordered summaries) for the editor Load dropdown.
// @ts-ignore
router.get('/api/nightmarket-templates', authenticateToken, async (req, res) => {
  await nightMarketTemplateController.listTemplates(req, res);
});

// Is a template name free? Backs the editor Properties-popup rename gate.
// NOTE: must be registered BEFORE the `/:id` route so it is not captured as an id.
// @ts-ignore
router.get('/api/nightmarket-templates/name-available', authenticateToken, async (req, res) => {
  await nightMarketTemplateController.checkNameAvailable(req, res);
});

// Suggest a free default name ("template{index}") — pre-fills the Properties popup for a
// fresh (unnamed) template.
// @ts-ignore
router.get('/api/nightmarket-templates/suggest-name', authenticateToken, async (req, res) => {
  await nightMarketTemplateController.suggestName(req, res);
});

// Gallery: one entry per name with the full definition of its most-conditions version,
// for the editor's visual Load picker. Registered BEFORE `/load` (both are fixed paths, so
// order is not strictly required, but grouped with the other GETs).
// @ts-ignore
router.get('/api/nightmarket-templates/gallery', authenticateToken, async (req, res) => {
  await nightMarketTemplateController.listTemplateGallery(req, res);
});

// Load one template version (full definition + availableVersions) by name+version.
// @ts-ignore
router.get('/api/nightmarket-templates/load', authenticateToken, async (req, res) => {
  await nightMarketTemplateController.getTemplate(req, res);
});

// Save a template version — upsert by (name, version) (create OR overwrite).
// @ts-ignore
router.post('/api/nightmarket-templates', authenticateToken, async (req, res) => {
  await nightMarketTemplateController.saveTemplate(req, res);
});

// Delete a SINGLE version of a template — the editor's "Delete Version" button.
// Version 0 is rejected (it is the base); use the name-level delete for that.
// @ts-ignore
router.delete('/api/nightmarket-templates/version', authenticateToken, async (req, res) => {
  await nightMarketTemplateController.deleteTemplateVersion(req, res);
});

// Delete a whole template (all versions of the name) — the editor's "Delete Template" button.
// @ts-ignore
router.delete('/api/nightmarket-templates', authenticateToken, async (req, res) => {
  await nightMarketTemplateController.deleteTemplate(req, res);
});

export default router;
