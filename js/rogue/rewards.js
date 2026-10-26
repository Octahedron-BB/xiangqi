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

// How far each piece type can be pushed.
export const MAX_TIER = { p: 3, c: 3, n: 3, r: 3, a: 2, b: 2 };

// Branching tier definitions.
// Pieces p, c, n, r have Branch A and Branch B.
// Pieces a, b have a single upgrade tree.
export const TIERS = {
  p: {
    A: [
      { name: '标准', desc: '向前一格' },
      { name: '冲两格', desc: '【陷阵】兵可以一次向前走两格（中间需为空）' },
      { name: '横行', desc: '【陷阵】兵未过河也可左右横走一格' },
      { name: '王步', desc: '【陷阵】兵过河后可向周围八方任意走一格（进退自如）' },
    ],
    B: [
      { name: '标准', desc: '向前一格' },
      { name: '横行疾步', desc: '【战阵】未过河即可横走，且横走可走 1~2 格' },
      { name: '金戈斜刺', desc: '【战阵】可向四条斜线（斜前、斜后）任意斜走一格' },
      { name: '神兵破阵', desc: '【战阵】向前可冲两格，且吃子额外奖励 +3 金币' },
    ],
  },
  n: {
    A: [
      { name: '标准', desc: '日字，蹩马腿' },
      { name: '不蹩腿', desc: '【天马】马腿被挡住也照样能走' },
      { name: '走目', desc: '【天马】额外可走八个 (±1,±3)/(±3,±1) 目字远跳点' },
      { name: '天马', desc: '【天马】额外可走「田」字 (±2,±2)，不塞眼且可过河' },
    ],
    B: [
      { name: '标准', desc: '日字，蹩马腿' },
      { name: '斜步', desc: '【铁骑】马额外可沿四角斜走一格' },
      { name: '近身刺', desc: '【铁骑】马额外可沿正方向（上下左右）直走一格' },
      { name: '连环步', desc: '【铁骑】马移动若未吃子，可选择待命或再斜走一步（不可吃子）' },
    ],
  },
  c: {
    A: [
      { name: '标准', desc: '隔一个子吃' },
      { name: '隔二子', desc: '【重炮】可跳过两个子吃（不能隔两子将军）' },
      { name: '隔三子', desc: '【重炮】可跳过三个子吃（不能隔三子将军）' },
      { name: '贯通炮', desc: '【重炮】隔子数量无上限，只要线路上有炮架即可超远轰击' },
    ],
    B: [
      { name: '标准', desc: '隔一个子吃' },
      { name: '近身免架', desc: '【神火】紧邻的敌子不用炮架也能直接吃' },
      { name: '翻山游击', desc: '【神火】炮即使不吃子，也可以跳过 1 个棋子位移' },
      { name: '自充炮台', desc: '【神火】只要炮紧邻己方任意棋子，开火无需中途炮架' },
    ],
  },
  r: {
    A: [
      { name: '标准', desc: '直线任意格' },
      { name: '斜一步', desc: '【神后】车额外可沿四条斜线各走一格' },
      { name: '斜两格', desc: '【神后】车额外可沿四条斜线走一至两格（可被阻挡）' },
      { name: '神后', desc: '【神后】车额外可沿四条斜线任意滑行 —— 化身国际象棋的「后」' },
    ],
    B: [
      { name: '标准', desc: '直线任意格' },
      { name: '贯石', desc: '【重辇】车沿直线冲锋时，可跃过 1 个友军继续直线滑行' },
      { name: '隔子冲杀', desc: '【重辇】车沿直线冲锋时，可越过 1 个敌子直接吃其后方的敌子' },
      { name: '雷霆万钧', desc: '【重辇】直线滑行超过4格吃子后，可选择待命或再走一步（不可吃子）' },
    ],
  },
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
  recruit_r: {
    name: '重辇',
    max: 1,
    gain: 'r',
    desc: '立刻补充 1 个车，加入你的部队',
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

export const RELICS = {
  sacrifice: {
    id: 'sacrifice',
    name: '《弃子争先》',
    rarity: 'rare',
    weight: 45,
    desc: '我方大子（车/马/炮）阵亡后，下个红方回合获得连走两步特权（若第1步叫将则按双招规则提前终结连走，逼对方应将）！',
  },
  soul_retrieval: {
    id: 'soul_retrieval',
    name: '《借尸还魂》',
    rarity: 'epic',
    weight: 35,
    desc: '每关限 1 次，击破敌方首个车、马或炮时，直接将其度化并收入我方备用区！',
  },
  last_stand: {
    id: 'last_stand',
    name: '《背水一战》',
    rarity: 'rare',
    weight: 45,
    desc: '【绝境觉醒】：当除帅外存活子力 ≤ 3 时全军大爆发：帅出九宫八方御敌，士出九宫全斜滑行，相过河不塞眼，马不蹩腿跳田，车跃友军斜一步，炮近身免架，兵八方任行！',
  },
  deception: {
    id: 'deception',
    name: '《瞒天过海》',
    rarity: 'common',
    weight: 70,
    desc: '【奇谋伪装】：仕出九宫全斜滑行、相过河不塞眼（全关永久生效）；且开局前 2 回合敌方处于迷雾之中，绝不可吃我方任何子力！',
  },
  cicada_shell: {
    id: 'cicada_shell',
    name: '《金蝉脱壳》',
    rarity: 'epic',
    weight: 35,
    desc: '每关限 1 次，主帅面临必死将杀无路可退时，瞬间与最近的友方兵或仕调换位置脱险！',
  },
  iron_chains: {
    id: 'iron_chains',
    name: '《连环铁锁》',
    rarity: 'rare',
    weight: 50,
    desc: '【铁索防线】：凡有己方棋子看护（生根）的红方棋子，敌方兵卒绝不可吃；若两子处于互相看护（双向互保）状态，敌方黑马亦无法跳吃！',
  },
  gold_hunter: {
    id: 'gold_hunter',
    name: '《摸金校尉》',
    rarity: 'common',
    weight: 70,
    desc: '每次吃子金币 +1；若处于悬赏关卡，悬赏奖金额外提升 50%。',
  },
  bounty_hero: {
    id: 'bounty_hero',
    name: '《重赏勇夫》',
    rarity: 'epic',
    weight: 35,
    desc: '补给铺进店时，必定随机赠送一件免费商品（0 金币任意拿）！',
  },
};

export const RISK = {
  id: 'bloodprice',
  name: '血酬',
  desc: '立刻再选 2 次升级；代价是之后每一关黑方多 1 个卒',
};

// Item rarities and lottery weights. Lower weight = rarer appearance.
export const RARITY_CONFIG = {
  // 车
  'tier:r:A:3': { rarity: 'legendary', weight: 15 }, // 神后
  'tier:r:B:3': { rarity: 'epic', weight: 35 },      // 雷霆万钧
  'tier:r:A:2': { rarity: 'rare', weight: 60 },
  'tier:r:B:2': { rarity: 'rare', weight: 60 },
  'tier:r:A:1': { rarity: 'common', weight: 90 },
  'tier:r:B:1': { rarity: 'rare', weight: 60 },      // 贯石
  'passive:recruit_r': { rarity: 'epic', weight: 35 },

  // 炮
  'tier:c:A:3': { rarity: 'epic', weight: 35 },      // 贯通炮
  'tier:c:B:3': { rarity: 'epic', weight: 35 },      // 自充炮台
  'tier:c:A:1': { rarity: 'rare', weight: 60 },
  'tier:c:A:2': { rarity: 'rare', weight: 60 },
  'tier:c:B:1': { rarity: 'epic', weight: 35 },      // 近身免架
  'tier:c:B:2': { rarity: 'rare', weight: 60 },

  // 马
  'tier:n:A:1': { rarity: 'epic', weight: 35 },      // 不蹩腿
  'tier:n:A:2': { rarity: 'rare', weight: 60 },      // 走目
  'tier:n:A:3': { rarity: 'epic', weight: 35 },      // 天马
  'tier:n:B:1': { rarity: 'common', weight: 90 },    // 斜步
  'tier:n:B:2': { rarity: 'rare', weight: 60 },      // 近身刺
  'tier:n:B:3': { rarity: 'epic', weight: 35 },      // 连环步

  // 兵
  'tier:p:A:1': { rarity: 'common', weight: 90 },
  'tier:p:A:2': { rarity: 'common', weight: 90 },
  'tier:p:A:3': { rarity: 'rare', weight: 60 },      // 王步
  'tier:p:B:1': { rarity: 'common', weight: 90 },    // 横行疾步
  'tier:p:B:2': { rarity: 'rare', weight: 60 },      // 金戈斜刺
  'tier:p:B:3': { rarity: 'rare', weight: 60 },      // 神兵破阵

  // 仕、相、被动
  'tier:a:2': { rarity: 'epic', weight: 35 },
  'tier:b:2': { rarity: 'rare', weight: 60 },
  'passive:armor': { rarity: 'epic', weight: 35 },
  'passive:recruit_n': { rarity: 'rare', weight: 60 },
  'passive:recruit_c': { rarity: 'rare', weight: 60 },
  'passive:spoils': { rarity: 'rare', weight: 60 },
};

export const DEFAULT_RARITY = { rarity: 'common', weight: 100 };

const TYPE_ORDER = ['p', 'c', 'n', 'r', 'a', 'b'];

/** Everything currently on offer, before drawing. */
export function buildPool(run) {
  const pool = [];
  for (const type of TYPE_ORDER) {
    const current = run.tiers[type] ?? 0;
    if (current >= MAX_TIER[type]) continue;
    // Upgrading a type you no longer own would be a dead pick.
    if (countOf(run, type) === 0) continue;

    const hasBranches = ['p', 'n', 'c', 'r'].includes(type);
    const branches = hasBranches
      ? (run.branches?.[type] ? [run.branches[type]] : ['A', 'B'])
      : [null];

    for (const branch of branches) {
      const to = current + 1;
      const key = branch ? `tier:${type}:${branch}:${to}` : `tier:${type}:${to}`;
      const meta = RARITY_CONFIG[key] ?? DEFAULT_RARITY;
      const spec = branch ? TIERS[type][branch][to] : TIERS[type][to];
      const branchTag = branch === 'A' ? '路线甲' : branch === 'B' ? '路线乙' : '';
      const tag = branch ? `升级 · ${branchTag}` : '走法升级';
      pool.push({
        key,
        kind: 'tier',
        type,
        branch,
        to,
        tag,
        title: `${PIECE_CN[type]} · ${spec.name}`,
        desc: spec.desc,
        rarity: meta.rarity,
        weight: meta.weight,
      });
    }
  }
  for (const [id, spec] of Object.entries(PASSIVES)) {
    const stacks = run.passives[id] ?? 0;
    if (stacks >= spec.max) continue;
    if (spec.gain && countOf(run, spec.gain) >= MAX_COUNT[spec.gain]) continue;
    const key = `passive:${id}`;
    const meta = RARITY_CONFIG[key] ?? DEFAULT_RARITY;
    pool.push({
      key,
      kind: 'passive',
      id,
      tag: '被动',
      title: spec.name,
      desc: spec.desc,
      stacks,
      max: spec.max,
      rarity: meta.rarity,
      weight: meta.weight,
    });
  }
  for (const [id, spec] of Object.entries(RELICS)) {
    if (run.relics?.[id]) continue;
    pool.push({
      key: `relic:${id}`,
      kind: 'relic',
      id,
      tag: '战术宝物',
      title: spec.name,
      desc: spec.desc,
      rarity: spec.rarity,
      weight: spec.weight,
    });
  }
  return pool;
}


/**
 * Draw a reward screen with weighted sampling without replacement.
 * Never offers two upgrades of the same piece type in one screen.
 */
export function drawRewards(run, opts = {}) {
  const rand = opts.rand ?? Math.random;
  const count = opts.count ?? 3;
  const bag = buildPool(run);
  const picks = [];
  while (picks.length < count && bag.length) {
    const totalWeight = bag.reduce((sum, item) => sum + (item.weight ?? 100), 0);
    let threshold = rand() * totalWeight;
    let selectedIdx = 0;
    for (let i = 0; i < bag.length; i++) {
      threshold -= bag[i].weight ?? 100;
      if (threshold <= 0) {
        selectedIdx = i;
        break;
      }
    }
    const taken = bag.splice(selectedIdx, 1)[0];
    if (taken.kind === 'tier' && picks.some((p) => p.kind === 'tier' && p.type === taken.type)) continue;
    picks.push(taken);
  }
  // The gamble is not always on the menu, otherwise it stops feeling like a choice.
  // Can only be chosen at most once per reward round.
  if (picks.length > 1 && !run.bloodPriceChosenThisRound && rand() < 0.4) {
    picks[picks.length - 1] = {
      key: 'risk:bloodprice',
      kind: 'risk',
      id: RISK.id,
      tag: '代价',
      title: RISK.name,
      desc: RISK.desc,
      rarity: 'epic',
    };
  }
  return picks;
}

export function applyReward(run, choice) {
  if (choice.kind === 'tier') {
    if (choice.branch) {
      run.branches ??= {};
      run.branches[choice.type] = choice.branch;
    }
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
  if (choice.kind === 'relic') {
    run.relics ??= {};
    run.relics[choice.id] = true;
    return;
  }
  if (choice.kind === 'risk') {
    run.pending += 2;
    run.extraBlackPawns += 1;
    run.bloodPriceChosenThisRound = true;
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

/** One-line summary of the build, e.g. 「兵[甲]T2 · 炮[乙]T1 · 车[甲]T1」. */
export function describeBuild(run) {
  const parts = [];
  for (const type of TYPE_ORDER) {
    const tier = run.tiers[type] ?? 0;
    if (tier > 0) {
      const b = run.branches?.[type] ? (run.branches[type] === 'A' ? '甲' : '乙') : '';
      parts.push(`${PIECE_CN[type]}${b ? `[${b}]` : ''}T${tier}`);
    }
  }
  const passives = Object.entries(run.passives)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => (n > 1 ? `${PASSIVES[id].name}×${n}` : PASSIVES[id].name));
  const relics = Object.keys(run.relics ?? {})
    .filter((id) => run.relics[id])
    .map((id) => RELICS[id]?.name ?? id);
  return parts.concat(passives).concat(relics).join(' · ');
}

