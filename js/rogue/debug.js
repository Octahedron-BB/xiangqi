// Dedicated Interactive Debug Sandbox for Roguelike Xiangqi.

import {
  RED, BLACK, EMPTY, K, A, E, H, R, C, P,
  TYPE_LETTER, typeOfCode, sideOfCode, codeOf,
  squareName, nameSquare, fileOf, rankOf,
  Position,
} from './xiangqi.js';
import { chooseMove, evaluate } from './ai.js';
import { LEVELS } from './levels.js';
import { createRun, positionFor, letterIndex } from './run.js';
import { chineseNotation } from '../notation.js';
import { PIECE_CN, RELICS, TIERS } from './rewards.js';

const PIECE_FILE = { k: 'king', a: 'advisor', b: 'elephant', n: 'horse', r: 'rook', c: 'cannon', p: 'pawn' };

const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR r - - 0 1';

const el = (id) => document.getElementById(id);
const cellsLayer = el('cells');
const piecesLayer = el('pieces');
const marksLayer = el('marks');
const coordsLayer = el('coords');
const gridEl = el('grid');
const movesEl = el('moves');
const statusEl = el('status');
const aiInfoEl = el('aiInfo');
const evalText = el('evalText');
const barFill = el('barFill');
const toastEl = el('toast');

const dbgToolGrid = el('dbgToolGrid');
const dbgTabRed = el('dbgTabRed');
const dbgTabBlack = el('dbgTabBlack');
const dbgPaletteGrid = el('dbgPaletteGrid');
const redTiersContainer = el('redTiersContainer');
const blackTiersContainer = el('blackTiersContainer');
const dbgRelicsGrid = el('dbgRelicsGrid');
const btnAllRelics = el('btnAllRelics');
const btnClearRelics = el('btnClearRelics');
const btnBotMoveNow = el('btnBotMoveNow');
const btnFlipTurn = el('btnFlipTurn');
const selectAiDepth = el('selectAiDepth');
const selectAiTime = el('selectAiTime');
const selectPresetLevel = el('selectPresetLevel');
const btnLoadPreset = el('btnLoadPreset');
const btnStandardXiangqi = el('btnStandardXiangqi');
const btnClearBoard = el('btnClearBoard');
const btnMaxTiersA = el('btnMaxTiersA');
const btnMaxTiersB = el('btnMaxTiersB');
const btnResetTiers = el('btnResetTiers');
const btnBlackMaxTiersA = el('btnBlackMaxTiersA');
const btnBlackMaxTiersB = el('btnBlackMaxTiersB');
const btnBlackResetTiers = el('btnBlackResetTiers');
const fenInput = el('fenInput');
const btnApplyFen = el('btnApplyFen');
const btnCopyFen = el('btnCopyFen');
const currentToolTip = el('currentToolTip');
const dbgHandbookBody = el('dbgHandbookBody');

let pos = new Position(START_FEN);
let selected = null;
let targets = [];
let history = [];
let plies = [];
let lastMove = null;
let busy = false;
let redBonusTurns = 0;
const debugRelics = {};
let bonusMover = null;

let currentTool = 'normal'; // 'normal' | 'add' | 'remove' | 'move'
let activeSide = RED;
let activePieceType = P;
let moveSource = null;

const pctX = (sq) => (fileOf(sq) / 8) * 100;
const pctY = (sq) => ((9 - rankOf(sq)) / 9) * 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 1800);
}

/* ------------------------------------------------------------- board build */

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

/* ------------------------------------------------------------------ render */

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
  if (currentTool === 'move' && moveSource !== null) {
    const mark = document.createElement('div');
    mark.className = 'mark debug-move-src';
    mark.style.left = `${pctX(moveSource)}%`;
    mark.style.top = `${pctY(moveSource)}%`;
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
  if (busy) {
    statusEl.className = 'status';
    statusEl.textContent = '黑方机器人思考中…';
    return;
  }
  const turnName = pos.turn === RED ? '红方' : '黑方';
  const checked = pos.inCheck(pos.turn);
  const legal = pos.legalMoves([]).length;
  statusEl.className = 'status';
  if (legal === 0) {
    if (checked) {
      statusEl.className = pos.turn === RED ? 'status lose' : 'status win';
      statusEl.textContent = `${turnName}被绝杀！`;
    } else {
      statusEl.textContent = `${turnName}被困毙！`;
    }
    return;
  }
  statusEl.textContent = checked ? `${turnName}走棋（被将军！）` : `${turnName}走棋`;
}

