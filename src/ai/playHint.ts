import type { Hand } from '../models/hand';
import type { BidRecord, CardPlay, Contract, Position, StyleLevel, Trick } from '../models/gameState';
import { getSide, trumpSuitOf } from '../models/gameState';
import type { LeadRule } from '../engine/types';
import { makeRng } from '../engine/arbiter';
import { playAI } from './playAI';

/**
 * 出牌推荐：只读地复用机器人的出牌 AI，给人类玩家一个稳定、可解释的建议。
 *
 * 不使用随机探索：同一局面（seed 固定）总是给出同一张牌，
 * 避免推荐箭头在每次渲染时跳动。调用方负责只在“轮到人类操作”时展示。
 */

export interface PlayHintInput {
  hand: Hand;
  dummyHand: Hand | null;
  currentTrick: CardPlay[];
  contract: Contract;
  position: Position;
  /** 定约方已赢墩数（用于打牌 AI 的局势判断） */
  declarerTricks: number;
  biddingHistory?: BidRecord[];
  /** 固定随机源；缺省 1，保证推荐可复现 */
  seed?: number;
  style?: StyleLevel;
}

export function recommendPlay(
  input: PlayHintInput,
  leadRules: LeadRule[],
): number | null {
  if (!input.hand || input.hand.length === 0) return null;
  return playAI(
    input.hand,
    input.dummyHand,
    input.currentTrick,
    trumpSuitOf(input.contract),
    input.position,
    input.contract,
    input.declarerTricks,
    leadRules,
    input.style ?? 1,
    {
      rng: makeRng(input.seed ?? 1),
      biddingHistory: input.biddingHistory ?? [],
    },
  );
}

/** 定约方（庄家一侧）已经赢得的墩数 */
export function declarerTricksOf(tricks: Trick[], declarer: Position): number {
  const side = getSide(declarer);
  return tricks.reduce((sum, trick) => (getSide(trick.winner) === side ? sum + 1 : sum), 0);
}
