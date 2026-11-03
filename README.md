# 桥牌游戏 MVP（人机对战 · 联网双人赛 · 可配置规则引擎）

按 `docs/` 下的《桥牌游戏 MVP 开发文档 V1.4》与《桥牌游戏 MVP 详细设计文档 V1.4》
落地的可运行实现。V3.0 文档已明确：**本阶段的编码规范以 MVP V1.4 为准**
（规则引擎契约、人类控制模型均已冻结）。

在一期联网功能（`specs/001-online-pair-game/`）中，同一套规则引擎被搬到 Node 服务端，
提供**服务端权威**的房间制对局：真人/AI 混坐、双人赛（MP 对照场）与贴点制计分、
视角隔离、断线重连、成绩统计与逐副复盘；原单人入口保留在 `/solo`。

## 玩法入口

| 路由 | 说明 |
|------|------|
| `/` | 大厅：创建房间、输入邀请码加入、查看最近比赛 |
| `/room/:code` | 房间：选座、配置机器人人格、开赛、牌桌与成绩 |
| `/solo` | 原单人模式（南家 + 3 机器人），功能与原 MVP 一致 |
| `/matches` | 历史比赛列表 |
| `/matches/:id` | 比赛详情与逐副复盘 |

### 单人模式（`/solo`）

- 用户坐 **南家**，北/东/西为机器人。
- **核心法律硬编码**（叫牌合法性、加倍/再加倍、跟牌义务、赢墩判定、标准计分）。
- **叫牌策略外部化**：YAML 规则 + 相对座位序列匹配 + 扁平 AND 条件 + 优先级/具体度裁决 + ε 探索。
- **首攻**由 YAML 规则驱动；跟牌/垫牌用硬编码启发式并实现防守信号约定（张数信号、不鼓励垫牌、有将无损失鼓励垫牌），约定文档见 `signals.yml`。
- 机器人可按座位配置 **叫牌风格 / 打牌风格（0 保守 / 1 正常 / 2 激进）** 与 **随机度 randomness**。
- **人类辅助**：叫牌卡按当前规则体系自动推荐并预选（不会自动提交），每个叫品悬停显示规则解释；
  出牌时用与座位指示一致的闪烁箭头标出系统推荐的合法牌。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | TypeScript + Vue 3 + Vue Router + Vite + Pinia |
| UI | Element Plus（辅助布局，牌桌自定义组件） |
| 服务端 | Node.js + TypeScript（`tsx`）+ `ws`（WebSocket） |
| 规则解析 | js-yaml（前端构建期内联；服务端 `fs` 读取同一份 YAML） |
| 测试 | Vitest（前端 happy-dom；服务端引擎 node 环境） |

## 快速开始

```bash
npm install

# 联机开发：Vite(5173) + 对局服务(8787) 并行
npm run dev:all

# 或分别启动
npm run dev          # 前端 http://localhost:5173（/ws、/api 代理到 8787）
npm run dev:server   # 对局服务 http://localhost:8787

npm run build        # 类型检查 + 生产构建（dist/）
npm start            # 生产模式：托管 dist/ + WebSocket + HTTP API
npm test             # 运行全部单元 / 集成测试
npm run typecheck        # 前端类型检查
npm run typecheck:server # 服务端类型检查
```

打开 `http://localhost:5173/` 进入大厅；`/solo` 仍是原单人模式。
生产模式下 `npm run build && npm start` 后直接访问 `http://localhost:8787/`。

## 目录结构

