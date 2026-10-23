# 象棋 · 本地版

自用的中国象棋网页版。棋盘、棋子、走子规则、AI 全部来自 **play.xiangqi.com** 的前端资源，
这里只是把它们拆出来重新拼成一个可以离线跑的单机游戏。

> 仅供个人本地娱乐使用。棋盘/棋子美术、规则引擎、Pikafish 打包产物均属于原站或上游项目，
> 请不要二次分发或用于公开发布。

## 运行

```bash
npm start          # 默认 http://localhost:5173
PORT=8080 npm start
```

必须通过 http 访问（`file://` 打不开 Web Worker 和 WASM）。首次进入游戏会下载约 4.6 MB 的
引擎数据（`pikafish.wasm` + `pikafish.data`），之后浏览器会用 IndexedDB 缓存。

## 功能

- 点击选子 → 点击目标格落子，带合法落点提示、将军提示、绝杀/困毙/和棋判定
- 走子有 0.35s 的滑动动画（和原站同参数，尊重系统的「减少动态效果」设置）
- 11 级 AI：原站那 10 个机器人（Meow → Hu）参数完全一致，另外加了一个满强度的 Zen（深度 22）
- 电脑落子前会顿一下（至少 480 ms），不会一算完就立刻拍下来
- **AI 自战时红黑双方可以分别设等级**（例如红方 Meow、黑方 Hu）
- 悔棋、提示（画箭头 + 中文着法）、翻转棋盘、AI 自战（自动对弈）
- 着法列表用中文记谱（炮二平五 / 马8进7），悬停可看 ICCS 坐标
- 实时引擎信息（深度 / 评分 / 节点）与胜率条
- FEN 复制 / 载入，设置存 localStorage

## Roguelike：劫棋

`rogue.html` 是一个独立的玩法：8 关闯关，每过一关三选一拿强化，攒出一条 build。
它和经典模式**不共用规则引擎**——因为要给棋子加「走法等级」（兵能走多格、炮能多跳等），
Pikafish 做不到，所以另写了一个引擎和 AI。

设计文档见 [`docs/rogue-prd.md`](docs/rogue-prd.md)。

### 核心：部队会死，死了就没了

这是一局的地基。每关**不再重置成新的残局**——同一支部队从头打到尾：

- 开局是一车双兵（`帥 车 兵 兵`）。
- 被吃掉的红子会从部队名册里**永久移除**，HUD 的「部队」那行实时反映。
- 每关开始按**固定阵型**把存活部队摆到己方半场（帅 e0、车 a0/i0、马 b0/h0、
  炮 b2/h2、仕 d0/f0、相 c0/g0、兵 a3/c3/e3/g3/i3），多出来的同类子依次占下一个空位。
- 补给有两个来源，都受上限约束（兵 ≤5，马/炮/仕/相 ≤2）：**关卡表**在指定关卡一次性补，
  **奖励池**里的补子选项立刻加入部队。
- 只剩帅 → 直接判「部队打光了」，不拖到步数上限。
- **重开本关**和护甲重打都会把部队**回滚到本关开始时**的状态——存读档也是同理，
  相当于允许 SL。代价是本关的金币只结一次，关卡表的补给也只发一次。

### 和经典模式的差别

| | 经典模式 | 劫棋 |
|---|---|---|
| 开局 | 标准全子开局 | 一车双兵起步，逐关变难 |
| 部队 | 每局固定 | **跨关继承**，阵亡即失去 |
| 胜负 | 将死/困毙 | 按关卡目标：歼灭或擒王；三次重复时**黑方会被强制变招**，只有无路可换才判负 |
| 失败 | 直接结束 | 扣一层**帅护甲**重打本关（部队回滚），护甲耗尽才结束 |
| 悔棋 | 无 | 需要消耗**悔棋符**，补给铺有卖 |
| 棋子 | 固定走法 | 可带「走法等级」tier（0 = 标准走法） |
| 引擎 | Pikafish（WASM） | `js/rogue/xiangqi.js` + `js/rogue/ai.js` |
| 素材 | — | 棋盘、棋子、记谱全部复用经典模式 |