function updateEval() {
  const score = evaluate(pos);
  const redPov = pos.turn === RED ? score : -score;
  const clamped = Math.max(-1500, Math.min(1500, redPov));
  const pct = 50 + (clamped / 1500) * 45;
  barFill.style.width = `${pct}%`;
  evalText.textContent = `${redPov > 0 ? '+' : ''}${(redPov / 100).toFixed(1)}`;
  if (fenInput) fenInput.value = pos.fen();
}

/* ------------------------------------------------------------- sync & king */

function resyncKings() {
  pos.kings[RED] = -1;
  pos.kings[BLACK] = -1;
  for (let sq = 0; sq < 90; sq++) {
    const c = pos.board[sq];
    if (c && typeOfCode(c) === K) {
      pos.kings[sideOfCode(c)] = sq;
    }
  }
}

/* ----------------------------------------------------------------- actions */

function notationFor(from, to) {
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

function tryCicadaShell() {
  if (!pos.relics?.cicada_shell) return false;
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
        candidates.push({ sq, dist, code: c });
      }
    }
  }
  if (!candidates.length) return false;
  candidates.sort((a, b) => a.dist - b.dist);
  const target = candidates[0];
  const kingCode = pos.board[redKingSq];
  pos.board[redKingSq] = target.code;
  pos.board[target.sq] = kingCode;
  pos.kings[RED] = target.sq;
  toast('《金蝉脱壳》触发！帅与部下移形换位脱险！');
  render();
  return true;
}

function play(from, to) {
  const mover = pos.turn;
  const text = notationFor(from, to);
  const u = pos.make((from << 8) | to);
  history.push({ from, to, u, text });
  plies.push(text);
  selected = null;
  targets = [];
  lastMove = { from, to };
  render();
  renderMoves();
  renderStatus();
  updateEval();

  // 检查兵种追加位移技能 (车雷霆万钧 / 马连环步)
  const pieceType = typeOfCode(u.moving);
  if (pieceType === R && pos.branch?.[mover]?.[R] === 'B' && pos.tier[mover][R] >= 3 && u.cap) {
    const dist = Math.abs(fileOf(to) - fileOf(from)) + Math.abs(rankOf(to) - rankOf(from));
    if (dist > 4 && triggerBonusStep('r', to, mover)) return;
  }
  if (pieceType === H && pos.branch?.[mover]?.[H] === 'B' && pos.tier[mover][H] >= 3 && !u.cap) {
    if (triggerBonusStep('n', to, mover)) return;
  }

  // If Red just played, check bonus turn or let black bot reply
  if (mover === RED) {
    if (redBonusTurns > 0) {
      redBonusTurns--;
      pos.turn = RED;
      renderStatus();
      toast('【连击】红方连续行动第二步！');
      return;
    }
    if (pos.kings[BLACK] >= 0 && pos.hasLegalMove()) {
      botTurn();
    }
  }
}