```
shared/                   # 前端与服务端共用的单一事实来源
├── protocol.ts           # WebSocket 报文、RoomView/BoardView、错误码、BotPersona
└── matchSchedule.ts      # 复式轮转表（庄家/局况）与比赛配置枚举

server/                   # 服务端（权威引擎，无浏览器依赖）
├── index.ts              # HTTP + WS 入口、静态托管、心跳、健康检查
├── room.ts               # 房间生命周期、座位、房主转移、机器人接管
├── match.ts              # 发牌/叫牌/出牌/结算/下一副（所有动作在此校验）
├── reference.ts          # MP 对照场：同副 7 桌机器人模拟
├── personas.ts           # 机器人人格 → 风格/规则集/约定提醒
├── rules.ts              # Node 侧读取并缓存 YAML 规则
├── view.ts               # 视角投影（唯一对外状态出口）
├── protocolHandlers.ts   # 报文解析、错误映射、动作分发
├── persistence.ts        # 比赛记录原子落盘与查询
└── __tests__/            # 引擎/房间/视角/持久化/协议测试

src/
├── core/                 # 桥牌核心法律（硬编码，不可配置）
│   ├── deck.ts           # 牌定义、洗牌（可播种）、发牌
│   ├── evaluate.ts       # 大牌点/控制点/花色长度/均型（修正 5-4-2-2、5-4-3-1）
│   ├── bidding/validator.ts  # 叫牌法律：层级、加倍/再加倍权限、动作合法性、parseAction
│   ├── bidding/hints.ts  # 叫品解释与推荐（复用规则匹配与 AI 候选排序）
│   ├── playing.ts        # 出牌法律（跟牌义务、合法牌生成）
│   ├── trick.ts          # 赢墩判定（beatsCard / determineTrickWinner）
│   └── scoring.ts        # 标准复式计分（含局况、满贯/成局、加倍/再加倍）
├── engine/               # 规则引擎（冻结接口）
│   ├── types.ts          # BiddingRule / LeadRule / ConditionSpec / StyleParams / STYLE_PARAMS
│   ├── parse.ts          # 纯 YAML 解析（前端 loader 与服务端共用）
│   ├── matcher.ts        # 相对座位序列匹配 + 候选匹配（含动作合法性过滤）
│   ├── conditions.ts     # 条件词表 + 风格变量替换 + 具体度
│   ├── loader.ts         # YAML 解析 + 规则文件注册表 + 本地覆盖（浏览/修改）
│   └── arbiter.ts        # mulberry32 随机源 + 优先级/具体度裁决 + ε 探索
├── rules/                # 策略规则（YAML，外部可替换）
│   ├── bidding/precision.yml  # 标准精确叫牌法（裁剪版，默认）
│   ├── bidding/natural.yml    # 自然叫牌法（备选，用于演示“可替换”）
│   └── play/{leads.yml, signals.yml}
├── ai/
│   ├── bidAI.ts          # 候选 → 裁决/探索 → 兜底 Pass
│   ├── playHint.ts       # 人类出牌推荐：固定种子复用 playAI，保证界面稳定
│   └── playAI.ts         # 首攻走 YAML；跟牌/垫牌启发式 + 信号约定；非法降级
├── models/               # card / hand / gameState（含 controllableSeats）
├── net/                  # WebSocket 客户端（自动重连、心跳、事件订阅）与 HTTP API
├── permissions.ts        # 用户角色与规则编辑权限（当前所有用户可改）
├── store/
│   ├── game.ts           # 单人 Pinia 状态机 + AI 调度 + 人类控制权 + 规则管理
│   └── online.ts         # 联机状态：服务端快照、意图提交、重连重进房间
├── router.ts             # 路由：/、/room/:code、/solo、/matches
├── views/                # LobbyView / RoomView / SoloView / MatchesView
├── components/           # Table / Hand / BiddingBox / ScoreBoard / GameHistory / RuleEditor
├── components/online/    # OnlineTable / OnlineSouthPlayed / SeatConfigPanel / ScoreTable / ...
├── testing/              # 测试辅助
├── App.vue               # 仅承载 <router-view />
└── main.ts
```

## 联网对战（一期）

### 房间与流程

1. 大厅输入昵称 → 「创建房间」，选择 **12 / 18 / 24 副** 与 **双人赛（MP）** 或 **贴点制**；
2. 房主占一座，其余座位可设为 **机器人**（可编辑名字、风险、体系、约定）或留空；
3. 其他真人通过 **邀请码** 加入并选空座；**四座填满后** 由房主「开始比赛」；
4. 比赛结束显示逐副成绩、累计 IMP/点数/MP%，并可打开任意一副复盘。

设备身份（`playerId + token`）保存在浏览器 `localStorage`，刷新或断线后自动用同一身份重连，
未开赛时可回到原座位；开赛后主动离开的座位立即由机器人接管，断线座位在
`BOT_TAKEOVER_MS`（默认 60 秒）后由机器人接管，保证比赛可以打完。因断线被接管的座位
仍保留收回权：原玩家用同一身份重连会自动收回座位，也可在牌桌提示条点「收回座位」；
主动离开则放弃收回权。同一身份在多个窗口打开时以最新连接为准，旧窗口会断开并停止自动重连。

