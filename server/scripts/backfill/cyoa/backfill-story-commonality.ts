/**
 * backfill-story-commonality.ts — compute `stories.commonality` (migration 200) for every
 * PUBLISHED story, in place.
 *
 * WHY THIS EXISTS. Migration 200 replaced a story's HSK `difficulty` with a 1–5
 * commonality (docs/CYOA_FEATURE.md § 6.2a). New publishes compute it, but stories
 * published before the deploy have NULL until their author re-publishes. The value needs
 * the server gsa (segmentation) over every passage, so it cannot be a SQL UPDATE; this
 * script runs the same StoryService.computeCommonality the publish path uses.
 *
 * It does NOT re-publish: `publishedAt` / `updatedAt` stay as they are (StoryDAL →
 * setCommonality), so the list's newest-first order within a band is unchanged.
 * Drafts are skipped — they get a value on their first publish, like any new story.
 *
 * Idempotent and deterministic for a given det snapshot; safe to re-run.
 *
 * Usage, from the server/ directory:
 *
 *   npx tsx scripts/backfill/cyoa/backfill-story-commonality.ts                     # dev
 *   scripts/backfill/run-ppe.sh scripts/backfill/cyoa/backfill-story-commonality.ts # PPE
 *
 * Depends on: server/services/StoryService.ts → recomputeCommonality,
 * server/dal/implementations/StoryDAL.ts → listPublishedStoryIds / setCommonality.
 * Referenced by: docs/STORY_COMMONALITY_DEPLOY_RUNBOOK.md, docs/CYOA_FEATURE.md § 6.2a.
 */
import { storyService, storyDAL } from '../../../dal/setup.js';

async function main() {
  const ids = await storyDAL.listPublishedStoryIds();
  console.log(`=== story commonality backfill: ${ids.length} published stor${ids.length === 1 ? 'y' : 'ies'} ===`);
  let failed = 0;
  for (const id of ids) {
    try {
      const commonality = await storyService.recomputeCommonality(id);
      console.log(`  ${id}  commonality = ${commonality ?? 'NULL (no scored words)'}`);
    } catch (error) {
      // One bad story must not stop the rest; it is reported and counted.
      failed++;
      console.error(`  ${id}  FAILED:`, error);
    }
  }
  console.log(failed === 0 ? 'done.' : `done with ${failed} failure(s).`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
