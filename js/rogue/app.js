// Roguelike UI: a run of eight encounters. The army carries over from one stage
// to the next, so losses are permanent and armour buys you a retry rather than a
// reset.

import {
  RED, BLACK, EMPTY, K, A, E, H, R, C, P,
  TYPE_LETTER, LETTER_TYPE, typeOfCode, sideOfCode, codeOf,
  squareName, nameSquare, fileOf, rankOf,
} from './xiangqi.js';
import { chooseMove, evaluate } from './ai.js';
import { LEVELS } from './levels.js';
import {
  createRun, positionFor, dropFromRoster, addToRoster, attackersLeft,
  itemCount, takeItem, serializeRun, deserializeRun, letterIndex,
  addOrReserve, autoDeployFromReserves, getStageReinforcements, countOfReserve, HOME,
} from './run.js';
import { drawRewards, applyReward, describeBuild, describeArmy, PIECE_CN, RELICS, TIERS } from './rewards.js';
import { buildShop, buy, getRefreshCost, refreshShop } from './shop.js';
import { chineseNotation } from '../notation.js';

const PIECE_FILE = { k: 'king', a: 'advisor', b: 'elephant', n: 'horse', r: 'rook', c: 'cannon', p: 'pawn' };

const el = (id) => document.getElementById(id);
const cellsLayer = el('cells');
const piecesLayer = el('pieces');
const marksLayer = el('marks');
const coordsLayer = el('coords');
const movesEl = el('moves');
const statusEl = el('status');
const aiInfoEl = el('aiInfo');
const btnRetry = el('btnRetry');
const btnUndo = el('btnUndo');
const evalText = el('evalText');
const barFill = el('barFill');
const levelPill = el('levelPill');
const levelName = el('levelName');
const goalTag = el('goalTag');
const goalText = el('goalText');
const levelTip = el('levelTip');
const armorEl = el('armor');
const armyEl = el('army');
const goldEl = el('gold');
const itemsEl = el('items');
const reservesEl = el('reserves');
const relicsEl = el('relics');
const buildEl = el('build');
const btnSave = el('btnSave');
const btnLoad = el('btnLoad');
const btnNew = el('btnNew');
const toastEl = el('toast');
const overlayEl = el('overlay');
const ovKicker = el('ovKicker');
const ovTitle = el('ovTitle');
const ovSub = el('ovSub');
const ovCards = el('ovCards');
const ovFoot = el('ovFoot');
const sheetEl = document.querySelector('.sheet');

let run = createRun();
let pos = null;
let level = LEVELS[0];
let selected = null;
let targets = [];
let history = [];
let plies = [];
let lastMove = null;
let finished = false;
let busy = false;
let stageKills = 0;
let bonusMover = null;
let deployingReserveType = null;
let redBonusTurns = 0;
let soulRetrievedThisStage = false;
let cicadaShellUsedThisStage = false;
// bumps whenever the board is replaced underneath an in-flight bot reply
let epoch = 0;
// repetition bookkeeping: position key -> how often seen, and when it last was
let seen = new Map();
let checkLog = [];
let repState = { count: 1, cycleStart: 0 };

const pctX = (sq) => (fileOf(sq) / 8) * 100;
const pctY = (sq) => ((9 - rankOf(sq)) / 9) * 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------- static DOM */

function buildCells() {
  const frag = document.createDocumentFragment();
  for (let sq = 0; sq < 90; sq++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.square = squareName(sq);
    cell.style.left = `${pctX(sq)}%`;
    cell.style.top = `${pctY(sq)}%`;
    frag.appendChild(cell);
  }
  cellsLayer.appendChild(frag);
}

function buildCoords() {
  for (let col = 0; col < 9; col++) {
    for (const where of ['top', 'bottom']) {
      const node = document.createElement('span');
      node.className = `coord ${where}`;
      node.style.left = `${(col / 8) * 100}%`;
      node.textContent = where === 'top' ? String(col + 1) : String(9 - col);
      coordsLayer.appendChild(node);
    }
  }
}

/* ---------------------------------------------------------------- render */

function render() {
  piecesLayer.textContent = '';
  for (let sq = 0; sq < 90; sq++) {
    const c = pos.board[sq];
    if (!c) continue;
    const side = sideOfCode(c) === RED ? 'r' : 'b';
    const letter = TYPE_LETTER[typeOfCode(c)];
    const node = document.createElement('div');
    node.className = `piece ${side}`;
    node.dataset.square = squareName(sq);
    node.dataset.type = letter;
    node.style.left = `${pctX(sq)}%`;
    node.style.top = `${pctY(sq)}%`;
    if (selected === sq) node.classList.add('sel');
    const img = document.createElement('img');
    img.src = `assets/pieces/${PIECE_FILE[letter]}-${side === 'r' ? 'red' : 'black'}.svg`;
    img.alt = '';
    img.draggable = false;
    node.appendChild(img);
    piecesLayer.appendChild(node);
  }
  renderMarks();
}

function getEmptyHomeSquares(type) {
  if (!pos || !HOME[type]) return [];
  return HOME[type]
    .map((s) => (typeof s === 'string' ? nameSquare(s) : s))
    .filter((sq) => pos.board[sq] === EMPTY);
}

function renderMarks() {
  marksLayer.textContent = '';
  if (lastMove) {
    for (const [kind, sq] of [['from', lastMove.from], ['to', lastMove.to]]) {
      const mark = document.createElement('div');
      mark.className = `mark ${kind}`;
      mark.style.left = `${pctX(sq)}%`;
      mark.style.top = `${pctY(sq)}%`;
      marksLayer.appendChild(mark);
    }
  }
  for (const sq of targets) {
    const mark = document.createElement('div');
    mark.className = `mark ${pos.board[sq] ? 'cap' : 'dot'}`;
    mark.style.left = `${pctX(sq)}%`;
    mark.style.top = `${pctY(sq)}%`;
    marksLayer.appendChild(mark);
  }
  if (deployingReserveType) {
    const emptySqs = getEmptyHomeSquares(deployingReserveType);
    for (const sq of emptySqs) {
      const mark = document.createElement('div');
      mark.className = 'mark deploy';
      mark.style.left = `${pctX(sq)}%`;
      mark.style.top = `${pctY(sq)}%`;
      mark.title = `点击将${PIECE_CN[deployingReserveType]}部署在此处`;
      marksLayer.appendChild(mark);
    }
  }
}

