// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { BidCall, Position } from '../../src/models/gameState';
import type { Hand } from '../../src/models/hand';
import { createDeck } from '../../src/core/deck';
import { MatchEngine, matchpointPercent, MatchError, type EngineSeat } from '../match';
import type { BoardCount, BotPersona, ScoringMode } from '../../shared/protocol';

const POSITIONS: Position[] = ['N', 'E', 'S', 'W'];

/** 固定牌型：N 0-12 / E 13-25 / S 26-38 / W 39-51 */
function fixedHands(): Record<Position, Hand> {
  const deck = createDeck();
  return {
    N: deck.slice(0, 13),
    E: deck.slice(13, 26),
    S: deck.slice(26, 39),
    W: deck.slice(39, 52),
  };
}

function humanSeats(prefix = 'p'): Record<Position, EngineSeat> {
  return Object.fromEntries(
    POSITIONS.map((pos) => [pos, { kind: 'human', playerId: `${prefix}-${pos}`, name: `玩家${pos}` }]),
  ) as Record<Position, EngineSeat>;
}

const BOT: BotPersona = {
  id: 'bot-test',
  name: '测试机器人',
  risk: 'normal',
  system: 'precision',
  conventions: ['strong_nt', 'negative_double', 'weak_two', 'stayman', 'transfer'],
  randomness: 0,
};

function botSeats(): Record<Position, EngineSeat> {
  return Object.fromEntries(
    POSITIONS.map((pos) => [pos, { kind: 'bot', name: `机器人${pos}`, persona: { ...BOT, id: `bot-${pos}` } }]),
  ) as Record<Position, EngineSeat>;
}

function createEngine(
  opts: {
    seats?: Record<Position, EngineSeat>;
    boards?: BoardCount;
    scoring?: ScoringMode;
    referenceScores?: (input: unknown) => number[];
  } = {},
): MatchEngine {
  return new MatchEngine({
    config: {
      boards: opts.boards ?? 12,
      scoring: opts.scoring ?? 'hcp-points',
      seedBase: 20261101,
      matchId: 'm-test',
    },
    seats: opts.seats ?? humanSeats(),
    ...(opts.referenceScores ? { referenceScores: opts.referenceScores as never } : {}),
  });
}

const call = {
  pass: { type: 'pass' } as BidCall,
  oneNT: { type: 'bid', level: 1, suit: 'NT' } as BidCall,
  sevenNT: { type: 'bid', level: 7, suit: 'NT' } as BidCall,
};

/** 让 4 个真人座位按顺序完成一次 7NT 叫牌 */
function bidSevenNoTrump(engine: MatchEngine): void {
  engine.submitBid('p-N', call.sevenNT);
  engine.submitBid('p-E', call.pass);
  engine.submitBid('p-S', call.pass);
  engine.submitBid('p-W', call.pass);
}

describe('MatchEngine 发牌与生命周期', () => {
  it('开局按轮转表给出庄家/局况，发出 52 张不重复的牌', () => {
    const engine = createEngine();
    const board = engine.start();
    expect(board.index).toBe(1);
    expect(board.dealer).toBe('N');
    expect(board.vulnerability).toBe('none');
    const all = POSITIONS.flatMap((pos) => board.allHands[pos]);
    expect(all).toHaveLength(52);
    expect(new Set(all).size).toBe(52);
    for (const pos of POSITIONS) expect(board.hands[pos]).toHaveLength(13);
    expect(board.phase).toBe('bidding');
    expect(board.currentBidder).toBe('N');
  });

  it('同一种子基值重放，发牌完全一致', () => {
    const a = createEngine().start();
    const b = createEngine().start();
    expect(a.seed).toBe(b.seed);
    expect(a.allHands).toEqual(b.allHands);
  });

  it('重复 start 被拒绝；下一副在结算前被拒绝', () => {
    const engine = createEngine();
    engine.start();
    expect(() => engine.start()).toThrow(MatchError);
    expect(() => engine.nextBoard()).toThrow(MatchError);
  });

  it('最后一副结算后比赛结束，nextBoard 返回 null', () => {
    const engine = createEngine({ boards: 12 });
    engine.startBoard(12);
    for (let i = 0; i < 4; i += 1) {
      const seat = engine.board!.currentBidder;
      engine.submitBid(`p-${seat}`, call.pass);
    }
    expect(engine.board!.phase).toBe('scored');
    expect(engine.status).toBe('finished');
    expect(engine.nextBoard()).toBeNull();
    expect(engine.completed).toHaveLength(1);
  });
});

