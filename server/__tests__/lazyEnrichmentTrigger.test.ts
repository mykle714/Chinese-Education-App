/**
 * LazyEnrichmentService.triggerForWord — the spawn gate, the in-flight de-dupe and the
 * failure back-off (docs/DISCOVER_LAZY_ENRICHMENT.md § 5).
 *
 * The worker is never really started: `child_process.spawn` is replaced with a fake child
 * the test exits by hand, and `fs` is stubbed so no `logs/lazy-enrichment.log` is written.
 */
import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawned: FakeChild[] = [];

class FakeChild extends EventEmitter {
  unref = vi.fn();
}

vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    const child = new FakeChild();
    spawned.push(child);
    return child;
  }),
}));

vi.mock('fs', () => {
  const stub = {
    mkdirSync: vi.fn(),
    openSync: vi.fn(() => 99),
    writeSync: vi.fn(),
    closeSync: vi.fn(),
  };
  return { default: stub, ...stub };
});

const { LazyEnrichmentService } = await import('../services/LazyEnrichmentService.js');

/** Let the trigger's detached microtask chain (gate lookups → spawn) run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeService(isCandidate = true) {
  const userDAL = { findById: vi.fn() } as any;
  const dictionaryDAL = { isLazyEnrichmentCandidate: vi.fn(async () => isCandidate) } as any;
  return new LazyEnrichmentService(userDAL, dictionaryDAL);
}

const trigger = (svc: InstanceType<typeof LazyEnrichmentService>, word = '上') =>
  svc.triggerForWord({ word, language: 'zh', isValidator: true });

describe('LazyEnrichmentService.triggerForWord', () => {
  beforeEach(() => {
    spawned.length = 0;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('does not spawn for a non-validator, a non-zh word, or a complete word', async () => {
    const svc = makeService();
    svc.triggerForWord({ word: '上', language: 'zh', isValidator: false });
    svc.triggerForWord({ word: 'casa', language: 'es', isValidator: true });
    trigger(makeService(false));
    await flush();
    expect(spawned).toHaveLength(0);
  });

  it('de-dupes while a worker for the word is running, and re-spawns after a clean exit', async () => {
    const svc = makeService();
    trigger(svc);
    await flush();
    trigger(svc);
    await flush();
    expect(spawned).toHaveLength(1);

    spawned[0].emit('exit', 0, null);
    trigger(svc);
    await flush();
    expect(spawned).toHaveLength(2);
  });

  it('backs off a word whose worker exited nonzero, then retries after an hour', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const svc = makeService();
    trigger(svc);
    await flush();
    spawned[0].emit('exit', 2, null);

    trigger(svc);
    await flush();
    expect(spawned).toHaveLength(1); // held off

    trigger(svc, '下'); // other words are unaffected
    await flush();
    expect(spawned).toHaveLength(2);

    vi.setSystemTime(Date.now() + 60 * 60 * 1000 + 1);
    trigger(svc);
    await flush();
    expect(spawned).toHaveLength(3);
  });

  it('treats a killed worker (signal, no code) as a failure', async () => {
    const svc = makeService();
    trigger(svc);
    await flush();
    spawned[0].emit('exit', null, 'SIGTERM');
    trigger(svc);
    await flush();
    expect(spawned).toHaveLength(1);
  });
});
