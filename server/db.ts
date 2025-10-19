import { Pool, PoolClient } from 'pg';
import { config } from './db-config.js';

interface DbConnection {
  pool: Pool;
  getClient: () => Promise<PoolClient>;
}

// Create a connection pool
const pool = new Pool(config);

/**
 * Gets a client from the connection pool
 * This approach uses connection pooling for better performance and resource management
 */
async function getClient(): Promise<PoolClient> {
  try {
    const client = await pool.connect();
    // Client retrieved from pool (not logging to reduce verbosity)
    return client;
  } catch (err: any) {
    // Log full error details server-side for debugging
    console.error('Database Connection Failed:', {
      message: err.message,
      code: err.code,
      timestamp: new Date().toISOString()
    });
    
    // Don't re-throw the original error to prevent sensitive info exposure
    // The DatabaseManager will handle connection failures with sanitized errors
    throw new Error('Database connection unavailable');
  }
}

// Handle pool events
pool.on('connect', () => {
  console.log('PostgreSQL pool connected');
});

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err);
});

const db: DbConnection = {
  pool,
  getClient
};

export default db;