### 敌方

对手一律用**标准走法**，难度只靠子力和阵型堆出来，所以每关一眼能看出差别：

| 关 | 目标 | 黑方子力（估） | 新东西 |
|---|---|---|---|
| 1 残兵 | 歼灭 | 3 | 三个卒 |
| 2 隔山 | 擒王 | 10 | 双士 + **马** |
| 3 对攻 | 擒王 | 15.5 | **车 + 炮** |
| 4 铁壁 | 歼灭 | 14.5 | 双士双象 + 炮，纯守子 |
| 5 孤军 | 擒王 | 19.5 | **车 + 马 + 炮**（打完开补给铺） |
| 6 混战 | 擒王 | 27 | **双车** + 马 |
| 7 暗流 | 擒王 | 29 | 双车双士 + 马 |
| 8 决战 | 擒王 | 38.5 | **双车双马 + 炮**，九宫还有双士 |

「歼灭」只放在敌方没有强攻子的关卡（1、4），否则在继承制下会逼你换子。

### 金币与补给铺

- 每过一关按**步数**发金币：`基础金币 + 2 × (par − 你走的步数)`。走得越干净给得越多。
- **第 5 关打完开一次补给铺**，用金币买：走法升级、补子、帅护甲、悔棋符。
  买多少都行，买完点「离开」。
- 价格随档位涨：走法升级 22 / 34 / 46，补子 16–34，护甲 30，悔棋符 14。
- 一路按 par 打完大约能攒 150 金，够买三到四件。

### 奖励

每过一关弹一次三选一（「战利品」被动让候选变成 4 个，整局只能选一次）。只有三类：

| 类型 | 内容 |
|---|---|
| **走法升级** | 某类棋子 +1 档，作用于你**所有**这类子 |
| **补子** | 增兵 / 轻骑 / 炮队 / 近卫 / 守备：立刻往部队里加一个子（各类有上限） |
| **被动** | 帅护甲 +1 / 战利品 |
| **代价** | 血酬：立刻再选 2 次，但之后每关黑方多 1 个卒 |

走法升级按**棋子类型**生效，但**部队里没有这类子时不会出现在候选里**——全灭的兵种
升级是废牌。这是继承制带来的新约束：丢子不只是丢子力，还可能让你之前买的升级作废。


### 走法等级（tier）

tier 只**增加**走法、从不删除标准走法，所以 tier 全 0 时就是标准象棋
（`tools/validate-levels.mjs` 会用它和 `js/rules.js` 对走法数）。

- 兵：T1 冲两格（中间须空，第二格可吃）· T2 横行 · T3 斜前
- 炮：T1 隔两子 · T2 隔三子 · T3 近身吃（紧邻敌子免炮架）
- 马：T1 不蹩腿 · T2 走「目」（±1,±3 / ±3,±1）· T3 斜走一格
- 车：T1 走斜线 —— 直走 + 斜走，像国际象棋的「后」（只有这一档）
- 仕：T1 斜两格 · T2 出九宫斜滑
- 相：T1 不塞象眼 · T2 可过河

### 存档

侧栏有 **保存 / 读取 / 从头开始** 三个按钮，存在浏览器 localStorage（键 `xq.rogue.save.v1`）。

存档只记录**关卡开始**的状态：读取后从该关开头重来，部队是本关开始时的部队。
这样就不用在存档里塞整个棋谱。关卡表的补给和该关金币不会重复发放。

「从头开始」会先确认，然后清掉存档回到第 1 关。

### 调试

`rogue.html?debug=1` 会把引擎和控制器挂到 `window.__rogue` 上：

