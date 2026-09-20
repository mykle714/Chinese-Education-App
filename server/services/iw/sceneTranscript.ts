import type { IImmersiveWorldDAL } from '../../dal/interfaces/IImmersiveWorldDAL.js';
import type { IWTranscriptEntry } from '../../contracts/iw.js';
import { iwFault, iwLog } from './iwDebugLog.js';

/**
 * SceneTranscript — what was said in a scene run, kept (§ 12 phase 3).
 *
 * LAYER: service. It writes through `IImmersiveWorldDAL` and holds no SQL; what it owns is
 * the LIFECYCLE question the DAL cannot answer — which `iw_scene_runs` row a given session
 * is, and when that row is finished.
 *
 * ── Why a session→run map instead of the client sending a run id ──────────────────────────
 * `sessionId` is client-generated and identifies one scene run for § 7's budget; before this
 * existed, nothing stored it. Two ways to bridge that to a durable row:
 *
 *   1. Hand the run id back at scene open and have the client send it. Correct, and it means
 *      a new endpoint, a new field on three request bodies, and a client that must not take a
 *      turn before the run has opened.
 *   2. Map `sessionId → runId` server-side, opening the run on the first model call.
 *
 * (2) is what this is, and the deciding argument is that it makes the transcript invisible to
 * the client: no route knows about it, no request body carries it, and a client that has never
 * heard of transcripts writes a complete one. The cost is that the map is per-process — the
 * SAME caveat `IWTurnBudget` already carries and for the same reason, so this adds no new
 * class of fragility to the feature. A backend restart mid-scene loses the mapping; the next
 * turn opens a fresh run, and the stranded one is closed by {@link IImmersiveWorldDAL.openRun}.
 *
 * ── Why the run opens LAZILY ──────────────────────────────────────────────────────────────
 * A scene that is walked into and left without a word writes no row. That is the right
 * answer for something called a transcript, and it also keeps `GET /play/scenes/:id` a
 * genuine read — a GET that inserts a row is a GET that a page refresh can spam.
 *
 * ⚠️ **NOTHING HERE MAY THROW AT ITS CALLER, AND NOTHING MAY MAKE A TURN WAIT.** The
 * recorder sits beside a live model call whose reply a learner is already listening to; a
 * transcript write that failed loudly would turn a bookkeeping problem into a frozen scene.
 * Every entry point catches, logs through `iwFault`, and returns.
 *
 * ⚠️ **THE TIMESTAMP IS WHEN THE LINE WAS PRODUCED, NOT WHEN IT WAS SPOKEN.** The client
 * queues speech (`speechChainRef`), and an authored beat is rendered ahead of its turn to
 * speak, so a script can generate line 3 while line 2 is still on screen. Order and `at`
 * therefore mean *generation* order. It matches speaking order for the conversational path,
 * which is the one anybody reads back; making it exact would require the client to report
 * what it said, which is the design this deliberately avoided.
 *
 * Referenced by: server/services/ImmersiveWorldService.ts; docs/IMMERSIVE_WORLD.md § 8,
 * § 12 phase 3.
 */

/** One live scene run, as this process knows it. */
interface SessionRun {
  /** Resolves to the run id, or to null when the run could not be opened. */
  runId: Promise<string | null>;
  /**
   * Appends, serialized.
   *
   * ⚠️ IT IS WHAT KEEPS THE TRANSCRIPT IN ORDER. Recording is deliberately not awaited by
   * the turn path, so without a chain two turns a second apart could land their `UPDATE`s
   * in either order and read back as a conversation answering itself.
   */
  chain: Promise<void>;
}

export class SceneTranscript {
  /** Keyed `userId\x00sessionId` — session ids are client-generated, so they are not a key. */
  private readonly sessions = new Map<string, SessionRun>();

  constructor(private readonly iwDAL: IImmersiveWorldDAL) {}

  private static key(userId: string, sessionId: string): string {
    return `${userId}\x00${sessionId}`;
  }

