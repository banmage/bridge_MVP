<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { Position, RoomView } from '@shared/protocol';
import { useOnlineStore } from '../store/online';
import OnlineTable from '../components/online/OnlineTable.vue';
import BidPanel from '../components/online/BidPanel.vue';
import SeatConfigPanel from '../components/online/SeatConfigPanel.vue';
import ScoreTable from '../components/online/ScoreTable.vue';
import BoardReplayDialog from '../components/online/BoardReplayDialog.vue';

const props = defineProps<{ code: string }>();
const store = useOnlineStore();
const router = useRouter();

const activeTab = ref<'table' | 'score'>('table');
const replayVisible = ref(false);
const replayIndex = ref<number | null>(null);
const chatText = ref('');
const now = ref(Date.now());

let clock: ReturnType<typeof setInterval> | null = null;
let joinTimer: ReturnType<typeof setTimeout> | null = null;

const room = computed<RoomView | null>(() => store.room);
const isMine = computed(() => room.value?.code === props.code.toUpperCase());
const board = computed(() => (isMine.value ? room.value?.board ?? null : null));
const isLobby = computed(() => room.value?.status === 'lobby');

const replayBoard = computed(() =>
  replayIndex.value === null ? null : store.records[replayIndex.value] ?? null,
);

const countdown = computed(() => {
  const at = room.value?.nextBoardAt;
  if (!at) return null;
  return Math.max(0, Math.ceil((at - now.value) / 1000));
});

const canNextBoard = computed(
  () => board.value?.phase === 'scored' && room.value?.status === 'playing',
);

const connectionText = computed(
  () =>
    ({
      idle: '未连接',
      connecting: '连接中…',
      open: '已连接',
      reconnecting: '正在重连…',
      closed: '已断开',
    })[store.connection] ?? store.connection,
);

onMounted(() => {
  store.init();
  // 稍等连接建立再请求加入，避免首帧丢包
  joinTimer = setTimeout(() => {
    if (!store.room || store.room.code !== props.code.toUpperCase()) {
      store.joinRoom(props.code);
    } else {
      store.requestState();
    }
  }, 120);
  clock = setInterval(() => {
    now.value = Date.now();
  }, 500);
});

onUnmounted(() => {
  if (clock) clearInterval(clock);
  if (joinTimer) clearTimeout(joinTimer);
});

watch(
  () => [room.value?.status, board.value?.phase, board.value?.index] as const,
  () => {
    if (board.value?.phase === 'scored') activeTab.value = 'score';
  },
);

watch(
  () => room.value?.code,
  (code) => {
    if (code && code !== props.code.toUpperCase()) router.replace(`/room/${code}`);
  },
);

// 断线重连/首帧连接建立后补发加入请求
watch(
  () => store.connection,
  (state) => {
    if (state === 'open' && (!store.room || store.room.code !== props.code.toUpperCase())) {
      store.joinRoom(props.code);
    }
  },
);

function onPlay(card: number): void {
  store.submitPlay(card);
}

function onBid(call: Parameters<typeof store.submitBid>[0], alert?: { text: string }): void {
  store.submitBid(call, alert);
}

function onSetSeat(
  seat: Position,
  occupant: Parameters<typeof store.setSeat>[1],
): void {
  store.setSeat(seat, occupant);
}

function openReplay(index: number): void {
  replayIndex.value = index;
  replayVisible.value = true;
}

function leave(): void {
  store.leaveRoom();
  router.push('/');
}

function copyCode(): void {
  const code = room.value?.code;
  if (!code) return;
  void navigator.clipboard?.writeText(`${location.origin}/room/${code}`).catch(() => undefined);
}

function sendChat(): void {
  if (!chatText.value.trim()) return;
  store.chat(chatText.value);
  chatText.value = '';
}

function statusLabel(status: string | undefined): string {
  return { lobby: '等待开赛', playing: '比赛进行中', finished: '比赛已结束' }[status ?? ''] ?? '';
}
</script>

