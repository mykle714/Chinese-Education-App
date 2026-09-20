import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IW_ACTOR_PLAYER, IW_CONVERSATION_LINE_MS, IW_DEFAULT_EMOTE, IW_MAX_LISTENERS_PER_UTTERANCE,
  IW_MIN_TURN_GAP_MS, scenePlaces, type IWEmote, type IWFacing, type IWLineSegments,
  type IWNpcOption, type IWScene, type IWVolume,
} from '../../../../server/contracts/iw';
import { actionById, type ActionWorld } from './actionPlayer';
import { chooseAddressee } from './addressee';
import { hears } from './hearing';
import { guardNpcLine } from '../../../../server/contracts/iwLineGuard';
import { planGlyphReveal } from '../../../engine/iw/revealSchedule';
import {
  approachCells, buildSceneGraph, cellKey, chebyshev, parseCellKey, planScenePath,
  type SceneGraph,
} from '../../../engine/iw/sceneGraph';
import {
  facingForStep, forcedFacingFor, occupiedCells, setActorPath, tickSceneActors,
  type SceneActorState,
} from '../../../engine/iw/sceneActor';
import { useTTS } from '../../../hooks/useTTS';
import type { TTSVoice } from '../../../services/tts';
import {
  actorCells, bodyDrawable, buildSceneBodies,
  type IWBodyDrawable, type IWSceneBody,
} from './iwSceneActors';
import { runAuthoredAction, runInteraction, type IWScriptDeps } from './iwScript';
import {
  endIwSession, newSessionId, renderNpcLine, routeAddressee, segmentUtterance, takeNpcTurn,
  type IWPerception,
} from '../immersiveWorldTurnApi';
import { iwLog, iwWarn } from '../iwDebugLog';

/**
 * useIWSceneRuntime — one scene, running (§ 12 phase 2).
 *
 * LAYER: feature hook. It is the ONLY stateful thing in the play surface: the stage draws what
 * it is given, the bubble renders what it is given, and everything that decides *what happens*
 * is here. Every rule it enforces is somebody else's, though — the graph, the hearing gate,
 * the reveal schedule, the line guard and the step resolver are all pure modules under
 * `engine/iw/`, and this hook is what wires them to a clock, a network and a speaker.
 *
 * ── The two clocks ────────────────────────────────────────────────────────────────────────
 * **The frame clock** is Pixi's: the stage calls {@link IWSceneRuntime.tick} once per frame,
 * which advances bodies and resolves arrivals. It deliberately does NOT set React state — a
 * `setState` per frame would re-render the page tree 60×/sec — so positions live in a ref and
 * the stage reads them straight out of it.
 *
 * **The speech clock** is the audio (§ 6.4). A line is synthesized BEFORE it is painted, and
 * the glyphs are spread across the decoded clip's own duration; when there is no audio the
 * same schedule runs on a timer at § 5.3a's fallback cadence, and the two must be
 * indistinguishable.
 *
 * ── What is deliberately NOT here (phase 3) ───────────────────────────────────────────────
 * No complication draw, no report, no completion check.
 *
 * ⚠️ **THE TRANSCRIPT IS NOT IN THAT LIST ANY MORE, AND IT IS STILL NOT HERE** (2026-09-08).
 * Every line a scene produces is now kept in `iw_scene_runs.transcript` — but entirely
 * server-side, by `SceneTranscript`, off the two endpoints that generate speech. This hook
 * sends nothing extra and knows nothing about it, which is the property that made that design
 * win: `sessionId` stays client-generated and identifies a run for § 7's budget, and the
 * server maps it to a row. Do NOT add a run id to a request body to "fix" that.
 *
 * The one thing this costs is that `heardRef` — which knows the real SPEAKING order, and knows
 * about a line nobody could hear — is not what gets stored. See § 12 phase 3's two known gaps.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 3, § 4, § 4.1, § 4.2, § 5.3a, § 6.4, § 7, § 12 phase 2.
 */

/** How long after a bubble finishes revealing before it fades. Proportional to length. */
const BUBBLE_DWELL_BASE_MS = 1600;
const BUBBLE_DWELL_PER_GLYPH_MS = 90;

/**
 * § 6.4 rule 4: if the MP3 is not decoded this long after the line is in hand, start the
 * timer-paced reveal and let the audio be DROPPED, not late. Measured worst case is 646 ms
 * for synthesis alone, but an outage is unbounded — the 2026-08-21 billing incident ran for
 * three days — and a scene must not hold still for it.
 */
/**
 * How long a line may wait for its synth before giving up and revealing on the timer (§ 6.4
 * rule 4).
 *
 * ⚠️ **RAISED FROM 400 ON 2026-09-07, AND THE OLD VALUE WAS SILENTLY BREAKING THE COMPANION.**
 * The server caches MP3s on disk keyed by `sha256(provider:voice:text)`, so the deadline is
 * really two different deadlines depending on who is speaking. Measured against the dev
 * backend (`POST /api/tts/synthesize`, Chinese, cache cleared):
 *
 * | line | cold | warm |
 * |---|---|---|
 * | 10 chars | 267 ms | ~5 ms |
 * | 29 chars | 322 ms | ~5 ms |
 * | 39 chars | **437 ms** | ~5 ms |
 *
 * An AUTHORED line is the same string every run, so it is warm after its first play and comes
 * back in single-digit milliseconds. A GENERATED line is novel text every time and can never
 * be warm. The companion has no authored actions at all — every word he says is generated —
 * so he was the one speaker whose every line raced a cold synth, and at conversational length
 * a cold synth alone exceeds 400 ms before the client has even decoded it. The symptom was
 * "audio plays for everyone except the companion", which reads as something about *him* and is
 * really about text nobody has said before.
 *
 * Waiting longer is safe for SYNC, which is what rule 4 actually protects: the reveal has not
 * started while the race is running, so the cost of a bigger number is only that the bubble
 * appears later — and only in the case where the synth is genuinely slow. The cap still exists
 * to stop a hung provider from holding the scene.
 */
const TTS_DEADLINE_MS = 1500;
/** Distinguishes "the deadline won the race" from "there was no audio to begin with". */
const TTS_TIMED_OUT = Symbol('tts-deadline');

/** How many recent lines an NPC is told it heard. Bounded because it is prompt weight. */
const HEARD_WINDOW = 8;

/**
 * How long the scene will wait for the § 4.2 router before routing itself.
 *
 * ⚠️ **THIS IS THE CEILING ON WHAT ASKING A MODEL COSTS THE LEARNER**, and it is the reason a
 * second serial call is tolerable at all under § 6. It sits just above the server's own
 * deadline (1800 ms) so that in the ordinary case the SERVER gives up first and this timer
 * never fires — it is here for the one thing no server-side timer can end, a hung connection.
 *
 * ⚠️ **THE NUMBER TO JUDGE IT BY IS THE MEDIAN, NOT THIS.** Measured routes run ~650 ms
 * (`server/scripts/iw-route-probe.js`), so what a learner actually pays is about two thirds of
 * a second on top of the turn. This bounds the tail — a 3.6 s route was observed — and past it
 * the rule ladder answers instantly, so the worst case is a usually-right guess rather than a
 * stalled scene.
 */
const IW_ROUTE_CLIENT_DEADLINE_MS = 2000;

/**
 * How long the learner's own bubble is HELD BACK waiting for its segmentation (§ 5.3b).
 *
 * ⚠️ **A DELAY IS THE CHEAPER FAULT THAN A REFLOW.** Their line is segmented by a round trip
 * that lands a moment after they press Say, so posting the bubble immediately means posting it
 * without pinyin and growing a whole pinyin row under it a beat later — the text jumps, and it
 * jumps precisely while they are reading back what they typed. Holding the bubble for the
 * lookup makes the two arrive together; the learner sees their words a fraction of a second
 * later and never sees them move.
 *
 * ⚠️ **IT IS A DEADLINE, NOT A WAIT.** Past it the bubble goes up plain, and a late
 * segmentation still upgrades it the old way — a slow dictionary must cost pinyin, never the
 * line. Sized against `TTS_DEADLINE_MS` (1500) rather than the route deadline: this is one
 * indexed query with no model in it, so anything near a second means it is not coming.
 */
const IW_PLAYER_SEGMENT_HOLD_MS = 700;

/** What the learner is called in an NPC's prompt. In-world, never "the player" (§ 14 Q27). */
const PLAYER_LABEL = 'the customer';

