// Roguelike xiangqi core: board, tier-aware move generation, make/unmake and
// check detection.
//
// Deliberately independent from js/rules.js — that one is the untouched
// standard-rules engine behind the classic mode and has to keep behaving
// exactly like play.xiangqi.com. This one is allowed to grow extra abilities.
//
// Board: Uint8Array(90), index = rank * 9 + file, rank 0 = red home row.
// Piece code: 0 = empty, red = 1..7, black = 9..15 (same type ids, +8).

export const RED = 0;
export const BLACK = 1;

export const EMPTY = 0;
export const K = 1; // king / general
export const A = 2; // advisor
export const E = 3; // elephant
export const H = 4; // horse
export const R = 5; // rook / chariot
export const C = 6; // cannon
export const P = 7; // pawn / soldier

export const SIZE = 90;
// classic FEN letters (the same ones js/rules.js and the site use): b = elephant, n = horse
export const TYPE_LETTER = ['', 'k', 'a', 'b', 'n', 'r', 'c', 'p'];
const LETTER_TYPE = { k: K, a: A, b: E, e: E, n: H, h: H, r: R, c: C, p: P };

export const sqOf = (file, rank) => rank * 9 + file;
export const fileOf = (sq) => sq % 9;
export const rankOf = (sq) => (sq - (sq % 9)) / 9;
export const squareName = (sq) => String.fromCharCode(97 + fileOf(sq)) + rankOf(sq);
export const nameSquare = (name) => sqOf(name.charCodeAt(0) - 97, Number(name[1]));

export const codeOf = (side, type) => (side > 0 ? type + 8 : type);
export const sideOfCode = (c) => (c > 8 ? BLACK : RED);
export const typeOfCode = (c) => c & 7;

export const moveFrom = (m) => m >> 8;
export const moveTo = (m) => m & 255;
export const packMove = (from, to) => (from << 8) | to;

const onBoard = (f, r) => f >= 0 && f < 9 && r >= 0 && r < 10;
const inPalace = (side, f, r) =>
  f >= 3 && f <= 5 && (side === RED ? r >= 0 && r <= 2 : r >= 7 && r <= 9);

