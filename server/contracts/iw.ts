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
/**
 * The scene brief (migration 160) — what the scene is, and what its place tags mean. Generous
 * because it is the ONLY prose an author writes about a scene, and because it is read by a
 * model rather than rendered in a fixed-width row; a cap exists only so a runaway paste
 * cannot dominate every NPC's prompt.
 */
export const IW_MAX_SCENE_NOTES_LENGTH = 2000;
export const IW_MAX_COMPLICATION_LENGTH = 400;
/** An event seed is the same kind of one-liner as a complication, so it gets the same cap. */
export const IW_MAX_EVENT_LENGTH = 400;
export const IW_MAX_CONVERSATION_LINE_LENGTH = 200;

/** Per-scene collection caps — authoring guard-rails, not engine limits. */
export const IW_MAX_CAST = 8;
export const IW_MAX_COMPLICATIONS = 12;
/** Authored events a scene may hold (migration 161) — the pool `schedule_event` picks from. */
export const IW_MAX_EVENTS = 12;
export const IW_MAX_PLACE_TAG_LENGTH = 40;
/** Authored actions per NPC, and steps per action. */
export const IW_MAX_NPC_ACTIONS = 8;
export const IW_MAX_ACTION_STEPS = 16;
export const IW_MAX_ACTION_NAME_LENGTH = 60;
export const IW_MAX_ACTION_WHEN_LENGTH = 200;
export const IW_MAX_ACTION_COMMENT_LENGTH = 200;
/** An `ai_walk` brief. Same cap as `when` — both are one sentence of guidance to the model. */
export const IW_MAX_ACTION_INSTRUCTION_LENGTH = 200;
/**
 * How many cues may unlock ONE dependent action or conversation ({@link IWSelectable.unlockedBy}).
 *
 * Deliberately far below `IW_MAX_COMPLICATIONS + IW_MAX_EVENTS`: a gate listing every cue in
 * the scene is not a gate, it is an action that is always available written the long way. A
 * handful is what "this only makes sense once X has happened" ever needs.
 */
export const IW_MAX_UNLOCK_CUES = 8;
/** A single `wait` step, in whole seconds. A minute is already a very long beat. */
export const IW_MAX_WAIT_SECONDS = 60;
/**
 * The longest delay a `schedule_event` step (or an event's own `atStartSeconds`) may ask for.
 * Wider than `IW_MAX_WAIT_SECONDS` because nobody is standing still for it: the NPC walks on
 * and the timer runs in the background, so a five-minute slow burn is a legitimate beat.
 */
export const IW_MAX_EVENT_DELAY_SECONDS = 600;
export const IW_MAX_CONVERSATIONS = 8;
export const IW_MAX_CONVERSATION_TURNS = 12;

/**
 * Steps in one place's INTERACTION script (§ 14 Q43). Shorter than an NPC action's sixteen,
 * deliberately: an interaction is a *response to a poke* — show the thing, have somebody
 * react, set something going — and a twelve-beat set piece hung off a doorway is a scene
 * pretending to be a prop.
 */
export const IW_MAX_INTERACTION_STEPS = 8;
/** A popup's caption, in the author's own words. One line under a picture, not a paragraph. */
export const IW_MAX_POPUP_CAPTION_LENGTH = 200;
/**
 * A popup image id: the FILE STEM of a picture in `src/assets/iw-popups/` (see
 * `src/features/immersiveworld/iwPopupArt.ts`). Constrained here rather than checked against
 * a list because the catalogue is CLIENT art the server cannot see — the pattern is what
 * stops a hand-edited payload from putting a path or a URL in the field.
 */
export const IW_POPUP_IMAGE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

