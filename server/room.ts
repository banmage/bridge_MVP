import type { Position } from '../src/models/gameState';
import { getSide, ORDER } from '../src/models/gameState';
import {
  DEFAULT_BIDDING_SYSTEMS,
  isBoardCount,
  isScoringMode,
  normalizeBiddingSystems,
  PROTOCOL_VERSION,
  type BiddingSystem,
  type BiddingSystems,
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
import { roomFromSnapshot, type RoomSnapshot } from './roomSnapshot';

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

/** 被机器人托管的真人座位：保留原主身份，允许同一 playerId 重连后收回 */
export interface SeatTakeover {
  playerId: string;
  name: string;
  /** 接管发生时间（epoch ms） */
  at: number;
}

export interface Room {
  code: string;
  hostId: string;
  status: RoomStatus;
  config: MatchConfig;
  seats: Record<Position, SeatOccupant>;
  /** 主动托管：真人座位仍保留，但由 AI 代叫/代打 */
  autoPlay: Partial<Record<Position, boolean>>;
  match: MatchEngine | null;
  chat: ChatMessage[];
  /** 加入顺序（首位为房主），用于房主转移 */
  joinOrder: string[];
  /** 超时托管记录：座位 → 原真人身份（主动离开不记录） */
  takeovers: Partial<Record<Position, SeatTakeover>>;
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

  /**
   * 从磁盘快照恢复房间。进程重启后所有连接均已断开：
   * 真人座位先标记离线，并重新开始 `BOT_TAKEOVER_MS` 倒计时；
   * 客户端重连后由 `markConnected` 清除计时。
   */
  restoreRooms(snapshots: RoomSnapshot[]): number {
    let restored = 0;
    for (const snapshot of snapshots) {
      try {
        const room = roomFromSnapshot(snapshot, {
          ...(this.referenceScores ? { referenceScores: this.referenceScores } : {}),
        });
        if (this.rooms.has(room.code)) continue;
        for (const pos of POSITIONS) {
          const seat = room.seats[pos];
          if (seat.kind === 'human') {
            seat.connected = false;
            this.awaySince.set(seat.playerId, this.now());
          }
        }
        this.rooms.set(room.code, room);
        restored += 1;
      } catch {
        // 单条快照损坏不影响其他房间恢复
      }
    }
    return restored;
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
      // 被托管但保留原主身份：重连时仍需找回房间以自动收回座位
      if (POSITIONS.some((pos) => room.takeovers[pos]?.playerId === playerId)) {
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
        systems: normalizeBiddingSystems(config.systems, DEFAULT_BIDDING_SYSTEMS),
      },
      seats,
      autoPlay: {},
      match: null,
      chat: [],
      joinOrder: [player.playerId],
      takeovers: {},
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

    // 座位曾被超时托管：同一身份回来时优先收回原座位（开赛后也允许）
    if (this.reclaimSeat(room, player.playerId)) return room;

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
    // 主动离开是明确意愿：撤销该身份的座位收回权
    for (const pos of POSITIONS) {
      if (room.takeovers[pos]?.playerId === playerId) delete room.takeovers[pos];
    }

    const seat = this.seatOf(room, playerId);
    if (seat) delete room.autoPlay[seat];
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

    // 开赛后离开：机器人接管，保证比赛可完成（主动离开不保留收回权）
    if (seat) this.takeover(room, seat, false);
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
    // 超时托管后重连：自动收回原座位，避免人类回来却只能看机器人替自己打
    if (this.reclaimSeat(room, playerId)) return room;
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

    delete room.autoPlay[seat];
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
      const persona = sanitizePersona(input.persona);
      room.seats[seat] = { kind: 'bot', persona };
      // 同方体系保持一致：设置一方机器人时同步同伴与房间配置
      this.setSideSystem(room, getSide(seat), persona.system);
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
    const sanitized = sanitizePersona(persona);
    room.seats[seat] = { kind: 'bot', persona: sanitized };
    // 修改一方机器人体系时，同伴自动切换为同一体系
    this.setSideSystem(room, getSide(seat), sanitized.system);
    room.updatedAt = this.now();
    return room;
  }

  setConfig(playerId: string, code: string, config: RoomConfigInput): Room {
    const room = this.getRoom(code);
    this.assertHost(room, playerId);
    this.assertLobby(room);
    this.assertConfig(config);
    const systems = normalizeBiddingSystems(config.systems, this.systemsOf(room));
    room.config = { ...room.config, boards: config.boards, scoring: config.scoring, systems };
    this.syncSystems(room);
    room.updatedAt = this.now();
    return room;
  }

  /** 主动托管：保留真人座位，交给 AI 代叫/代打；可随时解除 */
  setAutoPlay(playerId: string, code: string, enabled: boolean): Room {
    const room = this.requirePlayingRoom(playerId, code);
    const seat = this.seatOf(room, playerId);
    if (!seat || room.seats[seat].kind !== 'human') {
      throw new MatchError('WRONG_PHASE', '只有自己的真人座位可以托管');
    }
    if (enabled) room.autoPlay = { ...room.autoPlay, [seat]: true };
    else {
      const next = { ...room.autoPlay };
      delete next[seat];
      room.autoPlay = next;
    }
    room.match!.setAutoPlay(seat, enabled);
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

    // 开赛前再同步一次：保证同方同伴体系一致，旧配置也补上默认精确体系。
    // 每次开赛生成新的比赛 ID；正式房间同时换新种子，避免重开时复现同一副牌。
    const now = this.now();
    room.config = {
      ...room.config,
      matchId: `m_${now.toString(36)}_${room.code.toLowerCase()}_${Math.random().toString(36).slice(2, 8)}`,
      seedBase: this.seedBase ?? randomSeed(),
      systems: normalizeBiddingSystems(room.config.systems, DEFAULT_BIDDING_SYSTEMS),
    };
    this.syncSystems(room);

    const seats = {} as Record<Position, EngineSeat>;
    for (const pos of POSITIONS) {
      const seat = room.seats[pos];
      if (seat.kind === 'human') {
        seats[pos] = { kind: 'human', playerId: seat.playerId, name: seat.name };
      } else if (seat.kind === 'bot') {
        seats[pos] = { kind: 'bot', name: seat.persona.name, persona: { ...seat.persona } };
      }
    }

    room.autoPlay = {};
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

  /**
   * 房主提前结束当前比赛并回到大厅：保留座位与配置，便于重新开赛。
   * 断线超时托管产生的机器人座位会还原为原真人（离线），
   * 原玩家仍可用同一身份收回；房主也可在座位面板重新设为机器人或空位。
   */
  endMatch(playerId: string, code: string): Room {
    const room = this.getRoom(code);
    this.assertHost(room, playerId);
    if (room.status === 'lobby') {
      throw new MatchError('WRONG_PHASE', '比赛尚未开始');
    }

    for (const pos of POSITIONS) {
      const takeover = room.takeovers[pos];
      if (!takeover || room.seats[pos].kind !== 'bot') continue;
      room.seats[pos] = {
        kind: 'human',
        playerId: takeover.playerId,
        name: takeover.name,
        connected: false,
      };
      if (!room.joinOrder.includes(takeover.playerId)) room.joinOrder.push(takeover.playerId);
    }

    room.takeovers = {};
    room.autoPlay = {};
    room.match = null;
    room.status = 'lobby';
    room.nextBoardAt = null;
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

  /** 房间当前的每方体系（旧配置缺省为精确） */
  private systemsOf(room: Room): BiddingSystems {
    return normalizeBiddingSystems(room.config.systems, DEFAULT_BIDDING_SYSTEMS);
  }

  /**
   * 设置某一方的叫牌体系，并同步该方机器人同伴，
   * 保证一方内两名玩家（含机器人）始终使用同一体系。
   */
  private setSideSystem(room: Room, side: 'NS' | 'EW', system: BiddingSystem): void {
    const systems = { ...this.systemsOf(room), [side]: system };
    room.config = { ...room.config, systems };
    this.syncSystems(room);
  }

  /** 把每方体系写回该方所有机器人座位 */
  private syncSystems(room: Room): void {
    const systems = this.systemsOf(room);
    for (const pos of POSITIONS) {
      const seat = room.seats[pos];
      if (seat.kind !== 'bot') continue;
      const system = systems[getSide(pos)];
      if (seat.persona.system !== system) {
        seat.persona = { ...seat.persona, system };
      }
    }
  }

  private takeover(room: Room, seat: Position, reclaimable = true): void {
    const current = room.seats[seat];
    const name = current.kind === 'human' ? current.name : '玩家';
    const previousPlayerId = current.kind === 'human' ? current.playerId : null;
    const persona = defaultPersonaFor(
      `${name}的托管`,
      `takeover-${seat}-${this.now()}`,
      this.systemsOf(room)[getSide(seat)],
    );
    room.seats[seat] = { kind: 'bot', persona };
    // 转成机器人后主动托管标记不再需要
    delete room.autoPlay[seat];
    if (previousPlayerId && reclaimable) {
      room.takeovers[seat] = { playerId: previousPlayerId, name, at: this.now() };
    } else {
      delete room.takeovers[seat];
    }
    if (room.match) {
      room.match.setAutoPlay(seat, false);
      room.match.takeoverSeat(seat, persona);
      room.match.seats = { ...room.match.seats };
    }
    if (previousPlayerId && room.hostId === previousPlayerId) {
      this.reassignHost(room);
    }
  }

  /**
   * 收回被托管的座位：仅限同一身份，且该座位当前仍是机器人。
   * 返回是否成功；成功后清除托管记录并同步到比赛引擎。
   */
  private reclaimSeat(room: Room, playerId: string): boolean {
    const seat = POSITIONS.find((pos) => room.takeovers[pos]?.playerId === playerId);
    if (!seat) return false;
    const info = room.takeovers[seat]!;
    if (room.seats[seat].kind !== 'bot') {
      delete room.takeovers[seat];
      return false;
    }
    room.seats[seat] = {
      kind: 'human',
      playerId,
      name: info.name,
      connected: true,
    };
    delete room.takeovers[seat];
    delete room.autoPlay[seat];
    this.awaySince.delete(playerId);
    if (!room.joinOrder.includes(playerId)) room.joinOrder.push(playerId);
    // 原房主被托管后房主已转给他人；只有在无人可当房主时才补位
    if (!room.hostId) room.hostId = playerId;
    if (room.match) {
      room.match.setAutoPlay(seat, false);
      room.match.reclaimSeat(seat, playerId, info.name);
    }
    room.updatedAt = this.now();
    return true;
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
