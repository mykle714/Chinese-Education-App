"""
C1 probe for docs/GLOSS_CONFUSABILITY.md.
Q: does an NLI cross-encoder separate synonymy from contrast ON CHINESE-DICTIONARY GLOSSES,
   where bi-encoder cosine cannot?
Compares, on the same gold set:
  - bi-encoder cosine          (the approach § 3c rejects)
  - NLI cross-encoder          (DeBERTa-v3-base, the § 4 design, pinned below)
"""
import json, sys, warnings
warnings.filterwarnings("ignore")
import torch
from sentence_transformers import SentenceTransformer
from transformers import AutoTokenizer, AutoModelForSequenceClassification

BI  = "sentence-transformers/all-MiniLM-L6-v2"
NLI = "MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli"   # § 10 Q10: DeBERTa-v3-base
TEMPLATE = "The word means {}."                        # § 4 framing; templateVersion v1

cases = json.load(open("goldset.json"))
print(f"gold set: {len(cases)} pairs | bi={BI} | nli={NLI}\n", flush=True)

print("loading bi-encoder...", flush=True)
bi = SentenceTransformer(BI)
A = [c["a"] for c in cases]; B = [c["b"] for c in cases]
ea, eb = bi.encode(A, normalize_embeddings=True), bi.encode(B, normalize_embeddings=True)
cos = (ea * eb).sum(1)

print("loading NLI cross-encoder (DeBERTa-v3-base)...", flush=True)
tok = AutoTokenizer.from_pretrained(NLI)
mdl = AutoModelForSequenceClassification.from_pretrained(NLI).eval()
label = {v.lower(): k for k, v in mdl.config.id2label.items()}
iE, iN, iC = label["entailment"], label["neutral"], label["contradiction"]

def nli(prem, hyp):
    with torch.no_grad():
        x = tok([TEMPLATE.format(p) for p in prem], [TEMPLATE.format(h) for h in hyp],
                return_tensors="pt", truncation=True, padding=True, max_length=256)
        return torch.softmax(mdl(**x).logits, -1)

print("scoring both directions...", flush=True)
pab, pba = nli(A, B), nli(B, A)

for i, c in enumerate(cases):
    c["cosine"]   = round(float(cos[i]), 3)
    c["entail"]   = round(float(min(pab[i][iE], pba[i][iE])), 3)   # mutual entailment
    c["contra"]   = round(float(max(pab[i][iC], pba[i][iC])), 3)
    c["neutral"]  = round(float(max(pab[i][iN], pba[i][iN])), 3)
json.dump(cases, open("probe_results.json", "w"), ensure_ascii=False, indent=1)
print("wrote probe_results.json")
