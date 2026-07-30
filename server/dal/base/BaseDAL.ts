import { DatabaseManager } from './DatabaseManager.js';
import { IBaseDAL } from '../interfaces/IBaseDAL.js';
import {
  PaginationOptions,
  ITransaction,
  NotFoundError,
  ValidationError,
  DALError
} from '../../types/dal.js';

/**
 * Generic CRUD base for DALs whose identity is "one table, one primary-key column".
 *
 * ── Who extends this ───────────────────────────────────────────────────────────
 * `UserDAL` and `VocabEntryDAL`. That is the whole list, and it should stay short:
 * a DAL only belongs here if a bare `SELECT * FROM <table> WHERE <pk> = $1` is
 * CORRECT for it. `DictionaryDAL` used to extend this and bound itself to
 * `dictionaryentries_zh` in its `super()` call, while every real query in the file
 * resolved its table per language through `dictTableForLanguage()`. It used none of
 * the inherited methods, so nothing was broken — but the first caller to reach for
 * `dictionaryDAL.findById(id)` on a Spanish entry would have got a silent
 * wrong-table read, with no type error and no runtime error. It no longer extends
 * this class. See docs/ARCHITECTURE_REVIEW.md finding 1.
 *
 * ── Why this is short ──────────────────────────────────────────────────────────
 * Seven further generic methods (`findAllPaginated`, `count`, `createMany`,
 * `findByIds`, `exists`, `updateWithTransaction`, `deleteWithTransaction`) were
 * removed: each had zero call sites in the entire server. See IBaseDAL.
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

  // Protected utility methods for subclasses to override

  /**
   * Build INSERT query components for PostgreSQL
   */
  /**
   * Defense-in-depth: column names are interpolated into SQL (values are always
   * parameterized), so every key must look like a plain identifier. Callers are
   * expected to build the data object from destructured, known fields — this
   * guard exists so a future `dal.update(id, req.body)` can't smuggle a quoted
   * identifier (`foo" = $1 --`) into the statement.
   */
  protected assertSafeColumnName(key: string): void {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new ValidationError(`Invalid column name in query data: "${key}"`);
    }
  }

  protected buildInsertQuery(data: TCreate): {
    columns: string;
    placeholders: string;
    values: any[];
  } {
    const entries = Object.entries(data as any);
    entries.forEach(([key]) => this.assertSafeColumnName(key));
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
    entries.forEach(([key]) => this.assertSafeColumnName(key));
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
