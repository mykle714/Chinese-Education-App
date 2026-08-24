"""
Steps 2–5 of the gloss confusability pipeline (docs/GLOSS_CONFUSABILITY.md § 4):
embed → ANN candidates → NLI judge → WordNet veto, all cached in the dev-only build tables.

    embed   step 2   bi-encoder over dd keys not yet in gloss_vectors
    judge   steps 3–5   ANN top-k, then cross-encoder + WordNet on pairs not yet judged
    all     both, in order

Everything here is INCREMENTAL by set-diff, which is why there is no `discoverableAt`
column and none should be added (§ 7): the job asks "which keys exist in glosses.tsv but
not in gloss_vectors?", and "which candidate pairs are not in gloss_pair_verdicts?".
That is also self-healing — an enrichment backfill that rewrites a gloss produces an
unseen key rather than a stale vector on a row.

Clustering (step 6) is deliberately NOT here: it needs no model, must be re-runnable on
its own, and lives in cluster.py.

Run from this directory, with the venv:
    ~/.venvs/gloss-pipeline/bin/python pipeline.py all
    ~/.venvs/gloss-pipeline/bin/python pipeline.py embed --limit 500      # smoke test
"""
import argparse, os, sys, time, warnings
warnings.filterwarnings("ignore")

try:
    import numpy as np
except ModuleNotFoundError as e:                    # pragma: no cover — operator guidance
    # The venv lives OUTSIDE the repo (~/.venvs/gloss-pipeline) so its ~1k library .py files
    # never appear in the working tree; the default install is the LIGHT one
    # (requirements-graph.txt, ~50 MB), which is all cluster.py / validate.py / sweep.py need.
    # Only this file wants the ~5.4 GB GPU stack, installed on demand rather than kept.
    sys.exit(
        f"{e}\n\n"
        "pipeline.py needs the HEAVY environment (torch + transformers, ~5.4 GB).\n"
        "The venv in this directory is the light graph-only one. Install the full stack:\n\n"
        "    ~/.venvs/gloss-pipeline/bin/pip install -r requirements.txt\n\n"
        "Nothing is lost by doing this late — vectors and verdicts live in Postgres, not in\n"
        "the venv. See README.md 'Two environments'."
    )
import psycopg2
import psycopg2.extras

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "gloss-probe"))
import rule  # noqa: E402  — the § 8i rule; wordnet_antonym is reused for step 5

# ── Pins. Changing either invalidates the caches below it (§ 7 "what forces which re-run").
BI_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
NLI_MODEL = "MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli"   # § 10 Q10
TEMPLATE = "The word means {}."                              # templateVersion v1
TEMPLATE_VERSION = "v1"

# ── Retrieval knobs. These only affect RECALL of candidate pairs; precision is the
# cross-encoder's job, so err generous. § 4 sizing assumes top-20.
TOP_K = 20
# MEASURED 2026-08-24, do not raise without re-running validate.py. The bi-encoder ranks
# some real synonym pairs BELOW antonym pairs (§ 3c's inversion: thing/object sits at 0.48
# while Monday/Tuesday sits at 0.87), so a tight cosine cut silently drops true collisions
# before the cross-encoder ever sees them — a recall failure invisible in every downstream
# metric. At 0.55, thing/object was never judged at all. TOP_K caps the blow-up, so
# loosening is cheap: 0.55 -> 34.9k candidate pairs, 0.40 -> 99k, 0.35 -> 108k, 0.30 -> 110k.
# Precision is the cross-encoder's job; this filter exists only to bound its cost.
COSINE_CUT = 0.35

DB = dict(host=os.environ.get("DB_HOST", "localhost"), port=int(os.environ.get("DB_PORT", 5432)),
          dbname=os.environ.get("DB_NAME", "cow_db"), user=os.environ.get("DB_USER", "cow_user"),
          password=os.environ.get("DB_PASSWORD", "cow_password_local"))


def connect():
    return psycopg2.connect(**DB)


