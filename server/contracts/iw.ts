/**
 * iw.ts — the client↔server contract for the Immersive World (iw) SCENE, plus the
 * closed action vocabulary a scene's completion pair is drawn from.
 *
 * WHY A SECOND CONTRACT FILE. `wire.ts` is the app-wide contract and is already large;
 * iw is a self-contained feature whose types are read by exactly one page (the scene
 * editor) and one service. It follows every rule in wire.ts's header — no relative value
 * imports, no `enum` (tsconfig.app.json sets `erasableSyntaxOnly`), no Node/DOM globals,
 * no `Date` — so it typechecks under both the server (NodeNext) and client (bundler)
 * programs.
 *
 * WHAT IS *NOT* HERE: the NPCs themselves. An NPC is a prompt and lives in
 * `server/config/iwNpcs.ts` (docs/IMMERSIVE_WORLD.md § 14 Q2). The editor never sends an
 * NPC's text over the wire — it sends an id, and `IWNpcOption` below is the thin
 * projection the picker needs to render a choice.
 *
 * Referenced by: server/services/iw/sceneValidation.ts, server/services/ImmersiveWorldSceneService.ts,
 * server/dal/interfaces/IImmersiveWorldDAL.ts, src/features/immersiveworld/immersiveWorldSceneApi.ts.
 * Documented in docs/IMMERSIVE_WORLD.md § 12 phase 1d.
 */

// ─────────────────────────────────────────────────────────────────────────────
// The action vocabulary (docs/IMMERSIVE_WORLD.md § 5.4, § 14 Q42)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ `IW_ACTIONS` IS GONE (2026-09-05). There is no longer a global closed set of verbs the
 * model emits per turn.
 *
 * It was replaced by AUTHORED ACTIONS (§ 14 Q42): every behaviour an NPC can perform is a
 * named script an author wrote for that NPC in that scene, and the model's only movement
 * decision is *which named action fits this moment* — it never composes one. The primitives
 * that used to live here did not disappear; they became STEP KINDS below, so an author can
 * program each of them explicitly.
 *
 * The rationale, in the author's words: **"I don't trust the AI to get them right."** A model
 * emitting `walk_to_item noodle_pot` invents a target nothing validated (§ 5.6b saw exactly
 * that); an author picking "walk to the water station" from a list of tagged cells cannot.
 *
 * Two members were NOT carried over:
 *   - `idle` — an action that does nothing is a `wait` step, or no chosen action at all.
 *   - `walk_to_item` and `follow` — the first is subsumed by `walk_to_tag` (items were never
 *     modelled, and a tagged cell is the thing that actually exists); the second is a
 *     persistent MODE rather than a step, and nothing has asked for it yet.
 */

/**
 * ⚠️ `IW_COMPLETION_ACTIONS` IS GONE (2026-09-05). There is no closed set of completion
 * verbs, because there is no closed set of verbs at all.
 *
 * The scene's completion action is now **one of the completer NPC's own authored actions**,
 * named by its `IWNpcAction.id` in `IWScene.completionAction`. "Accepting payment" is not a
 * primitive the engine knows — it is something the author PROGRAMS (walk to the learner, say
 * a line, take the money, thank them) and then nominates as the action that ends the scene.
 *
 * This is the same move as the `IW_ACTIONS` deletion below, applied to the one verb list
 * that survived it: an author who can program the behaviour does not need the engine to
 * enumerate it. It also makes completion checkable at authoring time in a stronger sense
 * than before — not "some action contains an `accept_payment` step" but "this exact action
 * exists on this exact NPC" (`sceneValidation.ts`).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Board geometry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A scene board is authored in TEMPLATE CELLS (col,row), migration 112's convention —
 * NOT isoX/isoY. Cell (0,0) is the SW / minimum-iso corner. Bounds mirror the night
 * market editor's (`MIN_TEMPLATE_DIM`/`MAX_TEMPLATE_DIM`) because the same authoring
 * surface produces both.
 */
export const IW_MIN_SCENE_DIM = 2;
export const IW_MAX_SCENE_DIM = 60;

