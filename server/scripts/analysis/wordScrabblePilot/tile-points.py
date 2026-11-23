"""Word-tile Scrabble pilot — point value for every candidate tile from its estimated play rate.

play rate = P(tile appears in at least one legal play | tile is in the rack), measured on the
recommended rack-11 configurations (racks11a + racks11 opening, both judges).
- Tiles that were in the sampled bag: their measured rate, shrunk toward their rating's mean
  (Bayesian, prior weight K racks) so a tile seen a few times can't land on 0% or 100% by chance.
- Tiles never sampled: their connectivity rating's mean measured rate (a coarse prior; it can't tell a
  stuck noun like 云 from an easy one like 孩子 — logged verdicts in the product should replace it).
points = 1 + round(9 * (1 - play rate))  → 1 (always playable) … 10 (almost never playable).
Tiles below the bag's minimum connectivity get no points (they never enter the bag).

Docs: docs/BACKLOG.md § 10; review doc "Scrabble Viability Framework" § Pilot round 3.
Usage: python3 tile-points.py r3 [min-connectivity]   → data/<round>-points-all.json
"""
import json,glob,collections,sys,os
HERE=os.path.dirname(os.path.abspath(__file__)); DATA=f'{HERE}/data'
L=sys.argv[1] if len(sys.argv)>1 else 'r3'; MIN_C=int(sys.argv[2]) if len(sys.argv)>2 else 3
K=10            # prior weight, in racks
CFGS=['racks11a','racks11']
conn={}
for f in glob.glob(f'{DATA}/{L}-conn-out-*.jsonl'):
    for l in open(f):
        if l.strip(): o=json.loads(l); conn[o['w']]=o['c']
seen=collections.Counter(); used=collections.Counter()
for cfg in CFGS:
    racks={int(l.split('\t')[0]):l.rstrip('\n').split('\t')[1].split() for l in open(f'{DATA}/{L}-{cfg}.txt')}
    for f in sorted(glob.glob(f'{DATA}/{L}-out-{cfg}-j*.jsonl')):
        for l in open(f):
            r=json.loads(l); u={t for p in r['plays'] for t in p.split('|')}
            for t in set(racks[r['id']]): seen[t]+=1; used[t]+= t in u
# Rating prior = pooled measured play rate of all sampled tiles with that rating
tier=collections.defaultdict(lambda:[0,0])
for t in seen: tier[conn[t]][0]+=seen[t]; tier[conn[t]][1]+=used[t]
prior={c:u/s for c,(s,u) in tier.items()}
out={}
for t,c in conn.items():
    if c<MIN_C: continue
    p=prior.get(c, prior[min(prior)])
    rate=(used[t]+K*p)/(seen[t]+K) if seen[t] else p
    out[t]={'connectivity':c,'seen':seen[t],'play_rate':round(rate,2),
            'points':1+round(9*(1-rate)),'source':'measured' if seen[t] else 'rating prior'}
json.dump(dict(sorted(out.items(),key=lambda x:(x[1]['points'],x[0]))),open(f'{DATA}/{L}-points-all.json','w'),ensure_ascii=False,indent=0)
print('rating priors (rack 11):',{c:f'{v:.0%}' for c,v in sorted(prior.items())})
print('tiles priced:',len(out),'| measured:',sum(v['source']=='measured' for v in out.values()))
bag=collections.Counter(json.load(open(f'{DATA}/{L}-bag.json'))['bag'])
print('point histogram, bag (100 tiles):',sorted(collections.Counter(out[t]['points'] for t in bag.elements()).items()))
print('point histogram, all priced    :',sorted(collections.Counter(v['points'] for v in out.values()).items()))
for pts in range(1,11):
    ws=[t for t in bag if out[t]['points']==pts]
    if ws: print(f'  {pts:2d} pts: '+' '.join(f'{t}({out[t]["play_rate"]:.0%})' for t in ws))
