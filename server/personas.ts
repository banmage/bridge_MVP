import type { BiddingRule, LeadRule } from '../src/engine/types';
import type { BidCall, BidRecord, BidSuit, Position, SeatStyle, StyleLevel } from '../src/models/gameState';
import type { Hand } from '../src/models/hand';
import { findBidCandidates } from '../src/engine/matcher';
import { selectBidCandidate } from '../src/engine/arbiter';
import { CONVENTION_LABELS, DEFAULT_PERSONA, type BotPersona, type ConventionKey } from '../shared/protocol';
import { biddingRulesFor, leadRules } from './rules';

/**
 * 机器人人格 → 风格参数 + 规则集 + 提醒文本。
 *
 * 约定开关的作用：
 * - 关闭某约定时，带该 `tags` 的规则不参与候选（行为改变）；
 * - 启用时，若 AI 选中的规则带 `tags`，则随叫牌广播提醒文本。
 */

const RISK_TO_STYLE: Record<BotPersona['risk'], StyleLevel> = {
  conservative: 0,
  normal: 1,
  aggressive: 2,
};

export function styleOf(persona: BotPersona): SeatStyle {
  const level = RISK_TO_STYLE[persona.risk] ?? 1;
  return { bid: level, play: level, randomness: clamp01(persona.randomness) };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** 该人格可用的叫牌规则（剔除未启用的约定） */
export function rulesForPersona(persona: BotPersona): BiddingRule[] {
  const enabled = new Set<ConventionKey>(persona.conventions ?? []);
  return biddingRulesFor(persona.system).filter(
    (rule) => !rule.tags || rule.tags.every((tag) => enabled.has(tag as ConventionKey)),
  );
}

export function leadsForPersona(): LeadRule[] {
  return leadRules();
}

export interface BotBidResult {
  call: BidCall;
  alert?: { text: string };
}

/**
 * 机器人叫牌：候选 → 裁决/探索 → 兜底 Pass，并给出约定提醒。
 * 与 `bidAI` 等价，但保留选中规则以生成提醒文本。
 */
export function botBid(
  hand: Hand,
  history: BidRecord[],
  position: Position,
  currentBid: { level: number; suit: BidSuit } | null,
  persona: BotPersona,
  rng: () => number,
): BotBidResult {
  const style = styleOf(persona);
  const rules = rulesForPersona(persona);
  const candidates = findBidCandidates(hand, history, position, currentBid, style.bid, rules);
  const picked = selectBidCandidate(candidates, { randomness: style.randomness, rng, altPool: 2 });
  if (!picked) return { call: { type: 'pass' } };

  const tags = picked.rule.tags;
  if (tags && tags.length > 0) {
    const labels = tags.map((t) => CONVENTION_LABELS[t as ConventionKey] ?? t).join('、');
    return {
      call: picked.call,
      alert: { text: `${picked.rule.description || picked.rule.id}（约定：${labels}）` },
    };
  }
  return { call: picked.call };
}

/** 生成默认人格（用于「真人离开 → 机器人接管」或主动托管） */
export function defaultPersonaFor(
  playerName: string,
  id: string,
  system: BotPersona['system'] = 'precision',
): BotPersona {
  return { ...DEFAULT_PERSONA, id, name: playerName || '托管机器人', system, randomness: 0 };
}

/** 校验人格字段（服务端入口处调用） */
export function sanitizePersona(input: Partial<BotPersona> & { id?: string; name?: string }): BotPersona {
  const risk: BotPersona['risk'] =
    input.risk === 'conservative' || input.risk === 'aggressive' || input.risk === 'normal'
      ? input.risk
      : 'normal';
  const system: BotPersona['system'] = input.system === 'natural' ? 'natural' : 'precision';
  const validConventions: ConventionKey[] = ['strong_nt', 'negative_double', 'weak_two', 'stayman', 'transfer'];
  const conventions = Array.isArray(input.conventions)
    ? input.conventions.filter((c): c is ConventionKey => validConventions.includes(c as ConventionKey))
    : [...DEFAULT_PERSONA.conventions];
  return {
    id: String(input.id ?? `bot-${Math.random().toString(36).slice(2, 8)}`).slice(0, 40),
    name: String(input.name ?? '机器人').slice(0, 16),
    risk,
    system,
    conventions,
    randomness: clamp01(typeof input.randomness === 'number' ? input.randomness : DEFAULT_PERSONA.randomness),
  };
}
