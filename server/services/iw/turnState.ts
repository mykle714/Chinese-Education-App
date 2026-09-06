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
 * ⚠️ **AN NPC'S MEMORY IS ITS OWN HEARING HISTORY, NOT THE GLOBAL TRANSCRIPT** (§ 5.5). The
 * `heard` list must be assembled per NPC from what § 4's gate let through to THEM. Passing
 * the whole conversation is the single easiest way to destroy the illusion — an NPC who knows
 * what you said across the room is instantly not a person.
 *
 * ⚠️ TURN-TAKING FACTS ARE PRESSURE, NOT RULES (§ 4.1). "You spoke last turn" and "they are
 * facing away from you" are given to the NPC to inform its OWN decision about whether to
 * answer. They are never phrased as instructions, because every NPC that hears an utterance
 * decides for itself whether to respond — that decision is the model's, not a scoring
 * heuristic's.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 4.1, § 5.5, § 9.4, § 11.
 */

/** One body this NPC can perceive, already filtered by the § 4 hearing/visibility gate. */
export interface NearbyBody {
  /** How the NPC refers to them — a name for someone they know, else a description. */
  label: string;
  /** Chebyshev cells. The NPC is told a number because "near" is not comparable. */
  distance: number;
  /** They are facing this NPC. A turn-taking signal, not a rule. */
  facingYou?: boolean;
  /** Something stands between; § 4 charged range for it. */
  muffled?: boolean;
}

/** One line this NPC actually heard, oldest first. */
export interface HeardLine {
  /** Who said it, as this NPC would name them. `'you'` for the NPC's own past lines. */
  speaker: string;
  text: string;
}

export interface TurnStateInput {
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
      if (n.muffled) notes.push('muffled, something is in the way');
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
    case 'utterance':
      return event.addressed
        ? `JUST NOW, ${event.speaker} said to you: "${event.text}"`
        : `JUST NOW you overheard ${event.speaker} say, not to you: "${event.text}"`;
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
 * Build layer 3 — the user message for one NPC's turn.
 *
 * Sections are omitted rather than rendered empty wherever an empty one would be noise: an
 * NPC holding nothing does not need a line saying so, but an NPC who has heard nothing does,
 * because "(nothing yet)" is meaningfully different from the section being absent.
 */
export function renderTurnState(input: TurnStateInput): string {
  const sections: string[] = [
    `KNOWN_WORDS: ${input.knownWords.join(', ') || '(none yet)'}`,
    '',
    'NEARBY (tile distance from you):',
    renderNearby(input.nearby),
  ];

  if (input.holding?.length) {
    sections.push('', 'YOU ARE HOLDING:', bullets(input.holding, ''));
  }

  sections.push(
    '',
    'WHAT YOU HAVE HEARD, oldest first:',
    bullets(input.heard.map(h => `${h.speaker} said: "${h.text}"`), 'nothing yet'),
  );

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

  sections.push('', renderEvent(input.event), '', CLOSER);
  return sections.join('\n');
}
