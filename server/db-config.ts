import dotenv from 'dotenv';
import { DbConfig } from './types/index.js';

dotenv.config();

export const config: DbConfig = {
  server: process.env.DB_SERVER || '',
  database: process.env.DB_NAME || '',
  authentication: {
    type: process.env.CONNECTION_TYPE,
    options: {
      clientId: process.env.CLIENT_ID || '',
      clientSecret: process.env.CLIENT_SECRET || '',
      tenantId: process.env.TENANT_ID || ''
    }
  },
  options: {
    encrypt: true,
    trustServerCertificate: false,
    // Enable proper handling of Unicode characters
    enableArithAbort: true
  }
};
