import { runLadder, type IWModelRung } from './npcTurn.js';
import { npcById } from '../../config/iwNpcs.js';

/**
 * iw addressee router — a model call that decides WHICH NPC a learner was talking to (§ 4.2).
 *
 * LAYER: service (pure prompt + parser; the ladder does the I/O). Called by
 * `ImmersiveWorldService.routeAddressee`.
 *
 * ⚠️ **THIS OVERRIDES § 4.2's ORIGINAL "NOT A MODEL CALL" DECISION, AND THE REASON IT LOST IS
 * WORTH KEEPING.** The first build routed on a rule ladder — a name in the utterance, then the
 * tapped body, then the last speaker, then the nearest — on the argument that the strongest
 * signals are free and a rule can explain itself. Both halves of that are still true. What
 * killed it is that **the set of ways a person can be named is not enumerable**:
 *
 * > 服务员 · 老板 · 师傅 · 大爷 · 卖面的 · 开车的那个 · 穿红衣服的 · 你朋友 · 何老师的朋友
 *
 * Role, trade, age, clothing, what they are doing, who they are to somebody else — every one
 * of those is an ordinary way to call across a room, and each needs a different fact about the
 * NPC to resolve. A rule ladder can hold a list of titles; it cannot hold *the character
 * sheet*. Since the sheets already exist and already say all of this, the router's job is
 * really "read the room", which is a model's job.
 *
 * ⚠️ **THE RULE LADDER DID NOT GO AWAY — IT IS THE FALLBACK** (`play/addressee.ts`). This call
 * can be slow, can fail, and can honestly answer UNCLEAR, and in every one of those cases the
 * scene must still route somebody. So the ordering is: ask the model, and use the rules when
 * it does not answer in time. That makes the model an accuracy improvement with a **hard
 * latency ceiling** rather than a new way for the scene to stall — which is the only shape in
 * which § 6's latency constraint tolerates a second serial call at all.
 *
 * ⚠️ **ONE RUNG, NOT THE Q7 LADDER.** {@link runLadder} is reused for its deadline machinery,
 * but the router is given only the primary rung. Walking three rungs at ~750 ms each to decide
 * something that has a free answer would spend 2.5 s to avoid using the fallback — the exact
 * "a ladder without deadlines is a slower failure" mistake `npcTurn`'s header warns about,
 * one level up. A failed router is not a failed scene.
 *
 * ⚠️ **IT NEVER INVENTS A RECIPIENT.** The parser validates the reply against the ids that
 * were offered, and anything else — a name, a hallucinated id, prose — is a parse failure that
 * falls back to the rules. A router that could name somebody not in the scene would be a
 * silent way to address nobody.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 4.2, § 7.
 */

/**
 * One line of the roster, assembled from the NPC registry rather than sent by the client.
 *
 * ⚠️ **THE GEOMETRY IS THREE SEPARATE FACTS, NOT ONE.** `focused` is an INTENT the learner
 * declared (they tapped this body); `facedByLearner` and `distance` are where the avatar is
 * actually standing and pointing right now; `facingLearner` is what the NPC is doing. They
 * come apart constantly — a learner turns to watch somebody walk past without meaning to
 * address them, and keeps facing the last person they tapped long after the conversation has
 * moved on — so collapsing them into one "is being addressed" boolean would throw away the
 * disagreement that is precisely what the router is for.
 */
export interface RouterCastMember {
  npcId: string;
  /** Chebyshev cells from the learner — a hint, not a rule. */
  distance: number;
  /** The learner's avatar is turned toward them (the quadrant test in `facesToward`). */
  facedByLearner?: boolean;
  /** They are turned toward the learner — an NPC already attending to them. */
  facingLearner?: boolean;
  /** They are the body the learner last tapped. */
  focused?: boolean;
  /** They spoke the line before this one. */
  spokeLast?: boolean;
}

export interface AddresseeRouteInput {
  utterance: string;
  cast: readonly RouterCastMember[];
  /** The last few lines of the scene, oldest first — who has been talking to whom. */
  heard: readonly string[];
}

/**
 * The token the model emits when it genuinely cannot tell.
 *
 * ⚠️ **GIVING IT AN OUT IS THE POINT.** A model forced to choose always chooses, and § 4.1
 * already established that a model asked a yes/no question about its own participation says
 * yes. An explicit UNCLEAR turns "I am guessing" into a legible answer, and the fallback rules
 * are a better guess than a coerced one — they at least agree with something the learner did.
 */
