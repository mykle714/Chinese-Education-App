"""
The § 8i / Q11 blocking rule of docs/GLOSS_CONFUSABILITY.md, as the ONE runnable
implementation. Everything that decides "are these two glosses confusable?" lives here so
the callers cannot drift apart. Two call it today — `evaluate.py` (the § 8j measurement)
and `server/scripts/gloss-pipeline/cluster.py` (step 6 of the real pipeline, which turns
its verdicts into must-link and cannot-link edges) — and the § 6 runtime guard must mirror
it when that is built.

    block(A,B) =  ( mutual_entailment > TAU_SYN  OR  contained(A,B) )
                  AND NOT cannot_link(A,B)

    cannot_link(A,B) =  max_contradiction >= TAU_CONTRA
                        OR wordnet_antonym(A,B)
                        OR numeral_mismatch(A,B)

Deliberately takes RAW probabilities as arguments rather than reading a model: retuning a
threshold must stay a re-derivation over cached verdicts (§ 7 rule 1), never a re-judge.
Only `pEntail` (mutual = min of both directions) and `pContra` (max of both directions)
come from the cross-encoder; containment, the antonym veto and the numeral guard are
deterministic and free.
"""
import re

TAU_SYN = 0.3       # § 8i: lowered from 0.5; 0.3 is the knee, below it buys nothing
TAU_CONTRA = 0.5    # § 8i: fires on ~27% of real candidates

# ---------------------------------------------------------------- key normalization

def dd_key(text: str) -> str:
    """Python twin of `ddCollisionKey` (server/utils/definitions.ts).

    Strips parentheticals, collapses whitespace, drops a trailing period, lowercases.
    Step 1 of the pipeline MUST dedupe on this, not on raw dd strings — the § 8i probe
    spent 10 of its 400 candidate slots on pairs (`God`/`god`) that phase 1 already merges.
    """
    return re.sub(r"\s+", " ", re.sub(r"\s*\([^)]*\)", "", text).strip()).lower().rstrip(".")


# ---------------------------------------------------------------- must-link half

def contained(a: str, b: str) -> bool:
    """Word-boundary lexical containment — the free signal that closes the § 8i grey band.

    This is what separates *specialization* (`east` ⊂ `east side`, `chicken` ⊂ `chicken
    meat`) — indistinguishable on a board — from *taxonomic* hypernymy (`dog` vs `animal`),
    which Q2 correctly decided to ignore and which containment never matches.
    """
    ka, kb = dd_key(a), dd_key(b)
    if not ka or not kb:
        return False
    return (kb.startswith(ka + " ") or kb.endswith(" " + ka)
            or ka.startswith(kb + " ") or ka.endswith(" " + kb))


# ---------------------------------------------------------------- cannot-link half

# Quantity tokens. Numerals are a contrast class that must NEVER be separated, and the
# NLI veto does not cover them: 万 "ten thousand" / 千 "thousand" scored contradiction
# 0.11, so only this deterministic guard stands between them and a wrong block.
_NUMERAL_WORDS = {
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
    "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty",
    "sixty", "seventy", "eighty", "ninety", "hundred", "thousand", "million",
    "billion", "trillion", "dozen", "half", "quarter", "single", "double", "triple",
    "first", "second", "third", "fourth", "fifth",
}
# § 8i: without this map `a single cent` / `one cent` is spuriously exempted from blocking.
_NUMERAL_SYNONYMS = {"single": "one", "0.5": "half", "double": "two", "triple": "three"}


def numeral_tokens(text: str) -> set:
    out = set()
    for tok in re.findall(r"[a-z0-9.]+", dd_key(text)):
        if tok in _NUMERAL_WORDS or re.fullmatch(r"\d+(\.\d+)?", tok):
            out.add(_NUMERAL_SYNONYMS.get(tok, tok))
    return out


def numeral_mismatch(a: str, b: str) -> bool:
    """Both glosses carry a quantity AND the quantities differ.

    Both-sides-non-empty matters: `o'clock` / `one o'clock` has an empty set on one side,
    so the guard stays out of the way and that pair is correctly blocked.
    """
    ta, tb = numeral_tokens(a), numeral_tokens(b)
    return bool(ta) and bool(tb) and ta != tb


_wn = None
def _wordnet():
    """Lazy, optional. WordNet is English-only (C9) — harmless, since dds are English for
    both languages. If nltk is missing the veto degrades to NLI + numerals rather than
    failing the run; the caller reports which path ran."""
    global _wn
    if _wn is None:
        try:
            import nltk
            nltk.download("wordnet", quiet=True)
            from nltk.corpus import wordnet
            wordnet.synsets("test")
            _wn = wordnet
        except Exception:
            _wn = False
    return _wn or None


def wordnet_antonym(a: str, b: str) -> bool:
    """Single-word glosses only (§ 4 step 5) — WordNet has no entry for a phrase."""
    wn = _wordnet()
    if wn is None:
        return False
    ka, kb = dd_key(a), dd_key(b)
    if " " in ka or " " in kb or not ka or not kb:
        return False
    for syn in wn.synsets(ka):
        for lemma in syn.lemmas():
            if any(ant.name().replace("_", " ").lower() == kb for ant in lemma.antonyms()):
                return True
    return False


# ---------------------------------------------------------------- the rule

def cannot_link(a, b, p_contra):
    """Hard brake. This is what makes a liberal must-link safe, and — because these are
    hard cannot-link edges (Q9) — what stops *transitive* merges during clustering."""
    if p_contra >= TAU_CONTRA:
        return "contradiction"
    if wordnet_antonym(a, b):
        return "wordnet-antonym"
    if numeral_mismatch(a, b):
        return "numeral-mismatch"
    return None


def decide(a, b, p_entail, p_contra):
    """-> (block: bool, reason: str). `p_entail` is MUTUAL entailment (min of directions),
    `p_contra` is the MAX contradiction over directions."""
    # § 6 rule 2: identical keys always share a group. Phase 1 is preserved unconditionally,
    # so no brake may ever weaken it — a rebuild must never be weaker than the shipped guard.
    if dd_key(a) == dd_key(b) and dd_key(a):
        return True, "exact-dd"
    veto = cannot_link(a, b, p_contra)
    if veto:
        return False, veto
    if p_entail > TAU_SYN:
        return True, "mutual-entailment"
    if contained(a, b):
        return True, "containment"
    return False, "unrelated"


def decide_legacy(a, b, p_entail, p_contra):
    """The pre-Q11 § 4 rule, kept so every report can show the delta the liberal rule buys."""
    if dd_key(a) == dd_key(b) and dd_key(a):
        return True, "exact-dd"
    if p_entail > 0.5 and p_contra < 0.5:
        return True, "mutual-entailment"
    return False, "unrelated"
