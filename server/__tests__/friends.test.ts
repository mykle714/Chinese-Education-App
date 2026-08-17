import { describe, expect, it, beforeEach } from 'vitest';
import { FriendsService } from '../services/FriendsService.js';
import { ValidationError, NotFoundError, DuplicateError } from '../types/dal.js';
import type { IFriendshipDAL } from '../dal/interfaces/IFriendshipDAL.js';
import type { Friendship } from '../types/friends.js';

/**
 * Tests for FriendsService — the friend-graph policy layer (docs/FRIENDS_FEATURE.md).
 *
 * Everything worth testing here is an AUTHORIZATION or IDENTITY rule, and each one
 * has a failure mode that is silent rather than loud:
 *   • accepting a request addressed to someone else would fabricate a friendship;
 *   • declining an already-accepted row would be an unfriend disguised as a decline;
 *   • the crossing-requests case would otherwise hit the pair unique index and
 *     surface as a 409 the user has no way to act on.
 * The DALs are hand-stubbed (no DB) because the rules live entirely in the service.
 */

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';

/** Minimal user row shape the service reads off IUserDAL.findById. */
function userRow(id: string, name: string) {
    return { id, name, email: `${name.toLowerCase()}@example.com`, avatarIconId: null };
}

function pendingRow(overrides: Partial<Friendship> = {}): Friendship {
    return {
        id: REQUEST_ID,
        requesterId: ALICE,
        addresseeId: BOB,
        status: 'pending',
        createdAt: '2026-08-01T00:00:00.000Z',
        respondedAt: null,
        ...overrides,
    };
}

/** A stub graph DAL whose behaviour each test tweaks; records the calls it received. */
function makeFriendshipDAL(overrides: Partial<IFriendshipDAL> = {}) {
    const calls: string[] = [];
    const dal: IFriendshipDAL = {
        findById: async () => null,
        findBetween: async () => null,
        createRequest: async (requesterId, addresseeId) =>
            pendingRow({ requesterId, addresseeId }),
        acceptRequest: async (id) =>
            pendingRow({ id, status: 'accepted', respondedAt: '2026-08-02T00:00:00.000Z' }),
        deleteById: async () => true,
        deleteBetween: async () => true,
        // The Study Challenge opt-out (migration 148). Nothing in FriendsService
        // calls it — the flags are written from StudyChallengeService — but the stub
        // must satisfy the interface.
        setChallengesBlocked: async () => true,
        listFriends: async () => [],
        listPendingRequests: async () => [],
        ...overrides,
    };
    // Wrap every method so tests can assert which writes happened.
    return {
        calls,
        dal: new Proxy(dal, {
            get(target, prop: string) {
                const value = (target as any)[prop];
                if (typeof value !== 'function') return value;
                return (...args: any[]) => {
                    calls.push(prop);
                    return value(...args);
                };
            },
        }) as IFriendshipDAL,
    };
}

function makeUserDAL(users: Record<string, ReturnType<typeof userRow>> = {}) {
    return { findById: async (id: string) => users[id] ?? null } as any;
}

/**
 * Build the service with stubbed leaderboard DALs.
 *
 * The two score DALs (promotions, per-language wallets) are read-only and only the
 * leaderboard touches them, so every graph-policy test below gets an empty pair and
 * the leaderboard tests pass their own.
 */
function makeService(
    friendshipDAL: IFriendshipDAL,
    userDAL: any,
    categoryPromotionDAL: any = { getVelocityBuckets: async () => [] },
    userLanguagesDAL: any = { getNetPointsForUsers: async () => new Map() }
) {
    return new FriendsService(friendshipDAL, userDAL, categoryPromotionDAL, userLanguagesDAL);
}

