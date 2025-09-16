import { PoolClient } from 'pg';
import db from '../../db.js';
import { 
  QueryResult, 
  ConnectionStats, 
  HealthStatus, 
  ITransaction,
  DatabaseConnectionError,
  DALError
} from '../../types/dal.js';

// Transaction wrapper implementation for PostgreSQL
class Transaction implements ITransaction {
  public isActive: boolean = true;

  constructor(private client: PoolClient) {}

  async commit(): Promise<void> {
    if (!this.isActive) {
      throw new DALError('Transaction is not active', 'ERR_TRANSACTION_INACTIVE');
    }
    
    try {
      await this.client.query('COMMIT');
      this.isActive = false;
      this.client.release(); // Release client back to pool
    } catch (error: any) {
      this.isActive = false;
      this.client.release();
      throw new DALError('Failed to commit transaction', 'ERR_TRANSACTION_COMMIT_FAILED', 500, error);
    }
  }

  async rollback(): Promise<void> {
    if (!this.isActive) {
      return; // Already rolled back or committed
    }
    
    try {
      await this.client.query('ROLLBACK');
      this.isActive = false;
      this.client.release(); // Release client back to pool
    } catch (error: any) {
      this.isActive = false;
      this.client.release();
      throw new DALError('Failed to rollback transaction', 'ERR_TRANSACTION_ROLLBACK_FAILED', 500, error);
    }
  }

  getClient(): PoolClient {
    if (!this.isActive) {
      throw new DALError('Transaction is not active', 'ERR_TRANSACTION_INACTIVE');
    }
    return this.client;
  }
}

/**
 * Enhanced database manager that wraps the existing database connection
 * Provides transaction support, error handling, and performance monitoring
 */
export class DatabaseManager {
  private static instance: DatabaseManager;
  private connectionStats: ConnectionStats = {
    activeConnections: 0,
    totalConnections: 0,
    averageResponseTime: 0
  };
  private responseTimes: number[] = [];

  private constructor() {}

  /**
   * Get singleton instance of DatabaseManager
   */
  public static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  /**
   * Get a database client with retry logic
   */
  async getConnection(): Promise<PoolClient> {
    const maxRetries = 3;
    let lastError: any;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const client = await db.getClient();
        this.connectionStats.activeConnections++;
        this.connectionStats.totalConnections++;
        
        return client;
      } catch (error: any) {
        lastError = error;
        
        // Log the attempt with full details server-side
        console.error(`Database connection attempt ${attempt}/${maxRetries} failed:`, {
          message: error.message,
          code: error.code,
          timestamp: new Date().toISOString()
        });

        // If this isn't the last attempt, wait before retrying
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt - 1) * 1000; // Exponential backoff: 1s, 2s, 4s
          console.log(`Retrying database connection in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // All retries failed - throw sanitized error
    throw new DatabaseConnectionError('Database temporarily unavailable', lastError);
  }

  /**
   * Execute a query with performance monitoring
   */
  async executeQuery<T = any>(
    queryBuilder: (client: PoolClient) => Promise<any>
  ): Promise<QueryResult<T>> {
    const startTime = Date.now();
    let client: PoolClient | null = null;
    
    try {
      client = await this.getConnection();
      const result = await queryBuilder(client);
      
      const responseTime = Date.now() - startTime;
      this.updatePerformanceStats(responseTime);
      
      return {
        recordset: result.rows || [],
        rowsAffected: result.rowCount || 0
      };
    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      this.updatePerformanceStats(responseTime);
      
      throw this.handleDatabaseError(error);
    } finally {
      if (client) {
        client.release();
      }
      this.connectionStats.activeConnections = Math.max(0, this.connectionStats.activeConnections - 1);
    }
  }

  /**
   * Begin a new transaction with retry logic
   */
  async beginTransaction(): Promise<ITransaction> {
    const maxRetries = 3;
    let lastError: any;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const client = await db.getClient();
        await client.query('BEGIN');
        
        return new Transaction(client);
      } catch (error: any) {
        lastError = error;
        
        // Log the attempt with full details server-side
        console.error(`Transaction creation attempt ${attempt}/${maxRetries} failed:`, {
          message: error.message,
          code: error.code,
          timestamp: new Date().toISOString()
        });

        // If this isn't the last attempt, wait before retrying
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt - 1) * 1000; // Exponential backoff: 1s, 2s, 4s
          console.log(`Retrying transaction creation in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // All retries failed - throw sanitized error
    throw new DatabaseConnectionError('Database temporarily unavailable', lastError);
  }

