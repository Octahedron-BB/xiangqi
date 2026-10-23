// Roguelike UI: a run of eight encounters. The army carries over from one stage
// to the next, so losses are permanent and armour buys you a retry rather than a
// reset.

import {
  RED, BLACK, K, R,
  TYPE_LETTER, typeOfCode, sideOfCode,
  squareName, nameSquare, fileOf, rankOf,
} from './xiangqi.js';
import { chooseMove, evaluate } from './ai.js';
import { LEVELS } from './levels.js';
import {
  createRun, positionFor, dropFromRoster, addToRoster, attackersLeft,
  itemCount, takeItem, serializeRun, deserializeRun,
} from './run.js';
import { drawRewards, applyReward, describeBuild, describeArmy } from './rewards.js';
import { buildShop, buy } from './shop.js';
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
  const summary = describeBuild(run);
  buildEl.textContent = summary || '还没有强化';
  buildEl.classList.toggle('muted', !summary);
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
  if (rewind && run.snapshot) {
    run.roster = run.snapshot.slice();
  } else {
    if (!run.granted.has(index)) {
      run.granted.add(index);
      for (const type of level.refill ?? []) addToRoster(run, type);
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
  statusEl.className = 'status';
  statusEl.textContent = '红方走棋';
  resetRepetition();

  levelPill.textContent = `第 ${index + 1} / ${LEVELS.length} 关`;
  levelName.textContent = level.name;
  goalTag.textContent = level.goal === 'mate' ? '擒王' : '歼灭';
  goalText.textContent = level.goalText;
  levelTip.textContent = level.tip;
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
// model. Called right after pos.make().
function noteCapture(u) {
  if (!u.cap || sideOfCode(u.cap) !== RED) return;
  dropFromRoster(run, TYPE_LETTER[typeOfCode(u.cap)]);
  updateHud();
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

function play(from, to) {
  const mover = pos.turn;
  const text = notationFor(from, to);
  const u = pos.make((from << 8) | to);
  history.push({ from, to, u, text });
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
    return;
  }
  const res = chooseMove(pos, level.ai);
  if (stale()) {
    busy = false;
    return;
  }
  // never snap the reply down instantly, even when the search is trivially fast
  const dwell = Math.max(0, 260 - (performance.now() - started));
  if (dwell) await sleep(dwell);
  if (stale()) {
    busy = false;
    return;
  }
  const chosen = avoidingRepetition(res);
  const from = chosen >> 8;
  const to = chosen & 255;
  const text = notationFor(from, to);
  const u = pos.make(chosen);
  history.push({ from, to, u, text });
  plies.push(text);
  notePosition(BLACK);
  noteCapture(u);
  lastMove = { from, to };
  busy = false;
  render();
  renderMoves();
  updateEval();
  aiInfoEl.textContent = `深度 ${res.depth} · ${(res.nodes / 1000).toFixed(1)}k 节点 · ${res.timeMs}ms · ${(res.score / 100).toFixed(1)}`;
  if (!finishIfOver()) renderStatus();
}

function finishIfOver() {
  // A king that is no longer on the board means some legality check missed a
  // capture; end the game rather than let the loser play on without a king.
  if (pos.kings[RED] < 0) {
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

/** Gold for this clear: a base plus a bonus for every ply saved against par. */
function awardGold() {
  const par = level.par ?? 40;
  const spare = Math.max(0, par - plies.length);
  const base = level.gold ?? 10;
  const gained = base + spare * 2;
  run.gold += gained;
  return { gained, base, spare };
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
  const payText = `+${pay.gained} 金`;
  statusEl.textContent = reason
    ? `过关！${reason}　${payText}`
    : (last ? `通关！　${payText}` : `过关！　${payText}`);
  render();
  if (last) {
    showEnding();
    return;
  }
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
  const payNote = pay ? `　本关 +${pay.gained} 金，现有 ${run.gold} 金` : '';
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
  const stock = buildShop(run).sort((a, b) => a.price - b.price);
  const affordable = stock.filter((x) => x.price <= run.gold);
  const cards = affordable.length ? affordable : stock.slice(0, 3);
  showOverlay({
    kicker: '补给铺',
    title: '花掉你的金币',
    sub: `手上 <span class="shop-gold">${run.gold}</span> 金。买多少都行，买完点「离开」。`,
    cards,
    wide: true,
    onPick: (entry) => {
      if (!buy(run, entry)) {
        toast('金币不够');
        return;
      }
      updateHud();
      hideOverlay();
      openShop(done);
    },
    buttons: [{
      label: '离开',
      primary: true,
      onClick: () => { hideOverlay(); done(); },
    }],
  });
}

function showEnding() {
  run.status = 'cleared';
  const build = describeBuild(run);
  showOverlay({
    kicker: '通关',
    title: '你走完了这一趟',
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
    btn.className = `card card-${card.kind}`;
    const tag = document.createElement('span');
    tag.className = 'card-tag';
    tag.textContent = card.tag;
    const head = document.createElement('span');
    head.className = 'card-title';
    head.textContent = card.title;
    const desc = document.createElement('span');
    desc.className = 'card-desc';
    desc.textContent = card.desc;
    btn.append(tag, head, desc);
    if (card.price !== undefined) {
      const price = document.createElement('span');
      price.className = 'card-price';
      price.textContent = `${card.price} 金`;
      btn.appendChild(price);
      if (card.price > run.gold) {
        btn.disabled = true;
        price.textContent = `${card.price} 金（不够）`;
      }
    }
    btn.addEventListener('click', () => onPick?.(card));
    ovCards.appendChild(btn);
  }
  for (const spec of buttons) {
    const btn = document.createElement('button');
    if (spec.primary) btn.className = 'primary';
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
  statusEl.className = 'status';
  do {
    const h = history.pop();
    pos.unmake(h.u);
    plies.pop();
    // undoing a capture puts the piece back on the board and back in the army
    if (h.u.cap && sideOfCode(h.u.cap) === RED) {
      addToRoster(run, TYPE_LETTER[typeOfCode(h.u.cap)]);
    }
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
  if (busy || finished || pos.turn !== RED || !overlayEl.hidden) return;
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
  const cell = ev.target.closest('.cell');
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
    saveGame,
    loadGame,
    newGame,
    describeBuild,
    hideOverlay,
    // drive both sides in a script without waking the bot
    moveBoth(from, to) {
      const mover = pos.turn;
      const text = notationFor(from, to);
      const u = pos.make((from << 8) | to);
      history.push({ from, to, u, text });
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