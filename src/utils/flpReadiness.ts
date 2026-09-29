/**
 * flpReadiness — client entry point.
 *
 * The formula itself lives in `server/contracts/flpReadiness.ts`, the one module both
 * the server (`OnDeckVocabService.getFlpReadyCounts`) and the client consume. This file
 * is a re-export so every existing `from "../utils/flpReadiness"` import keeps working;
 * it holds no logic of its own beyond adapting `VocabEntry` to the contract's minimal
 * `{ typedMarkHistory }` shape.
 *
 * Referenced by docs/DECKS_FEATURE.md § "The card hand".
 */
import type { VocabEntry } from "../types";
import {
  flpCooldownRemainingMs as contractFlpCooldownRemainingMs,
  isFlpReady as contractIsFlpReady,
  flpReadyCountsByBand as contractFlpReadyCountsByBand,
  nextFlpReadyMs as contractNextFlpReadyMs,
} from "../../server/contracts/flpReadiness";

export function flpCooldownRemainingMs(entry: VocabEntry, now: number): number {
  return contractFlpCooldownRemainingMs(entry.typedMarkHistory, now);
}

export function isFlpReady(entry: VocabEntry, now: number): boolean {
  return contractIsFlpReady(entry.typedMarkHistory, now);
}

export function flpReadyCountsByBand(
  entries: readonly VocabEntry[],
  now: number
): Record<string, number> {
  return contractFlpReadyCountsByBand(entries, now);
}

export function nextFlpReadyMs(
  entries: readonly VocabEntry[],
  bands: readonly string[],
  now: number
): number | null {
  return contractNextFlpReadyMs(entries, bands, now);
}
