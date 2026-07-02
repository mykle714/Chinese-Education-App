import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Meta routes — changelog + health check.
 *
 * LAYER: HTTP route layer (self-contained handlers; no DB).
 * Split out of server.ts; paths unchanged.
 */
const router = Router();

// ES module equivalent of __dirname (this file lives in server/routes/)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get changelog content
router.get('/api/changelog', (req, res) => {
  try {
    // Look for CHANGELOG.md in docs directory
    const possiblePaths = [
      path.join(__dirname, '..', '..', 'docs', 'CHANGELOG.md'), // Development: repo root docs/ (two levels up from server/routes/)
      path.join('/app', 'docs', 'CHANGELOG.md')                 // Docker: mounted at /app
    ];

    let changelogFilePath = '';
    let fileFound = false;

    // Try each possible path
    for (const testPath of possiblePaths) {
      if (fs.existsSync(testPath)) {
        changelogFilePath = testPath;
        fileFound = true;
        break;
      }
    }

    if (!fileFound) {
      console.error('Changelog file not found. Searched paths:', possiblePaths);
      return res.status(404).json({
        error: 'Changelog file not found'
      });
    }

    const fileContent = fs.readFileSync(changelogFilePath, 'utf-8');
    res.json({ content: fileContent });
  } catch (error: any) {
    console.error('Error fetching changelog:', error);
    res.status(500).json({
      error: 'Failed to retrieve changelog'
    });
  }
});

// Health check endpoint for Docker
router.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

export default router;