export const IW_ROUTE_UNCLEAR = 'UNCLEAR';

/**
 * A router reply is a step label and an identifier. A cap makes a runaway cheap — and models
 * do run away here: told to answer with nothing else, they still like to append the sentence
 * of reasoning the step label just made them do. The parser reads the first line only, so the
 * tail is harmless; this number just stops us paying for much of it.
 */
export const IW_ROUTE_MAX_TOKENS = 24;

/**
 * Deadlines, much tighter than a turn's.
 *
 * A turn's deadline is generous because the alternative to waiting is a frozen scene. Here the
 * alternative is a free, instant, usually-correct answer, so waiting is only worth it while it
 * stays inside the slack § 6.2's react → move → speak sequence already has. Past that the
 * router is costing the learner more than it is buying them.
 *
 * ⚠️ **MEASURED, NOT GUESSED — `scripts/iw-route-probe.js`.** These were first set to 600/900
 * from a guess that "the prompt is small, so it will be fast". Measured on the real cast
 * (3 runs × 6 probes, 2026-09-07) the call takes **578–3609 ms, median ~650**, so 600 ms
 * killed nearly every route — and the failure was INVISIBLE, because a dead router falls back
 * to the rules and the scene keeps working. § 5.2 had the number all along: Haiku's first
 * glyph is 792–970 ms, and a router's prompt being short does not move a floor that is mostly
 * round trip.
 *
 * The chosen values sit above the ordinary case and well below the tail: **the 3.6 s outlier
 * is exactly what these exist to cut**, and cutting it costs a fallback that is usually right
 * anyway. Re-run the probe before changing them, and never tighten them to make a flaky route
 * "fail fast" — failing fast here means never using the model at all, silently.
 */
export const ROUTE_FIRST_GLYPH_DEADLINE_MS = 1400;
export const ROUTE_TOTAL_DEADLINE_MS = 1800;

/**
 * The router's system block — frozen, and deliberately not the world rules.
 *
 * It is NOT layer 1 (`worldRules.ts`): the router is not a person in the market and must not
 * be told it is. Telling a router to stay in character is how a router starts answering in
 * Chinese. It is a reader, not a speaker, and this is the one iw prompt that says so.
 */
export const IW_ROUTE_SYSTEM = `You decide who a language learner was speaking to.

You will be given the people standing in a scene, a few recent lines, and one thing the
learner just said. Answer with the id of the ONE person they were addressing.

DECIDE IN TWO STEPS, IN THIS ORDER, AND DO NOT MIX THEM. The position hints in the roster
belong to step 2 ONLY. If step 1 answers, step 2 is not consulted at all.

STEP 1 — DOES THE SENTENCE ITSELF POINT AT SOMEBODY?
Look in the words for any of these:
- a name, or a nickname or title built from one
- a role or trade — a waiter as 服务员, a cook as 师傅, a shopkeeper as 老板
- what somebody is or is doing — the one driving, the one selling noodles
- age or standing — 大爷, 阿姨, 同学
Read the person descriptions to resolve them. They are written as notes addressed to that
person, so "You drive a cab" means that person drives a cab.

If exactly one person in the scene fits, THAT IS THE ANSWER. Stop there. Where the learner is
standing and which way they are turned do not matter and must not be weighed against it —
calling somebody by their role is what a learner does precisely when they are NOT standing in
front of that person. Somebody sitting right beside the learner is a companion, and a
companion is not addressed by job title.

TAKE THE NEAREST FIT, NOT THE EXACT ONE. A learner reaches for the word they know. Somebody
who runs a small restaurant IS the 服务员 and the 老板 and the 师傅 as far as a beginner
calling across it is concerned. Ask who in this scene best fills the role they named, not
whether the word is their correct job title. Only a person whose description gives them NO
claim on the role at all is ruled out by this step.

STEP 2 — THE SENTENCE POINTS AT NOBODY (你好, 多少钱？, 你觉得呢？).
Now use the hints, weighed in this order:
1. Who the learner's avatar is TURNED TOWARD. People face the person they are talking to, and
   turning is a deliberate act: somebody a few tiles away who the learner is facing beats
   somebody standing right beside them who they are turned away from.
2. How CLOSE they are. This decides it between two people the learner is facing equally, and
   it is all there is to go on when the learner is facing nobody.
3. Whether they are turned toward the learner, or just spoke — either means a conversation is
   already open with them.

Distance never overrides facing, only ranks within it: everyone in the scene can hear the
learner, so standing far away is not a reason to rule somebody out when the learner has
deliberately turned to them.

Reply on ONE line with the step that decided it and then the id, and nothing else:

    STEP1 wang_shen
    STEP2 michael

Reply ${IW_ROUTE_UNCLEAR} alone ONLY if the learner was not speaking to any person at all —
thinking aloud, or reading something out. If they were talking to somebody, one of these ids
is the answer.`;

