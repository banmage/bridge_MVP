import type {
  BidCall,
  BidRecord,
  BidSuit,
  CardPlay,
  Contract,
  Position,
  Trick,
} from '../src/models/gameState';
import { getPartner, getSide, nextPosition } from '../src/models/gameState';
import type { Hand } from '../src/models/hand';
import { sortHand } from '../src/models/hand';
import { createDeck, deal, shuffle } from '../src/core/deck';
import { hcp } from '../src/core/evaluate';
import { isCallLegal } from '../src/core/bidding/validator';
import { biddingOutcome, findDeclarer } from '../src/core/bidding/auction';
import { isCardLegal } from '../src/core/playing';
import { determineTrickWinner } from '../src/core/trick';
import { computeScore } from '../src/core/scoring';
import { hcpAdjustedPoints, impsFromScoreDiff } from '../src/core/imps';
import { makeRng } from '../src/engine/arbiter';
import { playAI } from '../src/ai/playAI';
import { boardSeed, scheduleFor } from '../shared/matchSchedule';
import type {
  BoardPhase,
  BoardScoring,
  BoardSummary,
  BotPersona,
  ErrorCode,
  MatchConfig,
  MatchResult,
  Vulnerability,
} from '../shared/protocol';
import { describeContract } from '../shared/format';
import { botBid, leadsForPersona, styleOf } from './personas';

/** 服务端对局错误：携带协议错误码，便于直接回给客户端 */
export class MatchError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MatchError';
  }
}

export interface EngineSeat {
  kind: 'human' | 'bot';
  playerId?: string;
  name: string;
  persona?: BotPersona;
}

export interface BoardState {
  index: number;
  seed: number;
  dealer: Position;
  vulnerability: Vulnerability;
  /** 发牌快照（不随出牌变化） */
  allHands: Record<Position, Hand>;
  /** 剩余手牌（出牌会消耗） */
  hands: Record<Position, Hand>;
  bidding: BidRecord[];
  currentBid: { level: number; suit: BidSuit } | null;
  doubleState: 'none' | 'double' | 'redouble';
  currentBidder: Position;
  contract: Contract | null;
  tricks: Trick[];
  currentTrick: CardPlay[];
  trickLeader: Position | null;
  nextPlayer: Position | null;
  dummyOpen: boolean;
  phase: BoardPhase;
  score: { NS: number; EW: number };
  scoring: BoardScoring | null;
  declarerTricks: number;
  message: string;
  lastPlayAt: number;
}

export interface BoardRecord {
  index: number;
  seed: number;
  dealer: Position;
  vulnerability: Vulnerability;
  hands: Record<Position, Hand>;
  bidding: BidRecord[];
  tricks: Trick[];
  currentTrick: CardPlay[];
  contract: Contract | null;
  declarerTricks: number;
  phase: BoardPhase;
  score: { NS: number; EW: number };
  scoring: BoardScoring;
}

export interface ReferenceInput {
  hands: Record<Position, Hand>;
  dealer: Position;
  vulnerability: Vulnerability;
  seed: number;
  index: number;
}

export type MatchStatus = 'idle' | 'playing' | 'finished';

export interface MatchEngineOptions {
  config: MatchConfig;
  seats: Record<Position, EngineSeat>;
  /** MP 模式的对照场：由调用方注入（见 server/reference.ts） */
  referenceScores?: (input: ReferenceInput) => number[];
  /** 测试用：固定 AI 随机源 */
  rngFactory?: (seed: number) => () => number;
}

/** 进行中比赛的可落盘快照（不含任何仅存于内存的闭包） */
export interface MatchEngineSnapshot {
  config: MatchConfig;
  seats: Record<Position, EngineSeat>;
  board: BoardState | null;
  completed: BoardRecord[];
  status: MatchStatus;
  startedAt: number;
  finishedAt: number | null;
  /** mulberry32 内部状态；自定义随机源可能为 null */
  rngState: number | null;
}

const SIMPLE_ORDER: Position[] = ['N', 'E', 'S', 'W'];

