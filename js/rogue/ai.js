// Negamax + alpha-beta opponent for the roguelike mode.
//
// Everything here is plain standard-rules search on top of js/rogue/xiangqi.js.
// Tier upgrades only widen piece reach, which the move generator already handles,
// so the same search plays both the vanilla and upgraded positions: the opponent
// fears an upgraded rook's diagonals for exactly the same reason it fears its
// files. What tier *does* change is how much the piece is worth (VALUE below), so
// the search treats a queen-like rook as a queen rather than as a rook.

import {
  RED, K, A, E, H, R, C, P,
  sideOfCode, typeOfCode,
} from './xiangqi.js';

const INF = 1e9;
const MATE = 100000;
const TIMEOUT = Symbol('timeout');

// Centipawn values, indexed by tier (the PRD's material table x100).
// The tier steps are what make the search *fear* an upgraded piece: a rook at T1
// is a queen, not a rook with a bonus, so it is priced accordingly instead of
// being valued like the piece the AI remembers.
const VALUE = {
  [K]: [10000, 10000, 10000, 10000],
  [A]: [200, 300, 400, 400],
  [E]: [200, 300, 400, 400],
  [H]: [400, 500, 650, 800],
  [R]: [900, 1350, 1350, 1350],
  [C]: [450, 550, 700, 850],
  [P]: [100, 200, 300, 400],
};

const makeTable = (fn) => {
  const t = new Int16Array(90);
  for (let r = 0; r < 10; r++) for (let f = 0; f < 9; f++) t[r * 9 + f] = fn(f, r);
  return t;
};

// Red's point of view; rank 0 is red's home row.
const PST = {
  [P]: makeTable((f, r) => Math.min(r, 9) * 4 + (4 - Math.abs(f - 4)) * 2),
  [H]: makeTable((f, r) => (4 - Math.abs(f - 4)) * 5 + (r >= 2 && r <= 7 ? 4 : 0)),
  [C]: makeTable((f, r) => (4 - Math.abs(f - 4)) * 4),
  [R]: makeTable((f, r) => (4 - Math.abs(f - 4)) * 3 + (r >= 1 && r <= 8 ? 6 : 0)),
  [A]: makeTable(() => 0),
  [E]: makeTable(() => 0),
  [K]: makeTable((f, r) => (r === 0 ? 0 : -8 * r)),
};

const pstOf = (side, type, sq) => {
  const table = PST[type];
  if (side === RED) return table[sq];
  const f = sq % 9;
  const r = (sq - f) / 9;
  return table[(9 - r) * 9 + f];
};

export function evaluate(pos) {
  const b = pos.board;
  let score = 0;
  for (let sq = 0; sq < 90; sq++) {
    const c = b[sq];
    if (!c) continue;
    const side = sideOfCode(c);
    const type = typeOfCode(c);
    const v = VALUE[type][pos.tier[side][type]] + pstOf(side, type, sq);
    score += side === RED ? v : -v;
  }
  return pos.turn === RED ? score : -score;
}

function moveScore(pos, m) {
  const to = m & 255;
  const from = m >> 8;
  const cap = pos.board[to];
  if (!cap) return 0;
  const attacker = typeOfCode(pos.board[from]);
  const victim = typeOfCode(cap);
  // Tier-aware so an upgraded piece sorts ahead of the same capture by an
  // un-upgraded one; ordering only, but it decides what an iterative-deepening
  // search gets to look at inside the time limit.
  const worth = (type, code) =>
    VALUE[type][pos.tier[sideOfCode(code)][type]];
  return 10000 + worth(victim, cap) - worth(attacker, pos.board[from]) / 10;
}

function orderMoves(pos, moves) {
  const scored = moves.map((m) => ({ m, s: moveScore(pos, m) }));
  scored.sort((a, b) => b.s - a.s);
  return scored.map((x) => x.m);
}

let ctx = null;

