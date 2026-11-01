import type { Position } from '../src/models/gameState';
import { ORDER } from '../src/models/gameState';
import {
  isBoardCount,
  isScoringMode,
  PROTOCOL_VERSION,
  type ChatMessage,
  type MatchConfig,
  type RoomConfigInput,
  type RoomStatus,
  type SeatInput,
  type SeatOccupant,
  type BotPersona,
} from '../shared/protocol';
import { MatchEngine, MatchError, type BoardRecord, type EngineSeat } from './match';
import type { ReferenceInput } from './match';
import { defaultPersonaFor, sanitizePersona } from './personas';
import { simulateReferenceScores } from './reference';

/**
 * 房间生命周期：建房、加入、座位、房主转移、开赛、离开/机器人接管。
 *
 * 本模块不依赖网络层，便于单元测试；WebSocket 分发见 `protocolHandlers.ts`。
 */

const POSITIONS: Position[] = ORDER;

const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const CODE_LENGTH = 6;
const MAX_CHAT = 50;
const MAX_CHAT_TEXT = 200;

export interface RoomPlayer {
  playerId: string;
  name: string;
  /** 本机重连令牌，仅供身份校验，不下发 */
  token?: string;
}

export interface Room {
  code: string;
  hostId: string;
  status: RoomStatus;
  config: MatchConfig;
  seats: Record<Position, SeatOccupant>;
  match: MatchEngine | null;
  chat: ChatMessage[];
  /** 加入顺序（首位为房主），用于房主转移 */
  joinOrder: string[];
  createdAt: number;
  updatedAt: number;
  /** 结算后自动开下一副的时间（epoch ms） */
  nextBoardAt: number | null;
}

export interface RoomManagerOptions {
  /** 固定种子基值（测试用） */
  seedBase?: number;
  /** 固定房间码（测试用，按创建顺序取用） */
  codes?: string[];
  /** MP 对照场注入（测试可简化） */
  referenceScores?: (input: ReferenceInput) => number[];
  /** 时钟注入（测试用） */
  now?: () => number;
  /** 结算后自动开下一副的延迟（默认 10 秒） */
  autoNextMs?: number;
}

function openSeats(): Record<Position, SeatOccupant> {
  return { N: { kind: 'open' }, E: { kind: 'open' }, S: { kind: 'open' }, W: { kind: 'open' } };
}

function randomSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private readonly seedBase?: number;
  private readonly codes: string[];
  private readonly referenceScores?: (input: ReferenceInput) => number[];
  private readonly now: () => number;
  private readonly autoNextMs: number;
  /** 断线起始时间：playerId → epoch ms（不进入视角快照） */
  private readonly awaySince = new Map<string, number>();

  constructor(options: RoomManagerOptions = {}) {
    this.seedBase = options.seedBase;
    this.codes = [...(options.codes ?? [])];
    this.referenceScores = options.referenceScores ?? simulateReferenceScores;
    this.now = options.now ?? Date.now;
    this.autoNextMs = options.autoNextMs ?? 10_000;
  }

  /* ---------------------------------------------------------------- *
   * 查询
   * ---------------------------------------------------------------- */

  getRoom(code: string): Room {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) throw new MatchError('ROOM_NOT_FOUND', '房间不存在或已解散');
    return room;
  }

  findRoomOf(playerId: string): Room | null {
    for (const room of this.rooms.values()) {
      if (room.hostId === playerId) return room;
      if (POSITIONS.some((pos) => {
        const seat = room.seats[pos];
        return seat.kind === 'human' && seat.playerId === playerId;
      })) {
        return room;
      }
    }
    return null;
  }

  seatOf(room: Room, playerId: string): Position | null {
    for (const pos of POSITIONS) {
      const seat = room.seats[pos];
      if (seat.kind === 'human' && seat.playerId === playerId) return pos;
    }
    return null;
  }

  isHost(room: Room, playerId: string): boolean {
    return room.hostId === playerId;
  }

  /* ---------------------------------------------------------------- *
   * 建房 / 加入 / 离开
   * ---------------------------------------------------------------- */

  createRoom(player: RoomPlayer, config: RoomConfigInput, seat: Position): Room {
    this.assertConfig(config);
    this.assertPosition(seat);
    const code = this.allocateCode();
    const now = this.now();
    const seats = openSeats();
    seats[seat] = {
      kind: 'human',
      playerId: player.playerId,
      name: normalizeName(player.name, player.playerId),
      connected: true,
    };
    const room: Room = {
      code,
      hostId: player.playerId,
      status: 'lobby',
      config: {
        boards: config.boards,
        scoring: config.scoring,
        seedBase: this.seedBase ?? randomSeed(),
        matchId: `m_${now.toString(36)}_${code.toLowerCase()}`,
      },
      seats,
      match: null,
      chat: [],
      joinOrder: [player.playerId],
      createdAt: now,
      updatedAt: now,
      nextBoardAt: null,
    };
    this.rooms.set(code, room);
    return room;
  }

  joinRoom(player: RoomPlayer, code: string, seat?: Position): Room {
    const room = this.getRoom(code);
    if (seat !== undefined) this.assertPosition(seat);

    const existing = this.seatOf(room, player.playerId);
    if (existing) {
      // 重连：恢复在线状态，不改变座位
      const current = room.seats[existing];
      if (current.kind === 'human') current.connected = true;
      this.awaySince.delete(player.playerId);
      room.updatedAt = this.now();
      return room;
    }

    if (room.status !== 'lobby') {
      throw new MatchError('WRONG_PHASE', '比赛已开始，无法加入');
    }

    const target = seat ?? this.firstOpenSeat(room);
    if (!target) throw new MatchError('ROOM_FULL', '房间已满');
    if (room.seats[target].kind !== 'open') {
      throw new MatchError('SEAT_TAKEN', `${target} 座已被占用`);
    }

    room.seats[target] = {
      kind: 'human',
      playerId: player.playerId,
      name: normalizeName(player.name, player.playerId),
      connected: true,
    };
    room.joinOrder.push(player.playerId);
    room.updatedAt = this.now();
    return room;
  }

  /** 主动离开房间；返回 null 表示房间已销毁 */
  leaveRoom(playerId: string, code?: string): Room | null {
    const room = code ? this.getRoom(code) : this.findRoomOf(playerId);
    if (!room) throw new MatchError('NOT_IN_ROOM', '你不在任何房间中');
    this.awaySince.delete(playerId);

    const seat = this.seatOf(room, playerId);
    room.joinOrder = room.joinOrder.filter((id) => id !== playerId);

    if (room.status === 'lobby') {
      if (seat) room.seats[seat] = { kind: 'open' };
      if (room.joinOrder.length === 0) {
        this.rooms.delete(room.code);
        return null;
      }
      if (room.hostId === playerId) room.hostId = room.joinOrder[0];
      room.updatedAt = this.now();
      return room;
    }

    // 开赛后离开：机器人接管，保证比赛可完成
    if (seat) this.takeover(room, seat);
    room.updatedAt = this.now();
    return room;
  }

  /** 连接断开：保留座位与手牌，仅标记离线（可重连） */
  markDisconnected(playerId: string): Room | null {
    const room = this.findRoomOf(playerId);
    if (!room) return null;
    const seat = this.seatOf(room, playerId);
    if (seat) {
      const current = room.seats[seat];
      if (current.kind === 'human') current.connected = false;
      this.awaySince.set(playerId, this.now());
      room.updatedAt = this.now();
    }
    return room;
  }

  markConnected(playerId: string): Room | null {
    const room = this.findRoomOf(playerId);
    if (!room) return null;
    const seat = this.seatOf(room, playerId);
    if (seat) {
      const current = room.seats[seat];
      if (current.kind === 'human') current.connected = true;
      this.awaySince.delete(playerId);
      room.updatedAt = this.now();
    }
    return room;
  }

  /**
   * 开赛后断线超时托管：超过 `timeoutMs` 未重连的真人座位转为机器人，
   * 防止永久离线玩家卡住比赛。返回是否发生了接管。
   */
  takeoverExpired(room: Room, timeoutMs: number): boolean {
    if (room.status !== 'playing' || !room.match || timeoutMs <= 0) return false;
    const now = this.now();
    let changed = false;
    for (const seat of POSITIONS) {
      const current = room.seats[seat];
      if (current.kind !== 'human' || current.connected) continue;
      const since = this.awaySince.get(current.playerId);
      if (since === undefined) {
        this.awaySince.set(current.playerId, now);
        continue;
      }
      if (now - since < timeoutMs) continue;
      room.joinOrder = room.joinOrder.filter((id) => id !== current.playerId);
      this.awaySince.delete(current.playerId);
      this.takeover(room, seat);
      changed = true;
    }
    if (changed) room.updatedAt = now;
    return changed;
  }

  /* ---------------------------------------------------------------- *
   * 座位 / 配置（仅 lobby）
   * ---------------------------------------------------------------- */

  setSeat(playerId: string, code: string, seat: Position, input: SeatInput): Room {
    const room = this.getRoom(code);
    this.assertHost(room, playerId);
    this.assertLobby(room);
    this.assertPosition(seat);

    if (input.kind === 'open') {
      const current = room.seats[seat];
      if (current.kind === 'human') {
        const leaving = current.playerId;
        room.joinOrder = room.joinOrder.filter((id) => id !== leaving);
        if (leaving === room.hostId) {
          if (room.joinOrder.length === 0) throw new MatchError('WRONG_PHASE', '房主不能清空自己的座位');
          room.hostId = room.joinOrder[0];
        }
      }
      room.seats[seat] = { kind: 'open' };
    } else {
      if (room.seats[seat].kind === 'human') {
        const leaving = (room.seats[seat] as Extract<SeatOccupant, { kind: 'human' }>).playerId;
        room.joinOrder = room.joinOrder.filter((id) => id !== leaving);
        if (leaving === room.hostId) {
          if (room.joinOrder.length === 0) throw new MatchError('WRONG_PHASE', '房主不能替换自己的座位');
          room.hostId = room.joinOrder[0];
        }
      }
      room.seats[seat] = { kind: 'bot', persona: sanitizePersona(input.persona) };
    }
    room.updatedAt = this.now();
    return room;
  }

  updateBot(playerId: string, code: string, seat: Position, persona: BotPersona): Room {
    const room = this.getRoom(code);
    this.assertHost(room, playerId);
    this.assertLobby(room);
    this.assertPosition(seat);
    if (room.seats[seat].kind !== 'bot') {
      throw new MatchError('WRONG_PHASE', '该座位不是机器人');
    }
    room.seats[seat] = { kind: 'bot', persona: sanitizePersona(persona) };
    room.updatedAt = this.now();
    return room;
  }

  setConfig(playerId: string, code: string, config: RoomConfigInput): Room {
    const room = this.getRoom(code);
    this.assertHost(room, playerId);
    this.assertLobby(room);
    this.assertConfig(config);
    room.config = { ...room.config, boards: config.boards, scoring: config.scoring };
    room.updatedAt = this.now();
    return room;
  }

  /* ---------------------------------------------------------------- *
   * 开赛 / 对局动作
   * ---------------------------------------------------------------- */

  startMatch(playerId: string, code: string): Room {
    const room = this.getRoom(code);
    this.assertHost(room, playerId);
    this.assertLobby(room);

    for (const pos of POSITIONS) {
      if (room.seats[pos].kind === 'open') {
        throw new MatchError('SEATS_NOT_FULL', '还有空座位，无法开赛');
      }
    }

    const seats = {} as Record<Position, EngineSeat>;
    for (const pos of POSITIONS) {
      const seat = room.seats[pos];
      if (seat.kind === 'human') {
        seats[pos] = { kind: 'human', playerId: seat.playerId, name: seat.name };
      } else if (seat.kind === 'bot') {
        seats[pos] = { kind: 'bot', name: seat.persona.name, persona: { ...seat.persona } };
      }
    }

    room.match = new MatchEngine({
      config: { ...room.config },
      seats,
      ...(this.referenceScores ? { referenceScores: this.referenceScores } : {}),
    });
    room.status = 'playing';
    room.nextBoardAt = null;
    room.match.start();
    room.updatedAt = this.now();
    return room;
  }

  submitBid(playerId: string, code: string, call: Parameters<MatchEngine['submitBid']>[1], alert?: { text: string }): Room {
    const room = this.requirePlayingRoom(playerId, code);
    room.match!.submitBid(playerId, call, alert);
    room.updatedAt = this.now();
    return room;
  }

  submitPlay(playerId: string, code: string, card: number): Room {
    const room = this.requirePlayingRoom(playerId, code);
    room.match!.submitPlay(playerId, card);
    room.updatedAt = this.now();
    return room;
  }

  /** 结算后开始下一副；返回 false 表示比赛结束/不可推进 */
  nextBoard(playerId: string, code: string): boolean {
    const room = this.getRoom(code);
    if (!this.seatOf(room, playerId)) throw new MatchError('NOT_IN_ROOM', '你不在该房间');
    if (room.status !== 'playing' || !room.match) {
      throw new MatchError('WRONG_PHASE', '比赛尚未开始或已结束');
    }
    if (room.match.status === 'finished') {
      room.status = 'finished';
      return false;
    }
    if (room.match.board?.phase !== 'scored') {
      throw new MatchError('WRONG_PHASE', '当前副尚未结算');
    }
    room.match.nextBoard();
    room.nextBoardAt = null;
    room.updatedAt = this.now();
    return true;
  }

  /** 记录本副结算时间并返回是否刚结束 */
  noteSettlement(room: Room): boolean {
    if (!room.match || room.match.board?.phase !== 'scored') return false;
    if (room.match.status === 'finished') {
      room.status = 'finished';
      room.nextBoardAt = null;
      return true;
    }
    if (room.nextBoardAt === null) {
      room.nextBoardAt = this.now() + this.autoNextMs;
    }
    return false;
  }

  /* ---------------------------------------------------------------- *
   * 聊天
   * ---------------------------------------------------------------- */

  renamePlayer(room: Room, playerId: string, name: string): Room {
    const seat = this.seatOf(room, playerId);
    if (seat) {
      const current = room.seats[seat];
      if (current.kind === 'human') current.name = normalizeName(name, current.name);
      room.updatedAt = this.now();
    }
    return room;
  }

  addChat(room: Room, playerId: string, text: string): ChatMessage {
    const trimmed = String(text ?? '').trim().slice(0, MAX_CHAT_TEXT);
    if (!trimmed) throw new MatchError('BAD_REQUEST', '聊天内容不能为空');
    const seat = this.seatOf(room, playerId);
    const from =
      seat && room.seats[seat].kind === 'human'
        ? (room.seats[seat] as Extract<SeatOccupant, { kind: 'human' }>).name
        : '观众';
    const message: ChatMessage = {
      id: `c_${this.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      at: this.now(),
      from,
      seat,
      text: trimmed,
    };
    room.chat.push(message);
    if (room.chat.length > MAX_CHAT) room.chat.splice(0, room.chat.length - MAX_CHAT);
    room.updatedAt = this.now();
    return message;
  }

  /* ---------------------------------------------------------------- *
   * 记录
   * ---------------------------------------------------------------- */

  records(room: Room): BoardRecord[] {
    return room.match?.completed ? [...room.match.completed] : [];
  }

  /* ---------------------------------------------------------------- *
   * 内部
   * ---------------------------------------------------------------- */

  private takeover(room: Room, seat: Position): void {
    const current = room.seats[seat];
    const name = current.kind === 'human' ? current.name : '玩家';
    const previousPlayerId = current.kind === 'human' ? current.playerId : null;
    const persona = defaultPersonaFor(`${name}的托管`, `takeover-${seat}-${this.now()}`);
    room.seats[seat] = { kind: 'bot', persona };
    if (room.match) {
      room.match.takeoverSeat(seat, persona);
      room.match.seats = { ...room.match.seats };
    }
    if (previousPlayerId && room.hostId === previousPlayerId) {
      this.reassignHost(room);
    }
  }

  /** 房主失效后转给仍在座的真人家；无真人时置空，避免“幽灵房主”找回房间 */
  private reassignHost(room: Room): void {
    const next = room.joinOrder.find((id) =>
      POSITIONS.some((pos) => {
        const seat = room.seats[pos];
        return seat.kind === 'human' && seat.playerId === id;
      }),
    );
    room.hostId = next ?? '';
  }

  private requirePlayingRoom(playerId: string, code: string): Room {
    const room = this.getRoom(code);
    if (room.status !== 'playing' || !room.match) {
      throw new MatchError('WRONG_PHASE', '比赛未在进行中');
    }
    const seat = this.seatOf(room, playerId);
    if (!seat) throw new MatchError('NOT_IN_ROOM', '你不在该房间');
    return room;
  }

  private assertHost(room: Room, playerId: string): void {
    if (room.hostId !== playerId) throw new MatchError('NOT_HOST', '只有房主可以执行该操作');
  }

  private assertLobby(room: Room): void {
    if (room.status !== 'lobby') throw new MatchError('WRONG_PHASE', '开赛后座位与配置不可修改');
  }

  private assertConfig(config: RoomConfigInput): void {
    if (!config || !isBoardCount(config.boards) || !isScoringMode(config.scoring)) {
      throw new MatchError('INVALID_CONFIG', '副数只能是 12/18/24，计分模式只能是 mp/hcp-points');
    }
  }

  private assertPosition(seat: Position): void {
    if (!POSITIONS.includes(seat)) throw new MatchError('BAD_REQUEST', '座位必须是 N/E/S/W');
  }

  private firstOpenSeat(room: Room): Position | null {
    for (const pos of POSITIONS) {
      if (room.seats[pos].kind === 'open') return pos;
    }
    return null;
  }

  private allocateCode(): string {
    const forced = this.codes.shift();
    if (forced) {
      if (this.rooms.has(forced)) throw new MatchError('INVALID_CONFIG', '测试房间码重复');
      return forced;
    }
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i += 1) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new MatchError('INVALID_CONFIG', '无法分配房间码');
  }
}

export function normalizeName(name: string, fallback: string): string {
  const value = String(name ?? '').trim().slice(0, 20);
  return value || fallback.slice(0, 8);
}

export const SERVER_PROTOCOL_VERSION = PROTOCOL_VERSION;
