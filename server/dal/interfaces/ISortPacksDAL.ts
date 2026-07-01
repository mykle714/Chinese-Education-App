import { SortPackRow } from '../../types/sortPacks.js';

/**
 * Data-access contract for the `sort_packs` table (authored discover sort packs).
 *
 * The DAL owns pure pack SELECTs only: it does NOT know about per-user vet/skip state
 * or card hydration — the StarterPacksService composes those (it drops packs whose
 * cards are all already sorted, tags cards sorted/skipped, and builds fallback
 * packs-of-1). Keeping the DAL user-agnostic keeps the supply policy in one place.
 */
export interface ISortPacksDAL {
  /**
   * Authored packs at EXACTLY `level`, in curation order (packOrder, then id). Excludes
   * packs in `excludePackIds` (seen + ones the client already holds). Level drift is
   * driven by the service (it calls this per level), so level is honored strictly
   * before the authored-packs-first rule. Does NOT filter all-cards-already-sorted
   * packs (the service does, since that needs per-user vet state); over-fetch + filter.
   */
  fetchPacksAtLevel(
    language: string,
    level: number,
    excludePackIds: number[],
    limit: number
  ): Promise<SortPackRow[]>;

  /**
   * Every authored pack for a language, in curation order (level, packOrder). Used by
   * the build/deploy validation test and authoring tooling — not the hot serve path.
   */
  listByLanguage(language: string): Promise<SortPackRow[]>;
}
