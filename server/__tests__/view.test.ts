// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Position } from '../../src/models/gameState';
import type { Hand } from '../../src/models/hand';
import { createDeck } from '../../src/core/deck';
import { sortHand } from '../../src/models/hand';
import { MatchEngine, type EngineSeat } from '../match';
import type { BotPersona } from '../../shared/protocol';
import { RoomManager } from '../room';
import { projectBoardView, projectRoomView } from '../view';

const POSITIONS: Position[] = ['N', 'E', 'S', 'W'];

function fixedHands(): Record<Position, Hand> {
  const deck = createDeck();
  return {
    N: deck.slice(0, 13),
    E: deck.slice(13, 26),
    S: deck.slice(26, 39),
    W: deck.slice(39, 52),
  };
}

const BOT: BotPersona = {
  id: 'bot',
  name: '机器人',
  risk: 'normal',
  system: 'precision',
  conventions: ['strong_nt', 'negative_double', 'weak_two', 'stayman', 'transfer'],
  randomness: 0,
};

function ids(): Record<Position, string> {
  return { N: 'p-N', E: 'p-E', S: 'p-S', W: 'p-W' };
}

function humans(): Record<Position, EngineSeat> {
  const names = ids();
  return Object.fromEntries(
    POSITIONS.map((pos) => [pos, { kind: 'human', playerId: names[pos], name: pos }]),
  ) as Record<Position, EngineSeat>;
}

function bots(): Record<Position, EngineSeat> {
  return Object.fromEntries(
    POSITIONS.map((pos) => [pos, { kind: 'bot', name: `${pos}机器人`, persona: { ...BOT, id: `b-${pos}` } }]),
  ) as Record<Position, EngineSeat>;
}

interface Fixture {
  manager: RoomManager;
  room: ReturnType<RoomManager['createRoom']>;
  engine: MatchEngine;
  hands: Record<Position, Hand>;
}

/** 建房到开赛，并替换为固定发牌，便于断言视角 */
function fixture(): Fixture {
  const manager = new RoomManager({ seedBase: 1, codes: ['ROOM01'] });
  const room = manager.createRoom({ playerId: 'p-N', name: '北家' }, { boards: 12, scoring: 'mp' }, 'N');
  manager.joinRoom({ playerId: 'p-E', name: '东家' }, 'ROOM01', 'E');
  manager.setSeat('p-N', 'ROOM01', 'S', { kind: 'bot', persona: { ...BOT, id: 'bot-S' } });
  manager.setSeat('p-N', 'ROOM01', 'W', { kind: 'bot', persona: { ...BOT, id: 'bot-W' } });
  manager.startMatch('p-N', 'ROOM01');

  const hands = fixedHands();
  for (const pos of POSITIONS) hands[pos] = sortHand(hands[pos]);
  const engine = new MatchEngine({
    config: room.config,
    seats: humans(),
    referenceScores: () => [0, 0, 0, 0, 0, 0, 0],
  });
  engine.startBoard(1, { hands });
  room.match = engine;
  return { manager, room, engine, hands };
}

function bidToContract(engine: MatchEngine): void {
  engine.submitBid('p-N', { type: 'bid', level: 1, suit: 'NT' });
  engine.submitBid('p-E', { type: 'pass' });
  engine.submitBid('p-S', { type: 'pass' });
  engine.submitBid('p-W', { type: 'pass' });
}

describe('视角投影：叫牌阶段', () => {
  it('每位玩家只看到自己的手牌，且不见明手/四手牌', () => {
    const { room, hands } = fixture();
    for (const pos of POSITIONS) {
      const view = projectRoomView(room, ids()[pos]);
      const board = view.board!;
      expect(board.yourSeat).toBe(pos);
      expect(board.yourHand).toEqual(hands[pos]);
      expect(board.dummyHand).toBeNull();
      expect(board.revealedHands).toBeNull();
      expect(board.scoring).toBeNull();
      const text = JSON.stringify(board);
      for (const other of POSITIONS.filter((p) => p !== pos)) {
        expect(text).not.toContain(JSON.stringify(hands[other]));
      }
    }
  });

  it('快照不含发牌种子', () => {
    const { room } = fixture();
    const view = projectRoomView(room, 'p-N');
    expect(JSON.stringify(view)).not.toMatch(/"seed"/);
  });

  it('非本房玩家 yourSeat 为 null、无手牌', () => {
    const { room } = fixture();
    const board = projectRoomView(room, 'stranger').board!;
    expect(board.yourSeat).toBeNull();
    expect(board.yourHand).toBeNull();
    expect(board.canAct).toBe(false);
  });
});

