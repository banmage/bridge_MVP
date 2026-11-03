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
});