function renderMoves() {
  movesEl.textContent = '';
  plies.forEach((text, i) => {
    const li = document.createElement('li');
    li.textContent = `${i + 1}. ${text}`;
    if (i === plies.length - 1) li.classList.add('cur');
    movesEl.appendChild(li);
  });
  movesEl.scrollTop = movesEl.scrollHeight;
}

function renderStatus() {
  if (finished) return;
  if (busy) {
    statusEl.textContent = '黑方思考中…';
    return;
  }
  if (pos.turn === RED) statusEl.textContent = pos.inCheck(RED) ? '红方被将军！' : '红方走棋';
  else statusEl.textContent = '黑方走棋';
}

function updateEval() {
  const cp = pos.turn === RED ? evaluate(pos) : -evaluate(pos);
  const units = cp / 100;
  evalText.textContent = `${units > 0 ? '+' : ''}${units.toFixed(1)}`;
  const pct = 50 + 45 * Math.tanh(cp / 400);
  barFill.style.width = `${Math.max(3, Math.min(97, pct))}%`;
}

function updateHud() {
  armorEl.textContent = run.armor > 0 ? '❤'.repeat(run.armor) : '—';
  armyEl.textContent = describeArmy(run);
  goldEl.textContent = String(run.gold);
  const undos = itemCount(run, 'undo');
  const retries = itemCount(run, 'retry');
  const parts = [];
  if (retries) parts.push(`重开符 ×${retries}`);
  if (undos) parts.push(`悔棋符 ×${undos}`);
  itemsEl.textContent = parts.join(' · ') || '用完了';
  itemsEl.classList.toggle('muted', parts.length === 0);
  btnRetry.textContent = `重开本关 ×${retries}`;
  btnRetry.disabled = retries === 0;
  btnUndo.textContent = `悔棋符 ×${undos}`;
  btnUndo.disabled = undos === 0;

  // Reserves
  reservesEl.textContent = '';
  let hasReserves = false;
  for (const type of ['p', 'n', 'c', 'r', 'a', 'b']) {
    const count = countOfReserve(run, type);
    if (count > 0) {
      hasReserves = true;
      const emptySqs = getEmptyHomeSquares(type);
      const hasEmptySpot = emptySqs.length > 0;
      const isRedTurn = pos?.turn === RED && !busy && !finished;
      const btn = document.createElement('button');
      btn.className = `reserve-btn${deployingReserveType === type ? ' active' : ''}${!hasEmptySpot ? ' no-spot' : ''}`;
      btn.textContent = `${PIECE_CN[type]} ×${count}`;
      if (!hasEmptySpot) {
        btn.disabled = true;
        btn.title = `初始${PIECE_CN[type]}位置已被全部占用，无空位可放入`;
      } else if (!isRedTurn) {
        btn.disabled = true;
        btn.title = '非己方回合或思考中，不可部署';
      } else {
        btn.disabled = false;
        btn.title = `点击后在棋盘上选择放入位置（空位：${emptySqs.map(squareName).map((s) => s.toUpperCase()).join('、')}）`;
      }
      btn.onclick = (e) => {
        e.stopPropagation();
        if (deployingReserveType === type) {
          deployingReserveType = null;
        } else {
          deployingReserveType = type;
          selected = null;
          targets = [];
        }
        render();
        updateHud();
      };
      reservesEl.appendChild(btn);
    }
  }
  if (!hasReserves) {
    reservesEl.textContent = '暂无备用子力';
  }

  // Relics (宝物)
  relicsEl.textContent = '';
  const activeRelics = Object.keys(run.relics ?? {}).filter((k) => run.relics[k]);
  if (!activeRelics.length) {
    relicsEl.textContent = '无';
  } else {
    for (const id of activeRelics) {
      const tag = document.createElement('span');
      tag.className = 'hud-relic-tag';
      tag.textContent = RELICS[id]?.name ?? id;
      tag.title = RELICS[id]?.desc ?? '';
      relicsEl.appendChild(tag);
    }
  }

  // Piece Upgrades (仅显示子力强化)
  buildEl.textContent = '';
  let hasUpgrades = false;
  for (const type of ['p', 'n', 'c', 'r', 'a', 'b']) {
    const tier = run.tiers?.[type] ?? 0;
    if (tier > 0) {
      hasUpgrades = true;
      const branch = run.branches?.[type];
      const hasBranches = ['p', 'n', 'c', 'r'].includes(type);
      const spec = (hasBranches && branch) ? TIERS[type]?.[branch]?.[tier] : TIERS[type]?.[tier];
      const branchTag = branch === 'A' ? '[甲]' : branch === 'B' ? '[乙]' : '';
      const branchName = branch === 'A' ? '路线甲' : branch === 'B' ? '路线乙' : '';
      const label = `${PIECE_CN[type]}${branchTag} · ${spec?.name || `T${tier}`}`;
      const tooltip = `【${PIECE_CN[type]}强化 · Tier ${tier}${branchName ? ` (${branchName})` : ''}】\n${spec?.name || ''}：${spec?.desc || ''}`;

      const tag = document.createElement('span');
      tag.className = 'hud-upgrade-tag';
      tag.textContent = label;
      tag.title = tooltip;
      buildEl.appendChild(tag);
    }
  }
  if (!hasUpgrades) {
    buildEl.textContent = '无';
    buildEl.classList.add('muted');
  } else {
    buildEl.classList.remove('muted');
  }
}

