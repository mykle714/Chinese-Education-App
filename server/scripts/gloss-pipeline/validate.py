"""
§ 7 "Validation — run this every time, not once", and § 8g's post-clustering properties.

Checks the BUILT gloss_meaning_groups table, not a pair score: the § 8b failure mode is
two glosses landing in one GROUP by chaining, which no pairwise check can see. Prints the
must-block / must-not-block rates § 7 requires be recorded alongside modelRevision and
templateVersion on every rebuild.

Exit code is 0 even on regressions: § 7 says report, do not fail the build. A rate that
drifts is the signal to revisit the tuning target (§ 10 Q4), which is a decision, not a law.

    ~/.venvs/gloss-pipeline/bin/python validate.py
"""
import collections, json, os, sys
import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
GOLDSET = os.path.join(HERE, "..", "gloss-probe", "goldset.json")
sys.path.insert(0, os.path.join(HERE, "..", "gloss-probe"))
import rule  # noqa: E402

DB = dict(host=os.environ.get("DB_HOST", "localhost"), port=int(os.environ.get("DB_PORT", 5432)),
          dbname=os.environ.get("DB_NAME", "cow_db"), user=os.environ.get("DB_USER", "cow_user"),
          password=os.environ.get("DB_PASSWORD", "cow_password_local"))

# § 8g: contrast pairs that must be in DIFFERENT groups after clustering. Kept here rather
# than in goldset.json because these are hand-written English probes, not corpus rows.
CHAIN_HUNT = ["a little", "a bit", "a little bit", "somewhat", "rather", "slightly"]


def main():
    conn = psycopg2.connect(**DB)
    cur = conn.cursor()
    cur.execute('SELECT "glossKey", "meaningGroupId" FROM gloss_meaning_groups')
    group = dict(cur.fetchall())
    cur.execute('SELECT DISTINCT "modelRevision", "templateVersion", "corpusSnapshot" '
                'FROM gloss_meaning_groups')
    stamps = cur.fetchall()
    if not group:
        sys.exit("gloss_meaning_groups is empty — run cluster.py first")
    print(f"build: {stamps[0] if len(stamps) == 1 else stamps}")
    print(f"{len(group)} glosses, {len(set(group.values()))} groups\n")

    cases = json.load(open(GOLDSET))
    tally = collections.Counter()
    missing = 0
    for c in cases:
        if c["expected"] == "OBSERVE":
            continue
        ka, kb = rule.dd_key(c["a"]), rule.dd_key(c["b"])
        # § 6 rule 1: a gloss with no row imposes no constraint. Not a failure — but it is
        # not evidence of correctness either, so count it separately rather than as a pass.
        if ka not in group or kb not in group:
            missing += 1
            continue
        same = group[ka] == group[kb]
        ok = same == (c["expected"] == "BLOCK")
        tally[(c["expected"], ok)] += 1
        if not ok:
            print(f"  MISS  {c['a'][:34]:36s} {c['b'][:30]:32s} expected {c['expected']}, "
                  f"groups {group[ka]}/{group[kb]}  ({c['category']})")

    blocked_ok = tally[("BLOCK", True)]
    blocked_n = blocked_ok + tally[("BLOCK", False)]
    allow_bad = tally[("ALLOW", False)]
    allow_n = allow_bad + tally[("ALLOW", True)]
    print(f"\n  must-block recall        {blocked_ok}/{blocked_n} "
          f"({blocked_ok / max(blocked_n, 1):.0%})   § 8a")
    print(f"  must-NOT-block wrong     {allow_bad}/{allow_n} "
          f"({allow_bad / max(allow_n, 1):.0%})   § 8b — the SILENT failure; watch this one")
    print(f"  not in corpus (no row)   {missing}   — no constraint, § 6 rule 1")

    print("\n§ 8g chain hunt — these must NOT all collapse into one group:")
    for key in CHAIN_HUNT:
        print(f"  {key:16s} {group.get(rule.dd_key(key), '(no row)')}")

    sizes = collections.Counter(collections.Counter(group.values()).values())
    print("\ngroup size distribution: " + ", ".join(f"{s}:{n}" for s, n in sorted(sizes.items())))
    conn.close()


if __name__ == "__main__":
    main()