export const IW_MAX_SCENE_NAME_LENGTH = 120;
/**
 * ⚠️ `IW_MAX_OBJECTIVE_LENGTH` IS GONE (2026-09-05), with the `objective` field and its
 * column (migration 159). Migration 158 described the objective as "read by the completion
 * check" — but the completion check reads `completerNpcId` + `completionAction` and nothing
 * else, and since Q42 made the completion action an AUTHORED action of the completer's, the
 * objective restated in prose exactly what that action already says in steps. Two
 * descriptions of one fact, one of them with no reader.
 */
export const IW_MAX_COMPLICATION_LENGTH = 400;
export const IW_MAX_CONVERSATION_LINE_LENGTH = 200;

/** Per-scene collection caps — authoring guard-rails, not engine limits. */
export const IW_MAX_CAST = 8;
export const IW_MAX_COMPLICATIONS = 12;
/** Named places on the board an authored action can send somebody to (§ 14 Q42). */
export const IW_MAX_LOCATIONS = 24;
export const IW_MAX_LOCATION_TAG_LENGTH = 40;
/** Authored actions per NPC, and steps per action. */
export const IW_MAX_NPC_ACTIONS = 8;
export const IW_MAX_ACTION_STEPS = 16;
export const IW_MAX_ACTION_NAME_LENGTH = 60;
export const IW_MAX_ACTION_WHEN_LENGTH = 200;
export const IW_MAX_ACTION_COMMENT_LENGTH = 200;
/** A single `wait` step, in whole seconds. A minute is already a very long beat. */
export const IW_MAX_WAIT_SECONDS = 60;
export const IW_MAX_CONVERSATIONS = 8;
export const IW_MAX_CONVERSATION_TURNS = 12;

/** The four facings a placed body can be authored with. Mirrors the engine's `Direction`. */
export const IW_FACINGS = ['n', 'e', 's', 'w'] as const;
export type IWFacing = (typeof IW_FACINGS)[number];

/** Author-facing labels for the four facings — one source of truth for every picker. */
export const IW_FACING_LABELS: Record<IWFacing, string> = {
  n: 'North (away, up-right)',
  e: 'East (down-right)',
  s: 'South (toward camera, down-left)',
  w: 'West (up-left)',
};

/**
 * The two sprite bodies the asset pack authors. Mirrors `PlayerGender` in
 * `src/engine/market/freeFarmTileset.ts` and `IWAvatar` in `server/types/iwNpc.ts`; a
 * contract file may not import from either side, so the three are kept in step by hand —
 * the same accepted pattern as the blocking-decor mirror noted in
 * `server/dal/shared/versionSelection.ts`.
 */
export type IWAvatar = 'male' | 'female';

/**
 * The learner's body, and the companion's.
 *
 * ⚠️ NOT AUTHORED, and deliberately not stored on a scene. Every scene has exactly one
 * learner and one companion, and they look the same in all of them — a per-scene choice
 * would be a way to make the same person unrecognisable between Tuesday and Wednesday.
 * The companion's avatar comes from his NPC entry (he IS an NPC); the learner has no NPC
 * entry at all, so `IW_PLAYER_AVATAR` is the only place their body is decided.
 */
export const IW_PLAYER_AVATAR: IWAvatar = 'female';

