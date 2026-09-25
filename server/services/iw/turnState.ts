import { renderLearnerLine } from './learnerProfile.js';
import type { TurnOffer } from './turnOffers.js';

/**
 * iw LAYER 3 — the volatile turn (§ 5.5).
 *
 * LAYER: service (pure). Given a description of the world as ONE NPC perceives it, returns
 * the text of the user message. No I/O, no clock, no model.
 *
 * ⚠️ THIS IS THE **USER** MESSAGE, NOT PART OF THE SYSTEM BLOCK, and that placement is a
 * security property rather than a formatting choice (§ 11). The learner types arbitrary text
 * that lands in an NPC's context, so it is quoted as DATA in a user turn and never
 * concatenated into the system layer. Two further mitigations stand behind it — the offered
 * action names are matched against what this scene authored (§ 5.4, enforced by
 * `turnParser`), and the palette shrinks the surface to words the server issued — so the
 * worst a successful injection achieves is an off-character sentence, never an illegal world
 * state. Do NOT move any of this into the system block to save tokens.
 *
 * ⚠️ IT IS ALSO THE CACHE BOUNDARY. Layers 1 and 2 are byte-stable and cached; everything
 * here changes every turn by definition. Anything that is in fact stable across a session
 * belongs in layer 1 or 2, not here — every token in this block is paid in full, every turn.
 *
 * ⚠️ **`heard` IS THE SCENE'S WHOLE TRANSCRIPT, AND SINCE 2026-09-07 THAT IS THE DESIGN.**
 * This block used to demand the opposite — "an NPC's memory is its own hearing history, not
 * the global transcript", assembled per NPC from what § 4's gate let through. The gate is
 * withdrawn and everyone in a scene hears everything, so one list is now correct rather than
 * merely convenient. Worth knowing that it was ALWAYS one list: the client only ever kept a
 * single `heardRef`, so the rule this paragraph stated was never once enforced. It was
 * removed for being false, not for being unaffordable.
 *
 * ⚠️ The bound that does the work is instead the WINDOW — the client keeps the last 8 lines
 * (`HEARD_WINDOW`) and this parser takes at most 12. An NPC's memory is short, not selective.
 *
 * ⚠️ TURN-TAKING FACTS ARE PRESSURE, NOT RULES (§ 4.1). "You spoke last turn" and "they are
 * facing away from you" are given to the NPC to inform its OWN decision about whether to
 * answer. They are never phrased as instructions, because every NPC that hears an utterance
 * decides for itself whether to respond — that decision is the model's, not a scoring
 * heuristic's.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 4.1, § 5.5, § 9.4, § 11.
 */

/** One other body in the scene. There is no hearing/visibility filter (§ 4, § 4c withdrawn). */
export interface NearbyBody {
  /** How the NPC refers to them — a name for someone they know, else a description. */
  label: string;
  /** Chebyshev cells. The NPC is told a number because "near" is not comparable. */
  distance: number;
  /** They are facing this NPC. A turn-taking signal, not a rule. */
  facingYou?: boolean;
}

/** One line this NPC actually heard, oldest first. */
export interface HeardLine {
  /** Who said it, as this NPC would name them. `'you'` for the NPC's own past lines. */
  speaker: string;
  text: string;
}

/**
 * What an NPC can perceive, independent of what prompted them to speak.
 *
 * Split out of {@link TurnStateInput} because there are now TWO kinds of model call that need
 * it (§ 14 Q42): a turn, where the NPC decides whether and how to answer something, and a
 * LINE RENDER, where an authored direction is put into their own words. Both need the same
 * answer to "who is here, what have I heard, what does this learner know"; only a turn needs
 * an event and an offer list. Rendering these sections twice would let an NPC's memory drift
 * between the two paths, which is exactly the illusion this feature exists to protect.
 */
