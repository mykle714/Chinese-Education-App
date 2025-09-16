import { PoolClient } from 'pg';
import { DatabaseManager } from './DatabaseManager.js';
import { IBaseDAL } from '../interfaces/IBaseDAL.js';
import { 
  PaginationOptions, 
  PaginatedResult, 
  ITransaction,
  NotFoundError,
  ValidationError,
  DALError
} from '../../types/dal.js';

/**
 * Abstract base class for all Data Access Layer implementations
 * Provides common CRUD operations and utilities for PostgreSQL
 */
export abstract class BaseDAL<T, TCreate, TUpdate> implements IBaseDAL<T, TCreate, TUpdate> {
  protected dbManager: DatabaseManager;
  protected tableName: string;
  protected primaryKeyColumn: string;

  constructor(
    dbManager: DatabaseManager,
    tableName: string,
    primaryKeyColumn: string = 'id'
  ) {
    this.dbManager = dbManager;
    this.tableName = tableName;
    this.primaryKeyColumn = primaryKeyColumn;
  }

  /**
   * Find a record by its primary key
   */
  async findById(id: string | number): Promise<T | null> {
    if (!id) {
      throw new ValidationError(`${this.primaryKeyColumn} is required`);
    }

    const result = await this.dbManager.executeQuery<T>(async (client) => {
      return await client.query(`SELECT * FROM ${this.tableName} WHERE ${this.primaryKeyColumn} = $1`, [id]);
    });

    return result.recordset[0] || null;
  }

  /**
   * Find all records with optional pagination
   */
  async findAll(options: PaginationOptions = {}): Promise<T[]> {
    const { limit = 100, offset = 0 } = options;

    const result = await this.dbManager.executeQuery<T>(async (client) => {
      return await client.query(`
        SELECT * FROM ${this.tableName} 
        ORDER BY ${this.primaryKeyColumn} 
        LIMIT $1 OFFSET $2
      `, [limit, offset]);
    });

    return result.recordset;
  }

  /**
   * Find all records with pagination metadata
   */
  async findAllPaginated(options: PaginationOptions): Promise<PaginatedResult<T>> {
    const { limit = 10, offset = 0 } = options;
    
    const [data, total] = await Promise.all([
      this.findAll(options),
      this.count()
    ]);

    return {
      data,
      total,
      hasMore: offset + data.length < total,
      limit,
      offset
    };
  }

  /**
   * Count total records in the table
   */
  async count(): Promise<number> {
    const result = await this.dbManager.executeQuery<{ count: string }>(async (client) => {
      return await client.query(`SELECT COUNT(*) as count FROM ${this.tableName}`);
    });

    return parseInt(result.recordset[0].count);
  }

  /**
   * Create a new record
   */
  async create(data: TCreate): Promise<T> {
    this.validateCreateData(data);
    
    const { columns, placeholders, values } = this.buildInsertQuery(data);
    
    const result = await this.dbManager.executeQuery<T>(async (client) => {
      return await client.query(`
        INSERT INTO ${this.tableName} (${columns}) 
        VALUES (${placeholders})
        RETURNING *
      `, values);
    });

    if (result.recordset.length === 0) {
      throw new DALError('Failed to create record', 'ERR_CREATE_FAILED');
    }

    return result.recordset[0];
  }

  /**
   * Update an existing record
   */
  async update(id: string | number, data: TUpdate): Promise<T> {
    if (!id) {
      throw new ValidationError(`${this.primaryKeyColumn} is required`);
    }

    this.validateUpdateData(data);

    const { setClause, values } = this.buildUpdateQuery(data);

    const result = await this.dbManager.executeQuery<T>(async (client) => {
      return await client.query(`
        UPDATE ${this.tableName} 
        SET ${setClause} 
        WHERE ${this.primaryKeyColumn} = $${values.length + 1}
        RETURNING *
      `, [...values, id]);
    });

    if (result.recordset.length === 0) {
      throw new NotFoundError(`Record with ${this.primaryKeyColumn} ${id} not found`);
    }

    return result.recordset[0];
  }

  /**
   * Delete a record by ID
   */
  async delete(id: string | number): Promise<boolean> {
    if (!id) {
      throw new ValidationError(`${this.primaryKeyColumn} is required`);
    }

    const result = await this.dbManager.executeQuery(async (client) => {
      return await client.query(`DELETE FROM ${this.tableName} WHERE ${this.primaryKeyColumn} = $1`, [id]);
    });

    return result.rowsAffected > 0;
  }

