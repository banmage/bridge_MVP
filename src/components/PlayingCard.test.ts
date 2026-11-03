import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import PlayingCard from './PlayingCard.vue';
import { parseHand } from '../testing/testUtils';

describe('PlayingCard 双角标', () => {
  it('中央出牌模式在左上角与右下角都提供完整牌名', () => {
    const wrapper = mount(PlayingCard, {
      props: { card: parseHand('SA')[0], size: 'xl', labelMode: 'suit-first' },
    });

    expect(wrapper.get('.pc-label:not(.pc-label-bottom)').text()).toBe('♠A');
    expect(wrapper.get('.pc-label:not(.pc-label-bottom) .suit-symbol').text()).toBe('♠');
    expect(wrapper.get('.pc-label-bottom').attributes('data-label')).toBe('♠A');
    expect(wrapper.get('.pc-label-bottom').attributes('data-suit')).toBe('♠');
    expect(wrapper.get('.pc-label-bottom').attributes('data-rank')).toBe('A');
    expect(wrapper.get('.pc-corner-suit-bottom').attributes('data-suit')).toBe('♠');
    expect(wrapper.get('.pc-corner-suit-bottom').classes()).toContain('suit-symbol');
    expect(wrapper.get('.pc-pip').classes()).toContain('suit-symbol');
  });

  it('手牌模式在右下角同样提供点数与花色', () => {
    const wrapper = mount(PlayingCard, {
      props: { card: parseHand('HK')[0], size: 'xxl' },
    });

    expect(wrapper.get('.pc-label:not(.pc-label-bottom)').text()).toBe('K');
    expect(wrapper.get('.pc-label-bottom').attributes('data-label')).toBe('K');
    expect(wrapper.get('.pc-corner-suit-bottom').attributes('data-suit')).toBe('♥');
    expect(wrapper.classes()).toContain('red');
  });

  it('推荐出牌显示金色箭头与可访问提示', () => {
    const wrapper = mount(PlayingCard, {
      props: { card: parseHand('SA')[0], size: 'xxl', recommended: true, clickable: true },
    });

    expect(wrapper.classes()).toContain('recommended');
    expect(wrapper.get('.pc-recommend-arrow').text()).toBe('▼');
    expect(wrapper.attributes('title')).toBe('推荐出牌');
  });
});
