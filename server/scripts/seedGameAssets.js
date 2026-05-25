/**
 * Seed Script: Register game assets into the gameassets table.
 *
 * Walks server/public/games/<gameId>/ and upserts one row per image found,
 * with imagePath set to the URL the frontend can fetch (/games/<gameId>/<file>).
 *
 * Usage (run from project root):
 *   node server/scripts/seedGameAssets.js <gameId>
 *
 * Existing rows for the same (gameId, assetId) are overwritten — safe to re-run.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPPORTED_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);

async function main() {
  const gameId = process.argv[2];
  if (!gameId) {
    console.error('Usage: node server/scripts/seedGameAssets.js <gameId>');
    process.exit(1);
  }

  const assetDir = path.join(__dirname, '..', 'public', 'games', gameId);
  if (!fs.existsSync(assetDir)) {
    console.error(`Asset directory not found: ${assetDir}`);
    console.error(`Create it and drop image files in before running this script.`);
    process.exit(1);
  }

  const files = fs.readdirSync(assetDir).filter(name => {
    return SUPPORTED_EXTS.has(path.extname(name).toLowerCase());
  });

  if (files.length === 0) {
    console.log(`No supported asset files found in ${assetDir}`);
    return;
  }

  console.log(`Seeding ${files.length} asset(s) for gameId="${gameId}"`);

  for (const file of files) {
    const assetId = path.basename(file, path.extname(file));
    const imagePath = `/games/${gameId}/${file}`;
    await db.query(`
      INSERT INTO gameassets ("gameId", "assetId", "displayName", "imagePath", "metadata")
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT ("gameId", "assetId") DO UPDATE SET
        "displayName" = EXCLUDED."displayName",
        "imagePath" = EXCLUDED."imagePath",
        "metadata" = EXCLUDED."metadata"
    `, [gameId, assetId, assetId, imagePath, null]);
    console.log(`  upserted ${gameId}/${assetId} → ${imagePath}`);
  }

  console.log('Done.');
  process.exit(0);
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
