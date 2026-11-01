# Data Model: 联网双人赛（一期）

**Feature**: `001-online-pair-game` | **Date**: 2026-11-01

所有类型以 `shared/protocol.ts` 为单一事实来源（下文为设计说明，实现以代码为准）。

## 1. 身份与房间

### Player

| 字段 | 类型 | 说明 |
|------|------|------|
| `playerId` | string (uuid) | 客户端生成并持久化 |
| `name` | string | 昵称，1–20 字符 |
| `token` | string | 本机重连令牌（服务端校验） |
| `lastSeenAt` | number | 最近心跳时间 |

### Room

| 字段 | 类型 | 说明 |
|------|------|------|
| `code` | string | 6 位 `[A-Z0-9]` |
| `hostId` | string | 房主 `playerId` |
| `status` | `'lobby' \| 'playing' \| 'finished'` | |
| `config` | `MatchConfig` | 开赛后冻结 |
| `seats` | `Record<Position, Seat>` | N/E/S/W |
| `match` | `Match \| null` | |
| `createdAt` / `updatedAt` | number | |

### Seat

```ts
type Seat =
  | { kind: 'open' }
  | { kind: 'human'; playerId: string; name: string; connected: boolean }
  | { kind: 'bot'; persona: BotPersona };
```

### BotPersona

```ts
interface BotPersona {
  id: string;              // 房内唯一
  name: string;            // 1–16 字符
  risk: 'conservative' | 'normal' | 'aggressive';
  system: 'precision' | 'natural';
  conventions: ConventionKey[]; // 'strong_nt' | 'negative_double' | 'weak_two' | 'stayman' | 'transfer'
  randomness: number;      // 0..1，默认 0.1
}
```

### MatchConfig

```ts
interface MatchConfig {
  boards: 12 | 18 | 24;
  scoring: 'mp' | 'hcp-points';
  matchId: string;
  seedBase: number;        // 用于派生每副 seed
}
```

## 2. 对局

### Match

```ts
interface Match {
  id: string;
  config: MatchConfig;
  boardIndex: number;        // 1..boards
  boards: BoardRecord[];      // 已完成
  current: BoardRecord | null;
  status: 'playing' | 'finished';
  startedAt: number;
  finishedAt?: number;
  result: MatchResult;
}
```

### BoardRecord（完整记录，落盘）

```ts
interface BoardRecord {
  index: number;                 // 1 起
  seed: number;
  dealer: Position;
  vulnerability: 'none' | 'NS' | 'EW' | 'both';
  hands: Record<Position, number[]>;      // 发牌快照（13×4）
  bidding: BidRecord[];
  tricks: Trick[];
  currentTrick: CardPlay[];
  contract: Contract | null;
  declarerTricks: number;        // 定约方赢墩
  phase: 'bidding' | 'play' | 'scored';
  score: { NS: number; EW: number };
  scoring: BoardScoring;
  referenceResults?: number[];   // MP 模式的 7 桌 NS 分数
}
```

### BoardScoring

```ts
interface BoardScoring {
  mode: 'mp' | 'hcp-points';
  imp: number;              // 带符号，NS 视角
  points: number;           // 贴点制最终点数（带符号）
  hcp: { NS: number; EW: number };
  mpPercent?: number;       // 0..100（NS 视角）
  referenceResults?: number[];
}
```

### Trick / CardPlay / BidRecord / Contract

复用 `src/models/gameState.ts`（不重复定义），协议序列化时按原结构传输。

## 3. 视角投影（服务端 → 客户端）

```ts
interface RoomView {
  code: string;
  status: RoomStatus;
  hostId: string;
  you: { playerId: string; name: string; seat: Position | null };
  config: MatchConfig;
  seats: Record<Position, SeatView>;   // 机器人人格公开；真人只暴露名字与在线状态
  board: BoardView | null;
  completed: BoardSummary[];          // 已完成副的摘要
  result: MatchResult;
  chat: ChatMessage[];                // 最近 50 条
  serverTime: number;
}

interface BoardView {
  index: number;
  dealer: Position;
  vulnerability: Vulnerability;
  phase: 'bidding' | 'play_waiting_lead' | 'play' | 'scored';
  currentBidder: Position;
  nextPlayer: Position | null;
  contract: Contract | null;
  bidding: BidRecord[];
  tricks: Trick[];
  currentTrick: CardPlay[];
  yourSeat: Position | null;
  yourHand: number[] | null;          // 仅自己的手牌
  dummySeat: Position | null;
  dummyHand: number[] | null;         // 首攻后
  dummyOpen: boolean;
  revealedHands: Record<Position, number[]> | null; // 仅 scored 后
  score: { NS: number; EW: number } | null;
  scoring: BoardScoring | null;
  canAct: boolean;                    // 该玩家此刻是否可提交动作
  actingForSeat: Position | null;     // 需要提交动作的座位（可能为明手，由庄家代打）
  message: string;
}
```

### 投影不变量（必须由测试保证）

1. `yourHand` 只含 `yourSeat` 的牌；`yourSeat === null` 时为 `null`。
2. `dummyHand` 仅在 `dummyOpen` 为真时存在。
3. `revealedHands` 仅在 `phase === 'scored'` 时存在，且四手各 13 张。
4. `BoardView` 不含 `seed`；`RoomView` 不含他人 `playerId` 以外的敏感字段。

## 4. 成绩

```ts
interface MatchResult {
  boardsPlayed: number;
  nsPoints: number;        // 贴点制累计（NS 视角，带符号）
  ewPoints: number;
  nsImps: number;
  nsMpPercent: number;     // MP 模式平均百分比
  winner: 'NS' | 'EW' | 'tie';
  perBoard: BoardSummary[];
}

interface BoardSummary {
  index: number;
  contract: string | null;   // 例如 "S 3NT×2"
  declarerTricks: number;
  score: { NS: number; EW: number };
  imp: number;
  points: number;
  mpPercent?: number;
}
```

## 5. 状态机

```text
room:   lobby ──start──▶ playing ──last board──▶ finished
board:  bidding ──3 passes after bid──▶ play_waiting_lead ──lead──▶ play
        bidding ──4 passes────────────▶ scored
        play ──13th trick──────────────▶ scored
        scored ──next──▶ (下一副 bidding | 比赛 finished)
```

## 6. 校验不变量

- 叫牌：`currentBidder === seat`、`isCallLegal(history, currentBid, seat, call)`、机器人不可由客户端代叫。
- 出牌：`nextPlayer === seat`；若 `seat === dummy`，提交者必须是庄家的 `playerId`；`isCardLegal(...)`。
- 结算：`phase === 'scored'` 后禁止任何动作。
- 幂等：重复 `startBoard(index)` 不重新发牌；重复提交同一动作因轮次已前进而拒绝。
