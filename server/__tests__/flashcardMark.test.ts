import { describe, expect, it } from 'vitest';
import { FlashcardMarkService } from '../services/FlashcardMarkService.js';
import { DALError } from '../types/dal.js';
import type { IVocabEntryDAL, VetMarkState, MasteredAtWrite } from '../dal/interfaces/IVocabEntryDAL.js';
import type { ICategoryPromotionDAL } from '../dal/interfaces/ICategoryPromotionDAL.js';
import type { ReviewMark, TypedMarkHistory } from '../types/index.js';

/**
 * Tests for FlashcardMarkService — the mark/undo policy layer
 * (docs/MASTERY_REWORK.md, docs/FLASHCARD_REVIEW_HISTORY_IMPLEMENTATION.md).
 *
 * This logic was untestable until it left the Express handler it used to live in:
 * every rule below could only be exercised by booting a router against a live
 * database. Each one also fails SILENTLY in production if it regresses —
 *   • a lost row lock drops one of Word Search's two parallel marks;
 *   • a missed cooldown gate records a mark the design says must not count;
 *   • a wrong displaced mark makes undo restore the wrong review;
 *   • a mastery stamp on the wrong bar back-dates a learner's progress;
 *   • a velocity failure that propagated would fail the review write itself.
 * The DALs are hand-stubbed and the transaction runner is a fake, so no connection
 * is ever opened (docs/BACKEND_LAYERING.md § 3 — the reason the runner is injected).
 */

const USER = '11111111-1111-4111-8111-111111111111';
const CARD = 4242;

/** A stand-in PoolClient. Nothing under test calls it — only identity is asserted. */
const FAKE_CLIENT = { __fake: 'client' } as any;

/**
 * A TransactionRunner that runs the operation inline and records whether it
 * committed. Real commit/rollback semantics don't matter here: what the tests need
 * is (a) the callback receives a client, and (b) a throw propagates.
 */
function makeTxRunner() {
    const state = { began: 0, rolledBack: 0 };
    return {
        state,
        runner: {
            async executeInTransaction<T>(op: (tx: any) => Promise<T>): Promise<T> {
                state.began += 1;
                try {
                    return await op({ getClient: () => FAKE_CLIENT, isActive: true, commit: async () => {}, rollback: async () => {} });
                } catch (err) {
                    state.rolledBack += 1;
                    throw err;
                }
            },
        },
    };
}

interface VetStub {
    dal: IVocabEntryDAL;
    findCalls: Array<{ opts: any }>;
    writes: Array<{ history: TypedMarkHistory; masteredAt: MasteredAtWrite | null | undefined; client: any }>;
}

/** A vet DAL exposing exactly the two methods the service uses. */
function makeVetDAL(state: VetMarkState | null): VetStub {
    const findCalls: VetStub['findCalls'] = [];
    const writes: VetStub['writes'] = [];
    const dal = {
        async findMarkState(_userId: string, _cardId: number, opts: any = {}) {
            findCalls.push({ opts });
            return state;
        },
        async updateMarkHistory(
            _userId: string, _cardId: number, _language: string,
            history: TypedMarkHistory, masteredAt?: MasteredAtWrite | null, client?: any
        ) {
            writes.push({ history, masteredAt, client });
            return true;
        },
    } as unknown as IVocabEntryDAL;
    return { dal, findCalls, writes };
}

function makePromotionDAL(overrides: Partial<ICategoryPromotionDAL> = {}) {
    const recorded: any[] = [];
    const deleted: any[] = [];
    const dal = {
        async recordPromotion(input: any) { recorded.push(input); return input; },
        async deleteForMark(cardId: number, markTimestamp: string, client?: any) {
            deleted.push({ cardId, markTimestamp, client });
            return 1;
        },
        ...overrides,
    } as unknown as ICategoryPromotionDAL;
    return { dal, recorded, deleted };
}

function mark(timestamp: string, isCorrect = true): ReviewMark {
    return { timestamp, isCorrect };
}

/** N correct marks, all long enough ago that no cooldown window is still running. */
function oldCorrectMarks(n: number): ReviewMark[] {
    // 2020 — older than the longest window (Mastered, 180 days) by years.
    return Array.from({ length: n }, (_, i) => mark(`2020-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`));
}

function makeService(state: VetMarkState | null, promotionOverrides: Partial<ICategoryPromotionDAL> = {}) {
    const vet = makeVetDAL(state);
    const promotions = makePromotionDAL(promotionOverrides);
    const tx = makeTxRunner();
    const service = new FlashcardMarkService(vet.dal, promotions.dal, tx.runner);
    return { service, vet, promotions, tx };
}

