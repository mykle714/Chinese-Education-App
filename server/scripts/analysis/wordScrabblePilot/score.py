"""Word-tile Scrabble pilot — soft quality scores + empirical tile points from AI-judge outputs.

Quality per metric: 1.0 inside a casual-player sweet spot [lo, hi], halving every half-width w outside
(Gaussian shoulder — no hard pass/fail gates). Overall = geometric mean (one collapsed metric drags it down).

Tile points (empirical, replaces the AI "niche" rating): usage(t) = P(t appears in at least one of the
judge's listed legal plays | t was in the rack). Points scale 1..10 with how rarely a tile gets used.

Docs: docs/BACKLOG.md § 10; review doc "Scrabble Viability Framework" § Quality scoring / § Pilot.
Round 3+: each rack file is judged twice (out-<cfg>-j1/-j2.jsonl). Metrics are averaged over judges and the
judge gap is printed as a noise estimate. Tile usage is also broken down by connectivity rating and rack
size, to show whether bigger racks rescue the lower-rated ("niche") tiles.

Usage: python3 score.py r2|r3
"""
import json,math,collections,sys,os,glob
HERE=os.path.dirname(os.path.abspath(__file__)); DATA=f'{HERE}/data'; L=sys.argv[1] if len(sys.argv)>1 else 'r2'
BANDS={'dead':(0,3,6),'bingo':(5,35,10),'choice':(4,15,3),'hook':(20,50,12)}
def q(m,lo,hi,w): return math.exp(-math.log(2)*(max(lo-m,0,m-hi)/w)**2)
def load(n):
    p=f'{DATA}/{L}-{n}'
    return [json.loads(l) for l in open(p) if l.strip()] if os.path.exists(p) else None
def racks(n):  # id -> rack tile list
    return {int(l.split('\t')[0]):l.rstrip('\n').split('\t')[1].split() for l in open(f'{DATA}/{L}-{n}.txt')}
conn={}
for f in glob.glob(f'{DATA}/{L}-conn-out-*.jsonl'):
    for l in open(f):
        if l.strip(): o=json.loads(l); conn[o['w']]=o['c']
present=collections.Counter(); used=collections.Counter()
tier=collections.defaultdict(lambda:[0,0])   # (cfg, connectivity) -> [present, used]
CFGS=[('racks7a',7),('racks9a',9),('racks9',9),('racks11a',11),('racks13a',13),('racks11',11)]
def metrics(out,full):
    return {'dead':100*sum(r['best_len']==0 for r in out)/len(out),
            'bingo':100*sum(r['best_len']>=full for r in out)/len(out),
            'long5':100*sum(r['best_len']>=5 for r in out)/len(out),
            'choice':sum(r.get('n_plays_est',0) for r in out)/len(out),
            'mean_best':sum(r['best_len'] for r in out)/len(out)}
for cfg,k in CFGS:
    judges=[o for o in (load(f'out-{cfg}.jsonl'),load(f'out-{cfg}-j1.jsonl'),load(f'out-{cfg}-j2.jsonl')) if o]
    if not judges: continue
    rk=racks(cfg); full=k+1 if cfg.endswith('a') else k  # a bingo = whole rack (+ the anchor)
    per=[metrics(o,full) for o in judges]
    d={m:sum(p[m] for p in per)/len(per) for m in per[0]}
    for out in judges:
        for r in out:
            rack=collections.Counter(rk[r['id']]); u=set(t for p in r['plays'] for t in p.split('|'))
            for t in rack:
                present[t]+=1; used[t]+= t in u
                if conn: c=tier[(cfg,conn.get(t,0))]; c[0]+=1; c[1]+= t in u
    gap=' judge gap: '+' '.join(f'{m} {abs(per[0][m]-per[1][m]):.1f}' for m in ('dead','mean_best','long5')) if len(per)==2 else ''
    print(f'== {cfg} ({len(per)} judge{"s"*(len(per)>1)}){gap}'); qs=[]
    for m,v in d.items():
        if m in BANDS: lo,hi,w=BANDS[m]; qs.append(q(v,lo,hi,w)); print(f'  {m:9s} {v:6.1f}  band {lo}-{hi}  q {qs[-1]:.2f}')
        else: print(f'  {m:9s} {v:6.1f}')
    print(f'  geomean(rack metrics) {math.exp(sum(math.log(max(x,1e-9)) for x in qs)/len(qs)):.2f}')
if tier:
    print('== tile usage by connectivity rating (rows) and rack config (cols)')
    cfgs=[c for c,_ in CFGS if any(k[0]==c for k in tier)]
    print('   c  '+' '.join(f'{c:>9s}' for c in cfgs))
    for cv in sorted({k[1] for k in tier}):
        print(f'   {cv}  '+' '.join(f'{100*tier[(c,cv)][1]/tier[(c,cv)][0]:8.0f}%' if tier[(c,cv)][0] else '        -' for c in cfgs))
h=load('out-hook.jsonl')
if h:
    v=100*sum(x['front'] or x['back'] for x in h)/len(h); lo,hi,w=BANDS['hook']
    print(f'== hook  {v:.1f}%  q {q(v,lo,hi,w):.2f}')
if present:
    pts={t:(used[t]/present[t],present[t]) for t in present}
    json.dump({t:{'usage':round(u,2),'seen':n,'points':1+round(9*(1-u))} for t,(u,n) in sorted(pts.items(),key=lambda x:-x[1][0])},
              open(f'{DATA}/{L}-tile-points.json','w'),ensure_ascii=False,indent=0)
    ranked=sorted(pts.items(),key=lambda x:-x[1][0])
    print('most used :',' '.join(f'{t}{u:.0%}' for t,(u,n) in ranked[:12] if n>=4))
    print('least used:',' '.join(f'{t}{u:.0%}' for t,(u,n) in ranked[::-1][:15] if n>=4))
