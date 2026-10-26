// Run state: the roster survives from one encounter to the next.
//
// This is the point of the mode. A fresh full position per level made the run
// monotonic — every stage handed you a new army, so upgrades could only add and
// the game got easier by construction. Here the army *is* the run: pieces that
// die stay dead, reinforcements are scarce, and strength is something you spend
// rather than accumulate.
//
// The roster stores FEN letters ('k','a','b','n','r','c','p'), one entry per
// living piece, so two pawns are simply ['p','p'].

import { Position, nameSquare } from './xiangqi.js';

export const STARTING_ARMOR = 1;

export const MAX_COUNT = { k: 1, a: 2, b: 2, n: 2, r: 2, c: 2, p: 5 };

// Where a piece lives when the stage does not script otherwise. Every type has
// its standard opening squares, so a roster of any composition drops in without
// collisions.
const HOME = {
  k: ['e0'],
  r: ['a0', 'i0'],
  n: ['b0', 'h0'],
  c: ['b2', 'h2'],
  a: ['d0', 'f0'],
  b: ['c0', 'g0'],
  p: ['a3', 'c3', 'e3', 'g3', 'i3'],
};

const LETTER_INDEX = { k: 1, a: 2, b: 3, n: 4, r: 5, c: 6, p: 7 };

export function letterIndex(type) {
  return LETTER_INDEX[type];
}

export function createRun() {
  return {
    level: 0,
    // 车 + 双兵: thin enough that keeping them alive is a real decision.
    roster: ['k', 'r', 'p', 'p'],
    tiers: { a: 0, b: 0, n: 0, r: 0, c: 0, p: 0 },
    branches: { p: null, n: null, c: null, r: null },
    passives: {},
    armor: STARTING_ARMOR,
    extraBlackPawns: 0,
    // how many reward screens are still owed (a 血酬 pays two up front)
    pending: 0,
    status: 'playing', // playing | cleared | dead
    // coin purse earned by finishing stages quickly; spent in the shop
    gold: 0,
    // consumables. A retry is worth more than an undo because it also hands the
    // stage-entry army back, so it costs more and there are fewer of them.
    items: { retry: 3, undo: 3 },
    // stages whose table reinforcements were already handed out, so restarting a
    // stage cannot farm them
    granted: new Set(),
    // stages whose shop visit already happened
    shopsSeen: new Set(),
    // the army as it stood when this stage began; a defeat rewinds to it
    snapshot: null,
  };
}

/** Count of a consumable the player is holding. */
export function itemCount(run, id) {
  return run.items[id] ?? 0;
}

export function takeItem(run, id) {
  if (itemCount(run, id) <= 0) return false;
  run.items[id] -= 1;
  if (run.items[id] === 0) delete run.items[id];
  return true;
}

export function giveItem(run, id, n = 1) {
  run.items[id] = itemCount(run, id) + n;
}

/* ------------------------------------------------------------- save file */

const SAVE_VERSION = 1;

/**
 * A save only ever records the *start* of a stage: `roster` is taken from the
 * stage-entry snapshot, so loading rewinds the current attempt instead of
 * restoring a half-played board (which would need the whole move history).
 */
export function serializeRun(run) {
  return {
    v: SAVE_VERSION,
    level: run.level,
    roster: (run.snapshot ?? run.roster).slice(),
    tiers: { ...run.tiers },
    branches: { ...run.branches },
    passives: { ...run.passives },
    armor: run.armor,
    gold: run.gold,
    items: { ...run.items },
    extraBlackPawns: run.extraBlackPawns,
    pending: run.pending,
    status: run.status,
    granted: [...run.granted],
    shopsSeen: [...run.shopsSeen],
  };
}

export function deserializeRun(data) {
  if (!data || typeof data !== 'object') throw new Error('存档格式不正确');
  if (data.v !== SAVE_VERSION) throw new Error(`存档版本不匹配（${data.v ?? '?'}）`);
  const run = createRun();
  run.level = data.level | 0;
  run.roster = Array.isArray(data.roster) && data.roster.length ? data.roster.slice() : run.roster;
  run.tiers = { ...run.tiers, ...(data.tiers ?? {}) };
  run.branches = { p: null, n: null, c: null, r: null, ...(data.branches ?? {}) };
  run.passives = { ...(data.passives ?? {}) };
  run.armor = data.armor | 0;
  run.gold = data.gold | 0;
  run.items = { retry: 3, undo: 3, ...(data.items ?? {}) };
  run.extraBlackPawns = data.extraBlackPawns | 0;
  run.pending = 0; // always resume at the start of a stage, nothing owed
  run.status = 'playing';
  run.granted = new Set(data.granted ?? []);
  run.shopsSeen = new Set(data.shopsSeen ?? []);
  run.snapshot = null;
  return run;
}


