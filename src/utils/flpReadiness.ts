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
import type { FlpForeignTrack } from "../../server/contracts/wire";
import {
  flpCooldownRemainingMs as contractFlpCooldownRemainingMs,
  isFlpReady as contractIsFlpReady,
  flpReadyCountsByBand as contractFlpReadyCountsByBand,
  nextFlpReadyMs as contractNextFlpReadyMs,
} from "../../server/contracts/flpReadiness";

export function flpCooldownRemainingMs(
  entry: VocabEntry,
  foreignTrack: FlpForeignTrack,
  now: number
): number {
  return contractFlpCooldownRemainingMs(entry.typedMarkHistory, foreignTrack, now);
}

export function isFlpReady(entry: VocabEntry, foreignTrack: FlpForeignTrack, now: number): boolean {
  return contractIsFlpReady(entry.typedMarkHistory, foreignTrack, now);
}

export function flpReadyCountsByBand(
  entries: readonly VocabEntry[],
  foreignTrack: FlpForeignTrack,
  now: number
): Record<string, number> {
  return contractFlpReadyCountsByBand(entries, foreignTrack, now);
}

export function nextFlpReadyMs(
  entries: readonly VocabEntry[],
  bands: readonly string[],
  foreignTrack: FlpForeignTrack,
  now: number
): number | null {
  return contractNextFlpReadyMs(entries, bands, foreignTrack, now);
}
