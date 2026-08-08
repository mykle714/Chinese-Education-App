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

describe('FriendsService.sendRequest', () => {
    let userDAL: any;
    beforeEach(() => {
        userDAL = makeUserDAL({ [ALICE]: userRow(ALICE, 'Alice'), [BOB]: userRow(BOB, 'Bob') });
    });

    it('rejects anything that is not a user ID before touching the database', async () => {
        const { dal, calls } = makeFriendshipDAL();
        const service = new FriendsService(dal, userDAL);
        await expect(service.sendRequest(ALICE, 'bob@example.com')).rejects.toBeInstanceOf(ValidationError);
        await expect(service.sendRequest(ALICE, undefined)).rejects.toBeInstanceOf(ValidationError);
        expect(calls).toEqual([]);
    });

    it('rejects friending yourself', async () => {
        const { dal } = makeFriendshipDAL();
        const service = new FriendsService(dal, userDAL);
        await expect(service.sendRequest(ALICE, ALICE)).rejects.toBeInstanceOf(ValidationError);
    });

    it('404s on an ID that belongs to no account', async () => {
        const { dal } = makeFriendshipDAL();
        const service = new FriendsService(dal, makeUserDAL({ [ALICE]: userRow(ALICE, 'Alice') }));
        await expect(service.sendRequest(ALICE, BOB)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('creates a pending request when the pair has no row', async () => {
        const { dal, calls } = makeFriendshipDAL();
        const service = new FriendsService(dal, userDAL);
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
        const service = new FriendsService(dal, userDAL);
        const result = await service.sendRequest(ALICE, BOB);
        expect(result.status).toBe('auto-accepted');
        expect(result.friend?.userId).toBe(BOB);
        expect(result.request).toBeNull();
        expect(calls).toContain('acceptRequest');
        expect(calls).not.toContain('createRequest');
    });

    it('refuses a duplicate request to someone already asked', async () => {
        const { dal } = makeFriendshipDAL({ findBetween: async () => pendingRow() });
        const service = new FriendsService(dal, userDAL);
        await expect(service.sendRequest(ALICE, BOB)).rejects.toBeInstanceOf(DuplicateError);
    });

    it('refuses a request to an existing friend', async () => {
        const { dal } = makeFriendshipDAL({
            findBetween: async () => pendingRow({ status: 'accepted' }),
        });
        const service = new FriendsService(dal, userDAL);
        await expect(service.sendRequest(ALICE, BOB)).rejects.toBeInstanceOf(DuplicateError);
    });
});

describe('FriendsService.acceptRequest', () => {
    const userDAL = makeUserDAL({ [ALICE]: userRow(ALICE, 'Alice'), [BOB]: userRow(BOB, 'Bob') });

    it('lets the addressee accept and returns the requester as the new friend', async () => {
        const { dal } = makeFriendshipDAL({ findById: async () => pendingRow() });
        const service = new FriendsService(dal, userDAL);
        const friend = await service.acceptRequest(BOB, REQUEST_ID);
        expect(friend.userId).toBe(ALICE);
        expect(friend.friendsSince).toBe('2026-08-02T00:00:00.000Z');
    });

    it('does NOT let the requester accept their own request', async () => {
        const { dal, calls } = makeFriendshipDAL({ findById: async () => pendingRow() });
        const service = new FriendsService(dal, userDAL);
        await expect(service.acceptRequest(ALICE, REQUEST_ID)).rejects.toBeInstanceOf(NotFoundError);
        expect(calls).not.toContain('acceptRequest');
    });

    it('does not confirm the existence of a stranger\'s request', async () => {
        const CAROL = '44444444-4444-4444-8444-444444444444';
        const { dal } = makeFriendshipDAL({ findById: async () => pendingRow() });
        const service = new FriendsService(dal, userDAL);
        await expect(service.acceptRequest(CAROL, REQUEST_ID)).rejects.toBeInstanceOf(NotFoundError);
    });
});

describe('FriendsService.deleteRequest', () => {
    const userDAL = makeUserDAL();

    it('lets the addressee decline', async () => {
        const { dal, calls } = makeFriendshipDAL({ findById: async () => pendingRow() });
        await new FriendsService(dal, userDAL).deleteRequest(BOB, REQUEST_ID);
        expect(calls).toContain('deleteById');
    });

    it('lets the requester revoke', async () => {
        const { dal, calls } = makeFriendshipDAL({ findById: async () => pendingRow() });
        await new FriendsService(dal, userDAL).deleteRequest(ALICE, REQUEST_ID);
        expect(calls).toContain('deleteById');
    });

    it('refuses to touch an accepted row — declining must never be an unfriend', async () => {
        const { dal, calls } = makeFriendshipDAL({
            findById: async () => pendingRow({ status: 'accepted' }),
        });
        const service = new FriendsService(dal, userDAL);
        await expect(service.deleteRequest(BOB, REQUEST_ID)).rejects.toBeInstanceOf(NotFoundError);
        expect(calls).not.toContain('deleteById');
    });

    it('refuses a third party', async () => {
        const CAROL = '44444444-4444-4444-8444-444444444444';
        const { dal, calls } = makeFriendshipDAL({ findById: async () => pendingRow() });
        const service = new FriendsService(dal, userDAL);
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
        await new FriendsService(dal, userDAL).removeFriend(ALICE, BOB);
        expect(calls).toContain('deleteBetween');
    });

    it('404s when the pair only has a pending request — unfriending is not a decline', async () => {
        const { dal, calls } = makeFriendshipDAL({ findBetween: async () => pendingRow() });
        const service = new FriendsService(dal, userDAL);
        await expect(service.removeFriend(ALICE, BOB)).rejects.toBeInstanceOf(NotFoundError);
        expect(calls).not.toContain('deleteBetween');
    });
});