function triggerBonusStep(type, sq, side) {
  const legalQuiet = [];
  const f = fileOf(sq);
  const r = rankOf(sq);
  const moverCode = pos.board[sq];

  if (type === 'r') {
    // 车【雷霆万钧】: 纯空格直走（不可吃子）
    for (const [df, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let nf = f + df;
      let nr = r + dr;
      while (nf >= 0 && nf <= 8 && nr >= 0 && nr <= 9) {
        const dest = nr * 9 + nf;
        if (pos.board[dest] !== EMPTY) break;
        pos.board[dest] = moverCode;
        pos.board[sq] = EMPTY;
        const safe = !pos.inCheck(side);
        pos.board[sq] = moverCode;
        pos.board[dest] = EMPTY;
        if (safe) legalQuiet.push(dest);
        nf += df;
        nr += dr;
      }
    }
  } else if (type === 'n') {
    // 马【连环步】: 沿四角斜走一步空格（不可吃子）
    for (const [df, dr] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nf = f + df;
      const nr = r + dr;
      if (nf >= 0 && nf <= 8 && nr >= 0 && nr <= 9) {
        const dest = nr * 9 + nf;
        if (pos.board[dest] === EMPTY) {
          pos.board[dest] = moverCode;
          pos.board[sq] = EMPTY;
          const safe = !pos.inCheck(side);
          pos.board[sq] = moverCode;
          pos.board[dest] = EMPTY;
          if (safe) legalQuiet.push(dest);
        }
      }
    }
  }

  if (!legalQuiet.length) return false;

  bonusMover = { type, sq, side };
  selected = sq;
  targets = legalQuiet;
  render();
  renderMarks();
  const name = type === 'r' ? '战车【雷霆万钧】' : '神骑【连环步】';
  statusEl.className = 'status';
  statusEl.textContent = `${name}：可再走一步空格（不可吃子），或点击自身结束`;
  toast(`${name}触发！可追加行动，或点击自身结束`);
  return true;
}

function finishBonusStep(dest) {
  const moverSq = bonusMover.sq;
  const moverSide = bonusMover.side;
  bonusMover = null;
  selected = null;
  targets = [];

  if (dest !== null) {
    const text = notationFor(moverSq, dest);
    pos.turn = moverSide;
    const u = pos.make((moverSq << 8) | dest);
    history.push({ from: moverSq, to: dest, u, text });
    plies.push(text);
    lastMove = { from: moverSq, to: dest };
    render();
    renderMoves();
    renderStatus();
    updateEval();
  } else {
    render();
    renderStatus();
  }

  if (moverSide === RED) {
    if (redBonusTurns > 0) {
      redBonusTurns--;
      pos.turn = RED;
      renderStatus();
      toast('【连击】红方连续行动第二步！');
      return;
    }
    if (pos.kings[BLACK] >= 0 && pos.hasLegalMove()) {
      botTurn();
    }
  }
}

async function botTurn() {
  if (busy || pos.turn !== BLACK) return;
  busy = true;
  renderStatus();
  const started = performance.now();
  await sleep(120);

  const depth = parseInt(selectAiDepth.value, 10) || 4;
  const timeMs = parseInt(selectAiTime.value, 10) || 500;
  const res = chooseMove(pos, { maxDepth: depth, timeMs, noise: 0 });

  const dwell = Math.max(0, 240 - (performance.now() - started));
  if (dwell) await sleep(dwell);

  if (res.move) {
    const from = res.move >> 8;
    const to = res.move & 255;
    const text = notationFor(from, to);
    const u = pos.make(res.move);
    history.push({ from, to, u, text });
    plies.push(text);
    lastMove = { from, to };
    aiInfoEl.textContent = `深度 ${res.depth} · ${(res.nodes / 1000).toFixed(1)}k 节点 · ${res.timeMs}ms`;

    // 弃子争先 (sacrifice)
    if (u.cap && sideOfCode(u.cap) === RED && pos.relics?.sacrifice) {
      const capType = TYPE_LETTER[typeOfCode(u.cap)];
      if (['r', 'n', 'c'].includes(capType)) {
        redBonusTurns = 1;
        toast('《弃子争先》触发！红方立刻获得连走两步机会！');
      }
    }
    // 金蝉脱壳 (cicada_shell)
    if (u.cap && sideOfCode(u.cap) === RED && typeOfCode(u.cap) === K) {
      tryCicadaShell();
    }
  } else {
    aiInfoEl.textContent = '无合法着法';
  }

  busy = false;
  render();
  renderMoves();
  renderStatus();
  updateEval();
}

function addPiece(sq, side, type) {
  const code = codeOf(side, type);
  if (type === K) {
    for (let i = 0; i < 90; i++) {
      const c = pos.board[i];
      if (c && typeOfCode(c) === K && sideOfCode(c) === side) {
        pos.board[i] = EMPTY;
      }
    }
  }
  pos.board[sq] = code;
  resyncKings();
  selected = null;
  targets = [];
  render();
  updateEval();
  toast(`已在 ${squareName(sq)} 放置 ${side === RED ? '红' : '黑'}${TYPE_LETTER[type].toUpperCase()}`);
}

function removePiece(sq) {
  if (!pos.board[sq]) return;
  pos.board[sq] = EMPTY;
  resyncKings();
  selected = null;
  targets = [];
  render();
  updateEval();
  toast(`已清除 ${squareName(sq)}`);
}

function movePiece(from, to) {
  if (from === to || !pos.board[from]) return;
  pos.board[to] = pos.board[from];
  pos.board[from] = EMPTY;
  resyncKings();
  selected = null;
  targets = [];
  render();
  updateEval();
  toast(`已将棋子移至 ${squareName(to)}`);
}

/* ----------------------------------------------------------- square clicks */

function onSquare(sq) {
  if (busy) return;

  if (bonusMover) {
    if (sq === bonusMover.sq) {
      finishBonusStep(null);
      return;
    }
    if (targets.includes(sq)) {
      finishBonusStep(sq);
      return;
    }
    finishBonusStep(null);
    return;
  }

  if (currentTool === 'add') {
    addPiece(sq, activeSide, activePieceType);
    return;
  }
  if (currentTool === 'remove') {
    removePiece(sq);
    return;
  }
  if (currentTool === 'move') {
    if (moveSource === null) {
      if (pos.board[sq]) {
        moveSource = sq;
        renderMarks();
      }
    } else {
      movePiece(moveSource, sq);
      moveSource = null;
      renderMarks();
    }
    return;
  }

  // normal play tool: Red clicks piece to see targets, then clicks target to play
  if (pos.turn === RED) {
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
  } else {
    // If it is black's turn in sandbox, allow manually playing black too!
    if (selected !== null && targets.includes(sq)) {
      play(selected, sq);
      return;
    }
    const c = pos.board[sq];
    if (c && sideOfCode(c) === BLACK) {
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
}

// Click listener on grid: reliably captures any click regardless of element layer
gridEl.addEventListener('click', (ev) => {
  const target = ev.target.closest('[data-square]');
  if (!target) return;
  onSquare(nameSquare(target.dataset.square));
});

// Right click to immediately remove piece under cursor
gridEl.addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
  const target = ev.target.closest('[data-square]');
  if (!target) return;
  const sq = nameSquare(target.dataset.square);
  if (pos.board[sq]) {
    removePiece(sq);
  }
});

/* ------------------------------------------------------------- UI controls */

const PALETTE_RED = [
  { type: K, char: '帥' },
  { type: R, char: '俥' },
  { type: H, char: '傌' },
  { type: C, char: '炮' },
  { type: A, char: '仕' },
  { type: E, char: '相' },
  { type: P, char: '兵' },
];
const PALETTE_BLACK = [
  { type: K, char: '將' },
  { type: R, char: '車' },
  { type: H, char: '馬' },
  { type: C, char: '砲' },
  { type: A, char: '士' },
  { type: E, char: '象' },
  { type: P, char: '卒' },
];

function renderPalette() {
  dbgPaletteGrid.textContent = '';
  const list = activeSide === RED ? PALETTE_RED : PALETTE_BLACK;
  list.forEach((p) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `palette-btn ${activeSide === RED ? 'red' : 'black'}`;
    if (activePieceType === p.type) btn.classList.add('active');
    btn.textContent = p.char;
    btn.addEventListener('click', () => {
      activePieceType = p.type;
      renderPalette();
    });
    dbgPaletteGrid.appendChild(btn);
  });
}

