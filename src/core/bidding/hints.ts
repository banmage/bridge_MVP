import type { BidCall, BidRecord, BidSuit, Position, StyleLevel } from '../../models/gameState';
import type { BiddingRule } from '../../engine/types';
import { findBidCandidates, matchSequence } from '../../engine/matcher';
import { callToString, parseAction } from './validator';

/**
 * 叫牌辅助：把规则库里的 `description` 变成界面上的“叫品解释”，
 * 并用与机器人相同的候选排序给出推荐叫品。
 *
 * 这里只做只读计算，不修改任何对局状态；联网与单机共用同一套规则资产。
 */

const SUIT_SYMBOL: Record<BidSuit, string> = {
  C: '♣',
  D: '♦',
  H: '♥',
  S: '♠',
  NT: 'NT',
};

/** 叫品的简短显示文本，例如 `1♥` / `Pass` / `X` */
export function callLabel(call: BidCall): string {
  switch (call.type) {
    case 'pass':
      return 'Pass';
    case 'double':
      return 'X';
    case 'redouble':
      return 'XX';
    case 'bid':
      return `${call.level}${SUIT_SYMBOL[call.suit]}`;
  }
}

/** 规则库没有覆盖该叫品时的兜底说明 */
export function fallbackCallDescription(call: BidCall): string {
  switch (call.type) {
    case 'pass':
      return '不叫（Pass）';
    case 'double':
      return '加倍（X）：惩罚性或技术性加倍，依约定';
    case 'redouble':
      return '再加倍（XX）：在对方加倍后加倍，依约定';
    case 'bid': {
      const suit = call.suit === 'NT' ? '无将' : `${SUIT_SYMBOL[call.suit]} 花色`;
      return `${callLabel(call)}：${suit}定约`;
    }
  }
}

function ruleCall(rule: BiddingRule): BidCall | null {
  try {
    return parseAction(rule.action);
  } catch {
    return null;
  }
}

function ruleText(rule: BiddingRule): string {
  const tags = rule.tags?.length ? `（约定：${rule.tags.join(' / ')}）` : '';
  return `${rule.description}${tags}`;
}

/** 历史中某一条叫牌发生前的当前叫品 */
export function currentBidBefore(
  history: BidRecord[],
  index: number,
): { level: number; suit: BidSuit } | null {
  for (let i = Math.min(index, history.length) - 1; i >= 0; i -= 1) {
    const call = history[i]?.call;
    if (call?.type === 'bid') return { level: call.level, suit: call.suit };
  }
  return null;
}

/**
 * 在规则库中查找某个叫品在当前叫牌序列下的含义。
 *
 * 不校验 `when` 条件：这里解释的是“这个叫品在体系里表示什么”，
 * 而不是“当前这手牌是否应该叫它”；是否可叫由叫牌卡自己禁用。
 */
export function explainCall(
  rules: BiddingRule[],
  history: BidRecord[],
  position: Position,
  _currentBid: { level: number; suit: BidSuit } | null,
  call: BidCall,
): string {
  const target = callToString(call);
  const matches = rules
    .filter((rule) => {
      const parsed = ruleCall(rule);
      if (!parsed || callToString(parsed) !== target) return false;
      return matchSequence(history, rule.sequence, position);
    })
    .sort((a, b) => b.priority - a.priority);
  return matches[0] ? ruleText(matches[0]) : fallbackCallDescription(call);
}

/** 解释历史中的第 `index` 条叫牌（用于叫牌过程悬停） */
export function explainBidRecord(
  rules: BiddingRule[],
  history: BidRecord[],
  index: number,
): string | null {
  const record = history[index];
  if (!record) return null;
  return explainCall(
    rules,
    history.slice(0, index),
    record.position,
    currentBidBefore(history, index),
    record.call,
  );
}

/** 当前所有叫品的解释（键为 `callToString` 的结果） */
export function buildCallHints(
  rules: BiddingRule[],
  hand: number[] | null,
  history: BidRecord[],
  position: Position,
  currentBid: { level: number; suit: BidSuit } | null,
): Record<string, string> {
  const hints: Record<string, string> = {};
  const levels = [1, 2, 3, 4, 5, 6, 7];
  const suits: BidSuit[] = ['C', 'D', 'H', 'S', 'NT'];
  for (const level of levels) {
    for (const suit of suits) {
      const call: BidCall = { type: 'bid', level, suit };
      hints[callToString(call)] = explainCall(rules, history, position, currentBid, call);
    }
  }
  for (const type of ['pass', 'double', 'redouble'] as const) {
    const call: BidCall = { type };
    hints[callToString(call)] = explainCall(rules, history, position, currentBid, call);
  }

  // 手牌已知时，用真正匹配这手牌的规则覆盖通用解释，说明更具体
  if (hand && hand.length > 0) {
    for (const candidate of findBidCandidates(hand, history, position, currentBid, 1, rules)) {
      hints[callToString(candidate.call)] = ruleText(candidate.rule);
    }
  }
  return hints;
}

export interface BidRecommendation {
  call: BidCall;
  description: string;
}

/**
 * 自动推荐：完全复用机器人的候选筛选与排序（优先级 → 具体度），
 * 但不做随机探索，给人类玩家一个稳定、可解释的建议。
 *
 * 与机器人一致：没有任何规则命中时兜底推荐 Pass（永远合法）。
 */
export function recommendCall(
  rules: BiddingRule[],
  hand: number[] | null,
  history: BidRecord[],
  position: Position,
  currentBid: { level: number; suit: BidSuit } | null,
  style: StyleLevel = 1,
): BidRecommendation | null {
  if (!hand || hand.length === 0) return null;
  const candidates = findBidCandidates(hand, history, position, currentBid, style, rules);
  const top = candidates[0];
  if (top) return { call: top.call, description: ruleText(top.rule) };
  return {
    call: { type: 'pass' },
    description: '没有匹配当前序列的体系规则，建议不叫（Pass）',
  };
}