describe('FriendsService.sendRequest', () => {
    let userDAL: any;
    beforeEach(() => {
        userDAL = makeUserDAL({ [ALICE]: userRow(ALICE, 'Alice'), [BOB]: userRow(BOB, 'Bob') });
    });

    it('rejects anything that is not a user ID before touching the database', async () => {
        const { dal, calls } = makeFriendshipDAL();
        const service = makeService(dal, userDAL);
        await expect(service.sendRequest(ALICE, 'bob@example.com')).rejects.toBeInstanceOf(ValidationError);
        await expect(service.sendRequest(ALICE, undefined)).rejects.toBeInstanceOf(ValidationError);
        expect(calls).toEqual([]);
    });

    it('rejects friending yourself', async () => {
        const { dal } = makeFriendshipDAL();
        const service = makeService(dal, userDAL);
        await expect(service.sendRequest(ALICE, ALICE)).rejects.toBeInstanceOf(ValidationError);
    });

    it('404s on an ID that belongs to no account', async () => {
        const { dal } = makeFriendshipDAL();
        const service = makeService(dal, makeUserDAL({ [ALICE]: userRow(ALICE, 'Alice') }));
        await expect(service.sendRequest(ALICE, BOB)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('creates a pending request when the pair has no row', async () => {
        const { dal, calls } = makeFriendshipDAL();
        const service = makeService(dal, userDAL);
        const result = await service.sendRequest(ALICE, BOB);
        expect(result.status).toBe('requested');
        expect(result.request?.userId).toBe(BOB);
        expect(result.request?.direction).toBe('outgoing');
        expect(calls).toContain('createRequest');
    });

    it('auto-accepts when the target already sent the caller a request', async () => {
        // Bob → Alice is pending and Alice now "sends" to Bob. Two pending rows are
        // impossible (pair unique index), and erroring would strand the user, so the
        // honest outcome is a friendship.
        const { dal, calls } = makeFriendshipDAL({
            findBetween: async () => pendingRow({ requesterId: BOB, addresseeId: ALICE }),
        });
        const service = makeService(dal, userDAL);
        const result = await service.sendRequest(ALICE, BOB);
        expect(result.status).toBe('auto-accepted');
        expect(result.friend?.userId).toBe(BOB);
        expect(result.request).toBeNull();
        expect(calls).toContain('acceptRequest');
        expect(calls).not.toContain('createRequest');
    });

    it('refuses a duplicate request to someone already asked', async () => {
        const { dal } = makeFriendshipDAL({ findBetween: async () => pendingRow() });
        const service = makeService(dal, userDAL);
        await expect(service.sendRequest(ALICE, BOB)).rejects.toBeInstanceOf(DuplicateError);
    });

    it('refuses a request to an existing friend', async () => {
        const { dal } = makeFriendshipDAL({
            findBetween: async () => pendingRow({ status: 'accepted' }),
        });
        const service = makeService(dal, userDAL);
        await expect(service.sendRequest(ALICE, BOB)).rejects.toBeInstanceOf(DuplicateError);
    });
});

describe('FriendsService.acceptRequest', () => {
    const userDAL = makeUserDAL({ [ALICE]: userRow(ALICE, 'Alice'), [BOB]: userRow(BOB, 'Bob') });

    it('lets the addressee accept and returns the requester as the new friend', async () => {
        const { dal } = makeFriendshipDAL({ findById: async () => pendingRow() });
        const service = makeService(dal, userDAL);
        const friend = await service.acceptRequest(BOB, REQUEST_ID);
        expect(friend.userId).toBe(ALICE);
        expect(friend.friendsSince).toBe('2026-08-02T00:00:00.000Z');
    });

    it('does NOT let the requester accept their own request', async () => {
        const { dal, calls } = makeFriendshipDAL({ findById: async () => pendingRow() });
        const service = makeService(dal, userDAL);
        await expect(service.acceptRequest(ALICE, REQUEST_ID)).rejects.toBeInstanceOf(NotFoundError);
        expect(calls).not.toContain('acceptRequest');
    });

    it('does not confirm the existence of a stranger\'s request', async () => {
        const CAROL = '44444444-4444-4444-8444-444444444444';
        const { dal } = makeFriendshipDAL({ findById: async () => pendingRow() });
        const service = makeService(dal, userDAL);
        await expect(service.acceptRequest(CAROL, REQUEST_ID)).rejects.toBeInstanceOf(NotFoundError);
    });
});

describe('FriendsService.deleteRequest', () => {
    const userDAL = makeUserDAL();

    it('lets the addressee decline', async () => {
        const { dal, calls } = makeFriendshipDAL({ findById: async () => pendingRow() });
        await makeService(dal, userDAL).deleteRequest(BOB, REQUEST_ID);
        expect(calls).toContain('deleteById');
    });

    it('lets the requester revoke', async () => {
        const { dal, calls } = makeFriendshipDAL({ findById: async () => pendingRow() });
        await makeService(dal, userDAL).deleteRequest(ALICE, REQUEST_ID);
        expect(calls).toContain('deleteById');
    });

    it('refuses to touch an accepted row — declining must never be an unfriend', async () => {
        const { dal, calls } = makeFriendshipDAL({
            findById: async () => pendingRow({ status: 'accepted' }),
        });
        const service = makeService(dal, userDAL);
        await expect(service.deleteRequest(BOB, REQUEST_ID)).rejects.toBeInstanceOf(NotFoundError);
        expect(calls).not.toContain('deleteById');
    });

    it('refuses a third party', async () => {
        const CAROL = '44444444-4444-4444-8444-444444444444';
        const { dal, calls } = makeFriendshipDAL({ findById: async () => pendingRow() });
        const service = makeService(dal, userDAL);
        await expect(service.deleteRequest(CAROL, REQUEST_ID)).rejects.toBeInstanceOf(NotFoundError);
        expect(calls).not.toContain('deleteById');
    });
});

describe('FriendsService.removeFriend', () => {
    const userDAL = makeUserDAL();

    it('deletes the shared row when the two are friends', async () => {
        const { dal, calls } = makeFriendshipDAL({
            findBetween: async () => pendingRow({ status: 'accepted' }),
        });
        await makeService(dal, userDAL).removeFriend(ALICE, BOB);
        expect(calls).toContain('deleteBetween');
    });

    it('404s when the pair only has a pending request — unfriending is not a decline', async () => {
        const { dal, calls } = makeFriendshipDAL({ findBetween: async () => pendingRow() });
        const service = makeService(dal, userDAL);
        await expect(service.removeFriend(ALICE, BOB)).rejects.toBeInstanceOf(NotFoundError);
        expect(calls).not.toContain('deleteBetween');
    });
});

/**
 * Leaderboard tests. The interesting rules are all SCOPING rules, and each one
 * fails silently rather than loudly if it regresses:
 *   • scoring a friend in the VIEWER's language shows a Spanish learner as a 0;
 *   • counting a bar whose goal is off credits a skill the learner never chose;
 *   • summing net minutes across languages over-reports a bilingual account.
 */
const CARLA = '44444444-4444-4444-8444-444444444444';

/** An account row as findScoringProfilesByIds returns it. */
function profile(id: string, name: string, over: Record<string, unknown> = {}) {
    return {
        userId: id,
        email: `${name.toLowerCase()}@example.com`,
        name,
        avatarIconId: null,
        selectedLanguage: 'zh',
        readingGoal: false,
        writingGoal: false,
        ...over,
    };
}

function makeLeaderboardService(opts: {
    friends: Array<{ userId: string; friendsSince: string | null }>;
    profiles: any[];
    buckets?: any[];
    netPoints?: Record<string, Record<string, number>>;
}) {
    const { dal } = makeFriendshipDAL({
        listFriends: async () => opts.friends.map((f) => ({
            userId: f.userId, name: null, email: '', avatarIconId: null, friendsSince: f.friendsSince,
        })),
    });
    const userDAL = { findScoringProfilesByIds: async () => opts.profiles } as any;
    const promotionDAL = { getVelocityBuckets: async () => opts.buckets ?? [] } as any;
    const pointsDAL = {
        getNetPointsForUsers: async () => new Map(
            Object.entries(opts.netPoints ?? {}).map(([id, langs]) => [id, new Map(Object.entries(langs))])
        ),
    } as any;
    return makeService(dal, userDAL, promotionDAL, pointsDAL);
}

describe('FriendsService.getLeaderboard', () => {
    it('scores each person in their OWN selected language, not the viewer\'s', async () => {
        const service = makeLeaderboardService({
            friends: [{ userId: BOB, friendsSince: '2026-08-01T00:00:00.000Z' }],
            profiles: [
                profile(ALICE, 'Alice', { selectedLanguage: 'zh' }),
                profile(BOB, 'Bob', { selectedLanguage: 'es' }),
            ],
            buckets: [
                { userId: ALICE, language: 'zh', bar: 'core', bandsClimbed: 3 },
                // Bob's work is all Spanish — it must count, even though Alice studies zh.
                { userId: BOB, language: 'es', bar: 'core', bandsClimbed: 9 },
            ],
            netPoints: { [BOB]: { es: 500, zh: 4000 } },
        });

        const { entries } = await service.getLeaderboard(ALICE);
        expect(entries.map((e) => e.userId)).toEqual([BOB, ALICE]);
        expect(entries[0]).toMatchObject({ velocity: 9, language: 'es', rank: 1 });
        // Net minutes follow the SAME language — Bob's 4000 Chinese points are not his score.
        expect(entries[0].netMinutes).toBe(500);
    });

    it('counts only the bars the account pursues', async () => {
        const service = makeLeaderboardService({
            friends: [{ userId: BOB, friendsSince: null }],
            profiles: [
                profile(ALICE, 'Alice', { readingGoal: true }),
                profile(BOB, 'Bob'), // core only
            ],
            buckets: [
                { userId: ALICE, language: 'zh', bar: 'core', bandsClimbed: 2 },
                { userId: ALICE, language: 'zh', bar: 'reading', bandsClimbed: 5 },
                { userId: BOB, language: 'zh', bar: 'core', bandsClimbed: 2 },
                // Logged but not pursued — must not inflate Bob past Alice.
                { userId: BOB, language: 'zh', bar: 'writing', bandsClimbed: 50 },
            ],
        });

        const { entries } = await service.getLeaderboard(ALICE);
        expect(entries.find((e) => e.userId === ALICE)?.velocity).toBe(7);
        expect(entries.find((e) => e.userId === BOB)?.velocity).toBe(2);
    });

    it('includes the viewer and flags their own row', async () => {
        const service = makeLeaderboardService({
            friends: [{ userId: BOB, friendsSince: '2026-08-01T00:00:00.000Z' }],
            profiles: [profile(ALICE, 'Alice'), profile(BOB, 'Bob')],
        });

        const { entries } = await service.getLeaderboard(ALICE);
        const self = entries.find((e) => e.userId === ALICE);
        expect(self?.isCurrentUser).toBe(true);
        expect(entries.find((e) => e.userId === BOB)?.isCurrentUser).toBe(false);
    });

    it('breaks a velocity tie on net minutes, then on name, so the order is total', async () => {
        const service = makeLeaderboardService({
            friends: [{ userId: BOB, friendsSince: null }, { userId: CARLA, friendsSince: null }],
            profiles: [profile(ALICE, 'Alice'), profile(BOB, 'Bob'), profile(CARLA, 'Carla')],
            buckets: [],
            netPoints: { [BOB]: { zh: 100 }, [CARLA]: { zh: 100 } },
        });

        const { entries } = await service.getLeaderboard(ALICE);
        // All velocities 0 → Bob and Carla (100 each) outrank Alice (0), Bob first by name.
        expect(entries.map((e) => e.userId)).toEqual([BOB, CARLA, ALICE]);
        expect(entries.map((e) => e.rank)).toEqual([1, 2, 3]);
    });

    it('reports zero rather than throwing for a friend who has never studied', async () => {
        const service = makeLeaderboardService({
            friends: [{ userId: BOB, friendsSince: null }],
            // No selected language either — the account is brand new.
            profiles: [profile(ALICE, 'Alice'), profile(BOB, 'Bob', { selectedLanguage: null })],
        });

        const { entries, windowDays } = await service.getLeaderboard(ALICE);
        expect(entries.find((e) => e.userId === BOB)).toMatchObject({
            velocity: 0, netMinutes: 0, language: 'zh',
        });
        expect(windowDays).toBe(7);
    });
});