function deepCopy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** 对照场比较：返回 NS 视角 MP 百分比（0..100） */
export function matchpointPercent(nsScore: number, referenceScores: number[]): number {
  if (referenceScores.length === 0) return 50;
  let earned = 0;
  for (const ref of referenceScores) {
    if (nsScore > ref) earned += 1;
    else if (nsScore === ref) earned += 0.5;
  }
  return Math.round((earned / referenceScores.length) * 1000) / 10;
}

export class MatchEngine {
  readonly config: MatchConfig;
  seats: Record<Position, EngineSeat>;
  board: BoardState | null = null;
  completed: BoardRecord[] = [];
  status: MatchStatus = 'idle';
  startedAt = Date.now();
  finishedAt: number | null = null;

  private readonly referenceScores?: (input: ReferenceInput) => number[];
  private readonly rngFactory: (seed: number) => () => number;
  private rng: () => number = Math.random;
  private finalized = false;

  constructor(opts: MatchEngineOptions) {
    this.config = opts.config;
    this.seats = opts.seats;
    this.referenceScores = opts.referenceScores;
    this.rngFactory = opts.rngFactory ?? makeRng;
  }

  /** 生成可 JSON 落盘的完整快照（含当前副、已完成副与 AI 随机状态） */
  snapshot(): MatchEngineSnapshot {
    return {
      config: deepCopy(this.config),
      seats: deepCopy(this.seats),
      board: this.board ? deepCopy(this.board) : null,
      completed: deepCopy(this.completed),
      status: this.status,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      rngState: readRngState(this.rng),
    };
  }

  /** 从快照恢复引擎；随机源从当前副 seed 重建后回填状态 */
  static restore(
    snapshot: MatchEngineSnapshot,
    opts: {
      referenceScores?: (input: ReferenceInput) => number[];
      rngFactory?: (seed: number) => () => number;
    } = {},
  ): MatchEngine {
    if (!snapshot || !snapshot.config || !snapshot.seats) {
      throw new Error('比赛快照不完整');
    }
    const engine = new MatchEngine({
      config: deepCopy(snapshot.config),
      seats: deepCopy(snapshot.seats),
      ...(opts.referenceScores ? { referenceScores: opts.referenceScores } : {}),
      ...(opts.rngFactory ? { rngFactory: opts.rngFactory } : {}),
    });
    engine.board = snapshot.board ? deepCopy(snapshot.board) : null;
    engine.completed = deepCopy(snapshot.completed ?? []);
    engine.status = snapshot.status;
    engine.startedAt = snapshot.startedAt;
    engine.finishedAt = snapshot.finishedAt ?? null;
    engine.finalized = engine.board?.phase === 'scored';
    if (engine.board) {
      engine.rng = engine.rngFactory(engine.board.seed);
      if (snapshot.rngState !== null && snapshot.rngState !== undefined) {
        writeRngState(engine.rng, snapshot.rngState);
      }
    }
    return engine;
  }

  /* ---------------------------------------------------------------- *
   * 生命周期
   * ---------------------------------------------------------------- */

  start(): BoardState {
    if (this.status !== 'idle') throw new MatchError('WRONG_PHASE', '比赛已经开始');
    this.status = 'playing';
    return this.startBoard(1);
  }

