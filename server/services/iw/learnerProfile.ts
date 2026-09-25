import { IW_PLAYER_LABEL } from '../../contracts/iw.js';
import type { UserGender } from '../../contracts/wire.js';

/**
 * learnerProfile.ts — how an NPC sees the learner (docs/IMMERSIVE_WORLD.md § 5.5).
 *
 * A vendor addresses a twenty-year-old woman and a sixty-year-old man differently, and in
 * Chinese the difference is lexical, not tonal — 小姑娘 / 美女 / 大姐 / 阿姨 vs 小伙子 / 帅哥 /
 * 大哥 / 叔叔 / 大爷 are chosen by gender AND age. So the NPC is told what it could SEE: a
 * gender and a rough age. It is told a FACT, never an instruction ("call them 阿姨") — the
 * same rule layer 3 follows everywhere, and for the same reason: prescribing the form of
 * address would flatten every character into one register (see § 5.5's 2026-09-01 note).
 *
 * ⚠️ AN AGE BAND, NEVER THE DATE. The birth date is private (migration 164); a band is all a
 * stranger could guess from across a stall, and all the choice of address needs. The bands
 * are decades because that is roughly the grain the address terms change at — nobody picks
 * 阿姨 over 大姐 on the strength of one year.
 *
 * PURE: no I/O. The account read lives in `ImmersiveWorldService.learnerContext`.
 *
 * Referenced by: `server/services/iw/turnState.ts` → `renderContextSections` (prints it),
 * `server/services/ImmersiveWorldService.ts` (supplies it), docs/IMMERSIVE_WORLD.md § 5.5.
 */

/** The two account fields this reads — `users."gender"` / `users."birthDate"`. */
export interface LearnerDemographics {
  gender?: UserGender | null;
  /** `YYYY-MM-DD`, as `UserDAL` normalizes it. */
  birthDate?: string | null;
}

/**
 * Whole years between `birthDate` and `now`, or null for a missing/garbled date.
 *
 * Calendar arithmetic on the date's own parts (not millisecond division), so a birthday is
 * counted on the day itself and leap years need no special case.
 */
export function ageOn(birthDate: string | null | undefined, now: Date): number | null {
  if (!birthDate) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  let age = now.getUTCFullYear() - y;
  const beforeBirthday =
    now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age >= 0 ? age : null;
}

/**
 * The noun phrase for a person of this gender and age — what a stranger would see.
 *
 * Any combination of the two may be missing: gender only → "a woman"; age only → "a person in
 * their thirties"; neither → null, and the caller prints nothing at all (the pre-164 prompt).
 */
export function describeLearner(demo: LearnerDemographics, now: Date = new Date()): string | null {
  const gender = demo.gender === 'male' || demo.gender === 'female' ? demo.gender : null;
  const age = ageOn(demo.birthDate, now);
  if (!gender && age === null) return null;

  const noun = {
    child: { female: 'a young girl', male: 'a young boy', none: 'a child' },
    teen: { female: 'a teenage girl', male: 'a teenage boy', none: 'a teenager' },
    adult: { female: 'a woman', male: 'a man', none: 'a person' },
  } as const;
  const key = gender ?? 'none';

  if (age === null) return noun.adult[key];
  if (age < 13) return noun.child[key];
  if (age < 18) return noun.teen[key];

  const possessive = gender === 'female' ? 'her' : gender === 'male' ? 'his' : 'their';
  const decades: Record<number, string> = {
    1: 'twenties', 2: 'twenties', 3: 'thirties', 4: 'forties', 5: 'fifties', 6: 'sixties',
  };
  const decade = Math.floor(age / 10);
  // 18–19 fold into "twenties": "a woman in her late teens" invites the teen register the
  // under-18 band exists for, and an adult learner should not be spoken to as a schoolkid.
  const span = decade >= 7 ? 'seventies or older' : decades[decade];
  return `${noun.adult[key]} in ${possessive} ${span}`;
}

/**
 * The layer-3 line, or null when there is nothing to say.
 *
 * Phrased as appearance ("looks like") rather than identity: it is what the NPC perceives, in
 * the same voice as the NEARBY block it sits beside.
 */
export function renderLearnerLine(description: string | null | undefined): string | null {
  return description ? `${IW_PLAYER_LABEL.toUpperCase()} LOOKS LIKE: ${description}.` : null;
}