<template>
  <div class="room-view">
    <header class="room-header">
      <div class="room-title">
        <router-link to="/" class="back">← 大厅</router-link>
        <h1>房间 <span class="code">{{ props.code.toUpperCase() }}</span></h1>
        <span class="status-pill" :class="room?.status">{{ statusLabel(room?.status) }}</span>
        <span class="connection" :class="store.connection">{{ connectionText }}</span>
      </div>
      <div class="room-actions">
        <el-button size="small" @click="copyCode">复制邀请链接</el-button>
        <el-button size="small" :disabled="!room" @click="store.requestState()">刷新状态</el-button>
        <el-button size="small" type="danger" text @click="leave">离开房间</el-button>
      </div>
    </header>

    <el-alert
      v-if="store.error"
      class="error-bar"
      type="error"
      :title="store.error.message"
      :closable="true"
      @close="store.clearError()"
    />

    <div class="toasts">
      <el-alert
        v-for="toast in store.toasts"
        :key="toast.id"
        :type="toast.level === 'warn' ? 'warning' : 'info'"
        :title="toast.message"
        :closable="true"
        @close="store.dismissToast(toast.id)"
      />
    </div>

    <div v-if="!room" class="loading card">
      <p>正在进入房间 {{ props.code.toUpperCase() }}…</p>
      <p v-if="store.error" class="hint">{{ store.error.message }}</p>
      <el-button v-if="store.error?.code === 'ROOM_NOT_FOUND'" @click="router.push('/')">返回大厅</el-button>
    </div>

    <template v-else>
      <SeatConfigPanel
        v-if="isLobby"
        :room="room"
        :is-host="store.isHost"
        @set-seat="onSetSeat"
        @update-bot="(seat, persona) => store.updateBot(seat, persona)"
        @set-config="(config) => store.setConfig(config)"
        @start="store.startMatch()"
      />

      <template v-else>
        <div class="match-bar">
          <div class="match-info">
            <span>第 {{ board?.index ?? 0 }} / {{ room.config.boards }} 副</span>
            <span>{{ room.config.scoring === 'mp' ? '双人赛 MP' : '贴点制' }}</span>
            <span v-if="board?.dummySeat">明手 {{ board.dummySeat }}</span>
          </div>
          <div class="next-box" v-if="canNextBoard">
            <span v-if="countdown !== null">{{ countdown }} 秒后自动开始下一副</span>
            <el-button type="primary" size="small" @click="store.nextBoard()">立即开始下一副</el-button>
          </div>
          <div v-else-if="room.status === 'finished'" class="finished-banner">
            比赛结束 · {{ room.result.winner === 'tie' ? '双方打平' : `${room.result.winner === 'NS' ? '南北' : '东西'} 获胜` }}
          </div>
        </div>

        <div class="room-body">
          <div class="main-column">
            <el-tabs v-model="activeTab" class="room-tabs">
              <el-tab-pane label="牌桌" name="table">
                <OnlineTable :room="room" @play="onPlay" />
                <BidPanel v-if="board?.phase === 'bidding'" :room="room" @bid="onBid" />
              </el-tab-pane>
              <el-tab-pane label="成绩与复盘" name="score">
                <ScoreTable :room="room" @replay="openReplay" />
              </el-tab-pane>
            </el-tabs>
          </div>

          <aside class="side-column">
            <section class="card chat">
              <h3>房间聊天</h3>
              <div class="messages">
                <p v-for="message in room.chat" :key="message.id" class="message">
                  <strong>{{ message.from }}</strong>
                  <span>{{ message.text }}</span>
                </p>
                <p v-if="room.chat.length === 0" class="hint">还没有消息</p>
              </div>
              <div class="chat-input">
                <el-input
                  v-model="chatText"
                  size="small"
                  maxlength="200"
                  placeholder="说点什么…"
                  @keyup.enter="sendChat"
                />
                <el-button size="small" type="primary" @click="sendChat">发送</el-button>
              </div>
            </section>
          </aside>
        </div>
      </template>
    </template>

    <BoardReplayDialog v-model:visible="replayVisible" :board="replayBoard" />
  </div>
</template>

<style scoped>
.room-view {
  max-width: 1320px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.room-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  color: #eaf5ee;
  padding: 10px 14px;
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(6, 32, 21, 0.68), rgba(4, 24, 16, 0.42));
  border: 1px solid rgba(255, 255, 255, 0.12);
}
.room-title {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.room-title h1 {
  margin: 0;
  font-size: 18px;
}
.back {
  color: #9ef0bd;
  text-decoration: none;
  font-size: 13px;
}
.code {
  letter-spacing: 3px;
  color: #ffe19a;
}
.status-pill {
  font-size: 12px;
  padding: 3px 9px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
}
.status-pill.playing {
  background: rgba(158, 240, 189, 0.2);
  color: #9ef0bd;
}
.status-pill.finished {
  background: rgba(255, 225, 154, 0.18);
  color: #ffe19a;
}
.connection {
  font-size: 11px;
  opacity: 0.8;
}
.room-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.error-bar {
  border-radius: 12px;
}
.toasts {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.loading {
  color: #eaf5ee;
  background: rgba(6, 32, 21, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.12);
}
.hint {
  font-size: 12px;
  color: #8a978f;
}
.match-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 9px 14px;
  border-radius: 12px;
  background: rgba(7, 30, 21, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(234, 245, 238, 0.9);
  font-size: 12px;
}
.match-info {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}
.next-box {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
}
.finished-banner {
  margin-left: auto;
  color: #ffe19a;
  font-weight: 700;
}
.room-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 12px;
  align-items: start;
}
.main-column {
  min-width: 0;
}
.room-tabs :deep(.el-tabs__header) {
  margin-bottom: 8px;
}
.room-tabs :deep(.el-tabs__nav-wrap::after) {
  display: none;
}
.room-tabs :deep(.el-tabs__item) {
  color: rgba(234, 245, 238, 0.7);
}
.room-tabs :deep(.el-tabs__item.is-active) {
  color: #ffe19a;
}
.side-column {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.card {
  background: var(--paper);
  border-radius: 14px;
  padding: 12px;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.22);
}
.chat {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.chat h3 {
  margin: 0;
  font-size: 14px;
  color: var(--felt-dark);
}
.messages {
  height: 230px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 6px;
  background: #f3f7f4;
  border-radius: 9px;
}
.message {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: #33443a;
}
.message strong {
  color: #14563a;
  margin-right: 5px;
}
.chat-input {
  display: flex;
  gap: 5px;
}
@media (max-width: 1000px) {
  .room-body {
    grid-template-columns: 1fr;
  }
  .messages {
    height: 150px;
  }
}
</style>
