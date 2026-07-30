import { PaginationOptions, ITransaction } from '../../types/dal.js';

/**
 * The generic CRUD surface shared by the DALs that key on a single-column primary
 * key in a single table — currently `UserDAL` and `VocabEntryDAL`.
 *
 * ── Why this is short ──────────────────────────────────────────────────────────
 * It used to declare 13 methods. Seven of them (`findAllPaginated`, `count`,
 * `createMany`, `findByIds`, `exists`, `updateWithTransaction`,
 * `deleteWithTransaction`) had ZERO call sites anywhere in the server — they were
 * speculative surface area that every implementer had to carry. They were removed
 * rather than kept "in case", because an unused generic method on a base class is
 * also an unused generic SQL statement: `findAllPaginated` on a per-language table,
 * for instance, would have silently read the wrong table.
 *
 * Anything genuinely generic that a future DAL needs can be added back here with
 * its first real caller.
 *
 * NOT every DAL implements this. A DAL whose identity is not "one table, one
 * primary key" — `DictionaryDAL` above all, which resolves its table per language
 * via `dictTableForLanguage()` — implements only its own interface. See
 * docs/ARCHITECTURE_REVIEW.md finding 1.
 */
export interface IBaseDAL<T, TCreate, TUpdate> {
  // Basic CRUD operations
  findById(id: string | number): Promise<T | null>;
  findAll(options?: PaginationOptions): Promise<T[]>;
  create(data: TCreate): Promise<T>;
  update(id: string | number, data: TUpdate): Promise<T>;
  delete(id: string | number): Promise<boolean>;

  // Transaction support (used by the registration flow: user + refresh token in one tx)
  createWithTransaction(data: TCreate, transaction: ITransaction): Promise<T>;
}
