import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudyChallengeService } from '../services/StudyChallengeService.js';
import { challengeWeekIndex, testWindowClose, weekOpen } from '../shared/challengeWeek.js';
import type { IStudyChallengeDAL } from '../dal/interfaces/IStudyChallengeDAL.js';
import type { IFriendshipDAL } from '../dal/interfaces/IFriendshipDAL.js';
import type { StudyChallengeRow } from '../types/studyChallenge.js';

/**
 * WHICH WEEK A NEW CHALLENGE LANDS IN, and the guard that keeps a pair to one
 * unfinished challenge (docs/STUDY_CHALLENGE.md § 2 "When a week opens").
 *
 * Two rules are pinned here, and both are invisible when they break:
 *
 *   1. A challenge is stamped with the CHALLENGER'S OWN week — the one whose local
 *      Monday 04:00 has passed for them. Stamping it from the UTC counter instead
 *      made an east-of-UTC challenger issue into the OUTGOING week, whose accept
 *      deadline was five days in the past: a challenge born expired, which nobody
 *      can accept and which occupies the pair's previous week.
 *   2. Because the two players' weeks now roll at different instants, a pair spends
 *      a few hours disagreeing about which week it is — and two different week
 *      indices never collide on `study_challenges_pair_week_uniq`. The live-pair
 *      guard is what stops that window from producing two live challenges, two
 *      decks and two cap slots (the defect migration 150 fixed).
 */

const ALICE = '11111111-1111-4111-8111-111111111111'; // the challenger throughout
const BOB = '22222222-2222-4222-8222-222222222222';

/** Mon 05:00 in Shanghai — inside the 4h gap before the UTC counter rolls. */
const SHANGHAI_GAP = new Date('2026-08-16T21:00:00Z');
const SHANGHAI = 'Asia/Shanghai';

function liveRow(overrides: Partial<StudyChallengeRow> = {}): StudyChallengeRow {
    return {
        id: '33333333-3333-4333-8333-333333333333',
        challengerId: BOB,        // the opponent issued it, which is the crossing case
        challengeeId: ALICE,
        variant: 'same_word',
        challengerLanguage: 'zh',
        challengeeLanguage: 'zh',
        status: 'accepted',
        gameSequence: [],
        words: {},
        rounds: {},
        presetDeckIds: {},
        issuedAt: '2026-08-10T12:00:00.000Z',
        weekIndex: 31,
        acceptedAt: '2026-08-10T12:00:00.000Z',
        completedAt: null,
        winnerUserId: null,
        ...overrides,
    };
}

/**
 * A service wired for `issueChallenge` only. The word set is deliberately empty —
 * `findCandidates` returning nothing is the legitimate "supply exhausted" path
 * (§ 3.1), and it keeps the fixture to the week arithmetic under test.
 */
function serviceFor(live: StudyChallengeRow[], tz = SHANGHAI) {
    const created: { weekIndex: number }[] = [];

    const challengeDAL = {
        listLiveForUser: async () => live,
        findForPairInWeek: async () => null,
        countActiveForUser: async () => 0,
        findCandidates: async () => [],
        findDisplayFieldsByWords: async () => ({}),
        createChallenge: async (input: { weekIndex: number }) => {
            created.push(input);
            return liveRow({ ...input, challengerId: ALICE, challengeeId: BOB, status: 'pending' });
        },
    } as unknown as IStudyChallengeDAL;

    const friendshipDAL = {
        findBetween: async () => ({
            requesterId: ALICE,
            addresseeId: BOB,
            status: 'accepted',
            requesterChallengesBlocked: false,
            addresseeChallengesBlocked: false,
        }),
    } as unknown as IFriendshipDAL;

    const userDAL = {
        findById: async (id: string) => ({
            id,
            name: id === ALICE ? 'Alice' : 'Bob',
            email: `${id}@example.com`,
            avatarIconId: null,
            timezone: tz,
            selectedLanguage: 'zh',
            isValidator: false,
        }),
    };

    const starterPacks = { estimateLevel: async () => 3 };
    const unused = {} as never;
    const service = new StudyChallengeService(
        challengeDAL, friendshipDAL, userDAL as never, unused, unused, starterPacks as never, unused
    );
    return { service, created };
}

describe('StudyChallengeService.issueChallenge — which week', () => {
    afterEach(() => { vi.useRealTimers(); });

    it('stamps the challenger\'s own week, not the UTC counter\'s', async () => {
        // The counter still says 31 at this instant; Shanghai's Monday 04:00 passed
        // an hour ago, so the challenger is in 32 and their challenge must be too.
        expect(challengeWeekIndex(SHANGHAI_GAP)).toBe(31);

        const { service, created } = serviceFor([]);
        vi.useFakeTimers();
        vi.setSystemTime(SHANGHAI_GAP);

        await service.issueChallenge(ALICE, BOB, 'same_word', 'zh');

        expect(created).toHaveLength(1);
        expect(created[0].weekIndex).toBe(32);
    });

    it('refuses while the pair still has an unfinished challenge from another week', async () => {
        // The crossing case: Bob's week rolled before Alice's, so his challenge is
        // named 31 while she is issuing into 32. Two indices, no unique-index
        // collision — this guard is the only thing standing between the pair and two
        // live challenges.
        const { service } = serviceFor([liveRow({ weekIndex: 32 })]);
        vi.useFakeTimers();
        vi.setSystemTime(SHANGHAI_GAP);

        await expect(service.issueChallenge(ALICE, BOB, 'same_word', 'zh'))
            .rejects.toThrow(/already have a challenge running/);
    });

    it('does not block on a finished week whose row the cron has not rewritten', async () => {
        // "Unfinished" is DERIVED from the test window, never from `status` — the
        // hourly job runs late on prod and not at all on dev, and a stored
        // 'accepted' from last week must not hold Monday's challenge hostage.
        const stale = liveRow({ weekIndex: 31, status: 'accepted' });
        const { service, created } = serviceFor([stale]);
        vi.useFakeTimers();
        // One minute after week 31's window closes — which IS week 32's opening.
        vi.setSystemTime(new Date(testWindowClose(31, SHANGHAI).getTime() + 60_000));
        expect(weekOpen(32, SHANGHAI).getTime()).toBe(testWindowClose(31, SHANGHAI).getTime());

        await service.issueChallenge(ALICE, BOB, 'same_word', 'zh');

        expect(created[0].weekIndex).toBe(32);
    });
});
