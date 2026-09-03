import { describe, expect, it, afterEach, vi } from 'vitest';
import { StudyChallengeService } from '../services/StudyChallengeService.js';
import { testWindowOpen } from '../shared/challengeWeek.js';
import type { IStudyChallengeDAL } from '../dal/interfaces/IStudyChallengeDAL.js';
import type { StudyChallengeRow } from '../types/studyChallenge.js';
import type { ChallengeRound } from '../contracts/wire.js';

/**
 * `getRoundContext` — the gate the whole test runs through
 * (docs/STUDY_CHALLENGE.md § 5.2).
 *
 * Every game's challenge board is served by naming a challenge on an ordinary pool
 * endpoint, so this one method decides WHICH round a player is on, WHICH game they
 * may play it as, and WHEN. Each rule here is one a client cannot be trusted with
 * and whose failure is silent rather than loud:
 *   • a caller-supplied round index would let a tampered client replay its best
 *     round, or skip to the last one;
 *   • a caller-supplied game would let a player play whichever of the three they
 *     are best at, three times;
 *   • no window check would let the board read leak the game sequence that the
 *     payload deliberately withholds until Friday (Q63).
 */

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const CHALLENGE_ID = '33333333-3333-4333-8333-333333333333';
const WEEK_INDEX = 33;
const TZ = 'America/New_York';

function round(gameId: string): ChallengeRound {
    return { gameId, mode: null, score: 100, breakdown: { lines: [], total: 100 }, completedAt: '2026-08-21T12:00:00.000Z' };
}

function row(overrides: Partial<StudyChallengeRow> = {}): StudyChallengeRow {
    return {
        id: CHALLENGE_ID,
        challengerId: ALICE,
        challengeeId: BOB,
        variant: 'same_word',
        challengerLanguage: 'zh',
        challengeeLanguage: 'zh',
        status: 'accepted',
        gameSequence: [
            { gameId: 'bubble-match', mode: null },
            { gameId: 'word-search', mode: 'pinyin' },
            { gameId: 'match-speed', mode: null },
        ],
        words: {
            [BOB]: [
                { position: 1, word1: '朋友', language: 'zh', vocabEntryId: null },
                { position: 2, word1: '学习', language: 'zh', vocabEntryId: null },
            ],
        },
        rounds: {},
        presetDeckIds: {},
        taunts: {},
        issuedAt: '2026-08-17T12:00:00.000Z',
        weekIndex: WEEK_INDEX,
        acceptedAt: '2026-08-18T12:00:00.000Z',
        completedAt: null,
        winnerUserId: null,
        ...overrides,
    };
}

/** Materialisation is exercised for real (idempotent-ensure), so its stub records calls. */
function serviceFor(challenge: StudyChallengeRow, isValidator = false) {
    const ensured: string[] = [];
    const challengeDAL = {
        findById: async () => challenge,
        findDisplayFieldsByWords: async () => ({}),
    } as unknown as IStudyChallengeDAL;
    const userDAL = {
        findById: async (id: string) => ({
            id, name: id, email: '', avatarIconId: null, timezone: TZ, selectedLanguage: 'zh', isValidator,
        }),
    };
    const starterPacks = {
        ensureLibraryEntry: async (_userId: string, entryKey: string) => {
            ensured.push(entryKey);
            // Positional ids, so a caller pairing words with ids can be checked.
            return ensured.length * 10;
        },
    };
    const txRunner = {
        executeInTransaction: async (fn: (tx: { getClient: () => unknown }) => Promise<unknown>) =>
            fn({ getClient: () => ({}) }),
    };
    const unused = {} as never;
    const service = new StudyChallengeService(
        challengeDAL, unused, userDAL as never, unused, unused, starterPacks as never, txRunner as never
    );
    return { service, ensured };
}

/** An instant inside the player's Friday→Monday test window. */
function duringWindow(): Date {
    return new Date(testWindowOpen(WEEK_INDEX, TZ).getTime() + 60 * 60 * 1000);
}