// ─────────────────────────────────────────────────────────────────────────────
// § 7's budget — the three numbers the CLIENT must also know
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ THE REST OF § 7's BUDGET IS NOT HERE. `IWTurnBudget` in
 * `server/services/iw/turnBudget.ts` owns the whole bound and re-exports these three; only
 * the numbers a WELL-BEHAVED CLIENT has to respect are contract, and the session budget and
 * the daily cap are not among them (a learner is never shown either — § 7 asks for the
 * wind-down to read in-world rather than as a quota bar).
 *
 * They are here rather than duplicated as client constants for the ordinary reason: a mirror
 * drifts the first time a limit is tuned, and the symptom is a composer that lets a learner
 * finish a sentence the server then refuses.
 */
/**
 * The hard cap on one learner utterance, in characters.
 *
 * Sized against the thing being protected, which is the PROMPT, not the database: layer 3
 * quotes the learner's text verbatim (§ 11), so an unbounded utterance is an unbounded
 * prompt and a way to blow past the cached prefix into an arbitrarily expensive call. 120
 * characters is several sentences of Chinese and far more than a beginner produces; a
 * learner who genuinely wants to say more can send it as two turns.
 */
export const IW_MAX_UTTERANCE_CHARS = 120;

/**
 * The minimum gap between two turns from the same user, in ms.
 *
 * NOT a per-IP `express-rate-limit` window (`middleware/rateLimits.ts`), because those are
 * sized to catch scripted floods over minutes and iw's abuse shape is a tight loop over
 * seconds. 700 ms is below any human's send cadence — a real turn takes ~1 s of model time
 * before the learner has even read the reply — and above what a loop can exploit.
 *
 * ⚠️ It bounds SENDS, not model calls: one send can legitimately fan out to several NPCs
 * (§ 4.1), which is what {@link IW_MAX_LISTENERS_PER_UTTERANCE} bounds instead.
 */
export const IW_MIN_TURN_GAP_MS = 700;

/**
 * How many NPCs one utterance may be routed to.
 *
 * § 4.1 decided that every audible NPC decides for itself whether to answer, so a single
 * utterance is several model calls; § 7 says the ~800 µ$/turn figure must be multiplied by
 * the audible cast size before any budget is set. The design target is 2–4, so 4 is the cap
 * and a fifth listener is dropped rather than refused — a scene with a crowd in it should
 * get quieter, not error.
 */
export const IW_MAX_LISTENERS_PER_UTTERANCE = 4;

/**
 * The emote channel of an NPC's reply (§ 5.1 line 3). Drives a sprite; NEVER rendered as text.
 *
 * ⚠️ SINGLE-SOURCED WITH THE BENCH. `server/scripts/bench/npc-latency/scenario.js` →
 * `EMOTE_KINDS` holds the same six, and its prompt contract lists them to the model. The
 * bench must grade the same production the game ships (`npcPrompt.ts`'s header), so if this
 * list changes, that one changes with it or a passing sweep proves nothing.
 *
 * Six rather than a rich set, on purpose: the emote is what makes a beginner-legible
 * judgement visible (§ 9a) when the Chinese itself is too subtle to read, and a learner
 * cannot distinguish twenty sprites at a glance.
 */
export const IW_EMOTES = ['neutral', 'curious', 'pleased', 'confused', 'impatient', 'amused'] as const;
export type IWEmote = (typeof IW_EMOTES)[number];

/** The emote a reply degrades to when the model supplied none the parser could read. */
export const IW_DEFAULT_EMOTE: IWEmote = 'neutral';

/**
 * What line 2 says when the NPC does nothing — and the value the parser degrades an
 * unreadable action line to. Mirrors `NO_ACTION` in the bench's `scenario.js`.
 */
