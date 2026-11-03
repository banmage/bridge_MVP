import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import type { ChatMessage } from '@shared/protocol';
import OnlineChat from './OnlineChat.vue';

function makeMessages(): ChatMessage[] {
  return [
    { id: 'm1', from: 'Alice', seat: 'S', text: '大家好', at: 1 },
    { id: 'm2', from: 'Bob', seat: 'N', text: '晚上好', at: 2 },
  ];
}

describe('OnlineChat 房间聊天', () => {
  it('按顺序显示消息与发送者', () => {
    const wrapper = mount(OnlineChat, { props: { messages: makeMessages() } });

    const lines = wrapper.findAll('.chat-line');
    expect(lines).toHaveLength(2);
    expect(lines[0].get('strong').text()).toBe('Alice');
    expect(lines[0].text()).toContain('大家好');
    expect(lines[1].get('strong').text()).toBe('Bob');
    expect(wrapper.get('.chat-count').text()).toBe('2');
  });

  it('发送时去除首尾空白并清空输入框', async () => {
    const wrapper = mount(OnlineChat, { props: { messages: [] } });

    const input = wrapper.get('input');
    await input.setValue('  你好  ');
    await input.trigger('keyup.enter');

    expect(wrapper.emitted('send')?.[0]).toEqual(['你好']);
    expect((input.element as HTMLInputElement).value).toBe('');
  });

  it('空消息不发送', async () => {
    const wrapper = mount(OnlineChat, { props: { messages: [] } });

    await wrapper.get('input').setValue('   ');
    await wrapper.get('button').trigger('click');

    expect(wrapper.emitted('send')).toBeUndefined();
  });

  it('系统消息单独标记并以“系统”作为发送者', () => {
    const messages: ChatMessage[] = [
      ...makeMessages(),
      { id: 's1', from: '系统', seat: null, text: '牌室已解散或不存在', at: 3, system: true },
    ];
    const wrapper = mount(OnlineChat, { props: { messages } });

    const system = wrapper.get('.chat-line.system');
    expect(system.get('strong').text()).toBe('系统');
    expect(system.text()).toContain('牌室已解散或不存在');
    expect(wrapper.findAll('.chat-line')).toHaveLength(3);
  });

  it('只读内联模式隐藏输入框，仍显示消息', () => {
    const wrapper = mount(OnlineChat, {
      props: { messages: makeMessages(), inline: true, readonly: true, title: '系统消息' },
    });

    expect(wrapper.classes()).toContain('inline');
    expect(wrapper.classes()).toContain('readonly');
    expect(wrapper.find('input').exists()).toBe(false);
    expect(wrapper.get('.chat-head').text()).toContain('系统消息');
    expect(wrapper.findAll('.chat-line')).toHaveLength(2);
  });
});