describe('StudyChallengeService.getRoundContext', () => {
    afterEach(() => { vi.useRealTimers(); });

    function at(instant: Date) {
        vi.useFakeTimers();
        vi.setSystemTime(instant);
    }

    it('derives round 1 and re-materialises the contested words', async () => {
        const { service, ensured } = serviceFor(row());
        at(duringWindow());

        const context = await service.getRoundContext(BOB, CHALLENGE_ID, { gameId: 'bubble-match', mode: null });

        expect(context.roundIndex).toBe(1);
        expect(context.game).toEqual({ gameId: 'bubble-match', mode: null });
        expect(context.words).toEqual(['朋友', '学习']);
        // Re-materialised on every board read, because `vocabEntryId` is a
        // convenience pointer that may dangle (Q54) — a player who deleted a
        // contested card during the week must still play it.
        expect(ensured).toEqual(['朋友', '学习']);
        expect(context.vocabEntryIds).toHaveLength(2);
    });

    it('derives the NEXT round from what has been submitted, ignoring the caller', async () => {
        const { service } = serviceFor(row({ rounds: { [BOB]: { '1': round('bubble-match') } } }));
        at(duringWindow());

        const context = await service.getRoundContext(BOB, CHALLENGE_ID, { gameId: 'word-search', mode: 'pinyin' });

        expect(context.roundIndex).toBe(2);
    });

    it('refuses a game that is not the round the sequence drew', async () => {
        const { service } = serviceFor(row());
        at(duringWindow());

        // Round 1 is Bubble Match; asking for round 3's game must fail rather than
        // quietly serving a board.
        await expect(
            service.getRoundContext(BOB, CHALLENGE_ID, { gameId: 'match-speed', mode: null })
        ).rejects.toThrow(/not that game/);
    });

    it('refuses the ELIGIBLE game in the wrong MODE', async () => {
        const { service } = serviceFor(row({ rounds: { [BOB]: { '1': round('bubble-match') } } }));
        at(duringWindow());

        // Word Search is challenge-eligible as Pinyin only; No-Pinyin is a reading
        // drill and can never be a round.
        await expect(
            service.getRoundContext(BOB, CHALLENGE_ID, { gameId: 'word-search', mode: 'no-pinyin' })
        ).rejects.toThrow(/not that game/);
    });

    it('refuses outside the test window', async () => {
        const { service } = serviceFor(row());
        // One hour BEFORE Friday 04:00 — the study days, when the game sequence is
        // still withheld from the payload entirely.
        at(new Date(testWindowOpen(WEEK_INDEX, TZ).getTime() - 60 * 60 * 1000));

        await expect(service.getRoundContext(BOB, CHALLENGE_ID, null)).rejects.toThrow(/window is not open/);
    });

    it('refuses a challenge that is not accepted', async () => {
        const { service } = serviceFor(row({ status: 'pending' }));
        at(duringWindow());
        await expect(service.getRoundContext(BOB, CHALLENGE_ID, null)).rejects.toThrow(/not in its test window/);
    });

    it('refuses once every round has been played', async () => {
        const { service } = serviceFor(row({
            rounds: { [BOB]: { '1': round('bubble-match'), '2': round('word-search'), '3': round('match-speed') } },
        }));
        at(duringWindow());
        await expect(service.getRoundContext(BOB, CHALLENGE_ID, null)).rejects.toThrow(/already played/);
    });

    // ── The tester escape hatch (docs/STUDY_CHALLENGE.md § 2a) ──
    // Study Challenge is a weekly feature, so without this the round runner can only
    // be exercised on a Friday. The hatch must lift the WINDOW and nothing else, and
    // must be spendable only by a validator.

    it('lets a VALIDATOR play outside the test window when they ask for anytime', async () => {
        const { service } = serviceFor(row(), true);
        at(new Date(testWindowOpen(WEEK_INDEX, TZ).getTime() - 3 * 24 * 60 * 60 * 1000)); // Tuesday

        const context = await service.getRoundContext(BOB, CHALLENGE_ID, null, true);

        expect(context.roundIndex).toBe(1);
    });

    it('IGNORES anytime from a non-validator, silently', async () => {
        // Silently: a 403 here would be a probe for who holds the flag, and the caller
        // gets the ordinary weekly rules either way.
        const { service } = serviceFor(row(), false);
        at(new Date(testWindowOpen(WEEK_INDEX, TZ).getTime() - 3 * 24 * 60 * 60 * 1000));

        await expect(
            service.getRoundContext(BOB, CHALLENGE_ID, null, true)
        ).rejects.toThrow(/window is not open/);
    });

    it('still refuses the wrong game with anytime on', async () => {
        // The hatch lifts CALENDAR gates only. Which round, and which game, are facts
        // about the shape of the test — a tester plays the same three rounds in the
        // same order as everybody else, or they are not testing the same feature.
        const { service } = serviceFor(row(), true);
        at(duringWindow());

        await expect(
            service.getRoundContext(BOB, CHALLENGE_ID, { gameId: 'match-speed', mode: null }, true)
        ).rejects.toThrow(/not that game/);
    });

    it('still refuses a replayed round with anytime on', async () => {
        const { service } = serviceFor(row({
            rounds: { [BOB]: { '1': round('bubble-match'), '2': round('word-search'), '3': round('match-speed') } },
        }), true);
        at(duringWindow());

        await expect(service.getRoundContext(BOB, CHALLENGE_ID, null, true)).rejects.toThrow(/already played/);
    });

    it('refuses a stranger', async () => {
        const { service } = serviceFor(row());
        at(duringWindow());
        await expect(
            service.getRoundContext('44444444-4444-4444-8444-444444444444', CHALLENGE_ID, null)
        ).rejects.toThrow(/not found/i);
    });
});