export const IW_NO_ACTION = 'none';

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
   * NAMED PLACES: an author-chosen tag ("water station", "counter") → the ONE cell it names,
   * as "col,row".
   *
   * Lives in `layout` rather than in a column of its own because a tagged cell IS board
   * data — it is where something is, in the same sense that a decor cell is. It needs no
   * migration for the same reason.
   *
   * Keyed by TAG (2026-09-05; it used to be keyed by cell), so **a tag resolves to exactly
   * one cell** — `walk_to_tag` has a single destination and never has to pick a nearest.
   * The reverse is deliberately still free: **several tags may name the same cell**, so a
   * counter can be both "counter" and "where the tea is" without duplicating the spot.
   *
   * An author may name a place before putting it on the board; such a tag is stored with an
   * EMPTY cell, which the validator rejects — "named but never placed" must not be saveable,
   * because an action that walks there would walk nowhere.
   */
  places?: Record<string, string>;
  /**
   * ⚠️ THE OLD NAME FOR {@link places} (renamed 2026-09-06). READ-ONLY: `scenePlaces` falls
   * back to it so a row written before the rename still opens, and nothing ever writes it
   * again — the next save of such a scene stores `places` and drops this key.
   *
   * The rename was overdue rather than cosmetic. Every other surface in the feature already
   * said PLACE — `IWScenePlacesPanel`, `PlaceChip`, the `walk_to_tag` label ("Walk to place"),
   * `IWSceneInteractions`'s "keyed by place name", and every paragraph of § 14 Q42/Q43 — while
   * the stored key alone said `locations`, which also collides with the night market's
   * unrelated `nightmarkettemplatelocations`. Migration 163 renames the key in the one stored
   * row; this fallback covers dev boxes and any draft in flight.
   *
   * @deprecated Read through `scenePlaces(layout)`; never write.
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
 * The scene's named places, whichever key they are stored under.
 *
 * THE ONLY SUPPORTED READ PATH for `layout.places`. It exists because the key was renamed
 * from `locations` on 2026-09-06 and `layout` is jsonb, so a row can legitimately carry
 * either spelling until it is next saved. Reading the field directly is how half the codebase
 * would quietly stop seeing the places in an un-migrated scene — the failure mode being an
 * editor that opens a finished scene with an empty Places panel and a wall of "this scene has
 * no place named …" warnings.
 *
 * Writes are NOT symmetric and must not be: `masksToSceneLayout` emits `places` only, so
 * every save heals the row it came from.
 */
