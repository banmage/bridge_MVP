import type { Position } from '../src/models/gameState';
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type ErrorCode,
  type ServerMessage,
} from '../shared/protocol';
import { MatchError } from './match';
import { recordFromRoom, saveMatchRecord } from './persistence';
import { normalizeName, RoomManager, type Room } from './room';
import { projectRoomView } from './view';

/**
 * WebSocket 报文分发（与具体 ws 实例解耦，便于单元测试）。
 *
 * - 身份：首次 hello 绑定 token，后续必须一致；
 * - 重复连接：新连接生效，旧连接收到 DUPLICATE_SESSION 后关闭；
 * - 所有动作先校验后提交，错误不改变对局状态；
 * - 状态变更后向房内所有连接广播全量视角快照。
 */

export interface ClientTransport {
  send(message: ServerMessage): void;
  close(): void;
}

export interface GameHubOptions {
  rooms?: RoomManager;
  now?: () => number;
  /** 机器人行动间隔（毫秒） */
  aiDelayMs?: number;
  /** 用来覆盖测试中的定时器（默认 setTimeout） */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  /** 是否落盘（测试可关闭） */
  persist?: boolean;
}

interface Client {
  playerId: string;
  name: string;
  token: string;
  transport: ClientTransport;
  roomCode: string | null;
  lastSeenAt: number;
}

interface Identity {
  token: string;
  name: string;
}

