import type { BidCall, BidRecord, BidSuit, CardPlay, Contract, Position, Trick } from '../src/models/gameState';

export type { BidCall, BidRecord, BidSuit, CardPlay, Contract, Position, Trick };

/** WebSocket / API 协议版本（不兼容变更时递增） */
export const PROTOCOL_VERSION = 1;

export type Vulnerability = 'none' | 'NS' | 'EW' | 'both';
export type RoomStatus = 'lobby' | 'playing' | 'finished';
export type ScoringMode = 'mp' | 'hcp-points';
export type BoardCount = 12 | 18 | 24;
export type Risk = 'conservative' | 'normal' | 'aggressive';
export type BiddingSystem = 'precision' | 'natural';
export type Side = 'NS' | 'EW';
/** 每一方（南北 / 东西）统一使用的叫牌体系 */
export type BiddingSystems = Record<Side, BiddingSystem>;
export type ConventionKey = 'strong_nt' | 'negative_double' | 'weak_two' | 'stayman' | 'transfer';

/** 系统默认使用精确叫牌法；同方同伴必须保持一致 */
export const DEFAULT_BIDDING_SYSTEMS: BiddingSystems = { NS: 'precision', EW: 'precision' };

/** 每张出牌至少展示的时长（联网与单机一致） */
export const PLAY_DISPLAY_MS = 1000;

export const CONVENTION_LABELS: Record<ConventionKey, string> = {
  strong_nt: '强无将（15-17）',
  negative_double: '负加倍',
  weak_two: '弱二开叫',
  stayman: '斯台曼问高花',
  transfer: '雅各比转移叫',
};

export const RISK_LABELS: Record<Risk, string> = {
  conservative: '保守',
  normal: '正常',
  aggressive: '激进',
};

export const BIDDING_SYSTEM_LABELS: Record<BiddingSystem, string> = {
  precision: '精确叫牌法',
  natural: '自然叫牌法',
};

export const SCORING_LABELS: Record<ScoringMode, string> = {
  mp: '双人赛（MP 对照场）',
  'hcp-points': '贴点制',
};

export const BOARD_COUNT_OPTIONS: BoardCount[] = [12, 18, 24];

/* ------------------------------------------------------------------ *
 * 人格 / 座位 / 房间
 * ------------------------------------------------------------------ */

export interface BotPersona {
  id: string;
  name: string;
  risk: Risk;
  system: BiddingSystem;
  conventions: ConventionKey[];
  /** 0..1 探索概率；0 = 完全确定（可复现） */
  randomness: number;
}

export const DEFAULT_PERSONA: Omit<BotPersona, 'id' | 'name'> = {
  risk: 'normal',
  system: 'precision',
  conventions: ['strong_nt', 'negative_double', 'weak_two', 'stayman', 'transfer'],
  randomness: 0.1,
};

export interface MatchConfig {
  boards: BoardCount;
  scoring: ScoringMode;
  /** 比赛种子基值：每副 seed = hash(seedBase, index) */
  seedBase: number;
  matchId: string;
  /** 每方叫牌体系（旧快照可能没有，缺省为精确） */
  systems?: BiddingSystems;
}

export type SeatOccupant =
  | { kind: 'open' }
  | { kind: 'human'; playerId: string; name: string; connected: boolean }
  | { kind: 'bot'; persona: BotPersona };

/** 客户端可见的座位信息（真人只暴露名字与在线状态，不暴露 token） */
export type SeatView = SeatOccupant;

export interface ChatMessage {
  id: string;
  at: number;
  from: string;
  seat: Position | null;
  text: string;
  /** 系统提示（房间解散、错误说明等），与玩家聊天区分显示 */
  system?: boolean;
}

/* ------------------------------------------------------------------ *
 * 对局视图（服务端按视角裁剪）
 * ------------------------------------------------------------------ */

export type BoardPhase = 'bidding' | 'play_waiting_lead' | 'play' | 'scored';

export interface BoardScoring {
  mode: ScoringMode;
  /** 带符号 IMP（NS 视角） */
  imp: number;
  /** 带符号点数（贴点制最终点数；MP 模式为 0） */
  points: number;
  hcp: { NS: number; EW: number };
  /** MP 模式：NS 视角百分比 0..100 */
  mpPercent?: number;
  /** MP 模式：对照场 NS 分数 */
  referenceResults?: number[];
}

export interface BoardView {
  index: number;
  dealer: Position;
  vulnerability: Vulnerability;
  phase: BoardPhase;
  currentBidder: Position;
  nextPlayer: Position | null;
  contract: Contract | null;
  bidding: BidRecord[];
  tricks: Trick[];
  currentTrick: CardPlay[];
  yourSeat: Position | null;
  yourHand: number[] | null;
  dummySeat: Position | null;
  dummyHand: number[] | null;
  dummyOpen: boolean;
  revealedHands: Record<Position, number[]> | null;
  score: { NS: number; EW: number } | null;
  scoring: BoardScoring | null;
  canAct: boolean;
  actingForSeat: Position | null;
  message: string;
}