/**
 * Distance as a phrase, not just a number.
 *
 * ⚠️ **AN "ACROSS THE ROOM, TOO FAR TO BE ADDRESSED" BAND WAS TRIED AND REMOVED**, along with
 * the prompt rule it existed to make legible ("somebody eight tiles away needs a word in the
 * sentence"). Two things killed it. The model would not apply a numeric threshold written in
 * prose — `4 tiles` and `11 tiles` were treated alike — and rendering the band in code instead
 * did not save it, because **the rule was wrong**: earshot was removed the same day (§ 4), so
 * everybody in a scene hears everything, and there is no longer any sense in which a body
 * across the room is out of range. A learner who turned to face somebody chose them.
 *
 * What is left is the one distinction that carries no such claim: adjacent reads differently
 * from a few tiles off. The number is still printed, because it is what separates two bodies
 * the learner is facing equally.
 */
function describeDistance(distance: number): string {
  return distance <= 1 ? 'standing right beside the learner' : `${distance} tiles away`;
}

/** One roster entry — everything the router could route on, in as few tokens as it takes. */
function describeMember(member: RouterCastMember): string {
  const npc = npcById(member.npcId);
  if (!npc) return `${member.npcId}: (no sheet)`;
  // Distance and facing lead, because they are the two the prompt ranks first, and a hint
  // list is read in order. `focused` deliberately no longer claims the learner is facing
  // them — that used to be asserted here and was never checked; now it is measured, and the
  // two are reported separately so the model can see when they disagree.
  return [
    `id: ${member.npcId}`,
    `  name: ${npc.name} (${npc.romanization}), ${npc.age}, ${npc.avatar === 'male' ? 'man' : 'woman'}`,
    `  ${npc.occupation}`,
  ].join('\n');
}

/**
 * One line of the position block.
 *
 * ⚠️ **THIS IS A SEPARATE BLOCK FROM THE ROSTER ON PURPOSE, AND FUSING THEM BROKE A CASE.**
 * The hints used to be a `[...]` suffix on each roster entry, and with them there the model
 * could not keep step 1 and step 2 apart: asked 服务员 with a companion standing adjacent,
 * faced and tapped, it answered the companion — and answered correctly the moment the same
 * cast was sent with the hints removed. Position was outvoting a role word that only one
 * person in the scene could possibly fill.
 *
 * Separating the blocks is what a prompt can do about that: WHO these people are (step 1's
 * evidence) is no longer physically adjacent to WHERE they are standing (step 2's), so the
 * model is not reading one fused blob of evidence per person. It is a mitigation, not a
 * guarantee — the model still sees both — which is why the probe carries the case.
 */
function describePosition(member: RouterCastMember): string {
  const hints: string[] = [describeDistance(member.distance)];
  hints.push(member.facedByLearner
    ? 'the learner is turned toward them'
    : 'the learner is turned away from them');
  if (member.facingLearner) hints.push('turned toward the learner');
  if (member.focused) hints.push('the last body the learner walked over and tapped');
  if (member.spokeLast) hints.push('spoke the previous line');
  return `${member.npcId}: ${hints.join('; ')}`;
}

/**
 * The volatile block.
 *
 * ⚠️ **THE UTTERANCE IS UNTRUSTED AND IS QUOTED LAST** (§ 11). Same boundary as a turn: it is
 * learner text, it is fenced by a label, and nothing after it re-opens the instructions. The
 * blast radius here is smaller than a turn's — the worst a successful injection achieves is
 * routing the line to the wrong NPC, who then answers in character — but the habit is the
 * defence, and a router that reads instructions out of the utterance is a router that can be
 * told to answer UNCLEAR forever.
 */
export function buildRouteUser(input: AddresseeRouteInput): string {
  const heard = input.heard.length > 0 ? input.heard.join('\n') : '(nothing yet)';
  return `PEOPLE IN THE SCENE — who they are. This is what STEP 1 reads:
${input.cast.map(describeMember).join('\n')}

WHERE THEY ARE STANDING — position only. This is what STEP 2 reads, and STEP 2 ONLY. None of
it is evidence about who the learner named:
${input.cast.map(describePosition).join('\n')}

RECENT LINES, oldest first:
${heard}

THE LEARNER JUST SAID: "${input.utterance}"

Who were they speaking to? Reply with one id, or ${IW_ROUTE_UNCLEAR}.`;
}