export interface IWContextInput {
  /**
   * Roughly what the learner knows (§ 9.4). GUIDANCE, not a budget to count against — the
   * hard "at most one word outside the list" rule was withdrawn because it produced stilted
   * speech and the measured failure mode was never the count (§ 5.6a).
   */
  knownWords: readonly string[];
  nearby: readonly NearbyBody[];
  heard: readonly HeardLine[];
  /** What the NPC is holding, in their own terms. Omitted entirely when empty. */
  holding?: readonly string[];
  /**
   * What the learner looks like — `describeLearner`'s phrase, e.g. "a woman in her thirties"
   * (migration 164, `learnerProfile.ts`). Omitted when the learner has not told us.
   *
   * ⚠️ SERVER-SUPPLIED ONLY. `parsePerception` in the runtime controller never reads it from
   * the request body; `ImmersiveWorldService` sets it from the account. A client-supplied copy
   * would be free text reaching the prompt outside the learner's quoted span (§ 11).
   */
  learner?: string;
}

export interface TurnStateInput extends IWContextInput {
  /** What just happened to prompt this turn. */
  event: TurnEvent;
  /**
   * The annotated offer list. Only offers carrying `when` or `urgent` are rendered — the bare
   * names are already in the reply contract (layer 1), and printing all of them twice would
   * both waste the tokens and invite the model to treat the two lists as different things.
   */
  offers?: readonly TurnOffer[];
  /** § 4.1 turn-taking pressure: this NPC spoke on the previous beat. */
  spokeLastTurn?: boolean;
  /**
   * The `get_information` step this NPC is in the middle of, if any (2026-09-20).
   *
   * Present ONLY while a script is parked on that step, which is what makes it safe to change
   * the reply contract on its account: the four-line shape is asked for exactly on the turns
   * that will be read for a fourth line.
   */
  collect?: CollectGoal;
}

/** What an NPC is currently trying to find out, and how many tries it has had. */
export interface CollectGoal {
  /** The author's words — an intention, never a line to say (§ 14 Q42). */
  goal: string;
  /** 1 on the first answer the NPC hears, 2 on the second, and so on. */
  attempt: number;
  /** The last attempt this step will make. After it, the NPC gives up and moves on. */
  maxTurns: number;
}

/** What prompted this NPC's turn. */
export type TurnEvent =
  /** Somebody said something this NPC heard. `addressed` = they were plainly the target. */
  | { kind: 'utterance'; speaker: string; text: string; addressed: boolean }
  /** Somebody arrived in earshot without speaking. */
  | { kind: 'approach'; who: string }
  /** A complication or event fired and this NPC noticed it. */
  | { kind: 'world'; description: string };

const bullets = (items: readonly string[], empty: string): string =>
  (items.length ? items.map(i => `- ${i}`).join('\n') : `- ${empty}`);

function renderNearby(nearby: readonly NearbyBody[]): string {
  return bullets(
    nearby.map(n => {
      const notes: string[] = [];
      if (n.facingYou) notes.push('facing you');
      return `${n.label} at ${n.distance} tiles${notes.length ? `, ${notes.join(', ')}` : ''}`;
    }),
    'nobody',
  );
}

/**
 * Render the event line.
 *
 * ⚠️ THE LEARNER'S TEXT IS QUOTED, and it stays quoted. Everything around it is the engine
 * speaking; the quotes are what mark where the untrusted span begins and ends.
 *
 * `addressed` is a FACT, not an instruction — § 4.1's over-eagerness failure mode is a model
 * asked "should you respond?" answering yes, and the counter-pressure is telling a bystander
 * plainly that the remark was not aimed at them, then leaving the decision to them.
 */
function renderEvent(event: TurnEvent): string {
  switch (event.kind) {
    case 'utterance': {
      return event.addressed
        ? `JUST NOW, ${event.speaker} said to you: "${event.text}"`
        : `JUST NOW you overheard ${event.speaker} say, not to you: "${event.text}"`;
    }
    case 'approach':
      return `JUST NOW, ${event.who} walked up to you and said nothing.`;
    case 'world':
      return `JUST NOW: ${event.description}`;
  }
}