人类辅助与单人模式一致：叫牌卡会按当前规则体系推荐并预选一个叫品（悬停可看解释，但不会自动提交），
轮到自己出牌时，与座位指示相同的闪烁箭头会贴在牌的中央侧（上家在下、下家在上、左右家朝向中央），
准确指向系统推荐的合法牌。轮到操作的座位若只剩唯一合法出牌，
系统会在上一张牌展示满 1 秒后自动打出，无需再点击。

当自己为明手时，可以看到同伴（庄家）的手牌；若同伴是 AI 机器人，自己会自动接管庄家，
控制两方出牌（轮到庄家或明手时都由自己操作）。房主可在牌桌顶部用「结束比赛」按钮
提前结束本场（需确认），房间会回到大厅并保留座位与配置，便于重新开始新的牌局。

牌桌右下角提供「托管」按钮：托管后由 AI 代你叫牌/出牌，座位与手牌仍保留，可随时「解除托管」。
系统默认使用精确叫牌体系；同一方（南北/东西）的两名玩家（含机器人）始终使用同一体系，
为一方机器人选择体系时，同伴会自动同步。

联网牌桌会按自己的座位自动旋转：自己始终在正下方、同伴在正上方，左右手与出牌区同步旋转；
聊天固定在左下角，叫品、历史叫牌与推荐出牌的说明统一通过悬停浮层显示。房间解散、连接异常、
动作被拒绝等服务端提示除顶部 toast 外，也会以“系统”消息写入聊天，避免一闪而过。

### 服务端权威与视角隔离

- 所有叫牌/出牌意图发到 `/ws`，由 `server/match.ts` 依据同一套 `src/core` 法律校验；
  非法动作返回错误码且 **不改变任何状态**。
- 服务端只通过 `server/view.ts::projectRoomView(room, playerId)` 向每个连接下发 `RoomView`：
  自己的手牌可见、明手在首攻后摊开、明手视角可看到同伴（庄家）手牌、其他手牌在结算前不可见；
  token 与发牌种子不会下发。
- 全量快照广播 + 动作意图，重连时重发当前快照即可恢复界面。

报文与错误码见 [`specs/001-online-pair-game/contracts/protocol.md`](specs/001-online-pair-game/contracts/protocol.md)，
HTTP 接口见 [`contracts/http-api.md`](specs/001-online-pair-game/contracts/http-api.md)。
完整的需求基线、计划、设计、编码规范、评审与运行手册见 [`docs/online-mvp/`](docs/online-mvp/README.md)。

### 机器人人格

每个机器人座位是一份 `BotPersona`：

| 字段 | 取值 | 作用 |
|------|------|------|
| `risk` | `conservative` / `normal` / `aggressive` | 映射为叫牌、打牌风格参数 |
| `system` | `precision` / `natural` | 选择 YAML 叫牌体系 |
| `conventions` | 强无将、负加倍、弱二、斯台曼、转移叫 | 按标签过滤约定规则 |
| `randomness` | `0..1` | ε 探索概率；`0` 完全确定可复现 |

机器人走与真人相同的 `bid` / `play` 校验路径（AI 同权），仅由服务端调度并带可配置延迟。

### 计分

- **双人赛（MP）**：每副用同一 `seed` 模拟 **7 桌机器人对照场**，把本桌 NS 得分换算为
  `0..100` 的 MP 百分比；对照场结果随记录保存，可复现。
- **贴点制**：复用单人模式的 `hcpAdjustedPoints`（`IMP − (胜方联手大牌点 − 20)`，流局按大牌点贴点），
  逐副累计为 `NS / EW` 点数与胜负。

两种模式的逐副明细都会写入比赛记录。

### 记录与 HTTP API

比赛 **完整打完** 后以 JSON 原子写入 `server/data/matches/<matchId>.json`
（可用 `MATCH_DATA_DIR` 改目录；目录已被 `.gitignore` 忽略）。

开赛后、未结束的房间会以原子写保存到 `server/data/rooms/<roomCode>.json`
（可用 `ROOM_DATA_DIR` 改目录）。进程重启时会自动恢复这些房间：客户端用原身份重连即可
回到牌桌；无人重连的座位在 `BOT_TAKEOVER_MS` 后由机器人接管，比赛继续完成。

