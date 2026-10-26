// The shop: visits throughout the run, paid for with gold earned by clearing
// stages quickly.
//
// The shop inventory is fixed to 8 randomly drawn items per visit. A refresh
// button allows the player to pay gold to reshuffle the stock, with the price
// scaling higher on successive refreshes.

import { MAX_COUNT, MAX_RESERVE, addToRoster, countOf } from './run.js';
import { MAX_TIER, TIERS, PIECE_CN, PASSIVES, RELICS, applyReward, RARITY_CONFIG, DEFAULT_RARITY } from './rewards.js';

const TIER_ORDER = ['p', 'c', 'n', 'r', 'a', 'b'];
const RECRUIT_ORDER = ['p', 'a', 'b', 'n', 'c', 'r'];

const tierPrice = (type, to) => 22 + 12 * (to - 1);

const RECRUIT_PRICE = { p: 16, a: 22, b: 22, n: 34, c: 34, r: 48 };

export const SHOP_GOODS = {
  undo: {
    name: '悔棋符',
    price: 14,
    desc: '用一次退回上一步。每张符用一次就没了。',
  },
  retry: {
    name: '重开符',
    price: 26,
    desc: '用一次退回本关开局，部队也回到本关开始时的样子。',
  },
  armor: {
    name: '帅护甲',
    price: 30,
  },
};

/** Refresh cost scales by 5 gold per refresh: 5, 10, 15, 20... */
export function getRefreshCost(run) {
  const count = run.shopRefreshCount ?? 0;
  return (count + 1) * 5;
}

/** Everything the player could potentially buy right now, given what they own. */
export function buildShopPool(run) {
  const pool = [];

  for (const type of TIER_ORDER) {
    const current = run.tiers[type] ?? 0;
    if (current >= MAX_TIER[type]) continue;
    if (countOf(run, type) === 0 && (run.reserves?.[type] ?? 0) === 0) continue;

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
      pool.push({
        key,
        kind: 'tier',
        type,
        branch,
        to,
        tag: branch ? `升级 · ${branchTag}` : '走法升级',
        title: `${PIECE_CN[type]} · ${spec.name}`,
        desc: spec.desc,
        rarity: meta.rarity,
        price: tierPrice(type, to),
      });
    }
  }

  for (const type of RECRUIT_ORDER) {
    const curRoster = countOf(run, type);
    const curReserve = run.reserves?.[type] ?? 0;
    const maxReserve = MAX_RESERVE[type] ?? 2;
    if (curRoster >= MAX_COUNT[type] && curReserve >= maxReserve) continue;

    const key = `passive:recruit_${type}`;
    const meta = RARITY_CONFIG[key] ?? DEFAULT_RARITY;
    pool.push({
      key: `recruit:${type}`,
      kind: 'recruit',
      type,
      tag: '补充子力',
      title: `补一个${PIECE_CN[type]}`,
      desc: `往部队或备用库加 1 个${PIECE_CN[type]}。`,
      rarity: meta.rarity,
      price: RECRUIT_PRICE[type],
    });
  }

  const armorStacks = run.passives.armor ?? 0;
  if (armorStacks < PASSIVES.armor.max) {
    pool.push({
      key: 'passive:armor',
      kind: 'passive',
      id: 'armor',
      tag: '被动',
      title: SHOP_GOODS.armor.name,
      desc: PASSIVES.armor.desc,
      rarity: 'epic',
      price: SHOP_GOODS.armor.price,
    });
  }

  pool.push({
    key: 'item:undo',
    kind: 'item',
    id: 'undo',
    tag: '道具',
    title: `${SHOP_GOODS.undo.name} ×1`,
    desc: SHOP_GOODS.undo.desc,
    price: SHOP_GOODS.undo.price,
  });

  pool.push({
    key: 'item:retry',
    kind: 'item',
    id: 'retry',
    tag: '道具',
    title: `${SHOP_GOODS.retry.name} ×1`,
    desc: SHOP_GOODS.retry.desc,
    price: SHOP_GOODS.retry.price,
  });

  // Relics
  for (const [id, spec] of Object.entries(RELICS)) {
    if (run.relics?.[id]) continue;
    const priceMap = { common: 24, rare: 36, epic: 48, legendary: 60 };
    pool.push({
      key: `relic:${id}`,
      kind: 'relic',
      id,
      tag: '战术宝物',
      title: spec.name,
      desc: spec.desc,
      rarity: spec.rarity,
      price: priceMap[spec.rarity] ?? 36,
    });
  }

  return pool;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Generates up to 8 distinct, well-balanced items for the shop inventory. */
