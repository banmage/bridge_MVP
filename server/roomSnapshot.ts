import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Position } from '../src/models/gameState';
import {
  isBiddingSystem,
  isBoardCount,
  isScoringMode,
  type MatchConfig,
  type RoomStatus,
} from '../shared/protocol';
import {
  MatchEngine,
  type MatchEngineSnapshot,
  type ReferenceInput,
} from './match';
import type { Room } from './room';

/**
 * 进行中房间快照：`server/data/rooms/<code>.json`（原子写）。
 *
 * - 仅保存开赛后、未结束的房间；结束后由 `GameHub` 转为正式比赛记录并删除快照；
 * - 快照只含服务端权威状态，不含 token，也不会下发给客户端；
 * - 进程重启时由 `RoomManager.restoreRooms` 读回，所有真人先视为离线并重新开始托管倒计时。
 */

export const ROOM_SNAPSHOT_VERSION = 1;

const POSITIONS: Position[] = ['N', 'E', 'S', 'W'];

export interface RoomSnapshot {
  schemaVersion: number;
  room: {
    code: string;
    hostId: string;
    status: RoomStatus;
    config: MatchConfig;
    seats: Room['seats'];
    /** 主动托管记录（旧快照可能没有） */
    autoPlay?: Room['autoPlay'];
    chat: Room['chat'];
    joinOrder: string[];
    /** 超时托管记录（旧快照可能没有） */
    takeovers?: Room['takeovers'];
    createdAt: number;
    updatedAt: number;
    nextBoardAt: number | null;
  };
  match: MatchEngineSnapshot | null;
}

export interface RestoreRoomOptions {
  referenceScores?: (input: ReferenceInput) => number[];
  rngFactory?: (seed: number) => () => number;
}

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOM_DATA_DIR = resolve(here, 'data/rooms');

function roomDataDir(): string {
  return process.env.ROOM_DATA_DIR ? resolve(process.env.ROOM_DATA_DIR) : DEFAULT_ROOM_DATA_DIR;
}

