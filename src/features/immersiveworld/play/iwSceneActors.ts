import {
  IW_ACTOR_COMPANION, IW_ACTOR_PLAYER, IW_PLAYER_AVATAR, scenePlaces,
  type IWAvatar, type IWFacing, type IWNpcOption, type IWScene,
} from '../../../../server/contracts/iw';
import { freeFarmTileset } from '../../../engine/market/freeFarmTileset';
import { cellKey, type SceneGraph } from '../../../engine/iw/sceneGraph';
import { createSceneActor, sceneActorPosition, type SceneActorState } from '../../../engine/iw/sceneActor';
import { iwLog, iwWarn } from '../iwDebugLog';

/**
 * iwSceneActors — turning a stored scene into the bodies that stand in it.
 *
 * LAYER: feature helper (pure). It sits between the contract (`IWScene`) and the engine
 * (`sceneActor.ts`), which is exactly why it is not in either: the engine must not know what
 * an `IWSceneCastMember` is, and the contract must not know what a sprite is.
 *
 * ⚠️ **THREE KINDS OF BODY, ONE ACTOR LIST.** The learner, the companion and the cast are
 * authored in three different places — two pairs of columns and a jsonb array — and the
 * runtime needs them as one array, in a stable order, because `tickSceneActors` resolves a
 * contested cell by array position and a reshuffle would change who wins. The player is FIRST,
 * deliberately: a learner blocked by an NPC that moved "at the same time" reads it as the game
 * stealing their step.
 *
 * ⚠️ **THE COMPANION IS AN NPC WITH TWO NAMES.** He has an npcId like anyone in the cast, and
 * authored actions address him as the literal string `companion` (`IW_ACTOR_COMPANION`). Both
 * have to resolve to the same body, so {@link actorCells} publishes him under both keys — and
 * he is only placed from the scene's `companionStart*` columns when the cast does NOT already
 * place him, or he would exist twice.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 3, § 12 phase 2.
 */

/** Walk-cycle rate. Slower than a run, fast enough that a two-cell walk is not a slideshow. */
const WALK_FPS = 8;

/**
 * A body's display name, as the nametag/bubble layer needs it.
 *
 * ⚠️ **THE READING TRAVELS WITH THE NAME, rather than being looked up where it is drawn.**
 * `IWNpcOption` carries `pinyin` beside `name`, so the view never has to ask the dictionary
 * what 老板 is read as — which matters because the nametag is drawn every frame and the
 * answer can never change.
 *
 * ⚠️ **THAT IS `pinyin`, NEVER `romanization`.** The other field is author-facing prose that
 * also feeds the prompt: word-grouped rather than character-grouped (`Mǎ Shīfu` is two tokens
 * for 马师傅's three characters) and sometimes carrying a gloss (`Michael (Màikè'ěr)`).
 * `ForeignText` zips one whitespace-separated token per character, so that string mis-assigns
 * syllables and, with them, the tone colours. `server/__tests__/iwNpcPinyin.test.ts` holds the
 * one-syllable-per-character contract that makes this field safe to hand over.
 */
export interface IWSpeakerName {
  /** What is printed. */
  text: string;
  /** The reading of {@link text}, one syllable per character. Empty when it has none. */
  pinyin: string;
  /**
   * Is this an IN-WORLD name (an NPC's), or a word a view supplied for somebody (the
   * learner's "You")? Only the first is rendered through `ForeignText` — running "You"
   * through a cpcd layout in a `zh` scene would spell it out as three Chinese columns.
   */
  foreign: boolean;
}