export function generateShopStock(run, count = 8) {
  const pool = buildShopPool(run);

  const tiers = shuffle(pool.filter((x) => x.kind === 'tier'));
  const recruits = shuffle(pool.filter((x) => x.kind === 'recruit'));
  const relics = shuffle(pool.filter((x) => x.kind === 'relic'));
  const utilities = shuffle(pool.filter((x) => x.kind === 'item' || x.kind === 'passive'));

  const chosen = [];
  const chosenTypes = new Set();

  function pickFrom(list, targetCount) {
    let picked = 0;
    for (const item of list) {
      if (picked >= targetCount) break;
      if (chosen.some((c) => c.key === item.key)) continue;
      if (item.kind === 'tier') {
        if (chosenTypes.has(item.type)) continue;
        chosenTypes.add(item.type);
      }
      chosen.push({ ...item });
      picked++;
    }
  }

  // Quotas for variety: up to 3 tiers, 2 recruits, 2 relics, 1 utility
  pickFrom(tiers, 3);
  pickFrom(recruits, 2);
  pickFrom(relics, 2);
  pickFrom(utilities, 1);

  // Fill remaining slots up to count from whatever else is in the pool
  const allShuffled = shuffle(pool);
  for (const item of allShuffled) {
    if (chosen.length >= count) break;
    if (chosen.some((c) => c.key === item.key)) continue;
    if (item.kind === 'tier' && chosenTypes.has(item.type)) continue;
    if (item.kind === 'tier') chosenTypes.add(item.type);
    chosen.push({ ...item });
  }

  // Sort by category order then price for neat presentation
  const kindOrder = { tier: 1, recruit: 2, relic: 3, passive: 4, item: 5 };
  chosen.sort((a, b) => {
    const ka = kindOrder[a.kind] ?? 99;
    const kb = kindOrder[b.kind] ?? 99;
    if (ka !== kb) return ka - kb;
    return a.price - b.price;
  });

  // 《重赏勇夫》bounty_hero: exactly 1 random item is free per shop visit
  if (run.relics?.bounty_hero && !run.bountyFreeClaimedThisVisit && chosen.length > 0) {
    const paid = chosen.filter((c) => c.price > 0);
    if (paid.length > 0) {
      const lucky = paid[Math.floor(Math.random() * paid.length)];
      lucky.originalPrice = lucky.price;
      lucky.price = 0;
      lucky.tag = '勇夫特惠 · 免费';
      lucky.isBountyFree = true;
    }
  }

  return chosen;
}

/** Returns the current shop stock (cached 8 items, or generates a new batch). */
export function buildShop(run) {
  if (run.currentShopStock && run.currentShopStock.length > 0) {
    return run.currentShopStock;
  }
  run.currentShopStock = generateShopStock(run, 8);
  return run.currentShopStock;
}

/** Refreshes the shop stock by paying gold. Price increases with each refresh. */
export function refreshShop(run) {
  const cost = getRefreshCost(run);
  if (run.gold < cost) return false;
  run.gold -= cost;
  run.shopRefreshCount = (run.shopRefreshCount ?? 0) + 1;
  run.currentShopStock = generateShopStock(run, 8);
  return true;
}

/** Buys one entry. Returns true when the purchase went through. */
export function buy(run, entry) {
  if (!entry || entry.soldOut || run.gold < entry.price) return false;
  if (entry.kind === 'recruit') {
    if (!addToRoster(run, entry.type)) return false;
    run.gold -= entry.price;
    entry.soldOut = true;
    if (entry.isBountyFree) run.bountyFreeClaimedThisVisit = true;
    return true;
  }
  run.gold -= entry.price;
  applyReward(run, entry);
  entry.soldOut = true;
  if (entry.isBountyFree) run.bountyFreeClaimedThisVisit = true;
  return true;
}
