/**
 * Who the learner was talking to — the engine's answer, decided BEFORE any model call.
 *
 * LAYER: feature (pure). No React, no fetch, no clock. Sits beside `actionPlayer.ts` and
 * `iwScript.ts` as one of the play surface's decision modules; `useIWSceneRuntime` is the
 * only caller.
 *
 * ⚠️ **THIS REPLACES § 4.1's FAN-OUT** (2026-09-07). That section decided every NPC who heard
 * an utterance should decide FOR ITSELF whether to answer, on the grounds that a bystander
 * leaning in with something useful is a better world than a scoring table picking a winner.
 * It is a better world, and it did not survive contact with one: asked one question, two and
 * three NPCs answered it, and a learner cannot tell who they are talking to when everybody
 * talks back. § 4.1 even names this exact failure — *"the failure mode to watch for is
 * over-eagerness, not silence"* — and predicted the shape of it precisely. The prompt-side
 * counter-pressure it proposed (`addressed` as a FACT rather than an instruction) was built
 * and was not enough, which is the finding: **a model asked "should you respond?" answers yes,
 * and no amount of telling it the question was for somebody else reliably changes that.**
 *
 * So the choice moved OUT of the model and into here. Exactly one NPC is asked for a turn.
 * Nobody else is called, which also means nobody else can chime in — the guarantee is
 * structural rather than persuasive, and it is the only kind that holds.
 *
 * ⚠️ **THIS IS THE FALLBACK, NOT THE DECISION** (2026-09-07, revised the same day). For a few
 * hours it was the whole thing, on the argument that the strongest signals are free and a rule
 * can explain itself. Both halves of that are still true and neither was enough, because **the
 * set of ways one person can name another is not enumerable**:
 *
 * > 服务员 · 老板 · 师傅 · 大爷 · 卖面的 · 开车的那个 · 穿红衣服的 · 你朋友
 *
 * Role, trade, age, clothing, what somebody is doing, who they are to somebody else — each
 * needs a different fact off the character sheet. This module can hold a list of titles; it
 * cannot hold a cast of biographies. `server/services/iw/addresseeRouter.ts` asks a model,
 * which reads the sheets that already exist.
 *
 * What is left here is the job the rules are genuinely better at: **answering instantly and
 * always.** The router can be slow, can fail, and can honestly say UNCLEAR, and in every one
 * of those cases a scene still has to route somebody. `useIWSceneRuntime.say` races the router
 * against a deadline and lands here when it does not win, which is what keeps a second serial
 * model call inside § 6's latency budget: the worst case is this answer, not a stalled scene.
 *
 * ⚠️ **SO THE RULES BELOW ARE NOW A GUESS, AND SHOULD READ AS ONE.** Do not add a rung here to
 * chase a case the router already handles — a role word, an appearance, a relationship. Every
 * rule this module gains is a rule that runs when the router is DOWN, and the ones that earn
 * their place are the ones that are right about a learner's *gesture* rather than clever about
 * their sentence.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 4.1, § 4.2.
 * Paired with: `server/services/iw/addresseeRouter.ts` (the model that runs first).
 */

/** One body that could be the intended recipient. */
export interface AddresseeCandidate {
  id: string;
  /** How the learner would see them named — the NPC's `name`. */
  label: string;
  /** Chebyshev cells from the learner. */
  distance: number;
  /**
   * The learner's avatar is turned toward them.
   *
   * Only the last rung reads it, and only as a preference over distance — see rung 4. The
   * router weighs the same fact much harder; this is the cheap version of it, kept in step so
   * that a learner standing in front of somebody gets the same answer whether or not the
   * model replied in time.
   */
  facedByLearner?: boolean;
}

/** The decision, with the reason attached so the log can print it. */
export interface AddresseeChoice {
  id: string;
  /** Which rule fired. Ordered strongest first; see {@link chooseAddressee}. */
  reason: 'named' | 'focused' | 'replying' | 'facing' | 'nearest';
  /** Free text for the debug log — the alias that matched, and so on. */
  detail?: string;
}

/**
 * Chinese title words a learner is likely to use ON THEIR OWN in place of a full name.
 *
 * ⚠️ **THESE ARE SUFFIXES OF A NAME, NOT A VOCABULARY.** The list exists only to notice that
 * 何老师 answers to 老师 and 马师傅 to 师傅 — a beginner reaches for the title long before the
 * surname, and 老师 is very often the first form they ever learn. An alias is only ever
 * derived from a cast member's own name, so adding a word here can never invent a recipient;
 * the worst it can do is let one more spelling reach somebody already in the scene.
 *
 * Longest first, so 老师 is tried before 师 would be if a one-character title were ever added.
 */
const ZH_TITLE_SUFFIXES = [
  '老师', '师傅', '大爷', '大娘', '阿姨', '老板', '先生', '太太', '医生', '同学',
  '叔叔', '阿婆', '奶奶', '爷爷', '哥哥', '姐姐',
  '婶', '叔', '哥', '姐', '姨', '伯',
] as const;

/** Leading familiarity particles — 老周 is also 周, 小陈 is also 陈. */
const ZH_NAME_PREFIXES = ['老', '小', '阿'] as const;

/**
 * Every spelling that plausibly names this candidate.
 *
 * The full name always counts. Beyond that, for Chinese: the title it ends with, and the name
 * with a familiarity prefix stripped. A stripped form must still be at least one character and
 * is only worth generating when it is not the whole name again.
 */
