import sql from 'mssql';
import { config } from './db-config.js';

interface DbConnection {
  sql: typeof sql;
  poolPromise: Promise<any>; // Using any for now to avoid type issues
}

const poolPromise: Promise<any> = new sql.ConnectionPool(config)
  .connect()
  .then(pool => {
    console.log('Connected to Azure SQL Database');
    return pool;
  })
  .catch(err => {
    console.error('Database Connection Failed: ', err);
    if (err.originalError && err.originalError.errors) {
      console.error('Detailed errors:', err.originalError.errors);
    }
    throw err; // Re-throw to handle it in the application
  });

const db: DbConnection = {
  sql,
  poolPromise
};

export default db;
