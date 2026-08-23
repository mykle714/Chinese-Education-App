# Hypothesis: the low-mutual-entailment band is ONE-WAY entailment (specialization) --
# exactly what Q2 decided to ignore. Measure both directions separately.
import json,warnings,re; warnings.filterwarnings("ignore")
import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification
r=json.load(open("realdist_results.json"))
def ddkey(t): return re.sub(r'\s+',' ',re.sub(r'\s*\([^)]*\)','',t).strip()).lower().rstrip('.')
band=[c for c in r if ddkey(c['a'])!=ddkey(c['b']) and c['entail']<0.5 and c['contra']<0.5]
NLI="MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli"; T="The word means {}."
tok=AutoTokenizer.from_pretrained(NLI); mdl=AutoModelForSequenceClassification.from_pretrained(NLI).eval()
L={v.lower():k for k,v in mdl.config.id2label.items()}; iE=L["entailment"]
A=[c['a'] for c in band]; B=[c['b'] for c in band]
def s(X,Y):
    o=[]
    for i in range(0,len(X),32):
        with torch.no_grad():
            x=tok([T.format(v) for v in X[i:i+32]],[T.format(v) for v in Y[i:i+32]],
                  return_tensors="pt",truncation=True,padding=True,max_length=256)
            o.append(torch.softmax(mdl(**x).logits,-1))
    return torch.cat(o)
ab,ba=s(A,B),s(B,A)
print(f"{len(band)} pairs in the low-entail / low-contra band (neither synonym nor antonym by the rule)\n")
print(f"  {'A':32s} {'B':30s} {'A->B':>6s} {'B->A':>6s} {'max':>6s} contained")
out=[]
for i,c in enumerate(band):
    e1,e2=float(ab[i][iE]),float(ba[i][iE]); mx=max(e1,e2)
    ka,kb=ddkey(c['a']),ddkey(c['b'])
    cont = kb.startswith(ka+" ") or kb.endswith(" "+ka) or ka.startswith(kb+" ") or ka.endswith(" "+kb)
    out.append((mx,cont))
    if i<14: print(f"  {c['a'][:31]:32s} {c['b'][:29]:30s} {e1:6.2f} {e2:6.2f} {mx:6.2f}  {'YES' if cont else '-'}")
hi=[o for o in out if o[0]>=0.8]; cont=[o for o in out if o[1]]
print(f"\n  one-way entailment >=0.8 : {len(hi)}/{len(out)} ({len(hi)/len(out)*100:.0f}%)  <- Q2 currently IGNORES these")
print(f"  lexically contained      : {len(cont)}/{len(out)} ({len(cont)/len(out)*100:.0f}%)  <- free signal, no model")
print(f"  caught by EITHER         : {sum(1 for o in out if o[0]>=0.8 or o[1])}/{len(out)}")
