"""Word-tile Scrabble pilot — build a 100-tile bag and the AI-judge sample files.

Each HSK 1–3 det entry is one tile (data/tiles.tsv from export-tiles.sql). The bag is composed by
part-of-speech quota with duplicated function words — the analogue of English's vowel/consonant mix,
because det's frequencyScore is saturated (most rows = 5) and can't weight a bag.

Round 2 rules (decided 2026-11-21): only the placed line is judged (natural sentence), and every play
runs through one tile already on the board (an "anchor").

Round 3 (2026-11-22): every tile must meet a minimum connectivity rating (1–5, AI-rated per
connectivity-rubric.md, merged from data/r3-conn-out-*.jsonl). Forced function words that fail are dropped
and the numeral/classifier block is replaced by det compounds (一个 一点 一下 一些). Rack sizes 9/11/13 are
compared so we can see whether a bigger rack rescues the lower-connectivity ("niche") tiles.

Docs: docs/BACKLOG.md § 10; review doc "Scrabble Viability Framework" § Pilot.
Usage: python3 build-samples.py <round-label> [min-connectivity]
"""
import csv,collections,json,random,sys,os,glob
HERE=os.path.dirname(os.path.abspath(__file__)); DATA=f'{HERE}/data'
label=sys.argv[1] if len(sys.argv)>1 else 'r2'
MIN_C=int(sys.argv[2]) if len(sys.argv)>2 else 3
R3=label!='r2'
rows=list(csv.reader(open(f'{DATA}/tiles.tsv'),delimiter='\t'))
pos={r[0]:(json.loads(r[3])[0] if r[3] else 'none') for r in rows}
by=collections.defaultdict(list)
for w,p in pos.items(): by[p].append(w)
rng=random.Random(42)
# Forced function words and their copy counts (the "vowels"). 吗/吧/呢/也 joined after the 2026-11-21 backfill.
forced={'我':3,'你':3,'他':2,'她':1,'我们':1,'这':1,'什么':1,
        '了':3,'的':2,'着':1,'吗':2,'吧':1,'呢':1,
        '不':2,'很':2,'都':1,'也':1,'就':1,
        '是':2,'有':2,'在':1,'去':1,'要':1,
        '好':2,'一':2,'两':1,'三':1,'个':2,'本':1,'张':1,
        '对':1,'从':1,'和':1,'但是':1}
if R3:
    # Connectivity ratings for every candidate tile; a tile below MIN_C never enters the bag.
    conn={}
    for f in glob.glob(f'{DATA}/{label}-conn-out-*.jsonl'):
        for l in open(f):
            if l.strip(): o=json.loads(l); conn[o['w']]=o['c']
    assert len(conn)>=len(pos)-5, f'connectivity ratings missing: {len(conn)}/{len(pos)}'
    for w in ('一','两','三','个','本','张'): forced.pop(w,None)   # numeral+classifier block → compounds
    forced.update({'一个':1,'一点':1,'一下':1,'一些':1})
    dropped=[w for w in forced if conn.get(w,0)<MIN_C]
    for w in dropped: forced.pop(w)
    print('forced tiles dropped for connectivity <',MIN_C,':',' '.join(dropped))
    passing=lambda w: conn.get(w,0)>=MIN_C
else:
    passing=lambda w: True
missing=[w for w in forced if w not in pos]; assert not missing, missing
bag=[w for w,n in forced.items() for _ in range(n)]
# Fill content words to quota (counts include forced tiles of that POS)
quota={'adverb':9,'verb':23,'noun':25,'adjective':8,'interjection':1}
for p,q in quota.items():
    have=sum(1 for w in bag if pos[w]==p)
    bag+=rng.sample([w for w in by[p] if w not in forced and passing(w)],max(0,q-have))
if R3:  # top up with passing tiles of any POS if dropped forced tiles left the bag short
    pool=[w for w in pos if passing(w) and w not in bag and pos[w] in quota]
    bag+=rng.sample(pool,max(0,100-len(bag)))
assert len(bag)==100, len(bag)
json.dump({'bag':bag,'pos':{w:pos[w] for w in set(bag)}},open(f'{DATA}/{label}-bag.json','w'),ensure_ascii=False,indent=0)
def write(n,lines): open(f'{DATA}/{label}-{n}.txt','w').write('\n'.join(lines)+'\n')
# rack<TAB>anchors: 3 anchors simulate the board tiles a player can reach on a mid-game board
for k in ((9,11,13) if R3 else (7,9)):
    write(f'racks{k}a',[f'{i+1}\t'+' '.join((d:=rng.sample(bag,k+3))[:k])+'\t'+' '.join(d[k:]) for i in range(50)])
write('racks11' if R3 else 'racks9',[f'{i+1}\t'+' '.join(rng.sample(bag,11 if R3 else 9)) for i in range(50)])
write('hook',[f'H{i+1}\t'+' '.join(rng.sample(bag,15)) for i in range(30)]) if not R3 else None  # r3 skips the hook test (protocol unchanged from r2)
print(collections.Counter(pos[w] for w in bag)); print(' '.join(bag))
