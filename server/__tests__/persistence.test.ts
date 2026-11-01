// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Position } from '../../src/models/gameState';
import { MatchEngine } from '../match';
import { RoomManager } from '../room';
import {
  getMatchRecord,
  listMatches,
  matchesForPlayer,
  recordFromRoom,
  saveMatchRecord,
  type MatchRecord,
} from '../persistence';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bridge-matches-'));
  process.env.MATCH_DATA_DIR = dir;
});

afterEach(() => {
  delete process.env.MATCH_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function sampleRecord(id: string, finishedAt: number, playerId = 'p-1'): MatchRecord {
  return {
    id,
    roomCode: 'ABC123',
    hostId: playerId,
    startedAt: finishedAt - 600_000,
    finishedAt,
    config: { boards: 12, scoring: 'mp', seedBase: 1, matchId: id },
    players: [
      { seat: 'N', name: 'Alice', kind: 'human', playerId },
      { seat: 'E', name: '机器人', kind: 'bot' },
    ],
    result: {
      boardsPlayed: 12,
      nsPoints: 0,
      ewPoints: 0,
      nsImps: 3,
      nsMpPercent: 57.1,
      winner: 'NS',
      perBoard: [],
    },
    boards: [],
  };
}

describe('比赛记录落盘', () => {
  it('原子写入并可读回', () => {
    const record = sampleRecord('m_1', 1000);
    const file = saveMatchRecord(record);
    expect(file.endsWith('m_1.json')).toBe(true);
    expect(existsSync(file)).toBe(true);
    expect(getMatchRecord('m_1')).toEqual(record);
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toHaveLength(0);
  });

  it('不存在的记录返回 null，忽略非法 id 路径', () => {
    expect(getMatchRecord('nope')).toBeNull();
    expect(getMatchRecord('../../etc/passwd')).toBeNull();
  });

  it('列表按结束时间倒序并限制条数', () => {
    saveMatchRecord(sampleRecord('m_1', 1000));
    saveMatchRecord(sampleRecord('m_2', 3000));
    saveMatchRecord(sampleRecord('m_3', 2000));
    const list = listMatches(2);
    expect(list.map((m) => m.id)).toEqual(['m_2', 'm_3']);
    expect(list[0].result.winner).toBe('NS');
    expect(list[0].players).toEqual(['Alice', '机器人']);
  });

  it('按 playerId 查询参与记录', () => {
    saveMatchRecord(sampleRecord('m_1', 1000, 'p-1'));
    saveMatchRecord(sampleRecord('m_2', 2000, 'p-2'));
    expect(matchesForPlayer('p-1').map((m) => m.id)).toEqual(['m_1']);
    expect(matchesForPlayer('p-3')).toEqual([]);
  });

  it('从房间生成记录：包含座位、配置与逐副明细', () => {
    const manager = new RoomManager({ seedBase: 42, codes: ['ROOM42'] });
    const room = manager.createRoom(
      { playerId: 'p-N', name: '北家' },
      { boards: 12, scoring: 'hcp-points' },
      'N',
    );
    for (const seat of ['E', 'S', 'W'] as Position[]) {
      manager.setSeat('p-N', 'ROOM42', seat, {
        kind: 'bot',
        persona: {
          id: `b-${seat}`,
          name: `${seat}机器人`,
          risk: 'normal',
          system: 'precision',
          conventions: [],
          randomness: 0,
        },
      });
    }
    manager.startMatch('p-N', 'ROOM42');

    // 房主先 Pass，随后全部交给机器人，保证一副可完整结束
    const engine = room.match as MatchEngine;
    engine.submitBid('p-N', { type: 'pass' });
    engine.seats = Object.fromEntries(
      (['N', 'E', 'S', 'W'] as Position[]).map((seat) => [
        seat,
        {
          kind: 'bot' as const,
          name: `${seat}机器人`,
          persona: {
            id: `b-${seat}`,
            name: `${seat}机器人`,
            risk: 'normal' as const,
            system: 'precision' as const,
            conventions: [],
            randomness: 0,
          },
        },
      ]),
    ) as MatchEngine['seats'];
    let guard = 0;
    while (engine.board!.phase !== 'scored' && guard < 400) {
      if (!engine.runAiStep()) break;
      guard += 1;
    }
    expect(engine.board!.phase).toBe('scored');

    const record = recordFromRoom(room, 5000);
    expect(record.id).toBe(room.config.matchId);
    expect(record.roomCode).toBe('ROOM42');
    expect(record.players.find((p) => p.seat === 'N')?.kind).toBe('human');
    expect(record.players.filter((p) => p.kind === 'bot')).toHaveLength(3);
    expect(record.boards).toHaveLength(1);
    expect(record.boards[0].hands.N).toHaveLength(13);
    expect(record.finishedAt).toBe(5000);

    saveMatchRecord(record);
    expect(getMatchRecord(record.id)?.boards).toHaveLength(1);
  });
});
