// DAL-specific type definitions
export interface QueryResult<T = any> {
  recordset: T[];
  rowsAffected: number;
}

export interface ConnectionStats {
  activeConnections: number;
  totalConnections: number;
  averageResponseTime: number;
}

export interface HealthStatus {
  isHealthy: boolean;
  connectionTime: number;
  lastChecked: Date;
  error?: string;
}

export interface BulkResult {
  total: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: BulkError[];
}

export interface BulkError {
  row: number;
  data: any;
  error: string;
}

// Enhanced error types for DAL
export class DALError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public originalError?: any
  ) {
    super(message);
    this.name = 'DALError';
  }

  /**
   * Returns a sanitized version of the error safe for client consumption
   * Removes sensitive information like server names, connection strings, etc.
   */
  toClientError(): { message: string; code: string; statusCode: number } {
    // For connection errors, always return generic message
    if (this.code === 'ERR_DATABASE_CONNECTION') {
      return {
        message: 'Service temporarily unavailable. Please try again later.',
        code: 'ERR_SERVICE_UNAVAILABLE',
        statusCode: 503
      };
    }

    // For other database errors, sanitize the message
    let sanitizedMessage = this.message;
    
    // Remove any potential server names, IPs, or connection details
    sanitizedMessage = sanitizedMessage.replace(/mykle\.database\.windows\.net/gi, '[server]');
    sanitizedMessage = sanitizedMessage.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[server]');
    sanitizedMessage = sanitizedMessage.replace(/:\d{4,5}/g, '');
    sanitizedMessage = sanitizedMessage.replace(/in \d+ms/g, '');
    
    // For generic database errors, provide user-friendly messages
    if (this.code === 'ERR_DATABASE_OPERATION_FAILED' || this.code === 'ERR_DATABASE_UNKNOWN') {
      sanitizedMessage = 'A database error occurred. Please try again.';
    }

    return {
      message: sanitizedMessage,
      code: this.code,
      statusCode: this.statusCode
    };
  }
}

export class ValidationError extends DALError {
  constructor(message: string, originalError?: any) {
    super(message, 'ERR_VALIDATION_FAILED', 400, originalError);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends DALError {
  constructor(message: string, originalError?: any) {
    super(message, 'ERR_NOT_FOUND', 404, originalError);
    this.name = 'NotFoundError';
  }
}

export class DuplicateError extends DALError {
  constructor(message: string, originalError?: any) {
    super(message, 'ERR_DUPLICATE', 409, originalError);
    this.name = 'DuplicateError';
  }
}

export class DatabaseConnectionError extends DALError {
  constructor(message: string, originalError?: any) {
    super(message, 'ERR_DATABASE_CONNECTION', 503, originalError);
    this.name = 'DatabaseConnectionError';
  }
}

// Transaction wrapper interface
export interface ITransaction {
  commit(): Promise<void>;
  rollback(): Promise<void>;
  getClient(): any; // PostgreSQL client object (was request() for SQL Server)
  isActive: boolean;
}

// Generic pagination interface
export interface PaginationOptions {
  limit?: number;
  offset?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  hasMore: boolean;
  limit: number;
  offset: number;
}
