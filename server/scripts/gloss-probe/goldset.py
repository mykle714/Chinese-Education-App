"""
Gold set for docs/GLOSS_CONFUSABILITY.md § 8.
Real pairs are pulled from the live discoverable zh corpus (dd_zh.tsv); generic
pairs are hand-written English contrast pairs the app must never separate.
Each entry: (A, B, expected)  expected in {"BLOCK", "ALLOW"}
"""
import collections, json, re

rows = []
for line in open("dd_zh.tsv"):
    line = line.rstrip("\n")
    if "\t" in line:
        w, g = line.split("\t", 1)
        if g.strip():
            rows.append((w, g.strip()))

by_dd = collections.defaultdict(list)
for w, g in rows:
    by_dd[g.lower()].append(w)

def family(pred, n):
    """Distinct dds matching a predicate, as (word, dd) pairs."""
    seen, out = set(), []
    for w, g in rows:
        if pred(g.lower()) and g.lower() not in seen:
            seen.add(g.lower()); out.append((w, g))
        if len(out) >= n: break
    return out

CASES = []
def add(cat, a, b, exp, note=""):
    CASES.append(dict(category=cat, a=a, b=b, expected=exp, note=note))

# 8a MUST-BLOCK -- real exact-dd collisions from the corpus
for dd, words in sorted(by_dd.items(), key=lambda kv: -len(kv[1]))[:6]:
    if len(words) > 1:
        add("8a exact-dd (real)", dd, dd, "BLOCK", f"{len(words)} words: {' '.join(words[:5])}")
# 8a MUST-BLOCK -- real near-miss synonym phrases
for a, b, note in [("a little","a bit","一下 / 一点"),
                   ("a little","slightly",""),
                   ("to get angry","to be furious",""),
                   ("to go","go","bare vs to-infinitive"),
                   ("a few","few","determiner noise"),
                   ("thing","object","")]:
    add("8a near-miss", a, b, "BLOCK", note)

# 8b MUST-NOT-BLOCK -- contrast pairs
for a,b,note in [("big","small","antonym"),("buy","sell","antonym"),
                 ("open","close","antonym"),("hot","cold","antonym"),
                 ("left","right","directional"),("up","down","directional"),
                 ("to come","to go","来/去 core teaching pair"),
                 ("Monday","Tuesday","co-hyponym"),("red","blue","co-hyponym"),
                 ("mother","father","co-hyponym"),("cat","dog","co-hyponym"),
                 ("one","two","一/二 must share a board")]:
    add("8b contrast", a, b, "ALLOW", note)

# 8c TEMPLATED FAMILIES -- the out-of-distribution risk, all real
fams = [("surname",      lambda g: g.startswith("surname "),   "ALLOW", "different surnames"),
        ("classifier",   lambda g: g.startswith("classifier"), "ALLOW", "ambiguous - eyeball"),
        ("place/district",lambda g: "district of" in g or "county of" in g, "ALLOW", "different places")]
for name, pred, exp, note in fams:
    fam = family(pred, 4)
    for i in range(len(fam)-1):
        add(f"8c {name}", fam[i][1], fam[i+1][1], exp, f"{fam[i][0]} vs {fam[i+1][0]} - {note}")

# 8d HYPERNYM -- observation only, no expectation
for a,b in [("dog","animal"),("rose","flower"),("car","vehicle")]:
    add("8d hypernym", a, b, "OBSERVE", "one-way entailment expected")

# 8e ROBUSTNESS
longest = max((g for _, g in rows), key=len)
han = next((g for _, g in rows if re.search(r"[一-鿿]", g)), None)
add("8e robustness", longest[:200], "school of thought", "OBSERVE", f"longest gloss ({len(longest)} chars)")
if han: add("8e robustness", han, "a district", "OBSERVE", "gloss contains Han + numbered pinyin")
add("8e robustness", "measure word", "measure word", "BLOCK", "identical strings")

json.dump(CASES, open("goldset.json","w"), ensure_ascii=False, indent=1)
n = collections.Counter(c["expected"] for c in CASES)
print(f"gold set: {len(CASES)} pairs  ->  {dict(n)}")
for cat in sorted({c['category'] for c in CASES}):
    print(f"  {cat:24s} {sum(1 for c in CASES if c['category']==cat)}")
