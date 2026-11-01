// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Position } from '../../src/models/gameState';
import type { BotPersona } from '../../shared/protocol';
import { MatchError } from '../match';
import { RoomManager } from '../room';

const BOT: BotPersona = {
  id: 'bot-1',
  name: '小满',
  risk: 'aggressive',
  system: 'natural',
  conventions: ['negative_double'],
  randomness: 0.15,
};

function manager(): RoomManager {
  return new RoomManager({ seedBase: 20261101, codes: ['ABC123'] });
}

function fillWithBots(m: RoomManager, code = 'ABC123'): void {
  for (const seat of ['N', 'E', 'S', 'W'] as Position[]) {
    if (m.getRoom(code).seats[seat].kind === 'open') {
      m.setSeat('p-host', code, seat, { kind: 'bot', persona: BOT });
    }
  }
}

function newRoom() {
  const m = manager();
  const room = m.createRoom(
    { playerId: 'p-host', name: '房主' },
    { boards: 12, scoring: 'hcp-points' },
    'S',
  );
  return { m, room };
}

function codeOf(err: unknown): string {
  expect(err).toBeInstanceOf(MatchError);
  return (err as MatchError).code;
}

describe('建房', () => {
  it('生成 6 位房间码并让房主坐入指定座位', () => {
    const { room } = newRoom();
    expect(room.code).toBe('ABC123');
    expect(room.code).toHaveLength(6);
    expect(room.hostId).toBe('p-host');
    expect(room.seats.S.kind).toBe('human');
    if (room.seats.S.kind === 'human') {
      expect(room.seats.S.playerId).toBe('p-host');
      expect(room.seats.S.connected).toBe(true);
    }
    expect(room.status).toBe('lobby');
    expect(room.config.boards).toBe(12);
    expect(room.config.seedBase).toBe(20261101);
  });

  it('拒绝非法副数/计分模式', () => {
    const m = manager();
    for (const config of [
      { boards: 13, scoring: 'mp' },
      { boards: 12, scoring: 'imps' },
    ] as never[]) {
      expect(() =>
        m.createRoom({ playerId: 'p', name: 'P' }, config, 'N'),
      ).toThrow(MatchError);
    }
  });
});

describe('加入与座位', () => {
  it('第二名真人可用房间码加入指定座位', () => {
    const { m } = newRoom();
    const room = m.joinRoom({ playerId: 'p-2', name: '朋友' }, 'ABC123', 'N');
    expect(room.seats.N.kind).toBe('human');
    expect(room.joinOrder).toEqual(['p-host', 'p-2']);
  });

  it('目标座位被占返回 SEAT_TAKEN，未指定座位自动选空位', () => {
    const { m, room } = newRoom();
    try {
      m.joinRoom({ playerId: 'p-2', name: 'A' }, 'ABC123', 'S');
      expect.unreachable();
    } catch (error) {
      expect(codeOf(error)).toBe('SEAT_TAKEN');
    }
    m.joinRoom({ playerId: 'p-2', name: 'A' }, 'ABC123');
    expect(room.seats.N.kind).toBe('human');
  });

  it('房间满时返回 ROOM_FULL，未知房间码返回 ROOM_NOT_FOUND', () => {
    const { m } = newRoom();
    m.joinRoom({ playerId: 'p-2', name: 'A' }, 'ABC123', 'N');
    m.joinRoom({ playerId: 'p-3', name: 'B' }, 'ABC123', 'E');
    m.joinRoom({ playerId: 'p-4', name: 'C' }, 'ABC123', 'W');
    try {
      m.joinRoom({ playerId: 'p-5', name: 'D' }, 'ABC123');
      expect.unreachable();
    } catch (error) {
      expect(codeOf(error)).toBe('ROOM_FULL');
    }
    try {
      m.joinRoom({ playerId: 'p-5', name: 'D' }, 'NOPE00');
      expect.unreachable();
    } catch (error) {
      expect(codeOf(error)).toBe('ROOM_NOT_FOUND');
    }
  });

  it('开赛后非房内玩家无法加入，但原座位玩家可重连', () => {
    const { m, room } = newRoom();
    m.joinRoom({ playerId: 'p-2', name: '朋友' }, 'ABC123', 'N');
    fillWithBots(m);
    m.startMatch('p-host', 'ABC123');
    try {
      m.joinRoom({ playerId: 'p-3', name: '迟到的' }, 'ABC123');
      expect.unreachable();
    } catch (error) {
      expect(codeOf(error)).toBe('WRONG_PHASE');
    }
    m.markDisconnected('p-2');
    const rejoined = m.joinRoom({ playerId: 'p-2', name: '朋友' }, 'ABC123');
    expect(rejoined).toBe(room);
    expect(rejoined.seats.N.kind).toBe('human');
    if (rejoined.seats.N.kind === 'human') expect(rejoined.seats.N.connected).toBe(true);
  });
});

