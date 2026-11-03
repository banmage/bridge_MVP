// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Position } from '../../src/models/gameState';
import type { Hand } from '../../src/models/hand';
import { createDeck } from '../../src/core/deck';
import type { BotPersona, ServerMessage } from '../../shared/protocol';
import { MatchEngine, type EngineSeat } from '../match';
import { RoomManager } from '../room';
import {
  deleteRoomSnapshot,
  loadRoomSnapshots,
  saveRoomSnapshot,
} from '../roomSnapshot';
import { GameHub, type ClientTransport } from '../protocolHandlers';

const POSITIONS: Position[] = ['N', 'E', 'S', 'W'];

const BOT: BotPersona = {
  id: 'bot-1',
  name: '小满',
  risk: 'normal',
  system: 'precision',
  conventions: [],
  randomness: 0,
};

let roomDir = '';
let matchDir = '';

beforeEach(() => {
  roomDir = mkdtempSync(join(tmpdir(), 'bridge-rooms-'));
  matchDir = mkdtempSync(join(tmpdir(), 'bridge-matches-'));
  process.env.ROOM_DATA_DIR = roomDir;
  process.env.MATCH_DATA_DIR = matchDir;
});

afterEach(() => {
  delete process.env.ROOM_DATA_DIR;
  delete process.env.MATCH_DATA_DIR;
  rmSync(roomDir, { recursive: true, force: true });
  rmSync(matchDir, { recursive: true, force: true });
});

function fixedHands(): Record<Position, Hand> {
  const deck = createDeck();
  return {
    N: deck.slice(0, 13),
    E: deck.slice(13, 26),
    S: deck.slice(26, 39),
    W: deck.slice(39, 52),
  };
}

function botSeats(): Record<Position, EngineSeat> {
  return Object.fromEntries(
    POSITIONS.map((pos) => [
      pos,
      { kind: 'bot' as const, name: `机器人${pos}`, persona: { ...BOT, id: `bot-${pos}` } },
    ]),
  ) as Record<Position, EngineSeat>;
}

function fillWithBots(m: RoomManager, code = 'SNAP01'): void {
  for (const seat of POSITIONS) {
    if (m.getRoom(code).seats[seat].kind === 'open') {
      m.setSeat('p-host', code, seat, { kind: 'bot', persona: BOT });
    }
  }
}

function playingRoom(manager: RoomManager, code = 'SNAP01') {
  const room = manager.createRoom(
    { playerId: 'p-host', name: '房主' },
    { boards: 12, scoring: 'mp' },
    'S',
  );
  fillWithBots(manager, code);
  manager.startMatch('p-host', code);
  return room;
}

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
      if (this.messages[i].t === type) return this.messages[i] as Extract<ServerMessage, { t: T }>;
    }
    return undefined;
  }
}