const TIER_DEFS = {
  p: [
    { label: 'T0 标准', tier: 0, branch: 'A', desc: '向前直走一格' },
    { label: '甲T1 冲两格', tier: 1, branch: 'A', desc: '【陷阵】兵可一次向前走两格（中间需为空）' },
    { label: '甲T2 横行', tier: 2, branch: 'A', desc: '【陷阵】兵未过河也可左右横走一格' },
    { label: '甲T3 王步(八方)', tier: 3, branch: 'A', desc: '【陷阵】兵过河后可向周围八方任意走一格（进退自如）' },
    { label: '乙T1 横行疾步', tier: 1, branch: 'B', desc: '【战阵】未过河即可横走，且横走可走 1~2 格' },
    { label: '乙T2 金戈斜刺', tier: 2, branch: 'B', desc: '【战阵】可向四条斜线（斜前、斜后）任意斜走一格' },
    { label: '乙T3 神兵破阵', tier: 3, branch: 'B', desc: '【战阵】向前可冲两格，且吃子额外奖励 +3 金币' },
  ],
  c: [
    { label: 'T0 标准', tier: 0, branch: 'A', desc: '直线任意格，隔一子炮架吃子' },
    { label: '甲T1 隔二子', tier: 1, branch: 'A', desc: '【重炮】可跳过两个子吃（不能隔两子将军）' },
    { label: '甲T2 隔三子', tier: 2, branch: 'A', desc: '【重炮】可跳过三个子吃（不能隔三子将军）' },
    { label: '甲T3 贯通炮', tier: 3, branch: 'A', desc: '【重炮】隔子数量无上限，只要有炮架即可超远轰击' },
    { label: '乙T1 近身免架', tier: 1, branch: 'B', desc: '【神火】紧邻的敌子不用炮架也能直接吃' },
    { label: '乙T2 翻山游击', tier: 2, branch: 'B', desc: '【神火】炮即使不吃子，也可以跳过 1 个棋子位移' },
    { label: '乙T3 自充炮台', tier: 3, branch: 'B', desc: '【神火】只要炮紧邻己方任意棋子，开火无需中途炮架' },
  ],
  n: [
    { label: 'T0 标准', tier: 0, branch: 'A', desc: '走日字，受马腿阻挡' },
    { label: '甲T1 不蹩腿', tier: 1, branch: 'A', desc: '【天马】马腿被挡住也照样能走' },
    { label: '甲T2 走目', tier: 2, branch: 'A', desc: '【天马】额外可走八个目字远跳点 (±1,±3)/(±3,±1)' },
    { label: '甲T3 天马(走田)', tier: 3, branch: 'A', desc: '【天马】额外可走「田」字 (±2,±2)，不塞眼且可过河' },
    { label: '乙T1 斜步', tier: 1, branch: 'B', desc: '【铁骑】马额外可沿四角斜走一格' },
    { label: '乙T2 近身刺', tier: 2, branch: 'B', desc: '【铁骑】马额外可沿正方向（上下左右）直走一格' },
    { label: '乙T3 连环步', tier: 3, branch: 'B', desc: '【铁骑】马移动若未吃子，可选择待命或再斜走一步' },
  ],
  r: [
    { label: 'T0 标准', tier: 0, branch: 'A', desc: '直线任意格滑行' },
    { label: '甲T1 斜一步', tier: 1, branch: 'A', desc: '【神后】车额外可沿四条斜线各走一格' },
    { label: '甲T2 斜两格', tier: 2, branch: 'A', desc: '【神后】车额外可沿四条斜线走一至两格（可被阻挡）' },
    { label: '甲T3 神后(斜滑行)', tier: 3, branch: 'A', desc: '【神后】车额外可沿四条斜线任意滑行 —— 化身「后」' },
    { label: '乙T1 贯石(跃友军)', tier: 1, branch: 'B', desc: '【重辇】车直线冲锋时，可跃过 1 个友军继续直线滑行' },
    { label: '乙T2 隔子冲杀', tier: 2, branch: 'B', desc: '【重辇】车直线冲锋时，可越过 1 个敌子直接吃其后方的敌子' },
    { label: '乙T3 雷霆万钧', tier: 3, branch: 'B', desc: '【重辇】直线滑行超过4格吃子后，可待命或再走一步' },
  ],
  a: [
    { label: 'T0 标准', tier: 0, branch: 'A', desc: '九宫内斜走一格' },
    { label: 'T1 斜两格', tier: 1, branch: 'A', desc: '九宫内可以斜走两格' },
    { label: 'T2 出宫', tier: 2, branch: 'A', desc: '可以沿斜线滑行，不再受九宫限制' },
  ],
  b: [
    { label: 'T0 标准', tier: 0, branch: 'A', desc: '走田字，塞象眼不能走，不可过河' },
    { label: 'T1 不塞眼', tier: 1, branch: 'A', desc: '象眼被挡住也能走' },
    { label: 'T2 过河', tier: 2, branch: 'A', desc: '可以越过河界且不塞象眼' },
  ],
};