  startBoard(
    index: number,
    fixed?: {
      seed?: number;
      hands?: Record<Position, Hand>;
      dealer?: Position;
      vulnerability?: Vulnerability;
    },
  ): BoardState {
    if (this.status === 'finished') throw new MatchError('WRONG_PHASE', '比赛已经结束');
    if (index < 1 || index > this.config.boards) {
      throw new MatchError('INVALID_CONFIG', `副号超出范围：${index}`);
    }
    if (this.board && this.board.phase !== 'scored') {
      throw new MatchError('WRONG_PHASE', '当前副尚未结算');
    }
    const schedule = scheduleFor(index);
    const dealer = fixed?.dealer ?? schedule.dealer;
    const vulnerability = fixed?.vulnerability ?? schedule.vulnerability;
    const seed = fixed?.seed ?? boardSeed(this.config.seedBase, index);
    this.rng = this.rngFactory(seed);

    let hands: Record<Position, Hand>;
    if (fixed?.hands) {
      hands = {
        N: [...fixed.hands.N],
        E: [...fixed.hands.E],
        S: [...fixed.hands.S],
        W: [...fixed.hands.W],
      };
    } else {
      const deck = shuffle(createDeck(), this.rng);
      hands = deal(deck);
    }
    const sorted: Record<Position, Hand> = {
      N: sortHand(hands.N),
      E: sortHand(hands.E),
      S: sortHand(hands.S),
      W: sortHand(hands.W),
    };

    this.finalized = false;
    this.board = {
      index,
      seed,
      dealer,
      vulnerability,
      allHands: deepCopy(sorted),
      hands: deepCopy(sorted),
      bidding: [],
      currentBid: null,
      doubleState: 'none',
      currentBidder: dealer,
      contract: null,
      tricks: [],
      currentTrick: [],
      trickLeader: null,
      nextPlayer: null,
      dummyOpen: false,
      phase: 'bidding',
      score: { NS: 0, EW: 0 },
      scoring: null,
      declarerTricks: 0,
      message: `第 ${index} 副开始：庄家 ${dealer}`,
      lastPlayAt: 0,
    };
    this.status = 'playing';
    return this.board;
  }

  /** 结算后进入下一副；返回 null 表示比赛已结束 */
  nextBoard(): BoardState | null {
    if (!this.board) throw new MatchError('WRONG_PHASE', '尚未开始');
    if (this.board.phase !== 'scored') throw new MatchError('WRONG_PHASE', '当前副尚未结算');
    if (this.status === 'finished') return null;
    return this.startBoard(this.board.index + 1);
  }

  /* ---------------------------------------------------------------- *
   * 叫牌
   * ---------------------------------------------------------------- */

  submitBid(playerId: string, call: BidCall, alert?: { text: string }): void {
    const board = this.requireBoard();
    if (board.phase !== 'bidding') throw new MatchError('WRONG_PHASE', '当前不在叫牌阶段');
    const seat = board.currentBidder;
    this.assertHumanControls(playerId, seat, '叫牌');
    this.applyBid(seat, call, alert);
  }

