import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MatchConfig, MatchResult } from '../shared/protocol';
import type { BoardRecord } from './match';
import type { Room } from './room';
import type { Position } from '../src/models/gameState';

/**
 * 比赛记录落盘：`server/data/matches/<matchId>.json`（原子写）。
 * 一期使用文件系统而非数据库；查询接口只暴露已完成比赛的公开记录。
 */

export const SCHEMA_VERSION = 1;

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DATA_DIR = resolve(here, 'data/matches');

export interface MatchPlayerRecord {
  seat: Position;
  name: string;
  kind: 'human' | 'bot';
  playerId?: string;
}

export interface MatchRecord {
  id: string;
  roomCode: string;
  hostId: string;
  startedAt: number;
  finishedAt: number;
  config: MatchConfig;
  players: MatchPlayerRecord[];
  result: MatchResult;
  boards: BoardRecord[];
}

export interface MatchSummary {
  id: string;
  finishedAt: number;
  config: Pick<MatchConfig, 'boards' | 'scoring'>;
  players: string[];
  result: Pick<MatchResult, 'boardsPlayed' | 'nsMpPercent' | 'nsPoints' | 'winner'>;
}

export interface PersistedMatch {
  schemaVersion: number;
  match: MatchRecord;
}

function dataDir(): string {
  return process.env.MATCH_DATA_DIR ? resolve(process.env.MATCH_DATA_DIR) : DEFAULT_DATA_DIR;
}

function fileOf(id: string): string {
  return join(dataDir(), `${sanitizeId(id)}.json`);
}

function sanitizeId(id: string): string {
  return String(id).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
}

function ensureDir(): void {
  const dir = dataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readPersisted(id: string): PersistedMatch | null {
  const file = fileOf(id);
  if (!existsSync(file)) return null;
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as PersistedMatch;
    if (!data || data.schemaVersion !== SCHEMA_VERSION || !data.match) return null;
    return data;
  } catch {
    return null;
  }
}

/** 原子写：先写临时文件再 rename，避免半截 JSON */
export function saveMatchRecord(record: MatchRecord): string {
  ensureDir();
  const file = fileOf(record.id);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const payload: PersistedMatch = { schemaVersion: SCHEMA_VERSION, match: record };
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
  return file;
}

export function getMatchRecord(id: string): MatchRecord | null {
  return readPersisted(id)?.match ?? null;
}

function toSummary(record: MatchRecord): MatchSummary {
  return {
    id: record.id,
    finishedAt: record.finishedAt,
    config: { boards: record.config.boards, scoring: record.config.scoring },
    players: record.players.map((p) => p.name),
    result: {
      boardsPlayed: record.result.boardsPlayed,
      nsMpPercent: record.result.nsMpPercent,
      nsPoints: record.result.nsPoints,
      winner: record.result.winner,
    },
  };
}

function allRecords(): MatchRecord[] {
  if (!existsSync(dataDir())) return [];
  const records: MatchRecord[] = [];
  for (const file of readdirSync(dataDir())) {
    if (!file.endsWith('.json')) continue;
    const record = readPersisted(file.replace(/\.json$/, ''));
    if (record) records.push(record.match);
  }
  return records;
}

/** 最近完成的比赛摘要（按结束时间倒序） */
export function listMatches(limit = 10): MatchSummary[] {
  return allRecords()
    .sort((a, b) => b.finishedAt - a.finishedAt)
    .slice(0, Math.max(1, Math.min(100, limit)))
    .map(toSummary);
}

/** 某设备身份参与过的比赛摘要 */
export function matchesForPlayer(playerId: string, limit = 10): MatchSummary[] {
  return allRecords()
    .filter((record) => record.players.some((p) => p.playerId === playerId))
    .sort((a, b) => b.finishedAt - a.finishedAt)
    .slice(0, Math.max(1, Math.min(100, limit)))
    .map(toSummary);
}

/** 由房间与引擎状态生成可落盘记录 */
export function recordFromRoom(room: Room, finishedAt: number): MatchRecord {
  const match = room.match;
  if (!match) throw new Error('房间尚未开始比赛');
  const players = (['N', 'E', 'S', 'W'] as Position[]).map((seat) => {
    const occupant = room.seats[seat];
    if (occupant.kind === 'human') {
      return { seat, name: occupant.name, kind: 'human' as const, playerId: occupant.playerId };
    }
    if (occupant.kind === 'bot') {
      return { seat, name: occupant.persona.name, kind: 'bot' as const };
    }
    return { seat, name: '空位', kind: 'bot' as const };
  });
  return {
    id: room.config.matchId,
    roomCode: room.code,
    hostId: room.hostId,
    startedAt: match.startedAt,
    finishedAt,
    config: { ...room.config },
    players,
    result: match.result(),
    boards: match.completed.map(cloneBoard),
  };
}

function cloneBoard(board: BoardRecord): BoardRecord {
  return JSON.parse(JSON.stringify(board)) as BoardRecord;
}

export type { BoardRecord };
