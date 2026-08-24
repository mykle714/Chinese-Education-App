"""
Closes C14 of docs/GLOSS_CONFUSABILITY.md: measure the § 8i / Q11 liberal rule END TO END,
on BOTH the § 8a/8b gold set and the 400 real high-cosine candidates, and report the
must-block / must-not-block rates § 7 requires on every rebuild.

Runs over the CACHED raw probabilities in probe_results.json / realdist_results.json —
no model inference (§ 7 rule 1). Re-judge only when modelRevision or templateVersion moves.
"""
import collections, json, sys
import rule

MODEL_REVISION = "MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli"
TEMPLATE_VERSION = "v1"


def bar(title):
    print(f"\n{title}\n" + "-" * len(title))


# ------------------------------------------------------------------ § 8a / 8b gold set
gold = json.load(open("probe_results.json"))
bar(f"GOLD SET ({len(gold)} pairs) — the half of C14 that was never run")

per_cat = collections.defaultdict(lambda: [0, 0])   # [correct, total], expectation-bearing only
misses = {"BLOCK": [], "ALLOW": []}
observe = []
print(f"  {'A':34s} {'B':26s} {'exp':6s} {'new':6s} reason")
for c in gold:
    block, why = rule.decide(c["a"], c["b"], c["entail"], c["contra"])
    c["blockNew"], c["reasonNew"] = block, why
    c["blockLegacy"] = rule.decide_legacy(c["a"], c["b"], c["entail"], c["contra"])[0]
    got = "BLOCK" if block else "ALLOW"
    if c["expected"] == "OBSERVE":
        observe.append((c, got, why))
        continue
    ok = got == c["expected"]
    per_cat[c["category"]][1] += 1
    per_cat[c["category"]][0] += ok
    if not ok:
        misses[c["expected"]].append((c, why))
        print(f"  {c['a'][:33]:34s} {c['b'][:25]:26s} {c['expected']:6s} {got:6s} {why}   <-- MISS")

for cat in sorted(per_cat):
    ok, n = per_cat[cat]
    print(f"  {cat:24s} {ok}/{n}")

must_block = [c for c in gold if c["expected"] == "BLOCK"]
must_allow = [c for c in gold if c["expected"] == "ALLOW"]
recall = sum(c["blockNew"] for c in must_block) / len(must_block)
wrong_block = sum(c["blockNew"] for c in must_allow) / len(must_allow)
legacy_recall = sum(c["blockLegacy"] for c in must_block) / len(must_block)
legacy_wrong = sum(c["blockLegacy"] for c in must_allow) / len(must_allow)

bar("Headline rates — record these next to modelRevision / templateVersion (§ 7)")
print(f"  {'':28s} {'LIBERAL (Q11)':>15s} {'legacy (§4)':>15s}")
print(f"  {'must-block recall':28s} {recall:14.0%} {legacy_recall:15.0%}   (higher is better)")
print(f"  {'must-NOT-block wrong-block':28s} {wrong_block:14.0%} {legacy_wrong:15.0%}   (lower is better; the silent failure, § 8b)")

bar("§ 8d hypernym + § 8e robustness (observation only, no expectation)")
for c, got, why in observe:
    print(f"  {c['a'][:40]:42s} {c['b'][:22]:24s} {got:6s} {why:20s} {c['note']}")

# ------------------------------------------------------------------ real distribution
real = json.load(open("realdist_results.json"))
bar(f"REAL DISTRIBUTION ({len(real)} highest-cosine pairs) — a fresh apply, not § 8i's recount")

dup = [p for p in real if rule.dd_key(p["a"]) == rule.dd_key(p["b"])]
genuine = [p for p in real if rule.dd_key(p["a"]) != rule.dd_key(p["b"])]
reasons = collections.Counter()
n_new = n_legacy = 0
for p in genuine:
    block, why = rule.decide(p["a"], p["b"], p["entail"], p["contra"])
    p["blockNew"], p["reasonNew"] = block, why
    p["blockLegacy"] = rule.decide_legacy(p["a"], p["b"], p["entail"], p["contra"])[0]
    reasons[why] += 1
    n_new += block
    n_legacy += p["blockLegacy"]
