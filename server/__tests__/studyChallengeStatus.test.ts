import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudyChallengeService } from '../services/StudyChallengeService.js';
import { acceptDeadline } from '../shared/challengeWeek.js';
import type { IStudyChallengeDAL } from '../dal/interfaces/IStudyChallengeDAL.js';
import type { StudyChallengeRow } from '../types/studyChallenge.js';

/**
 * The LAPSED-ACCEPT derivation on the read path
 * (docs/STUDY_CHALLENGE.md § "The read path never waits for the job").
 *
 * A `pending` row is only rewritten to `expired` by pass 1 of the hourly
 * maintenance job, and that job is not installed on dev at all. Serializing the
 * stored status verbatim therefore left the challengee's row offering a green
 * "Review words" control after their Wednesday 04:00 — a control whose only
 * possible outcome is `acceptChallenge` throwing. The rule under test is that
 * `toSummary` derives the state from the deadline instead, so the surfaces agree
 * with `countBadge` (which always applied it) with or without the cron.
 *
 * Only `findById` and the user lookup are exercised, so every other collaborator is
 * an unused stub.
 */

const ALICE = '11111111-1111-4111-8111-111111111111'; // challenger
const BOB = '22222222-2222-4222-8222-222222222222';   // challengee
const CHALLENGE_ID = '33333333-3333-4333-8333-333333333333';

const WEEK_INDEX = 33;
const CHALLENGEE_TZ = 'America/New_York';

function row(overrides: Partial<StudyChallengeRow> = {}): StudyChallengeRow {
    return {
        id: CHALLENGE_ID,
        challengerId: ALICE,
        challengeeId: BOB,
        variant: 'same_word',
        challengerLanguage: 'zh',
        challengeeLanguage: 'zh',
        status: 'pending',
        gameSequence: [],
        words: {},
        rounds: {},
        presetDeckIds: {},
        taunts: {},
        issuedAt: '2026-08-17T12:00:00.000Z',
        weekIndex: WEEK_INDEX,
        acceptedAt: null,
        completedAt: null,
        winnerUserId: null,
        ...overrides,
    };
}

/** A service wired to just enough stubs for `getChallenge`. */
function serviceFor(challenge: StudyChallengeRow, isValidator = false) {
    const challengeDAL = {
        findById: async () => challenge,
        // Only reached for a challenge that has words; this one has none.
        findDisplayFieldsByWords: async () => ({}),
    } as unknown as IStudyChallengeDAL;

    const userDAL = {
        findById: async (id: string) => ({
            id,
            name: id === ALICE ? 'Alice' : 'Bob',
            email: `${id}@example.com`,
            avatarIconId: null,
            // Both players in the challengee's zone keeps the fixture's arithmetic to
            // one boundary; whose zone the deadline uses is pinned by challengeWeek's
            // own tests.
            timezone: CHALLENGEE_TZ,
            selectedLanguage: 'zh',
            isValidator,
        }),
    };

    const unused = {} as never;
    return new StudyChallengeService(
        challengeDAL, unused, userDAL as never, unused, unused, unused, unused
    );
}

/** N milliseconds either side of the challengee's Wednesday 04:00. */
function aroundDeadline(offsetMs: number): Date {
    return new Date(acceptDeadline(WEEK_INDEX, CHALLENGEE_TZ).getTime() + offsetMs);
}

describe('StudyChallengeService.toSummary — lapsed accept window', () => {
    // Every case drives `now` through the fake clock; a leaked fake clock would make
    // whichever test file runs next depend on this one.
    afterEach(() => { vi.useRealTimers(); });

    it('serializes a pending challenge as pending while the window is open', async () => {
        const service = serviceFor(row());
        // One minute before the deadline: still a live invitation for both sides.
        vi.useFakeTimers();
        vi.setSystemTime(aroundDeadline(-60_000));
        expect((await service.getChallenge(BOB, CHALLENGE_ID)).status).toBe('pending');
        expect((await service.getChallenge(ALICE, CHALLENGE_ID)).status).toBe('pending');
    });

    it('serializes a pending challenge as expired once the deadline has passed', async () => {
        const service = serviceFor(row());
        // One minute after, with the stored status still 'pending' because no cron
        // has run — the exact state dev is permanently in.
        vi.useFakeTimers();
        vi.setSystemTime(aroundDeadline(60_000));
        expect((await service.getChallenge(BOB, CHALLENGE_ID)).status).toBe('expired');
        // Both sides, not just the challengee: the challenger has nothing left to
        // wait for either.
        expect((await service.getChallenge(ALICE, CHALLENGE_ID)).status).toBe('expired');
    });

    it('does not expire a pending challenge for a validator who asked for anytime', async () => {
        // The tester escape hatch lifts the accept deadline along with every other
        // calendar gate (docs/STUDY_CHALLENGE.md § 2a) — otherwise a tester's own
        // invitation lapses out from under them mid-session and the only repair is to
        // wait for Monday.
        const service = serviceFor(row(), true);
        vi.useFakeTimers();
        vi.setSystemTime(aroundDeadline(60_000));
        expect((await service.getChallenge(BOB, CHALLENGE_ID, true)).status).toBe('pending');
    });

    it('still expires it for a non-validator who asked for anytime', async () => {
        const service = serviceFor(row(), false);
        vi.useFakeTimers();
        vi.setSystemTime(aroundDeadline(60_000));
        expect((await service.getChallenge(BOB, CHALLENGE_ID, true)).status).toBe('expired');
    });

    it('leaves every other status alone after the accept deadline', async () => {
        // An accepted challenge is PAST the accept deadline for its whole test week,
        // so a derivation that keyed on the deadline alone would expire every live
        // challenge on Wednesday morning.
        const service = serviceFor(row({ status: 'accepted', acceptedAt: '2026-08-18T12:00:00.000Z' }));
        vi.useFakeTimers();
        vi.setSystemTime(aroundDeadline(60_000));
        expect((await service.getChallenge(BOB, CHALLENGE_ID)).status).toBe('accepted');
    });
});