export function scenePlaces(layout: IWSceneLayout | undefined): Record<string, string> {
  return layout?.places ?? layout?.locations ?? {};
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
 *
 * `ai_walk` (2026-09-05) passes it too, and cleanly: the engine walks the way it always
 * walks, over the same graph, and is merely told WHERE by the model rather than by the
 * author. The answer space is closed — the scene's own places and bodies — so the model
 * supplies a CHOICE among authored referents, never a new capability and never a route.
 * Anything that would need the engine to invent a referent still fails the test.
 */
export const IW_ACTION_STEP_KINDS = [
  'comment',
  'walk_to_tag',
  'ai_walk',
  'walk_to_actor',
  'walk_away_from',
  'face',
  'wait',
  'wait_for_response',
  'start_conversation',
  'schedule_event',
] as const;

export type IWActionStepKind = (typeof IW_ACTION_STEP_KINDS)[number];

/** Human labels for the step kinds — one source of truth for the editor's picker. */
export const IW_ACTION_STEP_LABELS: Record<IWActionStepKind, string> = {
  comment: 'Say',
  walk_to_tag: 'Walk to place',
  ai_walk: 'Walk (AI picks where)',
  walk_to_actor: 'Walk to person',
  walk_away_from: 'Walk away from',
  face: 'Turn to face',
  wait: 'Wait',
  wait_for_response: 'Wait for the learner',
  start_conversation: 'Start a conversation',
  schedule_event: 'Schedule event',
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
  /**
   * Walk somewhere the MODEL chooses, described rather than named (2026-09-05).
   *
   * ⚠️ **The second step that costs a model call** — the model returns a DESTINATION and
   * nothing else. It does not move anybody: the route is computed by the same deterministic
   * traversal every other walk step uses (`planPath` over the § 3a walkable set), so
   * "the model never improvises movement" still holds exactly as written. What an author
   * delegates here is the choice of WHERE, which some scenes cannot know until the moment
   * arrives: *whichever table just called out*, *back to whoever is waiting*.
   *
   * THE CHOICE IS FROM A CLOSED LIST — the scene's named places plus the bodies present (the
   * learner, the companion, the rest of the cast) — and the engine then plays the ordinary
   * `walk_to_tag` or `walk_to_actor` for whatever came back. So a bad answer is a wrong
   * destination, never an illegal one: the NPC cannot be sent through a wall or to a place
   * that does not exist, and pathing has exactly the referents it always had.
   *
   * `instruction` is the author's brief for that choice ("to whoever has been waiting
   * longest"), in the same register as an action's `when`. Resolution itself is phase 2 —
   * today the step is authored, validated and stored, and nothing executes it yet.
   */
  | { kind: 'ai_walk'; instruction: string }
  /** Play one of the scene's authored NPC-to-NPC conversations (§ 14 Q6). */
  | { kind: 'start_conversation'; conversationId: string }
  /** Hold still for `seconds`. The beat that makes a script read as behaviour. */
  | { kind: 'wait'; seconds: number }
  /**
   * Arm one of the scene's authored EVENTS to happen `seconds` from now (migration 161).
   *
   * ⚠️ It does NOT pause the action, and it does not fire the event itself. The step arms a
   * timer and moves on; the engine then injects the event at the next legal moment — the same
   * opportunity a complication uses (§ 14 Q31), never mid-turn and never while the learner is
   * composing (§ 14 Q29). So `seconds` is an EARLIEST, not an exactly-when: "no sooner than
   * this, at the next beat that can carry it".
   *
   * This is what lets a script set something in motion it does not itself perform — 王婶 calls
   * the order through to the kitchen, and the food arrives twenty seconds later without her
   * standing there waiting for it. Use `wait` when the NPC really should stand still.
   */
  | { kind: 'schedule_event'; eventId: string; seconds: number }
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
export interface IWNpcAction extends IWSelectable {
  /** Author-assigned, stable within the NPC. What a run would record. */
  id: string;
  /** What the model sees and chooses by, so it must read as an intention: "bring water". */
  name: string;
  /** The script, in order. */
  steps: IWActionStep[];
  /**
   * NEVER offer this to the model — it runs only when an interaction's `npc_action` step
   * fires it (2026-09-06).
   *
   * The polarity is opt-OUT because an action is model-selectable today, and a new flag must
   * not change what an already-authored scene means. Its mirror on a conversation
   * ({@link IWConversation.selectable}) is opt-IN for exactly the same reason, since a
   * conversation is NOT selectable today.
   *
   * ⚠️ THIS REPLACES A PROSE WORKAROUND, and that is the argument for it. PPE's first scene
   * carries an action whose `when` reads *"Do not pick, triggered by interaction"* — an
   * instruction to the model, written into the field the model chooses BY, hoping it declines
   * an option it was nonetheless offered. That is unenforceable by construction: the whole
   * point of `when` is to make an action more choosable. A flag removes the action from the
   * candidate list instead of arguing with the model about it.
   *
   * Combining it with `urgent` or `unlockedBy` is contradictory (nothing that is never
   * offered can be urgent, or need unlocking) and the validator says so.
   */
  interactionOnly?: boolean;
}

/**
 * What every model-CHOOSABLE thing in a scene has in common (2026-09-06).
 *
 * Two things are chosen by a model mid-scene: an NPC's authored ACTION, and — since
 * 2026-09-06 — an overheard CONVERSATION, which its first speaker may start when the moment
 * suits. They are different in every other respect (one is a script one body performs, the
 * other is a fixed exchange between two), but the question the model is answering about them
 * is identical: *does this fit right now, and how badly does it want to happen?*
 *
 * So the three fields that shape that answer live here rather than being written twice. The
 * per-type fields that do NOT generalise — an action's `interactionOnly`, a conversation's
 * `selectable` — stay on their own types, because their polarity differs (see each).
 */
export interface IWSelectable {
  /**
   * Optional guidance on when it fits. Together with the name/title, the model's only hint.
   */
  when?: string;
  /**
   * URGE the model to pick this whenever it is available — but do NOT force it (2026-09-06).
   *
   * ⚠️ IT IS A PROMPT WEIGHT, NOT A SCHEDULER, and the distinction is the reason the field is
   * worth having rather than a hazard. A hard "must fire next" would flatten exactly the thing
   * iw exists to produce: an NPC who abandons a half-finished sentence to the learner because
   * a flag said so is not a scene unfolding, it is a queue draining. So the model may still
   * rank something else above it — finishing a reply, answering a question it was just asked,
   * reacting to a complication — and `urgent` only says which way to lean when nothing else
   * is pressing.
   *
   * The consequence to accept up front: an urgent thing is NOT guaranteed to happen, and a
   * beat that genuinely must happen is an EVENT on a timer, not an urgent action.
   */
  urgent?: boolean;
  /**
   * DEPENDENT: offer this only after one of these complications or events has fired
   * (2026-09-06). Ids are drawn from the scene's OWN `complications` and `events` — a mixed
   * list, because "has this happened yet" is the same question about both.
   *
   * ⚠️ **ANY, not ALL.** Several cues mean several ways in ("once the glass breaks OR the
   * kitchen calls, offer *fetch a broom*"), which is what a list of cues naturally reads as
   * and what almost every scene wants. An ALL gate is expressible only by authoring the
   * intermediate state as an event of its own — which is the honest way to say it anyway,
   * since a conjunction of world facts IS a new world fact.
   *
   * Omitted or empty means *always available*, which is what every action authored before
   * this field existed carries.
   */
  unlockedBy?: string[];
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
 * One authored EVENT, stored in `iw_scenes.events` (migration 161).
 *
 * SAME SHAPE AND SAME CHANNEL AS A COMPLICATION, DIFFERENT TRIGGER — and that is the whole
 * distinction. Both are one-line world facts the engine writes into the turn context of
 * everyone present, and both are reacted to in character rather than scripted. A complication
 * is DRAWN, by the per-turn roll; an event is SCHEDULED, by a `schedule_event` step in an
 * authored action. They are two lists rather than one flagged list so that neither trigger can
 * reach the other's pool: the roll must never spring an authored beat before its cue, and a
 * script must never be able to arm the thing whose whole job is to be a surprise.
 *
 * ENVIRONMENTAL, with no owner field, for the same reason `IWComplication` has none (§ 14 Q31,
 * 2026-09-04): "the kitchen sends out the noodles" is a fact about the room, and an event
 * written as "王婶 is flustered" is a character note misfiled as a world event.
 */
export interface IWSceneEvent {
  /** Author-assigned, stable within the scene. Referenced by `schedule_event.eventId`. */
  id: string;
  description: string;
  /**
   * Arm this event when the SCENE OPENS, this many seconds in (2026-09-05). Omitted means the
   * event only ever happens when an authored action schedules it.
   *
   * It is a field on the event rather than a second scene-level list because "when does this
   * happen" is a property of the event, and a separate `openingSchedule` list would be a
   * second place to look for the same answer — and a place to name an event that no longer
   * exists. Both timers feed the same queue: earliest-legal-moment, exactly as a
   * `schedule_event` step's does.
   *
   * `0` is meaningful and distinct from omitted — fire at the first legal opportunity after
   * the scene opens (which, like a complication, is never before the first exchange).
   */
  atStartSeconds?: number;
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
 *
 * ⚠️ **A CONVERSATION IS NOW SOMETHING ITS FIRST SPEAKER MAY CHOOSE** (2026-09-06), not only
 * something a script fires. Mark it {@link selectable} and it joins that NPC's candidate list
 * beside their authored actions — so 王婶, holding a lull while the learner reads the menu,
 * may decide there is time to greet the regular at table 2; and an NPC drawn toward another
 * body by a complication may take that as the opening for the exchange the author wrote for
 * exactly that moment.
 *
 * WHO OWNS IT IS DERIVED, NOT AUTHORED: the owner is `turns[0].npcId`, because the person who
 * speaks first is the person who started it. A separate `ownerNpcId` would be a second,
 * desynchronizable answer to a question the script already answers — and one an author could
 * set to somebody who never speaks in it.
 */
export interface IWConversation extends IWSelectable {
  id: string;
  /**
   * The conversation's handle.
   *
   * ⚠️ ITS AUDIENCE CHANGED WITH {@link selectable} (2026-09-06). It used to be strictly
   * author-facing — "never shown to the learner, never sent to a model". For a SELECTABLE
   * conversation it is what the model chooses by, exactly as an action's `name` is, so it has
   * to read as an intention ("greet the regular") rather than as a filing label ("conv about
   * table 2"). It is still never shown to the LEARNER either way.
   */
  title?: string;
  turns: IWConversationTurn[];
  /**
   * Offer this to its first speaker as something they may start (2026-09-06).
   *
   * Opt-IN, and the polarity is the point: every conversation authored before this field
   * existed was reachable only through a `start_conversation` step, and flipping them all to
   * spontaneous would change what those scenes do. PPE's "Taking the companion's order" is
   * the case that proves it — it is a *sub-step* of 王婶's order-taking script, and a version
   * of it that could also fire on its own would have her taking the companion's order twice.
   *
   * The mirror of {@link IWNpcAction.interactionOnly}, which is opt-OUT for the same
   * argument read the other way.
   */
  selectable?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Place INTERACTIONS — what happens when the learner pokes a cell (§ 14 Q43)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The step kinds a PLACE's interaction script is built from (§ 14 Q43).
 *
 * ⚠️ THIS IS A SECOND, SMALLER VOCABULARY, AND THE REASON IS SUBJECTHOOD. An
 * `IWActionStep` is written from inside one NPC — `walk_to_tag`, `face`, `wait_for_response`
 * all mean "the NPC performing this action does X", and the performer is implied by whose
 * cast entry the action hangs on. An interaction has NO performer: it is the world answering
 * a poke. So every subject-relative step is meaningless here, and the one step that needs a
 * subject names it explicitly (`npc_action`).
 *
 * The same test as § 14 Q42's applies — **can the engine execute this without knowing what
 * the scene is about?** — with one addition that is worth being explicit about: an
 * interaction may not do anything an authored action cannot already do, EXCEPT show the
 * learner a picture. `popup` is the one genuinely new capability the trigger brought with it,
 * because a prop the learner examines is the first thing in the feature that has something to
 * SHOW rather than something to say.
 *
 * WHY THERE IS NO `npc_comment`. Making an NPC speak is `npc_action` pointing at a one-step
 * authored action, and that indirection is deliberate (§ 14 Q43 sub-answer 2): a line written
 * here would be a line the model could never *choose*, so the same NPC would have two
 * disjoint repertoires — one it reasons about and one it does not.
 */
export const IW_INTERACTION_STEP_KINDS = [
  'popup',
  'npc_action',
  'start_conversation',
  'schedule_event',
  'wait',
] as const;

export type IWInteractionStepKind = (typeof IW_INTERACTION_STEP_KINDS)[number];

/** Human labels for the interaction step kinds — one source of truth for the editor. */
export const IW_INTERACTION_STEP_LABELS: Record<IWInteractionStepKind, string> = {
  popup: 'Show a picture',
  npc_action: 'NPC performs an action',
  start_conversation: 'Start a conversation',
  schedule_event: 'Schedule event',
  wait: 'Wait',
};

/**
 * One step of a place's interaction script.
 *
 * A discriminated union for the same reason `IWActionStep` is one: switching a step's kind
 * must REPLACE it rather than leave a `seconds` clinging to a popup.
 */
export type IWInteractionStep =
  /**
   * Show the learner a picture, optionally captioned.
   *
   * ⚠️ **The only thing an interaction can do that an authored action cannot**, and the only
   * art an author picks anywhere in the feature. `imageId` is the FILE STEM of a picture in
   * `src/assets/iw-popups/` — dropping a file in that folder is the whole of adding new
   * popup art, with no code change and no upload path (§ 14 Q43 sub-answer 1). The server
   * therefore cannot check the id against a catalogue it cannot see; it checks the SHAPE
   * (`IW_POPUP_IMAGE_ID`), and the editor only ever offers ids that resolved.
   *
   * `caption` is shown verbatim, in the author's words. It is NOT sent to a model and not
   * paraphrased — a caption is chrome around a picture, not somebody speaking.
   */
  | { kind: 'popup'; imageId: string; caption?: string }
  /**
   * Make one of the scene's cast perform one of ITS OWN authored actions.
   *
   * This is how an interaction produces dialogue and behaviour, and it is a REFERENCE rather
   * than an inline script on purpose: the action stays in the NPC's repertoire, so the same
   * "explain the menu" is both something the model may choose mid-conversation and something
   * the menu board triggers when poked. One behaviour, one definition, two ways in.
   */
  | { kind: 'npc_action'; npcId: string; actionId: string }
  /** Play one of the scene's authored NPC-to-NPC conversations. Identical to the action step. */
  | { kind: 'start_conversation'; conversationId: string }
  /** Arm one of the scene's authored events, exactly as an action's `schedule_event` does. */
  | { kind: 'schedule_event'; eventId: string; seconds: number }
  /** A beat between steps, so a poke does not resolve all at once. */
  | { kind: 'wait'; seconds: number };

/**
 * Every place interaction in a scene: **place tag → the script that runs when the learner
 * walks up to it**, stored in `iw_scenes.interactions` (migration 162).
 *
 * KEYED BY TAG, DELIBERATELY, and this is the shape of the whole feature (§ 14 Q43): an
 * interaction is not a new authored thing standing beside places — it is an OPTIONAL PROPERTY
 * OF A PLACE. A place with no entry here is an ordinary walk destination; a place with one is
 * a thing the learner can poke. That is why there is no `id` and no `tag` field: the key is
 * the identity, one place cannot have two interactions, and every cascade a tag already has
 * (rename moves it, delete drops it) carries the script along for free.
 *
 * ⚠️ IT IS A COLUMN RATHER THAN A FIELD INSIDE `layout.places`. The tag → cell map is board
 * GEOMETRY — where a thing is — and a script is BEHAVIOUR; folding one into the other would
 * have turned a `Record<string,string>` into a record of objects and rewritten every reader of
 * a shape three panels already depend on. Same relationship as `npcCast` (who is here) to the
 * actions hanging off it.
 *
 * ⚠️ SEVERAL TAGS MAY NAME ONE CELL (see {@link IWSceneLayout.places}), but **at most one
 * of them may be interactive** — the validator refuses two, because the walk command resolves
 * to a CELL and there would be no way to say which script it meant.
 */
export type IWSceneInteractions = Record<string, IWInteractionStep[]>;

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
   * The scene brief the model is given (migration 160): what this place is, and what the
   * scene's named places MEAN — a tag is a single word chosen for the author's dropdowns
   * (§ 14 Q42), and `counter` does not say "this is where you pay".
   *
   * ⚠️ It reaches NPCs VERBATIM and is not checked for meta language (§ 14 Q27) — writing it
   * in-world is the author's job. It is NOT the old `objective` returning: that column was
   * dropped by 159 for having no reader, and this one exists to be read.
   */
  sceneNotes: string;

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
  /**
   * The scheduled half of the world's behaviour (migration 161): facts an authored action can
   * arm with a `schedule_event` step, or that the scene arms itself via `atStartSeconds`.
   * Never drawn by the per-turn complication roll — see {@link IWSceneEvent}.
   */
  events: IWSceneEvent[];
  conversations: IWConversation[];
  /**
   * What happens when the learner walks up to a named place (migration 162, § 14 Q43).
   * Keyed by place tag; a place with no entry is simply not interactive. See
   * {@link IWSceneInteractions}.
   */
  interactions: IWSceneInteractions;

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
