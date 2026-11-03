import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { BoardView, RoomView, ServerMessage } from '@shared/protocol';

/**
 * 在线状态单元测试：WebSocket 单例被替换为可观测的假实现，
 * 直接驱动 `handleMessage` 覆盖重连、终局竞态与多窗口互踢。
 */

const socketMock = vi.hoisted(() => {
  const listeners = new Set<(message: unknown) => void>();
  const sent: unknown[] = [];
  return {
    listeners,
    sent,
    connect: vi.fn(),
    close: vi.fn(),
    setName: vi.fn(),
    send: vi.fn((message: unknown) => {
      sent.push(message);
    }),
    onMessage: vi.fn((listener: (message: unknown) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    onState: vi.fn((listener: (state: string) => void) => {
      listener('open');
      return () => undefined;
    }),
    reset() {
      listeners.clear();
      sent.length = 0;
      this.connect.mockClear();
      this.close.mockClear();
      this.setName.mockClear();
      this.send.mockClear();
      this.onMessage.mockClear();
      this.onState.mockClear();
    },
  };
});

vi.mock('../net/socket', () => ({
  onlineSocket: socketMock,
  loadIdentity: vi.fn(() => ({ playerId: 'p1', name: 'Alice', token: 'tok-1' })),
  saveIdentity: vi.fn(),
}));

import { useOnlineStore } from './online';

const EMPTY_RESULT: RoomView['result'] = {
  boardsPlayed: 0,
  nsPoints: 0,
  ewPoints: 0,
  nsImps: 0,
  nsMpPercent: 0,
  winner: 'tie',
  perBoard: [],
};

function makeRoom(overrides: Partial<RoomView> = {}): RoomView {
  return {
    code: 'ABC123',
    status: 'lobby',
    hostId: 'p1',
    you: { playerId: 'p1', name: 'Alice', seat: 'S' },
    config: { boards: 12, scoring: 'mp', seedBase: 1, matchId: 'm-1' },
    seats: {
      N: { kind: 'open' },
      E: { kind: 'open' },
      S: { kind: 'human', playerId: 'p1', name: 'Alice', connected: true },
      W: { kind: 'open' },
    },
    board: null,
    completed: [],
    result: EMPTY_RESULT,
    chat: [],
    nextBoardAt: null,
    serverTime: 1_700_000_000_000,
    ...overrides,
  };
}

function scoredBoard(): BoardView {
  const hand = (offset: number): number[] => Array.from({ length: 13 }, (_, i) => (offset + i) % 52);
  return {
    index: 1,
    dealer: 'N',
    vulnerability: 'none',
    phase: 'scored',
    currentBidder: 'N',
    nextPlayer: null,
    contract: null,
    bidding: [],
    tricks: [],
    currentTrick: [],
    yourSeat: 'S',
    yourHand: null,
    dummySeat: null,
    dummyHand: null,
    dummyOpen: false,
    revealedHands: { N: hand(0), E: hand(13), S: hand(26), W: hand(39) },
    score: { NS: 0, EW: 0 },
    scoring: {
      mode: 'mp',
      imp: 0,
      points: 0,
      hcp: { NS: 20, EW: 20 },
      mpPercent: 50,
      referenceResults: [0, 0, 0, 0, 0, 0, 0],
    },
    canAct: false,
    actingForSeat: null,
    message: '四家不叫，本副流局',
  };
}

function emit(message: ServerMessage): void {
  for (const listener of socketMock.listeners) listener(message);
}

describe('在线状态 store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    socketMock.reset();
  });

  it('init 载入设备身份并建立连接（幂等）', () => {
    const store = useOnlineStore();
    store.init();
    store.init();

    expect(store.identity).toMatchObject({ playerId: 'p1', name: 'Alice' });
    expect(store.bound).toBe(true);
    expect(store.connection).toBe('open');
    expect(socketMock.connect).toHaveBeenCalledTimes(2);
    expect(socketMock.onMessage).toHaveBeenCalledTimes(1);
  });

  it('重连收到 hello 后主动回到原房间', () => {
    const store = useOnlineStore();
    store.init();
    emit({ v: 1, t: 'room', room: makeRoom({ status: 'playing' }) });

    emit({ v: 1, t: 'hello', playerId: 'p1', name: 'Alice' });
    expect(socketMock.sent.at(-1)).toMatchObject({ t: 'joinRoom', code: 'ABC123' });
  });

  it('结算快照生成复盘记录，按副号排序', () => {
    const store = useOnlineStore();
    store.init();
    emit({ v: 1, t: 'room', room: makeRoom({ board: scoredBoard() }) });

    expect(store.replayBoards).toHaveLength(1);
    expect(store.replayBoards[0].index).toBe(1);
    expect(store.replayBoards[0].hands.N).toHaveLength(13);
  });

  it('比赛已结束时忽略迟到的 WRONG_PHASE 提示', () => {
    const store = useOnlineStore();
    store.init();
    emit({ v: 1, t: 'room', room: makeRoom({ status: 'finished' }) });
    const before = store.toasts.length;

    emit({ v: 1, t: 'error', code: 'WRONG_PHASE', message: '比赛未在进行中' });
    expect(store.toasts).toHaveLength(before);
    expect(store.error).toBeNull();
  });

  it('多窗口互踢：收到 DUPLICATE_SESSION 后停止重连并提示', () => {
    const store = useOnlineStore();
    store.init();

    emit({ v: 1, t: 'error', code: 'DUPLICATE_SESSION', message: '该身份已在其他地方连接' });
    expect(socketMock.close).toHaveBeenCalledTimes(1);
    expect(store.connection).toBe('closed');
    expect(store.toasts.at(-1)?.message).toContain('其他窗口');
  });

  it('房间不存在时清空本地房间与复盘缓存', () => {
    const store = useOnlineStore();
    store.init();
    emit({ v: 1, t: 'room', room: makeRoom({ board: scoredBoard() }) });
    expect(store.room).not.toBeNull();

    emit({ v: 1, t: 'error', code: 'ROOM_NOT_FOUND', message: '房间不存在或已解散' });
    expect(store.room).toBeNull();
    expect(store.records).toEqual({});
    expect(store.toasts.at(-1)?.message).toContain('房间不存在');
  });

  it('普通错误写入 error 并生成 warn toast', () => {
    const store = useOnlineStore();
    store.init();
    emit({ v: 1, t: 'error', code: 'ILLEGAL_PLAY', message: '该牌不合法' });

    expect(store.error).toMatchObject({ code: 'ILLEGAL_PLAY' });
    expect(store.toasts.at(-1)).toMatchObject({ message: '该牌不合法', level: 'warn' });
    // 顶部提示同时进入聊天，并标记为系统消息
    expect(store.chatMessages.at(-1)).toMatchObject({
      from: '系统',
      text: '该牌不合法',
      system: true,
    });
  });

  it('服务端 toast 与房间解散提示都进入系统消息', () => {
    const store = useOnlineStore();
    store.init();
    emit({ v: 1, t: 'room', room: makeRoom({ status: 'playing' }) });

    emit({ v: 1, t: 'toast', message: '比赛开始', level: 'info' });
    expect(store.chatMessages.at(-1)).toMatchObject({ text: '比赛开始', system: true });

    emit({ v: 1, t: 'error', code: 'ROOM_NOT_FOUND', message: '房间不存在或已解散' });
    expect(store.chatMessages.at(-1)).toMatchObject({
      text: '牌室已解散或不存在',
      system: true,
    });
    // 系统消息与玩家聊天按时间合并，系统消息排在最后
    expect(store.chatMessages.map((message) => message.system)).toEqual([true, true]);
  });

  it('主动托管发送 setAutoPlay 报文', () => {
    const store = useOnlineStore();
    store.init();
    store.setAutoPlay(true);
    expect(socketMock.sent.at(-1)).toMatchObject({ t: 'setAutoPlay', enabled: true });
    store.setAutoPlay(false);
    expect(socketMock.sent.at(-1)).toMatchObject({ t: 'setAutoPlay', enabled: false });
  });
});
