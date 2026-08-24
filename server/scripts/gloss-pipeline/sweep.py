"""
LINKAGE_TAU sensitivity sweep (docs/GLOSS_CONFUSABILITY.md § 10 Q8 / C7).

NO MODEL INFERENCE and NO WRITES — pure graph re-derivation over the cached verdicts,
which is the whole payoff of § 7 rule 1 (cache raw probabilities, never booleans).

    ~/.venvs/gloss-pipeline/bin/python sweep.py

Why not tune on goldset.json: it holds 26 usable pairs. A 26-case set cannot separate
tau values whose real difference is a few hundred merges. So the sweep scores each tau
against the rule's OWN verdicts over every judged pair — the rule is the specification,
clustering is the approximation, and the question is how much the approximation loses.

  honoured   — must-link pairs whose endpoints share a group. The rule said "block";
               does the runtime, which compares group ids, actually block them? (C18)
  overmerged — pairs the rule explicitly did NOT link that share a group anyway. This is
               chaining, and it is the § 8b SILENT failure: two different meanings that
               the runtime will now refuse to show together.
"""
import collections, json, os, sys
import psycopg2
import cluster as C

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "gloss-probe"))
import rule  # noqa: E402

TAUS = [0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.70]
CHAIN_HUNT = ["a little", "a bit", "a little bit", "somewhat", "rather", "slightly", "not very"]
WATCH = [("a few", "few"), ("thing", "object"), ("big", "small"), ("buy", "sell")]


def main():
    conn = psycopg2.connect(**C.DB)
    live = C.live_keys()
    cases = [c for c in json.load(open(os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "gloss-probe", "goldset.json")))
        if c["expected"] != "OBSERVE"]

    # The full judged-pair set, partitioned by what the rule says. Loaded once; only the
    # containment floor depends on tau, so `must` is rebuilt per tau but this is not.
    cur = conn.cursor()
    cur.execute("""SELECT "glossKeyA", "glossKeyB", "pEntailAb", "pEntailBa", "pContra",
                          "wordnetAntonym"
                     FROM gloss_pair_verdicts
                    WHERE "modelRevision" = %s AND "templateVersion" = %s""",
                (C.NLI_MODEL, C.TEMPLATE_VERSION))
    linked, unlinked = [], []
    for a, b, e_ab, e_ba, contra, wn in cur.fetchall():
        if a not in live or b not in live:
            continue
        block, why = rule.decide(a, b, min(e_ab, e_ba), contra)
        if wn:
            block, why = False, "wordnet-antonym"
        (linked if block else unlinked).append((a, b))
    print(f"{len(linked)} must-link pairs, {len(unlinked)} judged-but-not-linked pairs\n")

    hdr = (f"{'tau':>5}  {'groups':>7} {'nonsing':>7} {'largest':>7} {'>12':>4}  "
           f"{'honoured':>18}  {'overmerged':>18}  {'gold R':>7} {'gold W':>7}  chain")
    print(hdr); print("-" * len(hdr))
    rows = []
    for tau in TAUS:
        must, cannot, _, _ = C.load_edges(conn, live, tau)
        assign, members = C.cluster(must, cannot, tau)
        g = {}
        for k, root in assign.items():
            g[k] = root
        sizes = collections.Counter(collections.Counter(g.values()).values())
        n_groups = len(set(g.values())) + sum(1 for k in live if k not in g)
        largest = max(collections.Counter(g.values()).values()) if g else 1
        over_alarm = sum(n for s, n in sizes.items() if s > C.SIZE_ALARM)

        def same(a, b):
            return a in g and b in g and g[a] == g[b]

        hon = sum(1 for a, b in linked if same(a, b))
        ovr = sum(1 for a, b in unlinked if same(a, b))
        gr = [c for c in cases if c["expected"] == "BLOCK"]
        gw = [c for c in cases if c["expected"] != "BLOCK"]

        def present(c):
            return rule.dd_key(c["a"]) in live and rule.dd_key(c["b"]) in live
        gr = [c for c in gr if present(c)]
        gw = [c for c in gw if present(c)]
        gr_ok = sum(1 for c in gr if same(rule.dd_key(c["a"]), rule.dd_key(c["b"])))
        gw_bad = sum(1 for c in gw if same(rule.dd_key(c["a"]), rule.dd_key(c["b"])))
        chain = len({g.get(k, f"~{k}") for k in CHAIN_HUNT if k in live})
        n_chain = sum(1 for k in CHAIN_HUNT if k in live)
        print(f"{tau:5.2f}  {n_groups:7d} {sum(sizes[s] for s in sizes if s>1):7d} "
              f"{largest:7d} {over_alarm:4d}  "
              f"{hon:6d}/{len(linked)} ({100*hon/len(linked):4.1f}%)  "
              f"{ovr:6d}/{len(unlinked)} ({100*ovr/len(unlinked):4.1f}%)  "
              f"{gr_ok:3d}/{len(gr):<3d} {gw_bad:3d}/{len(gw):<3d}  {chain}/{n_chain} grp")
        rows.append((tau, g))

    print("\nwatched pairs — SAME group at each tau:")
    for a, b in WATCH:
        marks = []
        for tau, g in rows:
            if a not in g and b not in g:
                marks.append("·")
            else:
                marks.append("S" if (a in g and b in g and g[a] == g[b]) else "-")
        print(f"  {a:14s} / {b:14s}  " + " ".join(f"{m:>5}" for m in marks))
    print(f"  {'tau':14s}   {'':14s}  " + " ".join(f"{t:5.2f}" for t, _ in rows))


if __name__ == "__main__":
    main()