  /**
   * Execute operations within a transaction with automatic rollback on error
   */
  async executeInTransaction<T>(
    operation: (transaction: ITransaction) => Promise<T>
  ): Promise<T> {
    const transaction = await this.beginTransaction();
    
    try {
      const result = await operation(transaction);
      await transaction.commit();
      return result;
    } catch (error: any) {
      if (transaction.isActive) {
        await transaction.rollback();
      }
      throw error;
    }
  }

  /**
   * Test database connection health
   */
  async healthCheck(): Promise<HealthStatus> {
    const startTime = Date.now();
    let client: PoolClient | null = null;
    
    try {
      client = await this.getConnection();
      await client.query('SELECT 1 as test');
      
      const connectionTime = Date.now() - startTime;
      
      return {
        isHealthy: true,
        connectionTime,
        lastChecked: new Date()
      };
    } catch (error: any) {
      return {
        isHealthy: false,
        connectionTime: Date.now() - startTime,
        lastChecked: new Date(),
        error: error.message
      };
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  /**
   * Get connection statistics
   */
  getConnectionStats(): ConnectionStats {
    return { ...this.connectionStats };
  }

  /**
   * Update performance statistics
   */
  private updatePerformanceStats(responseTime: number): void {
    this.responseTimes.push(responseTime);
    
    // Keep only last 100 response times for average calculation
    if (this.responseTimes.length > 100) {
      this.responseTimes = this.responseTimes.slice(-100);
    }
    
    this.connectionStats.averageResponseTime = 
      this.responseTimes.reduce((sum, time) => sum + time, 0) / this.responseTimes.length;
  }

  /**
   * Handle and convert database errors to DAL errors
   */
  private handleDatabaseError(error: any): DALError {
    console.error('Database error:', error);
    
    // PostgreSQL specific error handling
    if (error.code) {
      switch (error.code) {
        case '42703': // Undefined column
        case '42P01': // Undefined table
          const dalError = new DALError('Database operation failed', 'ERR_DATABASE_OPERATION_FAILED', 500, error);
          // Preserve the original error message for column-specific handling
          dalError.message = error.message;
          return dalError;
        
        case '23505': // Unique constraint violation
          return new DALError('Duplicate entry', 'ERR_DUPLICATE', 409, error);
        
        case '23503': // Foreign key constraint violation
          return new DALError('Foreign key constraint violation', 'ERR_FOREIGN_KEY_VIOLATION', 400, error);
        
        case '23502': // Not null constraint violation
          return new DALError('Required field is missing', 'ERR_REQUIRED_FIELD', 400, error);
        
        case '57014': // Query timeout
          return new DALError('Database operation timeout', 'ERR_TIMEOUT', 408, error);
        
        case '08000': // Connection exception
        case '08003': // Connection does not exist
        case '08006': // Connection failure
          return new DatabaseConnectionError('Database connection failed', error);
        
        default:
          return new DALError('Database operation failed', 'ERR_DATABASE_OPERATION_FAILED', 500, error);
      }
    }
    
    // Connection errors
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      return new DatabaseConnectionError('Database connection failed', error);
    }
    
    // Generic database error
    return new DALError(
      error.message || 'Unknown database error',
      'ERR_DATABASE_UNKNOWN',
      500,
      error
    );
  }
}

// Export singleton instance
export const dbManager = DatabaseManager.getInstance();