  private applyBid(seat: Position, call: BidCall, alert?: { text: string }): void {
    const board = this.requireBoard();
    if (!isCallLegal(board.bidding, board.currentBid, seat, call)) {
      throw new MatchError('ILLEGAL_BID', '该叫品不合法');
    }
    const record: BidRecord = { position: seat, call, ...(alert ? { alerted: true, alertText: alert.text } : {}) };
    board.bidding.push(record);
    if (call.type === 'bid') {
      board.currentBid = { level: call.level, suit: call.suit };
      board.doubleState = 'none';
    } else if (call.type === 'double') {
      board.doubleState = 'double';
    } else if (call.type === 'redouble') {
      board.doubleState = 'redouble';
    }
    board.currentBidder = nextPosition(seat);
    board.message = `${seat} ${describeBid(call)}`;

    const outcome = biddingOutcome(board.bidding, board.currentBid);
    if (outcome === 'passed_out') {
      board.phase = 'scored';
      board.score = { NS: 0, EW: 0 };
      board.message = '四家不叫，本副流局';
      this.finalizeBoard();
      return;
    }
    if (outcome === 'contract') {
      const declarer = findDeclarer(board.bidding, board.currentBid!);
      if (declarer) {
        const dummy = getPartner(declarer);
        board.contract = {
          level: board.currentBid!.level,
          suit: board.currentBid!.suit,
          doubled: board.doubleState === 'double',
          redoubled: board.doubleState === 'redouble',
          declarer,
          dummy,
        };
        board.phase = 'play_waiting_lead';
        board.trickLeader = nextPosition(declarer);
        board.nextPlayer = board.trickLeader;
        board.message = `定约 ${describeContract(board.contract)}，等待首攻`;
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * 出牌
   * ---------------------------------------------------------------- */

  submitPlay(playerId: string, card: number): void {
    const board = this.requireBoard();
    if (board.phase !== 'play' && board.phase !== 'play_waiting_lead') {
      throw new MatchError('WRONG_PHASE', '当前不在打牌阶段');
    }
    const seat = board.nextPlayer;
    if (!seat) throw new MatchError('WRONG_PHASE', '当前没有待出牌的座位');
    const controller = this.controllerOf(seat);
    this.assertHumanControls(playerId, controller, '出牌');
    this.applyPlay(seat, card);
  }

  /** 该座位由谁控制：明手由庄家代打，其余由本座占用者控制 */
  controllerOf(seat: Position): Position {
    const board = this.board;
    if (board?.contract && board.contract.dummy === seat) return board.contract.declarer;
    return seat;
  }

  private applyPlay(seat: Position, card: number): void {
    const board = this.requireBoard();
    const leadSuit =
      board.currentTrick.length === 0 ? null : suitOfCard(board.currentTrick[0].card);
    if (!isCardLegal(card, board.hands[seat], leadSuit)) {
      throw new MatchError('ILLEGAL_PLAY', '该牌不合法（必须跟出领出花色）');
    }
    board.hands[seat] = board.hands[seat].filter((c) => c !== card);
    board.currentTrick.push({ position: seat, card });
    board.dummyOpen = true;
    board.lastPlayAt = Date.now();
    board.phase = 'play';

    if (board.currentTrick.length === 4) {
      this.settleTrick();
    } else {
      board.nextPlayer = nextPosition(seat);
      board.message = `轮到 ${board.nextPlayer} 出牌`;
    }
  }

  private settleTrick(): void {
    const board = this.requireBoard();
    const contract = board.contract!;
    const trump = trumpOf(contract);
    const winner = determineTrickWinner(board.currentTrick, trump);
    board.tricks.push({ plays: [...board.currentTrick], leader: board.trickLeader!, winner });
    board.currentTrick = [];
    board.trickLeader = winner;
    board.nextPlayer = winner;
    board.message = `${winner} 赢得第 ${board.tricks.length} 墩`;
    const declSide = getSide(contract.declarer);
    board.declarerTricks = board.tricks.filter((t) => getSide(t.winner) === declSide).length;

    if (board.tricks.length === 13) {
      board.phase = 'scored';
      this.finalizeBoard();
    }
  }

  /* ---------------------------------------------------------------- *
   * AI 调度
   * ---------------------------------------------------------------- */

  /** 当前应由机器人行动时返回座位，否则返回 null */
  pendingBotSeat(): Position | null {
    const board = this.board;
    if (!board) return null;
    if (board.phase === 'bidding') {
      const seat = board.currentBidder;
      return this.seats[seat].kind === 'bot' ? seat : null;
    }
    if (board.phase === 'play' || board.phase === 'play_waiting_lead') {
      const seat = board.nextPlayer;
      if (!seat) return null;
      return this.seats[this.controllerOf(seat)].kind === 'bot' ? seat : null;
    }
    return null;
  }

  /** 该玩家此刻是否可以操作（供视角投影与客户端判断） */
  canPlayerAct(playerId: string): boolean {
    const board = this.board;
    if (!board) return false;
    let seat: Position | null = null;
    if (board.phase === 'bidding') seat = board.currentBidder;
    else if (board.phase === 'play' || board.phase === 'play_waiting_lead') seat = board.nextPlayer;
    if (!seat) return false;
    const controller = this.controllerOf(seat);
    const occupant = this.seats[controller];
    return occupant.kind === 'human' && occupant.playerId === playerId;
  }

  /** 执行一步机器人动作；返回 null 表示当前无机器人可动 */
  runAiStep(): { seat: Position; action: 'bid' | 'play'; message: string } | null {
    const board = this.board;
    const seat = this.pendingBotSeat();
    if (!board || !seat) return null;
    const occupant = this.seats[this.controllerOf(seat)];
    const persona = occupant.persona;
    if (!persona) return null;

    if (board.phase === 'bidding') {
      const result = botBid(
        board.hands[seat],
        board.bidding,
        seat,
        board.currentBid,
        persona,
        this.rng,
      );
      this.applyBid(seat, result.call, result.alert);
      return { seat, action: 'bid', message: `${occupant.name} ${describeBid(result.call)}` };
    }

    const contract = board.contract!;
    const dummyHand = board.dummyOpen ? board.hands[contract.dummy] : null;
    const card = playAI(
      board.hands[seat],
      dummyHand,
      board.currentTrick,
      trumpOf(contract),
      seat,
      contract,
      board.declarerTricks,
      leadsForPersona(),
      styleOf(persona).play,
      { rng: this.rng, biddingHistory: board.bidding },
    );
    this.applyPlay(seat, card);
    return { seat, action: 'play', message: `${occupant.name} 出一张牌` };
  }

  /* ---------------------------------------------------------------- *
   * 结算与汇总
   * ---------------------------------------------------------------- */

  private finalizeBoard(): void {
    const board = this.requireBoard();
    if (this.finalized) return;
    this.finalized = true;

    if (board.contract) {
      board.declarerTricks = board.tricks.filter(
        (t) => getSide(t.winner) === getSide(board.contract!.declarer),
      ).length;
      const score = computeScore(board.contract, board.declarerTricks, board.vulnerability);
      board.score = score;
    }

    const diff = board.score.NS - board.score.EW;
    const imp = impsFromScoreDiff(diff);
    const hcpNS = hcp(board.allHands.N) + hcp(board.allHands.S);
    const hcpEW = 40 - hcpNS;
    const points =
      this.config.scoring === 'hcp-points' ? hcpAdjustedPoints(diff, hcpNS, hcpEW) : 0;

    let mpPercent: number | undefined;
    let referenceResults: number[] | undefined;
    if (this.config.scoring === 'mp' && this.referenceScores) {
      referenceResults = this.referenceScores({
        hands: deepCopy(board.allHands),
        dealer: board.dealer,
        vulnerability: board.vulnerability,
        seed: board.seed,
        index: board.index,
      });
      mpPercent = matchpointPercent(diff, referenceResults);
    }

    board.scoring = {
      mode: this.config.scoring,
      imp,
      points,
      hcp: { NS: hcpNS, EW: hcpEW },
      ...(mpPercent !== undefined ? { mpPercent } : {}),
      ...(referenceResults ? { referenceResults } : {}),
    };

    if (board.phase === 'scored') {
      board.message =
        this.config.scoring === 'mp'
          ? `本副结束：NS ${board.score.NS} / EW ${board.score.EW}，MP ${mpPercent ?? 50}%`
          : `本副结束：NS ${board.score.NS} / EW ${board.score.EW}，点数 ${points >= 0 ? '+' : ''}${points}`;
    }

    this.completed.push(this.toRecord(board));

    if (board.index >= this.config.boards) {
      this.status = 'finished';
      this.finishedAt = Date.now();
    }
  }

  private toRecord(board: BoardState): BoardRecord {
    return {
      index: board.index,
      seed: board.seed,
      dealer: board.dealer,
      vulnerability: board.vulnerability,
      hands: deepCopy(board.allHands),
      bidding: deepCopy(board.bidding),
      tricks: deepCopy(board.tricks),
      currentTrick: deepCopy(board.currentTrick),
      contract: board.contract ? deepCopy(board.contract) : null,
      declarerTricks: board.declarerTricks,
      phase: board.phase,
      score: { ...board.score },
      scoring: deepCopy(
        board.scoring ?? {
          mode: this.config.scoring,
          imp: 0,
          points: 0,
          hcp: { NS: 20, EW: 20 },
        },
      ),
    };
  }

  summaryOf(record: BoardRecord): BoardSummary {
    return {
      index: record.index,
      contract: record.contract ? describeContract(record.contract) : record.phase === 'scored' ? '流局' : null,
      declarerTricks: record.declarerTricks,
      score: { ...record.score },
      imp: record.scoring.imp,
      points: record.scoring.points,
      ...(record.scoring.mpPercent !== undefined ? { mpPercent: record.scoring.mpPercent } : {}),
    };
  }

  result(): MatchResult {
    const perBoard = this.completed.map((r) => this.summaryOf(r));
    const nsPoints = perBoard.reduce((sum, b) => sum + b.points, 0);
    const nsImps = perBoard.reduce((sum, b) => sum + b.imp, 0);
    const mpBoards = perBoard.filter((b) => b.mpPercent !== undefined);
    const nsMpPercent =
      mpBoards.length > 0
        ? Math.round((mpBoards.reduce((s, b) => s + (b.mpPercent ?? 50), 0) / mpBoards.length) * 10) / 10
        : 0;

    const scoreForWinner = this.config.scoring === 'mp' ? nsMpPercent - 50 : nsPoints;
    const winner: MatchResult['winner'] = Math.abs(scoreForWinner) < 1e-9 ? 'tie' : scoreForWinner > 0 ? 'NS' : 'EW';

    return {
      boardsPlayed: perBoard.length,
      nsPoints,
      ewPoints: -nsPoints,
      nsImps,
      nsMpPercent,
      winner,
      perBoard,
    };
  }

  /* ---------------------------------------------------------------- *
   * 内部工具
   * ---------------------------------------------------------------- */

  private requireBoard(): BoardState {
    if (!this.board) throw new MatchError('WRONG_PHASE', '尚未开始比赛');
    return this.board;
  }

  private assertHumanControls(playerId: string, seat: Position, action: string): void {
    const occupant = this.seats[seat];
    if (!occupant) throw new MatchError('NOT_YOUR_TURN', '座位不存在');
    if (occupant.kind !== 'human' || occupant.playerId !== playerId) {
      throw new MatchError('NOT_YOUR_TURN', `当前不是你的${action}轮次`);
    }
  }

  /** 玩家离开/接管：把真人座位换成机器人 */
  takeoverSeat(seat: Position, persona: BotPersona): void {
    const current = this.seats[seat];
    this.seats[seat] = { kind: 'bot', name: persona.name, persona };
    if (current.kind === 'human' && this.board) {
      this.board.message = `${current.name} 已由 ${persona.name} 接管`;
    }
  }

  /** 原玩家重连收回被托管的座位，比赛从当前局面继续 */
  reclaimSeat(seat: Position, playerId: string, name: string): void {
    this.seats[seat] = { kind: 'human', playerId, name };
    if (this.board) {
      this.board.message = `${name} 已收回 ${seat} 座`;
    }
  }

  seatOfPlayer(playerId: string): Position | null {
    for (const pos of SIMPLE_ORDER) {
      const seat = this.seats[pos];
      if (seat.kind === 'human' && seat.playerId === playerId) return pos;
    }
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

function readRngState(rng: () => number): number | null {
  const candidate = rng as { getState?: () => number };
  return typeof candidate.getState === 'function' ? candidate.getState() : null;
}

function writeRngState(rng: () => number, state: number): void {
  const candidate = rng as { setState?: (value: number) => void };
  candidate.setState?.(state);
}

function suitOfCard(card: number): 0 | 1 | 2 | 3 {
  return Math.floor(card / 13) as 0 | 1 | 2 | 3;
}

function trumpOf(contract: Contract): 0 | 1 | 2 | 3 | null {
  if (contract.suit === 'NT') return null;
  return { C: 0, D: 1, H: 2, S: 3 }[contract.suit] as 0 | 1 | 2 | 3;
}

function describeBid(call: BidCall): string {
  switch (call.type) {
    case 'pass':
      return 'Pass';
    case 'bid':
      return `${call.level}${{ C: '♣', D: '♦', H: '♥', S: '♠', NT: 'NT' }[call.suit]}`;
    case 'double':
      return 'X';
    case 'redouble':
      return 'XX';
  }
}
