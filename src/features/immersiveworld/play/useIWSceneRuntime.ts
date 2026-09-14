import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IW_ACTOR_PLAYER, IW_CONVERSATION_LINE_MS, IW_DEFAULT_EMOTE, IW_MAX_LISTENERS_PER_UTTERANCE,
  IW_MIN_TURN_GAP_MS, scenePlaces, type IWEmote, type IWNpcOption, type IWScene,
} from '../../../../server/contracts/iw';
import { actionById, type ActionWorld } from './actionPlayer';
import { audibleListeners, chebyshev } from '../../../engine/iw/hearing';
import { guardNpcLine } from '../../../engine/iw/lineGuard';
import { planGlyphReveal } from '../../../engine/iw/revealSchedule';
import {
  approachCells, buildSceneGraph, cellKey, parseCellKey, planScenePath, type SceneGraph,
} from '../../../engine/iw/sceneGraph';
import {
  facingForStep, occupiedCells, setActorPath, tickSceneActors, type SceneActorState,
} from '../../../engine/iw/sceneActor';
import { useTTS } from '../../../hooks/useTTS';
import {
  actorCells, bodyDrawable, buildSceneBodies,
  type IWBodyDrawable, type IWSceneBody,
} from './iwSceneActors';
import { runAuthoredAction, runInteraction, type IWScriptDeps } from './iwScript';
import {
  endIwSession, newSessionId, takeNpcTurn, type IWPerception,
} from '../immersiveWorldTurnApi';

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
 * No run row, no transcript, no complication draw, no report, no completion check. Phase 2 is
 * "one stall you can talk to": a scene is opened, walked around, talked to and left, and
 * nothing about it is remembered. `sessionId` is client-generated for exactly that reason —
 * it identifies a run for § 7's budget and nothing stores it.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 3, § 4, § 4.1, § 5.3a, § 6.4, § 7, § 12 phase 2.
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
const TTS_DEADLINE_MS = 400;

/** How many recent lines an NPC is told it heard. Bounded because it is prompt weight. */
const HEARD_WINDOW = 8;

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
  /** True when there is a decoded clip behind this line, so Replay can be offered (Q41). */
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
  bubbles: IWBubble[];
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
}

/** A body the hearing gate can consider, plus what the prompt calls it. */
interface Listener { id: string; col: number; row: number; label: string }