export function countOf(run, type) {
  let n = 0;
  for (const t of run.roster) if (t === type) n++;
  return n;
}

/** Adds one piece if the roster still has room for that type. */
export function addToRoster(run, type) {
  if (!HOME[type]) return false;
  if (countOf(run, type) >= MAX_COUNT[type]) return false;
  run.roster.push(type);
  return true;
}

/** Removes one piece of that type. The king never leaves the roster. */
export function dropFromRoster(run, type) {
  if (type === 'k') return;
  const i = run.roster.indexOf(type);
  if (i >= 0) run.roster.splice(i, 1);
}

export function attackersLeft(run) {
  return run.roster.filter((t) => t !== 'k').length;
}

/* ------------------------------------------------------------- position */

function parseRows(fen) {
  const rows = String(fen).trim().split('/');
  if (rows.length !== 10) throw new Error(`expected 10 rows, got ${rows.length}: ${fen}`);
  const cells = new Array(90).fill(null);
  for (let i = 0; i < 10; i++) {
    const rank = 9 - i;
    let file = 0;
    for (const ch of rows[i]) {
      if (ch >= '1' && ch <= '9') {
        file += Number(ch);
        continue;
      }
      if (file > 8) throw new Error(`row overflow: ${rows[i]}`);
      cells[rank * 9 + file] = ch;
      file++;
    }
    if (file !== 9) throw new Error(`row ${rows[i]} spans ${file} files, not 9`);
  }
  return cells;
}

function toPlacement(cells) {
  const rows = [];
  for (let rank = 9; rank >= 0; rank--) {
    let row = '';
    let empty = 0;
    for (let file = 0; file < 9; file++) {
      const ch = cells[rank * 9 + file];
      if (!ch) {
        empty++;
        continue;
      }
      if (empty) {
        row += empty;
        empty = 0;
      }
      row += ch;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return rows.join('/');
}

// A stage may script the red squares instead of using the default formation;
// survivors are matched to those squares first, then fall back to their home.
function scriptedSquares(level) {
  if (!level.red) return null;
  const cells = parseRows(level.red);
  const byType = {};
  for (let sq = 0; sq < 90; sq++) {
    const ch = cells[sq];
    if (!ch) continue;
    const type = ch.toLowerCase();
    (byType[type] ??= []).push(sq);
  }
  return byType;
}

/**
 * Compose a stage: the enemy comes from the level, the player's army from the
 * roster. Pieces with nowhere to stand are reported instead of being dropped
 * silently, so a mis-authored stage fails loudly.
 */
export function buildFen(run, level) {
  const cells = parseRows(level.enemy);
  const scripted = scriptedSquares(level);
  const taken = new Set();
  const unplaced = [];

  for (const type of run.roster) {
    let sq = scripted?.[type]?.find((candidate) => !taken.has(candidate));
    if (sq === undefined && HOME[type]) {
      sq = HOME[type].map(nameSquare).find((candidate) => !taken.has(candidate) && !cells[candidate]);
    }
    if (sq === undefined) {
      unplaced.push(type);
      continue;
    }
    taken.add(sq);
    cells[sq] = type.toUpperCase();
  }

  // 血酬: black pays for the player's extra picks by fielding another pawn.
  let extra = run.extraBlackPawns;
  for (const rank of [5, 4, 6]) {
    for (const file of [4, 3, 5, 2, 6, 1, 7, 0, 8]) {
      if (extra <= 0) break;
      const sq = rank * 9 + file;
      if (cells[sq]) continue;
      cells[sq] = 'p';
      extra--;
    }
  }

  return { fen: `${toPlacement(cells)} r - - 0 1`, unplaced };
}

export function positionFor(run, level) {
  const { fen } = buildFen(run, level);
  const pos = new Position(fen);
  for (const [type, tier] of Object.entries(run.tiers)) {
    const idx = letterIndex(type);
    if (idx && tier) {
      pos.tier[0][idx] = tier;
      pos.branch[0][idx] = run.branches?.[type] || 'A';
    }
  }
  if (level.enemyTiers) {
    for (const [type, tier] of Object.entries(level.enemyTiers)) {
      const idx = letterIndex(type);
      if (idx && tier) {
        pos.tier[1][idx] = tier;
        pos.branch[1][idx] = level.enemyBranches?.[type] || 'A';
      }
    }
  }
  return pos;
}

