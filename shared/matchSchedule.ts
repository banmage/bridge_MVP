import type { Position } from '../src/models/gameState';
import type { Vulnerability } from './protocol';

/**
 * 标准复式 16 副轮转表（庄家与局况）。
 *
 * 规则：第 n 副庄家 = ORDER[(n-1) % 4]；局况按标准 16 副表循环。
 * 12/18/24 副的比赛按副号顺序截取（超过 16 副时循环并保持牌型不重复，见 seed 派生）。
 */
export interface BoardSchedule {
  index: number;
  dealer: Position;
  vulnerability: Vulnerability;
}

const VUL_ROTATION: Vulnerability[] = [
  'none',
  'NS',
  'EW',
  'both',
  'NS',
  'EW',
  'both',
  'none',
  'EW',
  'both',
  'none',
  'NS',
  'both',
  'none',
  'NS',
  'EW',
];

const DEALER_ROTATION: Position[] = ['N', 'E', 'S', 'W'];

/** 取第 index 副（1 起）的庄家与局况；超出 16 副时循环。 */
export function scheduleFor(index: number): BoardSchedule {
  const i = Math.max(1, Math.floor(index));
  const slot = (i - 1) % 16;
  return {
    index: i,
    dealer: DEALER_ROTATION[slot % 4],
    vulnerability: VUL_ROTATION[slot],
  };
}

/** 生成 1..count 的完整轮转表。 */
export function scheduleTable(count = 16): BoardSchedule[] {
  return Array.from({ length: count }, (_, i) => scheduleFor(i + 1));
}

/** 由比赛种子与副号派生该副发牌种子（确定性、互相独立）。 */
export function boardSeed(seedBase: number, index: number): number {
  let h = (seedBase >>> 0) ^ Math.imul(index + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