function sanitizeCode(code: string): string {
  return String(code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
}

function fileOf(code: string): string {
  return join(roomDataDir(), `${sanitizeCode(code)}.json`);
}

function ensureDir(): void {
  const dir = roomDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSeat(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (value.kind === 'open') return true;
  if (value.kind === 'human') {
    return typeof value.playerId === 'string' && typeof value.name === 'string' && typeof value.connected === 'boolean';
  }
  if (value.kind === 'bot') {
    const persona = value.persona;
    return (
      isObject(persona) &&
      typeof persona.id === 'string' &&
      typeof persona.name === 'string' &&
      typeof persona.risk === 'string' &&
      typeof persona.system === 'string' &&
      Array.isArray(persona.conventions) &&
      isNumber(persona.randomness)
    );
  }
  return false;
}

function isConfig(value: unknown): value is MatchConfig {
  if (
    !isObject(value) ||
    !isBoardCount(value.boards) ||
    !isScoringMode(value.scoring) ||
    !isNumber(value.seedBase) ||
    typeof value.matchId !== 'string'
  ) {
    return false;
  }
  if (value.systems === undefined) return true;
  return (
    isObject(value.systems) &&
    isBiddingSystem(value.systems.NS) &&
    isBiddingSystem(value.systems.EW)
  );
}

function isAutoPlayMap(value: unknown): boolean {
  if (!isObject(value)) return false;
  return POSITIONS.every((pos) => value[pos] === undefined || value[pos] === true || value[pos] === false);
}

function isSeatMap(value: unknown): boolean {
  return isObject(value) && POSITIONS.every((pos) => isSeat(value[pos]));
}

function isTakeover(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.playerId === 'string' &&
    typeof value.name === 'string' &&
    isNumber(value.at)
  );
}

function isTakeoverMap(value: unknown): boolean {
  if (!isObject(value)) return false;
  return POSITIONS.every((pos) => value[pos] === undefined || isTakeover(value[pos]));
}

function isEngineSeat(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (value.kind === 'human') {
    return typeof value.name === 'string' && (value.playerId === undefined || typeof value.playerId === 'string');
  }
  if (value.kind === 'bot') {
    const persona = value.persona;
    return (
      typeof value.name === 'string' &&
      isObject(persona) &&
      typeof persona.id === 'string' &&
      typeof persona.name === 'string' &&
      typeof persona.risk === 'string' &&
      typeof persona.system === 'string' &&
      Array.isArray(persona.conventions) &&
      isNumber(persona.randomness)
    );
  }
  return false;
}

function isEngineSeatMap(value: unknown): boolean {
  return isObject(value) && POSITIONS.every((pos) => isEngineSeat(value[pos]));
}

function isBoardState(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (!isNumber(value.index) || typeof value.phase !== 'string') return false;
  if (value.phase !== 'bidding' && value.phase !== 'play_waiting_lead' && value.phase !== 'play' && value.phase !== 'scored') {
    return false;
  }
  const hands = value.hands;
  const allHands = value.allHands;
  if (!isObject(hands) || !POSITIONS.every((pos) => Array.isArray(hands[pos]))) return false;
  if (!isObject(allHands) || !POSITIONS.every((pos) => Array.isArray(allHands[pos]))) return false;
  return Array.isArray(value.bidding) && Array.isArray(value.tricks) && Array.isArray(value.currentTrick);
}

function isMatchSnapshot(value: unknown): value is MatchEngineSnapshot {
  return (
    isObject(value) &&
    isConfig(value.config) &&
    isEngineSeatMap(value.seats) &&
    (value.autoPlay === undefined || isAutoPlayMap(value.autoPlay)) &&
    (value.board === null || isBoardState(value.board)) &&
    Array.isArray(value.completed) &&
    (value.status === 'idle' || value.status === 'playing' || value.status === 'finished') &&
    isNumber(value.startedAt) &&
    (value.finishedAt === null || isNumber(value.finishedAt)) &&
    (value.rngState === null || isNumber(value.rngState))
  );
}

function assertSnapshot(value: unknown): asserts value is RoomSnapshot {
  if (!isObject(value) || value.schemaVersion !== ROOM_SNAPSHOT_VERSION) {
    throw new Error('房间快照版本不支持');
  }
  const room = value.room;
  if (!isObject(room)) throw new Error('房间快照缺少 room');
  if (typeof room.code !== 'string' || sanitizeCode(room.code) !== room.code.toUpperCase() || room.code.length < 4) {
    throw new Error('房间码非法');
  }
  if (room.status !== 'lobby' && room.status !== 'playing' && room.status !== 'finished') {
    throw new Error('房间状态非法');
  }
  if (!isConfig(room.config)) throw new Error('房间配置非法');
  if (!isSeatMap(room.seats)) throw new Error('房间座位非法');
  if (room.autoPlay !== undefined && !isAutoPlayMap(room.autoPlay)) throw new Error('主动托管记录非法');
  if (room.takeovers !== undefined && !isTakeoverMap(room.takeovers)) throw new Error('托管记录非法');
  if (!Array.isArray(room.chat) || !Array.isArray(room.joinOrder)) throw new Error('房间聊天/加入顺序非法');
  if (!room.joinOrder.every((id) => typeof id === 'string')) throw new Error('加入顺序非法');
  if (!isNumber(room.createdAt) || !isNumber(room.updatedAt)) throw new Error('房间时间非法');
  if (room.nextBoardAt !== null && !isNumber(room.nextBoardAt)) throw new Error('下一副时间非法');
  if (value.match !== null && !isMatchSnapshot(value.match)) throw new Error('比赛快照非法');
}

/** 生成房间快照（不写盘） */
export function snapshotRoom(room: Room): RoomSnapshot {
  return {
    schemaVersion: ROOM_SNAPSHOT_VERSION,
    room: {
      code: room.code,
      hostId: room.hostId,
      status: room.status,
      config: clone(room.config),
      seats: clone(room.seats),
      autoPlay: clone(room.autoPlay ?? {}),
      chat: room.chat.map((message) => ({ ...message })),
      joinOrder: [...room.joinOrder],
      takeovers: clone(room.takeovers ?? {}),
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      nextBoardAt: room.nextBoardAt,
    },
    match: room.match ? room.match.snapshot() : null,
  };
}

/** 从快照重建房间（不写盘） */
export function roomFromSnapshot(snapshot: RoomSnapshot, opts: RestoreRoomOptions = {}): Room {
  assertSnapshot(snapshot);
  const match = snapshot.match
    ? MatchEngine.restore(snapshot.match, {
        ...(opts.referenceScores ? { referenceScores: opts.referenceScores } : {}),
        ...(opts.rngFactory ? { rngFactory: opts.rngFactory } : {}),
      })
    : null;
  return {
    code: snapshot.room.code.toUpperCase(),
    hostId: snapshot.room.hostId,
    status: snapshot.room.status,
    config: clone(snapshot.room.config),
    seats: clone(snapshot.room.seats),
    autoPlay: clone(snapshot.room.autoPlay ?? {}),
    match,
    chat: snapshot.room.chat.map((message) => ({ ...message })),
    joinOrder: [...snapshot.room.joinOrder],
    takeovers: clone(snapshot.room.takeovers ?? {}),
    createdAt: snapshot.room.createdAt,
    updatedAt: snapshot.room.updatedAt,
    nextBoardAt: snapshot.room.nextBoardAt,
  };
}

/** 原子写入房间快照 */
export function saveRoomSnapshot(room: Room): string {
  if (!room.match) throw new Error('房间尚未开始比赛');
  if (room.status === 'finished') throw new Error('已结束房间不再保存快照');
  ensureDir();
  const file = fileOf(room.code);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const payload = snapshotRoom(room);
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
  return file;
}

/** 读取全部房间快照；损坏文件会被跳过 */
export function loadRoomSnapshots(): RoomSnapshot[] {
  const dir = roomDataDir();
  if (!existsSync(dir)) return [];
  const snapshots: RoomSnapshot[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = JSON.parse(readFileSync(join(dir, file), 'utf8')) as unknown;
      assertSnapshot(raw);
      snapshots.push(raw);
    } catch {
      // 单个损坏快照不影响其他房间恢复
    }
  }
  return snapshots;
}

/** 删除房间快照（房间结束或销毁时调用） */
export function deleteRoomSnapshot(code: string): void {
  try {
    unlinkSync(fileOf(code));
  } catch {
    // 不存在或已删除
  }
}