let toastTimer = 0;
function toast(text) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2200);
}

/* ------------------------------------------------------------ game flow */

/**
 * Enter a stage.
 *
 * `rewind` restores the army to how it stood when this stage began — that is what
 * armour buys and nothing else. A plain restart does **not** rewind: you continue
 * with the army you have, so bailing out mid-stage cannot launder your losses.
 *
 * Stage-table reinforcements are handed out once per stage (`run.granted`), so
 * restarting a stage cannot farm them either.
 */
function startLevel(index, opts = {}) {
  const { rewind = false } = typeof opts === 'boolean' ? { rewind: opts } : opts;
  run.level = index;
  level = LEVELS[index];
  epoch++;
  run.bloodPriceChosenThisRound = false;

  // Auto deploy from reserves before checking roster
  autoDeployFromReserves(run);

  if (rewind && run.snapshot) {
    run.roster = run.snapshot.slice();
  } else {
    if (!run.granted.has(index)) {
      run.granted.add(index);
      for (const type of level.refill ?? []) addToRoster(run, type);
      // Auto-reinforcements by stage
      const reinforcements = getStageReinforcements(index);
      for (const type of reinforcements) {
        addOrReserve(run, type);
      }
    }
    run.snapshot = run.roster.slice();
  }
  pos = positionFor(run, level);
  selected = null;
  targets = [];
  history = [];
  plies = [];
  lastMove = null;
  finished = false;
  busy = false;
  stageKills = 0;
  bonusMover = null;
  deployingReserveType = null;
  redBonusTurns = 0;
  soulRetrievedThisStage = false;
  cicadaShellUsedThisStage = false;
  statusEl.className = 'status';
  statusEl.textContent = '红方走棋';
  resetRepetition();

  levelPill.textContent = level.isBoss
    ? `第 ${index + 1} / ${LEVELS.length} 关【首领】`
    : `第 ${index + 1} / ${LEVELS.length} 关`;
  levelPill.classList.toggle('boss', !!level.isBoss);
  levelName.textContent = level.name;
  if (level.isBoss) {
    goalTag.textContent = '首领';
    goalTag.className = 'goal-tag boss';
  } else if (level.bounty) {
    goalTag.textContent = '悬赏';
    goalTag.className = 'goal-tag bounty';
  } else {
    goalTag.textContent = '擒王';
    goalTag.className = 'goal-tag';
  }
  goalText.textContent = level.bounty
    ? `${level.goalText} · 击破敌子获额外赏金`
    : level.goalText;
  if (level.bossBuff) {
    levelTip.innerHTML = `<span class="boss-buff-pill">首领特性：${level.bossBuff.name}</span>${level.bossBuff.desc}。<br>${level.tip}`;
  } else {
    levelTip.textContent = level.tip;
  }
  aiInfoEl.innerHTML = '&nbsp;';
  updateHud();

  render();
  renderMoves();
  updateEval();
}

function blackPiecesLeft() {
  let n = 0;
  for (let sq = 0; sq < 90; sq++) {
    const c = pos.board[sq];
    if (c && sideOfCode(c) === BLACK && typeOfCode(c) !== K) n++;
  }
  return n;
}

function resetRepetition() {
  seen = new Map([[pos.fen(), { count: 1, last: 0 }]]);
  checkLog = [];
  repState = { count: 1, cycleStart: 0 };
}

/** Call right after pos.make(), once plies already includes this move. */
function notePosition(mover) {
  checkLog.push({ by: mover, check: pos.inCheck(pos.turn) });
  const key = pos.fen();
  const rec = seen.get(key) ?? { count: 0, last: plies.length };
  rec.count++;
  repState = { count: rec.count, cycleStart: rec.last };
  rec.last = plies.length;
  seen.set(key, rec);
}

/**
 * Xiangqi scores a perpetual check against the side giving it. Look only at the
 * plies that make up the repeated cycle: a side that checked on every one of its
 * moves loses, anything else is a draw.
 */
function repetitionVerdict(cycleStart) {
  const cycle = checkLog.slice(cycleStart);
  if (cycle.length < 2) return 'draw';
  const red = cycle.filter((x) => x.by === RED);
  const black = cycle.filter((x) => x.by === BLACK);
  const redAll = red.length > 0 && red.every((x) => x.check);
  const blackAll = black.length > 0 && black.every((x) => x.check);
  if (blackAll && !redAll) return 'black-perpetual';
  if (redAll && !blackAll) return 'red-perpetual';
  return 'draw';
}

// A red piece leaving the board leaves the roster too — that is the whole cost
// model. A black non-king piece leaving the board counts toward stage kill bounty.
function noteCapture(u) {
  if (!u.cap) return;
  const side = sideOfCode(u.cap);
  const typeLetter = TYPE_LETTER[typeOfCode(u.cap)];
  if (side === RED) {
    dropFromRoster(run, typeLetter);
    updateHud();
    // 《弃子争先》: 红方车、马、炮被黑方吃掉时，红方立刻获得额外 1 次连续行动回合（连走两步）！
    if (run.relics?.sacrifice && ['r', 'n', 'c'].includes(typeLetter)) {
      redBonusTurns += 1;
      toast('《弃子争先》触发！红方获得额外 1 次连续行动机会！');
    }
  } else if (side === BLACK && typeOfCode(u.cap) !== K) {
    stageKills += 1;
    // 《借尸还魂》: 每关限 1 次：当我方吃掉黑方车/马/炮时，将其化为己用，立即加入我方备库！
    if (run.relics?.soul_retrieval && !soulRetrievedThisStage && ['r', 'n', 'c'].includes(typeLetter)) {
      soulRetrievedThisStage = true;
      const res = addOrReserve(run, typeLetter);
      toast(`《借尸还魂》触发！俘获黑方${PIECE_CN[typeLetter]}加入${res.target === 'roster' ? '部队' : '备库'}！`);
      updateHud();
    }
    // 《摸金校尉》: 战场上每吃掉一个敌子额外 +1 金币
    if (run.relics?.gold_hunter) {
      run.gold += 1;
      updateHud();
    }
    // 兵路线 B T3【神兵破阵】: 吃子额外奖励 +3 金币
    if (typeOfCode(u.moving) === P && pos.branch?.[RED]?.[P] === 'B' && pos.tier[RED][P] >= 3) {
      run.gold += 3;
      toast('【神兵破阵】吃子额外奖励 +3 金！');
      updateHud();
    }
  }
}

