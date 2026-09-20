import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudyChallengeService } from '../services/StudyChallengeService.js';
import {
    acceptDeadline,
    challengeWeekIndex,
    issueWindowClose,
    testWindowClose,
    testWindowOpen,
    weekOpen,
} from '../shared/challengeWeek.js';
import type { IStudyChallengeDAL } from '../dal/interfaces/IStudyChallengeDAL.js';
import type { IFriendshipDAL } from '../dal/interfaces/IFriendshipDAL.js';
import type { StudyChallengeRow } from '../types/studyChallenge.js';

/**
 * WHICH WEEK A NEW CHALLENGE LANDS IN, and the guard that keeps a pair to one
 * unfinished challenge (docs/STUDY_CHALLENGE.md § 2 "When a week opens").
 *
 * Three rules are pinned here, and all are invisible when they break:
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
 *   3. A challenge may only be issued on the challenger's own Monday (04:00 → Tue
 *      04:00), and only while the challengee is still before their Wednesday 04:00.
 *      Outside that, the challenge inherits the week's fixed accept deadline and is
 *      born expired — unacceptable, yet spending the pair's week and a cap slot.
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
        taunts: {},
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
function serviceFor(
    live: StudyChallengeRow[],
    tz: string | { challenger: string; challengee: string } = SHANGHAI,
    /** Rows the cap is counted from, by STORED status (`listCommittedForUser`). */
    committed: StudyChallengeRow[] = []
) {
    // One zone for both players unless a test needs the pair on different clocks.
    const tzOf = (id: string) =>
        typeof tz === 'string' ? tz : (id === ALICE ? tz.challenger : tz.challengee);
    const created: { weekIndex: number }[] = [];

    const challengeDAL = {
        listLiveForUser: async () => live,
        findForPairInWeek: async () => null,
        listCommittedForUser: async () => committed,
        findCandidates: async () => [],
        findDisplayFieldsByWords: async () => ({}),
        // The gates + insert now run inside one advisory-locked transaction; the
        // lock itself is a no-op against a stub client.
        lockUsersForChallenge: async () => undefined,
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
            timezone: tzOf(id),
            selectedLanguage: 'zh',
            isValidator: false,
        }),
    };

    const starterPacks = { estimateLevel: async () => 3 };
    // Runs the callback inline against a stub client — the week arithmetic under test
    // does not care that it is inside a transaction, only that one is available.
    const txRunner = {
        executeInTransaction: async (fn: (tx: { getClient: () => unknown }) => Promise<unknown>) =>
            fn({ getClient: () => ({}) }),
    };
    const unused = {} as never;
    const service = new StudyChallengeService(
        challengeDAL, friendshipDAL, userDAL as never, unused, unused, starterPacks as never, txRunner as never
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
        // hourly job runs late on PPE and not at all on dev, and a stored
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

describe('StudyChallengeService.issueChallenge — the Monday issue window', () => {
    afterEach(() => { vi.useRealTimers(); });

    it('refuses once the challenger\'s Monday has ended', async () => {
        const { service, created } = serviceFor([]);
        vi.useFakeTimers();
        vi.setSystemTime(issueWindowClose(32, SHANGHAI));

        await expect(service.issueChallenge(ALICE, BOB, 'same_word', 'zh'))
            .rejects.toThrow(/only be sent on Mondays/);
        expect(created).toHaveLength(0);
    });

    it('refuses mid-week, when the challenge would be born past its accept deadline', async () => {
        const { service, created } = serviceFor([]);
        vi.useFakeTimers();
        // Friday 04:00 — still week 32 for the challenger, which is exactly the case
        // that used to create a challenge nobody could accept.
        vi.setSystemTime(testWindowOpen(32, SHANGHAI));

        await expect(service.issueChallenge(ALICE, BOB, 'same_word', 'zh'))
            .rejects.toThrow(/only be sent on Mondays/);
        expect(created).toHaveLength(0);
    });

    it('refuses on the challenger\'s Monday if the challengee is already past their Tuesday', async () => {
        // Pago Pago (UTC−11) → Kiritimati (UTC+14), 25 hours apart. Kiritimati's
        // Wednesday 04:00 falls at 03:00 on Pago Pago's Tuesday, so for the last hour
        // of the challenger's Monday the challengee can no longer accept.
        const pair = { challenger: 'Pacific/Pago_Pago', challengee: 'Pacific/Kiritimati' };
        const { service, created } = serviceFor([], pair);
        const deadline = acceptDeadline(32, pair.challengee);
        const instant = new Date(deadline.getTime() + 30 * 60_000);
        expect(instant.getTime()).toBeLessThan(issueWindowClose(32, pair.challenger).getTime());
        vi.useFakeTimers();
        vi.setSystemTime(instant);

        await expect(service.issueChallenge(ALICE, BOB, 'same_word', 'zh'))
            .rejects.toThrow(/too late in the week/);
        expect(created).toHaveLength(0);
    });

    it('allows the same far-apart pair earlier on the challenger\'s Monday', async () => {
        const pair = { challenger: 'Pacific/Pago_Pago', challengee: 'Pacific/Kiritimati' };
        const { service, created } = serviceFor([], pair);
        vi.useFakeTimers();
        vi.setSystemTime(new Date(weekOpen(32, pair.challenger).getTime() + 60_000));

        await service.issueChallenge(ALICE, BOB, 'same_word', 'zh');

        expect(created[0].weekIndex).toBe(32);
    });
});

describe('StudyChallengeService — the cap counts only challenges that have not lapsed', () => {
    afterEach(() => { vi.useRealTimers(); });

    /** Six invitations Alice issued, all still stored as `pending`, in `weekIndex`. */
    const sixPending = (weekIndex: number) =>
        Array.from({ length: 6 }, (_, i) => liveRow({
            id: `44444444-4444-4444-8444-44444444444${i}`,
            challengerId: ALICE,
            challengeeId: BOB,
            status: 'pending',
            acceptedAt: null,
            weekIndex,
        }));

    it('does not let lapsed-but-unwritten invitations hold the cap', async () => {
        // Week 31's accept deadline passed days ago, but the hourly job has not
        // rewritten these rows (on dev it never will). They must not count.
        const { service, created } = serviceFor([], SHANGHAI, sixPending(31));
        vi.useFakeTimers();
        vi.setSystemTime(SHANGHAI_GAP);

        await service.issueChallenge(ALICE, BOB, 'same_word', 'zh');

        expect(created).toHaveLength(1);
    });

    it('does not let an accepted challenge whose windows have closed hold the cap', async () => {
        const accepted = sixPending(31).map((row) => ({ ...row, status: 'accepted' as const }));
        const { service, created } = serviceFor([], SHANGHAI, accepted);
        vi.useFakeTimers();
        vi.setSystemTime(SHANGHAI_GAP);

        await service.issueChallenge(ALICE, BOB, 'same_word', 'zh');

        expect(created).toHaveLength(1);
    });

    it('still refuses at the cap when the invitations can still be accepted', async () => {
        const { service, created } = serviceFor([], SHANGHAI, sixPending(32));
        vi.useFakeTimers();
        vi.setSystemTime(SHANGHAI_GAP);

        await expect(service.issueChallenge(ALICE, BOB, 'same_word', 'zh'))
            .rejects.toThrow(/already in 6 challenges/);
        expect(created).toHaveLength(0);
    });
});