function buildTiersUI(container, side) {
  container.textContent = '';
  for (const [type, options] of Object.entries(TIER_DEFS)) {
    const wrap = document.createElement('div');
    wrap.className = 'tier-row';

    const head = document.createElement('div');
    head.className = 'tier-row-head';

    const label = document.createElement('label');
    label.textContent = PIECE_CN[type] || type;

    const select = document.createElement('select');
    select.dataset.side = side;
    select.dataset.pieceType = type;
    options.forEach((opt, idx) => {
      const elOpt = document.createElement('option');
      elOpt.value = idx;
      elOpt.textContent = opt.label;
      select.appendChild(elOpt);
    });

    head.append(label, select);

    const descEl = document.createElement('div');
    descEl.className = 'tier-effect-desc';
    descEl.textContent = options[0]?.desc || '';

    select.addEventListener('change', () => {
      const opt = options[select.selectedIndex];
      const idx = letterIndex(type);
      if (idx) {
        pos.tier[side][idx] = opt.tier;
        pos.branch[side][idx] = opt.branch;
      }
      descEl.textContent = opt?.desc || '';
      updateEval();
      if (selected !== null) {
        targets = pos.legalMoves([]).filter((m) => (m >> 8) === selected).map((m) => m & 255);
        renderMarks();
      }
      toast(`${side === RED ? '红' : '黑'}${PIECE_CN[type]} 走法已设为 ${opt.label}`);
    });

    wrap.append(head, descEl);
    container.appendChild(wrap);
  }
}

