// Reward catalogue and draw logic for a run.
//
// Only two kinds of reward are implemented on purpose: a piece *type* going up
// a move tier (so the choice is "which piece do I invest in"), and passives that
// give you more of a piece or buy you a retry. There is no HP and no damage, so a
// reward is only worth anything if it widens a piece's reach, protects it, or
// gives you more of them.
//
// Keys are FEN letters, matching the roster in run.js.

import { MAX_COUNT, addToRoster, countOf, giveItem } from './run.js';

export const PIECE_CN = { a: '仕', b: '相', n: '马', r: '车', c: '炮', p: '兵' };

// How far each piece type can be pushed. A rook only needs one step because
// that step turns it into a queen.
export const MAX_TIER = { p: 3, c: 3, n: 3, r: 1, a: 2, b: 2 };


// TIERS[type][n] describes what tier n unlocks. Index 0 is the standard piece.
export const TIERS = {
  p: [
    { name: '标准', desc: '向前一格' },
    { name: '冲两格', desc: '兵可以一次走两格（中间必须空，第二格能吃的就吃）' },
    { name: '横行', desc: '兵可以左右横走一格' },
    { name: '斜前', desc: '兵可以斜着向前一格' },
  ],
  c: [
    { name: '标准', desc: '隔一个子吃' },
    { name: '隔二子', desc: '可以跳过两个子吃' },
    { name: '隔三子', desc: '可以跳过三个子吃' },
    { name: '近身', desc: '紧邻的敌子不用炮架也能直接吃' },
  ],
  n: [
    { name: '标准', desc: '日字，蹩马腿' },
    { name: '不蹩腿', desc: '马腿被挡住也照样能走' },
    { name: '走目', desc: '额外可走 (±1,±3) / (±3,±1) 八个点' },
    { name: '斜步', desc: '额外可斜走一格' },
  ],
  r: [
    { name: '标准', desc: '直线任意格' },
    { name: '后', desc: '额外可沿四条斜线任意滑行 —— 变成国际象棋的「后」' },
  ],
  a: [
    { name: '标准', desc: '九宫内斜走一格' },
    { name: '斜两格', desc: '九宫内可以斜走两格' },
    { name: '出宫', desc: '可以沿斜线滑行，不再受九宫限制' },
  ],
  b: [
    { name: '标准', desc: '田字，塞象眼不能走' },
    { name: '不塞眼', desc: '象眼被挡住也能走' },
    { name: '过河', desc: '可以越过河界' },
  ],
};



// Passives give you more of a piece or buy you a retry. `gain` marks the ones
// that permanently add a body to the roster the moment they are picked — with
// casualties carrying over, a piece in hand is worth more than a stat.
export const PASSIVES = {
  armor: {
    name: '帅护甲',
    max: 3,
    desc: '失败时消耗一层护甲重打本关；护甲耗尽才算真失败',
  },
  reinforce: {
    name: '增兵',
    max: 3,
    gain: 'p',
    desc: '立刻补充 1 个兵，加入你的部队',
  },
  recruit_n: {
    name: '轻骑',
    max: 1,
    gain: 'n',
    desc: '立刻补充 1 个马，加入你的部队',
  },
  recruit_c: {
    name: '炮队',
    max: 1,
    gain: 'c',
    desc: '立刻补充 1 个炮，加入你的部队',
  },
  recruit_a: {
    name: '近卫',
    max: 1,
    gain: 'a',
    desc: '立刻补充 1 个仕，加入你的部队',
  },
  recruit_b: {
    name: '守备',
    max: 1,
    gain: 'b',
    desc: '立刻补充 1 个相，加入你的部队',
  },
  spoils: {
    name: '战利品',
    max: 1,
    desc: '每关奖励的候选多 1 个',
  },
};

export const RISK = {
  id: 'bloodprice',
  name: '血酬',
  desc: '立刻再选 2 次升级；代价是之后每一关黑方多 1 个卒',
};

