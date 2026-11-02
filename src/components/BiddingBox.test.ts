import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import ElementPlus from 'element-plus';
import BiddingBox from './BiddingBox.vue';
import { useGameStore } from '../store/game';

function setup() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useGameStore();
  store.startNewGame({ autoStart: false, seed: 9 });
  const wrapper = mount(BiddingBox, { global: { plugins: [pinia, ElementPlus] } });
  return { store, wrapper };
}

describe('BiddingBox 叫牌浮窗', () => {
  it('只包含叫牌卡控件，不再内嵌叫牌过程或最终结果', () => {
    const { wrapper } = setup();
    expect(wrapper.find('.bidding-popup').exists()).toBe(true);
    expect(wrapper.findAll('.bid-btn').length).toBeGreaterThan(0);
    expect(wrapper.find('.popup-bar').exists()).toBe(true);
    expect(wrapper.find('.bid-history').exists()).toBe(false);
    expect(wrapper.find('.flow-notice').exists()).toBe(false);
    expect(wrapper.find('.final-contract').exists()).toBe(false);
    expect(wrapper.find('.contract').exists()).toBe(false);
  });

  it('拖动标题栏可移动浮窗，松开后结束拖动', async () => {
    const { wrapper } = setup();
    const bar = wrapper.get('.popup-bar');
    const popup = wrapper.get('.bidding-popup');
    const before = popup.attributes('style');

    bar.element.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 120, clientY: 120, bubbles: true }));
    await nextTick();
    expect(bar.classes()).toContain('dragging');

    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 190, clientY: 170 }));
    await nextTick();
    expect(popup.attributes('style')).not.toBe(before);

    window.dispatchEvent(new MouseEvent('pointerup'));
    await nextTick();
    expect(bar.classes()).not.toContain('dragging');
  });

  it('上家叫 1♣ 后，同阶更高的 1♠ 可以叫', async () => {
    const { store, wrapper } = setup();
    store.biddingHistory = [
      { position: 'N', call: { type: 'bid', level: 1, suit: 'C' } },
      { position: 'E', call: { type: 'pass' } },
    ];
    store.currentBid = { level: 1, suit: 'C' };
    store.currentBidder = 'S';
    await nextTick();

    const oneSpade = wrapper.get('button.bid-btn[data-level="1"][data-suit="S"]');
    expect(oneSpade.attributes('disabled')).toBeUndefined();
  });

  it('选择叫品后点击“确认”才提交', async () => {
    const { store, wrapper } = setup();
    store.biddingHistory = [];
    store.currentBid = null;
    store.currentBidder = 'S';
    await nextTick();

    const oneSpade = wrapper.get('button.bid-btn[data-level="1"][data-suit="S"]');
    await oneSpade.trigger('click');
    expect(store.biddingHistory).toHaveLength(0);
    expect(oneSpade.classes()).toContain('selected');

    const confirm = wrapper.get('.confirm-btn');
    expect(confirm.attributes('disabled')).toBeUndefined();
    await confirm.trigger('click');
    expect(store.biddingHistory[0]?.call).toEqual({ type: 'bid', level: 1, suit: 'S' });
  });

  it('“确认+提醒”提交时标记该次叫牌（不弹提醒框）', async () => {
    const { store, wrapper } = setup();
    store.biddingHistory = [];
    store.currentBid = null;
    store.currentBidder = 'S';
    await nextTick();

    await wrapper.get('button.bid-btn[data-level="1"][data-suit="S"]').trigger('click');
    const confirms = wrapper.findAll('.confirm-btn');
    await confirms[1].trigger('click');

    expect(store.biddingHistory[0]?.alerted).toBe(true);
    expect(store.biddingHistory[0]?.call).toEqual({ type: 'bid', level: 1, suit: 'S' });
  });

  it('双击叫牌卡直接提交，无需再点确认', async () => {
    const { store, wrapper } = setup();
    store.biddingHistory = [];
    store.currentBid = null;
    store.currentBidder = 'S';
    await nextTick();

    const oneSpade = wrapper.get('button.bid-btn[data-level="1"][data-suit="S"]');
    await oneSpade.trigger('dblclick');
    expect(store.biddingHistory[0]?.call).toEqual({ type: 'bid', level: 1, suit: 'S' });
  });

  it('双击 Pass 直接提交', async () => {
    const { store, wrapper } = setup();
    store.biddingHistory = [];
    store.currentBid = null;
    store.currentBidder = 'S';
    await nextTick();

    const pass = wrapper.get('.special-btn.pass');
    expect(pass.attributes('disabled')).toBeUndefined();
    await pass.trigger('dblclick');
    expect(store.biddingHistory[0]?.call).toEqual({ type: 'pass' });
  });

  it('双击 X 直接提交', async () => {
    const { store, wrapper } = setup();
    store.biddingHistory = [{ position: 'E', call: { type: 'bid', level: 1, suit: 'S' } }];
    store.currentBid = { level: 1, suit: 'S' };
    store.currentBidder = 'S';
    await nextTick();

    const double = wrapper.get('.special-btn.x');
    expect(double.attributes('disabled')).toBeUndefined();
    await double.trigger('dblclick');
    expect(store.biddingHistory[1]?.call).toEqual({ type: 'double' });
  });

  it('双击 XX 直接提交', async () => {
    const { store, wrapper } = setup();
    store.biddingHistory = [
      { position: 'S', call: { type: 'bid', level: 1, suit: 'S' } },
      { position: 'W', call: { type: 'double' } },
      { position: 'N', call: { type: 'pass' } },
      { position: 'E', call: { type: 'pass' } },
    ];
    store.currentBid = { level: 1, suit: 'S' };
    store.currentBidder = 'S';
    await nextTick();

    const redouble = wrapper.get('.special-btn.xx');
    expect(redouble.attributes('disabled')).toBeUndefined();
    await redouble.trigger('dblclick');
    expect(store.biddingHistory[4]?.call).toEqual({ type: 'redouble' });
  });
});