// ─────────────────────────────────────────────────────────────────────────────
// The five authored blobs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The scene's map, stored in `iw_scenes.layout`.
 *
 * This is the night-market template shape MINUS its night-market-only lists
 * (`placeholder`, `condition`) — a scene has no occupant slots to unlock and no
 * conditional overlay. It is EXPECTED TO CHANGE (see migration 158's header): iw is not a
 * night market, and this is a starting point rather than a contract, chosen because that
 * editor is the only layout authoring tool that exists today.
 *
 * ⚠️ **THERE ARE NO WALKABILITY MASKS HERE** (2026-09-05). `street` and `communal` — the
 * night market's two mutually-exclusive walkable classes — were removed, because a scene
 * inverts that model: **every in-bounds cell is walkable**, and the only thing that makes a
 * cell impassable is a BLOCKING asset standing on it (a tree or a common prop; see
 * `farmTerrain.isBlockingDecorUrl`). Flush family decor and planks stay walkable.
 *
 * The reason the inversion is right: the night market is mostly not-walkable (stalls and
 * terrain) with paths carved through it, so painting the walkable set is the cheap
 * description. A scene is a small enclosed place a learner moves around in — a shop floor,
 * a courtyard — so the walkable set is nearly everything and painting it would be busywork
 * that an author could silently get wrong, stranding an NPC on an unpainted cell.
 *
 * Consequences: `walk_to_tag` and every other movement step path over
 * `{all cells} − {cells with blocking decor}`, nothing in the editor paints walkability, and
 * a layout jsonb written before this change may still carry `street`/`communal` keys — they
 * are ignored on read and dropped on the next save (jsonb, so no migration).
 */
export interface IWSceneLayout {
  /** Terrain-1 mask cells, each "col,row". */
  terrain1: string[];
  /** Terrain-2 mask cells, each "col,row" — renders over terrain 1. */
  terrain2: string[];
  /** Per-cell decor: "col,row" → decor sprite stem. */
  decor: Record<string, string>;
  /**
   * NAMED PLACES: "col,row" → an author-chosen tag ("water station", "counter").
   *
   * Lives in `layout` rather than in a column of its own because a tagged cell IS board
   * data — it is where something is, in the same sense that a decor cell is. It needs no
   * migration for the same reason.
   *
   * Keyed by CELL, so one cell carries at most one tag. The reverse is deliberately not
   * true: **several cells may share a tag**, and that is the useful case — tag three cells
   * "counter" and `walk_to_tag` heads for whichever is nearest.
   */
  locations?: Record<string, string>;
  /**
   * The board-wide default FLOOR — what a cell shows where no terrain mask covers it.
   * Not a cell list: one setting for the whole scene.
   *
   * OMITTED ⇒ `{ kind: 'dirt' }`, which is what every scene authored before the floor row
   * existed carries and what the night market has always rendered. `seed` freezes the wood
   * deck's random plank grain so it is stable across reloads; re-picking Wood re-rolls it.
   * The client mirror of this shape is `BoardFloor` in `src/engine/market/farmTerrain.ts`.
   */
  floor?: IWSceneFloor;
}

/** The scene's board-wide floor. See {@link IWSceneLayout.floor}. */
export interface IWSceneFloor {
  kind: 'dirt' | 'wood';
  /** 32-bit seed; meaningless for `dirt`, kept so toggling back to wood restores the deck. */
  seed: number;
}

/**
 * One placed NPC, stored in `iw_scenes."npcCast"`.
 *
 * NO `role` FIELD, deliberately (migration 158, 2026-09-04): an NPC's part in the scene is
 * baked into who they are and they act accordingly. The companion needs an entry here only
 * when a scene wants him placed somewhere specific.
 */
export interface IWSceneCastMember {
  /** An id into `server/config/iwNpcs.ts`. TEXT, not a foreign key — the referent is code. */
  npcId: string;
  col: number;
  row: number;
  facing: IWFacing;
  /**
   * The authored ACTIONS this NPC may perform in this scene (§ 14 Q42).
   *
   * Per (scene, NPC), which is why they live on the cast member rather than beside the NPC
   * in code: "bring water" belongs to the tea house, not to 王婶 everywhere she appears.
   * Omitted or empty means the NPC has no scripted behaviour and only speaks.
   */
  actions?: IWNpcAction[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Authored NPC actions (§ 14 Q42)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The step kinds an authored action can be built from — the WHOLE behavioural vocabulary of
 * the feature (§ 14 Q42). There is no second list: what an NPC can do is what an author can
 * program here.
 *
 * This absorbed the old `IW_ACTIONS` on 2026-09-05, and then SHED four members the same day.
 * `accept_payment` / `hand_over` / `give_item` / `refuse` were briefly steps; they are not.
 * They were never primitives — "accepting payment" is a little scene of its own (walk over,
 * say something, take the money), which is to say it is exactly what an authored ACTION is.
 * Keeping them as steps meant the engine had to know what a transaction was in order to
 * animate a gesture it could not define. An author programs one instead and nominates it as
 * the scene's completion (see the `IW_COMPLETION_ACTIONS` note above).
 *
 * The test for whether something belongs here: **can the engine execute it without knowing
 * what the scene is about?** Walking, facing, waiting, saying and playing a canned
 * conversation all pass. A payment does not.
 */
export const IW_ACTION_STEP_KINDS = [
  'comment',
  'walk_to_tag',
  'walk_to_actor',
  'walk_away_from',
  'face',
  'wait',
  'wait_for_response',
  'start_conversation',
] as const;

export type IWActionStepKind = (typeof IW_ACTION_STEP_KINDS)[number];

/** Human labels for the step kinds — one source of truth for the editor's picker. */
export const IW_ACTION_STEP_LABELS: Record<IWActionStepKind, string> = {
  comment: 'Say',
  walk_to_tag: 'Walk to place',
  walk_to_actor: 'Walk to person',
  walk_away_from: 'Walk away from',
  face: 'Turn to face',
  wait: 'Wait',
  wait_for_response: 'Wait for the learner',
  start_conversation: 'Start a conversation',
};

/** The step kinds whose only parameter is WHO they are aimed at. */
export const IW_ACTOR_STEP_KINDS = ['walk_to_actor', 'walk_away_from', 'face'] as const;

export type IWActorStepKind = (typeof IW_ACTOR_STEP_KINDS)[number];

export const isActorStepKind = (k: IWActionStepKind): k is IWActorStepKind =>
  (IW_ACTOR_STEP_KINDS as readonly string[]).includes(k);

/** One actor-aimed step, narrowed. `IWActionStep` union member for the three WHO kinds. */
export type IWActorStep = Extract<IWActionStep, { actor: string }>;

/**
 * Narrows a STEP, not just its kind — `isActorStepKind(step.kind)` cannot narrow `step`
 * itself, so a caller reading `step.actor` after that check would not typecheck.
 */
export const isActorStep = (step: IWActionStep): step is IWActorStep =>
  isActorStepKind(step.kind);

/**
 * One step of an authored action. A discriminated union rather than one shape with several
 * optional fields, so a `walk_to_tag` step cannot carry a stray `seconds` and the editor's
 * kind-picker has to REPLACE a step rather than mutate it into an inconsistent state.
 */
export type IWActionStep =
  /**
   * Make the NPC say something. ⚠️ **This step costs a model call, by design.** The text is
   * the CONTENT — what is said stays more or less what the author wrote — and the model's
   * job is to embellish it: the NPC's current mood, its personality, how many times this has
   * already come up, its opinion of the learner, and plain variance so a scene replayed on
   * day 12 does not read like day 11. It is the only step that is not executed verbatim.
   */
  | { kind: 'comment'; text: string }
  /** Path to the nearest cell adjacent to a cell tagged `tag`, then face it. */
  | { kind: 'walk_to_tag'; tag: string }
  /** Play one of the scene's authored NPC-to-NPC conversations (§ 14 Q6). */
  | { kind: 'start_conversation'; conversationId: string }
  /** Hold still for `seconds`. The beat that makes a script read as behaviour. */
  | { kind: 'wait'; seconds: number }
  /** Hand the floor back to the learner. At most one, and only as the final step. */
  | { kind: 'wait_for_response' }
  /**
   * Everything aimed at a person: move toward, move away, turn to face. One shape for all
   * three because they differ only in what the engine animates — the author is answering the
   * same question, *who*.
   */
  | { kind: IWActorStepKind; actor: string };

/** The two non-NPC bodies a `walk_to_actor` step may target. */
export const IW_ACTOR_PLAYER = 'player';
export const IW_ACTOR_COMPANION = 'companion';

/**
 * One authored action — a named script the model may CHOOSE, and the engine then PLAYS.
 *
 * This is the division of labour the whole idea rests on: the model decides *whether* the
 * moment calls for "bring water"; the author decides exactly what bringing water looks
 * like. The model never improvises movement, and the author never has to anticipate when
 * water is wanted.
 */
export interface IWNpcAction {
  /** Author-assigned, stable within the NPC. What a run would record. */
  id: string;
  /** What the model sees and chooses by, so it must read as an intention: "bring water". */
  name: string;
  /** Optional guidance on when it fits. The model's only hint beyond the name. */
  when?: string;
  /** The script, in order. */
  steps: IWActionStep[];
}

/**
 * One complication seed, stored in `iw_scenes.complications`. ENVIRONMENTAL (§ 14 Q31,
 * corrected 2026-09-04): it belongs to the world, not to an NPC — the rain starts, the
 * power cuts, a queue forms — and everyone present reacts to it out of their own
 * character. One is drawn at random per run, which is the only thing making day 12
 * different from day 11.
 */
export interface IWComplication {
  /** Author-assigned, stable within the scene. Stored on a run as `complicationId`. */
  id: string;
  description: string;
}

/**
 * How long each line of an overheard conversation stays on screen before the next one
 * plays. A FIXED CONSTANT, not an authored field (2026-09-05).
 *
 * There used to be a per-turn `holdMs`. It was removed because pacing is not a thing an
 * author should have to get right line by line: a uniform beat is legible, and a field that
 * is usually left blank only produces conversations that are inconsistently paced for no
 * deliberate reason. If a scene ever genuinely needs a dramatic pause, that is an argument
 * for a pause *marker* in the line, not for a number on every line.
 */
export const IW_CONVERSATION_LINE_MS = 7000;

/** One line of an authored NPC-to-NPC exchange (§ 14 Q6). */
export interface IWConversationTurn {
  /** Who speaks. Must be in the scene's cast. */
  npcId: string;
  /** The line, in the scene's language. Pre-reviewed by construction — never generated. */
  text: string;
}

/**
 * One authored NPC-to-NPC conversation, stored in `iw_scenes.conversations` (§ 14 Q6).
 * Played back by the engine with no model calls; the learner can tap to pause it, and it
 * yields if the learner speaks.
 */
export interface IWConversation {
  id: string;
  /** Author-facing only — never shown to the learner, never sent to a model. */
  title?: string;
  turns: IWConversationTurn[];
}

// ─────────────────────────────────────────────────────────────────────────────
// The scene, over the wire
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A whole scene as the editor loads and saves it — one `iw_scenes` row, blobs inline.
 *
 * A scene is loaded in its ENTIRETY exactly once, at scene start; that is the property
 * that made the five child tables five jsonb columns (migration 158's header).
 */
export interface IWScene {
  /** Absent on a create; present on every read. */
  id?: string;
  /** A cast is authored per language — a Spanish scene is new content (§ 14 Q8). */
  language: 'zh' | 'es';
  name: string;
  published: boolean;

  /**
   * The completion pair (§ 9.2): exactly one NPC doing exactly one action.
   *
   * `completionAction` is an `IWNpcAction.id` on THAT NPC's cast entry — the author programs
   * the action, then nominates it here. It is a plain string rather than an enum because the
   * vocabulary is authored per scene, and it is stored on the scene rather than as a flag on
   * the action so that "which action ends this" stays one lookup in one place.
   */
  completerNpcId: string;
  completionAction: string;

  /**
   * Board geometry, in template cells, plus the direction each body faces when the scene
   * opens. The facings are columns rather than blob fields for the same reason the cells
   * are: the learner and the companion are not cast members and have no entry to live in.
   */
  playerStartCol: number;
  playerStartRow: number;
  playerStartFacing: IWFacing;
  companionStartCol: number;
  companionStartRow: number;
  companionStartFacing: IWFacing;
  width: number;
  height: number;

  layout: IWSceneLayout;
  npcCast: IWSceneCastMember[];
  complications: IWComplication[];
  conversations: IWConversation[];

  createdAt?: string;
  updatedAt?: string;
}

/** A row in the editor's scene list — everything needed to pick one, nothing more. */
export interface IWSceneSummary {
  id: string;
  language: 'zh' | 'es';
  name: string;
  published: boolean;
  width: number;
  height: number;
  castCount: number;
  complicationCount: number;
  updatedAt: string;
}

/**
 * One NPC as the editor's picker sees it (§ 14 Q2's "populate the list from the code
 * constant rather than accepting free text" — which turns the runtime-lookup risk into a
 * UI affordance).
 *
 * NOTE WHAT IS ABSENT: every prose field. The editor shows who an NPC is well enough to
 * choose them; it never displays or edits NPC text, which is the § 11 layer-1 boundary.
 */
export interface IWNpcOption {
  id: string;
  language: 'zh' | 'es';
  name: string;
  romanization: string;
  occupation: string;
  /**
   * Which of the two sprite bodies stands for this NPC. The one COSMETIC field that crosses
   * the wire, and it has to: the editor draws the actual avatar on the board rather than a
   * coloured square, so it needs to know which body to draw before anything is placed.
   */
  avatar: IWAvatar;
  /** True when this NPC is the language's companion — he walks into every scene (§ 14 Q25). */
  isCompanion: boolean;
  /**
   * True when the NPC has a `completionRule`. Only such an NPC can be a scene's completer:
   * without one, the character has no idea what it would be agreeing to (§ 14 Q27).
   */
  canComplete: boolean;
}
