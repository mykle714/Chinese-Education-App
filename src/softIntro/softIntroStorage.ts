/**
 * Soft-introduction persistence + the pure graduation logic. docs/SOFT_INTRODUCTION.md § 3.
 *
 * Stored in localStorage, never on the server, by design: an si's two styles are minor
 * enough that it does not matter which one a learner sees, so clearing site data or
 * switching device simply replays the intro. Every access is wrapped — storage can be
 * blocked or throw (private windows, cleared data) — and a failure reads as "nothing
 * recorded yet", i.e. the intro style.
 *
 * The record functions (`recordVisit`, `hasMetThresholds`) are pure so they can be
 * unit-tested without a DOM (src/__tests__/softIntro.test.ts).
 */
import { SOFT_INTROS, VISIT_DEDUPE_MS, type SoftIntroId, type SoftIntroSpec, type SoftIntroState } from "./softIntroRegistry";

/** One si's progress on this device. All times are epoch ms. */
export interface SoftIntroRecord {
    firstVisitAt: number;
    lastVisitAt: number;
    visits: number;
    /**
     * Stamped the first time the thresholds are found met. STICKY: once set, the si stays
     * graduated even if its thresholds are later raised in the registry — un-graduating a
     * learner who already understood the feature would be the wrong surprise.
     */
    graduatedAt?: number;
}

const RECORDS_KEY = "softIntro.v1";
const OVERRIDE_KEY = "softIntro.override";
const DAY_MS = 24 * 60 * 60 * 1000;

// ── Pure logic ───────────────────────────────────────────────────────────────

/** The record after one more encounter at `now` — unchanged if within the dedupe window. */
export function recordVisit(record: SoftIntroRecord | undefined, now: number): SoftIntroRecord {
    if (!record) return { firstVisitAt: now, lastVisitAt: now, visits: 1 };
    if (now - record.lastVisitAt < VISIT_DEDUPE_MS) return record;
    return { ...record, lastVisitAt: now, visits: record.visits + 1 };
}

/** Whether a record has met BOTH of its si's thresholds (or already graduated). */
export function hasMetThresholds(record: SoftIntroRecord | undefined, spec: SoftIntroSpec, now: number): boolean {
    if (!record) return false;
    if (record.graduatedAt !== undefined) return true;
    return record.visits >= spec.minVisits && now - record.firstVisitAt >= spec.minDays * DAY_MS;
}

// ── Records ──────────────────────────────────────────────────────────────────

type RecordMap = Partial<Record<SoftIntroId, SoftIntroRecord>>;

function readRecords(): RecordMap {
    try {
        const raw = localStorage.getItem(RECORDS_KEY);
        if (!raw) return {};
        const parsed: unknown = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? (parsed as RecordMap) : {};
    } catch {
        return {};
    }
}

function writeRecord(id: SoftIntroId, record: SoftIntroRecord): void {
    try {
        // Re-read rather than reuse a caller's copy, so two si mounting together cannot
        // overwrite each other's freshly written record.
        const records = readRecords();
        records[id] = record;
        localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
    } catch {
        // Storage unavailable — the si just stays in its intro style.
    }
}

/**
 * The si's NATURAL state for a mount starting now (ignoring any validator override).
 * Graduates — and stamps `graduatedAt` — if the thresholds were met by EARLIER visits;
 * that is safe because nothing has been drawn yet for this mount. The visit this mount
 * represents is recorded separately, by `recordSoftIntroVisit`, after the first paint.
 */
export function resolveSoftIntroState(id: SoftIntroId, now: number = Date.now()): SoftIntroState {
    const record = readRecords()[id];
    if (!hasMetThresholds(record, SOFT_INTROS[id], now)) return "intro";
    if (record && record.graduatedAt === undefined) writeRecord(id, { ...record, graduatedAt: now });
    return "graduated";
}

/** Count one encounter with the si (deduped — see `VISIT_DEDUPE_MS`). */
export function recordSoftIntroVisit(id: SoftIntroId, now: number = Date.now()): void {
    const record = readRecords()[id];
    const next = recordVisit(record, now);
    if (next !== record) writeRecord(id, next);
}

// ── Validator override ───────────────────────────────────────────────────────

/**
 * The validator viewing override, app-wide (every si at once). `auto` = each si shows
 * the learner's real state. It is honoured only for `users.isValidator` accounts (the
 * hook checks), so a stale key on a shared device cannot change a learner's experience.
 * Forcing a state NEVER touches the records above.
 */
export type SoftIntroOverride = "auto" | SoftIntroState;

/** Fired on this tab when the override changes; `storage` covers other tabs. */
const OVERRIDE_EVENT = "softintro-override";

export function readSoftIntroOverride(): SoftIntroOverride {
    try {
        const value = localStorage.getItem(OVERRIDE_KEY);
        return value === "intro" || value === "graduated" ? value : "auto";
    } catch {
        return "auto";
    }
}

export function writeSoftIntroOverride(value: SoftIntroOverride): void {
    try {
        if (value === "auto") localStorage.removeItem(OVERRIDE_KEY);
        else localStorage.setItem(OVERRIDE_KEY, value);
    } catch {
        // Storage unavailable — the override just won't persist past this event.
    }
    window.dispatchEvent(new Event(OVERRIDE_EVENT));
}

/** `useSyncExternalStore` subscriber for the override. */
export function subscribeSoftIntroOverride(onChange: () => void): () => void {
    const onStorage = (event: StorageEvent) => {
        if (event.key === OVERRIDE_KEY) onChange();
    };
    window.addEventListener(OVERRIDE_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
        window.removeEventListener(OVERRIDE_EVENT, onChange);
        window.removeEventListener("storage", onStorage);
    };
}