export interface BoardSummary {
  index: number;
  contract: string | null;
  declarerTricks: number;
  score: { NS: number; EW: number };
  imp: number;
  points: number;
  mpPercent?: number;
}

export interface MatchResult {
  boardsPlayed: number;
  nsPoints: number;
  ewPoints: number;
  nsImps: number;
  nsMpPercent: number;
  winner: 'NS' | 'EW' | 'tie';
  perBoard: BoardSummary[];
}

export interface RoomView {
  code: string;
  status: RoomStatus;
  hostId: string;
  you: {
    playerId: string;
    name: string;
    seat: Position | null;
    /** 若原座位已被超时托管，给出可收回的座位（同一身份重连时自动收回） */
    reclaimableSeat?: Position | null;
    /** 当前座位是否开启了主动托管（AI 代打，座位仍归本人） */
    autoPlay?: boolean;
  };
  config: MatchConfig;
  seats: Record<Position, SeatView>;
  board: BoardView | null;
  completed: BoardSummary[];
  result: MatchResult;
  chat: ChatMessage[];
  /** 下一副自动开始时间（结算后），epoch ms */
  nextBoardAt: number | null;
  serverTime: number;
}

/* ------------------------------------------------------------------ *
 * 报文
 * ------------------------------------------------------------------ */

export type ErrorCode =
  | 'AUTH_FAILED'
  | 'DUPLICATE_SESSION'
  | 'NOT_IN_ROOM'
  | 'NOT_HOST'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'SEAT_TAKEN'
  | 'WRONG_PHASE'
  | 'NOT_YOUR_TURN'
  | 'ILLEGAL_BID'
  | 'ILLEGAL_PLAY'
  | 'SEATS_NOT_FULL'
  | 'INVALID_CONFIG'
  | 'BAD_REQUEST';

export interface RoomConfigInput {
  boards: BoardCount;
  scoring: ScoringMode;
  /** 每方叫牌体系；缺省保持房间当前设置（默认精确） */
  systems?: Partial<BiddingSystems>;
}

export type SeatInput = { kind: 'open' } | { kind: 'bot'; persona: BotPersona };

export type ClientMessage =
  | { v: number; t: 'hello'; playerId: string; name: string; token: string }
  | { v: number; t: 'setName'; name: string }
  | { v: number; t: 'createRoom'; config: RoomConfigInput; seat: Position }
  | { v: number; t: 'joinRoom'; code: string; seat?: Position }
  | { v: number; t: 'leaveRoom' }
  | { v: number; t: 'setSeat'; seat: Position; occupant: SeatInput }
  | { v: number; t: 'updateBot'; seat: Position; persona: BotPersona }
  | { v: number; t: 'setConfig'; config: RoomConfigInput }
  | { v: number; t: 'setAutoPlay'; enabled: boolean }
  | { v: number; t: 'startMatch' }
  | { v: number; t: 'bid'; call: BidCall; alert?: { text: string } }
  | { v: number; t: 'play'; card: number }
  | { v: number; t: 'nextBoard' }
  | { v: number; t: 'chat'; text: string }
  | { v: number; t: 'requestState' }
  | { v: number; t: 'ping' };

export type ServerMessage =
  | { v: number; t: 'hello'; playerId: string; name: string }
  | { v: number; t: 'room'; room: RoomView }
  | { v: number; t: 'error'; code: ErrorCode; message: string }
  | { v: number; t: 'toast'; message: string; level?: 'info' | 'warn' }
  | { v: number; t: 'pong' };

/* ------------------------------------------------------------------ *
 * 辅助
 * ------------------------------------------------------------------ */

export function isBoardCount(value: unknown): value is BoardCount {
  return value === 12 || value === 18 || value === 24;
}

export function isScoringMode(value: unknown): value is ScoringMode {
  return value === 'mp' || value === 'hcp-points';
}

export function isBiddingSystem(value: unknown): value is BiddingSystem {
  return value === 'precision' || value === 'natural';
}

/**
 * 合并每方体系设置：非法或缺失时保留 fallback（默认精确）。
 * 服务端与客户端共用，保证旧快照/旧配置也能得到稳定结果。
 */
export function normalizeBiddingSystems(
  input?: Partial<BiddingSystems> | null,
  fallback: BiddingSystems = DEFAULT_BIDDING_SYSTEMS,
): BiddingSystems {
  return {
    NS: isBiddingSystem(input?.NS) ? input.NS : fallback.NS,
    EW: isBiddingSystem(input?.EW) ? input.EW : fallback.EW,
  };
}