print(f"  same ddCollisionKey (phase 1 already merges these): {len(dup)}")
print(f"  genuine candidates: {len(genuine)}")
print(f"  blocked by LIBERAL rule : {n_new}/{len(genuine)} ({n_new/len(genuine):.0%})   § 8i predicted 259/390 (66%)")
print(f"  blocked by legacy  rule : {n_legacy}/{len(genuine)} ({n_legacy/len(genuine):.0%})   § 8i predicted 169/390 (43%)")
print("  decision reasons:")
for why, n in reasons.most_common():
    print(f"    {why:20s} {n:4d}  ({n/len(genuine):.0%})")

# The § 4 grey band the liberal rule was designed to close.
band = [p for p in genuine if p["entail"] < 0.5 and p["contra"] < 0.5]
rescued = [p for p in band if p["blockNew"]]
print(f"\n  § 8i grey band (entail<0.5 AND contra<0.5): {len(band)} pairs, "
      f"{len(rescued)} now blocked ({len(rescued)/max(len(band),1):.0%}) — C13's target")

# ------------------------------------------------------------------ § 8c per-family, § 8g precursor
bar("§ 8c templated families — reported separately so they are never averaged away (C12)")
FAMILIES = {
    "surname X": lambda k: k.startswith("surname "),
    "classifier for X": lambda k: k.startswith("classifier"),
    "X district/county": lambda k: "district" in k or "county" in k,
}
for name, pred in FAMILIES.items():
    fam = [p for p in genuine if pred(rule.dd_key(p["a"])) and pred(rule.dd_key(p["b"]))]
    if not fam:
        print(f"  {name:20s} no pairs in this sample")
        continue
    blocked = [p for p in fam if p["blockNew"]]
    print(f"  {name:20s} {len(blocked)}/{len(fam)} blocked ({len(blocked)/len(fam):.0%}) "
          f"— expected LOW; these denote distinct entities")
    for p in blocked[:5]:
        print(f"      wrongly blocked? {p['a'][:34]:36s} | {p['b'][:34]:36s} {p['reasonNew']}")

# ------------------------------------------------------------------ § 8g size alarm precursor
# C14's consequence-clause: a liberal must-link over a transitive clustering merges fast.
# Degree here is a LOWER BOUND on group size (this sample is top-400 pairs, not top-k per
# gloss), so treat it as an early smell, not the § 8g distribution.
deg = collections.Counter()
for p in genuine:
    if p["blockNew"]:
        deg[rule.dd_key(p["a"])] += 1
        deg[rule.dd_key(p["b"])] += 1
bar("§ 8g size alarm (precursor — degree within this 400-pair sample only)")
print(f"  glosses with >=1 must-link: {len(deg)}   max degree: {max(deg.values()) if deg else 0}")
for k, n in deg.most_common(8):
    print(f"    {n:3d}  {k[:60]}")

json.dump({"modelRevision": MODEL_REVISION, "templateVersion": TEMPLATE_VERSION,
           "tauSyn": rule.TAU_SYN, "tauContra": rule.TAU_CONTRA,
           "goldset": {"mustBlockRecall": round(recall, 3), "mustNotBlockWrongBlock": round(wrong_block, 3),
                       "legacyMustBlockRecall": round(legacy_recall, 3),
                       "legacyMustNotBlockWrongBlock": round(legacy_wrong, 3),
                       "misses": [{"a": c["a"], "b": c["b"], "expected": c["expected"],
                                   "reason": w, "category": c["category"]}
                                  for exp in misses for c, w in misses[exp]]},
           "realDistribution": {"genuine": len(genuine), "blockedNew": n_new, "blockedLegacy": n_legacy,
                                "reasons": dict(reasons), "greyBand": len(band), "greyBandBlocked": len(rescued)}},
          open("rule_eval_results.json", "w"), ensure_ascii=False, indent=1)
print("\nwrote rule_eval_results.json")
