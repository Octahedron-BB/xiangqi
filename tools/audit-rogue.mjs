// Consistency audit for the roguelike engine.
//
// The one invariant that matters: `attacked(sq, by)` must agree exactly with
// "some move in `by`'s pseudo list targets sq". Every tier upgrade widens a
// piece's reach in two places — the move generator and attacked() — and if the
// second one is missed the game lets a side capture a king without either side
// ever realising it was a check.
//
//   node tools/audit-rogue.mjs
//
// Also re-checks that tier 0 is still exactly standard xiangqi (perft) and that
// chooseMove() never mutates the position it was handed (a search timeout once
// unwound past every pending unmake() and teleported pieces on the real board).

import {
  Position, RED, BLACK, K, A, E, H, R, C, P,
  perft, squareName,
} from '../js/rogue/xiangqi.js';
import { LEVELS } from '../js/rogue/levels.js';
import { buildFen, MAX_COUNT } from '../js/rogue/run.js';
import { chooseMove } from '../js/rogue/ai.js';

const START = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR r - - 0 1';
const TIERS = [0, 1, 2, 3];

// Pieces now come from the roster, so audit the composed position rather than a
// hand-written FEN. The full army exercises every formation slot.
const FULL_ARMY = [];
for (const [type, n] of Object.entries(MAX_COUNT)) {
  for (let i = 0; i < n; i++) FULL_ARMY.push(type);
}
const stageFen = (li) => buildFen({ roster: FULL_ARMY, extraBlackPawns: 0 }, LEVELS[li]).fen;
const PLIES = 300;

let failures = 0;
const fail = (where, what) => {
  failures++;
  console.log(`  FAIL ${where}: ${what}`);
};

function auditAttacked(pos, where) {
  const saved = pos.turn;
  for (const by of [RED, BLACK]) {
    const kingSq = pos.kings[by ^ 1];
    if (kingSq < 0) continue;
    pos.turn = by;
    const reaches = pos.pseudo([]).some((m) => (m & 255) === kingSq);
    pos.turn = saved;
    const claims = pos.attacked(kingSq, by);
    if (reaches !== claims) {
      const who = by === RED ? 'red' : 'black';
      const detail = claims
        ? 'attacked() says checked but no move reaches it (false check)'
        : 'a move reaches the king but attacked() misses it (stale check)';
      fail(where, `${who} at ${squareName(kingSq)}: ${detail}`);
    }
  }
}

function auditNoKingCapture(pos, where) {
  for (const m of pos.legalMoves([])) {
    const cap = pos.board[m & 255];
    if (cap && (cap & 7) === K) {
      fail(where, `legal move ${squareName(m >> 8)}${squareName(m & 255)} captures a king`);
    }
  }
}

for (let li = 0; li < LEVELS.length; li++) {
  for (const tier of TIERS) {
    const pos = new Position(stageFen(li));
    for (const type of [A, E, H, R, C, P]) {
      pos.tier[RED][type] = tier;
      pos.tier[BLACK][type] = tier;
    }
    let seed = 4242 + li * 31 + tier;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let played = 0;
    for (let ply = 0; ply < PLIES; ply++) {
      const where = `L${li + 1} tier${tier} ply${ply}`;
      auditAttacked(pos, where);
      auditNoKingCapture(pos, where);
      const moves = pos.legalMoves([]);
      if (!moves.length) break;
      pos.make(moves[Math.floor(rand() * moves.length)]);
      played++;
    }
    console.log(`L${li + 1} tier${tier}: ${played} plies audited`);
  }
}

const d1 = perft(new Position(START), 1);
const d2 = perft(new Position(START), 2);
const d3 = perft(new Position(START), 3);
console.log(`perft tier0: ${d1} ${d2} ${d3} (expect 44 1920 79666)`);
if (d1 !== 44 || d2 !== 1920 || d3 !== 79666) fail('perft', 'tier 0 is no longer standard xiangqi');

for (let li = 0; li < LEVELS.length; li++) {
  for (const tier of [0, 3]) {
    const pos = new Position(stageFen(li));
    for (const type of [A, E, H, R, C, P]) pos.tier[RED][type] = tier;
    const before = `${pos.board.join(',')}|${pos.turn}|${pos.kings.join(',')}`;
    chooseMove(pos, LEVELS[li].ai);
    const after = `${pos.board.join(',')}|${pos.turn}|${pos.kings.join(',')}`;
    if (before !== after) fail(`L${li + 1} tier${tier}`, 'chooseMove() mutated the live position');
  }
}
console.log('chooseMove() position integrity checked');

if (failures) {
  console.log(`\n${failures} FAILURE(S)`);
  process.exitCode = 1;
} else {
  console.log('\nall checks passed');
}
