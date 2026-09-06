import {
  IW_NO_ACTION,
  type IWConversation,
  type IWNpcAction,
  type IWScene,
  type IWSceneCastMember,
  type IWSelectable,
} from '../../contracts/iw.js';

/**
 * iw turn offers — what ONE NPC is allowed to choose from on ONE turn (§ 5.4b).
 *
 * LAYER: service (pure). Given a scene, an NPC and the set of cues that have fired, it
 * returns the candidate list — no I/O, no clock, no model.
 *
 * This is the runtime half of the selectability system whose authoring half shipped on
 * 2026-09-06. The authoring side decided WHAT an author can express (`IWSelectable`'s `when`
 * / `urgent` / `unlockedBy`, an action's `interactionOnly`, a conversation's `selectable`);
 * this decides what the model actually SEES, and the two must agree exactly — an offer list
 * that disagrees with the editor's preview is an author debugging a scene that is not the
 * one running.
 *
 * ⚠️ THE OFFER LIST IS ALSO THE VALIDATION LIST. `turnParser.parseTurnReply` matches the
 * model's line 2 against the same array rendered into the prompt, so an action the model was
 * not offered cannot be executed no matter what it emits (§ 5.4). Handing the parser a
 * different list than the prompt showed would grade a fiction; callers pass
 * {@link TurnOffers.names} to both.
 *
 * ⚠️ IT DOES NOT DECIDE WHETHER THE NPC SPEAKS. Every audible NPC decides that for itself
 * (§ 4.1); this only bounds what it may DO. An NPC with an empty offer list still takes a
 * turn — it just has nothing but `none` on line 2.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 5.4, § 5.4b, § 14 Q42/Q43.
 */

/** One thing the model may pick, flattened so actions and conversations look alike. */
export interface TurnOffer {
  /** The exact string the model must emit on line 2. */
  name: string;
  kind: 'action' | 'conversation';
  /** The authored id, so the caller can execute it without re-searching. */
  id: string;
  /** The author's guidance on when it fits, if any. */
  when?: string;
  /** Lean toward this one — see `IWSelectable.urgent`; a weight, never a scheduler. */
  urgent?: boolean;
}

export interface TurnOffers {
  offers: TurnOffer[];
  /** Just the names, in offer order — for the prompt AND for the parser. */
  names: string[];
  /**
   * Things that were dropped and why. Diagnostics for the "why didn't he do X?" question,
   * which § 4 says must always be answerable. Never shown to a learner.
   */
  suppressed: Array<{ name: string; reason: string }>;
}

/**
 * Whether a cue gate is satisfied.
 *
 * ANY, not ALL — see `IWSelectable.unlockedBy`. An absent or empty list is always available,
 * which is what every action authored before the field existed carries.
 */
export function isUnlocked(sel: IWSelectable, firedCues: ReadonlySet<string>): boolean {
  if (!sel.unlockedBy || sel.unlockedBy.length === 0) return true;
  return sel.unlockedBy.some(cue => firedCues.has(cue));
}

/** The reason a gated thing is not offered, phrased for a debug overlay. */
const lockedReason = (sel: IWSelectable): string =>
  `locked: needs one of ${(sel.unlockedBy ?? []).join(', ')}`;

/**
 * The actions this cast member may be offered.
 *
 * `interactionOnly` is checked FIRST and reported separately, because "never offered" and
 * "not yet unlocked" are different answers to the same question and conflating them is how
 * an author concludes their cue is broken when in fact they ticked the wrong box. (The
 * validator already refuses to let both be set at once, so the order only matters for a scene
 * saved with warnings.)
 */
export function offeredActions(
  member: IWSceneCastMember,
  firedCues: ReadonlySet<string>,
): { offered: IWNpcAction[]; suppressed: Array<{ name: string; reason: string }> } {
  const offered: IWNpcAction[] = [];
  const suppressed: Array<{ name: string; reason: string }> = [];
  for (const action of member.actions ?? []) {
    if (action.interactionOnly) {
      suppressed.push({ name: action.name, reason: 'interaction-only' });
      continue;
    }
    if (!isUnlocked(action, firedCues)) {
      suppressed.push({ name: action.name, reason: lockedReason(action) });
      continue;
    }
    offered.push(action);
  }
  return { offered, suppressed };
}

