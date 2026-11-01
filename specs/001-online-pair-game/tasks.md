# Tasks: 联网双人赛与贴点制对局（一期）

**Feature**: `001-online-pair-game` | **Input**: [spec.md](./spec.md), [plan.md](./plan.md)

**测试说明**: 每个用户故事独立可验收。服务端引擎测试使用 `vitest --environment node`。

## Phase 1: Setup

- [x] T001 安装依赖 `ws`、`tsx`、`concurrently`、`@types/ws`，更新 `package.json` 脚本
- [x] T002 新增 `tsconfig.server.json`（Node 侧类型检查，含 `server/`、`shared/`、`src/core|engine|ai|models`）
- [x] T003 配置 `vite.config.ts` 代理 `/ws`（ws:true）与 `/api`，新增别名 `@shared`
- [x] T004 `.gitignore` 增加 `server/data/`、`*.log`

## Phase 2: 共享法律层（阻塞全部）

- [x] T005 抽出 `src/engine/parse.ts`（`parseBiddingRules`/`parseLeadRules`/校验），`loader.ts` 改为复用并 re-export
- [x] T006 新增 `shared/protocol.ts`：报文、`RoomView`/`BoardView`、错误码、`BotPersona`、`MatchConfig`
- [x] T007 新增 `shared/matchSchedule.ts`：16 副轮转表 + `scheduleFor(index)`，测试覆盖
- [x] T008 `src/engine/types.ts` 为 `BiddingRule` 增加可选 `tags?: string[]`（约定标签）

## Phase 3: 服务端权威引擎（US1/US3/US4）

- [x] T009 `server/rules.ts`：Node 读取/缓存叫牌与首攻 YAML
- [x] T010 `server/personas.ts`：人格 → 风格/规则集/约定提醒；标签过滤
- [x] T011 `server/match.ts`：`MatchEngine` 发牌、叫牌、出牌、结算、下一副、记录
- [x] T012 `server/match.ts`：AI 调度（延迟、串行、可取消、断线接管）
- [x] T013 `server/reference.ts`：7 桌对照场模拟（MP 模式）
- [x] T014 `server/__tests__/match.test.ts`：合法性/轮次/明手/流局/结算/幂等
- [x] T015 `server/__tests__/reference.test.ts`：对照场可复现、MP 百分比边界

## Phase 4: 房间、会话与协议（US1/US2/US3）

- [x] T016 `server/room.ts`：建房/加入/座位/房主转移/开始/离开/机器人接管
- [x] T017 `server/view.ts`：`projectRoomView` 视角投影（唯一出口）
- [x] T018 `server/view.test.ts`：四位视角无泄漏、明手时机、结算后才见四手牌
- [x] T019 `server/protocolHandlers.ts`：报文解析、错误映射、动作分发
- [x] T020 `server/index.ts`：HTTP + WS 服务、心跳、重复连接、静态托管、健康检查
- [x] T021 `server/persistence.ts`：JSON 落盘（原子写）+ `GET /api/matches*`
- [x] T022 `server/room.test.ts`：座位冲突/满员/开赛校验/重连/房主转移

## Phase 5: 客户端联机界面（US1..US4）

- [x] T023 `src/net/socket.ts`：WebSocket 客户端（自动重连、心跳、事件订阅）
- [x] T024 `src/store/online.ts`：Pinia 状态（快照、错误、聊天、意图提交）
- [x] T025 `src/router.ts` + `main.ts`：`/` 大厅、`/room/:code`、`/solo`、`/matches/:id`
- [x] T026 `src/views/SoloView.vue`：迁移原 `App.vue`，保留全部功能；更新 `App.test.ts`
- [x] T027 `src/views/LobbyView.vue`：昵称、创建、加入、进行中/最近比赛
- [x] T028 `src/views/RoomView.vue`：座位面板、机器人编辑、开赛、牌桌、成绩切换
- [x] T029 `src/components/online/OnlineTable.vue`：四座牌桌 + 明手 + 可点手牌
- [x] T030 `src/components/online/BidPanel.vue`：合法叫品网格、加倍/再加倍、提醒
- [x] T031 `src/components/online/SeatConfigPanel.vue` + `BotPersonaEditor.vue`
- [x] T032 `src/components/online/ScoreTable.vue`：逐副成绩、累计、胜负

## Phase 6: 记录与复盘（US5）

- [x] T033 `src/components/online/BoardReplayDialog.vue`：四手牌 + 叫牌 + 逐墩
- [x] T034 `src/views/MatchesView.vue`：历史比赛列表与详情入口
- [x] T035 成绩页接入复盘弹窗；MP 对照场展示

## Phase 7: 打磨与验收（US6）

- [x] T036 断线/重连提示、错误 toast、空位引导文案
- [x] T037 `README.md` 与 `docs/` 增补联网玩法与部署说明
- [x] T038 全量 `npm test`、`npm run typecheck`、`npm run typecheck:server`、`npm run build`
- [x] T039 手工联调：单人 3 机器人 12 副；双真人 + 2 机器人 12 副；断线重连
- [x] T040 规格/计划/记录一致性复查（宪法 Check）

## 依赖关系

- Phase 2 阻塞 Phase 3/5。
- T016..T018 可并行于 T019..T021（接口已在 `shared/protocol.ts` 冻结）。
- Phase 5 可在 T020 后用「本地内存假服务」先行开发。
- Phase 6 依赖 T013（对照场）与 T021（落盘）。

## 验收映射

| 用户故事 | 任务 |
|----------|------|
| US1 建房开赛 | T016, T019–T021, T027–T028 |
| US2 AI 人格 | T010, T016, T031 |
| US3 双真人对抗 | T017–T018, T022, T023–T024 |
| US4 实时叫牌打牌 | T011–T012, T029–T030 |
| US5 成绩与复盘 | T013, T021, T032–T035 |
| US6 大厅 | T027, T036 |

## 完成记录

- **自动化检查（2026-11-01）**：
  - `npm test`：33 个测试文件、**347 tests passed**（含服务端 `match/view/room/reference/persistence/protocolHandlers` 与共享 `matchSchedule`）。
  - `npm run typecheck`、`npm run typecheck:server`、`npm run build` 全部通过。
- **T039 手工联调**：
  - 单人 + 3 机器人：12 副完整跑通，成绩页与逐副复盘正常；
  - 双真人 + 2 机器人：12 副完整跑通，B 端断开后重连成功恢复东家视角与座位；
  - 比赛结束后 `GET /api/matches`、`GET /api/matches/:id` 均返回落盘记录，四手牌/叫牌/出牌完整；
  - 观察项：重连/终局瞬间偶发一次 `WRONG_PHASE`，已确认是旧快照的迟到动作；
    客户端在比赛已 `finished` 时忽略该提示，避免误导（`src/store/online.ts`）。
- **T040 宪法复查**：权威校验、视角隔离、规则单点复用、全量可复盘、AI 同权、确定性、增量交付均满足，
  与 `plan.md` 的 Constitution Check 一致。