| 接口 | 说明 |
|------|------|
| `GET /api/health` | 健康检查：版本、协议版本、房间数、运行时长 |
| `GET /api/match-schedule` | 16 副复式轮转表（庄家/局况） |
| `GET /api/matches?limit=10` | 最近比赛摘要 |
| `GET /api/matches/:id` | 单场比赛完整记录（含四手牌、叫牌、出牌、计分依据） |
| `GET /api/players/:playerId/matches?limit=10` | 某玩家的比赛 |

### 服务端环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `PORT` | `8787` | HTTP + WebSocket 端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `AI_DELAY_MS` | `700` | 机器人每次动作的思考延迟 |
| `AUTO_NEXT_MS` | `10000` | 一副结算后自动开下一副的等待时间 |
| `BOT_TAKEOVER_MS` | `60000` | 开赛后断线托管宽限期；`0` 表示关闭 |
| `MATCH_DATA_DIR` | `server/data/matches` | 比赛记录目录 |
| `ROOM_DATA_DIR` | `server/data/rooms` | 进行中房间快照目录 |

### 部署

```bash
npm ci
npm run build        # 产出 dist/
npm start            # 同端口托管 dist/、/api 与 /ws
```

- 单进程即可运行；反向代理（Nginx/Caddy）需把 `/ws` 按 **WebSocket upgrade** 转发到同一端口，
  并为 SPA 路由（`/room/*`、`/matches/*`）回退到 `index.html`。
- 服务端使用文件系统保存已结束比赛与进行中房间快照；进程重启会恢复未结束房间，
  客户端用原身份重连即可继续，无人重连的座位按 `BOT_TAKEOVER_MS` 托管。
- 健康检查：`GET /api/health`。

## 规则引擎契约（冻结）

### 序列 token（相对当前叫牌人）

`M`=自己 / `P`=同伴 / `L`=LHO（下一家）/ `R`=RHO（上一家）；
**从历史末尾对齐匹配**。特殊值：`^$` = 尚无实质叫品；`.*` = 任意（兜底）。

```yaml
- id: resp_1c_1d_negative
  sequence: "P:1C R:Pass"   # 同伴刚叫 1C、RHO 刚 Pass（相对座位，可识别敌方干扰）
  when: { hcp: "0-7" }
  action: "1D"
  priority: 90
```

### 条件词表（扁平 AND，可含风格变量）

`hcp` / `controls`（A=2 K=1）/ `spades|hearts|diamonds|clubs`（长度）/
`balanced`（4-3-3-3 / 4-4-3-2 / 5-3-3-2）；区间支持 `"16-40"`、`"5+"`、`"12"`，
可引用 `${open1ntMin}`、`${overcallMinHcp}` 等风格阈值。

### 裁决与探索

候选先经 **序列匹配 + 条件 + 动作合法性** 过滤，再按
**优先级↓ → 条件具体度↓ → 声明顺序** 稳定排序。
`randomness=0` 严格取最优；`>0` 以一定概率在“次优但有依据”的候选中偏离，
**绝不产生非法动作**，随机源由 `rngSeed`（mulberry32）播种，可复现。

## 人类控制模型

- `humanSeats = ['S']`；`controllableSeats(state)` 动态计算：
  - 人类所在方为定约方 → `[declarer, dummy]`（覆盖“南做庄/北明手”与“南明手/北做庄”）；
  - 人类为防守方 → `['S']`。
- 首攻落地后明手立即摊牌；仅轮到可控座位时手牌可点击；`isAiThinking` 期间禁用交互。
- 人类叫牌**仅受法律约束**，可自由诈叫。

## 计分约定

采用标准复式计分，得分归“赢分方”、另一方为 0；`doubled` 与 `redoubled` 互斥。

> 与设计文档 3.6 的一处差异：设计文档示例将“加倍/再加倍礼貌奖分”统一记为 +50；
> 本实现按标准规则取 **加倍 +50 / 再加倍 +100**，以保证计分正确（其余算法一致）。

### 计点胜负（分类德贴点制，默认开启）

“计点”汇总在标准 IMP 基础上按**经典贴点制**折算，本副最终点数：

```
本副点数 = IMP −（胜方联手大牌点 − 20）
```

- “胜方”＝本副得分方（成约则定约方，宕墩则防守方）；全副 40 点，故 `胜方点 − 20`
  等于双方大牌点差的一半；
