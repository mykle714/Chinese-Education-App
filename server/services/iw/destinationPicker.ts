import { runLadder, type IWModelRung } from './npcTurn.js';
import { COMPANION_NPC_ID_BY_LANGUAGE, npcById } from '../../config/iwNpcs.js';
import {
  IW_ACTOR_COMPANION, IW_ACTOR_PLAYER, IW_MAX_ACTION_INSTRUCTION_LENGTH, IW_PLAYER_LABEL, scenePlaces,
  type IWDestinationCandidate, type IWDestinationTarget, type IWScene,
} from '../../contracts/iw.js';
import { resolveCastMember } from './sceneCast.js';
import type { HeardLine } from './turnState.js';

/**
 * iw destination picker — the model call behind an `ai_walk` step (§ 5.4, BUILT 2026-09-23).
 *
 * LAYER: service (pure prompt + parser; the ladder does the I/O). Called by
 * `ImmersiveWorldService.pickDestination`.
 *
 * The step's contract, restated because this module is where it is enforced: **the model
 * chooses WHERE, from a closed list, and nothing else.** The route is computed afterwards by
 * the same deterministic `planScenePath` every other walk uses, so "the model never
 * improvises movement" holds exactly as it did before this existed.
 *
 * ⚠️ **IT IS THE ADDRESSEE ROUTER'S SHAPE, ON PURPOSE** (`addresseeRouter.ts`). Both are a
 * reader, not a speaker: a frozen system block that does NOT carry the world rules (telling a
 * picker to stay in character is how it starts answering in Chinese), one rung, tight
 * deadlines, a one-line reply validated against what was offered, and an explicit out
 * ({@link IW_DEST_NONE}) so "nothing fits" is a legible answer rather than a coerced guess.
 *
 * ⚠️ **THE REPLY IS A NUMBER, NOT A NAME — THE ONE PLACE IT DIFFERS FROM THE ROUTER.** Router
 * ids are slugs (`wang_shen`); place tags are author prose with spaces ("self-serve water
 * station"), and a whole-line name match is exactly what silently drops a paraphrase to
 * nothing (the same risk the turn contract's line 2 carries). An index into a numbered list
 * the model is reading can only be right, wrong, or out of range — and out of range is a
 * parse failure, never an invented destination.
 *
 * ⚠️ **NO FREE FALLBACK, UNLIKE THE ROUTER.** The router's failure costs nothing because the
 * rule ladder answers instead. Here a failure means the NPC does not walk — the step is
 * skipped and the script plays on (`actionPlayer.ts`'s skip contract). That is still one rung
 * rather than the Q7 ladder: the NPC is standing still while this runs, and three rungs at
 * ~750 ms each is a visibly frozen body to rescue one walk.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 5.4.
 */

/** The out. Same reasoning as the router's UNCLEAR — a model forced to choose always chooses. */
export const IW_DEST_NONE = 'NONE';

/** One number and a runaway guard. The parser reads the first line only. */
export const IW_DEST_MAX_TOKENS = 16;

/**
 * Deadlines — the router's, and for the router's measured reasons (`iw-route-probe.js`: median
 * ~650 ms, tail 3.6 s). The prompt is the same size class and the answer is one token, so the
 * floor is round trip, not decode. Re-measure before tightening.
 */
export const DEST_FIRST_GLYPH_DEADLINE_MS = 1400;
export const DEST_TOTAL_DEADLINE_MS = 1800;

/** The most candidates a prompt carries. A scene has a handful of places and bodies. */
export const IW_MAX_DEST_CANDIDATES = 24;

/** Frozen system block. See the header for why it is not the world rules. */
export const IW_DEST_SYSTEM = `You decide where a character in a scene walks next.
You will be given who the character is, what they mean to do, a numbered list of places and
people they could walk to, and what they have heard recently.
Pick the ONE destination that best carries out what they mean to do. Distances are a hint for
breaking ties ("the nearest", "whoever is closest"), not a reason on their own.
Reply with the number only, on one line, and nothing else:
    3
Reply ${IW_DEST_NONE} alone ONLY if no destination on the list fits at all.`;