/** One body on the board, with everything a renderer needs and nothing it does not. */
export interface IWSceneBody {
  /** `player`, or an npcId. Never the literal `companion` — see {@link actorCells}. */
  id: string;
  /** Null for the learner, who has no NPC entry at all (`IW_PLAYER_AVATAR` is their body). */
  npc: IWNpcOption | null;
  avatar: IWAvatar;
  /**
   * Display name. Empty for the learner, who wears no nametag — their body IS where they
   * are looking.
   *
   * ⚠️ A PLAIN STRING, because this is also what the PROMPT sees (`labelFor`). The reading
   * lives next to it in {@link pinyin} rather than inside it, so nothing an NPC is told about
   * who is present can ever gain a pinyin row.
   */
  label: string;
  /** {@link label}'s reading, for the nametag. Empty when there is none. */
  pinyin: string;
}

/**
 * A body's current pose, recomputed every frame from its actor state.
 *
 * ⚠️ NO NAME HERE. The head label used to be drawn inside the canvas from a `label` on this
 * shape; it is DOM now (a cpcd nametag — `IWSpeechBubbles`), fed from `speakerLabels`, which
 * changes when the cast does rather than 60×/sec.
 */
export interface IWBodyDrawable {
  id: string;
  isoX: number;
  isoY: number;
  imagePath: string;
}

/** A cell → its `"col,row"` key, guarding an authored value that is off the board. */
function clampedCell(col: number, row: number, graph: SceneGraph): string {
  const c = Math.min(Math.max(Math.round(col), 0), graph.width - 1);
  const r = Math.min(Math.max(Math.round(row), 0), graph.height - 1);
  return cellKey(c, r);
}

/**
 * The starting actors and their identities, player first.
 *
 * ⚠️ A body authored onto a cell that is NOT walkable is placed there anyway. It happens for
 * real — a cast member on a cell that later grew a tree — and the alternative (relocating them
 * silently) puts a person somewhere the author did not put them. `planScenePath` already
 * returns null from an unwalkable origin, so such a body simply cannot walk until it is moved,
 * which is a visible authoring bug rather than an invisible one.
 */
export function buildSceneBodies(
  scene: IWScene,
  npcs: readonly IWNpcOption[],
  graph: SceneGraph,
): { actors: SceneActorState[]; bodies: Map<string, IWSceneBody>; companionId: string | null } {
  const byId = new Map(npcs.map(npc => [npc.id, npc]));
  const actors: SceneActorState[] = [];
  const bodies = new Map<string, IWSceneBody>();

  const playerCell = clampedCell(scene.playerStartCol, scene.playerStartRow, graph);
  actors.push(createSceneActor(IW_ACTOR_PLAYER, playerCell, scene.playerStartFacing));
  bodies.set(IW_ACTOR_PLAYER, {
    id: IW_ACTOR_PLAYER, npc: null, avatar: IW_PLAYER_AVATAR, label: '', pinyin: '',
  });

  for (const member of scene.npcCast ?? []) {
    const npc = byId.get(member.npcId) ?? null;
    actors.push(createSceneActor(member.npcId, clampedCell(member.col, member.row, graph), member.facing));
    bodies.set(member.npcId, {
      id: member.npcId,
      npc,
      // An npcId the code no longer defines still gets a body — the cast is TEXT, not a
      // foreign key — rather than a hole in the scene where somebody was standing.
      avatar: npc?.avatar ?? 'male',
      label: npc?.name ?? member.npcId,
      // An npcId standing in for a missing NPC has no reading — the nametag then prints the
      // id alone rather than inventing one.
      pinyin: npc?.pinyin ?? '',
    });
  }

  // The companion walks into every scene (§ 14 Q25), but only needs a cast entry when the
  // author wants him somewhere specific. Place him from the scene's own columns when nobody
  // has already placed him.
  const companion = npcs.find(npc => npc.isCompanion) ?? null;
  if (companion && !bodies.has(companion.id)) {
    actors.push(createSceneActor(
      companion.id,
      clampedCell(scene.companionStartCol, scene.companionStartRow, graph),
      scene.companionStartFacing,
    ));
    bodies.set(companion.id, {
      id: companion.id, npc: companion, avatar: companion.avatar,
      label: companion.name, pinyin: companion.pinyin,
    });
  }

  // ⚠️ THE CAST AND THE BODIES ARE NOT THE SAME SET. Every body here must be answerable by
  // `takeNpcTurn`, which resolves an npcId through `resolveCastMember` — the stored cast PLUS
  // the derived companion row. A body outside that set is drawn, walkable and addressable but
  // structurally unable to reply, and the learner sees only the generic "Not right now."
  // banner, so it is worth a console line rather than a silent reconciliation here: the two
  // sides disagreeing means one of them has a bug, and guessing which would hide it.
  const castIds = new Set((scene.npcCast ?? []).map(m => m.npcId));
  for (const id of bodies.keys()) {
    // The PLAYER is a body and is cast in nothing by definition — he is never addressed by a
    // turn, so he is not part of this reconciliation.
    if (id === IW_ACTOR_PLAYER) continue;
    if (!castIds.has(id) && id !== companion?.id) {
      iwWarn('scene', `body "${id}" is neither cast nor the companion — the server will refuse every turn addressed to him`, {
        bodyIds: [...bodies.keys()], castIds: [...castIds], companionId: companion?.id ?? null,
      });
    }
  }
  iwLog('scene', `built ${actors.length} actors`, {
    bodyIds: [...bodies.keys()], castIds: [...castIds], companionId: companion?.id ?? null,
  });

  return { actors, bodies, companionId: companion?.id ?? null };
}