describe('进行中房间快照', () => {
  it('原子写入并可恢复比赛状态与座位', () => {
    const manager = new RoomManager({ seedBase: 7, codes: ['SNAP01'] });
    const room = playingRoom(manager);

    const file = saveRoomSnapshot(room);
    expect(existsSync(file)).toBe(true);
    expect(file.endsWith('SNAP01.json')).toBe(true);
    expect(readdirSync(roomDir).filter((name) => name.endsWith('.tmp'))).toHaveLength(0);

    const snapshots = loadRoomSnapshots();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].room.code).toBe('SNAP01');
    expect(snapshots[0].match?.board?.index).toBe(1);

    const restoredManager = new RoomManager({ seedBase: 7 });
    expect(restoredManager.restoreRooms(snapshots)).toBe(1);
    const restored = restoredManager.getRoom('SNAP01');
    expect(restored.status).toBe('playing');
    expect(restored.config).toEqual(room.config);
    expect(restored.hostId).toBe('p-host');
    expect(restored.match?.board?.hands.N).toHaveLength(13);
    expect(restored.match?.board?.phase).toBe('bidding');

    const hostSeat = restored.seats.S;
    expect(hostSeat.kind).toBe('human');
    if (hostSeat.kind === 'human') expect(hostSeat.connected).toBe(false);

    // 重连后清除离线标记，不会立即托管
    restoredManager.markConnected('p-host');
    const afterReconnect = restored.seats.S;
    expect(afterReconnect.kind).toBe('human');
    if (afterReconnect.kind === 'human') expect(afterReconnect.connected).toBe(true);
    expect(restoredManager.takeoverExpired(restored, 60_000)).toBe(false);
  });

  it('恢复后若无人重连，超过宽限期由机器人接管', () => {
    let clock = 1_000;
    const manager = new RoomManager({ seedBase: 7, codes: ['SNAP02'], now: () => clock });
    const room = playingRoom(manager, 'SNAP02');
    saveRoomSnapshot(room);

    const restoredManager = new RoomManager({ seedBase: 7, now: () => clock });
    restoredManager.restoreRooms(loadRoomSnapshots());
    const restored = restoredManager.getRoom('SNAP02');

    clock += 60_001;
    expect(restoredManager.takeoverExpired(restored, 60_000)).toBe(true);
    expect(restored.seats.S.kind).toBe('bot');
    expect(restored.hostId).toBe('');
    expect(restored.match?.seats.S.kind).toBe('bot');

    // 托管记录随房间保存在内存中：原身份重连后收回
    restoredManager.markConnected('p-host');
    expect(restored.seats.S.kind).toBe('human');
    expect(restored.match?.seats.S.kind).toBe('human');
    expect(restored.hostId).toBe('p-host');
  });

  it('托管记录会写入快照，服务端重启后仍可收回座位', () => {
    let clock = 1_000;
    const manager = new RoomManager({ seedBase: 7, codes: ['SNAP04'], now: () => clock });
    const room = playingRoom(manager, 'SNAP04');
    manager.markDisconnected('p-host');
    clock += 60_000;
    expect(manager.takeoverExpired(room, 60_000)).toBe(true);
    saveRoomSnapshot(room);

    const restoredManager = new RoomManager({ seedBase: 7, now: () => clock });
    expect(restoredManager.restoreRooms(loadRoomSnapshots())).toBe(1);
    const restored = restoredManager.getRoom('SNAP04');
    expect(restored.seats.S.kind).toBe('bot');

    restoredManager.markConnected('p-host');
    expect(restored.seats.S.kind).toBe('human');
    expect(restored.match?.seats.S.kind).toBe('human');
  });

  it('主动托管标记随快照恢复，重启后仍由 AI 代打', () => {
    const manager = new RoomManager({ seedBase: 7, codes: ['SNAP05'] });
    const room = playingRoom(manager, 'SNAP05');
    manager.setAutoPlay('p-host', 'SNAP05', true);
    expect(room.autoPlay.S).toBe(true);
    saveRoomSnapshot(room);

    const restoredManager = new RoomManager({ seedBase: 7 });
    expect(restoredManager.restoreRooms(loadRoomSnapshots())).toBe(1);
    const restored = restoredManager.getRoom('SNAP05');
    expect(restored.seats.S.kind).toBe('human');
    expect(restored.autoPlay.S).toBe(true);
    expect(restored.match?.autoPlay.S).toBe(true);
    expect(restored.match?.pendingBotSeat()).toBe(restored.match?.board?.currentBidder);
  });

  it('损坏快照会被跳过，且支持删除', () => {
    const manager = new RoomManager({ seedBase: 7, codes: ['SNAP03'] });
    const room = playingRoom(manager, 'SNAP03');
    saveRoomSnapshot(room);
    writeFileSync(join(roomDir, 'BROKEN.json'), '{ not json', 'utf8');

    expect(loadRoomSnapshots()).toHaveLength(1);
    deleteRoomSnapshot('SNAP03');
    expect(loadRoomSnapshots()).toHaveLength(0);
  });

  it('比赛引擎快照可续跑，AI 随机状态一致', () => {
    const config = { boards: 12 as const, scoring: 'hcp-points' as const, seedBase: 123, matchId: 'm-snap' };
    const engine = new MatchEngine({ config, seats: botSeats() });
    engine.startBoard(1, { hands: fixedHands() });
    for (let i = 0; i < 10; i += 1) engine.runAiStep();

    const snapshot = engine.snapshot();
    expect(snapshot.rngState).not.toBeNull();
    const restored = MatchEngine.restore(snapshot);

    const originalSteps: string[] = [];
    const restoredSteps: string[] = [];
    let guard = 0;
    while (engine.board!.phase !== 'scored' && guard < 400) {
      originalSteps.push(JSON.stringify(engine.runAiStep()));
      guard += 1;
    }
    guard = 0;
    while (restored.board!.phase !== 'scored' && guard < 400) {
      restoredSteps.push(JSON.stringify(restored.runAiStep()));
      guard += 1;
    }

    expect(restoredSteps).toEqual(originalSteps);
    expect(restored.board!.score).toEqual(engine.board!.score);
    expect(restored.completed).toEqual(engine.completed);
    expect(restored.snapshot().rngState).toBe(engine.snapshot().rngState);
  });

  it('GameHub 重启后自动恢复房间并让客户端重新入座', () => {
    const timers: Array<() => void> = [];
    const manager = new RoomManager({ seedBase: 1, codes: ['HUB001'] });
    const hub = new GameHub({
      rooms: manager,
      persist: true,
      aiDelayMs: 0,
      now: () => 1_700_000_000_000,
      setTimer: (fn) => {
        timers.push(fn);
        return 0 as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: () => undefined,
    });
    const host = new FakeTransport();
    hub.connect('p-host', 'tok', '房主', host);
    hub.receive('p-host', {
      v: 1,
      t: 'createRoom',
      config: { boards: 12, scoring: 'hcp-points' },
      seat: 'S',
    });
    for (const seat of ['N', 'E', 'W'] as Position[]) {
      hub.receive('p-host', {
        v: 1,
        t: 'setSeat',
        seat,
        occupant: { kind: 'bot', persona: BOT },
      });
    }
    hub.receive('p-host', { v: 1, t: 'startMatch' });

    expect(loadRoomSnapshots()).toHaveLength(1);

    // 模拟进程重启：新 RoomManager + 新 GameHub
    const restoredManager = new RoomManager({ seedBase: 1 });
    expect(restoredManager.restoreRooms(loadRoomSnapshots())).toBe(1);
    const restoredHub = new GameHub({
      rooms: restoredManager,
      persist: true,
      aiDelayMs: 0,
      now: () => 1_700_000_000_000,
      setTimer: (fn) => {
        timers.push(fn);
        return 0 as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: () => undefined,
    });
    restoredHub.resume();

    const reconnect = new FakeTransport();
    restoredHub.connect('p-host', 'tok', '房主', reconnect);
    const view = reconnect.lastOfType('room')?.room;
    expect(view?.code).toBe('HUB001');
    expect(view?.status).toBe('playing');
    expect(view?.you.seat).toBe('S');
    expect(view?.board?.index).toBe(1);
    expect(view?.seats.S.kind).toBe('human');
  });
});
