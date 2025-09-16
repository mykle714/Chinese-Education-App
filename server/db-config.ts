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
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
};
