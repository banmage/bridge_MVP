import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import BidHistory from './BidHistory.vue';
import { useGameStore } from '../store/game';

describe('BidHistory 叫牌结束符', () => {
  it('东家开叫 1H 后三家 Pass，结束符另起一行写在第一列', () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useGameStore();
    store.startNewGame({ autoStart: false, seed: 7 });
    store.phase = 'scoring';
    store.dealer = 'E';
    store.biddingHistory = [
      { position: 'E', call: { type: 'bid', level: 1, suit: 'H' } },
      { position: 'S', call: { type: 'pass' } },
      { position: 'W', call: { type: 'pass' } },
      { position: 'N', call: { type: 'pass' } },
    ];

    const wrapper = mount(BidHistory, { global: { plugins: [pinia] } });
    const rows = wrapper.findAll('.bid-row');

    // 第一行北家格留空，不再把“=”填在最后一家 Pass 的座位上
    expect(rows).toHaveLength(2);
    expect(rows[0].findAll('.bid-cell').map((cell) => cell.text())).toEqual([
      '',
      '1♥',
      '—',
      '—',
    ]);
    // 第二行第一列（北家列）填写结束符
    expect(rows[1].findAll('.bid-cell').map((cell) => cell.text())).toEqual([
      '=',
      '',
      '',
      '',
    ]);
  });

  it('南家发牌时按座位列回绕换行，东家的 1NT 落在第二行第二列', () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useGameStore();
    store.startNewGame({ autoStart: false, seed: 8 });
    store.phase = 'play';
    store.dealer = 'S';
    store.biddingHistory = [
      { position: 'S', call: { type: 'pass' } },
      { position: 'W', call: { type: 'bid', level: 1, suit: 'C' } },
      { position: 'N', call: { type: 'pass' } },
      { position: 'E', call: { type: 'bid', level: 1, suit: 'NT' } },
    ];

    const wrapper = mount(BidHistory, { global: { plugins: [pinia] } });
    const rows = wrapper.findAll('.bid-row');

    expect(rows).toHaveLength(2);
    expect(rows[0].findAll('.bid-cell').map((cell) => cell.text())).toEqual([
      '',
      '',
      '—',
      '1♣',
    ]);
    expect(rows[1].findAll('.bid-cell').map((cell) => cell.text())).toEqual([
      '—',
      '1NT',
      '',
      '',
    ]);
  });

  it('加倍与再加倍使用 X / XX，不显示中文', () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useGameStore();
    store.startNewGame({ autoStart: false, seed: 9 });
    store.phase = 'play';
    store.biddingHistory = [
      { position: 'N', call: { type: 'bid', level: 1, suit: 'H' } },
      { position: 'E', call: { type: 'double' } },
      { position: 'S', call: { type: 'redouble' } },
    ];

    const wrapper = mount(BidHistory, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain('X');
    expect(wrapper.text()).toContain('XX');
    expect(wrapper.text()).not.toContain('加倍');
  });
});

describe('BidHistory 联网快照模式', () => {
  it('使用外部叫牌历史与当前叫牌人渲染，不读取单人 store', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useGameStore();
    store.startNewGame({ autoStart: false, seed: 10 });
    store.biddingHistory = [{ position: 'N', call: { type: 'bid', level: 7, suit: 'NT' } }];

    const wrapper = mount(BidHistory, {
      props: {
        variant: 'table',
        biddingHistory: [
          { position: 'N', call: { type: 'bid', level: 1, suit: 'H' }, alerted: true, alertText: '约定叫' },
          { position: 'E', call: { type: 'pass' } },
        ],
        phase: 'bidding',
        currentBidder: 'S',
      },
      global: { plugins: [pinia] },
    });

    expect(wrapper.get('.bid-header').text()).toContain('北');
    expect(wrapper.text()).toContain('1♥');
    expect(wrapper.text()).not.toContain('7NT');

    const alerted = wrapper.get('.bid-cell.alerted');
    await alerted.trigger('mouseenter');
    const hint = wrapper.get('.hint-veil').text();
    expect(hint).toContain('约定叫');
    expect(hint).toContain('1H 开叫');

    await alerted.trigger('mouseleave');
    expect(wrapper.find('.hint-veil').exists()).toBe(false);
    expect(wrapper.get('.bid-cell.thinking .bid-label').text()).toBe('？');
  });

  it('外部阶段为打牌中时，最后一个 Pass 显示结束符', () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mount(BidHistory, {
      props: {
        biddingHistory: [
          { position: 'N', call: { type: 'bid', level: 1, suit: 'H' } },
          { position: 'E', call: { type: 'pass' } },
          { position: 'S', call: { type: 'pass' } },
          { position: 'W', call: { type: 'pass' } },
        ],
        phase: 'play',
      },
      global: { plugins: [pinia] },
    });

    expect(wrapper.text()).toContain('=');
  });
});