/**
 * The overheard conversations this NPC may start (2026-09-06).
 *
 * ⚠️ OWNERSHIP IS DERIVED FROM `turns[0].npcId`, NOT AUTHORED. A conversation's first
 * speaker is the one who starts it, which the script already says; a separate `ownerNpcId`
 * field would be a second answer to a question already answered, and one an author could set
 * to somebody who never speaks in the exchange.
 *
 * The learner's two cases both fall out of this with no extra machinery: an NPC may reach for
 * one during a lull (it is simply on their list every turn), and may reach for one the moment
 * a complication brings two people together (the same list, now with a `when` that fits).
 */
export function offeredConversations(
  conversations: readonly IWConversation[],
  npcId: string,
  firedCues: ReadonlySet<string>,
): { offered: IWConversation[]; suppressed: Array<{ name: string; reason: string }> } {
  const offered: IWConversation[] = [];
  const suppressed: Array<{ name: string; reason: string }> = [];
  for (const conv of conversations) {
    const firstSpeaker = conv.turns?.[0]?.npcId;
    if (firstSpeaker !== npcId) continue; // not this NPC's to start — not a suppression
    if (!conv.selectable) {
      suppressed.push({ name: conv.title ?? conv.id, reason: 'not choosable' });
      continue;
    }
    // The validator requires a selectable conversation to have a title, because the title IS
    // what the model picks by. A scene saved with warnings can still lack one; falling back
    // to the id keeps the offer legal rather than emitting `undefined` into a prompt.
    if (!isUnlocked(conv, firedCues)) {
      suppressed.push({ name: conv.title ?? conv.id, reason: lockedReason(conv) });
      continue;
    }
    offered.push(conv);
  }
  return { offered, suppressed };
}

/**
 * Everything one NPC may choose from this turn, actions and conversations merged.
 *
 * ⚠️ NAME COLLISIONS RESOLVE IN FAVOUR OF THE ACTION, deterministically. The model picks by
 * NAME, so an action called "chat with 老周" and a conversation titled the same are one
 * string on line 2 and the engine cannot know which was meant. Rather than run a coin-flip in
 * front of a player, the action wins (it is the older concept, and every scene authored
 * before conversations were selectable has only actions) and the conversation is reported as
 * suppressed. `sceneValidation` warns about the collision at authoring time so it should not
 * reach here.
 *
 * `IW_NO_ACTION` is deliberately NOT in the list: it is always legal, the prompt states it
 * separately, and putting it among the offers would let the parser "match" it as though the
 * author had written it.
 */
export function buildTurnOffers(
  scene: Pick<IWScene, 'conversations'>,
  member: IWSceneCastMember,
  firedCues: ReadonlySet<string> = new Set(),
): TurnOffers {
  const actions = offeredActions(member, firedCues);
  const convs = offeredConversations(scene.conversations ?? [], member.npcId, firedCues);

  const offers: TurnOffer[] = actions.offered.map(a => ({
    name: a.name,
    kind: 'action' as const,
    id: a.id,
    when: a.when,
    urgent: a.urgent,
  }));
  const taken = new Set(offers.map(o => o.name));
  const suppressed = [...actions.suppressed, ...convs.suppressed];

  for (const conv of convs.offered) {
    const name = conv.title ?? conv.id;
    if (taken.has(name)) {
      suppressed.push({ name, reason: 'name collides with an action' });
      continue;
    }
    taken.add(name);
    offers.push({ name, kind: 'conversation', id: conv.id, when: conv.when, urgent: conv.urgent });
  }

  return { offers, names: offers.map(o => o.name), suppressed };
}

/**
 * Render the offer list for § 5.5's layer 3.
 *
 * Format matches the bench's `REPLY CONTRACT` line 2 (`scenario.js` → `FORMATS.lines`), so a
 * sweep grades the same text the game ships. `when` rides beside the name rather than in a
 * separate block, because the model is choosing between whole options and splitting an
 * option across two places in the prompt makes it read them as unrelated facts.
 *
 * ⚠️ `urgent` is rendered as PROSE, not as an ordering. Sorting the urgent ones to the top
 * would be a second, silent channel saying the same thing, and a model that infers "first =
 * best" would then treat the list order as meaningful everywhere else too.
 */
export function renderOffers(offers: readonly TurnOffer[]): string {
  if (offers.length === 0) return `(nothing in particular you can do — answer with ${IW_NO_ACTION})`;
  return offers
    .map(o => {
      const parts = [o.name];
      if (o.when) parts.push(`— ${o.when}`);
      if (o.urgent) parts.push('(you have been meaning to do this)');
      return `- ${parts.join(' ')}`;
    })
    .join('\n');
}
