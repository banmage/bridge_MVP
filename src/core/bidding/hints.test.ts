import { describe, expect, it } from 'vitest';
import { loadBiddingRules } from '../../engine/loader';
import { parseHand } from '../../testing/testUtils';
import {
  buildCallHints,
  callLabel,
  currentBidBefore,
  explainBidRecord,
  explainCall,
  fallbackCallDescription,
  recommendCall,
} from './hints';

const precision = loadBiddingRules('precision');

describe('叫牌提示 hints', () => {
  it('把叫品转成简短文本', () => {
    expect(callLabel({ type: 'pass' })).toBe('Pass');
    expect(callLabel({ type: 'double' })).toBe('X');
    expect(callLabel({ type: 'redouble' })).toBe('XX');
    expect(callLabel({ type: 'bid', level: 3, suit: 'NT' })).toBe('3NT');
    expect(callLabel({ type: 'bid', level: 1, suit: 'H' })).toBe('1♥');
  });

  it('没有规则命中时给出兜底说明', () => {
    expect(fallbackCallDescription({ type: 'pass' })).toContain('不叫');
    expect(fallbackCallDescription({ type: 'double' })).toContain('加倍');
    expect(fallbackCallDescription({ type: 'redouble' })).toContain('再加倍');
    expect(fallbackCallDescription({ type: 'bid', level: 2, suit: 'S' })).toContain('2♠');
  });

  it('按规则库解释单个叫品，缺省回落到通用说明', () => {
    const oneHeart = explainCall(precision, [], 'S', null, { type: 'bid', level: 1, suit: 'H' });
    expect(oneHeart).toContain('1H 开叫');
    expect(oneHeart).toContain('5+ 红桃');

    const unknown = explainCall([], [], 'S', null, { type: 'pass' });
    expect(unknown).toBe(fallbackCallDescription({ type: 'pass' }));
  });

  it('解释历史中的叫牌时使用该叫牌发生前的序列', () => {
    const history = [
      { position: 'N' as const, call: { type: 'bid' as const, level: 1, suit: 'C' as const } },
      { position: 'E' as const, call: { type: 'pass' as const } },
      { position: 'S' as const, call: { type: 'bid' as const, level: 1, suit: 'H' as const } },
    ];
    expect(currentBidBefore(history, 2)).toEqual({ level: 1, suit: 'C' });
    const explanation = explainBidRecord(precision, history, 2);
    expect(explanation).toContain('1C 后自然正应 1H');
  });

  it('为当前所有叫品生成解释，并用具体手牌规则覆盖通用说明', () => {
    const hand = parseHand('SAKQ2 HAK3 D5432 C87'); // 16 HCP
    const hints = buildCallHints(precision, hand, [], 'S', null);
    expect(hints['1C']).toContain('精确 1C 开叫');
    expect(hints.Pass).toContain('Pass');
  });

  it('推荐叫品复用机器人候选排序，并在无匹配规则时兜底 Pass', () => {
    const hand = parseHand('SAKQ2 HAK3 D5432 C87');
    const recommendation = recommendCall(precision, hand, [], 'S', null, 1);
    expect(recommendation?.call).toEqual({ type: 'bid', level: 1, suit: 'C' });
    expect(recommendation?.description).toContain('精确 1C 开叫');

    expect(recommendCall([], hand, [], 'S', null, 1)).toEqual({
      call: { type: 'pass' },
      description: '没有匹配当前序列的体系规则，建议不叫（Pass）',
    });
    expect(recommendCall(precision, null, [], 'S', null, 1)).toBeNull();
  });
});