function syncTiersUI() {
  document.querySelectorAll('.tier-row select').forEach((sel) => {
    const side = parseInt(sel.dataset.side, 10);
    const type = sel.dataset.pieceType;
    const idx = letterIndex(type);
    if (!idx) return;
    const curTier = pos.tier[side][idx] || 0;
    const curBranch = pos.branch?.[side]?.[idx] || 'A';
    const options = TIER_DEFS[type] || [];
    const matchIdx = options.findIndex((o) => o.tier === curTier && o.branch === curBranch);
    sel.selectedIndex = matchIdx >= 0 ? matchIdx : 0;
    const descEl = sel.closest('.tier-row')?.querySelector('.tier-effect-desc');
    if (descEl && options[sel.selectedIndex]) {
      descEl.textContent = options[sel.selectedIndex].desc || '';
    }
  });
}

function initToolSwitcher() {
  const toolBtns = dbgToolGrid.querySelectorAll('.dbg-tool-btn');
  toolBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      toolBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentTool = btn.dataset.tool;
      bonusMover = null;
      moveSource = null;
      selected = null;
      targets = [];
      renderMarks();

      const tips = {
        normal: '走子对战：点红子走棋，黑方机器人自动正常应招！',
        add: '自由加子：在下方选择棋子，点击棋盘任意格子直接放置。',
        remove: '减子橡皮：点击棋盘上任意棋子清空该格。',
        move: '自由移子：第一步选棋子，第二步点目标格直接挪动。',
      };
      currentToolTip.textContent = btn.textContent;
      toast(tips[currentTool] || '');
    });
  });

  dbgTabRed.addEventListener('click', () => {
    activeSide = RED;
    dbgTabRed.className = 'dbg-tab active red';
    dbgTabBlack.className = 'dbg-tab';
    renderPalette();
  });

  dbgTabBlack.addEventListener('click', () => {
    activeSide = BLACK;
    dbgTabRed.className = 'dbg-tab';
    dbgTabBlack.className = 'dbg-tab active';
    renderPalette();
  });
}

