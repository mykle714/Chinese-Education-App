import { PaginationOptions, PaginatedResult, ITransaction } from '../../types/dal.js';

/**
 * Base interface for all Data Access Layer implementations
 * Provides common CRUD operations that every entity should support
 */
export interface IBaseDAL<T, TCreate, TUpdate> {
  // Basic CRUD operations
  findById(id: string | number): Promise<T | null>;
  findAll(options?: PaginationOptions): Promise<T[]>;
  create(data: TCreate): Promise<T>;
  update(id: string | number, data: TUpdate): Promise<T>;
  delete(id: string | number): Promise<boolean>;

  // Paginated operations
  findAllPaginated(options: PaginationOptions): Promise<PaginatedResult<T>>;
  count(): Promise<number>;

  // Transaction support
  createWithTransaction(data: TCreate, transaction: ITransaction): Promise<T>;
  updateWithTransaction(id: string | number, data: TUpdate, transaction: ITransaction): Promise<T>;
  deleteWithTransaction(id: string | number, transaction: ITransaction): Promise<boolean>;

  // Bulk operations
  createMany(data: TCreate[]): Promise<T[]>;
  findByIds(ids: (string | number)[]): Promise<T[]>;

  // Utility operations
  exists(id: string | number): Promise<boolean>;
}