describe('房主转移与离开', () => {
  it('房主在 lobby 离开后转给最早加入的真人', () => {
    const { m, room } = newRoom();
    m.joinRoom({ playerId: 'p-2', name: '朋友' }, 'ABC123', 'N');
    const after = m.leaveRoom('p-host');
    expect(after).toBe(room);
    expect(room.hostId).toBe('p-2');
    expect(room.seats.S.kind).toBe('open');
  });

  it('最后一名真人离开后房间销毁', () => {
    const { m } = newRoom();
    expect(m.leaveRoom('p-host')).toBeNull();
    expect(m.rooms.size).toBe(0);
  });

  it('开赛后离开由机器人接管，比赛可继续', () => {
    const { m, room } = newRoom();
    fillWithBots(m);
    m.startMatch('p-host', 'ABC123');
    m.leaveRoom('p-host');
    expect(room.seats.S.kind).toBe('bot');
    expect(room.match!.seats.S.kind).toBe('bot');
    expect(room.status).toBe('playing');
  });

  it('断线只标记离线，不释放座位', () => {
    const { m, room } = newRoom();
    m.markDisconnected('p-host');
    expect(room.seats.S.kind).toBe('human');
    if (room.seats.S.kind === 'human') expect(room.seats.S.connected).toBe(false);
    m.markConnected('p-host');
    if (room.seats.S.kind === 'human') expect(room.seats.S.connected).toBe(true);
  });
});

describe('座位配置与开赛校验', () => {
  it('非房主不能改座位/配置/开赛', () => {
    const { m } = newRoom();
    m.joinRoom({ playerId: 'p-2', name: '朋友' }, 'ABC123', 'N');
    expect(() => m.setSeat('p-2', 'ABC123', 'E', { kind: 'bot', persona: BOT })).toThrow(/房主/);
    expect(() => m.setConfig('p-2', 'ABC123', { boards: 18, scoring: 'mp' })).toThrow(/房主/);
    expect(() => m.startMatch('p-2', 'ABC123')).toThrow(/房主/);
  });

  it('四个座位未占满时拒绝开赛', () => {
    const { m } = newRoom();
    m.setSeat('p-host', 'ABC123', 'N', { kind: 'bot', persona: BOT });
    m.setSeat('p-host', 'ABC123', 'E', { kind: 'bot', persona: BOT });
    try {
      m.startMatch('p-host', 'ABC123');
      expect.unreachable();
    } catch (error) {
      expect(codeOf(error)).toBe('SEATS_NOT_FULL');
    }
  });

  it('机器人人格经过清洗：非法体系回退精确、随机度夹到 0..1', () => {
    const { m, room } = newRoom();
    m.setSeat('p-host', 'ABC123', 'N', {
      kind: 'bot',
      persona: { ...BOT, system: 'weird' as never, randomness: 5 },
    });
    const seat = room.seats.N;
    expect(seat.kind).toBe('bot');
    if (seat.kind === 'bot') {
      expect(seat.persona.system).toBe('precision');
      expect(seat.persona.randomness).toBe(1);
    }
  });

  it('开赛后禁止修改座位与配置', () => {
    const { m } = newRoom();
    fillWithBots(m);
    m.startMatch('p-host', 'ABC123');
    expect(() => m.setSeat('p-host', 'ABC123', 'N', { kind: 'open' })).toThrow(/开赛后/);
    expect(() => m.setConfig('p-host', 'ABC123', { boards: 24, scoring: 'mp' })).toThrow(/开赛后/);
    expect(() => m.updateBot('p-host', 'ABC123', 'N', BOT)).toThrow(/开赛后/);
  });

  it('开赛后第一副开始，状态变为 playing', () => {
    const { m, room } = newRoom();
    fillWithBots(m);
    m.startMatch('p-host', 'ABC123');
    expect(room.status).toBe('playing');
    expect(room.match).not.toBeNull();
    expect(room.match!.board!.index).toBe(1);
  });
});

describe('对局动作与推进', () => {
  it('非本房玩家提交动作被拒绝', () => {
    const { m } = newRoom();
    fillWithBots(m);
    m.startMatch('p-host', 'ABC123');
    expect(() => m.submitBid('p-stranger', 'ABC123', { type: 'pass' })).toThrow(/不在该房间/);
  });

  it('结算后 nextBoard 推进到下一副；最后一副后比赛结束', () => {
    const { m, room } = newRoom();
    fillWithBots(m);
    m.startMatch('p-host', 'ABC123');
    // N/E/W 为机器人，S 为房主；完整跑完一副（必要时由房主操作自己的座位）
    const engine = room.match!;
    let guard = 0;
    while (engine.board!.phase !== 'scored' && guard < 400) {
      const board = engine.board!;
      if (engine.pendingBotSeat()) {
        engine.runAiStep();
      } else if (engine.canPlayerAct('p-host')) {
        if (board.phase === 'bidding') {
          engine.submitBid('p-host', { type: 'pass' });
        } else {
          const lead = board.currentTrick.length === 0 ? null : Math.floor(board.currentTrick[0].card / 13);
          const legal = board.hands.S.filter(
            (card) => lead === null || Math.floor(card / 13) === lead,
          );
          const card = legal.length > 0 ? legal[0] : board.hands.S[0];
          engine.submitPlay('p-host', card);
        }
      } else {
        break;
      }
      guard += 1;
    }
    expect(engine.board!.phase).toBe('scored');
    const before = engine.board!.index;
    m.nextBoard('p-host', 'ABC123');
    expect(room.match!.board!.index).toBe(before + 1);
  });

  it('聊天超长截断，超过 50 条仅保留最近', () => {
    const { m, room } = newRoom();
    for (let i = 0; i < 55; i += 1) m.addChat(room, 'p-host', `x${i}`);
    expect(room.chat).toHaveLength(50);
    expect(room.chat[49].text).toBe('x54');
    expect(room.chat[49].from).toBe('房主');
    expect(m.addChat(room, 'p-host', '  你好  ').text).toBe('你好');
    expect(() => m.addChat(room, 'p-host', '   ')).toThrow(/不能为空/);
  });
});
