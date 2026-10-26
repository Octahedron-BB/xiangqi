// Validate every encounter: the enemy layout plus the red formation must give a
// legal position, black (the side not to move) must not be in check, and the
// tier-0 move count must match the classic engine.
//
// Stages no longer carry a full FEN, so the check composes the position exactly
// the way the game does, for a worst-case army (every type at its cap).
import Xiangqi from "../js/rules.js";
import { Position, RED, BLACK, typeOfCode, K, sideOfCode } from "../js/rogue/xiangqi.js";
import { LEVELS } from "../js/rogue/levels.js";
import { buildFen, MAX_COUNT } from "../js/rogue/run.js";

const FULL_ARMY = [];
for (const [type, n] of Object.entries(MAX_COUNT)) {
  for (let i = 0; i < n; i++) FULL_ARMY.push(type);
}

// The army a player plausibly has when reaching stage i: start, plus refills,
// minus nothing. Used for the material curve readout.
function armyAt(index) {
  const army = ["k", "r", "p", "p"];
  for (let i = 0; i < index; i++) for (const t of LEVELS[i].refill ?? []) army.push(t);
  for (const t of LEVELS[index].refill ?? []) army.push(t);
  return army;
}

const VALUE = { a: 2, b: 2, n: 4, r: 9, c: 4.5, p: 1 };

let bad = 0;
for (let i = 0; i < LEVELS.length; i++) {
  const lv = LEVELS[i];
  const { fen, unplaced } = buildFen({ roster: FULL_ARMY, extraBlackPawns: 0 }, lv);
  const p = new Position(fen);
  const kingsOk = p.kings[RED] >= 0 && p.kings[BLACK] >= 0;
  const waiting = p.turn ^ 1;
  const waitingInCheck = p.inCheck(waiting);
  const moverInCheck = p.inCheck(p.turn);
  const moves = p.legalMoves([]).length;

  let material = { r: 0, b: 0 };
  for (let sq = 0; sq < 90; sq++) {
    const c = p.board[sq];
    if (!c) continue;
    const t = typeOfCode(c);
    if (t === K) continue;
    const letter = "?kabnrcp"[t];
    material[sideOfCode(c) === RED ? "r" : "b"] += VALUE[letter] ?? 0;
  }
  const mine = armyAt(i).filter((t) => t !== "k");
  const redPower = mine.reduce((s, t) => s + VALUE[t], 0);

  let classicMoves = "n/a";
  let fenError = "";
  try {
    const g = new Xiangqi();
    const verdict = g.validate_fen(fen);
    if (!verdict.valid) fenError = verdict.error;
    else {
      g.load(fen);
      classicMoves = g.moves().length;
    }
  } catch (err) {
    classicMoves = "error: " + err.message;
  }

  const isCustomPieceCount = fenError.includes("no more than 2");
  const fenOk = !fenError || isCustomPieceCount;
  const movesMatch = isCustomPieceCount ? true : classicMoves === moves;
  const ok = fenOk && kingsOk && !waitingInCheck && moves > 0 && movesMatch && unplaced.length === 0;
  if (!ok) bad++;
  const classicTag = isCustomPieceCount ? `custom(>2)` : classicMoves;
  console.log(
    `${ok ? "OK  " : "FAIL"} L${lv.id} ${lv.name}: moves=${moves} classic=${classicTag}` +
    ` kings=${kingsOk} waitingInCheck=${waitingInCheck} moverInCheck=${moverInCheck}` +
    ` enemy=${material.b} red(typical)=${redPower} goal=${lv.goal}`
  );
  if (!ok) {
    if (fenError) console.log("      classic engine rejected the FEN:", fenError);
    if (unplaced.length) console.log("      could not place:", unplaced.join(","));
    console.log("      fen:  ", fen);
    console.log("      enemy:", lv.enemy);
  }
}
console.log(bad === 0 ? "all levels valid" : `${bad} invalid`);
process.exit(bad === 0 ? 0 : 1);