function initButtons() {
  btnBotMoveNow.addEventListener('click', () => {
    pos.turn = BLACK;
    renderStatus();
    botTurn();
  });

  btnFlipTurn.addEventListener('click', () => {
    pos.turn ^= 1;
    renderStatus();
    updateEval();
    toast(`已切换走子方：${pos.turn === RED ? '红方' : '黑方'}`);
  });

  btnStandardXiangqi.addEventListener('click', () => {
    bonusMover = null;
    pos = new Position(START_FEN);
    syncRelicsToPos();
    syncTiersUI();
    history = [];
    plies = [];
    lastMove = null;
    selected = null;
    targets = [];
    render();
    renderMoves();
    renderStatus();
    updateEval();
    toast('已重置为标准象棋完整开局');
  });

  btnClearBoard.addEventListener('click', () => {
    bonusMover = null;
    for (let sq = 0; sq < 90; sq++) {
      const c = pos.board[sq];
      if (c && typeOfCode(c) !== K) pos.board[sq] = EMPTY;
    }
    resyncKings();
    selected = null;
    targets = [];
    render();
    updateEval();
    toast('已清空盘面（保留将帅）');
  });

  function setMaxTiers(side, targetBranch = 'A') {
    for (const [type, opts] of Object.entries(TIER_DEFS)) {
      const idx = letterIndex(type);
      if (!idx) continue;
      const matching = opts.filter((o) => o.branch === targetBranch);
      const chosenOpt = matching.length ? matching[matching.length - 1] : opts[opts.length - 1];
      pos.tier[side][idx] = chosenOpt.tier;
      pos.branch[side][idx] = chosenOpt.branch;
    }
    syncTiersUI();
    updateEval();
    if (selected !== null) {
      targets = pos.legalMoves([]).filter((m) => (m >> 8) === selected).map((m) => m & 255);
      renderMarks();
    }
    toast(`${side === RED ? '红' : '黑'}方兵种已全部设为【路线${targetBranch === 'A' ? '甲' : '乙'}满级】！`);
  }

  function resetTiers(side) {
    for (const type of Object.keys(TIER_DEFS)) {
      const idx = letterIndex(type);
      if (!idx) continue;
      pos.tier[side][idx] = 0;
      pos.branch[side][idx] = 'A';
    }
    syncTiersUI();
    updateEval();
    if (selected !== null) {
      targets = pos.legalMoves([]).filter((m) => (m >> 8) === selected).map((m) => m & 255);
      renderMarks();
    }
    toast(`${side === RED ? '红' : '黑'}方兵种已重置为 T0 标准走法`);
  }

  btnMaxTiersA?.addEventListener('click', () => setMaxTiers(RED, 'A'));
  btnMaxTiersB?.addEventListener('click', () => setMaxTiers(RED, 'B'));
  btnResetTiers?.addEventListener('click', () => resetTiers(RED));

  btnBlackMaxTiersA?.addEventListener('click', () => setMaxTiers(BLACK, 'A'));
  btnBlackMaxTiersB?.addEventListener('click', () => setMaxTiers(BLACK, 'B'));
  btnBlackResetTiers?.addEventListener('click', () => resetTiers(BLACK));

  btnApplyFen.addEventListener('click', () => {
    const str = fenInput.value.trim();
    if (!str) return;
    try {
      bonusMover = null;
      pos.load(str);
      syncRelicsToPos();
      syncTiersUI();
      resyncKings();
      selected = null;
      targets = [];
      render();
      renderStatus();
      updateEval();
      toast('FEN 局面已成功载入');
    } catch (err) {
      toast(`FEN 格式错误：${err.message}`);
    }
  });

  btnCopyFen.addEventListener('click', () => {
    const fen = pos.fen();
    navigator.clipboard.writeText(fen).then(() => {
      toast('FEN 已复制到剪贴板');
    }).catch(() => {
      fenInput.select();
      toast('请手动复制输入框中的 FEN');
    });
  });

  LEVELS.forEach((lv, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `第 ${i + 1} 关：${lv.name}${lv.isBoss ? '【首领】' : ''}`;
    selectPresetLevel.appendChild(opt);
  });

  btnLoadPreset.addEventListener('click', () => {
    bonusMover = null;
    const idx = parseInt(selectPresetLevel.value, 10);
    const lv = LEVELS[idx];
    const run = createRun();
    pos = positionFor(run, lv);
    syncRelicsToPos();
    history = [];
    plies = [];
    lastMove = null;
    selected = null;
    targets = [];
    syncTiersUI();
    render();
    renderMoves();
    renderStatus();
    updateEval();
    toast(`已载入第 ${idx + 1} 关【${lv.name}】阵型`);
  });
}

