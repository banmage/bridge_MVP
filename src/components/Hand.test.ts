import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import Hand from './Hand.vue';
import { parseHand } from '../testing/testUtils';

describe('Hand 牌面布局', () => {
  it('南家单行显示，按 ♠ ♥ ♣ ♦ 从大到小排列', () => {
    const wrapper = mount(Hand, {
      props: { cards: parseHand('SAKQ2 HJT9 D5 C876'), position: 'S' },
    });
    const suits = wrapper.get('.suits');
    expect(suits.classes()).toContain('single-row');
    expect(wrapper.findAll('.suit-row')).toHaveLength(0);
    expect(wrapper.findAll('.suit-group')).toHaveLength(4);
    expect(wrapper.findAll('.card').map((c) => c.text())).toEqual([
      'A',
      'K',
      'Q',
      '2',
      'J',
      '10',
      '9',
      '8',
      '7',
      '6',
      '5',
    ]);
  });

  it('北家单行显示，缺门不渲染占位符', () => {
    const wrapper = mount(Hand, {
      props: { cards: parseHand('SAKQJ2 HJT9 D5432'), position: 'N' },
    });
    expect(wrapper.findAll('.suit-row')).toHaveLength(0);
    expect(wrapper.findAll('.suit-group')).toHaveLength(3);
    expect(wrapper.findAll('.void')).toHaveLength(0);
    expect(wrapper.findAll('.card')).toHaveLength(12);
  });

  it('东西家与南北家一致：单行全尺寸牌面，不渲染空花色占位', () => {
    const wrapper = mount(Hand, {
      props: { cards: parseHand('SAKQJ2 HJT9 D5432 C8'), position: 'E' },
    });
    expect(wrapper.get('.suits').classes()).toContain('single-row');
    expect(wrapper.findAll('.suit-row')).toHaveLength(0);
    expect(wrapper.findAll('.hand-row')).toHaveLength(1);
    expect(wrapper.findAll('.suit-group')).toHaveLength(4);
    expect(wrapper.findAll('.void')).toHaveLength(0);
    expect(wrapper.findAll('.card').every((card) => card.classes().includes('size-xxl'))).toBe(true);
  });

  it('暗手只渲染牌背，不泄露牌型', () => {
    const wrapper = mount(Hand, {
      props: { cards: parseHand('SAKQ2 HJT9 D543 C876'), position: 'E', faceDown: true },
    });
    expect(wrapper.findAll('.suit-row')).toHaveLength(0);
    expect(wrapper.findAll('.card.back')).toHaveLength(13);
    expect(wrapper.findAll('.card.back').every((card) => card.classes().includes('size-xxl'))).toBe(true);
  });

  it('可点击时派发 card-click 事件', async () => {
    const wrapper = mount(Hand, {
      props: { cards: parseHand('SAKQ HJT9 D5432 C87'), position: 'S', clickable: true },
    });
    await wrapper.find('.card').trigger('click');
    expect(wrapper.emitted('card-click')).toBeTruthy();
  });

  it('双击卡牌派发 card-dblclick 事件', async () => {
    const cards = parseHand('SAKQ HJT9 D5432 C87');
    const wrapper = mount(Hand, {
      props: { cards, position: 'S', clickable: true },
    });
    await wrapper.find('.card').trigger('dblclick');
    expect(wrapper.emitted('card-dblclick')?.[0]).toEqual([cards[0]]);
  });

  it('推荐出牌在对应牌张上方显示闪烁箭头，悬停显示辅助说明', async () => {
    const cards = parseHand('SA H2');
    const wrapper = mount(Hand, {
      props: { cards, position: 'S', clickable: true, recommendedCard: cards[0] },
    });

    expect(wrapper.find('.playing-card.recommended').exists()).toBe(false);
    const slot = wrapper
      .findAll('.card-slot')
      .find((item) => item.find('.turn-arrow.variant-card').exists());
    expect(slot).toBeTruthy();
    expect(slot!.get('.playing-card').attributes('data-rank')).toBe('A');
    const arrow = slot!.get('.turn-arrow.variant-card');
    expect(arrow.attributes('aria-label')).toBe('推荐出牌');
    expect(arrow.find('svg').exists()).toBe(true);

    await slot!.trigger('mouseenter');
    expect(wrapper.get('.hint-veil').text()).toContain('推荐出牌');
    expect(wrapper.get('.hint-veil').text()).toContain('系统建议');
    await slot!.trigger('mouseleave');
    expect(wrapper.find('.hint-veil').exists()).toBe(false);
  });

  it('推荐箭头按显示方位贴在中央侧：上家在下、下家在上、左右家朝向中央', () => {
    const cards = parseHand('SA H2');
    const cases: Array<['north' | 'south' | 'west' | 'east', string]> = [
      ['north', 'N'],
      ['south', 'S'],
      ['west', 'W'],
      ['east', 'E'],
    ];

    for (const [displaySlot, position] of cases) {
      const wrapper = mount(Hand, {
        props: {
          cards,
          position: 'E',
          displaySlot,
          clickable: true,
          recommendedCard: cards[0],
        },
      });
      const arrow = wrapper.get('.turn-arrow.variant-card');
      expect(arrow.classes()).toContain(`pos-${position}`);
      expect(arrow.attributes('aria-label')).toBe('推荐出牌');
    }
  });

  it('相对视角下转向箭头使用显示方位而不是真实座位', () => {
    const wrapper = mount(Hand, {
      props: {
        cards: parseHand('SA H2'),
        position: 'E',
        displaySlot: 'south',
        showTurnArrow: true,
      },
    });

    expect(wrapper.get('.turn-arrow').classes()).toContain('pos-S');
    expect(wrapper.get('.hand').classes()).toContain('pos-E');
  });

  it('选中的牌带 selected 样式，右键派发 card-confirm 事件', async () => {
    const cards = parseHand('SAKQ HJT9 D5432 C87');
    const wrapper = mount(Hand, {
      props: {
        cards,
        position: 'S',
        clickable: true,
        selectedCard: cards[0],
      },
    });
    expect(wrapper.get('.card').classes()).toContain('selected');
    await wrapper.get('.card').trigger('contextmenu');
    expect(wrapper.emitted('card-confirm')?.[0]).toEqual([cards[0]]);
  });
});