/**
 * Read a router reply into an npcId, `null` for UNCLEAR, or a parse failure.
 *
 * `failed` means the rung produced something that is not an answer — empty, prose, or an id
 * that is not on offer. It is distinct from UNCLEAR, which is a real answer meaning "use the
 * rules", and which must NOT make the ladder retry: asking the same model again cannot make an
 * ambiguous sentence unambiguous, and the fallback is already sitting there.
 */
export function parseRouteReply(
  raw: string,
  offered: readonly string[],
): { npcId: string | null; failed: boolean } {
  // ⚠️ THE FIRST LINE ONLY, AND THAT BOUND IS LOAD-BEARING. The reply is `STEP1 wang_shen`, so
  // the id is no longer the first token and we have to scan — but scanning the WHOLE reply
  // would read the model's unrequested trailing explanation, where an id-shaped word ("Michael
  // is building an app") is an ordinary part of a sentence about somebody it just ruled out.
  // The format puts the answer on line one; anything after it is commentary.
  const line = raw.trim().split('\n')[0] ?? '';
  const tokens = line.split(/[\s,.:;"'`*]+/).filter(Boolean);
  if (tokens.length === 0) return { npcId: null, failed: true };
  if (tokens.some(t => t.toUpperCase() === IW_ROUTE_UNCLEAR)) return { npcId: null, failed: false };
  const match = tokens.map(t => offered.find(id => id.toLowerCase() === t.toLowerCase())).find(Boolean);
  return match ? { npcId: match, failed: false } : { npcId: null, failed: true };
}

export interface RouteAddresseeOptions {
  rungs: readonly IWModelRung[];
  input: AddresseeRouteInput;
  now?: () => number;
  firstGlyphDeadlineMs?: number;
  totalDeadlineMs?: number;
}

/** What the router decided. `null` covers UNCLEAR, a dead rung and a bad reply alike. */
export interface IWRouteOutcome {
  npcId: string | null;
  /** For the log: which rung answered, or why nothing did. */
  detail: string;
}

/**
 * Ask the model who was being addressed.
 *
 * Every failure mode collapses to `npcId: null`, on purpose: the caller has exactly one thing
 * to do about any of them (use the rules), so distinguishing them in the return type would be
 * a distinction nobody could act on. `detail` keeps them apart for the log.
 */
export async function routeAddressee(options: RouteAddresseeOptions): Promise<IWRouteOutcome> {
  const offered = options.input.cast.map(m => m.npcId);
  if (offered.length === 0) return { npcId: null, detail: 'no cast' };
  if (offered.length === 1) return { npcId: offered[0], detail: 'only one body in the scene' };

  const outcome = await runLadder<string | null>({
    // ONE rung — see the header. The fallback is free, so a second attempt is never worth it.
    rungs: options.rungs.slice(0, 1),
    request: {
      system: IW_ROUTE_SYSTEM,
      user: buildRouteUser(options.input),
      maxTokens: IW_ROUTE_MAX_TOKENS,
    },
    createSink: () => {
      let buffer = '';
      return {
        push: (delta: string) => {
          buffer += delta;
          // `complete` is meaningless here — nothing streams a router's answer to a screen —
          // but the sink contract asks for it, and reporting the buffer keeps the ladder's
          // first-glyph timer honest.
          return { text: buffer, complete: false };
        },
        finish: () => {
          const { npcId, failed } = parseRouteReply(buffer, offered);
          return { value: npcId, failed };
        },
      };
    },
    now: options.now,
    firstGlyphDeadlineMs: options.firstGlyphDeadlineMs ?? ROUTE_FIRST_GLYPH_DEADLINE_MS,
    totalDeadlineMs: options.totalDeadlineMs ?? ROUTE_TOTAL_DEADLINE_MS,
  });

  if (outcome.kind !== 'ok') {
    return { npcId: null, detail: `router did not answer (${outcome.attempts.map(a => a.outcome).join(', ') || 'no rungs'})` };
  }
  return outcome.value
    ? { npcId: outcome.value, detail: `routed by ${outcome.rung}` }
    : { npcId: null, detail: 'router said UNCLEAR' };
}
