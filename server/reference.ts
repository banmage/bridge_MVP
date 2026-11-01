import type { Position } from '../src/models/gameState';
import type { BoardCount, BotPersona } from '../shared/protocol';
import { MatchEngine, type EngineSeat, type ReferenceInput } from './match';

/**
 * MP（双人赛）对照场：用同一副发牌模拟 7 桌全机器人对局，得到 7 个 NS 分数。
 *
 * - 人格固定、种子由副 seed 派生 → 完全可复现；
 * - 不同桌使用不同叫牌体系/风险偏好 → 产生分数分布，避免全部同分；
 * - 仅用于计分，不影响主桌状态。
 */

export const REFERENCE_COUNT = 7;

const REFERENCE_PERSONAS: BotPersona[] = [
  { id: 'ref-1', name: '对照1', risk: 'normal', system: 'precision', conventions: ['strong_nt', 'negative_double', 'weak_two', 'stayman', 'transfer'], randomness: 0 },
  { id: 'ref-2', name: '对照2', risk: 'normal', system: 'natural', conventions: ['strong_nt', 'negative_double', 'weak_two', 'stayman', 'transfer'], randomness: 0 },
  { id: 'ref-3', name: '对照3', risk: 'conservative', system: 'precision', conventions: ['strong_nt', 'negative_double', 'weak_two'], randomness: 0.1 },
  { id: 'ref-4', name: '对照4', risk: 'aggressive', system: 'natural', conventions: ['strong_nt', 'negative_double', 'weak_two', 'stayman', 'transfer'], randomness: 0.1 },
  { id: 'ref-5', name: '对照5', risk: 'aggressive', system: 'precision', conventions: ['strong_nt', 'negative_double', 'weak_two', 'stayman', 'transfer'], randomness: 0.2 },
  { id: 'ref-6', name: '对照6', risk: 'conservative', system: 'natural', conventions: ['strong_nt', 'weak_two'], randomness: 0.2 },
  { id: 'ref-7', name: '对照7', risk: 'normal', system: 'precision', conventions: ['strong_nt', 'negative_double', 'weak_two', 'stayman', 'transfer'], randomness: 0.35 },
];

const POSITIONS: Position[] = ['N', 'E', 'S', 'W'];

function seatsFor(persona: BotPersona): Record<Position, EngineSeat> {
  const seats = {} as Record<Position, EngineSeat>;
  for (const pos of POSITIONS) {
    seats[pos] = { kind: 'bot', name: `${persona.name}${pos}`, persona };
  }
  return seats;
}

function boardsFor(index: number): BoardCount {
  if (index <= 12) return 12;
  if (index <= 18) return 18;
  return 24;
}

function simulateOne(input: ReferenceInput, persona: BotPersona, tableIndex: number): number {
  const engine = new MatchEngine({
    config: {
      boards: boardsFor(input.index),
      scoring: 'hcp-points',
      seedBase: input.seed,
      matchId: `ref-${input.index}-${tableIndex}`,
    },
    seats: seatsFor(persona),
  });

  const seed = (input.seed ^ Math.imul(tableIndex + 1, 0x9e3779b1)) >>> 0;
  engine.startBoard(input.index, {
    seed,
    hands: input.hands,
    dealer: input.dealer,
    vulnerability: input.vulnerability,
  });

  let guard = 0;
  while (engine.board && engine.board.phase !== 'scored' && guard < 400) {
    const step = engine.runAiStep();
    if (!step) break;
    guard += 1;
  }
  if (!engine.board || engine.board.phase !== 'scored') return 0;
  return engine.board.score.NS - engine.board.score.EW;
}

/** 返回 7 桌的 NS 分数（带符号，NS 视角） */
export function simulateReferenceScores(input: ReferenceInput): number[] {
  return REFERENCE_PERSONAS.map((persona, i) => simulateOne(input, persona, i));
}