  /**
   * Record what one call produced, opening the run if this is the session's first.
   *
   * ⚠️ **FIRE AND FORGET BY CONTRACT.** It returns void rather than a promise so that no
   * caller can accidentally put a database round trip in front of an SSE flush. Awaiting the
   * write is what {@link flush} is for, and only a test wants that.
   */
  record(
    userId: string,
    sessionId: string,
    /**
     * Which scene, and in which language. Taken as a pair rather than as the `IWScene`,
     * because `IWScene.id` is optional — an unsaved scene in the editor has none — and the
     * runtime always has the id it just looked the scene up BY.
     */
    scene: { sceneId: string; language: string },
    entries: readonly IWTranscriptEntry[],
  ): void {
    if (!userId || !sessionId || entries.length === 0) return;

    const key = SceneTranscript.key(userId, sessionId);
    let session = this.sessions.get(key);
    if (!session) {
      session = {
        // Started here, not awaited here: the first turn of a scene should not pay for an
        // INSERT before its model call, and every later turn joins this same promise.
        //
        // ⚠️ `Promise.resolve().then(...)` RATHER THAN CALLING THE DAL DIRECTLY, so that a
        // DAL which throws SYNCHRONOUSLY lands in the same `catch` as one that rejects. A
        // bare `this.iwDAL.openRun(...)` would escape this whole method and take down the
        // turn that was recording — which is precisely the failure this class exists to be
        // incapable of, and precisely what a stubbed DAL in a test does.
        runId: Promise.resolve()
          .then(() => this.iwDAL.openRun(userId, scene.language, scene.sceneId))
          .then((run) => {
            iwLog('transcript', `run opened id=${run.id} scene=${scene.sceneId} session=${sessionId}`);
            return run.id;
          })
          .catch((error: any) => {
            iwFault('transcript', `could not open a run for scene=${scene.sceneId} — this run is not being kept`, error?.message ?? error);
            return null;
          }),
        chain: Promise.resolve(),
      };
      this.sessions.set(key, session);
    }

    const current = session;
    current.chain = current.chain.then(async () => {
      const runId = await current.runId;
      if (!runId) return;
      const written = await this.iwDAL.appendTranscript(runId, entries);
      // A run id this process is holding that no longer resolves means the row went away
      // underneath us — a hand-deleted run, or a restore. Worth a line: every subsequent
      // append for this session will silently do nothing too.
      if (!written) iwFault('transcript', `append hit no row runId=${runId} — the run is gone`);
    }).catch((error: any) => {
      iwFault('transcript', 'append failed — the line is lost, the scene is not', error?.message ?? error);
    });
  }

  /**
   * The scene ended: close the run and forget the session.
   *
   * `completed` is FALSE for now in every caller — § 9.2's completion pair is phase 3 proper,
   * and a run that nothing can mark complete should say so rather than claim it.
   *
   * ⚠️ **IT WAITS FOR THE PENDING APPENDS.** `/session/end` arrives (via `keepalive`) right
   * behind the last turn, so closing without draining the chain would race the final line out
   * of the transcript — exactly the line a reader most wants.
   */
  end(userId: string, sessionId: string, completed = false): void {
    const key = SceneTranscript.key(userId, sessionId);
    const session = this.sessions.get(key);
    if (!session) return;
    this.sessions.delete(key);

    void session.chain
      .then(async () => {
        const runId = await session.runId;
        if (!runId) return;
        // Same reason as the open above: reached through the chain, so a synchronous throw
        // from the DAL is a rejection this `catch` sees rather than an unhandled one.
        const run = await this.iwDAL.completeRun(runId, completed);
        iwLog('transcript', `run closed id=${runId} lines=${run?.transcript.length ?? '?'} seconds=${run?.durationSeconds ?? '?'}`);
      })
      .catch((error: any) => {
        iwFault('transcript', 'could not close the run — it stays open and the next one displaces it', error?.message ?? error);
      });
  }

  /** Await everything in flight for one session. A test seam; no request path calls it. */
  async flush(userId: string, sessionId: string): Promise<string | null> {
    const session = this.sessions.get(SceneTranscript.key(userId, sessionId));
    if (!session) return null;
    await session.chain;
    return session.runId;
  }
}
