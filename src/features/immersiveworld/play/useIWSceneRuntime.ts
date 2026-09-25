import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IW_ACTOR_PLAYER, IW_DEFAULT_EMOTE,
  IW_MIN_TURN_GAP_MS, IW_PLAYER_LABEL, iwPlayerAvatar, scenePlaces, type IWEmote, type IWLineSegments,
  type IWDestinationCandidate, type IWDestinationTarget,
  type IWNpcOption, type IWScene,
} from '../../../../server/contracts/iw';
import { actionById, type ActionWorld } from './actionPlayer';
import { chooseAddressee } from './addressee';
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
import { useAuth } from '../../../AuthContext';
import type { TTSVoice } from '../../../services/tts';
import {
  actorCells, bodyDrawable, buildSceneBodies,
  type IWBodyDrawable, type IWSceneBody, type IWSpeakerName,
} from './iwSceneActors';
import { runAuthoredAction, runInteraction, type IWScriptDeps } from './iwScript';
import {
  chooseDestination as requestDestination,
  endIwSession, newSessionId, renderNpcLine, routeAddressee, segmentUtterance, takeNpcTurn,
  type IWCollectGoal,
  type IWPerception,
} from '../immersiveWorldTurnApi';
import { iwLog, iwWarn } from '../iwDebugLog';

/**
 * useIWSceneRuntime — one scene, running (§ 12 phase 2).
 *
 * LAYER: feature hook. It is the ONLY stateful thing in the play surface: the stage draws what
 * it is given, the bubble renders what it is given, and everything that decides *what happens*
 * is here. Every rule it enforces is somebody else's, though — the graph, the addressee rules,
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
 * Referenced by: docs/IMMERSIVE_WORLD.md § 3, § 4, § 4.1, § 4.2, § 5.3a, § 5.3d, § 6.4, § 7, § 12 phase 2.
 */

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
 * How long an `ai_walk` waits for the destination picker before giving up on the walk (§ 5.4).
 *
 * The router's ceiling, for the router's reason: the server's own deadline is the same 1800 ms
 * (`destinationPicker.ts`), so this fires only on a hung connection. The difference is what
 * happens past it — no rule ladder answers, the walk is simply skipped and the script plays on.
 */
const IW_DESTINATION_CLIENT_DEADLINE_MS = IW_ROUTE_CLIENT_DEADLINE_MS;

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

/**
 * What the learner is called in an NPC's prompt. In-world, never "the player" (§ 14 Q27).
 * Shared with the server's destination labels and learner description — see `IW_PLAYER_LABEL`.
 */
const PLAYER_LABEL = IW_PLAYER_LABEL;

/**
 * Who holds the conversational floor — what the composer renders (§ 5.3d).
 *
 * - `open` — nothing is being said or waited on: the learner may type.
 * - `waiting` — a turn is in flight, or an NPC line is queued but not on screen yet (the
 *   model round trip, the TTS race). The composer is the bar, inert.
 * - `continue` — an NPC line is on screen and parked until the learner taps Continue.
 * - `frozen` — § 14 Q7's terminal state. Nothing may ever be sent again.
 */