function timeUp() {
  if ((++ctx.nodes & 1023) !== 0) return false;
  if (Date.now() < ctx.deadline) return false;
  throw TIMEOUT;
}

function quiesce(pos, alpha, beta, depth) {
  timeUp();
  const stand = evaluate(pos);
  if (depth <= 0) return stand;
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  const moves = pos.legalMoves([]);
  const captures = orderMoves(pos, moves.filter((m) => pos.board[m & 255]));
  for (const m of captures) {
    const u = pos.make(m);
    const v = -quiesce(pos, -beta, -alpha, depth - 1);
    pos.unmake(u);
    if (v >= beta) return v;
    if (v > alpha) alpha = v;
  }
  return alpha;
}

function negamax(pos, depth, alpha, beta, ply) {
  timeUp();
  const moves = pos.legalMoves([]);
  if (moves.length === 0) return -MATE + ply; // checkmate or stalemate: both lose
  if (depth <= 0) return quiesce(pos, alpha, beta, 3);
  const ordered = orderMoves(pos, moves);
  let best = -INF;
  for (const m of ordered) {
    const u = pos.make(m);
    const v = -negamax(pos, depth - 1, -beta, -alpha, ply + 1);
    pos.unmake(u);
    if (v > best) {
      best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
  }
  return best;
}

/**
 * Pick a move.
 * @param {import('./xiangqi.js').Position} pos
 * @param {{maxDepth?: number, timeMs?: number, noise?: number, rand?: () => number}} opts
 */
export function chooseMove(pos, opts = {}) {
  const maxDepth = opts.maxDepth ?? 3;
  const timeMs = opts.timeMs ?? 400;
  const noise = opts.noise ?? 0;
  const rand = opts.rand ?? Math.random;

  const rootMoves = pos.legalMoves([]);
  if (!rootMoves.length) return { move: 0, score: -MATE, depth: 0, nodes: 0, timeMs: 0 };
  if (rootMoves.length === 1) {
    return { move: rootMoves[0], score: 0, depth: 1, nodes: 0, timeMs: 0 };
  }

  // Search a copy. A timeout unwinds straight past every pending unmake(), so
  // searching the caller's position would leave it mid-line (pieces teleported,
  // turn flipped). The copy may be damaged; the real position never is.
  const search = pos.clone();

  const started = Date.now();
  ctx = { nodes: 0, deadline: started + timeMs };

  let order = orderMoves(pos, rootMoves);
  let bestMove = order[0];
  let bestScore = 0;
  let reached = 0;
  let scored = [];

  try {
    for (let depth = 1; depth <= maxDepth; depth++) {
      const local = [];
      let alpha = -INF;
      let iterBest = order[0];
      let iterScore = -INF;
      for (const m of order) {
        const u = search.make(m);
        const v = -negamax(search, depth - 1, -INF, -alpha, 1);
        search.unmake(u);
        local.push({ m, v });
        if (v > iterScore) {
          iterScore = v;
          iterBest = m;
        }
        if (v > alpha) alpha = v;
      }
      // re-search order by score, best first
      local.sort((a, b) => b.v - a.v);
      order = local.map((x) => x.m);
      bestMove = iterBest;
      bestScore = iterScore;
      scored = local;
      reached = depth;
      if (Math.abs(bestScore) > MATE - 1000) break; // mate found, no point going deeper
      if (Date.now() > ctx.deadline) break;
    }
  } catch (err) {
    if (err !== TIMEOUT) throw err;
  }

  if (noise > 0 && scored.length) {
    const pool = scored.filter((x) => x.v >= scored[0].v - noise);
    if (pool.length > 1) bestMove = pool[Math.floor(rand() * pool.length)].m;
  }

  return {
    move: bestMove,
    score: bestScore,
    depth: reached,
    nodes: ctx.nodes,
    timeMs: Date.now() - started,
    // root scores in search order; useful when debugging why a move was picked
    ranked: scored.map((x) => ({ from: x.m >> 8, to: x.m & 255, score: x.v })),
  };
}
