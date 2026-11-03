<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import type { ChatMessage } from '@shared/protocol';

/**
 * 左下方常驻聊天面板：只占牌桌角落，消息区可滚动。
 * 新消息到达时自动滚到底部；发送后清空输入框。
 */
const props = withDefaults(
  defineProps<{
    messages: ChatMessage[];
    /** 内联展示（无房间时嵌入页面，而不是浮在牌桌角落） */
    inline?: boolean;
    /** 只读：隐藏输入框，仅展示消息（房间已解散等场景） */
    readonly?: boolean;
    /** 面板标题 */
    title?: string;
  }>(),
  {
    inline: false,
    readonly: false,
    title: '聊天',
  },
);
const emit = defineEmits<{ (e: 'send', text: string): void }>();

const text = ref('');
const listRef = ref<HTMLElement | null>(null);

function scrollToBottom(): void {
  const list = listRef.value;
  if (list) list.scrollTop = list.scrollHeight;
}

watch(
  () => props.messages.length,
  async () => {
    await nextTick();
    scrollToBottom();
  },
  { flush: 'post' },
);

function send(): void {
  const value = text.value.trim();
  if (!value) return;
  emit('send', value);
  text.value = '';
}
</script>

<template>
  <section
    class="room-chat"
    :class="{ inline, readonly }"
    :aria-label="readonly ? '房间系统消息' : '房间聊天'"
  >
    <header class="chat-head">
      <span>{{ title }}</span>
      <span class="chat-count">{{ messages.length }}</span>
    </header>
    <div ref="listRef" class="chat-list">
      <p
        v-for="message in messages"
        :key="message.id"
        class="chat-line"
        :class="{ system: message.system }"
      >
        <strong>{{ message.system ? '系统' : message.from }}</strong>
        <span>{{ message.text }}</span>
      </p>
      <p v-if="messages.length === 0" class="chat-empty">还没有消息</p>
    </div>
    <div v-if="!readonly" class="chat-send">
      <input
        v-model="text"
        type="text"
        maxlength="200"
        placeholder="说点什么…"
        aria-label="聊天内容"
        @keyup.enter="send"
      />
      <button type="button" @click="send">发送</button>
    </div>
  </section>
</template>

<style scoped>
.room-chat {
  position: absolute;
  bottom: calc(var(--table-pad) + 2px);
  left: calc(var(--table-pad) + 2px);
  z-index: 3;
  display: flex;
  flex-direction: column;
  width: clamp(210px, 22vw, 280px);
  height: 142px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  background: rgba(4, 24, 16, 0.58);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(5px);
  color: rgba(234, 245, 238, 0.9);
}
.chat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 3px 7px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.16);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.chat-count {
  padding: 0 5px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
  font-size: 10px;
  font-weight: 600;
}
.chat-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 7px;
  scrollbar-width: thin;
}
.chat-line {
  margin: 0 0 3px;
  font-size: 11px;
  line-height: 1.4;
  word-break: break-word;
}
.chat-line strong {
  margin-right: 4px;
  color: #ffe19a;
  font-weight: 700;
}
/* 系统提示：与玩家发言区分，使用琥珀色并轻微倾斜 */
.chat-line.system {
  padding: 2px 5px;
  border-left: 2px solid rgba(255, 193, 94, 0.75);
  border-radius: 0 4px 4px 0;
  background: rgba(255, 193, 94, 0.1);
  color: #ffdf9f;
  font-style: italic;
}
.chat-line.system strong {
  color: #ffc15e;
}
/* 内联模式：无房间时嵌入页面，不覆盖牌桌 */
.room-chat.inline {
  position: static;
  width: 100%;
  height: 168px;
  margin-top: 2px;
  background: rgba(6, 32, 21, 0.72);
}
.room-chat.inline .chat-list {
  padding: 6px 9px;
}
.room-chat.inline .chat-line {
  font-size: 12px;
}
.chat-empty {
  margin: 6px 0 0;
  color: rgba(234, 245, 238, 0.45);
  font-size: 11px;
}
.chat-send {
  display: flex;
  gap: 3px;
  padding: 3px 5px 5px;
}
.chat-send input {
  flex: 1;
  min-width: 0;
  height: 22px;
  padding: 0 6px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.94);
  color: #1d2d25;
  font-family: inherit;
  font-size: 11px;
}
.chat-send button {
  height: 22px;
  padding: 0 9px;
  border: 1px solid #9bbf8e;
  border-radius: 3px;
  background: #2f7c52;
  color: #f4fff8;
  font-family: inherit;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}
.chat-send button:hover {
  background: #3a9462;
}
@media (max-width: 880px) {
  .room-chat {
    display: none;
  }
  .room-chat.inline {
    display: flex;
  }
}
</style>