```js
__rogue.pos                      // 局面（.fen() / .legalMoves() / .load(fen) / .perft(n)）
__rogue.run                      // run 状态（roster / tiers / passives / armor / gold / items / pending）
__rogue.army                     // 「帥 车 兵×2」这样的一行部队摘要
__rogue.buildFen()               // 按当前部队＋关卡合成出的完整 FEN
__rogue.startLevel(n, {rewind})  // 进入第 n 关；rewind=true 回滚部队到本关开始
__rogue.play(from, to)           // 以格子索引走一步（from/to 都是 rank*9+file）
__rogue.finishIfOver()           // 手动跑一次胜负判定
__rogue.drawRewards(run, {count})// 抽一屏奖励候选
__rogue.applyReward(run, choice) // 直接施加一项奖励
__rogue.buildShop(run) / buy()   // 商店库存与购买
__rogue.saveGame() / loadGame() / newGame()
__rogue.repeatsOn(move)          // 这一步会不会构成第三次重复
```

### 校验关卡

```bash
node tools/validate-levels.mjs   # 关卡合成后的局面是否合法、走法数是否与经典引擎一致
node tools/audit-rogue.mjs       # 引擎一致性审计（见下）
CHROME_PATH=... node tools/smoke-roster.mjs    # 继承规则（阵亡/悔棋/护甲回滚）
CHROME_PATH=... node tools/smoke-economy.mjs   # 金币/商店/存档/长将变招
CHROME_PATH=... node tools/smoke-rogue.mjs     # 无头跑通完整一局
```

`validate-levels` 会按游戏里的同一套逻辑（敌方布置 + 满编阵型）合成每关局面，检查
双方将帅是否都在、非走子方是否正被将军、以及 tier 全 0 时的走法数是否和
`js/rules.js` 一致，并打印敌我双方的子力估值。改关卡后跑一下。

`audit-rogue` 是改**走法等级**之后必跑的那个，它守一条不变量：

> `attacked(sq, by)` 必须和「`by` 的某个走法能到 `sq`」完全一致。

每一档升级都会同时加宽**走法生成**和 `attacked()` 两处，漏掉后一处就会出现
「炮正对着将却不算将军 → 可以把将吃掉 → 游戏不结束」这种死局。它还会顺带验证：

- 任何合法走法都不会吃掉将帅（吃掉说明前面某个将军判定漏了）
- tier 全 0 时 perft 仍是 44 / 1920 / 79666（引擎没坏）
- `chooseMove()` 不会改动手上那个局面（搜索超时会沿异常栈往上跳，跳过所有
  `unmake()`，所以它必须在副本上搜索）

## 外观

全部是原站「木质棋盘」主题的四层资源，按原站的堆叠方式组合：

| 层 | 原站资源 | 本地路径 |
|---|---|---|
| 底板（木纹） | `new-board/new-board-images/wooden-board-bg.svg` | `assets/board/wooden-board-bg.svg` |
| 棋盘线（含楚河漢界与 Xiangqi.com 水印） | `new-board/new-board-images/board-lines.svg` | `assets/board/board-lines.svg` |
| 棋子圆盘（红 `#BC3328` / 黑 `#333333`，带白色内环） | `new-board/new-board-images/red-wooden-piece-bg.svg`、`black-wooden-piece-bg.svg` | `assets/board/` |
| 棋子字形（书法楷体，纯白，viewBox 统一 40×44） | `new-board/cn-red-pieces-dark/`、`cn-black-pieces-dark/` | `assets/pieces/` |

原站源码里没有一张「棋子图片」——圆盘和字形是两个独立文件，靠 CSS 叠在一起；红方字分别是
帥仕相傌俥炮兵，黑方是將士象馬車砲卒。

尺寸也是照着原站量的（`/analysis/board` 的实际 DOM + 网页版截图逐像素比对）：棋子直径 =
0.9 个格距，字形用 `object-fit: fill` 填进「55% 宽 × 60.5% 高」的框里，所以 士/仕/兵/卒
不会被压成扁条，字墨宽度正好是圆盘的 0.54 倍（截图实测 32px / 59px）。走子动画同样是
0.35s `ease` 滑到目标点（原站 `piece-drag-container` 的 `transition: all 0.35s ease`）。
棋盘线里的 Xiangqi.com 水印已从本地 SVG 中删掉。角上 1–9 的坐标数字是 DOM 文本，不是图片。

## 结构

