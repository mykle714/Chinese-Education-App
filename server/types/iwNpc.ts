/**
 * iw NPC types — the shape of one model-driven inhabitant.
 *
 * LAYER: server type definitions. Consumed by the iw prompt builder
 * (§ 5.5 layer 2 of docs/IMMERSIVE_WORLD.md) and by the NPC picker the scene
 * editor offers a template author.
 *
 * WHY THIS IS CODE AND NOT A TABLE (docs/IMMERSIVE_WORLD.md § 14 Q2):
 * an NPC IS a prompt. Changing one changes model behaviour, so it must be
 * reviewable in a diff and revertable alongside the prompt it was tuned against.
 * § 5.6's `character-run.js` regression sweep only means something if the NPC
 * is versioned in git. Scenes are content and live in `iw_scenes`; NPCs are
 * behaviour and live here.
 *
 * A scene row therefore references an NPC by `id` — a TEXT column, not a
 * foreign key, because the target is a code constant. `npcById` is the only
 * resolver, and a startup validation pass should assert every stored NPC id
 * still resolves (the caveat Q2 flags, in the spirit of
 * docs/NIGHT_MARKET_GRAPH_ASSUMPTIONS.md).
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 5.5, § 5.6, § 14 Q2.
 */

/**
 * A 1–5 trait scale. Deliberately numeric AND glossed: the number lets the prompt
 * builder render a consistent phrase for every NPC, the gloss is what a human
 * reads when deciding whether the character is written the way they intended.
 */
export interface IWTrait {
  /** 1 = very low, 3 = middling, 5 = very high. */
  level: 1 | 2 | 3 | 4 | 5;
  /**
   * One line, in the character's own terms, SECOND PERSON. Rendered verbatim after
   * the level's scale phrase, so it should add specificity rather than restate the
   * level — "You go flat and short when rushed" next to a 4/5, not "You are cheerful".
   */
  note: string;
}

/**
 * One inhabitant. Every field below is rendered into the NPC's cached prompt
 * prefix, so this is not colour for humans — it is the character's whole mind.
 *
 * The biography fields exist because a thin NPC ("a friendly noodle vendor")
 * produces a thin NPC: it has nothing to volunteer, nothing to be reminded of,
 * and no reason to prefer one answer over another. A learner talking to it every
 * day (iw is once-per-day, § 9) exhausts it in a week.
 *
 * ⚠️ WRITE EVERY PROSE FIELD IN THE SECOND PERSON — "You run a stall", never "She
 * runs a stall". `renderNpcBlock` addresses the model AS the character, so a
 * third-person biography splices a character sheet into a self-description and
 * invites narration ("王婶 would probably say…") in place of speech.
 */
export interface IWNpc {
  /** Stable id. Stored in `iw_scenes` / `iw_scene_ratings` / `iw_npc_memories` as text. */
  id: string;
  /** NPCs are keyed by language — a Spanish cast is new content, not a translation (§ 14 Q8). */
  language: 'zh' | 'es';

  /** What they are called, and what the learner sees. */
  name: string;
  /** Romanization for the author's benefit; never shown to the learner in-scene. */
  romanization: string;
  age: number;
  /** Their job in the world. The single strongest constraint on what they talk about (§ 11 layer 1). */
  occupation: string;

  /** Where they came from and how they got here. Two or three sentences. */
  history: string;
  /** What they are trying to do with their life right now — not scene objectives. */
  currentGoals: string[];
  /** The texture of an ordinary day: hours, habits, what they eat, when they sleep. */
  lifestyle: string;
  /** Tastes, dislikes, opinions they will volunteer unprompted. */
  preferences: string[];
  /** Live threads. What is happening TO them this month — the source of unprompted small talk. */
  ongoingEvents: string[];
  /** People and animals they will mention by name. */
  network: string[];
  /** What they own that matters to them. Grounds the world in objects. */
  property: string[];
  /** Where they live, concretely. */
  home: string;
  /** Formative moments. What they return to when a conversation gets personal. */
  coreMemories: string[];

  /** Baseline mood and how it moves. */
  temperament: IWTrait;
  /** How readily they accommodate someone else — including a learner who is struggling. */
  agreeableness: IWTrait;
  /** Pace. Drives speech length and how quickly they change subject. */
  energy: IWTrait;
  /** Emotional steadiness under friction. Low maturity sulks; high maturity absorbs. */
  maturity: IWTrait;
  /**
   * How long they put up with something before they react to it at all.
   *
   * ⚠️ PATIENCE IS THE RATE; MATURITY IS THE SIZE. They are easy to confuse and they are not
   * the same axis: maturity says how big the reaction is and whether they recover from it,
   * patience says how many turns of friction it takes to get one. A high-maturity, low-
   * patience character pushes back early and cleanly; a low-maturity, high-patience one
   * absorbs a great deal and then takes it badly. Low patience reacts strongly SOONER.
   */
  patience: IWTrait;
  /** What actually moves them to act. The lever a learner can pull without knowing it. */
  motivation: IWTrait;

  /** How they speak: register, sentence length, verbal tics. Shapes every line. */
  register: string;

  /**
   * A completion NPC's rule, stated as OBSERVABLE PRECONDITIONS IN THEIR OWN TERMS.
   *
   * ⚠️ § 14 Q27: an NPC is told who it is, never what it is for. This field must
   * never say "this ends the scene", never mention a scene, an objective or a
   * player. "Once the customer has ordered, eaten and asked for the bill" is
   * correct; "accept payment to complete the scene" is a bug.
   *
   * Undefined for an NPC that terminates nothing.
   */
  completionRule?: string;
}
