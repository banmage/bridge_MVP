# Implementation Plan: 联网双人赛与贴点制对局（一期）

**Branch**: `001-online-pair-game` | **Date**: 2026-11-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-online-pair-game/spec.md`

## Summary

在现有「单机人机桥牌 MVP」之上增加联网对战层：新增 Node/TypeScript WebSocket 服务端作为**权威对局引擎**，
复用 `src/core`（法律）、`src/engine`（YAML 规则）、`src/ai`（机器人）与计分模块；前端新增大厅、房间、
在线牌桌、成绩与复盘界面，同时保留 `/solo` 单人入口。

一期交付：房间/座位/邀请码、AI 人格配置、12/18/24 副比赛、双人赛（MP 对照场）与贴点制两种计分、
服务端权威叫牌打牌、视角隔离、断线重连、逐副记录与落盘、成绩统计与单副复盘。

## Technical Context

**Language/Version**: TypeScript 5.7（前端 ES2022；服务端 Node.js 24 + `tsx`）

**Primary Dependencies**: Vue 3.5、Pinia 2、Vite 6、Element Plus 2、js-yaml（既有）；
新增 `ws`（WebSocket 服务端）、`tsx`（开发运行）、`concurrently`（并行开发脚本）、`@types/ws`（类型）

**Storage**: 文件系统 JSON（`server/data/matches/*.json`）；运行期内存态

**Testing**: Vitest（前端 happy-dom；服务端引擎 `environment: node`）

**Target Platform**: Linux/macOS 开发机；Node 24 服务端 + 现代浏览器

**Project Type**: Web（单仓库，前端 `src/` + 服务端 `server/` + 共享 `shared/`）

**Performance Goals**: 单房间 4 连接、广播 < 50ms；单进程支持 ≥ 200 并发房间（一期目标，压测不做硬门槛）

**Constraints**: 服务端权威、视角隔离、`seed` 可复现、记录完整可复盘、既有单人功能与测试不被破坏

**Scale/Scope**: 单桌 4 座；房间级并发；一期不做跨房间配对、观战大厅、数据库

### 关键技术决策

| 决策 | 选择 | 理由 | 备选与放弃原因 |
|------|------|------|----------------|
| 服务端形态 | 单进程 Node + `ws` | 复用同一套 TS 规则/AI，零语言切换；一期规模足够 | Socket.IO（重连/房间封装好但依赖重）；独立 Python 服务（规则需重写） |
| 状态同步 | 全量快照 + 动作意图 | 实现简单、抗丢包、便于重连；每帧数据 < 10KB | 增量补丁/CRDT（一期过度设计） |
| 视角裁剪 | 服务端按 `playerId` 生成 `RoomView` | 从根上防作弊 | 前端隐藏（违反宪法 II） |
| 规则加载 | `src/engine/parse.ts` 纯解析 + 服务端 `fs` 读取 | 浏览器与 Node 共用解析器 | 复制 YAML 解析逻辑（违反宪法 III） |
| 双人赛计分 | 同一发牌 7 桌机器人对照场 → MP% | 单桌也能给出名次与百分比，且可复现 | 只记 IMP（不满足「双人赛」）；DDS 双明手（依赖重） |
| 贴点制 | 复用 `hcpAdjustedPoints` | 与既有 MVP/帮助文档口径一致 | 重新定义（会破坏既有测试与文档） |
| 身份 | `playerId + token`（localStorage） | 免注册，满足重连 | 账号密码（一期无必要，增加安全面） |
| 路由 | `vue-router`：`/` 大厅、`/room/:code`、`/solo`、`/matches/:id` | 与单人页隔离，兼容既有测试 | 单页多弹窗（状态耦合严重） |

## Constitution Check

*GATE: 计划阶段通过；实现完成后复查。*

| 原则 | 落实方式 | 状态 |
|------|----------|------|
| I 服务端权威 | 所有 action 经 `server/match.ts` 校验；客户端无写状态能力 | ✅ |
| II 视角隔离 | `projectRoomView(room, playerId)` 单一出口；测试断言无泄漏 | ✅ |
| III 规则单点复用 | 服务端 import `src/core`、`src/engine/parse`、`src/ai` | ✅ |
| IV 全量可复盘 | `BoardRecord` 含 seed + 四手牌 + 叫牌 + 出牌 + 计分依据 | ✅ |
| V AI 同权 | `BotPersona` → `SeatStyle` + 规则集；动作走同一 `submitAction` | ✅ |
| VI 确定性 | 每副 `seed`、AI `rng`、对照场同种子；引擎可在无网络下测试 | ✅ |
| VII 增量交付 | 一期仅 MP/贴点；座位/模式枚举为二期留口 | ✅ |

无违反项，无需复杂度豁免。

## Project Structure

### Documentation (this feature)

```text
specs/001-online-pair-game/
├── spec.md                # 需求规格（已完成）
├── plan.md                # 本文件
├── research.md            # 决策记录
├── data-model.md          # 数据模型与视角投影
├── quickstart.md          # 本地联调手册
├── contracts/
│   ├── protocol.md        # WebSocket 报文契约
│   └── http-api.md        # HTTP 查询接口契约
└── tasks.md               # 任务清单
```

### Source Code (repository root)

```text
shared/
├── protocol.ts            # 客户端↔服务端报文类型（单一事实来源）
└── matchSchedule.ts       # 复式轮转表（庄家/局况）、比赛配置枚举

server/
├── index.ts               # HTTP + WebSocket 入口、静态资源、健康检查
├── room.ts                # 房间生命周期、座位、加入/离开、房主转移
├── match.ts               # 权威对局引擎（发牌/叫牌/出牌/结算/下一副）
├── reference.ts           # MP 对照场模拟（7 桌机器人）
├── personas.ts            # 机器人人格 → 风格 + 规则集 + 约定提醒
├── rules.ts               # Node 侧读取并缓存 YAML 规则
├── persistence.ts         # 比赛记录 JSON 落盘与查询
├── protocolHandlers.ts    # 报文集散、错误映射
├── view.ts                # 视角投影（RoomView / BoardView）
└── __tests__/
    ├── match.test.ts      # 法律/轮次/结算/幂等
    ├── view.test.ts       # 视角裁剪无泄漏
    ├── reference.test.ts  # MP 可复现
    └── room.test.ts       # 座位/加入/房主转移/机器人接管

src/
├── engine/parse.ts        # 纯 YAML 解析（loader 复用）
├── net/socket.ts          # 带重连的 WebSocket 客户端
├── store/online.ts        # Pinia 在线对局状态（快照 + 意图）
├── router.ts              # 路由表
├── views/
│   ├── LobbyView.vue      # 大厅：创建/加入/最近比赛
│   ├── RoomView.vue       # 房间：座位/人格/开赛/牌桌/成绩
│   └── SoloView.vue       # 原 App.vue 内容迁移
└── components/online/
    ├── SeatConfigPanel.vue
    ├── BotPersonaEditor.vue
    ├── OnlineTable.vue
    ├── BidPanel.vue
    ├── ScoreTable.vue
    └── BoardReplayDialog.vue
```

**Structure Decision**: 保持单仓库；服务端独立 `server/`（不打包进前端），共享代码通过 `shared/` 与
`src/core|engine|ai|models` 直接 import，由 `tsx` 运行时解析路径；前端通过 Vite 别名 `@shared` 引用协议类型。

## 实施阶段

1. **P0 共享层**：`engine/parse.ts` 拆分、`shared/protocol.ts`、`shared/matchSchedule.ts`。
2. **P1 对局引擎**：`server/match.ts`（发牌/叫牌/出牌/结算/记录）+ `reference.ts` + 单测。
3. **P1 房间与协议**：`server/room.ts`、`view.ts`、`persistence.ts`、`index.ts`、`protocolHandlers.ts`。
4. **P1 客户端**：`net/socket.ts`、`store/online.ts`、路由、大厅/房间/牌桌。
5. **P2 成绩与复盘**：成绩表、单副复放、历史比赛查询。
6. **P3 打磨**：大厅进行中比赛、重连提示、错误提示文案。

## 验收映射

| 规格 | 实现位置 | 测试 |
|------|----------|------|
| FR-001/006/027 | `server/room.ts`、`view.ts`、`store/online.ts` | `room.test.ts`、`protocolHandlers.test.ts`、`online.test.ts` |
| FR-002/005 | `server/room.ts`、`shared/protocol.ts` | `room.test.ts` |
| FR-003/004 | `server/room.ts`、`SeatConfigPanel.vue` | `room.test.ts` |
| FR-007 | `server/room.ts`、`server/protocolHandlers.ts` | `room.test.ts`、`protocolHandlers.test.ts` |
| FR-008..011 | `server/personas.ts`、`server/match.ts` | `match.test.ts` 人格/节奏 |
| FR-012/013 | `shared/matchSchedule.ts`、`server/match.ts` | `match.test.ts` 轮转/种子复现 |
| FR-014..016 | `server/match.ts` + `core/*` | `match.test.ts` 非法动作 |
| FR-017/018 | `server/match.ts`、`reference.ts` | `match.test.ts`、`reference.test.ts` |
| FR-020..023 | `server/persistence.ts`、`ScoreTable.vue`、`BoardReplayDialog.vue` | `match.test.ts` 记录完整性 |
| FR-024/025 | `server/view.ts` | `view.test.ts` |
| FR-026 | `src/views/SoloView.vue` | 既有 `src/**/*.test.ts` |

## Complexity Tracking

| 复杂度 | 必要性 | 缓解 |
|--------|--------|------|
| 新增服务端进程 | 联网刚需 | 复用共享法律层，服务端代码控制在 6 个模块 |
| 全量快照广播 | 重连与抗丢包 | 单帧 <10KB；副数上限 24 |
| 对照场模拟 | 单桌产生 MP | 7 桌全机器人、种子固定；每副一次性计算并缓存 |
