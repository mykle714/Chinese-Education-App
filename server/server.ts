import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';

// Feature routers — every route registration lives in server/routes/*, one file
// per feature area. This file is only the app bootstrap: env, security
// middleware, CORS, parsers, router mounts, listen.
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import vocabEntryRoutes from './routes/vocabEntryRoutes.js';
import flashcardRoutes from './routes/flashcardRoutes.js';
import textRoutes from './routes/textRoutes.js';
import validationRoutes from './routes/validationRoutes.js';
import nightMarketTemplateRoutes from './routes/nightMarketTemplateRoutes.js';
import nightMarketSandboxRoutes from './routes/nightMarketSandboxRoutes.js';
import onDeckRoutes from './routes/onDeckRoutes.js';
import starterPacksRoutes from './routes/starterPacksRoutes.js';
import dictionaryRoutes from './routes/dictionaryRoutes.js';
import gamesRoutes from './routes/gamesRoutes.js';
import mediaRoutes from './routes/mediaRoutes.js';
import handwritingRoutes from './routes/handwritingRoutes.js';
import diagnosticsRoutes from './routes/diagnosticsRoutes.js';
import metaRoutes from './routes/metaRoutes.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '5000');

// Exactly one trusted proxy hop: in prod the backend is only reachable through
// the TLS-terminating nginx frontend container (host binding is 127.0.0.1:5002),
// so req.ip resolves to the real client for rate limiting. Dev connections are
// direct and unaffected.
app.set('trust proxy', 1);

// Baseline security headers (X-Content-Type-Options, frame protections, etc.).
// This server only returns JSON/audio/image bytes — helmet defaults are safe
// because the SPA is served by the separate frontend container.
app.use(helmet());

// Enable CORS for all routes with credentials
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if(!origin) return callback(null, true);

    // Define allowed origins
    const allowedOrigins = [
      process.env.CLIENT_URL || 'http://localhost:3000',
      'http://localhost:5175',  // Original frontend port
      'http://127.0.0.1:5175',  // Also allow 127.0.0.1 equivalent
      'http://localhost:5174',  // Vite dev server port
      'http://127.0.0.1:5174',  // Also allow 127.0.0.1 equivalent
      'http://localhost:5173',  // Fallback for development
      'http://127.0.0.1:5173',  // Also allow 127.0.0.1 equivalent for development
      'http://localhost:3000',  // Docker frontend development port
      'http://127.0.0.1:3000',  // Docker frontend development port
      'http://frontend:3000',   // Docker container networking
      'http://cow-frontend-local:3000', // Docker container name
      'https://mren.me' // Production domain (HTTPS only — auth cookies are `secure` in prod)
    ];

    if(allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn(`Origin ${origin} not allowed by CORS`);
      callback(null, false);
    }
  },
  credentials: true
}));

// Middleware to parse JSON bodies and cookies
app.use(express.json());
app.use(cookieParser());

// Fail fast if the JWT secret is missing. Without this check the app boots fine
// and every login/refresh 500s deep inside jwt.sign, which is much harder to
// diagnose than an immediate startup crash.
if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required — refusing to start without it');
}

// Mount feature routers. Each router registers its full /api/... paths, so
// mount order only matters where paths could overlap (they don't across files).
app.use(authRoutes);
app.use(userRoutes);
app.use(vocabEntryRoutes);
app.use(flashcardRoutes);
app.use(textRoutes);
app.use(validationRoutes);
app.use(nightMarketTemplateRoutes);
app.use(nightMarketSandboxRoutes);
app.use(onDeckRoutes);
app.use(starterPacksRoutes);
app.use(dictionaryRoutes);
app.use(gamesRoutes);
app.use(mediaRoutes);
app.use(handwritingRoutes);
app.use(diagnosticsRoutes);
app.use(metaRoutes);

// Start the server - bind to 0.0.0.0 to accept connections from all interfaces (required for Docker networking)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT} on all interfaces (0.0.0.0)`);
});