/** One speech bubble on screen. */
export interface IWBubble {
  /** Body id the bubble belongs to — an npcId, or `player` for the learner's own words. */
  actorId: string;
  text: string;
  /** Per-glyph reveal offsets in ms from {@link startedAt} (`revealSchedule.ts`). */
  schedule: number[];
  startedAt: number;
  emote: IWEmote;
  /**
   * True when the bubble carries somebody ELSE's words, so the speaker button is offered.
   *
   * ⚠️ **IT IS NOT "audio actually played"** (which is what it meant until 2026-09-09). A
   * deliberate speaker press speaks in EVERY audio mode, mute included (`useTTS` — only
   * `auto` narration is gated), so hiding the button on a line the app chose not to narrate
   * removed the learner's only way to hear it precisely when they most needed one. Every other
   * narrating surface — flp, the eip, est — keeps its speaker button visible under mute for
   * the same reason. See docs/AUDIO_PLAYBACK.md.
   *
   * False only for the learner's own echoed line: they know how it sounded, they just said it.
   */
  replayable: boolean;
}

/** A picture an interaction is showing (§ 14 Q43's one genuinely new capability). */
export interface IWPopup {
  imageId: string;
  caption?: string;
}

export interface IWSceneRuntime {
  /** Advance the simulation. Called from the stage's frame loop, never from React. */
  tick(dtMs: number, nowMs: number): void;
  /** Every body's pose this instant, for the stage. */
  drawables(nowMs: number): IWBodyDrawable[];
  graph: SceneGraph;
  bodies: Map<string, IWSceneBody>;
  /**
   * npcId → the DISPLAY name for that body: what the stage prints over the head and what a
   * speech bubble prints above the line.
   *
   * ⚠️ **NOT {@link labelFor}, WHICH NAMES THE SAME BODIES FOR A DIFFERENT AUDIENCE.** That
   * one builds the strings an NPC's *prompt* sees, where the learner is `the customer`
   * (§ 14 Q27) — an in-world role, deliberately not a name the learner is ever shown. Keeping
   * them apart is the point: renaming what the UI calls somebody must not silently rewrite
   * what the model is told.
   *
   * The learner is absent here — they have no NPC entry and no head label — so a view that
   * wants to name them supplies its own word for it.
   *
   * A plain object rather than `bodies`, because `bodies` is a REF written from an effect: it
   * has no render-safe identity, so a `useMemo` in a view keyed on it can capture the empty
   * map it held before the scene was built and never recompute.
   */
  speakerLabels: Record<string, string>;
  bubbles: IWBubble[];
  /**
   * Tap-to-look-up data for spoken lines, keyed by the line's EXACT text (§ 5.3b).
   *
   * Seeded at scene open with every authored line, then added to as each model-generated
   * line's segmentation arrives on its own turn stream — which is why it is one map rather
   * than a field on `IWBubble`: a turn's segments land AFTER its bubble already exists, so
   * the bubble has to be able to gain them without being replaced (replacing it would restart
   * the reveal and desync the voice).
   *
   * A line with no entry renders as plain `ForeignText`, exactly as it did before this.
   */
  lineSegments: Record<string, IWLineSegments>;
  /** An out-of-world message: a refusal, a frozen ladder, an event that just fired. */
  banner: string | null;
  dismissBanner(): void;
  /** Q7's ladder was exhausted. The scene is frozen and nothing may be sent. */
  frozen: boolean;
  /** § 7's session budget, as last reported by the server. Null before the first turn. */
  remaining: number | null;
  /** A turn is in flight; the composer disables itself. */
  sending: boolean;
  popup: IWPopup | null;
  dismissPopup(): void;
  /** Walk the learner to a cell (§ 14 Q18's tap-to-move), tolerating a near miss. */
  walkPlayerTo(col: number, row: number): void;
  /** Address a body — the § 1 action button's target, and a tap on a person. */
  focusBody(id: string): void;
  /** Which body the learner last addressed. The `addressed` flag in the next turn. */
  focusedId: string | null;
  /** Say something. The one path that reaches an NPC's brain (§ 14 Q38). */
  say(text: string, volume?: IWVolume): void;
  /** Skipped steps and refused lines, newest last — the § 4 debug overlay's data. */
  notes: string[];
  /**
   * The learner's own words (§ 9.4), pushed in once they have been fetched.
   *
   * A setter rather than a hook argument because it arrives on its own schedule: a scene must
   * open the instant it loads, and vocabulary is GUIDANCE — a turn taken before the list lands
   * is written slightly less well, not wrongly.
   */
  setKnownWords(words: string[]): void;
  /** Run a place's authored interaction script (§ 14 Q43). */
  runPlaceInteraction(tag: string): Promise<void>;
  /**
   * Hold the world still (§ 5.3c). While paused nothing is spoken or voiced, no timed beat
   * advances and no body moves, so the scene is exactly where it was left when the hold lifts.
   *
   * ⚠️ **THIS IS NOT `frozen`.** `frozen` is Q7's terminal state — the ladder was exhausted
   * and nothing may ever be sent again. This is a reversible hold owned by whatever is
   * covering the screen; today that is the eip sheet a tapped bubble word opens, and the
   * reason it exists is that a bubble has no expiry but IS replaced by the next line: without
   * the hold, a conversation running behind the sheet would swap out the very line the
   * learner opened the sheet to read.
   */
  setPaused(paused: boolean): void;
}

/**
 * A body that could be the one the learner is talking to.
 *
 * Renamed from `Listener` (2026-09-07): with § 4's earshot gate gone, *everyone* listens, so
 * the word named nothing. What the list is actually for is choosing ONE recipient (§ 4.2), and
 * `col`/`row` went with the rename — the only geometry left in the decision is `distance`.
 */
interface AddresseeOption {
  id: string;
  label: string;
  distance: number;
  /** The learner's avatar is turned toward them. */
  facedByLearner: boolean;
  /** They are turned toward the learner. */
  facingLearner: boolean;
}

