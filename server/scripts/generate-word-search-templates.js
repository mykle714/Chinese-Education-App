/**
 * ONE-OFF GENERATOR for server/services/wordSearchTemplates.ts.
 *
 * Not run at runtime and not imported by anything — it exists so a future board
 * resize does not have to re-derive the tiling by hand. Pick (or add) an entry in
 * BOARDS, run it, and paste the output into that board's template list in the
 * service file (then re-run server/__tests__/wordSearchTemplates.test.ts, which
 * re-checks every invariant listed below for every board).
 *
 *   node server/scripts/generate-word-search-templates.js <7x6|6x5> [count]
 *
 * See docs/WORD_SEARCH_TEMPLATES.md for what a template is and when the grid
 * generator falls back to one.
 */
// One-off backtracking tiler: cut a board (minus its holes) into disjoint 4-cell
// PATHS (each consecutive pair orthogonally adjacent, and no cell adjacent to more
// than 2 same-piece cells -> rules out T/plus pieces that can't be walked).
//
// Every 4-cell path covers two cells of each checkerboard colour, so the holes must
// balance the colours or the board has no tiling at all. 6x5's two holes are DIAGONAL
// corners: (0,0) and (5,4) are opposite colours; (0,0) and (0,4) are not.
const BOARDS = {
  '7x6': { rows: 7, cols: 6, holes: [[0,0],[0,5],[3,2],[3,3],[6,0],[6,5]] },
  '6x5': { rows: 6, cols: 5, holes: [[0,0],[5,4]] },
};
const board = BOARDS[process.argv[2]];
if (!board) throw new Error('usage: generate-word-search-templates.js <' + Object.keys(BOARDS).join('|') + '> [count]');
const { rows: ROWS, cols: COLS, holes: HOLES } = board;
const SIZE = 4;
const holeSet = new Set(HOLES.map(([r,c]) => r*COLS+c));
const cells = [];
for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) { const k=r*COLS+c; if(!holeSet.has(k)) cells.push(k); }
if (cells.length % SIZE !== 0) throw new Error('not divisible: ' + cells.length);
const NEED = cells.length / SIZE;

const nbrs = new Map();
for (const k of cells) {
  const r = Math.floor(k/COLS), c = k%COLS;
  const list = [];
  for (const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
    const nr=r+dr, nc=c+dc; if(nr<0||nr>=ROWS||nc<0||nc>=COLS) continue;
    const nk=nr*COLS+nc; if(holeSet.has(nk)) continue; list.push(nk);
  }
  nbrs.set(k, list);
}

function randInt(n){ return Math.floor(Math.random()*n); }
function shuffle(a){ for(let i=a.length-1;i>0;i--){const j=randInt(i+1);[a[i],a[j]]=[a[j],a[i]];} return a; }

// Reachability prune: every connected component of free cells must be % SIZE === 0.
function componentsOk(free) {
  const seen = new Set();
  for (const k of free) {
    if (seen.has(k)) continue;
    let n = 0; const stack=[k]; seen.add(k);
    while (stack.length) { const x = stack.pop(); n++;
      for (const y of nbrs.get(x)) if (free.has(y) && !seen.has(y)) { seen.add(y); stack.push(y); } }
    if (n % SIZE !== 0) return false;
  }
  return true;
}

function solve() {
  const free = new Set(cells);
  const pieces = [];
  function pathOk(path) {
    // no cell may touch more than 2 cells of its own piece
    const s = new Set(path);
    for (const k of path) {
      let t = 0; for (const y of nbrs.get(k)) if (s.has(y)) t++;
      if (t > 2) return false;
    }
    // reject closed loops (2x2 squares): head and tail adjacent makes the path
    // a cycle, so the same 4 cells read as a word in several directions.
    if (nbrs.get(path[0]).includes(path[path.length-1])) return false;
    return true;
  }
  function extend(path) {
    if (path.length === SIZE) {
      if (!pathOk(path)) return null;
      return path.slice();
    }
    const last = path[path.length-1];
    for (const y of shuffle(nbrs.get(last).slice())) {
      if (!free.has(y) || path.includes(y)) continue;
      path.push(y); free.delete(y);
      // partial prune only on the final placement
      const res = extend(path);
      if (res) return res;
      path.pop(); free.add(y);
    }
    return null;
  }
  function rec() {
    if (free.size === 0) return true;
    // seed from the most-constrained free cell (fewest free neighbours)
    let seed = null, best = 99;
    for (const k of free) {
      let n = 0; for (const y of nbrs.get(k)) if (free.has(y)) n++;
      if (n < best) { best = n; seed = k; }
    }
    for (let tries = 0; tries < 60; tries++) {
      free.delete(seed);
      const p = extend([seed]);
      if (!p) { free.add(seed); return false; }
      if (componentsOk(free)) { pieces.push(p); if (rec()) return true; pieces.pop(); }
      for (const k of p) if (k !== seed) free.add(k);
      free.add(seed);
      // retry with different randomness
      free.delete(seed);
      for (const k of p) free.delete(k);
      // restore for next attempt
      for (const k of p) free.add(k);
      free.add(seed);
    }
    return false;
  }
  return rec() ? pieces : null;
}

// Collect N distinct templates.
const N = Number(process.argv[3] || 11);
const out = [];
const seen = new Set();
for (let i = 0; i < 400000 && out.length < N; i++) {
  const p = solve();
  if (!p) continue;
  if (p.length !== NEED) continue;
  // canonical key: sorted set-of-sets (orientation-independent duplicate check)
  const key = p.map(x => x.slice().sort((a,b)=>a-b).join('.')).sort().join('|');
  if (seen.has(key)) continue;
  seen.add(key);
  out.push(p);
}
if (out.length < N) { console.error('only found ' + out.length); }

// Validate + emit
const fmt = (k) => `[${Math.floor(k/COLS)}, ${k%COLS}]`;
for (const p of out) {
  const all = new Set();
  for (const piece of p) {
    if (piece.length !== SIZE) throw new Error('bad size');
    for (let i=1;i<piece.length;i++) if (!nbrs.get(piece[i-1]).includes(piece[i])) throw new Error('not adjacent');
    for (const k of piece) { if (all.has(k)) throw new Error('overlap'); all.add(k); }
  }
  if (all.size !== cells.length) throw new Error('coverage');
}
const body = out.map(p => {
  // Normalize for a stable, reviewable diff: walk each path from its lowest cell
  // (a path and its reverse are the same slot), then order slots by their head.
  // Purely cosmetic — placement reads a slot in either direction.
  const norm = p
    .map(piece => (piece[piece.length - 1] < piece[0] ? piece.slice().reverse() : piece))
    .sort((a, b) => a[0] - b[0]);
  const slots = norm.map(piece => '      [' + piece.map(fmt).join(', ') + '],').join('\n');
  return '  {\n    slots: [\n' + slots + '\n    ],\n  },';
}).join('\n');
console.log(body);
console.error('generated ' + out.length + ' templates, ' + NEED + ' slots each');