describe('FlashcardMarkService.applyMark', () => {
    it('records a mark on a card with no history and reports the new band', async () => {
        const { service, vet } = makeService({ language: 'zh', typedMarkHistory: {}, masteredAt: null });

        const result = await service.applyMark({ userId: USER, cardId: CARD, isCorrect: true, markType: 'recognition' });

        expect(result.suppressed).toBe(false);
        expect(result.language).toBe('zh');
        expect(result.markTimestamp).toBeTruthy();
        expect(result.displacedMark).toBeNull();
        // One correct recognition mark is pbh 1 — still Unfamiliar, and unchanged
        // from before, so this also pins that the two bands are computed separately.
        expect(result.categoryBeforeMark).toBe('Unfamiliar');
        expect(result.category).toBe('Unfamiliar');
        expect(vet.writes).toHaveLength(1);
        expect(vet.writes[0].history.recognition).toHaveLength(1);
        expect(vet.writes[0].masteredAt).toBeNull();
    });

    it('reads the row FOR UPDATE inside the transaction, and writes on the same client', async () => {
        // The concurrency fix. Word Search fires reading + production marks in the
        // same tick without awaiting, and typedMarkHistory is a read-modify-write of
        // one jsonb column: without the lock the second UPDATE erases the first.
        const { service, vet, tx } = makeService({ language: 'zh', typedMarkHistory: {}, masteredAt: null });

        await service.applyMark({ userId: USER, cardId: CARD, isCorrect: true, markType: 'production' });

        expect(tx.state.began).toBe(1);
        expect(vet.findCalls[0].opts.forUpdate).toBe(true);
        expect(vet.findCalls[0].opts.client).toBe(FAKE_CLIENT);
        expect(vet.writes[0].client).toBe(FAKE_CLIENT);
    });

    it('SUPPRESSES a mark whose track is still cooling, and writes nothing', async () => {
        // One correct mark just now leaves the track Unfamiliar → a 5-minute window.
        const history: TypedMarkHistory = { recognition: [mark(new Date().toISOString())] };
        const { service, vet, promotions } = makeService({ language: 'zh', typedMarkHistory: history, masteredAt: null });

        const result = await service.applyMark({ userId: USER, cardId: CARD, isCorrect: true, markType: 'recognition', surface: 'hydra-bubbles' });

        expect(result.suppressed).toBe(true);
        // Null timestamp is the contract the client keys on: nothing to undo.
        expect(result.markTimestamp).toBeNull();
        expect(result.displacedMark).toBeNull();
        expect(vet.writes).toHaveLength(0);
        expect(promotions.recorded).toHaveLength(0);
    });

    it('cools each track independently — a rested track still records', async () => {
        const history: TypedMarkHistory = { recognition: [mark(new Date().toISOString())] };
        const { service, vet } = makeService({ language: 'zh', typedMarkHistory: history, masteredAt: null });

        const result = await service.applyMark({ userId: USER, cardId: CARD, isCorrect: true, markType: 'production' });

        expect(result.suppressed).toBe(false);
        expect(vet.writes).toHaveLength(1);
    });

    it('returns the mark displaced from a full 8-slot window', async () => {
        const track = oldCorrectMarks(8);
        const { service, vet } = makeService({ language: 'es', typedMarkHistory: { recognition: track }, masteredAt: null });

        const result = await service.applyMark({ userId: USER, cardId: CARD, isCorrect: false, markType: 'recognition' });

        expect(result.displacedMark).toEqual(track[0]);
        // The window stays at 8 — the new mark took the evicted slot, not a ninth.
        expect(vet.writes[0].history.recognition).toHaveLength(8);
        expect(result.language).toBe('es');
    });

    it('stamps masteredAt on the crossing bar and logs the band step', async () => {
        // 7 old correct reading marks = pbh 7 = Comfortable; the 8th crosses to Mastered.
        const { service, vet, promotions } = makeService({
            language: 'zh',
            typedMarkHistory: { reading: oldCorrectMarks(7) },
            masteredAt: null,
        });

        const result = await service.applyMark({ userId: USER, cardId: CARD, isCorrect: true, markType: 'reading' });

        expect(vet.writes[0].masteredAt).toEqual({ bar: 'reading', stamp: result.markTimestamp });
        expect(promotions.recorded).toHaveLength(1);
        expect(promotions.recorded[0]).toMatchObject({
            bar: 'reading',
            fromCategory: 'Comfortable',
            toCategory: 'Mastered',
            bandsClimbed: 1,
            markType: 'reading',
            markTimestamp: result.markTimestamp,
        });
        // The CORE bar is untouched by a reading mark, which is what the returned
        // categories describe — they are the card's overall band, not the reading bar's.
        expect(result.category).toBe('Unfamiliar');
    });

    it('does not stamp masteredAt again for a bar already mastered', async () => {
        const { service, vet, promotions } = makeService({
            language: 'zh',
            typedMarkHistory: { reading: oldCorrectMarks(8) },
            masteredAt: { reading: '2020-01-08T00:00:00.000Z' },
        });

        await service.applyMark({ userId: USER, cardId: CARD, isCorrect: true, markType: 'reading' });

        // No transition fired, so no stamp and no band step.
        expect(vet.writes[0].masteredAt).toBeNull();
        expect(promotions.recorded).toHaveLength(0);
    });

    it('still commits the mark when the velocity log throws', async () => {
        // Best-effort by design: losing a stat must never fail a learner's review.
        const { service, vet } = makeService(
            { language: 'zh', typedMarkHistory: { reading: oldCorrectMarks(7) }, masteredAt: null },
            { recordPromotion: async () => { throw new Error('velocity table is down'); } }
        );

        const result = await service.applyMark({ userId: USER, cardId: CARD, isCorrect: true, markType: 'reading' });

        expect(result.suppressed).toBe(false);
        expect(result.markTimestamp).toBeTruthy();
        expect(vet.writes).toHaveLength(1);
    });

    it('404s on a card the caller does not own', async () => {
        const { service, tx } = makeService(null);

        await expect(
            service.applyMark({ userId: USER, cardId: CARD, isCorrect: true, markType: 'recognition' })
        ).rejects.toMatchObject({ code: 'ERR_ENTRY_NOT_FOUND', statusCode: 404 });
        expect(tx.state.rolledBack).toBe(1);
    });
});

