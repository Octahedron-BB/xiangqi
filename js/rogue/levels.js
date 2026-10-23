// Encounter table.
//
// A stage now defines only the *enemy*. The player's army is composed from the
// run roster at play time (js/rogue/run.js), which is what makes casualties
// carry across stages. Because the red formation is standard, every red square
// here is rank 0-3 and every authored square is rank 5-9, so the two can never
// collide.
//
// Authored positions are checked by tools/validate-levels.mjs (legal layout, red
// not giving check to a side that is not to move, tier-0 move count).
//
// `refill` lists pieces the run is granted on first entering the stage. Rewards
// and the shop are further sources of reinforcements; all are capped by
// MAX_COUNT.
//
// `par` is the number of plies a clean clear takes. Finishing under par pays
// gold, which is what the shop spends. `shop: true` opens the shop after the
// stage — currently one visit, halfway through the run.

export const LEVELS = [
  {
    id: 1,
    name: '残兵',
    goal: 'annihilate',
    goalText: '吃光黑方所有非将棋子',
    enemy: '4k4/9/9/9/p1p1p4/9/9/9/9/9',
    ai: { maxDepth: 2, timeMs: 200, noise: 60 },
    maxPlies: 120,
    par: 20,
    gold: 12,
    tip: '三个卒，一个车。清干净，别丢子。',
  },
  {
    id: 2,
    name: '隔山',
    goal: 'mate',
    goalText: '将死黑方',
    enemy: '3aka2n/9/9/9/p1p6/9/9/9/9/9',
    refill: ['p'],
    ai: { maxDepth: 3, timeMs: 300, noise: 30 },
    maxPlies: 140,
    par: 30,
    gold: 14,
    tip: '双士护驾，还有一匹马。先拆守子。',
  },
  {
    id: 3,
    name: '对攻',
    goal: 'mate',
    goalText: '将死黑方',
    enemy: 'rc2k4/9/9/9/2p1p4/9/9/9/9/9',
    refill: ['c'],
    ai: { maxDepth: 3, timeMs: 400, noise: 10 },
    maxPlies: 160,
    par: 32,
    gold: 16,
    tip: '黑方有车也有炮。炮需要一个炮架才能开火。',
  },
  {
    id: 4,
    name: '铁壁',
    goal: 'annihilate',
    goalText: '吃光黑方所有非将棋子',
    enemy: '1cbakab2/9/9/9/p3p4/9/9/9/9/9',
    refill: ['p'],
    ai: { maxDepth: 4, timeMs: 500, noise: 0 },
    maxPlies: 170,
    par: 34,
    gold: 18,
    tip: '双士双象加一门炮，黑方一步进不来。拆完守子再动手。',
  },
  {
    id: 5,
    name: '孤军',
    goal: 'mate',
    goalText: '将死黑方',
    enemy: 'rc2k3n/9/9/9/2p1p4/9/9/9/9/9',
    refill: ['n'],
    shop: true,
    ai: { maxDepth: 4, timeMs: 600, noise: 0 },
    maxPlies: 170,
    par: 38,
    gold: 20,
    tip: '车马炮齐了。打完这一关有一间补给铺。',
  },
  {
    id: 6,
    name: '混战',
    goal: 'mate',
    goalText: '将死黑方',
    enemy: 'rn1ak3r/9/9/9/p1p1p4/9/9/9/9/9',
    refill: ['p'],
    ai: { maxDepth: 4, timeMs: 700, noise: 0 },
    maxPlies: 180,
    par: 42,
    gold: 22,
    tip: '双车压边线，中间还有一匹马。任何一次换子都要算清楚。',
  },
  {
    id: 7,
    name: '暗流',
    goal: 'mate',
    goalText: '将死黑方',
    enemy: 'rn1aka2r/9/9/9/2p1p1p2/9/9/9/9/9',
    ai: { maxDepth: 5, timeMs: 800, noise: 0 },
    maxPlies: 180,
    par: 46,
    gold: 24,
    tip: '双车双士加马。你的部队走到这里已经很薄了。',
  },
  {
    id: 8,
    name: '决战',
    goal: 'mate',
    goalText: '将死黑方',
    enemy: 'rncaka1nr/9/9/9/2p1p1p1p/9/9/9/9/9',
    ai: { maxDepth: 5, timeMs: 900, noise: 0 },
    maxPlies: 200,
    par: 55,
    gold: 28,
    tip: '最后一关：双车双马加炮，九宫还有双士。靠强化，也靠少犯错。',
  },
];