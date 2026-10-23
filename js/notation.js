// Chinese move notation (进/退/平 with file numbering), computed from the board
// state *before* the move. Falls back to ICCS text for anything unusual.

const RED_DIGIT = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const NAME = {
  r: { k: '帅', a: '仕', b: '相', n: '马', r: '车', c: '炮', p: '兵' },
  b: { k: '将', a: '士', b: '象', n: '马', r: '车', c: '炮', p: '卒' },
};
const STRAIGHT = new Set(['k', 'r', 'c', 'p']);

const colOf = (square) => square.charCodeAt(0) - 97;
const rowOf = (square) => Number(square[1]);

function fileName(color, col) {
  const n = color === 'r' ? 9 - col : col + 1;
  return color === 'r' ? RED_DIGIT[n - 1] : String(n);
}

function fileNumber(color, square) {
  return color === 'r' ? 9 - colOf(square) : colOf(square) + 1;
}

function numberText(color, value) {
  return color === 'r' ? RED_DIGIT[value - 1] : String(value);
}

export function toSquarePair(uci) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4) };
}

/**
 * @param {object} game rules engine instance positioned *before* the move
 * @param {{from: string, to: string, piece: string, color: string}} move
 */
export function chineseNotation(game, move) {
  try {
    return build(game, move);
  } catch {
    return (move.iccs || move.from + move.to).toUpperCase();
  }
}

function build(game, move) {
  const { from, to } = move;
  const color = move.color;
  const piece = move.piece;
  const name = NAME[color][piece];
  const verb = rowOf(to) === rowOf(from)
    ? '平'
    : (color === 'r' ? rowOf(to) > rowOf(from) : rowOf(to) < rowOf(from))
      ? '进'
      : '退';

  const target = STRAIGHT.has(piece)
    ? numberText(color, verb === '平' ? fileNumber(color, to) : Math.abs(rowOf(to) - rowOf(from)))
    : fileName(color, colOf(to));

  const mates = sameColumnPieces(game, color, piece, colOf(from));
  if (mates.length < 2) {
    return `${name}${fileName(color, colOf(from))}${verb}${target}`;
  }

  const ordered = mates.sort((a, b) => (color === 'r' ? rowOf(b) - rowOf(a) : rowOf(a) - rowOf(b)));
  const index = ordered.indexOf(from);
  const prefix = matePrefix(ordered.length, index);
  if (!prefix) return (move.iccs || from + to).toUpperCase();
  return `${prefix}${name}${verb}${target}`;
}

function sameColumnPieces(game, color, piece, col) {
  const out = [];
  for (let row = 0; row <= 9; row++) {
    const square = String.fromCharCode(97 + col) + row;
    const p = game.get(square);
    if (p && p.color === color && p.type === piece) out.push(square);
  }
  return out;
}

function matePrefix(count, index) {
  if (index < 0) return null;
  if (count === 2) return index === 0 ? '前' : '后';
  if (count === 3) return ['前', '中', '后'][index];
  if (count === 4) return ['前', '二', '三', '后'][index];
  if (count === 5) return ['前', '二', '三', '四', '后'][index];
  return null;
}
