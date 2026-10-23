import Xiangqi from './rules.js';
import { Engine, DIFFICULTY, HINT_LEVEL } from './engine.js';
import { chineseNotation } from './notation.js';

const OPPONENTS = [
  { name: 'Meow', level: 1 },
  { name: 'Coach David', level: 2 },
  { name: 'Huma', level: 3 },
  { name: 'Chia', level: 4 },
  { name: 'Paul', level: 5 },
  { name: 'Trung', level: 6 },
  { name: 'Dr. Png', level: 7 },
  { name: 'ZhiXuan', level: 8 },
  { name: 'Joep', level: 9 },
  { name: 'Hu', level: 10 },
  { name: 'Zen', level: 11, detail: '深度 22' },
];
const AVATARS = ['meow', 'david', 'huma', 'chia', 'paul', 'trung', 'png', 'zhixhuan', 'joep', 'hu', 'zen'];

const PIECE_FILE = { k: 'king', a: 'advisor', b: 'elephant', n: 'horse', r: 'rook', c: 'cannon', p: 'pawn' };

const el = (id) => document.getElementById(id);
const board = el('board');
const cellsLayer = el('cells');
const coordsLayer = el('coords');
const piecesLayer = el('pieces');
const marksLayer = el('marks');
const movesList = el('moves');
const statusEl = el('status');
const evalText = el('evalText');
const barFill = el('barFill');
const engineStateEl = el('engineState');
const engineInfoEl = el('engineInfo');
const fenInput = el('fen');
const levelSelect = el('level');
const sideSelect = el('side');
const oppAvatar = el('oppAvatar');
const redLevelSelect = el('redLevel');
const blackLevelSelect = el('blackLevel');
const redAvatar = el('redAvatar');
const blackAvatar = el('blackAvatar');

const game = new Xiangqi();
let startFen = game.fen();
let plies = [];
let humanSide = 'r';
let levelIndex = 2;
let redLevelIndex = 0;
let blackLevelIndex = 2;
let flipped = false;
let selected = null;
let legalTargets = [];
let lastMove = null;
let busy = false;
let autoMode = false;
let hint = null;
let epoch = 0;

const engine = new Engine({
  onState: (state, message) => {
    if (state === 'ready') engineStateEl.textContent = '就绪（Pikafish）';
    else if (message) engineStateEl.textContent = `不可用：${message}`;
    else engineStateEl.textContent = '加载中…';
  },
  onInfo: (info) => {
    if (!busy) return;
    engineInfoEl.textContent = describeInfo(info);
    updateEval(info.score);
  },
});

/* ---------------------------------------------------------------- rendering */

const pieceSrc = (type, color) =>
  `assets/pieces/${PIECE_FILE[type]}-${color === 'r' ? 'red' : 'black'}.svg`;

// Grid coordinates in intersections: 0..8 across, 0..9 down (0 = top row on screen).
function cellPoint(square) {
  const col = square.charCodeAt(0) - 97;
  const row = Number(square[1]);
  return {
    col: flipped ? 8 - col : col,
    row: flipped ? row : 9 - row,
  };
}

const pctX = (square) => (cellPoint(square).col / 8) * 100;
const pctY = (square) => (cellPoint(square).row / 9) * 100;

function render() {
  piecesLayer.textContent = '';
  cellsLayer.textContent = '';
  for (let col = 0; col < 9; col++) {
    for (let row = 0; row < 10; row++) {
      const square = String.fromCharCode(97 + col) + row;

      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.square = square;
      cell.style.left = `${pctX(square)}%`;
      cell.style.top = `${pctY(square)}%`;
      cellsLayer.appendChild(cell);

      const piece = game.get(square);
      if (!piece) continue;

      const node = document.createElement('div');
      node.className = `piece ${piece.color}`;
      node.dataset.square = square;
      node.dataset.type = piece.type;
      node.style.left = `${pctX(square)}%`;
      node.style.top = `${pctY(square)}%`;
      if (selected === square) node.classList.add('sel');

      const img = document.createElement('img');
      img.src = pieceSrc(piece.type, piece.color);
      img.alt = '';
      img.draggable = false;
      node.appendChild(img);
      piecesLayer.appendChild(node);
    }
  }
  renderCoords();
  renderMarks();
}