function aliasesFor(label: string, language: 'zh' | 'es'): string[] {
  const name = label.trim();
  if (!name) return [];
  const aliases = new Set<string>([name]);
  if (language === 'zh') {
    for (const title of ZH_TITLE_SUFFIXES) {
      if (name.length > title.length && name.endsWith(title)) {
        aliases.add(title);
        break; // Longest-first ordering makes the first hit the most specific one.
      }
    }
    for (const prefix of ZH_NAME_PREFIXES) {
      if (name.length > prefix.length && name.startsWith(prefix)) {
        aliases.add(name.slice(prefix.length));
        break;
      }
    }
  }
  return [...aliases];
}

/** Where an alias first appears in the utterance, or -1. Case-insensitive for Latin script. */
function indexOfAlias(utterance: string, alias: string, language: 'zh' | 'es'): number {
  if (language === 'es') return utterance.toLowerCase().indexOf(alias.toLowerCase());
  return utterance.indexOf(alias);
}

/**
 * Decide who one utterance was aimed at, or null when there is nobody to aim it at.
 *
 * The rules, strongest first — and the order is the whole design, so it is worth reading as a
 * sentence: **what you said beats what you tapped, what you tapped beats who spoke last, and
 * who spoke last beats who happens to be standing nearby.**
 *
 * 1. `named` — an alias of exactly one candidate appears in the utterance. A vocative is the
 *    only signal the learner can give that CONTRADICTS where they are standing, so it has to
 *    win, or calling across a room to somebody by name would be impossible. An alias claimed
 *    by two candidates is discarded rather than guessed at: in a scene with two teachers, 老师
 *    is not a discriminator and pretending otherwise routes half of them wrong. Ties between
 *    two DIFFERENT candidates' aliases go to the one mentioned earliest, then to the longer
 *    (more specific) alias — 何老师 beats a bare 老师 in the same sentence.
 * 2. `focused` — the body the learner last tapped. Tapping walks the avatar over and turns it
 *    to face them (`approachAndFace`), so this is a deliberate, visible, physical act of
 *    address, and it persists until they tap somebody else.
 * 3. `replying` — whoever spoke last, if they are still in the scene. An answer follows a
 *    question; this is what makes a back-and-forth work without re-tapping every turn.
 * 4. `facing` — the nearest body the learner's avatar is actually TURNED TOWARD. Facing is a
 *    physical act of address the same way tapping is, and it is the only one of these signals
 *    that keeps working after the learner walks away from whoever they last tapped. It sits
 *    below `focused` rather than above it because a tap is deliberate where a facing is often
 *    just where the avatar happened to stop.
 * 5. `nearest` — the last resort, and the caller's list order (see `audienceFor`, which sorts
 *    by distance). Somebody has to answer a learner who has done nothing but type.
 */
export function chooseAddressee(
  utterance: string,
  candidates: readonly AddresseeCandidate[],
  context: { focusedId: string | null; lastSpeakerId: string | null; language: 'zh' | 'es' },
): AddresseeChoice | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) {
    return { id: candidates[0].id, reason: 'nearest', detail: 'the only body in the scene' };
  }

  // ── 1. Named ──────────────────────────────────────────────────────────────────────────
  // Built as alias → the candidates claiming it, so an ambiguous alias can be DROPPED rather
  // than resolved by list order. Silently picking the first 老师 is worse than falling through
  // to where the learner is standing, which at least matches something they can see.
  const claims = new Map<string, string[]>();
  for (const c of candidates) {
    for (const alias of aliasesFor(c.label, context.language)) {
      claims.set(alias, [...(claims.get(alias) ?? []), c.id]);
    }
  }
  let best: { id: string; alias: string; at: number } | null = null;
  for (const [alias, owners] of claims) {
    if (owners.length !== 1) continue; // shared by two cast members: not a name, just a word
    const at = indexOfAlias(utterance, alias, context.language);
    if (at < 0) continue;
    // Earliest mention wins — a vocative leads a sentence. Equal positions mean one alias is a
    // prefix of the other, and the longer one is the more specific name.
    if (!best || at < best.at || (at === best.at && alias.length > best.alias.length)) {
      best = { id: owners[0], alias, at };
    }
  }
  if (best) return { id: best.id, reason: 'named', detail: `said "${best.alias}"` };

  // ── 2. Focused (tapped) ───────────────────────────────────────────────────────────────
  const focused = candidates.find(c => c.id === context.focusedId);
  if (focused) return { id: focused.id, reason: 'focused', detail: 'the body they tapped' };

  // ── 3. Replying to whoever spoke last ─────────────────────────────────────────────────
  const speaker = candidates.find(c => c.id === context.lastSpeakerId);
  if (speaker) return { id: speaker.id, reason: 'replying', detail: 'spoke the previous line' };

  // ── 4. Facing ─────────────────────────────────────────────────────────────────────────
  // `candidates` is already nearest-first, so the first match is the nearest faced body.
  const faced = candidates.find(c => c.facedByLearner);
  if (faced) {
    return { id: faced.id, reason: 'facing', detail: `turned toward them, ${faced.distance} tiles away` };
  }

  // ── 5. Nearest ────────────────────────────────────────────────────────────────────────
  return { id: candidates[0].id, reason: 'nearest', detail: `${candidates[0].distance} tiles away` };
}
