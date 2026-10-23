// The shop: one visit halfway through the run, paid for with gold earned by
// clearing stages quickly.
//
// Stock is derived from the run state rather than stored, so buying a move
// upgrade immediately reveals the next tier and buying the last soldier makes
// that line disappear. No purchase log is needed.
//
// Prices are tuned against the gold curve in levels.js: a player who clears
// every stage at par arrives with roughly 80-90 gold, which buys three or four
// things — enough for a real decision, not enough for everything.

import { MAX_COUNT, addToRoster, countOf } from './run.js';
import { MAX_TIER, TIERS, PIECE_CN, PASSIVES, applyReward } from './rewards.js';

const TIER_ORDER = ['p', 'c', 'n', 'r', 'a', 'b'];
const RECRUIT_ORDER = ['p', 'a', 'b', 'n', 'c'];

const tierPrice = (to) => 22 + 12 * (to - 1);

const RECRUIT_PRICE = { p: 16, a: 22, b: 22, n: 34, c: 34 };

export const SHOP_GOODS = {
  undo: {
    name: '悔棋符',
    price: 14,
    desc: '用一次退回上一步。每张符用一次就没了。',
  },
  armor: {
    name: '帅护甲',
    price: 30,
  },
};

/** Everything the player can buy right now, given what they still own. */
export function buildShop(run) {
  const stock = [];

  for (const type of TIER_ORDER) {
    const current = run.tiers[type] ?? 0;
    if (current >= MAX_TIER[type]) continue;
    if (countOf(run, type) === 0) continue; // upgrading a type you lost is a dead buy
    const to = current + 1;
    stock.push({
      key: `tier:${type}:${to}`,
      kind: 'tier',
      type,
      to,
      tag: '走法升级',
      title: `${PIECE_CN[type]} · ${TIERS[type][to].name}`,
      desc: TIERS[type][to].desc,
      price: tierPrice(to),
    });
  }

  for (const type of RECRUIT_ORDER) {
    if (countOf(run, type) >= MAX_COUNT[type]) continue;
    stock.push({
      key: `recruit:${type}`,
      kind: 'recruit',
      type,
      tag: '补充子力',
      title: `补一个${PIECE_CN[type]}`,
      desc: `立刻往部队里加 1 个${PIECE_CN[type]}，永久留在你的部队里。`,
      price: RECRUIT_PRICE[type],
    });
  }

  const armorStacks = run.passives.armor ?? 0;
  if (armorStacks < PASSIVES.armor.max) {
    stock.push({
      key: 'passive:armor',
      kind: 'passive',
      id: 'armor',
      tag: '被动',
      title: SHOP_GOODS.armor.name,
      desc: PASSIVES.armor.desc,
      price: SHOP_GOODS.armor.price,
    });
  }

  stock.push({
    key: 'item:undo',
    kind: 'item',
    id: 'undo',
    tag: '道具',
    title: `${SHOP_GOODS.undo.name} ×1`,
    desc: SHOP_GOODS.undo.desc,
    price: SHOP_GOODS.undo.price,
  });

  return stock;
}

/** Buys one entry. Returns true when the purchase went through. */
export function buy(run, entry) {
  if (!entry || run.gold < entry.price) return false;
  if (entry.kind === 'recruit') {
    if (!addToRoster(run, entry.type)) return false;
    run.gold -= entry.price;
    return true;
  }
  run.gold -= entry.price;
  applyReward(run, entry);
  return true;
}