const TYPE_ORDER = ['p', 'c', 'n', 'r', 'a', 'b'];

/** Everything currently on offer, before drawing. */
export function buildPool(run) {
  const pool = [];
  for (const type of TYPE_ORDER) {
    const current = run.tiers[type] ?? 0;
    if (current >= MAX_TIER[type]) continue;
    // Upgrading a type you no longer own would be a dead pick.
    if (countOf(run, type) === 0) continue;
    const to = current + 1;
    pool.push({
      key: `tier:${type}:${to}`,
      kind: 'tier',
      type,
      to,
      tag: '走法升级',
      title: `${PIECE_CN[type]} · ${TIERS[type][to].name}`,
      desc: TIERS[type][to].desc,
    });
  }
  for (const [id, spec] of Object.entries(PASSIVES)) {
    const stacks = run.passives[id] ?? 0;
    if (stacks >= spec.max) continue;
    if (spec.gain && countOf(run, spec.gain) >= MAX_COUNT[spec.gain]) continue;
    pool.push({
      key: `passive:${id}`,
      kind: 'passive',
      id,
      tag: '被动',
      title: spec.name,
      desc: spec.desc,
      stacks,
      max: spec.max,
    });
  }
  return pool;
}


/**
 * Draw a reward screen. Pure random without replacement, but never two upgrades
 * of the same piece type in one screen — that would waste a choice without
 * adding any decision.
 */
export function drawRewards(run, opts = {}) {
  const rand = opts.rand ?? Math.random;
  const count = opts.count ?? 3;
  const bag = buildPool(run);
  const picks = [];
  while (picks.length < count && bag.length) {
    const taken = bag.splice(Math.floor(rand() * bag.length), 1)[0];
    if (taken.kind === 'tier' && picks.some((p) => p.kind === 'tier' && p.type === taken.type)) continue;
    picks.push(taken);
  }
  // The gamble is not always on the menu, otherwise it stops feeling like a choice.
  if (picks.length > 1 && rand() < 0.4) {
    picks[picks.length - 1] = {
      key: 'risk:bloodprice',
      kind: 'risk',
      id: RISK.id,
      tag: '代价',
      title: RISK.name,
      desc: RISK.desc,
    };
  }
  return picks;
}

export function applyReward(run, choice) {
  if (choice.kind === 'tier') {
    run.tiers[choice.type] = choice.to;
    return;
  }
  if (choice.kind === 'passive') {
    const spec = PASSIVES[choice.id];
    run.passives[choice.id] = (run.passives[choice.id] ?? 0) + 1;
    if (choice.id === 'armor') run.armor += 1;
    if (spec?.gain) addToRoster(run, spec.gain);
    return;
  }
  if (choice.kind === 'risk') {
    run.pending += 2;
    run.extraBlackPawns += 1;
    return;
  }
  if (choice.kind === 'item') {
    giveItem(run, choice.id, 1);
  }
}

/** One-line summary of the army, e.g. 「帥 車 兵 兵 炮」. */
export function describeArmy(run) {
  const order = ['k', 'r', 'c', 'n', 'a', 'b', 'p'];
  const counts = {};
  for (const type of run.roster) counts[type] = (counts[type] ?? 0) + 1;
  const parts = [];
  for (const type of order) {
    if (!counts[type]) continue;
    const name = type === 'k' ? '帥' : PIECE_CN[type];
    parts.push(counts[type] > 1 ? `${name}×${counts[type]}` : name);
  }
  return parts.join(' ');
}

/** One-line summary of the build, e.g. 「兵T2 · 炮T1 · 车T1」. */
export function describeBuild(run) {
  const parts = [];
  for (const type of TYPE_ORDER) {
    const tier = run.tiers[type] ?? 0;
    if (tier > 0) parts.push(`${PIECE_CN[type]}T${tier}`);
  }
  const passives = Object.entries(run.passives)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => (n > 1 ? `${PASSIVES[id].name}×${n}` : PASSIVES[id].name));
  return parts.concat(passives).join(' · ');
}