```
index.html            经典模式页面骨架
rogue.html            Roguelike 原型页面
styles.css            样式（两个模式共用）
rogue.css             Roguelike 追加样式
js/rules.js           走子规则引擎（从原站 bundle 提取，webpack module 759849）
js/engine.js          Pikafish 的 UCI 封装 + 11 级难度表
js/notation.js        中文着法记谱
js/app.js             经典模式界面与对局流程
js/rogue/xiangqi.js   Roguelike 用的规则引擎（tier 感知走法生成，独立实现）
js/rogue/ai.js        Roguelike 用的 alpha-beta AI
js/rogue/levels.js    8 个关卡的敌方布置 + 目标 + 补给 + par/金币 + AI 参数
js/rogue/run.js       run 状态（部队名册 / tiers / passives / 护甲 / 金币 / 道具）与局面合成、存档序列化
js/rogue/rewards.js   奖励目录、三选一抽取、被动表
js/rogue/shop.js      补给铺库存与购买
js/rogue/app.js       Roguelike 界面与对局流程
engine/               pikafish.worker.js / pikafish.js / pikafish.wasm / pikafish.data / db-classic.js
assets/board/*.svg          木纹底板、棋盘线、红/黑棋子圆盘
assets/pieces/*.svg         棋子字形（书法体，14 个）
assets/bots/*.svg           机器人头像
tools/validate-levels.mjs   关卡校验脚本
tools/audit-rogue.mjs       引擎一致性审计（attacked ↔ 走法、perft、AI 不写坏局面）
tools/smoke-rogue.mjs       无头跑通整局（用 ?debug=1 的句柄；需本地 :5173）
tools/smoke-roster.mjs      继承规则的无头检查（阵亡、悔棋、护甲回滚、奖励池）
tools/smoke-economy.mjs     经济与存档的无头检查（金币、商店、存读档、长将变招）
docs/rogue-prd.md           Roguelike 设计文档
server.js             零依赖静态服务器
```

## 关于规则引擎

`js/rules.js` 是原站主包里的象棋引擎原样抽出，接口与 chess.js 一致：

```
load(fen)  fen()  moves({square, verbose})  move(uci | {from,to})  undo()
in_check()  in_checkmate()  in_stalemate()  in_draw()  game_over()  perft(n)
```

它自己校验过：初始局面 `perft(1) = 44`、`perft(2) = 1920`。
FEN 的走子方用 `r` / `b`（不是 `w` / `b`），坐标是 ICCS（`a0`–`i9`，`a0` 为红方底线）。

注意两个坑：`load()` 必须给完整 6 段 FEN，否则静默失败；它还会校验局面可达性，
黑卒摆在 rank 7 以上、红兵摆在 rank 2 以下的 FEN 会被拒。另外它自带的 `perft()`
在 depth 3 有偏差（79446），要交叉验证请用 move/undo 手写递归（正确值 79666）。

## 关于 AI

`engine/` 里的五个文件是原站的同源 Pikafish（象棋版 Stockfish）。只在 `pikafish.worker.js`
里改了三处路径，让它相对 worker 自己找 `pikafish.wasm` / `pikafish.data`，其余原样。

难度表（`js/engine.js`）照抄原站：

| 等级 | 技能 | movetime | depth | MultiPV | 说明 |
|---|---|---|---|---|---|
| 1–2 | 0 | 1 ms | 1 | 5 / 2 | 取 MultiPV 最差的一手，故意走臭棋 |
| 3 | 0 | 1 ms | 1 | 1 | |
| 4–9 | 3…8 | 10–100 ms | 2–8 | 1 | 逐级加强 |
| 10 | 20 | 500 ms | 15 | 1 | |
| 11（Zen） | 20 | 12000 ms | 22 | 1 | 满强度，比原站最强档再高一层 |

提示功能用 `skill 20 / 1200 ms / depth 20`，也来自原站。
电脑落子前还有一层「最少思考停顿」：算完到落子之间至少 480 ms（`BOT_MIN_THINK_MS`），
快棋档也不会啪地一下拍子。

## 说明

- 不要把本项目部署到公网。
- 引擎是 GPLv3 的 Pikafish，若要分发请遵守其许可证并替换为自己的构建。
