import { useSyncExternalStore } from 'react';

/**
 * useHintPawnSetting — the per-device "Study helper" switch in Settings → Display, which
 * turns the flp's hint pawn on or off (docs/HINT_PAWN.md § "The setting").
 *
 * Layer: shared hook (`src/hooks/`) — written by pages/settings/SettingsBody.tsx, read by
 * features/flashcards/FlashcardsLearnPage/FlashcardsLearnPage.tsx, so it cannot live
 * under either.
 *
 * Storage: per DEVICE in localStorage (owner's choice 2026-11-08), like "Weather effects"
 * and "Color pinyin by tone" — no account column. One app-wide value behind
 * useSyncExternalStore, so a flip in Settings reaches a mounted (parked) flp session
 * without a reload. DEFAULT ON: the key is written only when the learner switches it off.
 *
 * Depended on by: pages/settings/SettingsBody.tsx, FlashcardsLearnPage.tsx.
 */

const STORAGE_KEY = 'flp.hintPawn.off';

function readEnabled(): boolean {
    try {
        return localStorage.getItem(STORAGE_KEY) !== '1';
    } catch {
        return true;
    }
}

let enabled = readEnabled();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

const getSnapshot = () => enabled;

/** Switch the hint pawn on or off on this device. */
export function setHintPawnEnabled(on: boolean): void {
    try {
        if (on) localStorage.removeItem(STORAGE_KEY);
        else localStorage.setItem(STORAGE_KEY, '1');
    } catch {
        // Storage unavailable — the switch just won't persist past this session.
    }
    enabled = on;
    listeners.forEach((listener) => listener());
}

/** Whether this device shows the hint pawn during the flp. */
export function useHintPawnEnabled(): boolean {
    return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
