/**
 * The browser origins allowed to call this API with credentials.
 *
 * One list for two gates:
 *   - the CORS middleware in server/server.ts (HTTP requests), and
 *   - the voice WebSocket upgrade (server/routes/voiceRoutes.ts → attachVoiceSocket). A
 *     WebSocket handshake is NOT covered by CORS, so the socket checks `Origin` itself before
 *     it will accept cookie auth (docs/VOICE_ASSISTANT.md § 2).
 *
 * Extracted from the inline list server.ts used to carry, so the two gates cannot drift.
 */
export const ALLOWED_ORIGINS: readonly string[] = [
  process.env.CLIENT_URL || 'http://localhost:3000',
  'http://localhost:5175', // Original frontend port
  'http://127.0.0.1:5175', // Also allow 127.0.0.1 equivalent
  'http://localhost:5174', // Vite dev server port
  'http://127.0.0.1:5174', // Also allow 127.0.0.1 equivalent
  'http://localhost:5173', // Fallback for development
  'http://127.0.0.1:5173', // Also allow 127.0.0.1 equivalent for development
  'http://localhost:3000', // Docker frontend development port
  'http://127.0.0.1:3000', // Docker frontend development port
  'http://frontend:3000', // Docker container networking
  'http://cow-frontend:3000', // Docker container name
  'https://mren.me', // PPE domain (HTTPS only — auth cookies are `secure` in PPE)
];

/** True for a missing origin (curl, native app) or one on the list. */
export function isAllowedOrigin(origin: string | undefined | null): boolean {
  return !origin || ALLOWED_ORIGINS.includes(origin);
}