- 结果**可为负**：拿高牌方若只赢到少量 IMP 会被倒扣，鼓励低点进局/进贯；
- **流局（四家 Pass，无得分方）**：改由大牌点多的一方贴点给少的一方，
  `本副点数 = 20 − 南北大牌点`（即点少方得正、点多方得负）；
- 逐副折算后按 `roundSize`（8 或 16 副）累加为循环内的 `NS / EW 累计点数` 与
  `总点数差（计点胜负）`。

贴点依据的双方大牌点会随对局一并归档（`DealRecord.hcp`），因此在
ScoreBoard 关闭“贴点制”开关后，历史与累计点数可即时回退为纯 IMP。

> 完整的贴点公式、示例与流局规则见 **`docs/帮助文档.md`**。

## 规则浏览与修改

页面顶部 **“规则管理”** 打开规则窗口，可浏览并修改两类细则：

- **叫牌规则**（`rules/bidding/*.yml`）：`id / description / sequence / when / action / priority`；
- **打牌规则（首攻）**（`rules/play/leads*.yml`）：`id / description / contract_type / role / when / lead / priority`。

> 首攻规则可通过 YAML 浏览/修改；跟牌张数信号（偶数先大后小）、无将/有将垫牌约定为
> `ai/playAI.ts` 中的启发式，约定说明见 `rules/play/signals.yml` 与 `docs/帮助文档.md`。

“浏览细则”以表格按优先级展示规则；“编辑源码”可直接修改 YAML，保存前做语法与必备字段校验，
校验通过后写入浏览器本地覆盖层（`localStorage`，并以内存为权威副本），立即应用到 AI，
刷新后仍生效；“恢复默认”可清除本地覆盖。覆盖逻辑位于 `engine/loader.ts`，与内置 YAML 解耦。

**权限**：当前阶段所有用户均可编辑；`src/permissions.ts` 的 `RULES_ADMIN_ONLY` 置为 `true`
即可切换为“仅系统管理员可修改，普通用户只读”。详见 `docs/帮助文档.md`。

## 验收用例对照

| # | 用例 | 覆盖位置 |
|---|------|----------|
| 1 | 发牌与排序 | `core/deck`、`models/hand`、`store/game.test` |
| 2 | 叫牌面板禁用 | `BiddingBox.vue`（`isCallLegal`） |
| 3 | 人类诈叫 | `store.humanBid`、`store/game.test` |
| 4 | AI 合规叫牌 | `engine/matcher`（动作合法性过滤）、`ai/bidAI.test` |
| 5 | 四家 Pass 流局 | `store.checkBiddingEnd`、`store/game.test` |
| 6 | 叫牌正常结束 | `store.checkBiddingEnd`/`setContractAndStartPlay` |
| 7 | 加倍/再加倍法律 | `core/bidding/validator(.test)` |
| 8 | 序列干扰识别 | `engine/matcher(.test)`（相对座位 token） |
| 9 | 兜底与开叫匹配 | `rules/bidding/precision.yml`、`ai/bidAI.test` |
| 10 | 风格生效 | `engine/types.STYLE_PARAMS`、`conditions` 变量替换 |
| 11 | 随机性可复现 | `engine/arbiter`、`ai/bidAI.test` |
| 12 | 首攻规则 + AI 叫牌延迟 | `ai/playAI`、`store.AI_DELAY_MS` |
| 13 | 明手摊牌时机 | `store.applyPlay`、`store/game.test` |
| 14/15 | 南做庄 / 南明手 | `models/gameState.controllableSeats`、`store/game.test` |
| 16 | 跟牌合法性 | `core/playing(.test)` |
| 17 | 赢墩判定 | `core/trick(.test)` |
| 18 | 计分正确 | `core/scoring(.test)` |
| 19 | 规则文件可替换 | `engine/loader`、`store.setBiddingRuleFile` |
| 20 | 新一局重置 | `store.startNewGame`、`store/game.test` |

## 后续扩展预留（不在 MVP 范围）

嵌套布尔条件（all/any/none）、候选打分模型、规则冲突检测与版本管理、知识库/自进化、
双明手求解器（DDS）、声称/摊牌、跨房间配对/观战大厅/数据库持久化、移动端（Flutter）。
`engine/types.ts` 与 `SignalRule` 等接口已为这些方向预留扩展位。