const ORTH = [[0, 1], [0, -1], [1, 0], [-1, 0]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ALL_DIRS = ORTH.concat(DIAG);
// [dx, dy, legDx, legDy] — leg offset is relative to the horse itself
const HORSE_MOVES = [
  [2, 1, 1, 0], [2, -1, 1, 0], [-2, 1, -1, 0], [-2, -1, -1, 0],
  [1, 2, 0, 1], [-1, 2, 0, 1], [1, -2, 0, -1], [-1, -2, 0, -1],
];
// 「目」is three cells long and one wide, exactly as 「日」is two by one, so the
// upgraded horse jumps (1,3)/(3,1). Plain jumps, same as the ordinary horse.
const MU_MOVES = [
  [1, 3], [1, -3], [-1, 3], [-1, -3],
  [3, 1], [3, -1], [-3, 1], [-3, -1],
];

export class Position {
  constructor(fen) {
    this.board = new Uint8Array(SIZE);
    this.turn = RED;
    // tier[side][type]: 0 = the site's standard move, 1..3 = upgraded
    this.tier = [new Uint8Array(8), new Uint8Array(8)];
    // branch[side][type]: 'A' or 'B'
    this.branch = [{}, {}];
    this.kings = [-1, -1];
    if (fen) this.load(fen);
  }

  load(fen) {
    this.board.fill(EMPTY);
    const [placement, side] = String(fen).trim().split(/\s+/);
    const rows = placement.split('/');
    if (rows.length !== 10) throw new Error(`bad FEN rows: ${placement}`);
    for (let i = 0; i < 10; i++) {
      const rank = 9 - i;
      let file = 0;
      for (const ch of rows[i]) {
        if (ch >= '1' && ch <= '9') {
          file += Number(ch);
          continue;
        }
        const type = LETTER_TYPE[ch.toLowerCase()];
        if (!type) throw new Error(`bad FEN piece: ${ch}`);
        if (file > 8) throw new Error(`row overflow: ${rows[i]}`);
        const colour = ch === ch.toUpperCase() ? RED : BLACK;
        this.board[sqOf(file, rank)] = codeOf(colour, type);
        file++;
      }
      if (file !== 9) throw new Error(`row ${rows[i]} spans ${file} files`);
    }
    this.turn = side === 'b' ? BLACK : RED;
    this.#resyncKings();
    return this;
  }

  fen() {
    const rows = [];
    for (let rank = 9; rank >= 0; rank--) {
      let row = '';
      let empty = 0;
      for (let file = 0; file < 9; file++) {
        const c = this.board[sqOf(file, rank)];
        if (!c) {
          empty++;
          continue;
        }
        if (empty) {
          row += empty;
          empty = 0;
        }
        const letter = TYPE_LETTER[typeOfCode(c)];
        row += sideOfCode(c) === RED ? letter.toUpperCase() : letter;
      }
      if (empty) row += empty;
      rows.push(row);
    }
    return `${rows.join('/')} ${this.turn === RED ? 'r' : 'b'}`;
  }

  #resyncKings() {
    this.kings[RED] = -1;
    this.kings[BLACK] = -1;
    for (let sq = 0; sq < SIZE; sq++) {
      const c = this.board[sq];
      if (c && typeOfCode(c) === K) this.kings[sideOfCode(c)] = sq;
    }
  }

  /** Classic-mode shaped accessor, so js/notation.js can be reused as-is. */
  get(square) {
    const c = this.board[nameSquare(square)];
    if (!c) return null;
    return {
      color: sideOfCode(c) === RED ? 'r' : 'b',
      type: TYPE_LETTER[typeOfCode(c)],
    };
  }

  setTier(side, type, value) {
    this.tier[side][type] = value;
  }

  tierOf(side, type) {
    return this.tier[side][type];
  }

  clone() {
    const next = new Position();
    next.board.set(this.board);
    next.turn = this.turn;
    next.tier[RED].set(this.tier[RED]);
    next.tier[BLACK].set(this.tier[BLACK]);
    next.branch = [{ ...this.branch[0] }, { ...this.branch[1] }];
    next.kings = [this.kings[0], this.kings[1]];
    return next;
  }

  /* ---------------------------------------------------------- move making */

  make(m) {
    const from = m >> 8;
    const to = m & 255;
    const b = this.board;
    const cap = b[to];
    const moving = b[from];
    b[to] = moving;
    b[from] = EMPTY;
    if ((moving & 7) === K) this.kings[moving > 8 ? BLACK : RED] = to;
    // A king can only ever be captured if a legality check missed something, but
    // tracking it keeps the game from silently continuing with a phantom king.
    if (cap && (cap & 7) === K) this.kings[cap > 8 ? BLACK : RED] = -1;
    this.turn ^= 1;
    return { from, to, cap, moving };
  }

  unmake(u) {
    const b = this.board;
    this.turn ^= 1;
    b[u.from] = u.moving;
    b[u.to] = u.cap;
    if ((u.moving & 7) === K) this.kings[u.moving > 8 ? BLACK : RED] = u.from;
    if (u.cap && (u.cap & 7) === K) this.kings[u.cap > 8 ? BLACK : RED] = u.to;
  }

  /* ------------------------------------------------------- move generation */

  /**
   * Pseudo-legal moves for the side to move, written into `out`.
   * Upgrades only widen a piece's own reach and never remove its standard move,
   * so an all-tier-0 position is exactly standard xiangqi.
   */
  pseudo(out = []) {
    out.length = 0;
    const b = this.board;
    const side = this.turn;
    const tier = this.tier[side];
    for (let from = 0; from < SIZE; from++) {
      const c = b[from];
      if (!c || (c > 8 ? BLACK : RED) !== side) continue;
      const f = fileOf(from);
      const r = rankOf(from);
      const br = this.branch[side];
      switch (c & 7) {
        case K: this.#genKing(from, f, r, side, out); break;
        case A: this.#genAdvisor(from, f, r, side, tier[A], out); break;
        case E: this.#genElephant(from, f, r, side, tier[E], out); break;
        case H: this.#genHorse(from, f, r, side, tier[H], br[H] || 'A', out); break;
        case R: this.#genRook(from, f, r, side, tier[R], br[R] || 'A', out); break;
        case C: this.#genCannon(from, f, r, side, tier[C], br[C] || 'A', out); break;
        case P: this.#genPawn(from, f, r, side, tier[P], br[P] || 'A', out); break;
        default: break;
      }
    }
    return out;
  }

  #push(out, from, to, side) {
    const t = this.board[to];
    if (t && (t > 8 ? BLACK : RED) === side) return;
    out.push((from << 8) | to);
  }

  #genKing(from, f, r, side, out) {
    for (const [df, dr] of ORTH) {
      const nf = f + df;
      const nr = r + dr;
      if (!inPalace(side, nf, nr)) continue;
      this.#push(out, from, sqOf(nf, nr), side);
    }
  }

  #genAdvisor(from, f, r, side, tier, out) {
    if (tier >= 2) {
      for (const [df, dr] of DIAG) {
        let nf = f + df;
        let nr = r + dr;
        while (onBoard(nf, nr)) {
          const sq = sqOf(nf, nr);
          const t = this.board[sq];
          if (t) {
            if ((t > 8 ? BLACK : RED) !== side) out.push((from << 8) | sq);
            break;
          }
          out.push((from << 8) | sq);
          nf += df;
          nr += dr;
        }
      }
      return;
    }
    const reach = tier >= 1 ? 2 : 1;
    for (const [df, dr] of DIAG) {
      for (let step = 1; step <= reach; step++) {
        const nf = f + df * step;
        const nr = r + dr * step;
        if (!inPalace(side, nf, nr)) break;
        const t = this.board[sqOf(nf, nr)];
        if (t) {
          if ((t > 8 ? BLACK : RED) !== side) out.push((from << 8) | sqOf(nf, nr));
          break;
        }
        out.push((from << 8) | sqOf(nf, nr));
      }
    }
  }

  #genElephant(from, f, r, side, tier, out) {
    for (const [df, dr] of DIAG) {
      const nf = f + df * 2;
      const nr = r + dr * 2;
      if (!onBoard(nf, nr)) continue;
      if (tier < 2 && (side === RED ? nr > 4 : nr < 5)) continue; // own half only
      if (tier < 1 && this.board[sqOf(f + df, r + dr)] !== EMPTY) continue; // 塞象眼
      this.#push(out, from, sqOf(nf, nr), side);
    }
  }

  #genHorse(from, f, r, side, tier, branch, out) {
    const legsCount = branch === 'A' ? tier < 1 : true;
    for (const [df, dr, lf, lr] of HORSE_MOVES) {
      const nf = f + df;
      const nr = r + dr;
      if (!onBoard(nf, nr)) continue;
      if (legsCount && this.board[sqOf(f + lf, r + lr)] !== EMPTY) continue;
      this.#push(out, from, sqOf(nf, nr), side);
    }
    if (branch === 'A') {
      if (tier >= 2) {
        // 目: (±1,±3)/(±3,±1) 八个大跳点
        for (const [df, dr] of MU_MOVES) {
          const nf = f + df;
          const nr = r + dr;
          if (onBoard(nf, nr)) this.#push(out, from, sqOf(nf, nr), side);
        }
      }
      if (tier >= 3) {
        // 天马: (±2,±2) 田字跳跃，无视塞象眼，可过河
        for (const [df, dr] of DIAG) {
          const nf = f + df * 2;
          const nr = r + dr * 2;
          if (onBoard(nf, nr)) this.#push(out, from, sqOf(nf, nr), side);
        }
      }
    } else {
      // 路线 B【近战铁骑】
      if (tier >= 1) {
        // 斜步 1 格
        for (const [df, dr] of DIAG) {
          const nf = f + df;
          const nr = r + dr;
          if (onBoard(nf, nr)) this.#push(out, from, sqOf(nf, nr), side);
        }
      }
      if (tier >= 2) {
        // 近身刺: 正方向直走 1 格
        for (const [df, dr] of ORTH) {
          const nf = f + df;
          const nr = r + dr;
          if (onBoard(nf, nr)) this.#push(out, from, sqOf(nf, nr), side);
        }
      }
      // T3【连环步】在 app.js 中作为可选追加移动处理
    }
  }

  #genRook(from, f, r, side, tier, branch, out) {
    const canJumpAlly = branch === 'B' && tier >= 1;
    const canJumpEnemy = branch === 'B' && tier >= 2;
    for (const [df, dr] of ORTH) {
      let nf = f + df;
      let nr = r + dr;
      let jumpedAlly = false;
      let jumpedEnemy = false;
      while (onBoard(nf, nr)) {
        const sq = sqOf(nf, nr);
        const t = this.board[sq];
        if (t) {
          const isAlly = (t > 8 ? BLACK : RED) === side;
          if (isAlly) {
            if (canJumpAlly && !jumpedAlly) {
              jumpedAlly = true;
              nf += df;
              nr += dr;
              continue; // 贯石: 跃过首个友军继续冲锋
            }
            break;
          } else {
            if (canJumpEnemy && !jumpedEnemy) {
              jumpedEnemy = true;
              out.push((from << 8) | sq);
              nf += df;
              nr += dr;
              continue; // 隔子冲杀: 越过首个敌子继续冲向下一敌子
            }
            out.push((from << 8) | sq);
            break;
          }
        }
        out.push((from << 8) | sq);
        nf += df;
        nr += dr;
      }
    }
    // 路线 A: 神后 (沿斜线滑行)
    if (branch === 'A' && tier >= 1) {
      const maxSteps = tier >= 3 ? 9 : tier;
      for (const [df, dr] of DIAG) {
        let nf = f + df;
        let nr = r + dr;
        let steps = 0;
        while (onBoard(nf, nr) && steps < maxSteps) {
          steps++;
          const sq = sqOf(nf, nr);
          const t = this.board[sq];
          if (t) {
            if ((t > 8 ? BLACK : RED) !== side) out.push((from << 8) | sq);
            break;
          }
          out.push((from << 8) | sq);
          nf += df;
          nr += dr;
        }
      }
    }
  }

  #genCannon(from, f, r, side, tier, branch, out) {
    if (branch === 'B') {
      // 路线 B【神火游击】
      // T1 近身免架
      if (tier >= 1) {
        for (const [df, dr] of ORTH) {
          const af = f + df;
          const ar = r + dr;
          if (onBoard(af, ar)) {
            const at = this.board[sqOf(af, ar)];
            if (at && (at > 8 ? BLACK : RED) !== side) out.push((from << 8) | sqOf(af, ar));
          }
        }
      }
      let hasAllyAdj = false;
      if (tier >= 3) {
        for (const [df, dr] of ORTH) {
          const af = f + df;
          const ar = r + dr;
          if (onBoard(af, ar)) {
            const at = this.board[sqOf(af, ar)];
            if (at && (at > 8 ? BLACK : RED) === side) {
              hasAllyAdj = true;
              break;
            }
          }
        }
      }
      for (const [df, dr] of ORTH) {
        let nf = f + df;
        let nr = r + dr;
        let pieces = 0;
        while (onBoard(nf, nr)) {
          const sq = sqOf(nf, nr);
          const t = this.board[sq];
          if (!t) {
            // T2 翻山游击: 跨过 1 个子后可继续在空格落子位移
            if (pieces === 0 || (tier >= 2 && pieces === 1)) {
              out.push((from << 8) | sq);
            }
            nf += df;
            nr += dr;
            continue;
          }
          pieces++;
          const enemy = (t > 8 ? BLACK : RED) !== side;
          if (pieces === 1 && hasAllyAdj && enemy && (t & 7) !== K) {
            out.push((from << 8) | sq); // T3 自充炮台
          } else if (pieces === 2 && enemy) {
            out.push((from << 8) | sq); // 标准隔 1 子吃
          }
          if (pieces >= 2) break;
          nf += df;
          nr += dr;
        }
      }
    } else {
      // 路线 A【重炮超远狙击】
      const maxScreens = tier >= 3 ? 9 : tier >= 2 ? 3 : tier >= 1 ? 2 : 1;
      for (const [df, dr] of ORTH) {
        let nf = f + df;
        let nr = r + dr;
        let pieces = 0;
        while (onBoard(nf, nr)) {
          const sq = sqOf(nf, nr);
          const t = this.board[sq];
          if (!t) {
            if (pieces === 0) out.push((from << 8) | sq);
            nf += df;
            nr += dr;
            continue;
          }
          pieces++;
          const enemy = (t > 8 ? BLACK : RED) !== side;
          if (pieces >= 2 && pieces - 1 <= maxScreens && enemy) {
            if (pieces - 1 === 1 || (t & 7) !== K) {
              out.push((from << 8) | sq);
            }
          }
          if (pieces > maxScreens) break;
          nf += df;
          nr += dr;
        }
      }
    }
  }

  #genPawn(from, f, r, side, tier, branch, out) {
    const fwd = side === RED ? 1 : -1;
    const nf1 = r + fwd;
    if (onBoard(f, nf1)) this.#push(out, from, sqOf(f, nf1), side);

    if (branch === 'B') {
      // 路线 B【战阵拒马】
      if (tier >= 1) {
        // 横行疾步: 左右横行 1~2 格
        if (f > 0) this.#push(out, from, sqOf(f - 1, r), side);
        if (f < 8) this.#push(out, from, sqOf(f + 1, r), side);
        if (f > 1 && this.board[sqOf(f - 1, r)] === EMPTY) this.#push(out, from, sqOf(f - 2, r), side);
        if (f < 7 && this.board[sqOf(f + 1, r)] === EMPTY) this.#push(out, from, sqOf(f + 2, r), side);
      }
      if (tier >= 2) {
        // 金戈斜刺: 四向斜走一格
        for (const [df, dr] of DIAG) {
          const nf = f + df;
          const nr = r + dr;
          if (onBoard(nf, nr)) this.#push(out, from, sqOf(nf, nr), side);
        }
      }
      if (tier >= 3) {
        // 神兵破阵: 向前冲两格
        const nr2 = r + fwd * 2;
        if (onBoard(f, nr2) && this.board[sqOf(f, nf1)] === EMPTY) {
          this.#push(out, from, sqOf(f, nr2), side);
        }
      }
    } else {
      // 路线 A【陷阵狂徒】
      if (tier >= 1) {
        const nr2 = r + fwd * 2;
        if (onBoard(f, nr2) && this.board[sqOf(f, nf1)] === EMPTY) {
          this.#push(out, from, sqOf(f, nr2), side);
        }
      }
      const crossed = side === RED ? r >= 5 : r <= 4;
      if (crossed || tier >= 2) {
        if (f > 0) this.#push(out, from, sqOf(f - 1, r), side);
        if (f < 8) this.#push(out, from, sqOf(f + 1, r), side);
      }
      if (tier >= 3) {
        if (crossed) {
          // 王步: 八方各走一格
          for (const [df, dr] of ALL_DIRS) {
            const nf = f + df;
            const nr = r + dr;
            if (onBoard(nf, nr)) this.#push(out, from, sqOf(nf, nr), side);
          }
        } else {
          if (f > 0 && onBoard(f - 1, nf1)) this.#push(out, from, sqOf(f - 1, nf1), side);
          if (f < 8 && onBoard(f + 1, nf1)) this.#push(out, from, sqOf(f + 1, nf1), side);
        }
      }
    }
  }

  /* ------------------------------------------------------------- legality */

  legalMoves(out = []) {
    const pseudo = [];
    this.pseudo(pseudo);
    const side = this.turn;
    out.length = 0;
    for (let i = 0; i < pseudo.length; i++) {
      const m = pseudo[i];
      const u = this.make(m);
      if (!this.inCheck(side)) out.push(m);
      this.unmake(u);
    }
    return out;
  }

  inCheck(side) {
    const king = this.kings[side];
    if (king < 0) return false;
    return this.attacked(king, side ^ 1);
  }

  /** Does `by` attack `sq`? Only the piece types that can reach a king matter. */
  attacked(sq, by) {
    const b = this.board;
    const f = sq % 9;
    const r = (sq - f) / 9;
    const t = this.tier[by];
    const br = this.branch[by];

    // Branch B or exotic moves: evaluate through exact pseudo-move generation to prevent discrepancies
    if (br[P] === 'B' || br[H] === 'B' || br[C] === 'B' || br[R] === 'B' || t[A] > 0 || t[E] > 0 || t[H] >= 3) {
      const saved = this.turn;
      this.turn = by;
      const pseudo = this.pseudo([]);
      this.turn = saved;
      for (let i = 0; i < pseudo.length; i++) {
        if ((pseudo[i] & 255) === sq) return true;
      }
      return false;
    }

    const pawn = codeOf(by, P);
    const horse = codeOf(by, H);
    const rook = codeOf(by, R);
    const cannon = codeOf(by, C);
    const king = codeOf(by, K);

    // Every upgrade that reaches further has to be mirrored here, or a king can
    // walk into a check that legalMoves never warned about.
    const pawnTier = t[P];
    const diagonalPawn = pawnTier >= 3;
    const sidewaysPawn = pawnTier >= 2;
    const dashPawn = pawnTier >= 1;
    if (by === RED) {
      if (r >= 1 && b[sqOf(f, r - 1)] === pawn) return true;
      if (dashPawn && r >= 2 && b[sqOf(f, r - 2)] === pawn && b[sqOf(f, r - 1)] === EMPTY) return true;
      if ((r >= 5 || sidewaysPawn) && f > 0 && b[sqOf(f - 1, r)] === pawn) return true;
      if ((r >= 5 || sidewaysPawn) && f < 8 && b[sqOf(f + 1, r)] === pawn) return true;
      if (diagonalPawn && r >= 1 && f > 0 && b[sqOf(f - 1, r - 1)] === pawn) return true;
      if (diagonalPawn && r >= 1 && f < 8 && b[sqOf(f + 1, r - 1)] === pawn) return true;
    } else {
      if (r <= 8 && b[sqOf(f, r + 1)] === pawn) return true;
      if (dashPawn && r <= 7 && b[sqOf(f, r + 2)] === pawn && b[sqOf(f, r + 1)] === EMPTY) return true;
      if ((r <= 4 || sidewaysPawn) && f > 0 && b[sqOf(f - 1, r)] === pawn) return true;
      if ((r <= 4 || sidewaysPawn) && f < 8 && b[sqOf(f + 1, r)] === pawn) return true;
      if (diagonalPawn && r <= 8 && f > 0 && b[sqOf(f - 1, r + 1)] === pawn) return true;
      if (diagonalPawn && r <= 8 && f < 8 && b[sqOf(f + 1, r + 1)] === pawn) return true;
    }

    const noLegs = t[H] >= 1;
    for (const [df, dr, lf, lr] of HORSE_MOVES) {
      const hf = f - df;
      const hr = r - dr;
      if (!onBoard(hf, hr)) continue;
      if (b[sqOf(hf, hr)] !== horse) continue;
      if (noLegs || b[sqOf(hf + lf, hr + lr)] === EMPTY) return true;
    }
    if (t[H] >= 2) {
      for (const [df, dr] of MU_MOVES) {
        const hf = f - df;
        const hr = r - dr;
        if (onBoard(hf, hr) && b[sqOf(hf, hr)] === horse) return true;
      }
    }
    if (t[H] >= 3) {
      for (const [df, dr] of DIAG) {
        const hf = f - df;
        const hr = r - dr;
        if (onBoard(hf, hr) && b[sqOf(hf, hr)] === horse) return true;
      }
    }

    const cannonTier = t[C];
    const maxScreens = cannonTier >= 2 ? 3 : cannonTier >= 1 ? 2 : 1;
    for (const [df, dr] of ORTH) {
      let nf = f + df;
      let nr = r + dr;
      let pieces = 0;
      let dist = 0;
      while (onBoard(nf, nr)) {
        dist++;
        const c = b[sqOf(nf, nr)];
        if (c) {
          pieces++;
          if (pieces === 1) {
            if (c === rook) return true;
            if (c === king && df === 0) return true; // 将帅照面
            // 近身炮 is point-blank only; a cannon further down the ray still
            // needs a screen, so distance matters here.
            if (c === cannon && cannonTier >= 3 && dist === 1) return true;
          } else if (c === cannon && pieces - 1 === 1) {
            // 隔2子/隔3子时不将军: 仅标准隔1子才算将军
            return true;
          }
          if (pieces > maxScreens) break;
        }
        nf += df;
        nr += dr;
      }
    }

    // Rook diagonal checks: T1 = 1 step, T2 = 2 steps, T3+ = full queen ray
    if (t[R] >= 1) {
      const maxSteps = t[R] >= 3 ? 9 : t[R];
      for (const [df, dr] of DIAG) {
        let nf = f + df;
        let nr = r + dr;
        let steps = 0;
        while (onBoard(nf, nr) && steps < maxSteps) {
          steps++;
          const c = b[sqOf(nf, nr)];
          if (c) {
            if (c === rook) return true;
            break;
          }
          nf += df;
          nr += dr;
        }
      }
    }

    // Advisors and elephants can only ever reach the enemy king once upgraded,
    // so keep the exact (slower) test behind a tier guard.
    if (t[A] > 0 || t[E] > 0) return this.#guardAttacks(sq, by);
    return false;
  }

  #guardAttacks(sq, by) {
    const saved = this.turn;
    this.turn = by;
    const pseudo = this.pseudo([]);
    this.turn = saved;
    for (let i = 0; i < pseudo.length; i++) {
      const m = pseudo[i];
      if ((m & 255) !== sq) continue;
      const t = this.board[m >> 8] & 7;
      if (t === A || t === E) return true;
    }
    return false;
  }

  hasLegalMove() {
    return this.legalMoves([]).length > 0;
  }

  /** Xiangqi: stalemate is a loss for the stalemated side, not a draw. */
  isStalemate() {
    return !this.inCheck(this.turn) && !this.hasLegalMove();
  }

  isCheckmate() {
    return this.inCheck(this.turn) && !this.hasLegalMove();
  }
}

export function perft(pos, depth) {
  if (depth === 0) return 1;
  const moves = pos.legalMoves([]);
  if (depth === 1) return moves.length;
  let total = 0;
  for (let i = 0; i < moves.length; i++) {
    const u = pos.make(moves[i]);
    total += perft(pos, depth - 1);
    pos.unmake(u);
  }
  return total;
}
