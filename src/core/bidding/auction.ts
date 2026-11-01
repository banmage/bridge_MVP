import type { BidRecord, BidSuit, Position } from '../../models/gameState';
import { getSide } from '../../models/gameState';

/**
 * 叫牌阶段的“法律性判定”：何时结束、庄家是谁。
 *
 * 单机 store 与联网服务端共用同一实现（宪法 III：规则单点复用）。
 */

export type BiddingOutcome = 'none' | 'contract' | 'passed_out';

/**
 * 判定叫牌是否结束：
 * - 无任何叫品且已累积 4 个 Pass → 流局（passed_out）；
 * - 已有叫品且出现连续 3 个 Pass → 正常结束（contract）；
 * - 否则未结束（none）。
 */
export function biddingOutcome(
  history: BidRecord[],
  currentBid: { level: number; suit: BidSuit } | null,
): BiddingOutcome {
  if (history.length === 0) return 'none';
  if (currentBid === null) {
    const last4 = history.slice(-4);
    return history.length >= 4 && last4.length === 4 && last4.every((r) => r.call.type === 'pass')
      ? 'passed_out'
      : 'none';
  }
  const last3 = history.slice(-3);
  return last3.length === 3 && last3.every((r) => r.call.type === 'pass') ? 'contract' : 'none';
}

/**
 * 找庄家：最终定约花色最早叫出的定约方成员。
 * `finalBid` 必须是当前生效的叫品。
 */
export function findDeclarer(
  history: BidRecord[],
  finalBid: { level: number; suit: BidSuit },
): Position | null {
  const lastBidder = [...history]
    .reverse()
    .find(
      (r) =>
        r.call.type === 'bid' && r.call.level === finalBid.level && r.call.suit === finalBid.suit,
    );
  if (!lastBidder) return null;
  const declSide = getSide(lastBidder.position);
  for (const rec of history) {
    if (
      rec.call.type === 'bid' &&
      rec.call.suit === finalBid.suit &&
      getSide(rec.position) === declSide
    ) {
      return rec.position;
    }
  }
  return lastBidder.position;
}