  /**
   * Create a record within a transaction
   */
  async createWithTransaction(data: TCreate, transaction: ITransaction): Promise<T> {
    this.validateCreateData(data);
    
    const { columns, placeholders, values } = this.buildInsertQuery(data);
    
    const client = transaction.getClient();
    const result = await client.query(`
      INSERT INTO ${this.tableName} (${columns}) 
      VALUES (${placeholders})
      RETURNING *
    `, values);

    if (result.rows.length === 0) {
      throw new DALError('Failed to create record', 'ERR_CREATE_FAILED');
    }

    return result.rows[0];
  }

  /**
   * Update a record within a transaction
   */
  async updateWithTransaction(id: string | number, data: TUpdate, transaction: ITransaction): Promise<T> {
    if (!id) {
      throw new ValidationError(`${this.primaryKeyColumn} is required`);
    }

    this.validateUpdateData(data);

    const { setClause, values } = this.buildUpdateQuery(data);
    
    const client = transaction.getClient();
    const result = await client.query(`
      UPDATE ${this.tableName} 
      SET ${setClause} 
      WHERE ${this.primaryKeyColumn} = $${values.length + 1}
      RETURNING *
    `, [...values, id]);

    if (result.rows.length === 0) {
      throw new NotFoundError(`Record with ${this.primaryKeyColumn} ${id} not found`);
    }

    return result.rows[0];
  }

  /**
   * Delete a record within a transaction
   */
  async deleteWithTransaction(id: string | number, transaction: ITransaction): Promise<boolean> {
    if (!id) {
      throw new ValidationError(`${this.primaryKeyColumn} is required`);
    }

    const client = transaction.getClient();
    const result = await client.query(`DELETE FROM ${this.tableName} WHERE ${this.primaryKeyColumn} = $1`, [id]);

    return result.rowCount > 0;
  }

  /**
   * Create multiple records
   */
  async createMany(data: TCreate[]): Promise<T[]> {
    if (!data || data.length === 0) {
      return [];
    }

    return await this.dbManager.executeInTransaction(async (transaction) => {
      const results: T[] = [];
      
      for (const item of data) {
        const result = await this.createWithTransaction(item, transaction);
        results.push(result);
      }
      
      return results;
    });
  }

  /**
   * Find multiple records by their IDs
   */
  async findByIds(ids: (string | number)[]): Promise<T[]> {
    if (!ids || ids.length === 0) {
      return [];
    }

    const placeholders = ids.map((_, index) => `$${index + 1}`).join(',');
    
    const result = await this.dbManager.executeQuery<T>(async (client) => {
      return await client.query(`
        SELECT * FROM ${this.tableName} 
        WHERE ${this.primaryKeyColumn} IN (${placeholders})
      `, ids);
    });

    return result.recordset;
  }

  /**
   * Check if a record exists
   */
  async exists(id: string | number): Promise<boolean> {
    if (!id) {
      return false;
    }

    const result = await this.dbManager.executeQuery<{ count: string }>(async (client) => {
      return await client.query(`SELECT COUNT(*) as count FROM ${this.tableName} WHERE ${this.primaryKeyColumn} = $1`, [id]);
    });

    return parseInt(result.recordset[0].count) > 0;
  }

  // Protected utility methods for subclasses to override

  /**
   * Build INSERT query components for PostgreSQL
   */
  protected buildInsertQuery(data: TCreate): {
    columns: string;
    placeholders: string;
    values: any[];
  } {
    const entries = Object.entries(data as any);
    const columns = entries.map(([key]) => `"${key}"`).join(', ');
    const placeholders = entries.map((_, index) => `$${index + 1}`).join(', ');
    const values = entries.map(([, value]) => value);

    return { columns, placeholders, values };
  }

  /**
   * Build UPDATE query components for PostgreSQL
   */
  protected buildUpdateQuery(data: TUpdate): {
    setClause: string;
    values: any[];
  } {
    const entries = Object.entries(data as any);
    const setClause = entries.map(([key], index) => `"${key}" = $${index + 1}`).join(', ');
    const values = entries.map(([, value]) => value);

    return { setClause, values };
  }

  /**
   * Validate data before creating a record
   * Subclasses should override this for specific validation
   */
  protected validateCreateData(data: TCreate): void {
    if (!data) {
      throw new ValidationError('Data is required');
    }
  }

  /**
   * Validate data before updating a record
   * Subclasses should override this for specific validation
   */
  protected validateUpdateData(data: TUpdate): void {
    if (!data) {
      throw new ValidationError('Data is required');
    }
  }
}
