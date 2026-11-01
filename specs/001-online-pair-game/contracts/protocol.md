# Contract: WebSocket 实时协议 v1

**Transport**: `ws://<host>/ws`，UTF-8 JSON 文本帧。
**Version**: `v: 1`（每条报文必带；服务端不兼容时关闭连接并发送 `error`）。

## 1. 连接与身份

客户端连接后首先发送 `hello`：

```json
{ "v": 1, "t": "hello", "playerId": "uuid", "name": "Alice", "token": "32hex" }
```

服务端回复：

```json
{ "v": 1, "t": "hello", "playerId": "uuid", "name": "Alice" }
```

规则：
- 首次出现的 `playerId` 绑定 `token`；后续重连必须匹配，否则 `AUTH_FAILED`。
- 重复连接（同一 `playerId` 已有活跃连接）：新连接生效，旧连接收到 `error{code:"DUPLICATE_SESSION"}` 后被关闭。
- 心跳：客户端每 20s 发送 `{ "v":1, "t":"ping" }`；服务端回 `pong`。服务端 60s 无消息视为断线。

## 2. 客户端 → 服务端

| `t` | 字段 | 说明 |
|-----|------|------|
| `hello` | `playerId,name,token` | 身份握手 |
| `setName` | `name` | 修改昵称 |
| `createRoom` | `config:{boards,scoring}, seat:Position` | 创建房间并坐入指定座位 |
| `joinRoom` | `code, seat?:Position` | 加入房间（座位可省略=自动选空位） |
| `leaveRoom` | — | 离开房间（开赛后触发机器人接管） |
| `setSeat` | `seat, occupant:{kind:'open'|'human'|'bot', persona?}` | 房主在 lobby 阶段配置座位 |
| `updateBot` | `seat, persona` | 房主修改机器人人格（lobby） |
| `setConfig` | `config:{boards,scoring}` | 房主修改配置（lobby） |
| `startMatch` | — | 房主开赛（要求 4 座占满） |
| `bid` | `call:BidCall, alert?:{text}` | 提交叫牌（仅自己座位） |
| `play` | `card:number` | 提交出牌（庄家可代打明手） |
| `nextBoard` | — | 房主/任一真人提前开始下一副（结算后 10s 自动开始） |
| `chat` | `text` | 房间聊天（≤200 字符） |
| `requestState` | — | 请求重发当前快照 |

## 3. 服务端 → 客户端

| `t` | 字段 | 说明 |
|-----|------|------|
| `hello` | `playerId,name` | 握手成功 |
| `room` | `room:RoomView` | **全量视角快照**（每次状态变更后推送） |
| `error` | `code,message` | 可读错误；`code` 见下表 |
| `toast` | `message,level?` | 非阻断提示（如「XX 已接管」） |

### 错误码

| code | 场景 |
|------|------|
| `AUTH_FAILED` | token 不匹配 |
| `DUPLICATE_SESSION` | 同身份重复连接 |
| `NOT_IN_ROOM` | 未加入房间却发送房间动作 |
| `NOT_HOST` | 非房主执行管理动作 |
| `ROOM_NOT_FOUND` | 房间码不存在/已销毁 |
| `ROOM_FULL` | 无空座位 |
| `SEAT_TAKEN` | 目标座位已被占用 |
| `WRONG_PHASE` | 当前状态不允许该动作 |
| `NOT_YOUR_TURN` | 不是该玩家的行动轮次 |
| `ILLEGAL_BID` | 叫品不合法（层级/加倍资格） |
| `ILLEGAL_PLAY` | 出牌不合法（跟牌义务等） |
| `SEATS_NOT_FULL` | 开赛时仍有空位 |
| `INVALID_CONFIG` | 副数/模式非法 |
| `BAD_REQUEST` | 报文格式错误 |

**语义**：任何 `error` 都必须保证对局状态未发生变更（校验先于提交）。

## 4. 示例

### 4.1 建房

```json
→ { "v":1, "t":"createRoom", "config":{"boards":18,"scoring":"hcp-points"}, "seat":"S" }
← { "v":1, "t":"room", "room":{ "code":"7K2M9Q", "status":"lobby", "hostId":"...", "you":{"playerId":"...","name":"Alice","seat":"S"}, "seats":{ "N":{"kind":"open"}, "E":{"kind":"open"}, "S":{"kind":"human","playerId":"...","name":"Alice","connected":true}, "W":{"kind":"open"} }, ... } }
```

### 4.2 配置机器人

```json
→ { "v":1, "t":"setSeat", "seat":"N", "occupant":{ "kind":"bot", "persona":{ "id":"bot-1", "name":"小满", "risk":"aggressive", "system":"natural", "conventions":["negative_double"], "randomness":0.15 } } }
← room 快照（seats.N.kind === "bot"）
```

### 4.3 叫牌与错误

```json
→ { "v":1, "t":"bid", "call":{"type":"bid","level":1,"suit":"NT"} }
← { "v":1, "t":"error", "code":"NOT_YOUR_TURN", "message":"当前轮到 W 叫牌" }
```

### 4.4 快照中的牌桌

```json
{ "v":1, "t":"room", "room":{ ..., "board":{ "index":1, "dealer":"N", "vulnerability":"none", "phase":"play", "currentBidder":"W", "nextPlayer":"E", "contract":{"level":3,"suit":"NT","doubled":false,"redoubled":false,"declarer":"S","dummy":"N"}, "bidding":[...], "tricks":[...], "currentTrick":[{"position":"S","card":51}], "yourSeat":"S", "yourHand":[12,25,...], "dummySeat":"N", "dummyHand":[3,7,...], "dummyOpen":true, "revealedHands":null, "canAct":false, "actingForSeat":null, "message":"E 出牌" } } }
```

## 5. 兼容与演进

- `v` 不匹配：服务端发送 `error{code:"BAD_REQUEST", message:"协议版本不支持"}` 并关闭。
- 新增可选字段不升版本；删除/改义字段必须升 `v`。
- 客户端必须忽略未知字段与未知 `t`（前向兼容）。