def load_glosses():
    """Step 1's output. Node owns dd resolution; this side never re-derives a dd key."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "glosses.tsv")
    if not os.path.exists(path):
        sys.exit("glosses.tsv missing — run:  npx tsx scripts/gloss-pipeline/export-glosses.ts")
    keys = []
    for line in open(path):
        key = line.rstrip("\n").split("\t")[0]
        if key:
            keys.append(key)
    return sorted(set(keys))


# ────────────────────────────────────────────────────────────── step 2: embed

def quantize(vecs):
    """int8 quantization: § 4 sizes storage at 71 MB int8 vs 284 MB f32 at full det.
    Vectors are L2-normalized, so every component is in [-1, 1] and a fixed 127x scale is
    exact enough for a RETRIEVAL filter — the cross-encoder re-judges everything it returns,
    so quantization error costs at most a little recall, never a wrong verdict."""
    return np.clip(np.round(vecs * 127.0), -127, 127).astype(np.int8)


def dequantize(buf, dim):
    return np.frombuffer(buf, dtype=np.int8).reshape(-1, dim).astype(np.float32) / 127.0


def embed(limit=None):
    from sentence_transformers import SentenceTransformer
    keys = load_glosses()
    conn = connect()
    cur = conn.cursor()
    cur.execute('SELECT "glossKey" FROM gloss_vectors WHERE "modelRevision" = %s', (BI_MODEL,))
    have = {r[0] for r in cur.fetchall()}
    todo = [k for k in keys if k not in have]
    if limit:
        todo = todo[:limit]
    print(f"step 2 embed: {len(keys)} keys, {len(have)} cached, {len(todo)} new")
    if not todo:
        conn.close()
        return
    model = SentenceTransformer(BI_MODEL)
    t0 = time.time()
    vecs = model.encode(todo, normalize_embeddings=True, batch_size=256, show_progress_bar=False)
    q = quantize(np.asarray(vecs))
    psycopg2.extras.execute_batch(cur, """
        INSERT INTO gloss_vectors ("glossKey", embedding, "modelRevision", "updatedAt")
        VALUES (%s, %s, %s, NOW())
        ON CONFLICT ("glossKey") DO UPDATE
          SET embedding = EXCLUDED.embedding,
              "modelRevision" = EXCLUDED."modelRevision",
              "updatedAt" = NOW()
    """, [(k, psycopg2.Binary(q[i].tobytes()), BI_MODEL) for i, k in enumerate(todo)], page_size=500)
    conn.commit()
    conn.close()
    print(f"  embedded {len(todo)} in {time.time() - t0:.1f}s (dim {q.shape[1]})")


# ──────────────────────────────────────────────── steps 3–5: candidates, NLI, WordNet

def load_vectors(conn):
    cur = conn.cursor()
    cur.execute('SELECT "glossKey", embedding FROM gloss_vectors WHERE "modelRevision" = %s',
                (BI_MODEL,))
    rows = cur.fetchall()
    if not rows:
        sys.exit("no vectors — run `pipeline.py embed` first")
    keys = [r[0] for r in rows]
    dim = len(rows[0][1])   # int8, so byte count == dimension
    mat = np.vstack([dequantize(bytes(r[1]), dim) for r in rows])
    return keys, mat


def candidate_pairs(keys, mat, only_new=None):
    """Step 3. ANN top-k, in the JOB — not in Postgres. pgvector is not installed and is
    not needed (§ 3f): the runtime artifact is one integer per gloss, so no vector ever
    reaches the request path.

    Incremental by symmetry: querying outward from each NEW gloss finds every (new, old)
    and (new, new) pair; (old, old) pairs were found on a previous run. Falls back to an
    exact brute-force top-k when hnswlib is absent — at today's corpus (7.6k keys) the
    full similarity matrix is ~230 MB and takes seconds, so the index is an optimization,
    not a requirement.
    """
    query_idx = range(len(keys)) if only_new is None else [i for i, k in enumerate(keys) if k in only_new]
    pairs = set()
    try:
        import hnswlib
        index = hnswlib.Index(space="cosine", dim=mat.shape[1])
        index.init_index(max_elements=len(keys), ef_construction=200, M=16)
        index.add_items(mat, np.arange(len(keys)))
        index.set_ef(max(64, TOP_K * 4))
        labels, dists = index.knn_query(mat[list(query_idx)], k=min(TOP_K + 1, len(keys)))
        for row, qi in enumerate(query_idx):
            for lbl, dist in zip(labels[row], dists[row]):
                cos = 1.0 - float(dist)
                if lbl != qi and cos >= COSINE_CUT:
                    a, b = sorted((keys[qi], keys[lbl]))
                    pairs.add((a, b, round(cos, 4)))
    except ImportError:
        print("  hnswlib missing — exact brute-force top-k")
        for qi in query_idx:
            sims = mat @ mat[qi]
            sims[qi] = -1
            for lbl in np.argpartition(-sims, min(TOP_K, len(keys) - 1))[:TOP_K]:
                cos = float(sims[lbl])
                if cos >= COSINE_CUT:
                    a, b = sorted((keys[qi], keys[lbl]))
                    pairs.add((a, b, round(cos, 4)))
    # A pair can surface from both endpoints with slightly different quantized cosines;
    # keep one row per pair so the PK upsert is deterministic.
    best = {}
    for a, b, cos in pairs:
        best[(a, b)] = max(best.get((a, b), 0.0), cos)
    return [(a, b, c) for (a, b), c in best.items()]


def judge(batch_size=32, limit=None, full=False):
    import torch
    from transformers import AutoTokenizer, AutoModelForSequenceClassification

    conn = connect()
    keys, mat = load_vectors(conn)
    cur = conn.cursor()
    cur.execute('SELECT "glossKey" FROM gloss_vectors WHERE "modelRevision" = %s', (BI_MODEL,))
    # Only glosses with no verdict yet need outward queries — see the symmetry note above.
    cur.execute("""SELECT DISTINCT k FROM (
                     SELECT "glossKeyA" AS k FROM gloss_pair_verdicts
                      WHERE "modelRevision" = %s AND "templateVersion" = %s
                     UNION ALL
                     SELECT "glossKeyB" FROM gloss_pair_verdicts
                      WHERE "modelRevision" = %s AND "templateVersion" = %s) s""",
                (NLI_MODEL, TEMPLATE_VERSION, NLI_MODEL, TEMPLATE_VERSION))
    judged_keys = {r[0] for r in cur.fetchall()}
    new_keys = {k for k in keys if k not in judged_keys}
    print(f"steps 3–5: {len(keys)} vectors, {len(new_keys)} never judged"
          + (" | --full: querying outward from EVERY key" if full else ""))

    # ⚠️ The incremental set-diff is over GLOSSES, and it is only valid while the retrieval
    # parameters are unchanged. A key that already appears in some verdict is treated as
    # fully explored — so lowering COSINE_CUT or raising TOP_K does NOT re-discover its
    # neighbours, and the run silently under-retrieves. Any change to the retrieval knobs
    # therefore needs --full, which queries outward from every key; the pair-level set-diff
    # below still means only genuinely new pairs are judged, so --full is cheap to prefer
    # when in doubt. (Measured 2026-08-24: without it, dropping the cut 0.55 -> 0.35 found
    # 13k new pairs instead of 75k, and thing/object stayed unjudged.)
    t0 = time.time()
    pairs = candidate_pairs(keys, mat, only_new=None if (full or not judged_keys) else new_keys)
    print(f"  step 3: {len(pairs)} candidate pairs (top-{TOP_K}, cosine >= {COSINE_CUT}) "
          f"in {time.time() - t0:.1f}s")

    cur.execute('SELECT "glossKeyA", "glossKeyB" FROM gloss_pair_verdicts '
                'WHERE "modelRevision" = %s AND "templateVersion" = %s',
                (NLI_MODEL, TEMPLATE_VERSION))
    have = {(a, b) for a, b in cur.fetchall()}
    todo = [p for p in pairs if (p[0], p[1]) not in have]
    if limit:
        todo = todo[:limit]
    print(f"  step 4: {len(todo)} pairs to judge ({len(pairs) - len(todo)} cached)")
    if not todo:
        conn.close()
        return

    device = "cuda" if torch.cuda.is_available() else "cpu"
    tok = AutoTokenizer.from_pretrained(NLI_MODEL)
    mdl = AutoModelForSequenceClassification.from_pretrained(NLI_MODEL).eval().to(device)
    if device == "cuda":
        mdl = mdl.half()
    label = {v.lower(): k for k, v in mdl.config.id2label.items()}
    iE, iC = label["entailment"], label["contradiction"]
    print(f"  device: {device}")

    def score(A, B):
        out = []
        for i in range(0, len(A), batch_size):
            with torch.no_grad():
                x = tok([TEMPLATE.format(a) for a in A[i:i + batch_size]],
                        [TEMPLATE.format(b) for b in B[i:i + batch_size]],
                        return_tensors="pt", truncation=True, padding=True, max_length=256).to(device)
                out.append(torch.softmax(mdl(**x).logits.float(), -1).cpu())
        return torch.cat(out)

    A = [p[0] for p in todo]
    B = [p[1] for p in todo]
    t0 = time.time()
    ab, ba = score(A, B), score(B, A)   # NLI is directional; synonymy is symmetric (§ 4)
    print(f"  judged {len(todo)} pairs both directions in {time.time() - t0:.1f}s")

    rows = []
    for i, (a, b, cos) in enumerate(todo):
        rows.append((a, b, cos,
                     float(ab[i][iE]), float(ba[i][iE]),
                     max(float(ab[i][iC]), float(ba[i][iC])),
                     rule.wordnet_antonym(a, b),      # step 5, deterministic
                     NLI_MODEL, TEMPLATE_VERSION))
    psycopg2.extras.execute_batch(cur, """
        INSERT INTO gloss_pair_verdicts ("glossKeyA", "glossKeyB", cosine, "pEntailAb",
               "pEntailBa", "pContra", "wordnetAntonym", "modelRevision", "templateVersion")
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT ("glossKeyA", "glossKeyB") DO UPDATE
          SET cosine = EXCLUDED.cosine, "pEntailAb" = EXCLUDED."pEntailAb",
              "pEntailBa" = EXCLUDED."pEntailBa", "pContra" = EXCLUDED."pContra",
              "wordnetAntonym" = EXCLUDED."wordnetAntonym", "judgedAt" = NOW()
    """, rows, page_size=500)
    conn.commit()
    conn.close()
    print(f"  wrote {len(rows)} verdicts")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("stage", choices=["embed", "judge", "all"])
    ap.add_argument("--limit", type=int)
    ap.add_argument("--batch-size", type=int, default=32)
    ap.add_argument("--full", action="store_true",
                    help="query candidates outward from EVERY key, not just never-judged "
                         "ones. REQUIRED after changing COSINE_CUT or TOP_K.")
    a = ap.parse_args()
    if a.stage in ("embed", "all"):
        embed(a.limit)
    if a.stage in ("judge", "all"):
        judge(a.batch_size, a.limit, a.full)