/** A candidate the server accepted, with the label the prompt shows for it. */
export interface ResolvedDestination {
  target: IWDestinationTarget;
  label: string;
  distance: number;
}

/** The label a PERSON candidate shows — from the registry, never from the caller. */
function actorLabel(scene: IWScene, actorId: string): string | null {
  if (actorId === IW_ACTOR_PLAYER) return IW_PLAYER_LABEL;
  const npcId = actorId === IW_ACTOR_COMPANION ? COMPANION_NPC_ID_BY_LANGUAGE[scene.language] : actorId;
  if (!npcId || !resolveCastMember(scene, npcId)) return null;
  const npc = npcById(npcId);
  return npc ? `${npc.name} — ${npc.occupation}` : null;
}

/**
 * Keep only candidates that belong to THIS scene, and label them from server data.
 *
 * ⚠️ **THE PERFORMER IS DROPPED**, however it was named. Walking to yourself is not a
 * destination, and the companion can arrive under two ids (`companion` and his npcId), so both
 * spellings are checked. Duplicates collapse to their first occurrence for the same reason.
 */
export function resolveCandidates(
  scene: IWScene,
  performerId: string,
  candidates: readonly IWDestinationCandidate[],
): ResolvedDestination[] {
  const places = scenePlaces(scene.layout);
  const companionId = COMPANION_NPC_ID_BY_LANGUAGE[scene.language];
  const canonical = (id: string) => (id === IW_ACTOR_COMPANION ? companionId : id);
  const seen = new Set<string>();
  const out: ResolvedDestination[] = [];

  for (const c of candidates) {
    if (out.length >= IW_MAX_DEST_CANDIDATES) break;
    const distance = Number.isFinite(c.distance) ? Math.max(0, Math.trunc(c.distance)) : 0;
    if (c.kind === 'place') {
      // A tag the scene does not have is refused rather than labelled: the label IS the tag,
      // so accepting an unknown one would let a caller write prose into the prompt.
      if (!(c.tag in places)) continue;
      const key = `place:${c.tag}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ target: { kind: 'place', tag: c.tag }, label: c.tag, distance });
    } else if (c.kind === 'actor') {
      if (canonical(c.actorId) === canonical(performerId)) continue;
      const key = `actor:${canonical(c.actorId)}`;
      if (seen.has(key)) continue;
      const label = actorLabel(scene, c.actorId);
      if (!label) continue;
      seen.add(key);
      out.push({ target: { kind: 'actor', actorId: c.actorId }, label, distance });
    }
  }
  return out;
}

export interface DestinationPromptInput {
  /** The performer, as the registry describes them. */
  who: string;
  /** The author's brief — `ai_walk.instruction`. Quoted, never obeyed as an instruction. */
  brief: string;
  /** The scene notes (migration 160): what this place is, and what its tags mean. */
  sceneNotes: string;
  candidates: readonly ResolvedDestination[];
  heard: readonly HeardLine[];
}

/**
 * The volatile block.
 *
 * ⚠️ **THE BRIEF AND THE HEARD LINES ARE CONTENT, NOT INSTRUCTIONS** (§ 11), so they live here
 * rather than in the system block, and the brief is quoted. The blast radius of an injection is
 * the smallest in iw — the worst outcome is a walk to the wrong entry of a list the engine
 * built — but the habit is the defence.
 */
export function buildDestinationUser(input: DestinationPromptInput): string {
  const list = input.candidates
    .map((c, i) => {
      const where = c.target.kind === 'place' ? 'place' : 'person';
      const far = c.distance <= 1 ? 'right beside them' : `${c.distance} tiles away`;
      return `${i + 1}. ${where}: ${c.label} (${far})`;
    })
    .join('\n');
  const heard = input.heard.length
    ? input.heard.map(h => `${h.speaker} said: "${h.text}"`).join('\n')
    : '(nothing yet)';
  const notes = input.sceneNotes.trim();

  return [
    `THE CHARACTER: ${input.who}`,
    ...(notes ? ['', 'ABOUT THIS SCENE:', notes] : []),
    '',
    'WHERE THEY COULD WALK:',
    list,
    '',
    'WHAT THEY HAVE HEARD, oldest first:',
    heard,
    '',
    `WHAT THEY MEAN TO DO: "${input.brief}"`,
    '',
    `Which number do they walk to? Reply with the number, or ${IW_DEST_NONE}.`,
  ].join('\n');
}

/**
 * Read a reply into a 0-based index, `null` for NONE, or a parse failure.
 *
 * First line only, for the router's reason: a model that appends a sentence of reasoning will
 * mention other numbers in it. The first integer on line one is the answer; anything out of
 * range is `failed`, never clamped — clamping would turn a garbled reply into a real walk.
 */
export function parseDestinationReply(
  raw: string,
  count: number,
): { index: number | null; failed: boolean } {
  const line = raw.trim().split('\n')[0]?.trim() ?? '';
  if (!line) return { index: null, failed: true };
  if (line.toUpperCase().startsWith(IW_DEST_NONE)) return { index: null, failed: false };
  const match = line.match(/\d+/);
  if (!match) return { index: null, failed: true };
  const n = Number(match[0]);
  return n >= 1 && n <= count ? { index: n - 1, failed: false } : { index: null, failed: true };
}

export interface PickDestinationOptions {
  rungs: readonly IWModelRung[];
  input: DestinationPromptInput;
  now?: () => number;
  firstGlyphDeadlineMs?: number;
  totalDeadlineMs?: number;
}

export interface IWDestinationOutcome {
  /** What to walk to, or null — NONE, a dead rung and a bad reply alike (see `detail`). */
  target: IWDestinationTarget | null;
  detail: string;
}

/**
 * Ask the model where the performer should walk.
 *
 * Every failure collapses to `target: null`, as the router's do: the caller has one thing to
 * do about all of them (skip the walk). A single candidate is answered without a call — there
 * is no choice to delegate, and "the only place there is" is always the right destination for
 * a step whose author wanted the NPC to go somewhere.
 */
export async function pickDestination(options: PickDestinationOptions): Promise<IWDestinationOutcome> {
  const { candidates } = options.input;
  if (candidates.length === 0) return { target: null, detail: 'no candidates' };
  if (candidates.length === 1) return { target: candidates[0].target, detail: 'only one destination' };

  const outcome = await runLadder<number | null>({
    rungs: options.rungs.slice(0, 1),
    request: {
      system: IW_DEST_SYSTEM,
      user: buildDestinationUser({
        ...options.input,
        brief: options.input.brief.slice(0, IW_MAX_ACTION_INSTRUCTION_LENGTH),
      }),
      maxTokens: IW_DEST_MAX_TOKENS,
    },
    createSink: () => {
      let buffer = '';
      return {
        push: (delta: string) => {
          buffer += delta;
          // Nothing paints a destination; the buffer is reported only to keep the ladder's
          // first-glyph timer honest (the router's sink does the same).
          return { text: buffer, complete: false };
        },
        finish: () => {
          const { index, failed } = parseDestinationReply(buffer, candidates.length);
          return { value: index, failed };
        },
      };
    },
    now: options.now,
    firstGlyphDeadlineMs: options.firstGlyphDeadlineMs ?? DEST_FIRST_GLYPH_DEADLINE_MS,
    totalDeadlineMs: options.totalDeadlineMs ?? DEST_TOTAL_DEADLINE_MS,
  });

  if (outcome.kind !== 'ok') {
    return { target: null, detail: `picker did not answer (${outcome.attempts.map(a => a.outcome).join(', ') || 'no rungs'})` };
  }
  return outcome.value === null
    ? { target: null, detail: `picker said ${IW_DEST_NONE}` }
    : { target: candidates[outcome.value].target, detail: `picked by ${outcome.rung}` };
}
