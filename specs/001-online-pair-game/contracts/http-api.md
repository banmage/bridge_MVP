# Contract: HTTP 接口 v1

服务端与前端同源提供 `/api`；开发期由 Vite 代理到 `http://localhost:8787`。

## GET /api/health

```json
{ "ok": true, "version": "1.0.0", "rooms": 3, "uptimeSec": 128 }
```

## GET /api/match-schedule

返回复式轮转表（供前端展示/测试对齐）。

```json
{ "boards": [ { "index": 1, "dealer": "N", "vulnerability": "none" }, ... ] }
```

## GET /api/matches?limit=10

最近完成的比赛摘要：

```json
{
  "matches": [
    {
      "id": "m_8f3a...",
      "finishedAt": 1761999999999,
      "config": { "boards": 12, "scoring": "mp" },
      "players": ["Alice", "小满", "Bob", "WestBot"],
      "result": { "boardsPlayed": 12, "nsMpPercent": 57.1, "nsPoints": 0, "winner": "NS" }
    }
  ]
}
```

## GET /api/matches/:id

完整比赛记录（与落盘 JSON 同构）：

```json
{
  "schemaVersion": 1,
  "match": { "...": "MatchRecord" }
}
```

- `404`：不存在。
- 该接口只提供已完成比赛的公开记录（本副结束后手牌即为公开信息）。

## GET /api/players/:playerId/matches?limit=10

某设备身份参与过的比赛摘要（用 `playerId` 查询，返回不含 token 的摘要）。

## 静态资源

- 生产模式：服务端直接托管 `dist/`（SPA fallback 到 `index.html`）。
- 开发模式：仅提供 `/api` 与 `/ws`，页面由 Vite 提供。
