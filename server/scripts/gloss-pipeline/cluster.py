"""
Steps 6–7 of the gloss confusability pipeline (docs/GLOSS_CONFUSABILITY.md § 4):
constrained clustering over the cached verdicts, then upsert into gloss_meaning_groups.

NO MODEL INFERENCE. This is pure graph work over gloss_pair_verdicts, which is why § 7
can schedule it weekly at a cost of "seconds" and why retuning a threshold is free. Needs
neither torch nor the venv's GPU stack — only psycopg2 and rule.py.

    ~/.venvs/gloss-pipeline/bin/python cluster.py                 # cluster + write, then report
    ~/.venvs/gloss-pipeline/bin/python cluster.py --dry-run       # report only, write nothing
    ~/.venvs/gloss-pipeline/bin/python cluster.py --linkage 0.6   # retune (free — no re-judge)

── Why average linkage and not connected components ──────────────────────────────────
Similarity is NOT transitive (§ 4). Single-linkage / connected components chains:
*a little* ~ *a bit* ~ *somewhat* ~ *rather* ~ *slightly* collapses into one group, and
with the § 8i liberal must-link (66% of top-k neighbours link) that chaining is the
dominant risk, not a corner case. Average linkage requires a candidate merge to be
supported by the AVERAGE strength across all member pairs — missing edges count as zero —
so a chain of individually-strong links cannot drag two dissimilar ends together.

── Why cannot-link is a hard constraint, not just an absent must-link (Q9) ────────────
*big* and *small* are never linked directly — the cross-encoder scores their mutual
entailment at 0.00 — but nothing stops them landing in one group by chaining through a
shared neighbour. A hard cannot-link edge does. This is the machinery that makes § 8g's
"big and small must be in DIFFERENT GROUPS after clustering, not merely below threshold as
a pair" a checkable property.
"""
import argparse, collections, os, sys
import psycopg2, psycopg2.extras

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "gloss-probe"))
import rule  # noqa: E402  — the ONE implementation of the § 8i blocking rule

HERE = os.path.dirname(os.path.abspath(__file__))
NLI_MODEL = "MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli"
TEMPLATE_VERSION = "v1"

# Average-linkage merge threshold. A merge needs mean edge strength at least this high
# across every cross-cluster pair. Tune against the § 8g size distribution this script
# prints — the § 10 Q8 alarm is the signal, and retuning costs one re-run of this file.
LINKAGE_TAU = 0.5

# § 10 Q8: an ALARM, never an action. Oversized groups are logged with their members and
# never auto-split — you cannot pick a sensible cap or splitting rule without first seeing
# the real distribution, and auto-splitting would hide the very data needed to choose one.
SIZE_ALARM = 12

DB = dict(host=os.environ.get("DB_HOST", "localhost"), port=int(os.environ.get("DB_PORT", 5432)),
          dbname=os.environ.get("DB_NAME", "cow_db"), user=os.environ.get("DB_USER", "cow_user"),
          password=os.environ.get("DB_PASSWORD", "cow_password_local"))


def live_keys():
    """The dd keys of the CURRENT corpus, straight from step 1's glosses.tsv."""
    return {line.split("\t")[0] for line in
            (raw.rstrip("\n") for raw in open(os.path.join(HERE, "glosses.tsv"))) if line}