describe('视角投影：打牌与明手', () => {
  it('首攻前无明手牌，首攻后明手对所有人可见', () => {
    const { room, engine, hands } = fixture();
    bidToContract(engine);
    for (const pos of POSITIONS) {
      const board = projectRoomView(room, ids()[pos]).board!;
      expect(board.contract?.declarer).toBe('N');
      expect(board.dummySeat).toBe('S');
      expect(board.dummyOpen).toBe(false);
      expect(board.dummyHand).toBeNull();
    }

    engine.submitPlay('p-E', engine.board!.hands.E[0]);
    for (const pos of POSITIONS) {
      const board = projectRoomView(room, ids()[pos]).board!;
      expect(board.dummyOpen).toBe(true);
      expect(board.dummyHand).toEqual(hands.S);
      expect(board.revealedHands).toBeNull();
    }
  });

  it('明手本人 canAct 为 false，庄家代打时 actingForSeat 指向明手', () => {
    const { room, engine } = fixture();
    bidToContract(engine);
    engine.submitPlay('p-E', engine.board!.hands.E[0]);

    const dummyView = projectRoomView(room, 'p-S').board!;
    expect(dummyView.canAct).toBe(false);
    expect(dummyView.actingForSeat).toBeNull();

    const declarerView = projectRoomView(room, 'p-N').board!;
    expect(declarerView.canAct).toBe(true);
    expect(declarerView.actingForSeat).toBe('S');
    expect(declarerView.nextPlayer).toBe('S');
  });

  it('结算后才公开四手牌，且四手各 13 张', () => {
    const { room, engine } = fixture();
    bidToContract(engine);
    engine.seats = bots();
    let guard = 0;
    while (engine.board!.phase !== 'scored' && guard < 200) {
      if (!engine.runAiStep()) break;
      guard += 1;
    }
    expect(engine.board!.phase).toBe('scored');

    for (const pos of POSITIONS) {
      const board = projectRoomView(room, ids()[pos]).board!;
      expect(board.score).not.toBeNull();
      expect(board.scoring).not.toBeNull();
      expect(board.dummyHand).toBeNull();
      expect(board.yourHand).toBeNull();
      expect(board.revealedHands).not.toBeNull();
      for (const p of POSITIONS) expect(board.revealedHands![p]).toHaveLength(13);
      expect(board.revealedHands!.N).toEqual(sortHand(fixedHands().N));
    }
  });
});

describe('视角投影：房间与座位', () => {
  it('机器人人格公开，真人仅暴露名字/在线状态，chat 只保留最近 50 条', () => {
    const { room, manager } = fixture();
    for (let i = 0; i < 60; i += 1) manager.addChat(room, 'p-N', `消息${i}`);
    const view = projectRoomView(room, 'p-N', 1700000000000);
    expect(view.code).toBe('ROOM01');
    expect(view.you).toEqual({ playerId: 'p-N', name: '北家', seat: 'N' });
    expect(view.seats.N.kind).toBe('human');
    expect(view.seats.S.kind).toBe('bot');
    if (view.seats.S.kind === 'bot') expect(view.seats.S.persona.name).toBe('机器人');
    expect(view.chat).toHaveLength(50);
    expect(view.chat[49].text).toBe('消息59');
    expect(view.serverTime).toBe(1700000000000);
    expect(view.result.boardsPlayed).toBe(0);
  });

  it('projectBoardView 在未开局时返回 null', () => {
    const manager = new RoomManager({ seedBase: 1, codes: ['ROOM02'] });
    const room = manager.createRoom({ playerId: 'p-N', name: '北家' }, { boards: 12, scoring: 'mp' }, 'N');
    expect(projectBoardView(new MatchEngine({ config: room.config, seats: humans() }), 'p-N')).toBeNull();
  });
});
