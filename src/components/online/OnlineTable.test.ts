import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import ElementPlus from 'element-plus';
import type { BoardView, RoomView } from '@shared/protocol';
import OnlineTable from './OnlineTable.vue';
import { parseHand } from '../../testing/testUtils';

function makeBoard(overrides: Partial<BoardView> = {}): BoardView {
  return {
    index: 3,
    dealer: 'N',
    vulnerability: 'NS',
    phase: 'bidding',
    currentBidder: 'N',
    nextPlayer: null,
    contract: null,
    bidding: [],
    tricks: [],
    currentTrick: [],
    yourSeat: 'S',
    yourHand: parseHand('SA SK HQ DJ C9'),
    dummySeat: null,
    dummyHand: null,
    dummyOpen: false,
    revealedHands: null,
    score: null,
    scoring: null,
    canAct: false,
    actingForSeat: null,
    message: '轮到 N 叫牌',
    ...overrides,
  };
}

function makeRoom(board: BoardView): RoomView {
  return {
    code: 'ABC123',
    status: 'playing',
    hostId: 'p1',
    you: { playerId: 'p1', name: 'Alice', seat: 'S' },
    config: { boards: 12, scoring: 'mp', seedBase: 1, matchId: 'm-1' },
    seats: {
      N: {
        kind: 'bot',
        persona: {
          id: 'bot-n',
          name: '北家机器人',
          risk: 'normal',
          system: 'precision',
          conventions: [],
          randomness: 0,
        },
      },
      E: {
        kind: 'bot',
        persona: {
          id: 'bot-e',
          name: '东家机器人',
          risk: 'normal',
          system: 'precision',
          conventions: [],
          randomness: 0,
        },
      },
      S: { kind: 'human', playerId: 'p1', name: 'Alice', connected: true },
      W: {
        kind: 'bot',
        persona: {
          id: 'bot-w',
          name: '西家机器人',
          risk: 'normal',
          system: 'precision',
          conventions: [],
          randomness: 0,
        },
      },
    },
    board,
    completed: [],
    result: {
      boardsPlayed: 0,
      nsPoints: 0,
      ewPoints: 0,
      nsImps: 0,
      nsMpPercent: 0,
      winner: 'tie',
      perBoard: [],
    },
    chat: [],
    nextBoardAt: null,
    serverTime: 1_700_000_000_000,
  };
}

function mountTable(board: BoardView) {
  const pinia = createPinia();
  setActivePinia(pinia);
  return mount(OnlineTable, {
    props: { room: makeRoom(board) },
    global: { plugins: [pinia, ElementPlus] },
  });
}

