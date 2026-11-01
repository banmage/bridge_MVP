# Quickstart: 本地联调联网双人赛

**Feature**: `001-online-pair-game`

## 1. 安装

```bash
cd /home/jlx/projects/bridge_MVP
npm install
```

新增依赖：`ws`、`tsx`、`concurrently`、`@types/ws`。

## 2. 启动

```bash
npm run dev:all
# 等价于并行执行：
#   npm run dev         # Vite 前端 http://localhost:5173（/ws、/api 代理到 8787）
#   npm run dev:server  # 对局服务 http://localhost:8787
```

单独启动：

```bash
npm run dev:server   # 仅服务端（tsx watch）
npm run dev          # 仅前端
```

## 3. 单人验证（1 人 + 3 机器人）

1. 打开 `http://localhost:5173/`；
2. 输入昵称 → 「创建房间」→ 副数 12、模式「贴点制」→ 坐南家；
3. 依次把北/东/西设为机器人（可改名字、风险、体系、约定）；
4. 「开始比赛」→ 完成 12 副 → 查看成绩与复盘。

## 4. 双人验证（2 真人 + 各自 AI 同伴）

1. 浏览器 A：建房坐南，北家设为机器人；
2. 浏览器 B（隐身窗口）：输入房间码加入，选东家，西家设为机器人；
3. A 点「开始比赛」；双方各自只看到自己的手牌与公开信息；
4. B 关闭标签页 30s 后重新打开 → 大厅「回到牌桌」→ 恢复东家视角；
5. B 不回来且超过 `BOT_TAKEOVER_MS`（默认 60s）→ 东家由机器人接管，比赛继续。

## 5. 测试与检查

```bash
npm test                 # 前端 + 服务端引擎测试
npm run typecheck        # 前端类型检查
npm run typecheck:server # 服务端类型检查
npm run build            # 前端生产构建
```

生产模式（同端口托管前端 + API + WS）：

```bash
npm run build
npm start                # 默认 http://localhost:8787
```

## 6. 记录查询

```bash
curl -s localhost:8787/api/matches | jq
curl -s localhost:8787/api/matches/<id> | jq '.match.boards[0]'
```

落盘位置：`server/data/matches/<id>.json`（已被 `.gitignore` 忽略；可用 `MATCH_DATA_DIR` 覆盖）。
仅当比赛完整打完后写入，进行中的对局依靠客户端快照复盘。

## 7. 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `PORT` | `8787` | HTTP + WebSocket 端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `AI_DELAY_MS` | `700` | 机器人每次动作的思考延迟 |
| `AUTO_NEXT_MS` | `10000` | 结算后自动开下一副的等待时间 |
| `BOT_TAKEOVER_MS` | `60000` | 开赛后断线托管宽限期；`0` 关闭 |
| `MATCH_DATA_DIR` | `server/data/matches` | 比赛记录目录 |

## 8. 常见问题

- **前端连不上 `/ws`**：确认 `npm run dev:server`（或 `npm start`）已启动，端口与 `vite.config.ts` 代理一致。
- **重连后回到大厅**：`localStorage` 中 `bridge.playerId/token` 被清除，座位无法恢复（设计如此）。
- **多窗口互相踢下线**：同一身份以最新窗口为准，旧窗口会断开并停止重连；这是预期行为。
- **掉线太久座位变成机器人**：默认超过 `BOT_TAKEOVER_MS`（60s）未重连会托管；可调大该值或设为 0 关闭。
- **MP 百分比与朋友不一致**：对照场由 `seedBase` 决定；不同比赛不可比。
