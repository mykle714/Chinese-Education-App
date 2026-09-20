/**
 * iw line guard — the last thing that looks at an NPC's line before it is spoken or painted.
 *
 * LAYER: contract (pure). One function in, one verdict out; no DOM, no network, no audio.
 *
 * ⚠️ **IT LIVES IN `contracts/` BECAUSE IT HAS TWO ENFORCEMENT POINTS, NOT ONE** (moved out of
 * `src/engine/iw/` on 2026-09-07). What a legal NPC line IS gets decided in two places that
 * must never disagree: the **runtime**, where it filters a model's reply before the bubble and
 * the TTS call, and the **scene validator**, where it tells an author at SAVE time that the
 * line they just typed will never be spoken. A second copy of the rule would drift, and the
 * drift would be invisible in the worst direction — a validator that passes a line the runtime
 * then silently swallows, which is exactly the bug this move was written for (below).
 *
 * ⚠️ **IT RUNS BEFORE THE TTS CALL, NOT AFTER IT** (§ 5.3a, § 6.4 rule 2). Sanitizing after
 * synthesis would mean paying Google to speak a line we are about to throw away, and would
 * risk an unsanitized glyph reaching the speaker even if it never reached the screen. The
 * ordering is the rule; this module is what there is to run at that moment.
 *
 * ⚠️ **A REJECTED LINE IS SILENCE, NOT AN ERROR MESSAGE.** § 5.3a's original answer was to
 * substitute a canned NPC line — but per-NPC `fallbackLines` were withdrawn on 2026-09-04
 * (§ 5.5), and Q7's ladder-exhausted rule says the world says *nothing* rather than something
 * plausible. So a rejected line degrades to § 4.1's NON-VERBAL channel: the NPC's action and
 * emote still play, and no bubble appears. An NPC that turns to look at you and says nothing
 * reads as a person choosing their words; a bubble of mojibake reads as a broken game.
 *
 * ⚠️ **IT IS NOT A MODERATION LAYER.** § 11's content safety is a server concern with its own
 * prompt-level and review-level answers. What this catches is the mechanical failure modes of
 * a language model asked for one line of Chinese: markup that leaked out of the format,
 * control characters, and a reply that came back in the wrong language entirely (§ 5.6, which
 * measured exactly that as the real failure mode).
 *
 * ⚠️ **AUTHORED LINES GO THROUGH IT TOO, AND UNTIL 2026-09-07 THEY DID NOT.** Every authored
 * line in PPE's "Get Dinner" was written in ENGLISH — four `comment` steps and six
 * conversation turns — so 王婶 was mute for the whole of her order-taking script while the
 * learner saw her walk over and turn to face them. The runtime guard was working perfectly;
 * nothing had ever told the author. See `sceneValidation.validateAuthoredLines`.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 5.3a, § 5.6, § 6.4;
 * server/services/iw/sceneValidation.ts.
 */

/**
 * Control characters, zero-width marks and bidi overrides — never legitimate in a spoken line.
 *
 * Written as escapes rather than as literal characters on purpose: a literal U+202E in a
 * source file is invisible in every editor and reverses the text after it, which is precisely
 * the class of character this strips.
 */
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const INVISIBLE = /[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\uFEFF]/g;
/** A fenced code block or inline backticks that leaked out of the model's formatting. */
const FENCES = /```+|`/g;
/** CJK ideographs — the script a `zh` line is supposed to be in. */
const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
/** A run of latin letters long enough to be an English WORD rather than a borrowing. */
const LATIN_WORD = /[A-Za-z]{4,}/;
/** Everything that is neither script nor punctuation — what the ratio below is measured over. */
const SCRIPT_NOISE = /[\s\d\p{P}\p{S}]/gu;

/** What the guard decided, and why — the reason is for a debug overlay, never for a learner. */
export type LineVerdict =
  | { ok: true; text: string }
  | { ok: false; reason: string };

/**
 * Clean a line and decide whether it may be shown and spoken.
 *
 * `language` is the SCENE's language, not the learner's UI language: an NPC in a Chinese
 * scene speaks Chinese, and a reply that arrives in English is a prompt failure the learner
 * should never see (§ 5.6 measured this as the failure mode that actually happens).
 */
export function guardNpcLine(raw: string, language: 'zh' | 'es'): LineVerdict {
  const text = (raw ?? '')
    .replace(INVISIBLE, '')
    .replace(FENCES, '')
    .trim();

  if (!text) return { ok: false, reason: 'empty after sanitizing' };

  // The script check runs over CONTENT characters only. Measuring over the raw string would
  // let a line of pure punctuation pass, and would fail a legitimate line that happens to be
  // heavily punctuated.
  const content = text.replace(SCRIPT_NOISE, '');
  if (!content) return { ok: false, reason: 'no content characters' };

  if (language === 'zh') {
    if (!CJK.test(content)) return { ok: false, reason: 'a Chinese NPC replied with no Chinese in it' };
    // ⚠️ MEASURED IN UNITS, NOT CHARACTERS. A latin RUN counts once, because "OK" is one thing
    // said, not two — counting its letters individually failed 'OK，请坐', a line an NPC really
    // says, at any threshold high enough to catch an English sentence.
    const units = content.match(/[A-Za-z]+|[\s\S]/g) ?? [];
    const han = units.filter(unit => CJK.test(unit)).length;
    if (han / units.length < 0.6) return { ok: false, reason: 'mostly not Chinese' };
    if (LATIN_WORD.test(text)) return { ok: false, reason: 'contains an english word' };
  } else if (CJK.test(content)) {
    return { ok: false, reason: 'a Spanish NPC replied in Chinese' };
  }

  return { ok: true, text };
}