function renderMarks() {
  marksLayer.textContent = '';

  if (lastMove) {
    const order = [['from', lastMove.from], ['to', lastMove.to]];
    for (const [kind, square] of order) {
      const mark = document.createElement('div');
      mark.className = `mark ${kind}`;
      mark.style.left = `${pctX(square)}%`;
      mark.style.top = `${pctY(square)}%`;
      marksLayer.appendChild(mark);
    }
  }

  for (const target of legalTargets) {
    const mark = document.createElement('div');
    mark.className = `mark ${target.capture ? 'cap' : 'dot'}`;
    mark.style.left = `${pctX(target.square)}%`;
    mark.style.top = `${pctY(target.square)}%`;
    marksLayer.appendChild(mark);
  }

  if (!outcome().over && game.in_check()) {
    const king = findKing(game.turn());
    if (king) {
      const mark = document.createElement('div');
      mark.className = 'mark check';
      mark.style.left = `${pctX(king)}%`;
      mark.style.top = `${pctY(king)}%`;
      marksLayer.appendChild(mark);
    }
  }

  if (hint) marksLayer.insertAdjacentHTML('beforeend', arrowSvg(hint.from, hint.to));
}

function arrowSvg(from, to) {
  const a = cellPoint(from);
  const b = cellPoint(to);
  return `<svg class="hint-arrow" viewBox="0 0 8 9" preserveAspectRatio="none">
    <defs><marker id="head" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto">
      <path d="M0 0 L10 5 L0 10 z" fill="rgba(222,117,38,.95)"/></marker></defs>
    <line x1="${a.col}" y1="${a.row}" x2="${b.col}" y2="${b.row}" stroke="rgba(222,117,38,.9)"
      stroke-width="0.1" stroke-linecap="round" marker-end="url(#head)"/>
  </svg>`;
}

function renderCoords() {
  coordsLayer.textContent = '';
  const redAtBottom = !flipped;
  for (let col = 0; col < 9; col++) {
    const screenCol = flipped ? 8 - col : col;
    const labels = redAtBottom
      ? { bottom: 9 - col, top: col + 1 }
      : { bottom: col + 1, top: 9 - col };
    for (const where of ['top', 'bottom']) {
      const node = document.createElement('span');
      node.className = `coord ${where}`;
      node.style.left = `${(screenCol / 8) * 100}%`;
      node.textContent = String(labels[where]);
      coordsLayer.appendChild(node);
    }
  }
}

function findKing(color) {
  for (let row = 0; row <= 9; row++) {
    for (let col = 0; col < 9; col++) {
      const square = String.fromCharCode(97 + col) + row;
      const piece = game.get(square);
      if (piece && piece.type === 'k' && piece.color === color) return square;
    }
  }
  return null;
}

function renderMoves() {
  movesList.textContent = '';
  plies.forEach((ply, index) => {
    const item = document.createElement('li');
    item.className = ply.color === 'r' ? 'r' : 'b';
    if (index === plies.length - 1) item.classList.add('last');
    item.textContent = ply.notation;
    item.title = ply.uci.toUpperCase();
    movesList.appendChild(item);
  });
  movesList.scrollTop = movesList.scrollHeight;
}

/* ------------------------------------------------------------ game outcome */

function outcome() {
  const turn = game.turn();
  const loser = turn === 'r' ? 'b' : 'r';
  if (game.in_checkmate()) return { over: true, winner: loser, reason: '绝杀' };
  if (game.in_stalemate()) return { over: true, winner: loser, reason: '困毙' };
  if (game.game_over()) return { over: true, winner: null, reason: '和棋' };
  return { over: false, winner: null, reason: '' };
}

function updateStatus() {
  const state = outcome();
  sideClasses(state);

  if (state.over) {
    const who = state.winner ? (state.winner === 'r' ? '红方胜' : '黑方胜') : '和棋';
    statusEl.textContent = `${who}（${state.reason}）`;
    return;
  }
  if (busy) {
    statusEl.textContent = autoMode ? '电脑自战进行中…' : '电脑思考中…';
    return;
  }
  if (autoMode) {
    statusEl.textContent = '电脑自战（点「AI 自战」停止）';
    return;
  }
  if (game.in_check()) {
    statusEl.textContent = `${game.turn() === 'r' ? '红' : '黑'}方被将军！`;
    return;
  }
  statusEl.textContent = game.turn() === humanSide ? '轮到你走' : '轮到电脑';
}