function err(code: ErrorCode, message: string): ServerMessage {
  return { v: PROTOCOL_VERSION, t: 'error', code, message };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export class GameHub {
  readonly rooms: RoomManager;
  private readonly clients = new Map<string, Client>();
  private readonly identities = new Map<string, Identity>();
  private readonly aiTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly persisted = new Set<string>();
  private readonly now: () => number;
  private readonly aiDelayMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  private readonly persist: boolean;

  constructor(options: GameHubOptions = {}) {
    this.rooms = options.rooms ?? new RoomManager();
    this.now = options.now ?? Date.now;
    this.aiDelayMs = options.aiDelayMs ?? 700;
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
    this.persist = options.persist ?? true;
  }

  /* ---------------------------------------------------------------- *
   * 连接
   * ---------------------------------------------------------------- */

  connect(playerId: string, token: string, name: string, transport: ClientTransport): boolean {
    if (!playerId || !token) {
      transport.send(err('AUTH_FAILED', '缺少身份信息'));
      transport.close();
      return false;
    }

    const identity = this.identities.get(playerId);
    if (identity && identity.token !== token) {
      transport.send(err('AUTH_FAILED', '重连令牌不匹配'));
      transport.close();
      return false;
    }
    if (!identity) {
      this.identities.set(playerId, { token, name: normalizeName(name, playerId) });
    }

    const previous = this.clients.get(playerId);
    if (previous) {
      previous.transport.send(err('DUPLICATE_SESSION', '该身份已在其他地方连接'));
      previous.transport.close();
    }

    const client: Client = {
      playerId,
      name: normalizeName(name, playerId),
      token,
      transport,
      roomCode: previous?.roomCode ?? null,
      lastSeenAt: this.now(),
    };
    this.clients.set(playerId, client);
    transport.send({ v: PROTOCOL_VERSION, t: 'hello', playerId, name: client.name });

    const room = this.rooms.markConnected(playerId);
    if (room) {
      client.roomCode = room.code;
      this.broadcast(room);
      this.scheduleAi(room);
    }
    return true;
  }

  /** 断开连接：保留座位以便重连；仅当仍是当前连接时生效 */
  disconnect(playerId: string, transport?: ClientTransport): void {
    const client = this.clients.get(playerId);
    if (!client) return;
    if (transport && client.transport !== transport) return;
    this.clients.delete(playerId);
    const room = this.rooms.markDisconnected(playerId);
    if (room) this.broadcast(room);
  }

  closeAll(): void {
    for (const timer of this.aiTimers.values()) this.clearTimer(timer);
    this.aiTimers.clear();
    for (const client of this.clients.values()) client.transport.close();
    this.clients.clear();
  }

  /* ---------------------------------------------------------------- *
   * 报文
   * ---------------------------------------------------------------- */

  receive(playerId: string, raw: unknown): void {
    const client = this.clients.get(playerId);
    if (!client) return;
    client.lastSeenAt = this.now();

    let data: unknown = raw;
    if (typeof raw === 'string') {
      try {
        data = JSON.parse(raw);
      } catch {
        client.transport.send(err('BAD_REQUEST', '报文不是合法 JSON'));
        return;
      }
    }
    if (!isObject(data) || typeof data.t !== 'string') {
      client.transport.send(err('BAD_REQUEST', '报文格式错误'));
      return;
    }
    if (data.v !== PROTOCOL_VERSION) {
      client.transport.send(err('BAD_REQUEST', '协议版本不支持'));
      client.transport.close();
      return;
    }

    const message = data as unknown as ClientMessage;
    try {
      this.dispatch(client, message);
    } catch (error) {
      if (error instanceof MatchError) {
        client.transport.send(err(error.code, error.message));
        return;
      }
      client.transport.send(
        err('BAD_REQUEST', error instanceof Error ? error.message : '未知错误'),
      );
    }
  }

  private dispatch(client: Client, msg: ClientMessage): void {
    switch (msg.t) {
      case 'hello': {
        client.transport.send({
          v: PROTOCOL_VERSION,
          t: 'hello',
          playerId: client.playerId,
          name: client.name,
        });
        return;
      }
      case 'setName': {
        client.name = normalizeName(msg.name, client.name);
        const identity = this.identities.get(client.playerId);
        if (identity) identity.name = client.name;
        const room = client.roomCode ? this.rooms.getRoom(client.roomCode) : null;
        if (room) {
          this.rooms.renamePlayer(room, client.playerId, client.name);
          this.broadcast(room);
        } else {
          client.transport.send({
            v: PROTOCOL_VERSION,
            t: 'hello',
            playerId: client.playerId,
            name: client.name,
          });
        }
        return;
      }
      case 'createRoom': {
        const room = this.rooms.createRoom(
          { playerId: client.playerId, name: client.name, token: client.token },
          msg.config,
          msg.seat,
        );
        client.roomCode = room.code;
        this.broadcast(room);
        return;
      }
      case 'joinRoom': {
        const room = this.rooms.joinRoom(
          { playerId: client.playerId, name: client.name, token: client.token },
          msg.code,
          msg.seat,
        );
        client.roomCode = room.code;
        this.broadcast(room);
        this.scheduleAi(room);
        return;
      }
      case 'leaveRoom': {
        const room = this.rooms.leaveRoom(client.playerId, client.roomCode ?? undefined);
        client.roomCode = null;
        if (room) this.broadcast(room);
        return;
      }
      case 'setSeat': {
        const room = this.requireRoom(client);
        this.rooms.setSeat(client.playerId, room.code, msg.seat, msg.occupant);
        this.broadcast(room);
        return;
      }
      case 'updateBot': {
        const room = this.requireRoom(client);
        this.rooms.updateBot(client.playerId, room.code, msg.seat, msg.persona);
        this.broadcast(room);
        return;
      }
      case 'setConfig': {
        const room = this.requireRoom(client);
        this.rooms.setConfig(client.playerId, room.code, msg.config);
        this.broadcast(room);
        return;
      }
      case 'startMatch': {
        const room = this.requireRoom(client);
        this.rooms.startMatch(client.playerId, room.code);
        this.afterAction(room);
        return;
      }
      case 'bid': {
        const room = this.requireRoom(client);
        this.rooms.submitBid(client.playerId, room.code, msg.call, msg.alert);
        this.afterAction(room);
        return;
      }
      case 'play': {
        const room = this.requireRoom(client);
        this.rooms.submitPlay(client.playerId, room.code, msg.card);
        this.afterAction(room);
        return;
      }
      case 'nextBoard': {
        const room = this.requireRoom(client);
        this.rooms.nextBoard(client.playerId, room.code);
        this.afterAction(room);
        return;
      }
      case 'chat': {
        const room = this.requireRoom(client);
        this.rooms.addChat(room, client.playerId, msg.text);
        this.broadcast(room);
        return;
      }
      case 'requestState': {
        const room = this.requireRoom(client);
        this.sendRoom(client, room);
        return;
      }
      case 'ping': {
        client.transport.send({ v: PROTOCOL_VERSION, t: 'pong' });
        return;
      }
      default: {
        // 未知报文类型：前向兼容，忽略
        return;
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * 广播 / AI 调度 / 自动开副
   * ---------------------------------------------------------------- */

  /** 每秒调用：处理结算后 10 秒自动开下一副 */
  tick(): void {
    for (const room of this.rooms.rooms.values()) {
      if (room.status !== 'playing' || !room.match) continue;
      if (room.nextBoardAt !== null && this.now() >= room.nextBoardAt) {
        room.nextBoardAt = null;
        try {
          room.match.nextBoard();
        } catch {
          room.status = room.match.status === 'finished' ? 'finished' : room.status;
          continue;
        }
        this.afterAction(room);
      }
    }
  }

  /** 当前房间是否在等待机器人行动（测试/健康检查用） */
  hasAiTimer(code: string): boolean {
    return this.aiTimers.has(code);
  }

  private afterAction(room: Room): void {
    const finished = this.rooms.noteSettlement(room);
    if (finished) this.persistRoom(room);
    this.broadcast(room);
    this.scheduleAi(room);
  }

  private persistRoom(room: Room): void {
    const matchId = room.config.matchId;
    if (!this.persist || this.persisted.has(matchId) || !room.match) return;
    try {
      saveMatchRecord(recordFromRoom(room, this.now()));
      this.persisted.add(matchId);
    } catch {
      // 落盘失败不阻断对局；下一次结算/查询仍可重试
    }
  }

  private scheduleAi(room: Room): void {
    if (room.status !== 'playing' || !room.match) return;
    if (this.aiTimers.has(room.code)) return;
    if (!room.match.pendingBotSeat()) return;

    const timer = this.setTimer(() => {
      this.aiTimers.delete(room.code);
      if (room.status !== 'playing' || !room.match) return;
      try {
        const step = room.match.runAiStep();
        if (!step) return;
        this.afterAction(room);
      } catch {
        // 机器人异常时停止推进，避免死循环；真人可继续操作或房主重开
        this.broadcast(room);
      }
    }, this.aiDelayMs);
    const maybeUnref = timer as unknown as { unref?: () => void };
    maybeUnref.unref?.();
    this.aiTimers.set(room.code, timer);
  }

  private broadcast(room: Room): void {
    for (const client of this.clients.values()) {
      if (client.roomCode === room.code) this.sendRoom(client, room);
    }
  }

  private sendRoom(client: Client, room: Room): void {
    client.transport.send({
      v: PROTOCOL_VERSION,
      t: 'room',
      room: projectRoomView(room, client.playerId, this.now()),
    });
  }

  private requireRoom(client: Client): Room {
    if (!client.roomCode) throw new MatchError('NOT_IN_ROOM', '你尚未加入房间');
    return this.rooms.getRoom(client.roomCode);
  }
}

export type { Position };
