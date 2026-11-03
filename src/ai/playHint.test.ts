import { describe, expect, it } from 'vitest';
import type { Contract, Trick } from '../models/gameState';
import { parseHand } from '../testing/testUtils';
import { declarerTricksOf, recommendPlay } from './playHint';

const CONTRACT: Contract = {
  level: 3,
  suit: 'NT',
  doubled: false,
  redoubled: false,
  declarer: 'S',
  dummy: 'N',
};

describe('出牌推荐 playHint', () => {
  it('返回手牌中的合法牌，且同一局面结果稳定', () => {
    const hand = parseHand('SAKQ2 HAK3 D5432 C87');
    const input = {
      hand,
      dummyHand: parseHand('S543 H876 DAKQ C6543'),
      currentTrick: [],
      contract: CONTRACT,
      position: 'W' as const,
      declarerTricks: 0,
      seed: 7,
    };
    const first = recommendPlay(input, []);
    const second = recommendPlay(input, []);
    expect(first).not.toBeNull();
    expect(hand).toContain(first);
    expect(second).toBe(first);
  });

  it('空手牌不给出推荐', () => {
    expect(
      recommendPlay(
        {
          hand: [],
          dummyHand: null,
          currentTrick: [],
          contract: CONTRACT,
          position: 'W',
          declarerTricks: 0,
        },
        [],
      ),
    ).toBeNull();
  });

  it('统计定约方已赢墩数', () => {
    const tricks: Trick[] = [
      { plays: [], leader: 'S', winner: 'S' },
      { plays: [], leader: 'W', winner: 'W' },
      { plays: [], leader: 'N', winner: 'N' },
      { plays: [], leader: 'E', winner: 'E' },
    ];
    expect(declarerTricksOf(tricks, 'S')).toBe(2);
    expect(declarerTricksOf(tricks, 'W')).toBe(2);
  });
});