function sideClasses(state) {
  const turn = game.turn();
  document.getElementById('sideRed').classList.toggle('is-turn', !state.over && turn === 'r');
  document.getElementById('sideBlack').classList.toggle('is-turn', !state.over && turn === 'b');
}

function updateEval(score) {
  if (!score) return;
  const turn = game.turn();
  let redScore;
  let text;

  if ('mate' in score) {
    redScore = turn === 'r' ? score.mate : -score.mate;
    text = `M${Math.abs(redScore)}`;
    const pct = redScore > 0 ? 100 : 0;
    barFill.style.width = `${pct}%`;
    evalText.textContent = text;
    return;
  }

  redScore = turn === 'r' ? score.cp : -score.cp;
  const win = 50 + 50 * (2 / (1 + Math.exp(-0.0011 * redScore)) - 1);
  barFill.style.width = `${Math.max(2, Math.min(98, win))}%`;
  const value = redScore / 100;
  text = `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
  evalText.textContent = text;
}

function describeInfo(info) {
  const score = info.score
    ? 'mate' in info.score ? `杀 ${info.score.mate}` : `${info.score.cp > 0 ? '+' : ''}${(info.score.cp / 100).toFixed(2)}`
    : '—';
  const nodes = info.nodes ? `${(info.nodes / 1000).toFixed(0)}k` : '—';
  return `深度 ${info.depth} · 评分 ${score} · 节点 ${nodes}`;
}

function syncFen() {
  fenInput.value = game.fen();
}

function refresh() {
  render();
  renderMoves();
  updateStatus();
  syncFen();
  el('btnUndo').disabled = plies.length === 0 || busy;
  el('btnHint').disabled = busy || outcome().over || game.turn() !== humanSide || autoMode;
  el('btnAuto').classList.toggle('on', autoMode);
}

/* ------------------------------------------------------------------- moves */

function selectPiece(square) {
  const piece = game.get(square);
  if (!piece || piece.color !== game.turn()) {
    clearSelection();
    return;
  }
  selected = square;
  legalTargets = game.moves({ square, verbose: true }).map((move) => ({
    square: move.to,
    capture: Boolean(game.get(move.to)),
  }));
  render();
}

function clearSelection() {
  selected = null;
  legalTargets = [];
  render();
}

function applyMove(uci) {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const legal = game.moves({ square: from, verbose: true }).find((move) => move.to === to);
  if (!legal) return false;

  const mover = piecesLayer.querySelector(`.piece[data-square="${from}"]`);
  const notation = chineseNotation(game, legal);
  game.move(uci);

  plies.push({ uci, notation, color: legal.color });
  lastMove = { from, to };
  hint = null;
  selected = null;
  legalTargets = [];
  refresh();
  slidePiece(mover, from, to);
  return true;
}

const SLIDE_CURVE = 'ease';
const SLIDE_MS = 350;
// low levels answer within a millisecond; keep the bot on the clock long enough
// that its reply still reads as a move instead of an instant snap
const BOT_MIN_THINK_MS = 480;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Carry a copy of the piece to its destination so the move reads as a slide
// instead of a jump; the freshly rendered piece stays hidden until it lands.
function slidePiece(source, from, to) {
  if (!source) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const landing = piecesLayer.querySelector(`.piece[data-square="${to}"]`);
  const ghost = source.cloneNode(true);
  ghost.classList.remove('sel');
  ghost.classList.add('sliding');
  ghost.removeAttribute('data-square');
  ghost.style.left = `${pctX(from)}%`;
  ghost.style.top = `${pctY(from)}%`;
  ghost.style.transition = 'none';
  piecesLayer.appendChild(ghost);
  if (landing) landing.style.visibility = 'hidden';

  void ghost.offsetWidth;

  const ms = SLIDE_MS;
  ghost.style.transition = `left ${ms}ms ${SLIDE_CURVE}, top ${ms}ms ${SLIDE_CURVE}`;
  ghost.style.left = `${pctX(to)}%`;
  ghost.style.top = `${pctY(to)}%`;

  const done = () => {
    ghost.remove();
    if (landing && landing.isConnected) landing.style.visibility = '';
  };
  ghost.addEventListener('transitionend', done, { once: true });
  setTimeout(done, ms + 120);
}

async function maybeBotMove(myEpoch) {
  const state = outcome();
  if (state.over || busy) return;
  const turn = game.turn();
  if (!autoMode && turn === humanSide) return;

  busy = true;
  refresh();
  const started = performance.now();
  const preset = autoMode
    ? DIFFICULTY[turn === 'r' ? redLevelIndex : blackLevelIndex]
    : DIFFICULTY[levelIndex];

  try {
    await engine.start();
  } catch {
    busy = false;
    refresh();
    return;
  }
  if (myEpoch !== epoch) return;

  const move = await engine.play({ fen: startFen, moves: plies.map((ply) => ply.uci), preset });
  if (myEpoch !== epoch) return;

  const dwell = BOT_MIN_THINK_MS - (performance.now() - started);
  if (dwell > 0) await sleep(dwell);
  if (myEpoch !== epoch) return;

  busy = false;
  engineInfoEl.textContent = '\u00a0';

  if (!move || !applyMove(move)) {
    const fallback = game.moves({ verbose: true });
    if (!outcome().over && fallback.length) {
      applyMove(fallback[Math.floor(Math.random() * fallback.length)].iccs);
    }
  }

  if (autoMode) {
    setTimeout(() => {
      if (myEpoch === epoch) continueBot(myEpoch);
    }, 350);
  }
}

function continueBot(myEpoch) {
  if (myEpoch !== epoch) return;
  refresh();
  if (outcome().over) return;
  if (!autoMode && game.turn() === humanSide) return;
  maybeBotMove(myEpoch);
}

/* -------------------------------------------------------------- interactions */

board.addEventListener('click', (event) => {
  if (busy || autoMode) return;
  if (outcome().over) return;
  if (game.turn() !== humanSide) return;

  const node = event.target.closest('[data-square]');
  if (!node) {
    clearSelection();
    return;
  }
  const square = node.dataset.square;

  if (selected) {
    const target = legalTargets.find((entry) => entry.square === square);
    if (target) {
      const myEpoch = epoch;
      applyMove(`${selected}${square}`);
      setTimeout(() => maybeBotMove(myEpoch), 120);
      return;
    }
  }

  if (selected === square) clearSelection();
  else selectPiece(square);
});

/* ------------------------------------------------------------------ buttons */

function newGame() {
  epoch++;
  engine.stop();
  game.reset();
  startFen = game.fen();
  plies = [];
  lastMove = null;
  hint = null;
  busy = false;
  selected = null;
  legalTargets = [];
  autoMode = false;

  humanSide = sideSelect.value;
  flipped = humanSide === 'b';
  engineInfoEl.textContent = '\u00a0';
  evalText.textContent = '—';
  barFill.style.width = '50%';
  refresh();

  if (game.turn() !== humanSide) maybeBotMove(epoch);
}

function undo() {
  if (!plies.length) return;
  epoch++;
  engine.stop();
  busy = false;

  const steps = autoMode ? 1 : game.turn() === humanSide ? 2 : 1;
  for (let i = 0; i < steps && plies.length; i++) {
    game.undo();
    plies.pop();
  }

  lastMove = plies.length
    ? { from: plies[plies.length - 1].uci.slice(0, 2), to: plies[plies.length - 1].uci.slice(2, 4) }
    : null;
  hint = null;
  engineInfoEl.textContent = '\u00a0';
  selected = null;
  legalTargets = [];
  refresh();

  if (autoMode) continueBot(epoch);
  else if (game.turn() !== humanSide) maybeBotMove(epoch);
}

async function showHint() {
  if (busy) return;
  const myEpoch = epoch;
  busy = true;
  engineInfoEl.textContent = '计算提示…';
  refresh();

  try {
    await engine.start();
  } catch {
    busy = false;
    refresh();
    return;
  }
  if (myEpoch !== epoch) return;

  const move = await engine.play({ fen: startFen, moves: plies.map((ply) => ply.uci), preset: HINT_LEVEL });
  if (myEpoch !== epoch) return;

  busy = false;
  engineInfoEl.textContent = '\u00a0';

  if (move) {
    const from = move.slice(0, 2);
    const to = move.slice(2, 4);
    const legal = game.moves({ square: from, verbose: true }).find((entry) => entry.to === to);
    hint = { from, to };
    refresh();
    statusEl.textContent = legal ? `提示：${chineseNotation(game, legal)}` : `提示：${move.toUpperCase()}`;
    return;
  }
  refresh();
}

levelSelect.addEventListener('change', () => {
  levelIndex = Number(levelSelect.value);
  oppAvatar.src = `assets/bots/${AVATARS[levelIndex]}.svg`;
  store();
});

redLevelSelect.addEventListener('change', () => {
  redLevelIndex = Number(redLevelSelect.value);
  redAvatar.src = `assets/bots/${AVATARS[redLevelIndex]}.svg`;
  store();
});

blackLevelSelect.addEventListener('change', () => {
  blackLevelIndex = Number(blackLevelSelect.value);
  blackAvatar.src = `assets/bots/${AVATARS[blackLevelIndex]}.svg`;
  store();
});

sideSelect.addEventListener('change', () => {
  store();
  newGame();
});

el('btnNew').addEventListener('click', () => newGame());
el('btnUndo').addEventListener('click', undo);
el('btnHint').addEventListener('click', showHint);
el('btnFlip').addEventListener('click', () => {
  flipped = !flipped;
  render();
});
el('btnAuto').addEventListener('click', () => {
  autoMode = !autoMode;
  const myEpoch = epoch;
  refresh();
  if (autoMode) setTimeout(() => continueBot(myEpoch), 150);
});

el('btnCopyFen').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(game.fen());
    el('btnCopyFen').textContent = '已复制';
    setTimeout(() => { el('btnCopyFen').textContent = '复制'; }, 1200);
  } catch {
    fenInput.select();
  }
});

el('btnLoadFen').addEventListener('click', () => {
  const raw = fenInput.value.trim();
  if (!raw) return;
  const parts = raw.split(/\s+/);
  parts[1] = parts[1] === 'w' ? 'r' : parts[1] === 'b' ? 'b' : parts[1];
  const fen = parts.join(' ');

  try {
    if (!game.load(fen)) throw new Error('invalid');
  } catch {
    statusEl.textContent = 'FEN 无效';
    syncFen();
    return;
  }

  epoch++;
  engine.stop();
  busy = false;
  plies = [];
  lastMove = null;
  hint = null;
  startFen = game.fen();
  autoMode = false;
  clearSelection();
  evalText.textContent = '—';
  barFill.style.width = '50%';
  refresh();
  if (game.turn() !== humanSide) maybeBotMove(epoch);
});

/* --------------------------------------------------------------- persistence */

function store() {
  try {
    localStorage.setItem('xq.settings', JSON.stringify({
      levelIndex,
      redLevelIndex,
      blackLevelIndex,
      humanSide: sideSelect.value,
    }));
  } catch { /* ignore */ }
}

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem('xq.settings') || '{}');
    const ok = (value) => Number.isInteger(value) && value >= 0 && value < OPPONENTS.length;
    if (ok(saved.levelIndex)) levelIndex = saved.levelIndex;
    if (ok(saved.redLevelIndex)) redLevelIndex = saved.redLevelIndex;
    if (ok(saved.blackLevelIndex)) blackLevelIndex = saved.blackLevelIndex;
    if (saved.humanSide === 'r' || saved.humanSide === 'b') humanSide = saved.humanSide;
  } catch { /* ignore */ }
}

/* --------------------------------------------------------------------- boot */

for (const [index, opponent] of OPPONENTS.entries()) {
  const label = opponent.detail
    ? `${opponent.name} · ${opponent.detail}`
    : `${opponent.name} · 等级 ${opponent.level}`;
  for (const select of [levelSelect, redLevelSelect, blackLevelSelect]) {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = label;
    select.appendChild(option);
  }
}

restore();
levelSelect.value = String(levelIndex);
redLevelSelect.value = String(redLevelIndex);
blackLevelSelect.value = String(blackLevelIndex);
sideSelect.value = humanSide;
oppAvatar.src = `assets/bots/${AVATARS[levelIndex]}.svg`;
redAvatar.src = `assets/bots/${AVATARS[redLevelIndex]}.svg`;
blackAvatar.src = `assets/bots/${AVATARS[blackLevelIndex]}.svg`;
newGame();

engine.start().catch(() => {});