function notationFor(from, to) {
  // A diagonal rook slide has no standard 平/进/退 form; print ICCS instead of a
  // notation that would describe a move that never happened.
  if (typeOfCode(pos.board[from]) === R && fileOf(from) !== fileOf(to) && rankOf(from) !== rankOf(to)) {
    return (squareName(from) + squareName(to)).toUpperCase();
  }
  const color = pos.turn === RED ? 'r' : 'b';
  return chineseNotation(pos, {
    from: squareName(from),
    to: squareName(to),
    color,
    piece: TYPE_LETTER[typeOfCode(pos.board[from])],
    iccs: (squareName(from) + squareName(to)).toUpperCase(),
  });
}

function takeSnapshot() {
  return {
    redBonusTurns,
    soulRetrievedThisStage,
    cicadaShellUsedThisStage,
    stageKills,
    gold: run?.gold ?? 0,
    roster: run?.roster ? [...run.roster] : [],
    reserves: run?.reserves ? { ...run.reserves } : {},
  };
}

function restoreSnapshot(s) {
  if (!s || !run) return;
  redBonusTurns = s.redBonusTurns;
  soulRetrievedThisStage = s.soulRetrievedThisStage;
  cicadaShellUsedThisStage = s.cicadaShellUsedThisStage;
  stageKills = s.stageKills;
  run.gold = s.gold;
  run.roster = [...s.roster];
  run.reserves = { ...s.reserves };
}

function play(from, to) {
  const mover = pos.turn;
  const text = notationFor(from, to);
  const snapshot = takeSnapshot();
  const u = pos.make((from << 8) | to);
  history.push({ from, to, u, text, snapshot });
  plies.push(text);
  notePosition(mover);
  noteCapture(u);
  selected = null;
  targets = [];
  lastMove = { from, to };
  render();
  renderMoves();
  renderStatus();
  updateEval();
  updateHud();

  if (finishIfOver()) return;

  // Optional bonus step checks for Red
  if (mover === RED) {
    const pieceType = typeOfCode(u.moving);
    // 1. 车路线 B T3【雷霆万钧】: 直线滑行超过 4 格吃子后，可选择待命或再走一步空格（不可吃子）
    if (pieceType === R && pos.branch?.[RED]?.[R] === 'B' && pos.tier[RED][R] >= 3 && u.cap) {
      const dist = Math.abs(fileOf(to) - fileOf(from)) + Math.abs(rankOf(to) - rankOf(from));
      if (dist > 4 && triggerBonusStep('r', to)) return;
    }
    // 2. 马路线 B T3【连环步】: 移动若未吃子，可选择待命或再斜走一步空格（不可吃子）
    if (pieceType === H && pos.branch?.[RED]?.[H] === 'B' && pos.tier[RED][H] >= 3 && !u.cap) {
      if (triggerBonusStep('n', to)) return;
    }
    // 《弃子争先》
    if (redBonusTurns > 0) {
      if (pos.inCheck(BLACK)) {
        redBonusTurns = 0;
        toast('《弃子争先》红方叫将！按双招规则提前终结连走，黑方立即应将');
      } else {
        redBonusTurns -= 1;
        pos.turn = RED;
        renderStatus();
        toast('《弃子争先》连走回合！红方请继续行动');
        return;
      }
    }
  }

  botTurn();
}