/**
 * Actor id → cell, as an authored step's `actor` field spells it.
 *
 * The companion appears TWICE — under his npcId and under `companion` — because a script may
 * name him either way and both must find the same body. Cheap by construction: it is one extra
 * entry in a map of at most ten.
 */
export function actorCells(
  actors: readonly SceneActorState[],
  companionId: string | null,
): Map<string, string> {
  const cells = new Map<string, string>();
  for (const actor of actors) cells.set(actor.id, actor.cell);
  if (companionId && cells.has(companionId)) cells.set(IW_ACTOR_COMPANION, cells.get(companionId)!);
  return cells;
}

/** Resolve an authored actor reference (`player` / `companion` / an npcId) to a body id. */
export function resolveActorId(ref: string, companionId: string | null): string {
  return ref === IW_ACTOR_COMPANION && companionId ? companionId : ref;
}

/**
 * The sprite frame a body shows this instant.
 *
 * Frame selection mirrors the night market's (`computeDrawable`): a walking body cycles its
 * directional frames on a wall clock, a standing one shows frame 0. Matching it rather than
 * inventing a cadence is what keeps an NPC in a scene from walking differently to a pedestrian
 * in the market, which would be visible the moment somebody saw both.
 */
export function bodyDrawable(
  actor: SceneActorState,
  body: IWSceneBody,
  nowMs: number,
): IWBodyDrawable {
  const [isoX, isoY] = sceneActorPosition(actor);
  const walking = actor.progress > 0;
  const frames = walking
    ? freeFarmTileset.getWalkFrames(body.avatar, actor.facing)
    : freeFarmTileset.getIdleFrames(body.avatar, actor.facing);
  const index = walking && frames.length > 0
    ? Math.floor((nowMs * WALK_FPS) / 1000) % frames.length
    : 0;
  return { id: actor.id, isoX, isoY, imagePath: frames[index] ?? '' };
}

/**
 * Every place tag whose cell the learner can poke, with the cell it resolves to.
 *
 * Only tags carrying an INTERACTION are returned: a place with no script is an ordinary walk
 * destination and highlighting it would promise something that does not happen (§ 14 Q43 —
 * "a place with no entry here is an ordinary walk destination").
 */
export function interactivePlaces(scene: IWScene): Array<{ tag: string; cell: string }> {
  const places = scenePlaces(scene.layout);
  return Object.entries(scene.interactions ?? {})
    .filter(([tag, steps]) => steps?.length && places[tag])
    .map(([tag]) => ({ tag, cell: places[tag] }));
}

/** The four facings, as the engine spells them — re-exported so a view need not reach further. */
export type { IWFacing };