/**
 * The CLAIM model (docs/STUDY_CHALLENGE.md § 5.1a).
 *
 * A round is written at the player's FIRST MARK, not when the run ends, so that
 * quitting cannot be a free re-roll. These tests pin the three consequences that are
 * easy to regress and silent when they break: a claimed round's board is never
 * re-issued, a claimed round does not finish the test, and the opponent cannot see
 * a score that is still moving.
 */
describe('StudyChallengeService — claimed (in-progress) rounds', () => {
    afterEach(() => { vi.useRealTimers(); });

    /** A round claimed at its first mark: spent, scored so far, not yet final. */
    function claimed(gameId: string, score = 20): ChallengeRound {
        return {
            gameId,
            mode: null,
            score,
            breakdown: { lines: [], total: score },
            startedAt: '2026-08-21T12:00:00.000Z',
            completedAt: null,
        };
    }

    /** `serviceFor`, plus the writes `submitRound` needs. Records what was stored. */
    function writableServiceFor(challenge: StudyChallengeRow) {
        const written: { roundIndex: number; round: ChallengeRound }[] = [];
        const challengeDAL = {
            findById: async () => challenge,
            findDisplayFieldsByWords: async () => ({}),
            recordRound: async (_id: string, _userId: string, roundIndex: number, round: ChallengeRound) => {
                written.push({ roundIndex, round });
                return true;
            },
        } as unknown as IStudyChallengeDAL;
        const userDAL = {
            findById: async (id: string) => ({
                id, name: id, email: '', avatarIconId: null, timezone: TZ, selectedLanguage: 'zh', isValidator: false,
            }),
        };
        const unused = {} as never;
        const service = new StudyChallengeService(
            challengeDAL, unused, userDAL as never, unused, unused, unused, unused
        );
        return { service, written };
    }

    it('never re-issues the board of a CLAIMED round — quitting is not a re-roll', async () => {
        // Round 1 was claimed and abandoned. The attempt is spent: the next board the
        // player may be served is round 2's, not another copy of round 1's.
        const { service } = serviceFor(row({ rounds: { [BOB]: { '1': claimed('bubble-match') } } }));
        vi.useFakeTimers();
        vi.setSystemTime(duringWindow());

        await expect(
            service.getRoundContext(BOB, CHALLENGE_ID, { gameId: 'bubble-match', mode: null })
        ).rejects.toThrow(/not that game/);

        const context = await service.getRoundContext(BOB, CHALLENGE_ID, { gameId: 'word-search', mode: 'pinyin' });
        expect(context.roundIndex).toBe(2);
    });

    it('writes a claim with a null completedAt when final is false', async () => {
        const { service, written } = writableServiceFor(row());
        vi.useFakeTimers();
        vi.setSystemTime(duringWindow());

        await service.submitRound(BOB, CHALLENGE_ID, 1, 20, { lines: [], total: 20 }, false);

        expect(written).toHaveLength(1);
        expect(written[0].round.completedAt).toBeNull();
        expect(written[0].round.startedAt).toEqual(expect.any(String));
        expect(written[0].round.score).toBe(20);
    });

    it('lets round n+1 start after round n was CLAIMED and abandoned', async () => {
        // The sequential guard tests PRESENCE, not completion. A round whose app was
        // killed mid-run stays claimed forever — its board can never be re-issued, so
        // nothing can finalise it — and requiring completion would lock the player out
        // of the rest of their test because of a crash.
        const { service, written } = writableServiceFor(row({
            rounds: { [BOB]: { '1': claimed('bubble-match') } },
        }));
        vi.useFakeTimers();
        vi.setSystemTime(duringWindow());

        await service.submitRound(BOB, CHALLENGE_ID, 2, 5, { lines: [], total: 5 }, false);

        expect(written[0].roundIndex).toBe(2);
    });

    it('still refuses a round whose predecessor was never started', async () => {
        const { service } = writableServiceFor(row());
        vi.useFakeTimers();
        vi.setSystemTime(duringWindow());

        await expect(
            service.submitRound(BOB, CHALLENGE_ID, 3, 5, { lines: [], total: 5 }, false)
        ).rejects.toThrow(/has not been submitted yet/);
    });

    it('hides a round that is still in progress from the OPPONENT', async () => {
        // Rounds are revealed as they COMPLETE (§ 6). A claim is not a completion, or
        // the opponent would watch a live score climb mark by mark.
        const { service } = writableServiceFor(row({
            rounds: {
                [ALICE]: { '1': round('bubble-match'), '2': claimed('word-search') },
                [BOB]: {},
            },
        }));
        vi.useFakeTimers();
        vi.setSystemTime(duringWindow());

        const summary = await service.getChallenge(BOB, CHALLENGE_ID);

        expect(Object.keys(summary.opponentRounds)).toEqual(['1']);
        expect(summary.opponentFinished).toBe(false);
    });
});