function triggerBonusStep(type, sq) {
  const legalQuiet = [];
  const f = fileOf(sq);
  const r = rankOf(sq);
  const moverCode = pos.board[sq];

  if (type === 'r') {
    // Rook: quiet orthogonal moves only (cannot capture)
    for (const [df, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let nf = f + df;
      let nr = r + dr;
      while (nf >= 0 && nf <= 8 && nr >= 0 && nr <= 9) {
        const dest = nr * 9 + nf;
        if (pos.board[dest] !== EMPTY) break; // cannot capture or jump
        pos.board[dest] = moverCode;
        pos.board[sq] = EMPTY;
        const safe = !pos.inCheck(RED);
        pos.board[sq] = moverCode;
        pos.board[dest] = EMPTY;
        if (safe) legalQuiet.push(dest);
        nf += df;
        nr += dr;
      }
    }
  } else if (type === 'n') {
    // Horse: quiet diagonal steps 1 square (cannot capture)
    for (const [df, dr] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nf = f + df;
      const nr = r + dr;
      if (nf >= 0 && nf <= 8 && nr >= 0 && nr <= 9) {
        const dest = nr * 9 + nf;
        if (pos.board[dest] === EMPTY) {
          pos.board[dest] = moverCode;
          pos.board[sq] = EMPTY;
          const safe = !pos.inCheck(RED);
          pos.board[sq] = moverCode;
          pos.board[dest] = EMPTY;
          if (safe) legalQuiet.push(dest);
        }
      }
    }
  }

  if (!legalQuiet.length) return false;

  bonusMover = { type, sq };
  selected = sq;
  targets = legalQuiet;
  render();
  renderMarks();
  const name = type === 'r' ? '战车【雷霆万钧】' : '神骑【连环步】';
  statusEl.className = 'status';
  statusEl.textContent = `${name}：可再走一步空格（不可吃子），或点击自身结束`;
  return true;
}

function finishBonusStep(dest) {
  const moverSq = bonusMover.sq;
  bonusMover = null;
  selected = null;
  targets = [];

  if (dest !== null) {
    const text = notationFor(moverSq, dest);
    const snapshot = takeSnapshot();
    pos.turn = RED;
    const u = pos.make((moverSq << 8) | dest);
    history.push({ from: moverSq, to: dest, u, text, snapshot });
    plies.push(text);
    notePosition(RED);
    lastMove = { from: moverSq, to: dest };
    render();
    renderMoves();
    renderStatus();
    updateEval();
  } else {
    render();
    renderStatus();
  }

  if (redBonusTurns > 0) {
    if (pos.inCheck(BLACK)) {
      redBonusTurns = 0;
      toast('《弃子争先》红方叫将！按双招规则提前终结连走，黑方立即应将');
    } else {
      redBonusTurns -= 1;
      pos.turn = RED;
      renderStatus();
      toast('《弃子争先》连走回合！红方请继续行动');
      return;
    }
  }

  if (!finishIfOver()) botTurn();
}

/**
 * Would playing `move` bring the position to its third occurrence? The bot uses
 * this to steer clear of a 长将 ruling: instead of being allowed to shuffle into
 * a loss, it is made to change plan. If every reply repeats, the ruling stands.
 */
function repeatsOn(move) {
  const u = pos.make(move);
  const key = pos.fen();
  pos.unmake(u);
  const rec = seen.get(key);
  return (rec?.count ?? 0) + 1 >= 3;
}

function avoidingRepetition(res) {
  const order = res.ranked?.length
    ? res.ranked.map((x) => (x.from << 8) | x.to)
    : [res.move];
  for (const m of order) if (!repeatsOn(m)) return m;
  return res.move;
}

async function botTurn() {
  if (finished) return;
  const myEpoch = epoch;
  const stale = () => myEpoch !== epoch || finished;
  busy = true;
  renderStatus();
  const started = performance.now();
  await sleep(160); // let the browser paint the "thinking" state
  if (stale()) {
    busy = false;
    updateHud();
    return;
  }
  const res = chooseMove(pos, level.ai);
  if (stale()) {
    busy = false;
    updateHud();
    return;
  }
  // never snap the reply down instantly, even when the search is trivially fast
  const dwell = Math.max(0, 260 - (performance.now() - started));
  if (dwell) await sleep(dwell);
  if (stale()) {
    busy = false;
    updateHud();
    return;
  }
  const chosen = avoidingRepetition(res);
  const from = chosen >> 8;
  const to = chosen & 255;
  const text = notationFor(from, to);
  const snapshot = takeSnapshot();
  const u = pos.make(chosen);
  history.push({ from, to, u, text, snapshot });
  plies.push(text);
  notePosition(BLACK);
  noteCapture(u);
  lastMove = { from, to };
  busy = false;
  render();
  renderMoves();
  updateEval();
  updateHud();
  aiInfoEl.textContent = `深度 ${res.depth} · ${(res.nodes / 1000).toFixed(1)}k 节点 · ${res.timeMs}ms · ${(res.score / 100).toFixed(1)}`;
  if (!finishIfOver()) renderStatus();
}

function tryCicadaShell() {
  if (!run.relics?.cicada_shell || cicadaShellUsedThisStage) return false;
  const redKingSq = pos.kings[RED];
  const candidates = [];
  for (let sq = 0; sq < 90; sq++) {
    const c = pos.board[sq];
    if (c && sideOfCode(c) === RED) {
      const t = typeOfCode(c);
      if (t === P || t === A) {
        const dist = redKingSq >= 0
          ? Math.abs(fileOf(sq) - fileOf(redKingSq)) + Math.abs(rankOf(sq) - rankOf(redKingSq))
          : 0;
        candidates.push({ sq, dist, type: t });
      }
    }
  }
  if (!candidates.length) return false;
  candidates.sort((a, b) => a.dist - b.dist);
  const target = candidates[0];

  if (redKingSq < 0) {
    dropFromRoster(run, TYPE_LETTER[target.type]);
    pos.board[target.sq] = codeOf(RED, K);
    pos.kings[RED] = target.sq;
  } else {
    const kingCode = pos.board[redKingSq];
    pos.board[redKingSq] = pos.board[target.sq];
    pos.board[target.sq] = kingCode;
    pos.kings[RED] = target.sq;
  }
  cicadaShellUsedThisStage = true;
  toast('《金蝉脱壳》触发！帅与部下移形换位脱险！');
  render();
  updateHud();
  return true;
}

function finishIfOver() {
  // A king that is no longer on the board means some legality check missed a
  // capture; end the game rather than let the loser play on without a king.
  if (pos.kings[RED] < 0) {
    if (tryCicadaShell()) return false;
    lose('红方主帅被吃');
    return true;
  }
  if (pos.kings[BLACK] < 0) {
    win();
    return true;
  }
  // A lone king cannot win anything, and dragging the stage to the ply limit
  // would only make the player sit through it.
  if (attackersLeft(run) === 0) {
    lose('部队打光了');
    return true;
  }
  if (repState.count >= 3) {
    const verdict = repetitionVerdict(repState.cycleStart);
    if (verdict === 'black-perpetual') {
      win('黑方长将判负');
      return true;
    }
    if (verdict === 'red-perpetual') {
      lose('红方长将判负');
      return true;
    }
    lose('三次重复局面');
    return true;
  }
  if (!pos.hasLegalMove()) {
    if (pos.turn === BLACK) {
      win();
    } else {
      if (tryCicadaShell()) return false;
      lose(pos.inCheck(RED) ? '红方被将死' : '红方被困毙');
    }
    return true;
  }
  if (level.goal === 'annihilate' && blackPiecesLeft() === 0) {
    win();
    return true;
  }
  if (plies.length >= level.maxPlies) {
    lose('步数用尽');
    return true;
  }
  return false;
}

/** Gold for this clear: a base plus speed bonus, and optional kill bounties in bounty stages. */
function awardGold() {
  const par = level.par ?? 40;
  const spare = Math.max(0, par - plies.length);
  const base = level.gold ?? 10;
  const speedBonus = spare * 2;
  const hasBounty = !!level.bounty;
  let killBonus = hasBounty ? stageKills * 2 : 0;
  let wipeoutBonus = (hasBounty && blackPiecesLeft() === 0) ? 10 : 0;
  if (run.relics?.gold_hunter) {
    killBonus = Math.round(killBonus * 1.5);
    wipeoutBonus = Math.round(wipeoutBonus * 1.5);
  }
  const gained = base + speedBonus + killBonus + wipeoutBonus;
  run.gold += gained;
  return { gained, base, spare, speedBonus, stageKills, killBonus, wipeoutBonus, hasBounty };
}

function win(reason) {
  finished = true;
  busy = false;
  selected = null;
  targets = [];
  statusEl.className = 'status win';
  const last = run.level === LEVELS.length - 1;
  const pay = awardGold();
  updateHud();
  const bonusParts = [`基础 +${pay.base}`];
  if (pay.speedBonus > 0) bonusParts.push(`速通 +${pay.speedBonus}`);
  if (pay.killBonus > 0) bonusParts.push(`悬赏(${pay.stageKills}子) +${pay.killBonus}`);
  if (pay.wipeoutBonus > 0) bonusParts.push(`全歼特赏 +${pay.wipeoutBonus}`);
  const payText = `+${pay.gained} 金（${bonusParts.join('，')}）`;
  const victoryPrefix = last ? '通关！' : (level.isBoss ? '击破首领！' : '过关！');
  statusEl.textContent = reason
    ? `${victoryPrefix}${reason}　${payText}`
    : `${victoryPrefix}　${payText}`;
  render();
  if (last) {
    showEnding();
    return;
  }
  run.bloodPriceChosenThisRound = false;
  run.pending += 1;
  openRewards(pay);
}

function lose(reason) {
  finished = true;
  busy = false;
  selected = null;
  targets = [];
  statusEl.className = 'status lose';
  statusEl.textContent = `失败：${reason}`;
  render();
  if (run.armor > 0) {
    run.armor -= 1;
    updateHud();
    showOverlay({
      kicker: '失败',
      title: '帅护甲挡下了这一局',
      sub: `${reason}。护甲还剩 ${run.armor} 层，重打本关。本关开始时的部队会还给你，之前的强化也全部保留。`,
      buttons: [{
        label: '重打本关',
        primary: true,
        onClick: () => { hideOverlay(); startLevel(run.level, { rewind: true }); },
      }],
    });
    return;
  }
  showOverlay({
    kicker: '失败',
    title: '本局结束',
    sub: `${reason}。护甲已经用光了，这支部队到此为止。`,
    buttons: [{
      label: '重新开始',
      primary: true,
      onClick: () => { hideOverlay(); run = createRun(); startLevel(0); },
    }],
  });
}

/* ------------------------------------------------------------- rewards */

function afterStage() {
  run.bloodPriceChosenThisRound = false;
  const lv = LEVELS[run.level];
  if (lv.shop && !run.shopsSeen.has(run.level)) {
    run.shopsSeen.add(run.level);
    openShop(() => gotoNextStage());
    return;
  }
  gotoNextStage();
}

function gotoNextStage() {
  const next = run.level + 1;
  if (next >= LEVELS.length) {
    showEnding();
    return;
  }
  startLevel(next);
}

function openRewards(pay) {
  if (run.pending <= 0) {
    afterStage();
    return;
  }
  const count = 3 + (run.passives.spoils ?? 0);
  const picks = drawRewards(run, { count });
  if (!picks.length) {
    // everything is maxed out; nothing left to choose
    run.pending = 0;
    afterStage();
    return;
  }
  const left = run.pending;
  const payParts = pay ? [
    `基础 +${pay.base}`,
    pay.speedBonus > 0 ? `速通 +${pay.speedBonus}` : null,
    pay.killBonus > 0 ? `歼敌 +${pay.killBonus}` : null,
    pay.wipeoutBonus > 0 ? `全歼 +${pay.wipeoutBonus}` : null,
  ].filter(Boolean).join('，') : '';
  const payNote = pay ? `　本关 +${pay.gained} 金（${payParts}），现有 ${run.gold} 金` : '';
  showOverlay({
    kicker: `第 ${run.level + 1} 关通过${payNote}`,
    title: left > 1 ? `再选一项（还剩 ${left} 次）` : '选一项奖励',
    sub: '走法升级作用于你所有的同类棋子。注意：这类子如果全部阵亡，升级也就没用了。',
    cards: picks,
    onPick: (choice) => {
      applyReward(run, choice);
      run.pending -= 1;
      updateHud();
      hideOverlay();
      openRewards();
    },
  });
}

/* ----------------------------------------------------------------- shop */

function openShop(done) {
  const stock = buildShop(run);
  const refreshCost = getRefreshCost(run);
  const canRefresh = run.gold >= refreshCost;

  showOverlay({
    kicker: '补给铺',
    title: '花掉你的金币',
    sub: `手上 <span class="shop-gold">${run.gold}</span> 金。固定展示 8 件商品，买多少都行，买完点「离开」。`,
    cards: stock,
    wide: true,
    onPick: (entry) => {
      if (entry.soldOut) return;
      if (!buy(run, entry)) {
        toast('金币不够');
        return;
      }
      updateHud();
      openShop(done);
    },
    buttons: [
      {
        label: `🔄 刷新商品（${refreshCost} 金）`,
        disabled: !canRefresh,
        onClick: () => {
          if (!refreshShop(run)) {
            toast('金币不够刷新');
            return;
          }
          updateHud();
          openShop(done);
        },
      },
      {
        label: '离开',
        primary: true,
        onClick: () => {
          run.currentShopStock = null;
          run.shopRefreshCount = 0;
          run.bountyFreeClaimedThisVisit = false;
          hideOverlay();
          done();
        },
      },
    ],
  });
}

function showEnding() {
  run.status = 'cleared';
  const build = describeBuild(run);
  showOverlay({
    kicker: '平定天下 · 劫棋通关',
    title: '你击溃了天武神尊，走完了二十关征程',
    sub: `${describeArmy(run)}${build ? `　|　最终 build：${build}` : '　|　你一个强化都没要，纯靠棋力走完了。'}` +
      `　|　剩 ${run.gold} 金`,
    buttons: [{
      label: '再来一局',
      primary: true,
      onClick: () => { hideOverlay(); run = createRun(); startLevel(0); },
    }],
  });
}

/* ------------------------------------------------------------- overlay */

function showOverlay({ kicker = '', title = '', sub = '', cards = [], buttons = [], onPick = null, wide = false }) {
  ovKicker.textContent = kicker;
  ovTitle.textContent = title;
  // sub may carry markup produced above (e.g. the shop's gold figure)
  ovSub.innerHTML = sub;
  sheetEl.classList.toggle('wide', wide);
  ovCards.textContent = '';
  ovFoot.textContent = '';
  for (const card of cards) {
    const btn = document.createElement('button');
    btn.className = `card card-${card.kind}${card.rarity ? ` card-${card.rarity}` : ''}${card.soldOut ? ' sold-out' : ''}`;
    const tag = document.createElement('span');
    tag.className = 'card-tag';
    tag.textContent = card.tag;
    if (card.rarity) {
      const rarityBadge = document.createElement('span');
      rarityBadge.className = `rarity-pill rarity-${card.rarity}`;
      const rarityNames = { common: '普通', rare: '稀有', epic: '史诗', legendary: '传说' };
      rarityBadge.textContent = rarityNames[card.rarity] || card.rarity;
      tag.appendChild(rarityBadge);
    }
    const head = document.createElement('span');
    head.className = 'card-title';
    head.textContent = card.title;
    const desc = document.createElement('span');
    desc.className = 'card-desc';
    desc.textContent = card.desc;
    btn.append(tag, head, desc);
    if (card.soldOut) {
      btn.disabled = true;
      const price = document.createElement('span');
      price.className = 'card-price card-sold-out';
      price.textContent = '已售罄';
      btn.appendChild(price);
    } else if (card.price !== undefined) {
      const price = document.createElement('span');
      price.className = 'card-price';
      if (card.price === 0) {
        price.classList.add('free');
        price.textContent = '0 金（免费）';
      } else if (card.price > run.gold) {
        btn.disabled = true;
        price.textContent = `${card.price} 金（不够）`;
      } else {
        price.textContent = `${card.price} 金`;
      }
      btn.appendChild(price);
    }
    btn.addEventListener('click', () => onPick?.(card));
    ovCards.appendChild(btn);
  }
  for (const spec of buttons) {
    const btn = document.createElement('button');
    if (spec.primary) btn.className = 'primary';
    if (spec.disabled) btn.disabled = true;
    btn.textContent = spec.label;
    btn.addEventListener('click', spec.onClick);
    ovFoot.appendChild(btn);
  }
  overlayEl.hidden = false;
}

function hideOverlay() {
  overlayEl.hidden = true;
  // Drop the cards so a stale handler can never fire after the sheet is gone.
  ovCards.textContent = '';
  ovFoot.textContent = '';
}

/* -------------------------------------------------------------- input */

function undoStep() {
  if (busy || !history.length) return false;
  epoch++;
  finished = false;
  bonusMover = null;
  deployingReserveType = null;
  statusEl.className = 'status';
  do {
    const h = history.pop();
    if (h.isDeploy) {
      pos.board[h.to] = EMPTY;
      pos.turn = RED;
      pos.plyCount--;
    } else {
      pos.unmake(h.u);
    }
    if (h.snapshot) {
      restoreSnapshot(h.snapshot);
    } else {
      if (h.isDeploy) {
        run.reserves[h.type] = (run.reserves[h.type] ?? 0) + 1;
        dropFromRoster(run, h.type);
      } else if (h.u?.cap && sideOfCode(h.u.cap) === RED) {
        addToRoster(run, TYPE_LETTER[typeOfCode(h.u.cap)]);
      }
    }
    plies.pop();
  } while (history.length && pos.turn !== RED);
  const prev = history[history.length - 1];
  lastMove = prev ? { from: prev.from, to: prev.to } : null;
  selected = null;
  targets = [];
  resetRepetition();
  updateHud();
  render();
  renderMoves();
  renderStatus();
  updateEval();
  return true;
}

/** The 悔棋 button: only works with a 悔棋符 in hand, and spends one. */
function useUndo() {
  if (busy || !overlayEl.hidden || !history.length) return;
  if (itemCount(run, 'undo') <= 0) {
    toast('没有悔棋符了，补给铺里能买');
    return;
  }
  if (!undoStep()) return;
  takeItem(run, 'undo');
  updateHud();
}

function onSquare(sq) {
  if (busy || finished || !overlayEl.hidden) return;

  // Handle bonus step state (马连环步 / 车雷霆万钧)
  if (bonusMover) {
    if (sq === bonusMover.sq) {
      // 点击棋子自身结束回合
      finishBonusStep(null);
      return;
    }
    if (targets.includes(sq)) {
      // 点击目标空格追加一步
      finishBonusStep(sq);
      return;
    }
    // 点击其他无效位置直接结束追加回合
    finishBonusStep(null);
    return;
  }

  // Handle deployment from reserve
  if (deployingReserveType) {
    if (pos.turn !== RED || busy) {
      deployingReserveType = null;
      render();
      updateHud();
      return;
    }
    const emptySqs = getEmptyHomeSquares(deployingReserveType);
    if (emptySqs.includes(sq)) {
      const type = deployingReserveType;
      const code = codeOf(RED, LETTER_TYPE[type]);
      const snapshot = takeSnapshot();
      pos.board[sq] = code;
      pos.plyCount++;
      run.reserves[type] -= 1;
      run.roster.push(type);
      const pieceName = PIECE_CN[type];
      const text = `部署·${pieceName}(${squareName(sq).toUpperCase()})`;
      history.push({ from: sq, to: sq, u: { cap: 0, moving: code }, text, isDeploy: true, type, snapshot });
      plies.push(text);
      notePosition(RED);
      lastMove = { from: sq, to: sq };
      deployingReserveType = null;
      selected = null;
      targets = [];
      updateHud();
      render();
      renderMoves();
      renderStatus();
      updateEval();
      toast(`从备库部署了 1 个${pieceName}（${squareName(sq).toUpperCase()}）！`);
      if (finishIfOver()) return;

      if (redBonusTurns > 0) {
        if (pos.inCheck(BLACK)) {
          redBonusTurns = 0;
          pos.turn = BLACK;
          toast('《弃子争先》红方叫将！按双招规则提前终结连走，黑方立即应将');
        } else {
          redBonusTurns -= 1;
          pos.turn = RED;
          renderStatus();
          toast('《弃子争先》连走回合！红方请继续行动');
          return;
        }
      } else {
        pos.turn = BLACK;
      }
      botTurn();
      return;
    }
    deployingReserveType = null;
    render();
    updateHud();
  }

  if (pos.turn !== RED) return;
  if (selected !== null && targets.includes(sq)) {
    play(selected, sq);
    return;
  }
  const c = pos.board[sq];
  if (c && sideOfCode(c) === RED) {
    selected = sq;
    targets = pos.legalMoves([])
      .filter((m) => (m >> 8) === sq)
      .map((m) => m & 255);
  } else {
    selected = null;
    targets = [];
  }
  render();
}

cellsLayer.addEventListener('click', (ev) => {
  const cell = ev.target.closest('[data-square]');
  if (!cell) return;
  onSquare(nameSquare(cell.dataset.square));
});

btnRetry.addEventListener('click', () => {
  if (busy || !overlayEl.hidden) return;
  if (itemCount(run, 'retry') <= 0) {
    toast('没有重开符了，补给铺里能买');
    return;
  }
  // A retry hands the stage-entry army back, so it costs a token rather than
  // being free; armour (spent on defeat) is the other, rarer route to the same
  // rewind. Gold and the stage's table reinforcements are still one-shot.
  takeItem(run, 'retry');
  startLevel(run.level, { rewind: true });
  updateHud();
  toast('退回本关开始');
});

btnUndo.addEventListener('click', useUndo);

/* ---------------------------------------------------------------- saves */

const SAVE_KEY = 'xq.rogue.save.v1';

function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(serializeRun(run)));
    toast(`已保存：第 ${run.level + 1} 关`);
  } catch (err) {
    toast('保存失败：浏览器存储不可用');
  }
}