export function useIWSceneRuntime(
  scene: IWScene | null,
  npcs: readonly IWNpcOption[],
  /** The scene payload's authored-line segmentation — see {@link IWSceneRuntime.lineSegments}. */
  authoredSegments?: Record<string, IWLineSegments>,
): IWSceneRuntime {
  const tts = useTTS();

  // ── Simulation state ────────────────────────────────────────────────────────────────────
  // In a ref, not in state: it changes every frame and only the stage reads it.
  const graph = useMemo(
    () => buildSceneGraph({
      width: scene?.width ?? 1,
      height: scene?.height ?? 1,
      // The two painted masks (2026-09-19). The graph no longer reads `decor` at all: what a
      // cell LOOKS like and whether it can be walked on are separate authored facts now
      // (§ 3a), so a scene stored before the cutover comes back fully walkable.
      unwalkable: scene?.layout?.unwalkable ?? [],
      forcedDirection: scene?.layout?.forcedDirection ?? {},
      // Read through `scenePlaces`, never `layout.places` directly — a scene stored before the
      // 2026-09-06 rename still carries `locations` (migration 163 is not on PPE yet).
      places: scenePlaces(scene?.layout),
    }),
    [scene],
  );

  const built = useMemo(
    () => (scene ? buildSceneBodies(scene, npcs, graph) : null),
    [scene, npcs, graph],
  );

  // Keyed on `built` (a memo of the scene), so unlike `bodiesRef` this is correct on the very
  // render that first sees the scene rather than one effect later.
  const speakerLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const [id, body] of built?.bodies ?? []) {
      if (body.label) labels[id] = body.label;
    }
    return labels;
  }, [built]);

  const actorsRef = useRef<SceneActorState[]>([]);
  const bodiesRef = useRef<Map<string, IWSceneBody>>(new Map());
  const companionIdRef = useRef<string | null>(null);
  useEffect(() => {
    actorsRef.current = built ? built.actors.map(a => ({ ...a })) : [];
    bodiesRef.current = built?.bodies ?? new Map();
    companionIdRef.current = built?.companionId ?? null;
  }, [built]);

  // ── React-visible state ─────────────────────────────────────────────────────────────────
  const [bubbles, setBubbles] = useState<IWBubble[]>([]);
  /**
   * A counter bumped by every bubble that reaches the screen — see {@link postBubble}.
   *
   * It exists for exactly one reader: `enqueueSayPlayer` waits before posting, and a wait is a
   * window in which somebody else can speak. Comparing the counter it captured against the
   * live one is how a held-back bubble knows it has been overtaken and must not paint over
   * whatever replaced it.
   */
  const bubbleSeqRef = useRef(0);
  const [banner, setBanner] = useState<string | null>(null);
  const [frozen, setFrozen] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [popup, setPopup] = useState<IWPopup | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);

  // § 5.3b. Seeded from the scene payload and grown by each turn's `segments` event. Keyed on
  // stable identity, NOT on the payload object — `authoredSegments` is a fresh object on every
  // render of the page, and keying on it would wipe the turn-supplied entries continuously.
  const [lineSegments, setLineSegments] = useState<Record<string, IWLineSegments>>({});
  // Read by `enqueueSayPlayer`, which is a `[]` callback and must not be rebuilt every time a
  // line is segmented — it only asks "have I already looked this line up?".
  const lineSegmentsRef = useRef(lineSegments);
  lineSegmentsRef.current = lineSegments;
  useEffect(() => {
    if (authoredSegments) setLineSegments(prev => ({ ...prev, ...authoredSegments }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene?.id]);

  const note = useCallback((who: string, reason: string) => {
    // Kept in state rather than only in the console because § 4 asks for an inspectable
    // answer to "why didn't he answer me" on day one, and a console line is not inspectable
    // on a phone.
    setNotes(prev => [...prev.slice(-40), `${who}: ${reason}`]);
  }, []);

  // ── Live refs the async machinery reads ─────────────────────────────────────────────────
  const sessionIdRef = useRef<string>(newSessionId());
  const cancelledRef = useRef(false);
  const frozenRef = useRef(false);
  /**
   * § 5.3c's reversible hold. A ref rather than state because every reader is either inside
   * an async chain or the frame clock, and neither should re-render to learn about it.
   */
  const pausedRef = useRef(false);
  /** Resolvers of everything currently parked at the hold. */
  const pauseWaitersRef = useRef<Array<() => void>>([]);
  const lastSendRef = useRef(0);
  /**
   * The scene transcript, WITH the audience of each line (§ 4c).
   *
   * ⚠️ **AN ENTRY IS A LINE PLUS WHO WAS THERE FOR IT, AND THAT PAIRING IS THE POINT.** This
   * used to be a flat `string[]` handed identically to every NPC, which is why the first
   * earshot model was withdrawn as theatre — a "deaf" NPC still knew verbatim what was said
   * out of its range. `audience: null` means everybody heard it (an NPC speaking; nothing
   * makes an NPC quiet). A set means only those ids did, and `contextFor` filters on it.
   */
  const heardRef = useRef<Array<{ line: string; audience: ReadonlySet<string> | null }>>([]);
  const lastSpeakerRef = useRef<string | null>(null);
  const firedCuesRef = useRef<string[]>([]);
  /** Conversations already overheard this run. Per-run, like `firedCuesRef` — see below. */
  const playedConversationsRef = useRef<Set<string>>(new Set());
  const timersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const popupResolveRef = useRef<(() => void) | null>(null);
  /** Resolvers waiting on an actor's walk to end. One per actor at most. */
  const arrivalsRef = useRef(new Map<string, (how: 'arrived' | 'blocked') => void>());
  /**
   * Serializes speech: two lines revealing at once is noise, so they queue.
   *
   * Still needed after § 4.2, and for a different reason than it was written for. A learner's
   * utterance now produces exactly ONE reply, so the chain no longer arbitrates between NPCs
   * — but an authored script or a conversation (§ 14 Q6, Q42) still emits several lines back
   * to back, and with one bubble on screen (§ 5.3a) an unqueued second line would replace the
   * first mid-reveal.
   */
  const speechChainRef = useRef<Promise<void>>(Promise.resolve());
  /** One running script per performer; starting a new one supersedes the old. */
  const scriptTokensRef = useRef(new Map<string, number>());
  /** The learner's vocabulary (§ 9.4). A ref: every reader of it is inside an async chain. */
  const knownWordsRef = useRef<string[]>([]);

  // Everything in flight is abandoned when the scene is left. Checked after every await.
  useEffect(() => {
    cancelledRef.current = false;
    const session = sessionIdRef.current;
    const timers = timersRef.current;
    // Captured, like `timers`, so the cleanup does not read a ref at teardown time. Both
    // queues are mutated in place (push/splice) and never reassigned, so the identity holds.
    const pauseWaiters = pauseWaitersRef.current;
    return () => {
      cancelledRef.current = true;
      timers.forEach(clearTimeout);
      timers.length = 0;
      // Release anything parked at § 5.3c's hold. A scene left while paused would otherwise
      // strand its promise chains forever; they resume, see `cancelledRef` and unwind.
      pausedRef.current = false;
      pauseWaiters.splice(0).forEach(resolve => resolve());
      // Release § 7's session counter. Fire-and-forget by design — a failure here leaks one
      // integer on the server and nothing the learner can see.
      endIwSession(session);
    };
  }, []);

  /**
   * Put one bubble on screen — the ONE bubble (§ 5.3a: a new line dismisses whatever was up,
   * whoever said it). Every speaker goes through here so `bubbleSeqRef` cannot miss one.
   */
  const postBubble = useCallback((bubble: IWBubble) => {
    bubbleSeqRef.current += 1;
    setBubbles([bubble]);
  }, []);

  /**
   * Await § 5.3c's hold. Resolves synchronously while the world is running, which is what
   * makes it cheap enough to sit in front of every spoken line and at the end of every sleep.
   */
  const whenResumed = useCallback(() => (
    pausedRef.current
      ? new Promise<void>(resolve => { pauseWaitersRef.current.push(resolve); })
      : Promise.resolve()
  ), []);

  const setPaused = useCallback((next: boolean) => {
    pausedRef.current = next;
    if (next) return;
    // Swap the queue out before draining it, so a resolver that parks again lands in a fresh
    // list instead of one being iterated.
    pauseWaitersRef.current.splice(0).forEach(resolve => resolve());
  }, []);

  /**
   * ⚠️ **A SLEEP DOES NOT END WHILE THE WORLD IS HELD.** The timer still runs — the hold is
   * not a pause of wall-clock time — but the sleeper is parked at the gate until the hold
   * lifts, so every self-paced thing built on it (the speech chain's dwell, a conversation's
   * gap between lines, an authored beat) resumes rather than firing into a covered screen.
   * The deadline races built on it (TTS, the turn route) inherit the same behaviour, which is
   * what we want: a deadline must not expire against a clock the learner is not watching.
   */
  const sleep = useCallback(async (ms: number): Promise<void> => {
    if (ms > 0) {
      await new Promise<void>(resolve => {
        const id = setTimeout(resolve, ms);
        timersRef.current.push(id);
      });
    }
    await whenResumed();
  }, [whenResumed]);

  // ── The frame clock ─────────────────────────────────────────────────────────────────────
  const tick = useCallback((dtMs: number) => {
    // § 5.3c: a held world does not walk. Bodies keep their idle bob (that is `drawables`,
    // which paints from the wall clock) — what stops is anything that CHANGES the scene, so
    // an NPC mid-walk is still mid-walk when the learner comes back.
    if (pausedRef.current) return;
    const { actors, events } = tickSceneActors(actorsRef.current, dtMs, graph);
    actorsRef.current = actors;
    for (const { id, event } of events) {
      if (event.kind === 'none') continue;
      const resolve = arrivalsRef.current.get(id);
      if (!resolve) continue;
      arrivalsRef.current.delete(id);
      resolve(event.kind === 'arrived' ? 'arrived' : 'blocked');
    }
  }, [graph]);

  const drawables = useCallback((nowMs: number): IWBodyDrawable[] =>
    actorsRef.current
      .map(actor => {
        const body = bodiesRef.current.get(actor.id);
        return body ? bodyDrawable(actor, body, nowMs) : null;
      })
      .filter((d): d is IWBodyDrawable => d !== null),
  []);

  // ── Movement ────────────────────────────────────────────────────────────────────────────
  const actorById = (id: string) => actorsRef.current.find(a => a.id === id);

  /**
   * Send a body to a cell and resolve when it gets there.
   *
   * Resolves `blocked` rather than rejecting when no path exists, because "cannot get there"
   * is an ordinary outcome a script has to continue past (`iwScript.ts`).
   */
  const walk = useCallback((actorId: string, cell: string): Promise<'arrived' | 'blocked'> => {
    const actor = actorById(actorId);
    if (!actor) return Promise.resolve('blocked');
    if (actor.cell === cell) return Promise.resolve('arrived');
    const occupied = occupiedCells(actorsRef.current, actorId);
    const path = planScenePath(graph, actor.cell, cell, { occupied });
    if (!path) return Promise.resolve('blocked');

    actorsRef.current = actorsRef.current.map(a => (a.id === actorId ? setActorPath(a, path) : a));
    return new Promise(resolve => {
      // A previous walk for the same body is superseded, not left dangling — otherwise a
      // re-plan mid-walk would leave a script awaiting an arrival that never fires.
      arrivalsRef.current.get(actorId)?.('blocked');
      arrivalsRef.current.set(actorId, resolve);
    });
  }, [graph]);

  const face = useCallback((actorId: string, cell: string) => {
    const actor = actorById(actorId);
    if (!actor) return;
    // A body STANDING on a forced-direction cell does not turn — the tile owns its facing
    // until it steps off (§ 3a). Guarded here as well as re-asserted in `tickSceneActor` so
    // the turn never renders at all: the tick would undo it a frame later, which is a visible
    // twitch rather than a rule.
    if (forcedFacingFor(graph, actor)) return;
    const facing = facingForStep(actor.cell, cell);
    if (!facing) return;
    actorsRef.current = actorsRef.current.map(a => (a.id === actorId ? { ...a, facing } : a));
  }, [graph]);

  /**
   * Walk the learner to a cell BESIDE something, then turn to look at it.
   *
   * ⚠️ **TAPPING ANYTHING MEANS "GO THERE", NOT "AIM AT IT".** Used by all three tap targets —
   * a person, a place, and (since 2026-09-07) a tile the learner cannot stand on. Tapping used to
   * turn the player on the spot and nothing else, which read as the tap being ignored
   * whenever the target was across the room — the learner was left addressing somebody they
   * had never approached. (Until 2026-09-07 that was worse than cosmetic: § 4's hearing gate
   * would then refuse the utterance outright, for a distance the UI had given them no way to
   * notice they still had. The gate is gone; walking to what you tapped is still right,
   * because it is what makes the NEAREST body — the one marked `addressed` — the one you
   * meant.)
   *
   * `targetCell` is a FUNCTION, not a string, and that is the point: it is read twice. Once
   * up front, to turn toward the target immediately so the tap is acknowledged before any
   * walking happens; once on arrival, because both ends can have moved by then — an NPC
   * target is a body that walks, and a blocked walk leaves the player short of where it was
   * aiming. A single up-front cell would leave the player staring at the empty tile somebody
   * was standing on when they were tapped.
   *
   * A place is normally unwalkable (a counter, a water station), which is exactly what
   * `approachCells` is for: it returns the walkable NEIGHBOURS of the target, nearest first,
   * and includes the player's own cell when they are already beside it — so tapping somebody
   * you are already standing next to re-faces without a redundant step.
   */
  const approachAndFace = useCallback(async (targetCell: () => string | null): Promise<void> => {
    const player = actorById(IW_ACTOR_PLAYER);
    const first = targetCell();
    if (!player || !first) return;

    face(IW_ACTOR_PLAYER, first);

    const occupied = occupiedCells(actorsRef.current, IW_ACTOR_PLAYER);
    const [approach] = approachCells(graph, player.cell, first, { occupied });
    if (approach && approach !== player.cell) {
      const how = await walk(IW_ACTOR_PLAYER, approach);
      if (cancelledRef.current) return;
      if (how === 'blocked') note('world', 'could not get any closer to that');
    }

    const after = targetCell();
    if (after) face(IW_ACTOR_PLAYER, after);
  }, [graph, face, walk, note]);

  /**
   * Tap-to-move (§ 14 Q18), with the near-miss tolerance that decision made load-bearing.
   *
   * An isometric tile is a small target on a phone and a tap that silently does nothing reads
   * as a broken game — so a tap on an unwalkable or unreachable cell walks to the nearest
   * cell BESIDE it rather than being dropped, and then TURNS TO FACE it: stopping beside a
   * table with your back to it looks like the walk went somewhere else, rather than like the
   * board refusing to let you stand on a table.
   */
  const walkPlayerTo = useCallback((col: number, row: number) => {
    const target = cellKey(col, row);
    const player = actorById(IW_ACTOR_PLAYER);
    if (!player) return;
    const occupied = occupiedCells(actorsRef.current, IW_ACTOR_PLAYER);

    // Reachable: stand on it. There is nothing to turn toward — you are there.
    if (graph.walkable.has(target) && !occupied.has(target)) {
      void walk(IW_ACTOR_PLAYER, target);
      return;
    }

    // ⚠️ **AN UNREACHABLE TILE IS STILL AIMED AT, SO IT IS STILL FACED.** Blocking decor, or
    // somebody already standing there. The near-miss walk alone left the learner beside the
    // thing they had pointed at with their back to it half the time — which reads as the walk
    // having gone somewhere else, not as "this is as close as you get". `approachAndFace` is
    // the same path a tapped body or place takes, so all three tap targets end the same way:
    // as close as the board allows, looking at what was tapped.
    void approachAndFace(() => target);
  }, [graph, walk, approachAndFace]);

  // ── Speech ──────────────────────────────────────────────────────────────────────────────

  const labelFor = useCallback((actorId: string): string => (
    actorId === IW_ACTOR_PLAYER ? PLAYER_LABEL : bodiesRef.current.get(actorId)?.label ?? actorId
  ), []);

  /**
   * Which TTS voice speaks for this body (§ 6.4a).
   *
   * Read from the body's `avatar` — the SAME field that picks its sprite — rather than from a
   * second voice field on the NPC, so a character cannot end up drawn as a man and voiced as a
   * woman. It is per-gender today; when a per-NPC voice arrives it is this function that maps
   * `actorId` to it, and every call site above stays as it is.
   *
   * An unknown id falls back to the language's default voice rather than guessing a gender:
   * the body is missing, so there is nothing to be consistent with.
   */
  const voiceFor = useCallback((actorId: string): TTSVoice => {
    const avatar = bodiesRef.current.get(actorId)?.avatar;
    return avatar === 'male' ? 'male' : avatar === 'female' ? 'female' : 'default';
  }, []);

  /**
   * Show and speak one line, resolving when its bubble has finished revealing.
   *
   * The ordering is § 6.4's contract, in order: guard (which is § 5.3a's sanitize step) →
   * synthesize → decode → paint in step with playback. A line that fails the guard produces
   * NO bubble and no sound; the NPC's action and emote still play, which is § 4.1's
   * non-verbal channel rather than an error state.
   */
  const sayLine = useCallback(async (actorId: string, raw: string, emote: IWEmote = IW_DEFAULT_EMOTE) => {
    // § 5.3c: the line waits for the hold BEFORE the synth call, not after. Gating any later
    // would voice a line whose bubble is behind the sheet — audio with nothing to read, which
    // is the one failure the audio-as-clock design (§ 6.4) cannot recover from.
    await whenResumed();
    if (cancelledRef.current) return;
    const language = scene?.language ?? 'zh';
    const verdict = guardNpcLine(raw, language);
    if (!verdict.ok) {
      // A silenced line leaves NO bubble, so without this the line simply never appears and
      // there is nothing anywhere saying why. `iwWarn`, not `iwLog`: the guard firing is
      // always worth seeing, debug flag or not.
      iwWarn('dialogue', `${labelFor(actorId)} (${actorId}) SILENCED — ${verdict.reason}`, { raw });
      note(actorId, `line silenced — ${verdict.reason}`);
      return;
    }
    const text = verdict.text;

    // § 6.4 rule 4: race the synth against a deadline. A late answer is DROPPED — the audio
    // is never started after the reveal has begun, or the two would be out of step, which is
    // the whole thing audio-as-clock exists to prevent.
    //
    // The race carries a SENTINEL rather than collapsing to null, because losing the deadline
    // and having no audio at all are the same outcome for the reveal and completely different
    // faults to chase: a line that is mute because autoplay is off is a setting, one that is
    // mute because a cold synth took 401 ms is a tuning problem. Only the log can tell them
    // apart, and a silent NPC is exactly the symptom nobody can debug from the screen.
    // ⚠️ ONE voice resolved for the whole line, and passed to BOTH the prepare below and the
    // playback further down. The voice is part of the TTS cache key, so resolving it twice —
    // or forgetting it on one of the two — would time the reveal against a clip other than the
    // one that plays (§ 6.4).
    const voice = voiceFor(actorId);

    const raced = await Promise.race<number | null | typeof TTS_TIMED_OUT>([
      tts.prepareSentence(text, undefined, voice),
      sleep(TTS_DEADLINE_MS).then(() => TTS_TIMED_OUT),
    ]);
    if (cancelledRef.current) return;
    const timedOut = raced === TTS_TIMED_OUT;
    const duration = timedOut ? null : raced;
    if (duration === null) {
      // Always-on: this is the "he replied but said nothing" report, and it is invisible on
      // screen — the reveal looks identical either way, which is § 5.3a working as intended.
      iwWarn('dialogue', `${labelFor(actorId)} (${actorId}) has NO AUDIO — revealing on the fallback cadence`, {
        reason: timedOut
          ? `the synth did not answer within TTS_DEADLINE_MS (${TTS_DEADLINE_MS}ms) — a late clip is dropped, not played`
          : 'prepareSentence returned null — autoplay is off, or cloud TTS failed',
        text,
      });
    }

    // § 5.3c, the second gate. The hold can be taken DURING the synth race (the learner taps
    // a word in the line already on screen while the next one is being prepared), and the
    // race itself cannot be held — `prepareSentence` is not ours to pause. So the clip is
    // decoded and then parked: on resume, playback and the reveal still start together, which
    // is the only thing § 6.4 requires of them.
    await whenResumed();
    if (cancelledRef.current) return;

    const schedule = planGlyphReveal(text, duration ?? undefined);
    if (duration !== null) {
      // autoSpeakSentence, never speakSentence: an NPC talking is AUTOMATIC narration and
      // Mute must silence it (§ 6.4 rule 6). The clip is already decoded, so this starts now.
      void tts.autoSpeakSentence(text, undefined, voice);
    }

    // The single chokepoint every spoken line passes through — an NPC's reply, the companion's,
    // and an authored `comment` step alike — so one `iw:dialogue` filter is the whole
    // conversation in order. The player's own line is logged in `say` for the same reason.
    iwLog('dialogue', `${labelFor(actorId)} (${actorId}): ${text}`, {
      emote,
      voice,
      audio: duration !== null
        ? `${Math.round(duration)}ms`
        : `none — ${timedOut ? 'synth missed the deadline' : 'autoplay off or synth failed'}`,
    });

    const startedAt = performance.now();
    // ⚠️ **ONE BUBBLE ON SCREEN, FULL STOP** (§ 5.3a, 2026-09-07). Not one per body — one.
    // A new line dismisses whatever was up, whoever said it. This replaced a same-day rule
    // that kept the last line from EACH speaker until the learner spoke; that was defensible
    // while several NPCs could answer at once, and became clutter the moment § 4.2 made a
    // scene a two-party conversation. What is on screen is now, always, the most recent thing
    // anybody said — which is the only thing a reader needs, and it makes "who is talking"
    // unambiguous without a single line of layout code.
    // `replayable: true` UNCONDITIONALLY, even when `duration === null` (mute, autoplay off,
    // or a synth that missed the deadline). The button calls `speakSentence`, the deliberate
    // path, which speaks in every mode — so a muted learner who wants to hear one line taps it
    // and hears it, without cycling the header chip and losing the line to the next turn.
    postBubble({ actorId, text, schedule, startedAt, emote, replayable: true });
    // An NPC's line has no volume: everybody present hears it. Only the LEARNER can whisper,
    // because only the learner has a control for it (§ 4c) — an NPC choosing to speak quietly
    // would be a second, invisible hearing model, which is the thing § 4 threw out.
    heardRef.current = [...heardRef.current, { line: `${labelFor(actorId)}: ${text}`, audience: null }].slice(-HEARD_WINDOW);
    lastSpeakerRef.current = actorId;

    // ⚠️ THE DWELL PACES THE QUEUE; IT NO LONGER DISMISSES THE BUBBLE. `enqueueSay` chains on
    // this promise, so the wait is what stops the next speaker from starting before this line
    // has been read — dropping it would blank a line mid-reveal (§ 5.3a). What changed
    // is what happens at the end: nothing. An NPC's line now STAYS UP until the learner
    // speaks (see `enqueueSayPlayer`), because a bubble that expires on a timer punishes
    // exactly the learner this is for — the one still reading it.
    const revealMs = schedule[schedule.length - 1] ?? 0;
    await sleep(revealMs + BUBBLE_DWELL_BASE_MS + text.length * BUBBLE_DWELL_PER_GLYPH_MS);
  }, [scene, tts, sleep, note, labelFor, voiceFor, postBubble, whenResumed]);

  /** Queue a line behind whatever is already being said, so two NPCs never overlap. */
  const enqueueSay = useCallback((actorId: string, text: string, emote?: IWEmote): Promise<void> => {
    const next = speechChainRef.current.then(() => sayLine(actorId, text, emote));
    // The chain must survive a failed link, or one thrown error silences the scene forever.
    speechChainRef.current = next.catch(() => {});
    return next;
  }, [sayLine]);

  /**
   * What one NPC perceives, independent of what prompted them to speak.
   *
   * Shared by a TURN and by a LINE RENDER (§ 14 Q42) because both must see the same world:
   * an NPC whose memory differed between answering the learner and delivering a scripted
   * beat would contradict itself within one exchange. The server splits the same shape the
   * same way (`turnState.IWContextInput`).
   */
  const contextFor = useCallback((npcId: string) => {
    const self = actorById(npcId);
    const selfCell = self ? parseCellKey(self.cell) : null;
    const nearby = actorsRef.current
      .filter(a => a.id !== npcId)
      .map(a => {
        const cell = parseCellKey(a.cell);
        if (!cell || !selfCell) return null;
        return {
          label: labelFor(a.id),
          distance: chebyshev(selfCell, cell),
          // An approximation, and knowingly so: it asks whether the other body's facing points
          // roughly at this NPC. It is prompt COLOUR (§ 4.1's turn-taking pressure), not a
          // rule anything is enforced against, so being off by a quadrant costs nothing.
          facingYou: facesToward(a.facing, cell, selfCell),
        };
      })
      .filter((n): n is { label: string; distance: number; facingYou: boolean } => n !== null)
      .sort((a, b) => a.distance - b.distance);

    // ⚠️ **THE MEMORY GATE** (§ 4c). An NPC's transcript is what THAT NPC could hear, which is
    // the half the withdrawn earshot model never had. A line whispered across the table is
    // absent from this list for everybody but its one listener, so it cannot resurface three
    // turns later out of somebody who was not there.
    const heard = heardRef.current
      .filter(e => e.audience === null || e.audience.has(npcId))
      .map(e => e.line);
    return { knownWords: [...knownWordsRef.current], nearby, heard };
  }, [labelFor]);

  /**
   * Put one AUTHORED DIRECTION into an NPC's own words (§ 14 Q42).
   *
   * ⚠️ **THIS IS THE WHOLE REASON AN AUTHORED SCRIPT IS NO LONGER SPOKEN AS WRITTEN.** The
   * scene stores an intention — "tell them the fish is finished" — and the model turns it
   * into Chinese in this character's register, given this character's memory of what has just
   * been said to them. What the author wrote never reaches the learner.
   *
   * ⚠️ **AN ABSENT `direction` IS A CUE, NOT A MISSING VALUE** (2026-09-19). It is what a
   * `prompt_npc` step with no brief sends: *say whatever this moment calls for*, answered out
   * of the same perception any other render gets. Likewise an absent `towardActorId` asks the
   * NPC to pick whom it is talking to rather than aiming the line at the room.
   *
   * ⚠️ **`null` MEANS SKIP THE BEAT, NEVER "SPEAK THE DIRECTION".** Every failure — the
   * ladder, the transport, the daily cap, leaving the scene — comes back as null, and the
   * caller's only correct response is to move on. Falling back to the authored text would put
   * English prose about the NPC on screen, which is the bug this replaced.
   */
  const renderLine = useCallback(async (
    npcId: string, direction?: string, towardActorId?: string,
  ): Promise<string | null> => {
    if (!scene?.id || cancelledRef.current) return null;
    const outcome = await renderNpcLine({
      sceneId: scene.id,
      sessionId: sessionIdRef.current,
      npcId,
      direction,
      // ⚠️ `labelFor`, NOT `speakerLabels` — the prompt's audience is the NPC, for whom the
      // learner is `the customer` (§ 14 Q27) rather than whatever the stage prints over their
      // head. The mapping lives here because this hook is the only place that knows both
      // vocabularies; a script passes ids and never has to know which name a model sees.
      toward: towardActorId ? labelFor(towardActorId) : undefined,
      perception: contextFor(npcId),
    }, {
      // Identical to the turn path (§ 5.3b) — an authored beat must be as tappable as an
      // improvised one, or it becomes the one line in the scene nobody can look up.
      onSegments: line => {
        if (cancelledRef.current) return;
        setLineSegments(prev => ({ ...prev, [line.foreignText]: line }));
      },
    });
    if (cancelledRef.current) return null;
    if (outcome.kind !== 'line') {
      note(npcId, `authored line skipped — ${outcome.reason}`);
      return null;
    }
    return outcome.say;
  }, [scene?.id, contextFor, note, labelFor]);

  // ── Authored scripts ────────────────────────────────────────────────────────────────────

  /** The world as one performer sees it, for `resolveActionStep`. */
  const worldFor = useCallback((actorId: string): ActionWorld => ({
    graph,
    selfCell: actorById(actorId)?.cell ?? '0,0',
    cells: actorCells(actorsRef.current, companionIdRef.current),
    occupied: occupiedCells(actorsRef.current, actorId),
    conversations: scene?.conversations ?? [],
    eventIds: (scene?.events ?? []).map(e => e.id),
  }), [graph, scene]);

  /** Arm an authored event (migration 161) — an EARLIEST, not an exactly-when. */
  const armEvent = useCallback((eventId: string, ms: number) => {
    const event = (scene?.events ?? []).find(e => e.id === eventId);
    if (!event) return;
    const id = setTimeout(() => {
      if (cancelledRef.current) return;
      // Phase 2 records the cue (which unlocks anything gated on it — § 5.4b's `unlockedBy`)
      // and shows the fact. Having the cast REACT to it in character is a turn per audible
      // NPC and belongs with the complication draw in phase 3.
      firedCuesRef.current = [...firedCuesRef.current, eventId];
      setBanner(event.description);
    }, ms);
    timersRef.current.push(id);
  }, [scene]);

  const playConversation = useCallback(async (conversationId: string) => {
    const conversation = (scene?.conversations ?? []).find(c => c.id === conversationId);
    if (!conversation) return;

    // ⚠️ **ONCE PER RUN, AND THIS IS THE ONLY PLACE THAT CAN GUARANTEE IT** (2026-09-07).
    // `turnOffers` stops the MODEL choosing a spent conversation, but three other paths reach
    // here — an authored action's `start_conversation` step, a place interaction's, and a
    // script the model started before this one finished — and none of them consults an offer
    // list. A fixed exchange replayed is the seam that tells a learner they are in a loop, so
    // the guarantee has to sit at the playback door rather than at one of the four entrances.
    if (playedConversationsRef.current.has(conversationId)) {
      note('world', `conversation ${conversationId} already happened — skipped`);
      return;
    }
    // Marked BEFORE the first line, not after the last. A conversation takes seconds to play
    // and a second trigger can arrive inside that window; marking on completion would let two
    // copies interleave, which is worse than either playing twice.
    playedConversationsRef.current = new Set(playedConversationsRef.current).add(conversationId);

    const turns = conversation.turns ?? [];
    for (let i = 0; i < turns.length; i++) {
      if (cancelledRef.current) return;
      const turn = turns[i];
      // ⚠️ **A CONVERSATION TURN IS A DIRECTION TOO** (§ 14 Q42, § 14 Q6). Q6 originally had
      // authored exchanges "played back with no model calls" — the cheap half of the feature.
      // That is no longer true, and it could not stay true once comments became directions:
      // an NPC-to-NPC exchange spoken verbatim beside a comment spoken in character would be
      // two different registers in the same scene, from the same mouths.
      //
      // Rendered one at a time, in order, so turn 2 is written knowing what turn 1 actually
      // said — the whole point of putting a conversation through the model rather than a
      // template. The line is added to `heard` by `sayLine`, so the next render sees it.
      const say = await renderLine(turn.npcId, turn.text);
      if (cancelledRef.current) return;
      // A beat that could not be rendered is SKIPPED, never spoken as written.
      if (say) await enqueueSay(turn.npcId, say);
      await sleep(Math.max(0, IW_CONVERSATION_LINE_MS - 3000));
    }
  }, [scene, enqueueSay, renderLine, sleep, note]);

  const scriptDeps = useCallback((token: number, actorId: string): IWScriptDeps => ({
    worldFor,
    walk,
    face,
    say: (who, text) => enqueueSay(who, text),
    renderLine,
    playConversation,
    armEvent,
    wait: sleep,
    note,
    cancelled: () => cancelledRef.current || scriptTokensRef.current.get(actorId) !== token,
  }), [worldFor, walk, face, enqueueSay, renderLine, playConversation, armEvent, sleep, note]);

  /**
   * Perform one of an NPC's authored actions.
   *
   * Starting a second action for the same body SUPERSEDES the first: an NPC halfway through
   * "bring water" who is asked to do something else stops carrying the water. That is the
   * honest behaviour — the alternative is a queue that makes an NPC finish a beat the world
   * has moved past.
   */
  const performNpcAction = useCallback(async (npcId: string, actionId: string) => {
    const member = (scene?.npcCast ?? []).find(m => m.npcId === npcId);
    const action = actionById(member, actionId);
    if (!action) { note(npcId, `no authored action "${actionId}"`); return; }
    const token = (scriptTokensRef.current.get(npcId) ?? 0) + 1;
    scriptTokensRef.current.set(npcId, token);
    await runAuthoredAction(npcId, action.steps ?? [], scriptDeps(token, npcId));
  }, [scene, scriptDeps, note]);

  // ── Place interactions (§ 14 Q43) ───────────────────────────────────────────────────────
  const showPopup = useCallback((imageId: string, caption?: string) => new Promise<void>(resolve => {
    setPopup({ imageId, caption });
    popupResolveRef.current = resolve;
  }), []);

  const dismissPopup = useCallback(() => {
    setPopup(null);
    popupResolveRef.current?.();
    popupResolveRef.current = null;
  }, []);

  const runPlaceInteraction = useCallback(async (tag: string) => {
    const steps = scene?.interactions?.[tag];
    if (!steps?.length) return;
    iwLog('tap', `place "${tag}" — approaching`, { cell: graph.places.get(tag) });
    // Walk over before the script runs. An authored interaction describes what happens once
    // the learner is AT the thing ("you pick up the cup"), so running it from across the room
    // was describing an action the body on screen never performed. A place's cell is fixed,
    // so the getter is constant — unlike a body's.
    const cell = graph.places.get(tag);
    if (cell) await approachAndFace(() => cell);
    if (cancelledRef.current) return;
    const token = (scriptTokensRef.current.get('world') ?? 0) + 1;
    scriptTokensRef.current.set('world', token);
    await runInteraction(steps, {
      ...scriptDeps(token, 'world'),
      showPopup,
      performNpcAction,
    });
  }, [scene, graph, approachAndFace, scriptDeps, showPopup, performNpcAction]);

  // ── The turn (§ 4.1, § 4.2) ─────────────────────────────────────────────────────────────

  /**
   * Everyone who could be the one being spoken to at this VOLUME — nearest first, capped
   * (§ 4c, § 4.2, § 7). Exactly one of them is then chosen, by the router or by the rules.
   *
   * ⚠️ **EARSHOT WAS DELETED AND REBUILT ON THE SAME DAY, AND THE DIFFERENCE IS WHO DECIDES.**
   * The withdrawn version ran an automatic geometry gate — per-volume radii nobody chose, plus
   * an occlusion walk — and it failed on three counts:
   *
   * 1. **It never gated MEMORY, only replies.** The transcript was one shared list handed
   *    identically to every NPC, so a "deaf" NPC already knew verbatim what was said out of
   *    its range. The gate was not modelling ignorance; it was withholding a reply from
   *    somebody who already knew.
   * 2. **Its failure was invisible.** Silence is what an NPC choosing not to speak looks like
   *    too (§ 4.1), so "he is four tiles away with a stand between you" and "he decided you
   *    were not talking to him" were the same picture.
   * 3. **A scene is small**, so the geometry was almost always trivially satisfied — paying
   *    for a model of distance in a space with no distance in it.
   *
   * The volume toggle answers all three. It gates memory (`heardRef` entries now carry their
   * audience, and `contextFor` filters on it); its failure is legible, because the learner set
   * the range one press ago and the banner names it; and it is not a simulation of distance at
   * all but an INTENTION — whispering to one person at a table of four is something a learner
   * MEANS, which is worth having even in a room where everybody could hear everything.
   * Occlusion did not come back, and will not: see `play/hearing.ts`.
   *
   * ⚠️ **THERE IS NO FAN-OUT ANY MORE EITHER** (§ 4.2, same day). For a few hours between the
   * two changes this list WAS the spend — every body in it was a model call — which is what
   * made § 4.1's over-eagerness both loud and expensive at once. Routing to a single addressee
   * fixed the cost as a side effect: an utterance is **one call**, whatever the cast size.
   * {@link IW_MAX_LISTENERS_PER_UTTERANCE} therefore no longer bounds anything on this path
   * and is kept only as the server's cap on the `nearby` block it also feeds.
   *
   * Distance survives as the ordering: `chooseAddressee`'s last-resort rule takes the first
   * entry, so "nearest" has to mean the front of this list.
   */
  const audienceFor = useCallback((
    self: { cell: string; facing: string },
    volume: IWVolume,
  ): AddresseeOption[] => {
    const from = parseCellKey(self.cell);
    if (!from) return [];
    const facing = self.facing as IWFacing;
    return actorsRef.current
      .filter(a => a.id !== IW_ACTOR_PLAYER)
      .map(a => {
        const cell = parseCellKey(a.cell);
        if (!cell) return null;
        // ⚠️ **THE HEARING GATE IS BACK, AS A CHOICE** (§ 4c). It bounds the ROUTER's
        // candidate list, so a whisper cannot be answered by somebody across the room however
        // the router reads the sentence — and it bounds the transcript the same way, in
        // `say`, so the same body cannot quote it later either.
        if (!hears(volume, from, facing, cell)) return null;
        return {
          id: a.id,
          label: labelFor(a.id),
          distance: chebyshev(from, cell),
          // Both directions, measured the same coarse way `contextFor` measures it — the
          // avatar's own facing is the learner's most deliberate physical statement about who
          // they mean, and it is the one signal that says "not you" about somebody standing
          // just as close. It is a HINT, never a gate: turning away from a person does not
          // stop you calling them by name (see `chooseAddressee` rung 1 and the router's
          // "a name beats every other signal").
          facedByLearner: facesToward(self.facing, from, cell),
          facingLearner: facesToward(a.facing, cell, from),
        };
      })
      .filter((l): l is AddresseeOption => l !== null)
      // Nearest first — `chooseAddressee`'s last-resort rule reads this order, and it is the
      // order the cap drops from.
      .sort((a, b) => a.distance - b.distance)
      .slice(0, IW_MAX_LISTENERS_PER_UTTERANCE);
  }, [labelFor]);

  /** What one NPC perceives, for layer 3 of their prompt. */
  const perceptionFor = useCallback((npcId: string, addressed: boolean, text: string, volume: IWVolume): IWPerception => ({
    ...contextFor(npcId),
    // The volume reaches layer 3 as a FACT about the line, beside `addressed` (§ 5.5). It is
    // not another rule for the model to obey — the gate already happened, in `audienceFor` —
    // but somebody who was whispered to should answer like somebody who was whispered to, and
    // an NPC who was shouted at across a room knows why they were shouted at.
    event: { kind: 'utterance', speaker: PLAYER_LABEL, text, addressed, volume },
    spokeLastTurn: lastSpeakerRef.current === npcId,
  }), [contextFor]);

  const setKnownWords = useCallback((words: string[]) => { knownWordsRef.current = words; }, []);

  /** Handle one NPC's answer: speak it, then perform whatever it chose to do. */
  const applyReply = useCallback(async (npcId: string, reply: { say: string; emote: IWEmote; chosen: { id: string; kind: string } | null }) => {
    if (reply.say) await enqueueSay(npcId, reply.say, reply.emote);
    if (!reply.chosen) return;
    if (reply.chosen.kind === 'conversation') await playConversation(reply.chosen.id);
    else await performNpcAction(npcId, reply.chosen.id);
  }, [enqueueSay, playConversation, performNpcAction]);

  /**
   * The learner's bubble: same pacing, no audio (they said it themselves).
   *
   * ⚠️ **NOTHING EXPIRES ON A TIMER — A BUBBLE IS REPLACED, NEVER RETIRED** (§ 5.3a). Whatever
   * was last said stays legible until something else is said, by anybody. That is what makes
   * this safe for the learner who is still reading: the only thing that can take a line away
   * is a newer line, and a newer line is worth more than the one it covers.
   *
   * This used to be the ONE thing that cleared the board, back when NPC lines accumulated one
   * per speaker; `sayLine` now replaces the single bubble the same way, so the learner's turn
   * is no longer a special case. Their own words still go up un-spoken, because once the
   * composer clears it is the only record of what they typed — and reading it back is half of
   * noticing a typo.
   */
  const enqueueSayPlayer = useCallback((text: string) => {
    // Captured BEFORE the wait below. If anybody else speaks while the lookup is in flight,
    // this line has been overtaken and must not paint over what replaced it.
    const seq = bubbleSeqRef.current;
    const show = () => {
      if (cancelledRef.current || bubbleSeqRef.current !== seq) return;
      // § 5.3c: held, this bubble would go up behind the sheet and be the line the learner
      // returns to instead of the one they were reading. Re-checks the sequence on resume for
      // the same reason it does here — a hold is another window in which somebody can speak.
      if (pausedRef.current) { void whenResumed().then(show); return; }
      // `startedAt` is read here, not at Say: the reveal must be timed from when the bubble
      // is actually on screen, or the hold would be spent revealing glyphs nobody can see.
      postBubble({
        actorId: IW_ACTOR_PLAYER,
        text,
        schedule: planGlyphReveal(text, 1),
        startedAt: performance.now(),
        emote: IW_DEFAULT_EMOTE,
        // The learner's own words: no speaker button. They just said it.
        replayable: false,
      });
    };

    // § 5.3b for the learner's own words. Looked up here rather than on the turn stream
    // because this bubble is replaced by the reply — segmentation that waited for the turn
    // would describe a bubble that had already gone — and because a line nobody was addressed
    // by takes no turn at all.
    if (lineSegmentsRef.current[text]) { show(); return; }

    const pending = segmentUtterance(text);
    // Registered first, so that when the lookup wins the race the segments are in state by the
    // time the bubble is posted — the two land in ONE render, which is the whole point of the
    // hold. Kept separate from `show` so a LATE answer still upgrades the bubble in place, the
    // way it did before the hold existed.
    void pending.then(line => {
      if (!line || cancelledRef.current) return;
      setLineSegments(prev => ({ ...prev, [line.foreignText]: line }));
    });
    // ⚠️ A DEADLINE, NOT A WAIT (see `IW_PLAYER_SEGMENT_HOLD_MS`). The learner's sentence goes
    // up either way; only the pinyin is contingent on the dictionary answering in time.
    void Promise.race([pending, sleep(IW_PLAYER_SEGMENT_HOLD_MS)]).then(show);
  }, [postBubble, sleep, whenResumed]);

  const say = useCallback((raw: string, volume: IWVolume = 'talk') => {
    const text = raw.trim();
    if (!text || frozenRef.current || cancelledRef.current) return;
    const now = Date.now();
    // The client half of § 7's rate limit. Enforced here too so the learner is stopped by a
    // disabled button rather than by a refusal that reads as the game losing their sentence.
    if (now - lastSendRef.current < IW_MIN_TURN_GAP_MS) return;
    lastSendRef.current = now;

    const player = actorById(IW_ACTOR_PLAYER);
    if (!player) return;
    const audience = audienceFor(player, volume);
    // ⚠️ THE TRANSCRIPT REMEMBERS WHO WAS THERE (§ 4c). The audience is stored beside the
    // line, so an NPC that could not hear it never sees it — not on this turn and not on any
    // later one. Storing it here rather than at read time is what makes the gate durable:
    // the cast moves, and "who could hear it" is a fact about the moment it was said.
    const audible = new Set(audience.map(l => l.id));
    heardRef.current = [...heardRef.current, { line: `${PLAYER_LABEL}: ${text}`, audience: audible }].slice(-HEARD_WINDOW);
    // Logged BEFORE the routing decision, so a line nobody answered still shows up in the
    // transcript — "I said it and got nothing" is exactly the case worth reading back.
    iwLog('dialogue', `${PLAYER_LABEL} (${IW_ACTOR_PLAYER}) [${volume}]: ${text}`, {
      playerCell: player.cell, facing: player.facing, volume, cast: audience.map(l => l.id),
    });
    // The learner's own line goes in a bubble too, un-spoken: it is the only record of what
    // they just said once the composer clears, and reading it back is half of noticing a typo.
    void enqueueSayPlayer(text);

    // ⚠️ **AND HERE IS WHY THE VOLUME HAD TO COME WITH ITS OWN COPY** (§ 4c). This branch has
    // three quite different meanings now, and telling a learner the wrong one sends them
    // hunting: an empty scene is an authoring mistake, a whisper with nobody in front of them
    // is a step away from being fixed, and a normal voice out of range means walk over. The
    // withdrawn earshot model had one line for all of it, which is half of why its failures
    // read as bugs.
    if (audience.length === 0) {
      iwLog('turn', `no audience at ${volume}`, { playerCell: player.cell, facing: player.facing, volume });
      const cast = actorsRef.current.filter(a => a.id !== IW_ACTOR_PLAYER).length;
      const why = cast === 0
        ? 'there is nobody here to hear that'
        : volume === 'whisper'
          ? 'nobody is standing where a whisper would reach'
          : 'nobody is close enough to hear that';
      note('world', why);
      setBanner(cast === 0
        ? 'There is nobody here to talk to.'
        : volume === 'whisper'
          ? 'A whisper only reaches whoever you are standing in front of.'
          : 'Nobody is close enough. Walk over, or shout.');
      return;
    }

    // ⚠️ **EXACTLY ONE NPC IS ASKED, AND THE ENGINE PICKS THEM** (§ 4.2, 2026-09-07). This
    // used to fan out to every listener in parallel and let each decide for itself whether to
    // answer (§ 4.1). Two and three of them answered the same question, which is unreadable —
    // and unfixable from the prompt, because `addressed` was already being sent as a fact and
    // was already being overridden. Not calling somebody is the only reliable way to stop them
    // speaking.
    //
    // The rules are computed HERE, before the await, and for a reason: they read `focusedId`
    // and `lastSpeakerRef` as they were when the learner pressed send. Deriving them after the
    // router returns would let a mid-flight NPC line move the fallback out from under the
    // sentence it belongs to.
    const fallback = chooseAddressee(text, audience, {
      focusedId,
      lastSpeakerId: lastSpeakerRef.current,
      language: scene?.language ?? 'zh',
    });
    if (!fallback) return;
    setSending(true);

    const runTurn = async () => {
      // ⚠️ **THE MODEL ROUTES; THE RULES CATCH IT** (§ 4.2). `chooseAddressee` was the whole
      // decision for a few hours and could not survive the real question — a learner names a
      // person by ROLE (服务员), by trade (卖面的), by age (大爷), by what they are doing, by
      // who they are to somebody else. Each needs a different fact off the character sheet,
      // and a rule ladder can hold a list of titles but not a cast of biographies.
      //
      // So the model reads the room and the rules stand behind it. The race below is what
      // makes that affordable: § 6 says latency is the constraint, and an unbounded second
      // serial call would spend the learner's patience on a decision that already has a free,
      // usually-correct answer sitting in `fallback`.
      const routed = await Promise.race([
        routeAddressee({
          sceneId: scene!.id!,
          utterance: text,
          cast: audience.map(l => ({
            npcId: l.id,
            distance: l.distance,
            facedByLearner: l.facedByLearner,
            facingLearner: l.facingLearner,
            focused: l.id === focusedId,
            spokeLast: l.id === lastSpeakerRef.current,
          })),
          // ⚠️ The router reads the WHOLE transcript, unfiltered, and that is correct: it is
          // answering on the learner's behalf ("who did they mean?"), and the learner heard
          // every line in the scene. The § 4c memory gate is about what an NPC knows, not
          // about what the engine may look at.
          heard: heardRef.current.map(e => e.line),
        }).catch(() => null),
        sleep(IW_ROUTE_CLIENT_DEADLINE_MS).then(() => null),
      ]);
      if (cancelledRef.current) return;

      // A routed id still has to BE somebody standing here. The server filters to the scene's
      // cast, but the candidate list is this client's and is one frame newer.
      const chosen = routed ? audience.find(l => l.id === routed) : undefined;
      const listener = chosen ?? audience.find(l => l.id === fallback.id)!;
      const why = chosen ? 'the router read the room' : `${fallback.reason} — ${fallback.detail}`;

      iwLog('turn', `say "${text}" → ${listener.label} (${listener.id}) · ${chosen ? 'routed' : 'fallback'}`, {
        why, routed, fallback: fallback.id, cast: audience.map(l => l.id), focusedId,
        lastSpeaker: lastSpeakerRef.current,
      });
      // The routing decision is learner-facing too, in the debug notes: "why did SHE answer" is
      // the question this whole path exists to be able to answer out loud.
      note(listener.id, `answering — ${why}`);

      try {
        const outcome = await takeNpcTurn({
          sceneId: scene!.id!,
          sessionId: sessionIdRef.current,
          npcId: listener.id,
          firedCues: [...firedCuesRef.current],
          playedConversations: [...playedConversationsRef.current],
          // `addressed: true`, always — the engine has already decided this line was for
          // them, and it is the only NPC being asked. The flag survives because it is still
          // TRUE and layer 3 reads better for saying so; it is no longer load-bearing.
          perception: perceptionFor(listener.id, true, text, volume),
        }, {
          // Arrives after the reply, mid-reveal (§ 5.3b). Merged by exact line text, so a
          // bubble that is already on screen picks it up on the next render without being
          // rebuilt — the reveal and the audio behind it are untouched.
          onSegments: line => {
            if (cancelledRef.current) return;
            setLineSegments(prev => ({ ...prev, [line.foreignText]: line }));
          },
        });
        if (cancelledRef.current) return;
        if (outcome.kind === 'reply') {
          setRemaining(outcome.reply.remaining);
          await applyReply(listener.id, {
            say: outcome.reply.say,
            emote: outcome.reply.emote,
            chosen: outcome.reply.chosen,
          });
        } else if (outcome.kind === 'frozen') {
          iwWarn('turn', `frozen npc=${listener.id} — the § 14 Q7 ladder was exhausted`, outcome.attempts);
          // § 14 Q7: the ladder was exhausted. The world says NOTHING — no improvised cover
          // line — and the scene freezes behind an honest banner.
          frozenRef.current = true;
          setFrozen(true);
          setBanner('The world has gone quiet. Something is wrong on our end — try again in a moment.');
        } else if (outcome.kind === 'refused') {
          // A refusal with no code is a FAULT wearing a decline's clothes (see `refusalBanner`).
          // It reaches the learner as "Not right now."; without this line nothing anywhere
          // records which of the two faults it actually was.
          if (!outcome.refusal?.code) {
            iwWarn('banner', `codeless refusal for npc=${listener.id} → falling back to "Not right now."`, outcome);
            note(listener.id, 'the server would not take the turn (no reason given)');
          }
          iwLog('turn', `refused npc=${listener.id} code=${outcome.refusal?.code ?? '(none)'}`, outcome);
          setBanner(refusalBanner(outcome.refusal?.code));
          if (typeof outcome.remaining === 'number') setRemaining(outcome.remaining);
        }
      } catch (error) {
        // A pre-stream refusal arrives as an ApiError with the refusal in the body (the
        // endpoint decides everything it can before flushing headers — it cannot change its
        // status code afterwards).
        const refusal = (error as { response?: { data?: { refusal?: { code?: string } } } })?.response?.data?.refusal;
        iwWarn('turn', `turn threw for npc=${listener.id}`, { refusal, error });
        setBanner(refusal ? refusalBanner(refusal.code) : 'That did not get through. Try again.');
        note(listener.id, `turn failed — ${(error as Error)?.message ?? 'unknown'}`);
      }
    };

    void runTurn().finally(() => { if (!cancelledRef.current) setSending(false); });
  }, [scene, audienceFor, focusedId, perceptionFor, applyReply, note, enqueueSayPlayer, sleep]);

  /**
   * Address a body, or poke a place.
   *
   * ⚠️ IT COSTS NO MODEL CALL (§ 14 Q38). Focus is a client-side fact that decides who the
   * NEXT utterance is addressed to; walking up to somebody is not an event an NPC's brain
   * ever sees.
   */
  const focusBody = useCallback((id: string) => {
    // Focus lands FIRST and synchronously — the ring under the addressee must follow the tap,
    // not the arrival, or a long walk leaves the learner unsure who they just picked.
    setFocusedId(id);
    iwLog('tap', `body ${id} — approaching`);
    void approachAndFace(() => actorById(id)?.cell ?? null);
  }, [approachAndFace]);

  return {
    tick,
    drawables,
    graph,
    bodies: bodiesRef.current,
    speakerLabels,
    bubbles,
    lineSegments,
    banner,
    dismissBanner: () => setBanner(null),
    frozen,
    remaining,
    sending,
    popup,
    dismissPopup,
    walkPlayerTo,
    focusBody,
    focusedId,
    say,
    notes,
    setKnownWords,
    runPlaceInteraction,
    setPaused,
  };
}

/** Does `facing` point roughly from `from` toward `to`? Prompt colour only — see the caller. */
function facesToward(facing: string, from: { col: number; row: number }, to: { col: number; row: number }): boolean {
  const dc = to.col - from.col;
  const dr = to.row - from.row;
  if (Math.abs(dc) >= Math.abs(dr)) return dc > 0 ? facing === 'e' : facing === 'w';
  return dr > 0 ? facing === 's' : facing === 'n';
}

/**
 * A refusal in a sentence the learner can act on.
 *
 * ⚠️ IT IS NOT THE SERVER'S COPY. The controller has its own `refusalMessage` for a caller
 * with nowhere better to put it; this one is written for a person in a scene, and § 7 asks
 * for exhaustion to read IN-WORLD ("the market is closing") rather than as a quota error.
 */
function refusalBanner(code: string | undefined): string {
  switch (code) {
    case 'utterance-too-long': return 'That is a lot to say at once — try a shorter sentence.';
    case 'too-fast': return 'Give them a moment to answer.';
    case 'session-spent': return 'The market is closing for the night.';
    case 'daily-cap': return 'That is enough for today.';
    default: return 'Not right now.';
  }
}