describe('FlashcardMarkService.undoMark', () => {
    const LAST = '2026-08-28T12:00:00.000Z';

    it('drops the newest mark and restores the one it displaced', async () => {
        const track = [...oldCorrectMarks(7), mark(LAST)];
        const displaced = mark('2019-12-31T00:00:00.000Z');
        const { service, vet, promotions } = makeService({
            language: 'zh', typedMarkHistory: { recognition: track }, masteredAt: null,
        });

        const result = await service.undoMark({
            userId: USER, cardId: CARD, markTimestamp: LAST, markType: 'recognition', displacedMark: displaced,
        });

        const reverted = vet.writes[0].history.recognition!;
        expect(reverted[0]).toEqual(displaced);
        expect(reverted).toHaveLength(8);
        expect(reverted.some((m) => m.timestamp === LAST)).toBe(false);
        expect(result.category).toBeTruthy();
        // The velocity row is deleted IN the undo transaction — unlike the write path
        // this is not best-effort, or an undone review would keep crediting velocity.
        expect(promotions.deleted[0]).toMatchObject({ cardId: CARD, markTimestamp: LAST, client: FAKE_CLIENT });
    });

    it('retracts the mastery stamp that this exact mark created', async () => {
        const { service, vet } = makeService({
            language: 'zh',
            typedMarkHistory: { reading: [...oldCorrectMarks(7), mark(LAST)] },
            masteredAt: { reading: LAST },
        });

        await service.undoMark({ userId: USER, cardId: CARD, markTimestamp: LAST, markType: 'reading' });

        expect(vet.writes[0].masteredAt).toEqual({ bar: 'reading', stamp: null });
    });

    it('leaves a mastery stamp created by some OTHER mark alone', async () => {
        const { service, vet } = makeService({
            language: 'zh',
            typedMarkHistory: { reading: [...oldCorrectMarks(7), mark(LAST)] },
            masteredAt: { reading: '2020-01-05T00:00:00.000Z' },
        });

        await service.undoMark({ userId: USER, cardId: CARD, markTimestamp: LAST, markType: 'reading' });

        expect(vet.writes[0].masteredAt).toBeNull();
    });

    it('refuses an undo that does not target the newest mark', async () => {
        const { service, vet } = makeService({
            language: 'zh', typedMarkHistory: { recognition: oldCorrectMarks(3) }, masteredAt: null,
        });

        await expect(
            service.undoMark({ userId: USER, cardId: CARD, markTimestamp: LAST, markType: 'recognition' })
        ).rejects.toMatchObject({ code: 'ERR_UNDO_TARGET_MISMATCH', statusCode: 409 });
        expect(vet.writes).toHaveLength(0);
    });

    it('refuses an undo on a track with no marks', async () => {
        const { service } = makeService({ language: 'zh', typedMarkHistory: {}, masteredAt: null });

        await expect(
            service.undoMark({ userId: USER, cardId: CARD, markTimestamp: LAST, markType: 'writing' })
        ).rejects.toBeInstanceOf(DALError);
    });

    it('takes the row lock, so an undo cannot race a concurrent mark', async () => {
        const { service, vet } = makeService({
            language: 'zh', typedMarkHistory: { recognition: [mark(LAST)] }, masteredAt: null,
        });

        await service.undoMark({ userId: USER, cardId: CARD, markTimestamp: LAST, markType: 'recognition' });

        expect(vet.findCalls[0].opts.forUpdate).toBe(true);
        expect(vet.findCalls[0].opts.client).toBe(FAKE_CLIENT);
    });
});
