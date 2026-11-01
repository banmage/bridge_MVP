// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Position } from '../../src/models/gameState';
import { createDeck } from '../../src/core/deck';
import { REFERENCE_COUNT, simulateReferenceScores } from '../reference';

function fixedHands() {
  const deck = createDeck();
  return {
    N: deck.slice(0, 13),
    E: deck.slice(13, 26),
    S: deck.slice(26, 39),
    W: deck.slice(39, 52),
  };
}

const input = {
  hands: fixedHands(),
  dealer: 'N' as Position,
  vulnerability: 'none' as const,
  seed: 20261101,
  index: 1,
};

describe('MP 对照场', () => {
  it('固定 7 桌并返回 7 个 NS 分数', () => {
    const scores = simulateReferenceScores(input);
    expect(REFERENCE_COUNT).toBe(7);
    expect(scores).toHaveLength(7);
    for (const s of scores) expect(Number.isFinite(s)).toBe(true);
  });

  it('同一发牌与种子可完全复现', () => {
    const a = simulateReferenceScores(input);
    const b = simulateReferenceScores({ ...input, hands: fixedHands() });
    expect(a).toEqual(b);
  });

  it('不同种子可以改变对照场结果', () => {
    const a = simulateReferenceScores(input);
    const b = simulateReferenceScores({ ...input, seed: input.seed + 1 });
    expect(a).toHaveLength(7);
    expect(b).toHaveLength(7);
    // 允许偶然相同，但不应每次都被强制相等
    expect(a.every((v, i) => v === b[i])).toBe(false);
  });
});
