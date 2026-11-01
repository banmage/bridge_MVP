// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '../../shared/protocol';
import { GameHub, type ClientTransport } from '../protocolHandlers';
import { RoomManager } from '../room';

class FakeTransport implements ClientTransport {
  messages: ServerMessage[] = [];
  closed = false;
  send(message: ServerMessage): void {
    this.messages.push(message);
  }
  close(): void {
    this.closed = true;
  }
  lastOfType<T extends ServerMessage['t']>(type: T): Extract<ServerMessage, { t: T }> | undefined {
    for (let i = this.messages.length - 1; i >= 0; i -= 1) {
      const msg = this.messages[i];
      if (msg.t === type) return msg as Extract<ServerMessage, { t: T }>;
    }
    return undefined;
  }
}

function setup() {
  const timers: Array<() => void> = [];
  const hub = new GameHub({
    rooms: new RoomManager({ seedBase: 1, codes: ['ROOM01'] }),
    persist: false,
    aiDelayMs: 0,
    setTimer: (fn) => {
      timers.push(fn);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => undefined,
    now: () => 1_700_000_000_000,
  });
  return { hub, timers };
}

function connect(hub: GameHub, id: string, name: string, token = 'tok'): FakeTransport {
  const transport = new FakeTransport();
  hub.connect(id, token, name, transport);
  return transport;
}

function roomView(transport: FakeTransport) {
  const message = transport.lastOfType('room');
  if (!message) throw new Error('没有 room 快照');
  return message.room;
}

describe('连接与身份', () => {
  it('首次连接回 hello，token 不匹配拒绝', () => {
    const { hub } = setup();
    const a = connect(hub, 'p-1', 'Alice');
    expect(a.lastOfType('hello')).toMatchObject({ t: 'hello', playerId: 'p-1', name: 'Alice' });
    expect(a.closed).toBe(false);

    const bad = connect(hub, 'p-1', 'Alice', 'other-token');
    expect(bad.lastOfType('error')?.code).toBe('AUTH_FAILED');
    expect(bad.closed).toBe(true);
  });

  it('重复连接：新连接生效，旧连接收到 DUPLICATE_SESSION', () => {
    const { hub } = setup();
    const old = connect(hub, 'p-1', 'Alice');
    const fresh = connect(hub, 'p-1', 'Alice');
    expect(old.lastOfType('error')?.code).toBe('DUPLICATE_SESSION');
    expect(old.closed).toBe(true);
    expect(fresh.lastOfType('hello')).toBeTruthy();
  });

  it('协议版本不匹配：报错并关闭连接', () => {
    const { hub } = setup();
    const a = connect(hub, 'p-1', 'Alice');
    hub.receive('p-1', { v: 99, t: 'requestState' });
    expect(a.lastOfType('error')?.code).toBe('BAD_REQUEST');
    expect(a.closed).toBe(true);
  });

  it('非法 JSON 与未知报文类型', () => {
    const { hub } = setup();
    const a = connect(hub, 'p-1', 'Alice');
    hub.receive('p-1', '{oops');
    expect(a.lastOfType('error')?.code).toBe('BAD_REQUEST');
    const count = a.messages.length;
    hub.receive('p-1', { v: 1, t: 'futureThing' });
    expect(a.messages.length).toBe(count);
  });

  it('断线保留座位并广播离线状态', () => {
    const { hub } = setup();
    const a = connect(hub, 'p-1', 'Alice');
    const b = connect(hub, 'p-2', 'Bob');
    hub.receive('p-1', { v: 1, t: 'createRoom', config: { boards: 12, scoring: 'mp' }, seat: 'S' });
    hub.receive('p-2', { v: 1, t: 'joinRoom', code: 'ROOM01', seat: 'N' });
    hub.disconnect('p-2');
    const view = roomView(a);
    expect(view.seats.N.kind).toBe('human');
    if (view.seats.N.kind === 'human') expect(view.seats.N.connected).toBe(false);
    expect(view.status).toBe('lobby');
    void b;
  });
});

describe('房间与开赛', () => {
  it('建房广播快照；非房主管理动作被拒绝；开赛安排机器人计时器', () => {
    const { hub, timers } = setup();
    const a = connect(hub, 'p-1', 'Alice');
    const b = connect(hub, 'p-2', 'Bob');

    hub.receive('p-1', {
      v: 1,
      t: 'createRoom',
      config: { boards: 18, scoring: 'hcp-points' },
      seat: 'S',
    });
    let view = roomView(a);
    expect(view.code).toBe('ROOM01');
    expect(view.you.seat).toBe('S');
    expect(view.config.boards).toBe(18);

    hub.receive('p-2', { v: 1, t: 'joinRoom', code: 'ROOM01', seat: 'E' });
    view = roomView(b);
    expect(view.you.seat).toBe('E');
    expect(view.hostId).toBe('p-1');

    hub.receive('p-2', { v: 1, t: 'setSeat', seat: 'N', occupant: { kind: 'open' } });
    expect(b.lastOfType('error')?.code).toBe('NOT_HOST');

    for (const seat of ['N', 'W'] as const) {
      hub.receive('p-1', {
        v: 1,
        t: 'setSeat',
        seat,
        occupant: {
          kind: 'bot',
          persona: {
            id: `bot-${seat}`,
            name: `${seat}机器人`,
            risk: 'normal',
            system: 'precision',
            conventions: [],
            randomness: 0,
          },
        },
      });
    }

    hub.receive('p-1', { v: 1, t: 'startMatch' });
    view = roomView(b);
    expect(view.status).toBe('playing');
    expect(view.board?.index).toBe(1);
    expect(view.seats.N.kind).toBe('bot');
    expect(hub.hasAiTimer('ROOM01')).toBe(true);
    expect(timers.length).toBe(1);

    // 触发一次机器人行动（N 开叫）
    timers[0]();
    const after = roomView(a).board!;
    expect(after.bidding.length).toBe(1);
    expect(after.bidding[0].position).toBe('N');
  });

  it('未加入房间的动作返回 NOT_IN_ROOM；请求快照可重发', () => {
    const { hub } = setup();
    const a = connect(hub, 'p-1', 'Alice');
    hub.receive('p-1', { v: 1, t: 'startMatch' });
    expect(a.lastOfType('error')?.code).toBe('NOT_IN_ROOM');

    hub.receive('p-1', { v: 1, t: 'createRoom', config: { boards: 12, scoring: 'mp' }, seat: 'S' });
    const before = a.messages.length;
    hub.receive('p-1', { v: 1, t: 'requestState' });
    expect(a.messages.length).toBeGreaterThan(before);
    expect(a.lastOfType('room')).toBeTruthy();
  });

  it('聊天广播给房内所有人', () => {
    const { hub } = setup();
    const a = connect(hub, 'p-1', 'Alice');
    const b = connect(hub, 'p-2', 'Bob');
    hub.receive('p-1', { v: 1, t: 'createRoom', config: { boards: 12, scoring: 'mp' }, seat: 'S' });
    hub.receive('p-2', { v: 1, t: 'joinRoom', code: 'ROOM01', seat: 'N' });
    hub.receive('p-2', { v: 1, t: 'chat', text: '大家好' });
    expect(roomView(a).chat.at(-1)?.text).toBe('大家好');
    expect(roomView(b).chat.at(-1)?.from).toBe('Bob');
  });

  it('开赛后离开由机器人接管', () => {
    const { hub } = setup();
    const a = connect(hub, 'p-1', 'Alice');
    hub.receive('p-1', { v: 1, t: 'createRoom', config: { boards: 12, scoring: 'mp' }, seat: 'S' });
    for (const seat of ['N', 'E', 'W'] as const) {
      hub.receive('p-1', {
        v: 1,
        t: 'setSeat',
        seat,
        occupant: {
          kind: 'bot',
          persona: {
            id: `b-${seat}`,
            name: `${seat}机器人`,
            risk: 'normal',
            system: 'precision',
            conventions: [],
            randomness: 0,
          },
        },
      });
    }
    hub.receive('p-1', { v: 1, t: 'startMatch' });
    hub.receive('p-1', { v: 1, t: 'leaveRoom' });
    const room = hub.rooms.getRoom('ROOM01');
    expect(room.seats.S.kind).toBe('bot');
    expect(room.status).toBe('playing');
    void a;
  });

  it('ping 返回 pong', () => {
    const { hub } = setup();
    const a = connect(hub, 'p-1', 'Alice');
    hub.receive('p-1', { v: 1, t: 'ping' });
    expect(a.lastOfType('pong')).toBeTruthy();
  });
});