describe('OnlineTable 联网牌桌布局', () => {
  it('叫牌阶段在中央显示叫牌纸、左上角显示牌局信息，并解释约定提醒', async () => {
    const wrapper = mountTable(
      makeBoard({
        phase: 'bidding',
        currentBidder: 'E',
        bidding: [
          {
            position: 'N',
            call: { type: 'bid', level: 1, suit: 'H' },
            alerted: true,
            alertText: '精确制 1♥ 开叫（约定：强无将）',
          },
          { position: 'E', call: { type: 'pass' } },
        ],
      }),
    );

    expect(wrapper.find('.center .bid-history').exists()).toBe(true);
    expect(wrapper.find('.play-bid-history').exists()).toBe(false);
    expect(wrapper.get('.play-info-panel').text()).toContain('副序');
    expect(wrapper.get('.play-info-panel').text()).toContain('南北有局');
    // 约定提醒改为悬停时在统一浮动层显示，不再常驻占用牌桌中央
    const alerted = wrapper.get('.bid-cell.alerted');
    await alerted.trigger('mouseenter');
    expect(wrapper.get('.hint-veil').text()).toContain('精确制 1♥ 开叫');
    await alerted.trigger('mouseleave');
    expect(wrapper.find('.hint-veil').exists()).toBe(false);
    expect(wrapper.find('.center-alert').exists()).toBe(false);
    // 当前叫牌人显示“正在考虑”
    expect(wrapper.get('.bid-cell.thinking .bid-label').text()).toBe('？');
    // 叫牌阶段不显示出牌箭头
    expect(wrapper.findAll('.turn-arrow')).toHaveLength(0);
  });

  it('出牌阶段把叫牌过程停靠到右侧，并在轮到行动的座位显示箭头', () => {
    const wrapper = mountTable(
      makeBoard({
        phase: 'play',
        currentBidder: 'N',
        nextPlayer: 'E',
        contract: { level: 4, suit: 'H', doubled: false, redoubled: false, declarer: 'N', dummy: 'S' },
        bidding: [
          { position: 'N', call: { type: 'bid', level: 4, suit: 'H' } },
          { position: 'E', call: { type: 'pass' } },
          { position: 'S', call: { type: 'pass' } },
          { position: 'W', call: { type: 'pass' } },
        ],
      }),
    );

    expect(wrapper.find('.center .bid-history').exists()).toBe(false);
    expect(wrapper.find('.play-bid-history').exists()).toBe(true);
    expect(wrapper.find('.play-bid-history').text()).toContain('4♥');

    // 即使不是本人操作，也显示指向东家手牌的箭头
    expect(wrapper.findAll('.turn-arrow')).toHaveLength(1);
    expect(wrapper.find('.hand.pos-E .turn-arrow').exists()).toBe(true);
    expect(wrapper.get('.turn-arrow').classes()).toContain('pos-E');
    expect(wrapper.get('.seat.east .seat-profile').text()).toContain('东E_');
  });

  it('中央按出牌次序叠放本墩牌面并标注序号', () => {
    const wrapper = mountTable(
      makeBoard({
        phase: 'play',
        nextPlayer: 'W',
        contract: { level: 1, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' },
        currentTrick: [
          { position: 'N', card: parseHand('SA')[0] },
          { position: 'E', card: parseHand('H2')[0] },
          { position: 'S', card: parseHand('D3')[0] },
        ],
        dummySeat: 'N',
        dummyOpen: true,
        dummyHand: parseHand('SA SK HQ DJ C9'),
      }),
    );

    const plays = wrapper.findAll('.trick-stack .trick-play');
    expect(plays.map((p) => p.get('.playing-card').text())).toEqual(['♠A', '♥2', '♦3']);
    expect(plays.map((p) => p.get('.play-order').text())).toEqual(['1', '2', '3']);
    expect(plays[0].classes()).toContain('slot-N');
    expect(plays[1].classes()).toContain('slot-E');
    expect(plays[2].classes()).toContain('slot-S');
    expect(plays[2].get('.playing-card').classes()).toContain('size-xxl');
  });

  it('左键选中、右键确认出牌；不合法牌不能选中', async () => {
    const wrapper = mountTable(
      makeBoard({
        phase: 'play',
        nextPlayer: 'S',
        canAct: true,
        actingForSeat: 'S',
        contract: { level: 1, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' },
        currentTrick: [{ position: 'W', card: parseHand('SK')[0] }],
        yourHand: parseHand('SA H2'),
      }),
    );
    await wrapper.vm.$nextTick();

    const illegal = wrapper.get('.hand.pos-S .playing-card[data-suit="♥"]');
    await illegal.trigger('click');
    expect(illegal.classes()).not.toContain('selected');

    const legal = wrapper.get('.hand.pos-S .playing-card[data-suit="♠"]');
    await legal.trigger('click');
    expect(legal.classes()).toContain('selected');
    expect(wrapper.emitted('play')).toBeUndefined();

    await legal.trigger('contextmenu');
    expect(wrapper.emitted('play')?.[0]).toEqual([parseHand('SA')[0]]);
    expect(wrapper.find('.hand.pos-S .playing-card.selected').exists()).toBe(false);
  });

  it('双击卡牌直接出牌', async () => {
    const wrapper = mountTable(
      makeBoard({
        phase: 'play',
        nextPlayer: 'S',
        canAct: true,
        actingForSeat: 'S',
        contract: { level: 1, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' },
        yourHand: parseHand('SA H2'),
      }),
    );
    await wrapper.vm.$nextTick();

    const card = wrapper.get('.hand.pos-S .playing-card[data-suit="♠"]');
    await card.trigger('dblclick');
    expect(wrapper.emitted('play')?.[0]).toEqual([parseHand('SA')[0]]);
  });

  it('轮到人类操作时标出推荐牌，非操作状态不显示', async () => {
    const board = makeBoard({
      phase: 'play',
      nextPlayer: 'S',
      canAct: true,
      actingForSeat: 'S',
      contract: { level: 1, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' },
      currentTrick: [{ position: 'W', card: parseHand('SK')[0] }],
      yourHand: parseHand('SA H2'),
    });

    const active = mountTable(board);
    await active.vm.$nextTick();
    expect(active.find('.hand.pos-S .playing-card.recommended').exists()).toBe(false);
    expect(active.get('.hand.pos-S .play-hint-arrow').text()).toBe('▼');

    const slot = active
      .findAll('.hand.pos-S .card-slot')
      .find((item) => item.find('.play-hint-arrow').exists());
    expect(slot).toBeTruthy();
    const recommended = slot!.get('.playing-card');
    // 必须跟黑桃，推荐只能是 ♠A
    expect(recommended.attributes('data-suit')).toBe('♠');
    expect(recommended.attributes('data-rank')).toBe('A');

    const idle = mountTable({ ...board, canAct: false, actingForSeat: null });
    await idle.vm.$nextTick();
    expect(idle.find('.play-hint-arrow').exists()).toBe(false);
  });

  it('按观看者座位旋转牌桌：自己在下、同伴在上，出牌区同步旋转', async () => {
    const wrapper = mountTable(
      makeBoard({
        phase: 'play',
        yourSeat: 'E',
        yourHand: parseHand('SA H2'),
        nextPlayer: 'E',
        contract: { level: 1, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' },
        currentTrick: [
          { position: 'N', card: parseHand('SA')[0] },
          { position: 'E', card: parseHand('H2')[0] },
          { position: 'S', card: parseHand('D3')[0] },
          { position: 'W', card: parseHand('C4')[0] },
        ],
      }),
    );
    await wrapper.vm.$nextTick();

    // 东家视角：东在下、西在上、南在左、北在右
    expect(wrapper.get('.seat.south .seat-name').text()).toContain('东E_');
    expect(wrapper.get('.seat.north .seat-name').text()).toContain('西W_');
    expect(wrapper.get('.seat.west .seat-name').text()).toContain('南S_');
    expect(wrapper.get('.seat.east .seat-name').text()).toContain('北N_');
    expect(wrapper.find('.seat.south .hand.pos-E').exists()).toBe(true);
    expect(wrapper.get('.seat.south .seat-profile').text()).toContain('（你）');

    // 真实方位 N/E/S/W 映射到相对出牌区 E/S/W/N
    const slots = wrapper.findAll('.trick-stack .trick-play').map((play) => play.classes());
    expect(slots[0]).toContain('slot-E');
    expect(slots[1]).toContain('slot-S');
    expect(slots[2]).toContain('slot-W');
    expect(slots[3]).toContain('slot-N');
  });

  it('左下角常驻聊天，发送时向父组件派发 chat-send', async () => {
    const wrapper = mountTable(makeBoard());

    expect(wrapper.find('.room-chat').exists()).toBe(true);
    const input = wrapper.get('.room-chat input');
    await input.setValue('  大家好  ');
    await input.trigger('keyup.enter');

    expect(wrapper.emitted('chat-send')?.[0]).toEqual(['大家好']);
    expect((input.element as HTMLInputElement).value).toBe('');
  });
});
