import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_HISTORY, addToHistory, clearHistory, readHistory, removeFromHistory } from '../dictionarySearchHistory';

// The test environment is node (no DOM), so give the module an in-memory localStorage.
function memoryStorage() {
    const store = new Map<string, string>();
    return {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
        clear: () => store.clear(),
    };
}

describe('dictionarySearchHistory', () => {
    beforeEach(() => {
        vi.stubGlobal('localStorage', memoryStorage());
    });

    it('keeps newest first and moves a repeated query to the top (case-insensitive)', () => {
        addToHistory(1, 'zh', 'hello');
        addToHistory(1, 'zh', '你好');
        addToHistory(1, 'zh', '  Hello ');
        expect(readHistory(1, 'zh').map((e) => e.query)).toEqual(['Hello', '你好']);
    });

    it('ignores blank queries', () => {
        addToHistory(1, 'zh', '   ');
        expect(readHistory(1, 'zh')).toEqual([]);
    });

    it('caps the list at MAX_HISTORY', () => {
        for (let i = 0; i < MAX_HISTORY + 5; i++) addToHistory(1, 'zh', `q${i}`);
        const list = readHistory(1, 'zh');
        expect(list).toHaveLength(MAX_HISTORY);
        expect(list[0].query).toBe(`q${MAX_HISTORY + 4}`);
    });

    it('scopes by user and language', () => {
        addToHistory(1, 'zh', 'a');
        addToHistory(2, 'zh', 'b');
        addToHistory(1, 'es', 'c');
        expect(readHistory(1, 'zh').map((e) => e.query)).toEqual(['a']);
        expect(readHistory(2, 'zh').map((e) => e.query)).toEqual(['b']);
        expect(readHistory(1, 'es').map((e) => e.query)).toEqual(['c']);
    });

    it('removes one query and clears all', () => {
        addToHistory(1, 'zh', 'a');
        addToHistory(1, 'zh', 'b');
        removeFromHistory(1, 'zh', 'A');
        expect(readHistory(1, 'zh').map((e) => e.query)).toEqual(['b']);
        clearHistory(1, 'zh');
        expect(readHistory(1, 'zh')).toEqual([]);
    });

    it('treats corrupt storage as empty', () => {
        localStorage.setItem('dictionary.searchHistory.1.zh', '{not json');
        expect(readHistory(1, 'zh')).toEqual([]);
        localStorage.setItem('dictionary.searchHistory.1.zh', JSON.stringify([{ query: 'ok', searchedAt: 1 }, { nope: true }]));
        expect(readHistory(1, 'zh').map((e) => e.query)).toEqual(['ok']);
    });
});