export function useIWSceneRuntime(scene: IWScene | null, npcs: readonly IWNpcOption[]): IWSceneRuntime {
  const tts = useTTS();

  // ── Simulation state ────────────────────────────────────────────────────────────────────
  // In a ref, not in state: it changes every frame and only the stage reads it.
  const graph = useMemo(
    () => buildSceneGraph({
      width: scene?.width ?? 1,
      height: scene?.height ?? 1,
      decor: scene?.layout?.decor ?? {},
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
  const [banner, setBanner] = useState<string | null>(null);
  const [frozen, setFrozen] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [popup, setPopup] = useState<IWPopup | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);

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
  const lastSendRef = useRef(0);
  const heardRef = useRef<string[]>([]);
  const lastSpeakerRef = useRef<string | null>(null);
  const firedCuesRef = useRef<string[]>([]);
  const timersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const popupResolveRef = useRef<(() => void) | null>(null);
  /** Resolvers waiting on an actor's walk to end. One per actor at most. */
  const arrivalsRef = useRef(new Map<string, (how: 'arrived' | 'blocked') => void>());
  /** Serializes bubbles: two NPCs answering at once is noise, so they queue (§ 4.1). */
  const speechChainRef = useRef<Promise<void>>(Promise.resolve());
  /** One running script per performer; starting a new one supersedes the old. */
  const scriptTokensRef = useRef(new Map<string, number>());

  // Everything in flight is abandoned when the scene is left. Checked after every await.
  useEffect(() => {
    cancelledRef.current = false;
    const session = sessionIdRef.current;
    const timers = timersRef.current;
    return () => {
      cancelledRef.current = true;
      timers.forEach(clearTimeout);
      timers.length = 0;
      // Release § 7's session counter. Fire-and-forget by design — a failure here leaks one
      // integer on the server and nothing the learner can see.
      endIwSession(session);
    };
  }, []);

  const sleep = useCallback((ms: number) => new Promise<void>(resolve => {
    if (ms <= 0) { resolve(); return; }
    const id = setTimeout(resolve, ms);
    timersRef.current.push(id);
  }), []);

  // ── The frame clock ─────────────────────────────────────────────────────────────────────
  const tick = useCallback((dtMs: number) => {
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
    const facing = facingForStep(actor.cell, cell);
    if (!facing) return;
    actorsRef.current = actorsRef.current.map(a => (a.id === actorId ? { ...a, facing } : a));
  }, []);

  /**
   * Tap-to-move (§ 14 Q18), with the near-miss tolerance that decision made load-bearing.
   *
   * An isometric tile is a small target on a phone and a tap that silently does nothing reads
   * as a broken game — so a tap on an unwalkable or unreachable cell walks to the nearest
   * cell BESIDE it rather than being dropped.
   */
  const walkPlayerTo = useCallback((col: number, row: number) => {
    const target = cellKey(col, row);
    const player = actorById(IW_ACTOR_PLAYER);
    if (!player) return;
    const occupied = occupiedCells(actorsRef.current, IW_ACTOR_PLAYER);
    const direct = graph.walkable.has(target) && !occupied.has(target)
      ? target
      : approachCells(graph, player.cell, target, { occupied })[0];
    if (direct) void walk(IW_ACTOR_PLAYER, direct);
  }, [graph, walk]);

  // ── Speech ──────────────────────────────────────────────────────────────────────────────

  const labelFor = useCallback((actorId: string): string => (
    actorId === IW_ACTOR_PLAYER ? PLAYER_LABEL : bodiesRef.current.get(actorId)?.label ?? actorId
  ), []);

  /**
   * Show and speak one line, resolving when its bubble has finished revealing.
   *
   * The ordering is § 6.4's contract, in order: guard (which is § 5.3a's sanitize step) →
   * synthesize → decode → paint in step with playback. A line that fails the guard produces
   * NO bubble and no sound; the NPC's action and emote still play, which is § 4.1's
   * non-verbal channel rather than an error state.
   */
  const sayLine = useCallback(async (actorId: string, raw: string, emote: IWEmote = IW_DEFAULT_EMOTE) => {
    const language = scene?.language ?? 'zh';
    const verdict = guardNpcLine(raw, language);
    if (!verdict.ok) { note(actorId, `line silenced — ${verdict.reason}`); return; }
    const text = verdict.text;

    // § 6.4 rule 4: race the synth against a deadline. A late answer is DROPPED — the audio
    // is never started after the reveal has begun, or the two would be out of step, which is
    // the whole thing audio-as-clock exists to prevent.
    const duration = await Promise.race<number | null>([
      tts.prepareSentence(text),
      sleep(TTS_DEADLINE_MS).then(() => null),
    ]);
    if (cancelledRef.current) return;

    const schedule = planGlyphReveal(text, duration ?? undefined);
    if (duration !== null) {
      // autoSpeakSentence, never speakSentence: an NPC talking is AUTOMATIC narration and
      // Mute must silence it (§ 6.4 rule 6). The clip is already decoded, so this starts now.
      void tts.autoSpeakSentence(text);
    }

    const startedAt = performance.now();
    setBubbles(prev => [
      // One bubble per body, replacing rather than stacking (§ 5.3a).
      ...prev.filter(b => b.actorId !== actorId),
      { actorId, text, schedule, startedAt, emote, replayable: duration !== null },
    ]);
    heardRef.current = [...heardRef.current, `${labelFor(actorId)}: ${text}`].slice(-HEARD_WINDOW);
    lastSpeakerRef.current = actorId;

    const revealMs = schedule[schedule.length - 1] ?? 0;
    await sleep(revealMs + BUBBLE_DWELL_BASE_MS + text.length * BUBBLE_DWELL_PER_GLYPH_MS);
    if (cancelledRef.current) return;
    setBubbles(prev => prev.filter(b => !(b.actorId === actorId && b.startedAt === startedAt)));
  }, [scene, tts, sleep, note, labelFor]);

  /** Queue a line behind whatever is already being said, so two NPCs never overlap. */
  const enqueueSay = useCallback((actorId: string, text: string, emote?: IWEmote): Promise<void> => {
    const next = speechChainRef.current.then(() => sayLine(actorId, text, emote));
    // The chain must survive a failed link, or one thrown error silences the scene forever.
    speechChainRef.current = next.catch(() => {});
    return next;
  }, [sayLine]);

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
    for (const turn of conversation.turns ?? []) {
      if (cancelledRef.current) return;
      // Authored text, pre-reviewed by construction — but it still goes through the same
      // speech path, so an authored line and a generated one are paced identically.
      await enqueueSay(turn.npcId, turn.text);
      await sleep(Math.max(0, IW_CONVERSATION_LINE_MS - 3000));
    }
  }, [scene, enqueueSay, sleep]);

  const scriptDeps = useCallback((token: number, actorId: string): IWScriptDeps => ({
    worldFor,
    walk,
    face,
    say: (who, text) => enqueueSay(who, text),
    playConversation,
    armEvent,
    wait: sleep,
    note,
    cancelled: () => cancelledRef.current || scriptTokensRef.current.get(actorId) !== token,
  }), [worldFor, walk, face, enqueueSay, playConversation, armEvent, sleep, note]);

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
    const token = (scriptTokensRef.current.get('world') ?? 0) + 1;
    scriptTokensRef.current.set('world', token);
    await runInteraction(steps, {
      ...scriptDeps(token, 'world'),
      showPopup,
      performNpcAction,
    });
  }, [scene, scriptDeps, showPopup, performNpcAction]);

  // ── The turn (§ 4.1) ────────────────────────────────────────────────────────────────────

  /** Everyone the gate says heard it, nearest first and capped (§ 4, § 7). */
  const audienceFor = useCallback((fromCell: string): Listener[] => {
    const from = parseCellKey(fromCell);
    if (!from) return [];
    const listeners: Listener[] = actorsRef.current
      .filter(a => a.id !== IW_ACTOR_PLAYER)
      .map(a => {
        const cell = parseCellKey(a.cell);
        return cell
          ? { id: a.id, col: cell.col, row: cell.row, label: labelFor(a.id) }
          : null;
      })
      .filter((l): l is Listener => l !== null);

    const heard = audibleListeners(graph, from, listeners, 'talk');
    return heard
      // The cap is the client half of § 7's listener bound. Dropping the far ones rather than
      // refusing is what makes a crowded scene get quieter instead of erroring.
      .slice(0, IW_MAX_LISTENERS_PER_UTTERANCE)
      .map(result => listeners.find(l => l.id === result.id)!)
      .filter(Boolean);
  }, [graph, labelFor]);

  /** What one NPC perceives, for layer 3 of their prompt. */
  const perceptionFor = useCallback((npcId: string, addressed: boolean, text: string, knownWords: readonly string[]): IWPerception => {
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

    return {
      knownWords: [...knownWords],
      nearby,
      heard: [...heardRef.current],
      event: { kind: 'utterance', speaker: PLAYER_LABEL, text, addressed },
      spokeLastTurn: lastSpeakerRef.current === npcId,
    };
  }, [labelFor]);

  const knownWordsRef = useRef<string[]>([]);
  const setKnownWords = useCallback((words: string[]) => { knownWordsRef.current = words; }, []);

  /** Handle one NPC's answer: speak it, then perform whatever it chose to do. */
  const applyReply = useCallback(async (npcId: string, reply: { say: string; emote: IWEmote; chosen: { id: string; kind: string } | null }) => {
    if (reply.say) await enqueueSay(npcId, reply.say, reply.emote);
    if (!reply.chosen) return;
    if (reply.chosen.kind === 'conversation') await playConversation(reply.chosen.id);
    else await performNpcAction(npcId, reply.chosen.id);
  }, [enqueueSay, playConversation, performNpcAction]);

  /** The learner's bubble: same queue, same pacing, no audio (they said it themselves). */
  const enqueueSayPlayer = useCallback((text: string) => {
    const schedule = planGlyphReveal(text, 1);
    const startedAt = performance.now();
    setBubbles(prev => [
      ...prev.filter(b => b.actorId !== IW_ACTOR_PLAYER),
      { actorId: IW_ACTOR_PLAYER, text, schedule, startedAt, emote: IW_DEFAULT_EMOTE, replayable: false },
    ]);
    void sleep(4000).then(() => {
      if (!cancelledRef.current) {
        setBubbles(prev => prev.filter(b => !(b.actorId === IW_ACTOR_PLAYER && b.startedAt === startedAt)));
      }
    });
  }, [sleep]);

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
    const audience = audienceFor(player.cell);
    heardRef.current = [...heardRef.current, `${PLAYER_LABEL}: ${text}`].slice(-HEARD_WINDOW);
    // The learner's own line goes in a bubble too, un-spoken: it is the only record of what
    // they just said once the composer clears, and reading it back is half of noticing a typo.
    void enqueueSayPlayer(text);

    if (audience.length === 0) {
      note('world', 'nobody was close enough to hear that');
      setBanner('Nobody heard you. Try standing closer.');
      return;
    }

    // Who was plainly being spoken to: the body the learner last addressed if they are in
    // earshot, else the nearest. `addressed` is a FACT in the prompt, not an instruction —
    // § 4.1's counter-pressure against every bystander chiming in.
    const addressedId = audience.find(l => l.id === focusedId)?.id ?? audience[0].id;

    setSending(true);
    // Fired in PARALLEL — the calls are independent and the cost is already committed — but
    // revealed in sequence, because two bubbles appearing at once is noise (§ 4.1).
    const calls = audience.map(async listener => {
      try {
        const outcome = await takeNpcTurn({
          sceneId: scene!.id!,
          sessionId: sessionIdRef.current,
          npcId: listener.id,
          firedCues: [...firedCuesRef.current],
          perception: perceptionFor(listener.id, listener.id === addressedId, text, knownWordsRef.current),
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
          // § 14 Q7: the ladder was exhausted. The world says NOTHING — no improvised cover
          // line — and the scene freezes behind an honest banner.
          frozenRef.current = true;
          setFrozen(true);
          setBanner('The world has gone quiet. Something is wrong on our end — try again in a moment.');
        } else if (outcome.kind === 'refused') {
          setBanner(refusalBanner(outcome.refusal?.code));
          if (typeof outcome.remaining === 'number') setRemaining(outcome.remaining);
        }
      } catch (error) {
        // A pre-stream refusal arrives as an ApiError with the refusal in the body (the
        // endpoint decides everything it can before flushing headers — it cannot change its
        // status code afterwards).
        const refusal = (error as { response?: { data?: { refusal?: { code?: string } } } })?.response?.data?.refusal;
        setBanner(refusal ? refusalBanner(refusal.code) : 'That did not get through. Try again.');
        note(listener.id, `turn failed — ${(error as Error)?.message ?? 'unknown'}`);
      }
    });

    void Promise.all(calls).finally(() => { if (!cancelledRef.current) setSending(false); });
  }, [scene, audienceFor, focusedId, perceptionFor, applyReply, note, enqueueSayPlayer]);

  /**
   * Address a body, or poke a place.
   *
   * ⚠️ IT COSTS NO MODEL CALL (§ 14 Q38). Focus is a client-side fact that decides who the
   * NEXT utterance is addressed to; walking up to somebody is not an event an NPC's brain
   * ever sees.
   */
  const focusBody = useCallback((id: string) => {
    setFocusedId(id);
    const player = actorById(IW_ACTOR_PLAYER);
    const target = actorById(id);
    if (player && target) face(IW_ACTOR_PLAYER, target.cell);
  }, [face]);

  return {
    tick,
    drawables,
    graph,
    bodies: bodiesRef.current,
    bubbles,
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