describe('叫牌校验', () => {
  it('不是自己的轮次会被拒绝且状态不变', () => {
    const engine = createEngine();
    engine.start();
    expect(() => engine.submitBid('p-E', call.oneNT)).toThrow(/不是你的叫牌轮次/);
    expect(engine.board!.bidding).toHaveLength(0);
    expect(engine.board!.currentBidder).toBe('N');
  });

  it('低于当前叫品的叫牌被拒绝，提交者可以正常叫牌', () => {
    const engine = createEngine();
    engine.start();
    engine.submitBid('p-N', call.oneNT);
    expect(() => engine.submitBid('p-E', { type: 'bid', level: 1, suit: 'C' })).toThrow(/不合法/);
    expect(engine.board!.bidding).toHaveLength(1);
    engine.submitBid('p-E', { type: 'bid', level: 2, suit: 'C' });
    expect(engine.board!.bidding).toHaveLength(2);
  });

  it('四家不叫记为流局，双方 0 分', () => {
    const engine = createEngine();
    engine.start();
    for (const pos of POSITIONS) engine.submitBid(`p-${pos}`, call.pass);
    const board = engine.board!;
    expect(board.phase).toBe('scored');
    expect(board.contract).toBeNull();
    expect(board.score).toEqual({ NS: 0, EW: 0 });
    expect(engine.completed).toHaveLength(1);
    expect(engine.completed[0].phase).toBe('scored');
    expect(engine.result().perBoard[0].contract).toBe('流局');
  });

  it('叫牌结束后正确判定庄家、明手与首攻者', () => {
    const engine = createEngine();
    engine.startBoard(1, { hands: fixedHands() });
    engine.submitBid('p-N', call.oneNT);
    engine.submitBid('p-E', call.pass);
    engine.submitBid('p-S', call.pass);
    engine.submitBid('p-W', call.pass);
    const board = engine.board!;
    expect(board.phase).toBe('play_waiting_lead');
    expect(board.contract).toEqual({
      level: 1,
      suit: 'NT',
      doubled: false,
      redoubled: false,
      declarer: 'N',
      dummy: 'S',
    });
    expect(board.trickLeader).toBe('E');
    expect(board.nextPlayer).toBe('E');
  });

  it('加倍规则：只能加倍对方叫品', () => {
    const engine = createEngine();
    engine.startBoard(1, { hands: fixedHands() });
    engine.submitBid('p-N', call.oneNT);
    // E 是 N 的对手，可以加倍
    engine.submitBid('p-E', { type: 'double' });
    expect(engine.board!.doubleState).toBe('double');
    // S 是 N 的同伴，不能再加倍
    expect(() => engine.submitBid('p-S', { type: 'double' })).toThrow(/不合法/);
    // N 可以再加倍
    engine.submitBid('p-S', call.pass);
    engine.submitBid('p-W', call.pass);
    engine.submitBid('p-N', { type: 'redouble' });
    expect(engine.board!.doubleState).toBe('redouble');
  });
});

describe('出牌校验与明手控制', () => {
  function toPlay(): MatchEngine {
    const engine = createEngine();
    engine.startBoard(1, { hands: fixedHands() });
    bidSevenNoTrump(engine);
    return engine;
  }

  it('首攻前明手未摊牌；首攻后公开明手', () => {
    const engine = toPlay();
    expect(engine.board!.dummyOpen).toBe(false);
    const lead = engine.board!.hands.E[0];
    engine.submitPlay('p-E', lead);
    expect(engine.board!.dummyOpen).toBe(true);
    expect(engine.board!.phase).toBe('play');
  });

  it('必须跟出领出花色，否则拒绝且状态不变', () => {
    const engine = createEngine();
    engine.startBoard(1);
    bidSevenNoTrump(engine);
    const board = engine.board!;
    const suitOf = (card: number) => Math.floor(card / 13);
    // 选一张明手有同花色的首攻，才能测试“必须跟牌”
    const leadCard = board.hands.E.find((card) =>
      board.hands.S.some((c) => suitOf(c) === suitOf(card)),
    );
    expect(leadCard).toBeDefined();
    engine.submitPlay('p-E', leadCard!);
    const leadSuit = suitOf(leadCard!);
    const illegal = board.hands.S.find((c) => suitOf(c) !== leadSuit);
    expect(illegal).toBeDefined();
    // S 是明手，由庄家 N 代打
    expect(() => engine.submitPlay('p-N', illegal!)).toThrow(/不合法/);
    expect(board.currentTrick).toHaveLength(1);
  });

  it('庄家可以代打明手，明手本人不能出牌', () => {
    const engine = toPlay();
    engine.submitPlay('p-E', engine.board!.hands.E[0]);
    // S 是明手，应由庄家 N 代打
    expect(engine.controllerOf('S')).toBe('N');
    expect(engine.canPlayerAct('p-S')).toBe(false);
    expect(engine.canPlayerAct('p-N')).toBe(true);
    expect(() => engine.submitPlay('p-S', engine.board!.hands.S[0])).toThrow(/不是你的出牌轮次/);
    engine.submitPlay('p-N', engine.board!.hands.S[0]);
    expect(engine.board!.currentTrick).toHaveLength(2);
  });

  it('全机器人可完整跑完一副：13 墩、结算与记录齐全', () => {
    const engine = createEngine({ seats: botSeats(), scoring: 'hcp-points' });
    engine.startBoard(1, { hands: fixedHands() });
    // 先由真人完成叫牌，再交给机器人打牌
    engine.seats = humanSeats();
    bidSevenNoTrump(engine);
    engine.seats = botSeats();

    let guard = 0;
    while (engine.board!.phase !== 'scored' && guard < 200) {
      if (!engine.runAiStep()) break;
      guard += 1;
    }
    const board = engine.board!;
    expect(board.phase).toBe('scored');
    expect(board.tricks).toHaveLength(13);
    expect(board.tricks.every((t) => t.plays.length === 4)).toBe(true);
    expect(board.declarerTricks).toBeGreaterThanOrEqual(0);
    expect(board.declarerTricks).toBeLessThanOrEqual(13);
    expect(board.scoring).not.toBeNull();
    expect(engine.completed[0].tricks).toHaveLength(13);
    expect(engine.completed[0].hands.N).toHaveLength(13);
    expect(engine.completed[0].bidding).toHaveLength(4);
  });

  it('结算后不再接受出牌/叫牌', () => {
    const engine = createEngine();
    engine.startBoard(1, { hands: fixedHands() });
    for (const pos of POSITIONS) engine.submitBid(`p-${pos}`, call.pass);
    expect(() => engine.submitPlay('p-N', 0)).toThrow(MatchError);
    expect(() => engine.submitBid('p-N', call.oneNT)).toThrow(MatchError);
  });

  it('重复提交同一张牌因轮次前进被拒绝', () => {
    const engine = toPlay();
    const card = engine.board!.hands.E[0];
    engine.submitPlay('p-E', card);
    expect(() => engine.submitPlay('p-E', card)).toThrow(/不是你的出牌轮次/);
    expect(engine.board!.currentTrick).toHaveLength(1);
  });
});