def load_edges(conn, live, containment_floor=None):
    """Turn cached verdicts into must-link (weighted) and cannot-link (hard) edges via
    rule.decide — the same function § 8j measured and the same one the runtime guard will
    mirror. Nothing here re-derives the rule.

    `live` gates every edge. The verdict cache is append-only and keyed by gloss text, so
    it outlives the glosses themselves: when a det edit changes a dd, the OLD key's pairs
    stay cached forever. Clustering them would not merely write dead rows — a stale key
    is a live *bridge*, and average linkage would merge two current groups through a gloss
    no longer in the corpus. Filtering here is what keeps a rebuild a function of the
    current corpus alone."""
    cur = conn.cursor()
    cur.execute("""SELECT "glossKeyA", "glossKeyB", "pEntailAb", "pEntailBa", "pContra",
                          "wordnetAntonym"
                     FROM gloss_pair_verdicts
                    WHERE "modelRevision" = %s AND "templateVersion" = %s""",
                (NLI_MODEL, TEMPLATE_VERSION))
    must, cannot, reasons = {}, set(), collections.Counter()
    stale = 0
    for a, b, e_ab, e_ba, contra, wn_antonym in cur.fetchall():
        if a not in live or b not in live:
            stale += 1
            continue
        mutual = min(e_ab, e_ba)
        block, why = rule.decide(a, b, mutual, contra)
        # The stored WordNet flag is authoritative for the veto: it was computed when the
        # pair was judged, against the corpus that was installed then. rule.decide would
        # recompute it, but only if nltk is present on THIS machine — so honour the cache.
        if wn_antonym:
            block, why = False, "wordnet-antonym"
        reasons[why] += 1
        if block:
            # Edge strength: how strongly the pair must merge. Containment carries no
            # probability of its own (it is a free string test, § 8j: 20% of the signal),
            # so it is floored at the merge threshold — enough to link a pair on its own,
            # never enough to make a long chain look strong on average.
            # `containment_floor` defaults to LINKAGE_TAU but MUST track the tau actually
            # being clustered at, or a sweep silently holds containment edges at 0.5 while
            # moving the bar around them — the edges would stop being "just enough to link"
            # and become strong or inert depending on which way tau moved.
            floor = LINKAGE_TAU if containment_floor is None else containment_floor
            must[(a, b)] = max(mutual, floor if why == "containment" else 0.0)
        elif why in ("contradiction", "wordnet-antonym", "numeral-mismatch"):
            cannot.add((a, b))
    return must, cannot, reasons, stale


