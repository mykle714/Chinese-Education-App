import type { PronunciationOverride } from "../../server/contracts/wire";
import type { DictionaryEntry } from "../types";
import { resolveDisplayPronunciation } from "../utils/definitionUtils";
import { numberedToTonedPinyin, readingSyllableCount } from "../utils/textUtils";

/**
 * READING CHOICES — the pure half (docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Reading choices").
 *
 * A document stores per-occurrence reading overrides (texts."pronunciationOverrides",
 * migration 207): `{ start, end, text, reading }`, `reading` in NUMBERED pinyin ("de2").
 * Everything a reading surface needs from them lives here:
 *
 *   - `readingOptionsFor(entry)` — the readings a tap on the rdb headword cycles through;
 *   - `cycleOverride(...)`       — the list after one tap on a selected occurrence;
 *   - `buildOverrideLookup(...)` — span → its TONED override, for the display/audio paths;
 *   - `shiftPronunciationOverrides(...)` — keeps offsets in step with an edit ("shift only").
 *
 * Layer: shared client logic (src/reading), no React. Depended on by
 * src/reading/usePronunciationOverrides.ts, src/reading/useReadingKeycap.tsx,
 * src/features/reader/ReaderDocumentPage.tsx. Server twin of the validation:
 * server/utils/pronunciationOverrides.ts.
 */

/** One reading a word can be cycled to. `numbered` is null for the DEFAULT (no override). */
export interface ReadingOption {
    numbered: string | null;
    toned: string;
}

/** The occurrence a reading choice applies to (a gsa span or a selection range). */
export interface OverrideTarget {
    start: number;
    end: number;
    text: string;
}

/** Span → the toned reading it was switched to, or undefined to use its default. */
export type OverrideLookup = (target: OverrideTarget) => string | undefined;

/** The lookup for a document with no reading choices — shared so memos keep identity. */
export const NO_OVERRIDE_LOOKUP: OverrideLookup = () => undefined;

const normalize = (numbered: string) => numbered.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The readings a tap cycles through, DEFAULT FIRST: the word's display reading
 * (`resolveDisplayPronunciation` — what every surface shows without a choice), then each
 * other distinct `definitionClusters[].reading`, in cluster order. A cluster reading is
 * skipped when it converts to the same tone marks as one already listed, fails to convert,
 * or has a different syllable count than the default (the same guard
 * `resolveDisplayPronunciation` applies — a reading must zip one syllable per character).
 *
 * Fewer than 2 options = nothing to cycle: the headword keeps tap-to-copy (owner's call
 * 2026-11-23).
 */
export function readingOptionsFor(
    entry: Pick<DictionaryEntry, "pronunciation" | "definitionClusters" | "selectedSense"> | null | undefined,
): ReadingOption[] {
    if (!entry) return [];
    const defaultToned = resolveDisplayPronunciation(entry);
    if (!defaultToned) return [];
    const options: ReadingOption[] = [{ numbered: null, toned: defaultToned }];
    const defaultSyllables = readingSyllableCount(defaultToned);
    for (const cluster of entry.definitionClusters ?? []) {
        const reading = cluster?.reading;
        if (!reading) continue;
        const toned = numberedToTonedPinyin(reading);
        if (!toned || readingSyllableCount(toned) !== defaultSyllables) continue;
        if (options.some((option) => option.toned === toned)) continue;
        options.push({ numbered: normalize(reading), toned });
    }
    return options;
}

/** The override sitting exactly on `target`, if any (its word must still match). */
export function findOverride(overrides: PronunciationOverride[], target: OverrideTarget): PronunciationOverride | undefined {
    return overrides.find((o) => o.start === target.start && o.end === target.end && o.text === target.text);
}

/**
 * The list after one tap on `target`: the next option after its current reading, wrapping
 * past the last back to the default — which REMOVES the entry rather than storing it.
 * A stored reading that is no longer among the options (the det row changed) counts as
 * the default, so the tap moves to the first alternative.
 * Returns the list unchanged when there is nothing to cycle.
 */
export function cycleOverride(
    overrides: PronunciationOverride[],
    target: OverrideTarget,
    options: ReadingOption[],
): PronunciationOverride[] {
    if (options.length < 2) return overrides;
    const current = findOverride(overrides, target);
    const currentIndex = current ? options.findIndex((o) => o.numbered === normalize(current.reading)) : 0;
    const next = options[(Math.max(currentIndex, 0) + 1) % options.length];
    // Drop the old entry and anything overlapping the target (there should be none).
    const rest = overrides.filter((o) => !(o.start < target.end && target.start < o.end));
    if (next.numbered === null) return rest;
    return [...rest, { start: target.start, end: target.end, text: target.text, reading: next.numbered }]
        .sort((a, b) => a.start - b.start);
}

/**
 * Span → toned override, for the display and audio paths. Keyed on `start` (overrides
 * never overlap); the end + text must match too, so a choice made on 得 never applies to a
 * span the gsa now cuts differently (e.g. after a tiebreak switch).
 */
export function buildOverrideLookup(overrides: PronunciationOverride[]): OverrideLookup {
    if (overrides.length === 0) return NO_OVERRIDE_LOOKUP;
    const byStart = new Map<number, { end: number; text: string; toned: string }>();
    for (const o of overrides) {
        const toned = numberedToTonedPinyin(o.reading);
        if (toned) byStart.set(o.start, { end: o.end, text: o.text, toned });
    }
    return (target) => {
        const hit = byStart.get(target.start);
        return hit && hit.end === target.end && hit.text === target.text ? hit.toned : undefined;
    };
}

/**
 * Keep reading choices on their words across an edit — SHIFT ONLY (owner's call
 * 2026-11-23). The edit is taken as ONE changed stretch: the longest common prefix and
 * suffix of the old and new content are unchanged, the middle is what changed.
 *   - a choice wholly inside the prefix stays where it is;
 *   - a choice wholly inside the suffix moves by the length difference;
 *   - a choice touching the changed stretch is dropped;
 * and any choice whose word is not at its new offsets is dropped too. Several separate
 * edits in one editing session read as one stretch spanning them all, so choices between
 * them are dropped — naive by design.
 */
export function shiftPronunciationOverrides(
    oldContent: string,
    newContent: string,
    overrides: PronunciationOverride[],
): PronunciationOverride[] {
    if (overrides.length === 0 || oldContent === newContent) return overrides;
    const maxShared = Math.min(oldContent.length, newContent.length);
    let prefix = 0;
    while (prefix < maxShared && oldContent[prefix] === newContent[prefix]) prefix++;
    // The suffix may not reach back into the prefix of either string.
    let suffix = 0;
    while (
        suffix < maxShared - prefix
        && oldContent[oldContent.length - 1 - suffix] === newContent[newContent.length - 1 - suffix]
    ) suffix++;
    const changedEnd = oldContent.length - suffix; // end of the changed stretch, OLD offsets
    const delta = newContent.length - oldContent.length;

    const shifted: PronunciationOverride[] = [];
    for (const o of overrides) {
        let moved: PronunciationOverride | null = null;
        if (o.end <= prefix) moved = o;
        else if (o.start >= changedEnd) moved = { ...o, start: o.start + delta, end: o.end + delta };
        if (moved && newContent.slice(moved.start, moved.end) === moved.text) shifted.push(moved);
    }
    return shifted;
}