export type IWFloor = 'open' | 'waiting' | 'continue' | 'frozen';

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
   * npcId → the DISPLAY name for that body: what the nametag over the head prints, and what
   * the same tag prints in its corner once it has grown into a speech bubble.
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
  speakerLabels: Record<string, IWSpeakerName>;
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
  /**
   * Who may speak next (§ 5.3d). Replaced the raw `sending` flag, which was held for a turn's
   * WHOLE performance — including an authored action that could park on the learner's next
   * utterance, a deadlock the learner had no way out of.
   */
  floor: IWFloor;
  /**
   * Dismiss the NPC line on screen and let the speech queue move on (§ 5.3d). A no-op unless
   * `floor === 'continue'`. Legal mid-reveal: it cuts the voice and the bubble together.
   */
  continueLine(): void;
  popup: IWPopup | null;
  dismissPopup(): void;
  /** Walk the learner to a cell (§ 14 Q18's tap-to-move), tolerating a near miss. */
  walkPlayerTo(col: number, row: number): void;
  /** Address a body — the § 1 action button's target, and a tap on a person. */
  focusBody(id: string): void;
  /** Which body the learner last addressed. The `addressed` flag in the next turn. */
  focusedId: string | null;
  /** Say something. The one path that reaches an NPC's brain (§ 14 Q38). */
  say(text: string): void;
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
      // 2026-09-06 rename still carries `locations` on any DB migration 163 has not reached.
      places: scenePlaces(scene?.layout),
    }),
    [scene],
  );

  // The learner's body follows their account (`users."gender"`, migration 164). Keyed on the
  // gender VALUE, not on `user` — the user object is replaced on every settings write, and a
  // rebuild here re-places every body at its start cell.
  const { user } = useAuth();
  const playerAvatar = iwPlayerAvatar(user?.gender);
  const built = useMemo(
    () => (scene ? buildSceneBodies(scene, npcs, graph, playerAvatar) : null),
    [scene, npcs, graph, playerAvatar],
  );

  // Keyed on `built` (a memo of the scene), so unlike `bodiesRef` this is correct on the very
  // render that first sees the scene rather than one effect later.
  const speakerLabels = useMemo(() => {
    const labels: Record<string, IWSpeakerName> = {};
    for (const [id, body] of built?.bodies ?? []) {
      // No label ⇒ no entry, which is what keeps the learner out of this map: they have no
      // NPC row, so they wear no nametag and a view that names them supplies its own word.
      if (body.label) {
        labels[id] = {
          text: body.label,
          pinyin: body.pinyin,
          // ⚠️ `foreign` IS "did we resolve an NPC", not "does the scene speak zh". A body
          // whose npcId the code no longer defines is labelled with the RAW ID (`wang_shen`),
          // and an id pushed through a cpcd layout in a `zh` scene becomes one tone-coloured
          // column per Latin letter. It is chrome; it renders as chrome.
          foreign: body.npc !== null,
        };
      }
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
  /**
   * NPC lines handed to `enqueueSay` that have not been continued past yet — including the
   * one on screen. Counted from the moment of enqueueing, not of posting, so the gap between
   * a reply arriving and its bubble painting (the TTS race) reads as `waiting` instead of
   * flashing the text box back for a beat.
   */
  const [queuedLines, setQueuedLines] = useState(0);
  /** An NPC bubble is up and parked on {@link continueResolveRef}. */
  const [awaitingContinue, setAwaitingContinue] = useState(false);
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
  /** Releases the `sayLine` currently parked on its Continue tap (§ 5.3d). One at a time. */
  const continueResolveRef = useRef<(() => void) | null>(null);
  /**
   * The scene transcript, as `"<speaker label>: <line>"`, newest last.
   *
   * ⚠️ **ONE LIST, HANDED IDENTICALLY TO EVERY NPC — AND THAT IS NOW THE RULE, NOT A GAP.**
   * Everybody in a scene hears every line (§ 4c was withdrawn 2026-09-23). Entries used to
   * carry the audience that heard them so a whisper could be kept out of a bystander's memory;
   * with no volumes there is nothing to filter, so the pairing went with them.
   */
  const heardRef = useRef<string[]>([]);
  const lastSpeakerRef = useRef<string | null>(null);
  const firedCuesRef = useRef<string[]>([]);
  /** Conversations already overheard this run. Per-run, like `firedCuesRef` — see below. */
  const playedConversationsRef = useRef<Set<string>>(new Set());
  const timersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const popupResolveRef = useRef<(() => void) | null>(null);
  /** Resolvers waiting on an actor's walk to end. One per actor at most. */
  const arrivalsRef = useRef(new Map<string, (how: 'arrived' | 'blocked') => void>());
  /**
   * Scripts parked at a `wait_for_response` step, with WHO is waiting (2026-09-20). Released
   * in `say`'s turn once the learner's line has been ROUTED to that actor — see there.
   *
   * A list rather than a map: one actor can legitimately hold two parked scripts for a moment
   * (a superseded one that has not yet noticed its token changed, and its replacement), and
   * dropping the first on the floor would strand its promise chain forever.
   */
  const learnerWaitersRef = useRef<Array<{ actorId: string; resolve: () => void }>>([]);
  /**
   * Scripts parked at a `get_information` step (§ 5.4, 2026-09-20).
   *
   * Two refs rather than one, because the two facts have different lifetimes. `collectingRef`
   * is what the PROMPT needs — it must be readable by `perceptionFor` at the moment the turn
   * is assembled, which is after the learner has spoken and before the reply exists.
   * `collectWaitersRef` is what the SCRIPT needs, and it resolves a whole turn later, once
   * that reply has come back carrying the verdict.
   */
  const collectingRef = useRef(new Map<string, IWCollectGoal>());
  const collectWaitersRef = useRef<Array<{ actorId: string; resolve: (outcome: 'got' | 'not-yet') => void }>>([]);
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
    // Captured, like `timers`, so the cleanup does not read a ref at teardown time. All three
    // queues are mutated in place (push/splice) and never reassigned, so the identity holds.
    const pauseWaiters = pauseWaitersRef.current;
    const learnerWaiters = learnerWaitersRef.current;
    const collectWaiters = collectWaitersRef.current;
    return () => {
      cancelledRef.current = true;
      timers.forEach(clearTimeout);
      timers.length = 0;
      // Release anything parked at § 5.3c's hold. A scene left while paused would otherwise
      // strand its promise chains forever; they resume, see `cancelledRef` and unwind.
      pausedRef.current = false;
      pauseWaiters.splice(0).forEach(resolve => resolve());
      // Same argument for a script parked at `wait_for_response`: the learner has left and
      // will never speak again, so the waiter is released to see `cancelledRef` and unwind.
      learnerWaiters.splice(0).forEach(({ resolve }) => resolve());
      // Same for a script parked mid-errand. `not-yet` rather than `got` so the loop sees a
      // failure, checks `cancelled` and unwinds without speaking a give-up line at nobody.
      collectWaiters.splice(0).forEach(({ resolve }) => resolve('not-yet'));
      // And a line parked on Continue: the chain resumes, sees `cancelledRef` and unwinds.
      continueResolveRef.current?.();
      continueResolveRef.current = null;
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
    heardRef.current = [...heardRef.current, `${labelFor(actorId)}: ${text}`].slice(-HEARD_WINDOW);
    lastSpeakerRef.current = actorId;

    // ⚠️ **AN NPC LINE HAS NO TIMER AT ALL — IT WAITS FOR CONTINUE** (§ 5.3d, 2026-09-23).
    // `enqueueSay` chains on this promise, so parking here is what holds the next speaker
    // back. It replaced a dwell (`reveal + 1600 ms + 90 ms/glyph`) that paced the queue on
    // the clock: a slow reader lost the line to whatever came next, and a fast one sat
    // through dead air. Now the learner is the clock, and the tap that releases the queue
    // also dismisses the bubble (`continueLine`), so the board is empty — and the composer
    // is a text box again — only once every line has been read.
    await new Promise<void>(resolve => {
      continueResolveRef.current = resolve;
      setAwaitingContinue(true);
    });
  }, [scene, tts, sleep, note, labelFor, voiceFor, postBubble, whenResumed]);

  /**
   * The Continue tap (§ 5.3d): dismiss the NPC line on screen and release the speech queue.
   *
   * Allowed mid-reveal by decision (2026-09-23) — which partly reverses Q41's "listening is
   * not skippable". The voice is cut with the bubble rather than left talking over an empty
   * board; the replay button is gone with it, so a line skipped this way is skipped for good.
   */
  const cancelSpeech = tts.cancel;
  const continueLine = useCallback(() => {
    const resolve = continueResolveRef.current;
    if (!resolve) return;
    continueResolveRef.current = null;
    setAwaitingContinue(false);
    cancelSpeech();
    setBubbles([]);
    resolve();
  }, [cancelSpeech]);

  /** Queue a line behind whatever is already being said, so two NPCs never overlap. */
  const enqueueSay = useCallback((actorId: string, text: string, emote?: IWEmote): Promise<void> => {
    // Counted SYNCHRONOUSLY, before any await, so a caller that clears `sending` right after
    // enqueueing lands in the same render and the floor never flickers to `open` (see
    // `runTurn`). Uncounted in `finally`, so a silenced or cancelled line releases it too.
    setQueuedLines(n => n + 1);
    const next = speechChainRef.current
      .then(() => sayLine(actorId, text, emote))
      .finally(() => setQueuedLines(n => n - 1));
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

    // Everybody heard everything (§ 4c withdrawn), so every NPC gets the same transcript.
    return { knownWords: [...knownWordsRef.current], nearby, heard: [...heardRef.current] };
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

  /**
   * Ask the model where an `ai_walk` goes (§ 5.4, 2026-09-23). `null` skips the walk.
   *
   * The performer's `heard` is the SAME memory-gated list its turn prompt reads
   * (`contextFor`), so "back to whoever was just calling out" is decided on what this NPC
   * could actually hear, not on the whole room's transcript.
   */
  const chooseDestination = useCallback(async (
    npcId: string, brief: string, candidates: readonly IWDestinationCandidate[],
  ): Promise<IWDestinationTarget | null> => {
    if (!scene?.id || cancelledRef.current) return null;
    const target = await Promise.race([
      requestDestination({
        sceneId: scene.id,
        npcId,
        brief,
        candidates,
        heard: contextFor(npcId).heard,
      }),
      sleep(IW_DESTINATION_CLIENT_DEADLINE_MS).then(() => null),
    ]);
    if (!target) note(npcId, `AI walk found nowhere to go — "${brief}"`);
    return target;
  }, [scene?.id, contextFor, sleep, note]);

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
      // and shows the fact. Having the cast REACT to it in character is a turn per
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
      // A beat that could not be rendered is SKIPPED, never spoken as written. No gap after
      // it: the line resolves on the learner's Continue tap (§ 5.3d), which IS the pacing.
      if (say) await enqueueSay(turn.npcId, say);
    }
  }, [scene, enqueueSay, renderLine, note]);

  /**
   * Park a script until the learner says something ROUTED to this actor (`iwScript.ts`).
   *
   * There is deliberately no timeout: the three ways out are the learner speaking, the scene
   * being left, and another action superseding this script — the same set every other await
   * in this hook lives with.
   */
  const awaitLearner = useCallback((actorId: string) => new Promise<void>(resolve => {
    learnerWaitersRef.current.push({ actorId, resolve });
  }), []);

  /**
   * Park a script until this NPC's next turn reports whether it got what it was after.
   *
   * ⚠️ **THE ERRAND IS REGISTERED BEFORE THE AWAIT AND CLEARED AFTER IT**, which is what makes
   * `perceptionFor` able to see it: the turn that carries the goal into the prompt is assembled
   * between those two moments, on the learner's next utterance.
   *
   * ⚠️ **AN UTTERANCE ROUTED TO SOMEBODY ELSE DOES NOT COUNT.** The waiter stays parked and
   * the attempt counter does not advance — asking a friend a question in the middle of
   * ordering should not spend one of the vendor's three tries, and it certainly should not
   * make the vendor give up.
   */
  const collect = useCallback((
    actorId: string, goal: string, attempt: number, maxTurns: number,
  ) => new Promise<'got' | 'not-yet'>(resolve => {
    collectingRef.current.set(actorId, { goal, attempt, maxTurns });
    collectWaitersRef.current.push({
      actorId,
      resolve: outcome => {
        collectingRef.current.delete(actorId);
        resolve(outcome);
      },
    });
  }), []);

  /**
   * Hand a finished turn's verdict to whatever script is parked on this NPC's errand.
   *
   * Called for EVERY terminal outcome, not just a reply: a frozen ladder or a refused turn is
   * an answer that never arrived, and a waiter left parked on one would strand the script
   * until the learner happened to speak again. `not-yet` lets the loop spend an attempt and
   * either ask again or give up, which is the same thing the NPC would do if they had simply
   * not understood.
   */
  const releaseCollectors = useCallback((actorId: string, outcome: 'got' | 'not-yet') => {
    const waiting = collectWaitersRef.current.filter(w => w.actorId === actorId);
    if (!waiting.length) return;
    collectWaitersRef.current = collectWaitersRef.current.filter(w => w.actorId !== actorId);
    waiting.forEach(({ resolve }) => resolve(outcome));
  }, []);

  const scriptDeps = useCallback((token: number, actorId: string): IWScriptDeps => ({
    worldFor,
    walk,
    face,
    say: (who, text) => enqueueSay(who, text),
    renderLine,
    chooseDestination,
    playConversation,
    armEvent,
    wait: sleep,
    awaitLearner,
    collect,
    note,
    cancelled: () => cancelledRef.current || scriptTokensRef.current.get(actorId) !== token,
  }), [worldFor, walk, face, enqueueSay, renderLine, chooseDestination, playConversation, armEvent, sleep, awaitLearner, collect, note]);

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
   * Everyone who could be the one being spoken to — every NPC in the scene, nearest first
   * (§ 4.2). Exactly one of them is then chosen, by the router or by the rules.
   *
   * ⚠️ **THERE IS NO HEARING GATE, AND THERE HAS BEEN ONE TWICE.** The first was an automatic
   * earshot model (§ 4, withdrawn 2026-09-07); the second was a whisper/say/shout volume the
   * learner picked (§ 4c, withdrawn 2026-09-23). Both went for the same underlying reason: a
   * scene is one small room, so the question worth answering is not WHO COULD HEAR but WHO
   * WAS MEANT — and that is decided from position, facing and the sentence itself, which is
   * exactly what each entry below carries to the router and to `chooseAddressee`.
   *
   * ⚠️ **NOR IS THERE A CAP** (2026-09-23). The list used to stop at four, a leftover from when
   * every body in it was a model call (§ 4.1). Routing made an utterance one call whatever the
   * cast size, so a cap only hid the farthest NPCs from the router — a learner naming somebody
   * across a big room would be answered by whoever stood nearer. The bound is now the scene's
   * own cast, which the server re-checks (`ImmersiveWorldService` filters the route request to
   * the scene's members).
   *
   * Distance survives as the ordering: `chooseAddressee`'s last-resort rule takes the first
   * entry, so "nearest" has to mean the front of this list.
   */
  const audienceFor = useCallback((self: { cell: string; facing: string }): AddresseeOption[] => {
    const from = parseCellKey(self.cell);
    if (!from) return [];
    return actorsRef.current
      .filter(a => a.id !== IW_ACTOR_PLAYER)
      .map(a => {
        const cell = parseCellKey(a.cell);
        if (!cell) return null;
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
      // Nearest first — `chooseAddressee`'s last-resort rule reads this order.
      .sort((a, b) => a.distance - b.distance);
  }, [labelFor]);

  /** What one NPC perceives, for layer 3 of their prompt. */
  const perceptionFor = useCallback((npcId: string, addressed: boolean, text: string): IWPerception => ({
    ...contextFor(npcId),
    event: { kind: 'utterance', speaker: PLAYER_LABEL, text, addressed },
    spokeLastTurn: lastSpeakerRef.current === npcId,
    // Present only while this NPC's script is parked on a `get_information` step, which is
    // also exactly when the reply will be read for a fourth line (§ 5.4).
    collect: collectingRef.current.get(npcId),
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

  const say = useCallback((raw: string) => {
    const text = raw.trim();
    if (!text || frozenRef.current || cancelledRef.current) return;
    const now = Date.now();
    // The client half of § 7's rate limit. Enforced here too so the learner is stopped by a
    // disabled button rather than by a refusal that reads as the game losing their sentence.
    if (now - lastSendRef.current < IW_MIN_TURN_GAP_MS) return;
    lastSendRef.current = now;

    const player = actorById(IW_ACTOR_PLAYER);
    if (!player) return;
    const audience = audienceFor(player);
    heardRef.current = [...heardRef.current, `${PLAYER_LABEL}: ${text}`].slice(-HEARD_WINDOW);
    // Logged BEFORE the routing decision, so a line nobody answered still shows up in the
    // transcript — "I said it and got nothing" is exactly the case worth reading back.
    iwLog('dialogue', `${PLAYER_LABEL} (${IW_ACTOR_PLAYER}): ${text}`, {
      playerCell: player.cell, facing: player.facing, cast: audience.map(l => l.id),
    });
    // The learner's own line goes in a bubble too, un-spoken: it is the only record of what
    // they just said once the composer clears, and reading it back is half of noticing a typo.
    void enqueueSayPlayer(text);

    // With everybody hearing everything, the only way to have nobody to answer is an empty
    // scene — an authoring mistake, not something the learner can walk or turn to fix.
    if (audience.length === 0) {
      iwLog('turn', 'no NPCs in the scene', { playerCell: player.cell, facing: player.facing });
      note('world', 'there is nobody here to hear that');
      setBanner('There is nobody here to talk to.');
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
          // The whole transcript — the same one every NPC is given. "Who did they mean?"
          // often turns on who spoke last and what was asked.
          heard: [...heardRef.current],
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

      // ⚠️ **A PARKED SCRIPT WAKES ONLY FOR THE NPC THIS LINE WAS ROUTED TO** (2026-09-23).
      // A `wait_for_response` step hands the floor to the learner and resumes when they answer
      // THIS NPC. It used to wake on any line the NPC could hear, which — once everybody hears
      // everything — would have an NPC treat an aside to somebody else as the answer to its
      // own question. The price is that waking now waits on the routing race above (bounded by
      // `IW_ROUTE_CLIENT_DEADLINE_MS`) instead of firing the instant the learner hits send.
      //
      // Released after the `heardRef` append in `say` and BEFORE the turn: a resumed script's
      // next beat is usually a `comment`, whose render has to see the sentence it is answering,
      // and it queues behind the reply on the speech chain rather than racing it.
      const waking = learnerWaitersRef.current.filter(w => w.actorId === listener.id);
      if (waking.length) {
        learnerWaitersRef.current = learnerWaitersRef.current.filter(w => w.actorId !== listener.id);
        waking.forEach(({ resolve }) => resolve());
      }

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
          perception: perceptionFor(listener.id, true, text),
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
          const performing = applyReply(listener.id, {
            say: outcome.reply.say,
            emote: outcome.reply.emote,
            chosen: outcome.reply.chosen,
          });
          // ⚠️ **THE TURN STOPS HOLDING THE FLOOR HERE, NOT WHEN THE PERFORMANCE ENDS**
          // (§ 5.3d). `applyReply` enqueued the line synchronously, so the floor is now held
          // by `queuedLines` and then by Continue. Holding `sending` through the chosen action
          // deadlocked any action with a `wait_for_response` / `get_information` step: the
          // script waited on the learner, and the learner's composer waited on the script.
          setSending(false);
          await performing;
          // ⚠️ RELEASED AFTER THE REPLY HAS BEEN SPOKEN, not when it arrived. The parked
          // script's next step belongs after the NPC's own answer — resuming at the earlier
          // moment would have the script walking away mid-sentence.
          releaseCollectors(listener.id, outcome.reply.collected ? 'got' : 'not-yet');
        } else if (outcome.kind === 'frozen') {
          iwWarn('turn', `frozen npc=${listener.id} — the § 14 Q7 ladder was exhausted`, outcome.attempts);
          // § 14 Q7: the ladder was exhausted. The world says NOTHING — no improvised cover
          // line — and the scene freezes behind an honest banner.
          frozenRef.current = true;
          setFrozen(true);
          releaseCollectors(listener.id, 'not-yet');
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
          releaseCollectors(listener.id, 'not-yet');
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
        releaseCollectors(listener.id, 'not-yet');
      }
    };

    void runTurn().finally(() => { if (!cancelledRef.current) setSending(false); });
  }, [scene, audienceFor, focusedId, perceptionFor, applyReply, releaseCollectors, note, enqueueSayPlayer, sleep]);

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
    floor: frozen ? 'frozen'
      : awaitingContinue ? 'continue'
        : (sending || queuedLines > 0) ? 'waiting'
          : 'open',
    continueLine,
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