function loadGame() {
  let raw;
  try {
    raw = localStorage.getItem(SAVE_KEY);
  } catch (err) {
    toast('读取失败：浏览器存储不可用');
    return;
  }
  if (!raw) {
    toast('还没有存档');
    return;
  }
  let data;
  try {
    data = deserializeRun(JSON.parse(raw));
  } catch (err) {
    toast(`读取失败：${err.message}`);
    return;
  }
  run = data;
  epoch++;
  hideOverlay();
  startLevel(run.level);
  toast(`已读取：第 ${run.level + 1} 关`);
}

function newGame() {
  if (!confirm('从第 1 关重新开始？当前进度会丢掉。')) return;
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {}
  run = createRun();
  epoch++;
  hideOverlay();
  startLevel(0);
  toast('新的一局');
}

btnSave.addEventListener('click', saveGame);
btnLoad.addEventListener('click', loadGame);
btnNew.addEventListener('click', newGame);

buildCells();
buildCoords();
startLevel(0);

// tiny dev handle for automated checks; only present with ?debug=1
if (location.search.includes('debug')) {
  window.__rogue = {
    get pos() { return pos; },
    get history() { return history; },
    get rep() { return repState; },
    get seen() { return seen; },
    get run() { return run; },
    set run(v) { run = v; },
    repeatsOn,
    avoidingRepetition,
    startLevel,
    play,
    finishIfOver,
    onSquare,
    resetRepetition,
    undo: undoStep,
    useUndo,
    openRewards,
    afterStage,
    openShop,
    drawRewards,
    applyReward,
    buildShop,
    buy,
    getRefreshCost,
    refreshShop,
    saveGame,
    loadGame,
    newGame,
    updateHud,
    describeBuild,
    hideOverlay,
    // drive both sides in a script without waking the bot
    moveBoth(from, to) {
      const mover = pos.turn;
      const text = notationFor(from, to);
      const snapshot = takeSnapshot();
      const u = pos.make((from << 8) | to);
      history.push({ from, to, u, text, snapshot });
      plies.push(text);
      notePosition(mover);
      noteCapture(u);
      lastMove = { from, to };
      render();
      renderMoves();
      updateEval();
      return finishIfOver();
    },
    get army() { return describeArmy(run); },
    attackersLeft: () => attackersLeft(run),
    buildFen: () => positionFor(run, LEVELS[run.level]).fen(),
  };
}