function initRelicsUI() {
  dbgRelicsGrid.textContent = '';
  const rarityNames = { common: '普通', rare: '稀有', epic: '史诗', legendary: '传说' };

  for (const [id, spec] of Object.entries(RELICS)) {
    debugRelics[id] = false;
    const btn = document.createElement('button');
    btn.className = 'dbg-relic-btn';
    btn.dataset.relic = id;
    btn.type = 'button';
    btn.title = `【${spec.name}】（${rarityNames[spec.rarity] || spec.rarity}）\n${spec.desc}`;

    const nameSpan = document.createElement('span');
    nameSpan.textContent = spec.name;

    const raritySpan = document.createElement('span');
    raritySpan.className = 'dbg-relic-rarity';
    raritySpan.textContent = rarityNames[spec.rarity] || spec.rarity;

    btn.append(nameSpan, raritySpan);
    btn.addEventListener('click', () => {
      debugRelics[id] = !debugRelics[id];
      btn.classList.toggle('active', debugRelics[id]);
      syncRelicsToPos();
      toast(`已${debugRelics[id] ? '启用' : '关闭'}宝物：${spec.name}`);
      render();
      updateEval();
    });
    dbgRelicsGrid.appendChild(btn);
  }

  btnAllRelics.addEventListener('click', () => {
    for (const id of Object.keys(RELICS)) {
      debugRelics[id] = true;
    }
    updateRelicButtons();
    syncRelicsToPos();
    toast('已启用全部战术宝物');
    render();
    updateEval();
  });

  btnClearRelics.addEventListener('click', () => {
    for (const id of Object.keys(RELICS)) {
      debugRelics[id] = false;
    }
    updateRelicButtons();
    syncRelicsToPos();
    toast('已清空全部战术宝物');
    render();
    updateEval();
  });
}

function updateRelicButtons() {
  const btns = dbgRelicsGrid.querySelectorAll('.dbg-relic-btn');
  for (const b of btns) {
    const id = b.dataset.relic;
    b.classList.toggle('active', !!debugRelics[id]);
  }
}

function syncRelicsToPos() {
  pos.relics = { ...debugRelics };
}

function initHandbookUI() {
  if (!dbgHandbookBody) return;
  dbgHandbookBody.textContent = '';

  const pieceNames = {
    p: '兵 / 卒',
    c: '炮 / 砲',
    n: '马 / 傌',
    r: '车 / 俥',
    a: '仕 / 士',
    b: '相 / 象',
  };

  const branchNames = {
    p: { A: '路线甲【陷阵】', B: '路线乙【战阵】' },
    c: { A: '路线甲【重炮】', B: '路线乙【神火】' },
    n: { A: '路线甲【天马】', B: '路线乙【铁骑】' },
    r: { A: '路线甲【神后】', B: '路线乙【重辇】' },
  };

  for (const type of ['p', 'c', 'n', 'r', 'a', 'b']) {
    const card = document.createElement('div');
    card.className = 'dbg-handbook-piece';

    const title = document.createElement('div');
    title.className = 'dbg-handbook-piece-title';
    title.textContent = `${pieceNames[type]} 强化树`;
    card.appendChild(title);

    const spec = TIERS[type];
    if (spec && spec.A && spec.B) {
      for (const branch of ['A', 'B']) {
        const branchDiv = document.createElement('div');
        branchDiv.className = 'dbg-handbook-branch';
        const bTitle = document.createElement('div');
        bTitle.className = 'dbg-handbook-branch-title';
        bTitle.textContent = branchNames[type][branch] || `路线${branch}`;
        branchDiv.appendChild(bTitle);

        spec[branch].forEach((t, i) => {
          if (i === 0) return;
          const item = document.createElement('div');
          item.className = 'dbg-handbook-tier-item';
          item.innerHTML = `<span class="dbg-tier-badge">T${i} ${t.name}</span>${t.desc}`;
          branchDiv.appendChild(item);
        });
        card.appendChild(branchDiv);
      }
    } else if (Array.isArray(spec)) {
      spec.forEach((t, i) => {
        if (i === 0) return;
        const item = document.createElement('div');
        item.className = 'dbg-handbook-tier-item';
        item.innerHTML = `<span class="dbg-tier-badge">T${i} ${t.name}</span>${t.desc}`;
        card.appendChild(item);
      });
    }

    dbgHandbookBody.appendChild(card);
  }
}

/* ------------------------------------------------------------- startup */

buildCells();
buildCoords();
buildTiersUI(redTiersContainer, RED);
buildTiersUI(blackTiersContainer, BLACK);
initHandbookUI();
initRelicsUI();
syncRelicsToPos();
renderPalette();
initToolSwitcher();
initButtons();

render();
renderStatus();
updateEval();
