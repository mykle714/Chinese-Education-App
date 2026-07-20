import dotenv from 'dotenv';
import { PoolConfig } from 'pg';

dotenv.config();

export const config: PoolConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'cow_db',
  user: process.env.DB_USER || 'cow_user',
  password: process.env.DB_PASSWORD || 'cow_password_local',
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
  ssl: resolveSsl()
};

/**
 * Decide whether to open the connection with TLS.
 *
 * `DB_SSL` is the explicit control — set it to 'true'/'1' to force TLS on, or
 * 'false'/'0' to force it off, and nothing else is consulted.
 *
 * When DB_SSL is unset we fall back to the historical inference: TLS in production
 * unless DB_HOST is the literal 'postgres', which is the docker-compose service name
 * and therefore means "the database next door on the compose network, plaintext is
 * fine". That heuristic breaks for any OTHER way of reaching the same container —
 * notably the host reaching cow-postgres-prod over its published 127.0.0.1:5432
 * port, where the hostname is an IP, so TLS was inferred and the connection died
 * with "The server does not support SSL connections" (postgres:15-alpine is not
 * built with TLS). Prefer setting DB_SSL explicitly; the inference is kept only so
 * existing deployments that set neither variable keep their current behavior.
 */
function resolveSsl(): PoolConfig['ssl'] {
  const flag = process.env.DB_SSL?.trim().toLowerCase();
  if (flag === 'true' || flag === '1') return { rejectUnauthorized: false };
  if (flag === 'false' || flag === '0') return false;

  const inferred = process.env.NODE_ENV === 'production' && process.env.DB_HOST !== 'postgres';
  return inferred ? { rejectUnauthorized: false } : false;
}