/**
 * The closer.
 *
 * It restates that silence is a real option, because § 4.1's measured risk is a chorus of
 * helpful bystanders rather than a room of mutes — and because `NOTHING` is only a legal
 * answer if the NPC is told so at the point of answering, not 300 tokens earlier.
 */
const CLOSER = 'Reply now. If this is not your business, say NOTHING.';

/**
 * The perception half of layer 3 — shared by a turn and by a line render (§ 14 Q42).
 *
 * Sections are omitted rather than rendered empty wherever an empty one would be noise: an
 * NPC holding nothing does not need a line saying so, but an NPC who has heard nothing does,
 * because "(nothing yet)" is meaningfully different from the section being absent.
 */
export function renderContextSections(input: IWContextInput): string[] {
  const sections: string[] = [
    `KNOWN_WORDS: ${input.knownWords.join(', ') || '(none yet)'}`,
    '',
    'NEARBY (tile distance from you):',
    renderNearby(input.nearby),
  ];

  // Beside NEARBY because it is the same kind of fact — what this NPC can see of a body in the
  // scene. Absent, not "(unknown)", when the learner has not told us: an NPC told the customer
  // is "unknown" would reasonably treat that as something odd about them.
  const learnerLine = renderLearnerLine(input.learner);
  if (learnerLine) sections.push('', learnerLine);

  if (input.holding?.length) {
    sections.push('', 'YOU ARE HOLDING:', bullets(input.holding, ''));
  }

  sections.push(
    '',
    'WHAT YOU HAVE HEARD, oldest first:',
    bullets(input.heard.map(h => `${h.speaker} said: "${h.text}"`), 'nothing yet'),
  );
  return sections;
}

/**
 * Build layer 3 — the user message for one NPC's turn.
 *
 * The perception half is {@link renderContextSections}; everything below it is what makes
 * this a TURN rather than a line render — the offers, the turn-taking pressure, the event
 * and the closer that makes silence a legal answer.
 */
export function renderTurnState(input: TurnStateInput): string {
  const sections: string[] = renderContextSections(input);

  // Only the annotated offers — see TurnStateInput.offers.
  const annotated = (input.offers ?? []).filter(o => o.when || o.urgent);
  if (annotated.length) {
    sections.push(
      '',
      'ABOUT THE THINGS YOU CAN DO:',
      bullets(
        annotated.map(o => {
          const parts = [`${o.name}:`];
          if (o.when) parts.push(o.when);
          if (o.urgent) parts.push('(you have been meaning to do this)');
          return parts.join(' ');
        }),
        '',
      ),
    );
  }

  if (input.spokeLastTurn) {
    // Pressure, not a rule — the NPC may well have more to say.
    sections.push('', 'You spoke on the last beat.');
  }

  // ⚠️ **THE ONE BLOCK IN LAYER 3 THAT IS AN ERRAND RATHER THAN A PERCEPTION**, and it is
  // rendered LAST, immediately before the event, because it is what the NPC should be reading
  // the event against: *did that answer my question?*
  //
  // It is deliberately phrased as the NPC's own want and not as an instruction to extract
  // something. "Find out X" produces an interrogator; "you still do not know X, and you need
  // to" produces somebody who asks again, differently, and who accepts a near-enough answer —
  // which is the behaviour a learner needs from a vendor who did not understand them.
  if (input.collect) {
    const { goal, attempt, maxTurns } = input.collect;
    const pressure = attempt >= maxTurns
      ? 'You have asked more than once and it is not coming. Let it go and settle it yourself.'
      : attempt > 1
        ? 'You have already asked once. Ask again in fewer, simpler words, or offer them a choice.'
        : '';
    sections.push(
      '',
      `WHAT YOU STILL NEED TO KNOW: ${goal}`,
      'You have not been told this yet. Ask for it in your own way, simply.',
      ...(pressure ? [pressure] : []),
    );
  }

  sections.push('', renderEvent(input.event), '', CLOSER);
  return sections.join('\n');
}