describe('计分与汇总', () => {
  it('贴点制逐副点数累加，胜负与总计一致', () => {
    const engine = createEngine({ boards: 12, scoring: 'hcp-points' });
    engine.start();
    for (const pos of POSITIONS) engine.submitBid(`p-${pos}`, call.pass);
    const result = engine.result();
    expect(result.boardsPlayed).toBe(1);
    expect(result.nsPoints).toBe(result.perBoard[0].points);
    expect(result.ewPoints).toBe(-result.nsPoints);
    expect(result.nsImps).toBe(0);
    expect(result.nsMpPercent).toBe(0);
  });

  it('MP 模式使用注入的对照场并给出百分比', () => {
    const reference = () => [-100, -50, 0, 50, 100, 150, 200];
    const engine = createEngine({ scoring: 'mp', referenceScores: reference });
    engine.startBoard(1, { hands: fixedHands() });
    for (const pos of POSITIONS) engine.submitBid(`p-${pos}`, call.pass);
    const board = engine.board!;
    expect(board.scoring!.referenceResults).toEqual(reference());
    expect(board.scoring!.mpPercent).toBe(matchpointPercent(0, reference()));
    expect(engine.result().nsMpPercent).toBe(board.scoring!.mpPercent);
  });

  it('matchpointPercent 边界：全胜 100、全平 50、全负 0、空数组 50', () => {
    expect(matchpointPercent(100, [-10, -20])).toBe(100);
    expect(matchpointPercent(0, [0, 0, 0])).toBe(50);
    expect(matchpointPercent(-1, [0, 10])).toBe(0);
    expect(matchpointPercent(0, [])).toBe(50);
    expect(matchpointPercent(0, [0, 10])).toBe(25);
  });

  it('比赛结束后 result 汇总比赛场次', () => {
    const engine = createEngine({ boards: 12 });
    engine.startBoard(12);
    for (let i = 0; i < 4; i += 1) {
      const seat = engine.board!.currentBidder;
      engine.submitBid(`p-${seat}`, call.pass);
    }
    const result = engine.result();
    expect(result.boardsPlayed).toBe(1);
    expect(result.perBoard[0].index).toBe(12);
    expect(engine.status).toBe('finished');
    expect(engine.finishedAt).not.toBeNull();
  });
});

describe('座位接管', () => {
  it('takeoverSeat 把真人换成机器人且保留座位归属', () => {
    const engine = createEngine();
    engine.start();
    expect(engine.seatOfPlayer('p-N')).toBe('N');
    engine.takeoverSeat('N', { ...BOT, name: '接管' });
    expect(engine.seatOfPlayer('p-N')).toBeNull();
    expect(engine.seats.N.kind).toBe('bot');
    expect(engine.seats.N.persona?.name).toBe('接管');
  });
});
