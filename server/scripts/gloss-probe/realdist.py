"""
Harder test: judge the pairs the RETRIEVER actually surfaces (all high-cosine), not a
curated gold set. This is the distribution step 4 of the pipeline really sees.
"""
import json, warnings, collections; warnings.filterwarnings("ignore")
import numpy as np, torch
from sentence_transformers import SentenceTransformer
from transformers import AutoTokenizer, AutoModelForSequenceClassification

rows=[]
for line in open("dd_zh.tsv"):
    line=line.rstrip("\n")
    if "\t" in line:
        w,g=line.split("\t",1)
        if g.strip(): rows.append((w,g.strip()))
dds=sorted({g for _,g in rows}); word_of=collections.defaultdict(list)
for w,g in rows: word_of[g].append(w)
print(f"{len(dds)} distinct dds", flush=True)

bi=SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
E=bi.encode(dds, normalize_embeddings=True, batch_size=256, show_progress_bar=False)
S=E@E.T; np.fill_diagonal(S,-1)
iu=np.triu_indices(len(dds),1)
flat=S[iu]
order=np.argsort(-flat)[:400]                      # top-400 pairs by cosine
pairs=[(dds[iu[0][k]], dds[iu[1][k]], float(flat[k])) for k in order]
print(f"top-400 cosine range {pairs[-1][2]:.3f} .. {pairs[0][2]:.3f}", flush=True)

NLI="MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli"; T="The word means {}."
tok=AutoTokenizer.from_pretrained(NLI); mdl=AutoModelForSequenceClassification.from_pretrained(NLI).eval()
L={v.lower():k for k,v in mdl.config.id2label.items()}; iE,iC=L["entailment"],L["contradiction"]
def score(A,B):
    out=[]
    for i in range(0,len(A),32):
        with torch.no_grad():
            x=tok([T.format(a) for a in A[i:i+32]],[T.format(b) for b in B[i:i+32]],
                  return_tensors="pt",truncation=True,padding=True,max_length=256)
            out.append(torch.softmax(mdl(**x).logits,-1))
    return torch.cat(out)
A=[p[0] for p in pairs]; B=[p[1] for p in pairs]
print("judging 400 pairs, both directions...", flush=True)
ab,ba=score(A,B),score(B,A)
res=[{"a":A[i],"b":B[i],"cos":round(pairs[i][2],3),
      "entail":round(float(min(ab[i][iE],ba[i][iE])),3),
      "contra":round(float(max(ab[i][iC],ba[i][iC])),3),
      "wa":word_of[A[i]][:2],"wb":word_of[B[i]][:2]} for i in range(len(A))]
json.dump(res,open("realdist_results.json","w"),ensure_ascii=False,indent=1)
print("wrote realdist_results.json")