describe('BiddingBox 联网模式（外部快照）', () => {
  function setupExternal(props: Record<string, unknown> = {}) {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useGameStore();
    store.startNewGame({ autoStart: false, seed: 11 });
    const wrapper = mount(BiddingBox, {
      props: {
        biddingHistory: [],
        currentBidder: 'S',
        canBid: true,
        ...props,
      },
      global: { plugins: [pinia, ElementPlus] },
    });
    return { store, wrapper };
  }

  it('外部模式下确认叫牌通过 submit 事件提交，不修改单人 store', async () => {
    const { store, wrapper } = setupExternal();
    const before = store.biddingHistory.length;

    const oneSpade = wrapper.get('button.bid-btn[data-level="1"][data-suit="S"]');
    await oneSpade.trigger('click');
    await wrapper.get('.confirm-btn').trigger('click');

    expect(store.biddingHistory).toHaveLength(before);
    expect(wrapper.emitted('submit')?.[0]).toEqual([{ type: 'bid', level: 1, suit: 'S' }, undefined]);
  });

  it('外部模式下“确认+提醒”把提醒文本一并提交', async () => {
    const { wrapper } = setupExternal();
    await wrapper.get('.bid-combo').setValue('约定叫');
    await wrapper.get('button.bid-btn[data-level="1"][data-suit="S"]').trigger('click');
    await wrapper.findAll('.confirm-btn')[1].trigger('click');

    expect(wrapper.emitted('submit')?.[0]).toEqual([
      { type: 'bid', level: 1, suit: 'S' },
      { text: '约定叫' },
    ]);
  });

  it('不允许操作时所有叫牌卡禁用', () => {
    const { wrapper } = setupExternal({ canBid: false });
    expect(wrapper.get('button.bid-btn[data-level="1"][data-suit="C"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('.special-btn.pass').attributes('disabled')).toBeDefined();
  });

  it('外部模式下非法叫品仍按叫牌历史禁用', () => {
    const { wrapper } = setupExternal({
      biddingHistory: [{ position: 'N', call: { type: 'bid', level: 2, suit: 'H' } }],
      currentBid: { level: 2, suit: 'H' },
    });
    expect(
      wrapper.get('button.bid-btn[data-level="1"][data-suit="S"]').attributes('disabled'),
    ).toBeDefined();
    expect(
      wrapper.get('button.bid-btn[data-level="2"][data-suit="S"]').attributes('disabled'),
    ).toBeUndefined();
  });
});

