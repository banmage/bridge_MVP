import type { BidCandidate } from './types';

/**
 * 可序列化随机源：除调用外，还能读取/恢复内部状态。
 * 服务端房间快照需要保存 AI 随机状态，重启后才能无缝续跑。
 */
export interface Rng {
  (): number;
  getState(): number;
  setState(state: number): void;
}

/** mulberry32：给定种子生成可复现的 [0,1) 随机源 */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const rng = (() => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  rng.getState = () => a >>> 0;
  rng.setState = (state: number) => {
    a = state >>> 0;
  };
  return rng;
}

export interface SelectOptions {
  randomness: number; // [0,1]，来自座位配置
  rng: () => number; // 已播种的随机源
  altPool?: number; // 参与探索的次优候选数量，默认 2
}

/**
 * 叫牌裁决与 ε 探索（冻结）：
 * 1) randomness<=0 或无备选 → candidates[0]
 * 2) 否则以 randomness 概率，从 candidates[1..altPool] 中均匀取一个
 * 3) 无备选时退回 candidates[0]
 */
export function selectBidCandidate(candidates: BidCandidate[], opts: SelectOptions): BidCandidate | null {
  if (candidates.length === 0) return null;
  const pool = Math.max(0, opts.altPool ?? 2);
  if (opts.randomness <= 0 || candidates.length === 1 || pool === 0) return candidates[0];
  if (opts.rng() < opts.randomness) {
    const alts = candidates.slice(1, 1 + pool);
    if (alts.length > 0) return alts[Math.floor(opts.rng() * alts.length)];
  }
  return candidates[0];
}

/** 通用 ε-greedy：在“有依据的候选数组”中按 randomness 概率做有界偏离（供出牌探索预留） */
export function selectWithExploration<T>(ordered: T[], randomness: number, rng: () => number, altPool = 2): T | null {
  if (ordered.length === 0) return null;
  if (randomness <= 0 || ordered.length === 1 || altPool <= 0) return ordered[0];
  if (rng() < randomness) {
    const alts = ordered.slice(1, 1 + altPool);
    if (alts.length > 0) return alts[Math.floor(rng() * alts.length)];
  }
  return ordered[0];
}