def cluster(must, cannot, linkage_tau):
    """Constrained average-linkage agglomeration over the sparse must-link graph.

    Greedy: repeatedly merge the cluster pair with the highest average edge strength,
    skipping any merge that would put a cannot-link pair together. Sparse throughout —
    only cluster pairs that share at least one must-link edge are ever considered, so the
    cost is O(edges · α) rather than O(nodes²), and the "seconds at 277k nodes" claim in
    § 7 survives.
    """
    parent = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b in must:
        find(a), find(b)
    for a, b in cannot:
        find(a), find(b)

    members = {k: {k} for k in parent}
    # Cross-cluster edge sums, so an average is (sum / |A|·|B|) at any moment.
    pair_sum = collections.defaultdict(float)
    for (a, b), w in must.items():
        ra, rb = find(a), find(b)
        if ra != rb:
            pair_sum[tuple(sorted((ra, rb)))] += w
    # Cannot-link is tracked at CLUSTER level and inherited on merge — that inheritance is
    # what blocks transitive violations, not merely direct ones.
    forbidden = collections.defaultdict(set)
    for a, b in cannot:
        ra, rb = find(a), find(b)
        if ra != rb:
            forbidden[ra].add(rb)
            forbidden[rb].add(ra)

    while True:
        best, best_avg = None, linkage_tau
        for (ra, rb), total in pair_sum.items():
            avg = total / (len(members[ra]) * len(members[rb]))
            if avg >= best_avg and rb not in forbidden[ra]:
                best, best_avg = (ra, rb), avg
        if best is None:
            break
        ra, rb = best
        # Merge the smaller into the larger; union-find keeps the roots consistent.
        if len(members[ra]) < len(members[rb]):
            ra, rb = rb, ra
        parent[rb] = ra
        members[ra] |= members.pop(rb)
        forbidden[ra] |= forbidden.pop(rb, set())
        for other in list(forbidden):
            if rb in forbidden[other]:
                forbidden[other].discard(rb)
                forbidden[other].add(ra)
        moved = collections.defaultdict(float)
        for (x, y), total in list(pair_sum.items()):
            if rb in (x, y):
                del pair_sum[(x, y)]
                other = y if x == rb else x
                if other != ra:
                    moved[tuple(sorted((ra, other)))] += total
        for key, total in moved.items():
            pair_sum[key] += total
        pair_sum.pop(tuple(sorted((ra, rb))), None)

    return {key: find(key) for key in parent}, members


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--linkage", type=float, default=LINKAGE_TAU)
    a = ap.parse_args()

    conn = psycopg2.connect(**DB)
    live = live_keys()
    must, cannot, reasons, stale = load_edges(conn, live, a.linkage)
    print(f"step 6: {len(must)} must-link, {len(cannot)} cannot-link edges "
          f"over {len(live)} live keys")
    if stale:
        print(f"  skipped {stale} cached pairs touching a gloss no longer in the corpus")
    for why, n in reasons.most_common():
        print(f"  {why:20s} {n}")

    assign, members = cluster(must, cannot, a.linkage)
    groups = collections.defaultdict(list)
    for key, root in assign.items():
        groups[root].append(key)

    # Every gloss gets a row, including singletons: a gloss with NO row means "no
    # constraint" at runtime (§ 6 rule 1), which is indistinguishable from "not yet built".
    # Writing singletons keeps those two states distinct.
    all_keys = sorted(live)
    group_of, next_id = {}, 1
    for root in sorted(groups, key=lambda r: (-len(groups[r]), r)):
        for key in sorted(groups[root]):
            group_of[key] = next_id
        next_id += 1
    for key in all_keys:
        if key not in group_of:
            group_of[key] = next_id
            next_id += 1

    sizes = collections.Counter(collections.Counter(group_of.values()).values())
    multi = {g: n for g, n in collections.Counter(group_of.values()).items() if n > 1}
    print(f"\n  {len(group_of)} glosses in {next_id - 1} groups "
          f"({len(multi)} non-singleton, largest {max(multi.values()) if multi else 1})")
    print("  size distribution: " + ", ".join(f"{s}:{n}" for s, n in sorted(sizes.items())))

    # § 8g / § 10 Q8 — the size alarm. Log and move on; never auto-split.
    by_group = collections.defaultdict(list)
    for key, gid in group_of.items():
        by_group[gid].append(key)
    oversize = [(g, ks) for g, ks in by_group.items() if len(ks) > SIZE_ALARM]
    if oversize:
        print(f"\n  ⚠️  SIZE ALARM: {len(oversize)} group(s) over {SIZE_ALARM} — inspect, do not auto-split")
        for g, ks in sorted(oversize, key=lambda t: -len(t[1]))[:5]:
            print(f"    group {g} ({len(ks)}): {', '.join(sorted(ks)[:10])}")
    else:
        print(f"\n  size alarm: clear (no group over {SIZE_ALARM})")

    # § 8g's checkable property: cannot-link must hold AFTER clustering, not just per-pair.
    violations = [(x, y) for x, y in cannot if group_of.get(x) == group_of.get(y)]
    print(f"  cannot-link violations after clustering: {len(violations)}"
          + ("" if not violations else f"  <-- BUG: {violations[:3]}"))

    if a.dry_run:
        print("\n--dry-run: nothing written")
        return

    snapshot = open(os.path.join(HERE, "corpus-snapshot.txt")).read().strip()
    cur = conn.cursor()
    # Atomic replace: readers see the previous snapshot until commit (§ 5a rule 2).
    cur.execute("BEGIN")
    cur.execute("TRUNCATE gloss_meaning_groups")
    psycopg2.extras.execute_batch(cur, """
        INSERT INTO gloss_meaning_groups ("glossKey", "meaningGroupId", "builtAt",
               "modelRevision", "templateVersion", "corpusSnapshot")
        VALUES (%s, %s, NOW(), %s, %s, %s)
    """, [(k, g, NLI_MODEL, TEMPLATE_VERSION, snapshot) for k, g in sorted(group_of.items())],
        page_size=1000)
    conn.commit()
    conn.close()
    print(f"\nwrote {len(group_of)} rows to gloss_meaning_groups (snapshot {snapshot})")


if __name__ == "__main__":
    main()
