// Thin UCI wrapper around the Pikafish chess engine worker.
// 11-step difficulty presets (skill / movetime / depth / MultiPV).

export const DIFFICULTY = [
  { skill: 0, move_time: 1, depth: 1, multi_pv: 5 },
  { skill: 0, move_time: 1, depth: 1, multi_pv: 2 },
  { skill: 0, move_time: 1, depth: 1, multi_pv: 1 },
  { skill: 3, move_time: 10, depth: 2, multi_pv: 1 },
  { skill: 4, move_time: 20, depth: 3, multi_pv: 1 },
  { skill: 5, move_time: 30, depth: 4, multi_pv: 1 },
  { skill: 6, move_time: 40, depth: 5, multi_pv: 1 },
  { skill: 7, move_time: 50, depth: 6, multi_pv: 1 },
  { skill: 8, move_time: 100, depth: 8, multi_pv: 1 },
  { skill: 20, move_time: 500, depth: 15, multi_pv: 1 },
  // extra strong tier on top of the site's 10: full strength, searches to depth 22
  { skill: 20, move_time: 12000, depth: 22, multi_pv: 1 },
];

export const HINT_LEVEL = { skill: 20, move_time: 1200, depth: 20, multi_pv: 1 };

// The site's FEN uses `r`/`b` for the side to move, Pikafish expects `w`/`b`.
export function toEngineFen(fen) {
  const parts = fen.trim().split(/\s+/);
  parts[1] = parts[1] === 'r' ? 'w' : 'b';
  return parts.join(' ');
}

export class Engine {
  constructor({ onState, onInfo } = {}) {
    this.onState = onState || (() => {});
    this.onInfo = onInfo || (() => {});
  }

  #worker = null;
  #ready = null;
  #queue = [];
  #current = null;
  #pv = [];

  start() {
    if (this.#ready) return this.#ready;
    this.#ready = new Promise((resolve, reject) => {
      const worker = new Worker('engine/pikafish.worker.js');
      this.#worker = worker;

      worker.onerror = (event) => {
        this.onState('unavailable', event.message || '引擎加载失败');
        reject(new Error(event.message || 'Worker failed to start'));
      };

      worker.onmessage = (event) => {
        const { type, payload } = event.data || {};
        if (type === 'ready') {
          this.onState('ready');
          resolve(this);
        } else if (type === 'error') {
          this.onState('unavailable', payload);
          reject(new Error(payload));
        } else if (type === 'output') {
          this.#onLine(String(payload));
        }
      };

      worker.postMessage({ type: 'init' });
    });
    return this.#ready;
  }

  #post(command) {
    if (this.#worker) this.#worker.postMessage({ type: 'cmd', payload: command });
  }

  #onLine(line) {
    if (line.startsWith('info ')) {
      if (line.includes(' pv ')) {
        const info = parseInfo(line);
        if (info) {
          this.onInfo(info);
          if (this.#current?.multiPv > 1 && info.pv.length) this.#pv.push(info.pv[0]);
        }
      }
      return;
    }

    if (line.startsWith('bestmove')) {
      const job = this.#current;
      this.#current = null;
      let uci = line.split(/\s+/)[1];
      if (job && job.multiPv > 1 && this.#pv.length) {
        // MultiPV ranks the best line first, so the last entry is the weakest candidate.
        uci = this.#pv[this.#pv.length - 1];
      }
      this.#pv = [];
      if (job) job.resolve(uci && uci !== '(none)' ? uci : null);
      this.#drain();
    }
  }

  /**
   * Search a position. `moves` are ICCS/UCI strings played from `fen`.
   * Resolves with the chosen move, or null when the engine has no reply.
   */
  play({ fen, moves = [], preset }) {
    return new Promise((resolve) => {
      this.#queue.push({ fen, moves, preset, multiPv: preset.multi_pv || 1, resolve });
      this.#drain();
    });
  }

  #drain() {
    if (this.#current || !this.#ready) return;
    const job = this.#queue.shift();
    if (!job) return;
    this.#current = job;
    this.#pv = [];

    const { skill, move_time, depth, multi_pv } = job.preset;
    this.#post(`setoption name Skill Level value ${skill}`);
    this.#post(`setoption name MultiPV value ${multi_pv || 1}`);
    this.#post('setoption name UCI_WDLCentipawn value false');
    this.#post('setoption name Repetition Rule value ChineseRule');
    this.#post('ucinewgame');
    const tail = job.moves.length ? ` moves ${job.moves.join(' ')}` : '';
    this.#post(`position fen ${toEngineFen(job.fen)}${tail}`);
    this.#post(`go movetime ${move_time} depth ${depth}`);
  }

  stop() {
    const job = this.#current;
    this.#current = null;
    this.#pv = [];
    if (job) job.resolve(null);
    this.#post('stop');
    this.#drain();
  }

  destroy() {
    this.stop();
    this.#queue.length = 0;
    if (this.#worker) this.#worker.terminate();
    this.#worker = null;
    this.#ready = null;
  }
}

function parseInfo(line) {
  const get = (key) => {
    const m = new RegExp(`\\b${key} (-?\\d+)`).exec(line);
    return m ? Number(m[1]) : undefined;
  };
  const scoreAt = line.indexOf(' score ');
  let score = null;
  if (scoreAt >= 0) {
    const rest = line.slice(scoreAt + 7).split(' ');
    if (rest[0] === 'cp') score = { cp: Number(rest[1]) };
    else if (rest[0] === 'mate') score = { mate: Number(rest[1]) };
  }
  const pvAt = line.indexOf(' pv ');
  const pv = pvAt >= 0 ? line.slice(pvAt + 4).trim().split(/\s+/) : [];
  return {
    depth: get('depth') ?? 0,
    multipv: get('multipv') ?? 1,
    nodes: get('nodes') ?? 0,
    nps: get('nps') ?? 0,
    time: get('time') ?? 0,
    score,
    pv,
  };
}
