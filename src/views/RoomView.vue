<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import {
  normalizeBiddingSystems,
  type BidCall,
  type BiddingSystem,
  type Position,
  type RoomView,
} from '@shared/protocol';
import { getSide } from '../models/gameState';
import type { BiddingRule } from '../engine/types';
import { lastBidOf } from '../core/bidding/validator';
import { loadBiddingRules } from '../engine/loader';
import { useOnlineStore } from '../store/online';
import OnlineTable from '../components/online/OnlineTable.vue';
import BiddingBox from '../components/BiddingBox.vue';
import SeatConfigPanel from '../components/online/SeatConfigPanel.vue';
import ScoreTable from '../components/online/ScoreTable.vue';
import BoardReplayDialog from '../components/online/BoardReplayDialog.vue';

const props = defineProps<{ code: string }>();
const store = useOnlineStore();
const router = useRouter();

const replayVisible = ref(false);
const replayIndex = ref<number | null>(null);
const scoreVisible = ref(false);
const now = ref(Date.now());

/** 规则资产按体系缓存，切换叫牌人所在方时无需重复解析 YAML */
const ruleCache = new Map<BiddingSystem, BiddingRule[]>();
function rulesFor(system: BiddingSystem): BiddingRule[] {
  const cached = ruleCache.get(system);
  if (cached) return cached;
  const rules = loadBiddingRules(system);
  ruleCache.set(system, rules);
  return rules;
}

let clock: ReturnType<typeof setInterval> | null = null;
let joinTimer: ReturnType<typeof setTimeout> | null = null;

const room = computed<RoomView | null>(() => store.room);
const isMine = computed(() => room.value?.code === props.code.toUpperCase());
const board = computed(() => (isMine.value ? room.value?.board ?? null : null));
const isLobby = computed(() => room.value?.status === 'lobby');
/** 当前是否由 AI 托管自己的座位 */
const autoPlaying = computed(() => !!room.value?.you.autoPlay);
/** 服务端聊天与本地系统提示按时间合并 */
const chatMessages = computed(() => store.chatMessages);

/** 每方叫牌规则：双方体系可能不同，历史叫品按叫牌人所在方解释 */
const biddingRulesBySide = computed<Partial<Record<'NS' | 'EW', BiddingRule[]>>>(() => {
  const systems = normalizeBiddingSystems(room.value?.config.systems);
  return { NS: rulesFor(systems.NS), EW: rulesFor(systems.EW) };
});

/** 按当前叫牌人所在方加载叫牌体系，保证叫牌卡提示与 AI 实际使用的体系一致 */
const biddingRules = computed<BiddingRule[]>(() => {
  const bidder = board.value?.currentBidder;
  return biddingRulesBySide.value[bidder ? getSide(bidder) : 'NS'] ?? [];
});

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

/** 原座位被超时托管时，服务端允许同一身份重新收回 */
const reclaimableSeat = computed<Position | null>(
  () => (isMine.value ? room.value?.you.reclaimableSeat ?? null : null),
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

/** 牌局阶段：与单机版状态栏一致 */
const PHASE_LABEL: Record<string, string> = {
  bidding: '叫牌中',
  play_waiting_lead: '等待首攻',
  play: '打牌中',
  scored: '已结算',
};
const phaseLabel = computed(
  () =>
    PHASE_LABEL[board.value?.phase ?? ''] ??
    (room.value?.status === 'finished' ? '比赛结束' : isLobby.value ? '等待开赛' : '准备中'),
);

const statusText = computed(() => {
  if (room.value?.status === 'finished') {
    const w = room.value.result.winner;
    return w === 'tie' ? '比赛结束 · 双方打平' : `比赛结束 · ${w === 'NS' ? '南北' : '东西'}获胜`;
  }
  if (isLobby.value) return '四位玩家就座后由房主开赛';
  if (!board.value) return '等待发牌';
  return board.value.message;
});

/** 叫牌 / 出牌提示：轮到本人时给出明确操作说明 */
const turnHint = computed(() => {
  if (autoPlaying.value && room.value?.status === 'playing') {
    return '托管中 · AI 正在代你叫牌与出牌 · 可在右下角解除托管';
  }
  if (board.value?.canAct) {
    if (board.value.phase === 'bidding') return '轮到你叫牌 · 请使用叫牌卡';
    if (board.value.phase === 'play' || board.value.phase === 'play_waiting_lead') {
      const forPartner = board.value.actingForSeat !== board.value.yourSeat;
      return forPartner
        ? '轮到你替同伴出牌 · 左键选中，右键或双击确认'
        : '轮到你出牌 · 左键选中，右键或双击确认';
    }
  }
  return statusText.value;
});

/** 只有轮到自己叫牌时才挂载叫牌卡浮窗 */
const showBiddingBox = computed(
  () => board.value?.phase === 'bidding' && !!board.value.canAct,
);

const currentBid = computed(() => (board.value ? lastBidOf(board.value.bidding) : null));

/** 叫牌卡标题：显示当前叫牌人及其身份，与单机版的“叫牌 · 南”一致 */
const bidderLabel = computed(() => {
  const b = board.value;
  if (!b) return '';
  if (b.yourSeat === b.currentBidder) return `${b.currentBidder}（你）`;
  const seat = room.value?.seats[b.currentBidder];
  if (seat?.kind === 'human') return `${b.currentBidder}（${seat.name}）`;
  if (seat?.kind === 'bot') return `${b.currentBidder}（${seat.persona.name}）`;
  return b.currentBidder;
});

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

function onBid(call: BidCall, alert?: { text: string }): void {
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

function openScore(): void {
  if (room.value) scoreVisible.value = true;
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

function onChatSend(text: string): void {
  store.chat(text);
}

/** 主动托管：座位与手牌保留，切换后由 AI 代叫/代打 */
function onToggleAutoPlay(): void {
  store.setAutoPlay(!autoPlaying.value);
}

/** 房主结束当前比赛：确认后回到大厅，可重新配置并开赛 */
async function onEndMatch(): Promise<void> {
  if (!store.isHost) return;
  try {
    await ElMessageBox.confirm(
      '结束后本场进行中的对局将不再保留，房间会回到大厅；可重新配置座位并开始新的牌局。确定结束吗？',
      '结束比赛',
      {
        confirmButtonText: '结束比赛',
        cancelButtonText: '取消',
        type: 'warning',
      },
    );
  } catch {
    return;
  }
  store.endMatch();
}
</script>

<template>
  <div class="room-view">
    <header class="app-header room-header">
      <router-link to="/" class="back">← 大厅</router-link>
      <h1>房间 <span class="code">{{ props.code.toUpperCase() }}</span></h1>
      <div class="status">
        <strong>{{ phaseLabel }}</strong>
        <span class="status-main">{{ turnHint }}</span>
        <span v-if="room" class="status-meta">
          第 {{ board?.index ?? 0 }}/{{ room.config.boards }} 副 ·
          {{ room.config.scoring === 'mp' ? 'MP' : '贴点' }}
          <template v-if="board?.dummySeat"> · 明手 {{ board.dummySeat }}</template>
          <template v-if="room.status === 'finished'">
            · {{ room.result.winner === 'tie' ? '双方打平' : `${room.result.winner === 'NS' ? '南北' : '东西'}获胜` }}
          </template>
          <template v-else-if="canNextBoard">
            · {{ countdown === null ? '本副结束' : `${countdown}s 后下一副` }}
          </template>
        </span>
      </div>
      <span class="connection" :class="store.connection">{{ connectionText }}</span>
      <el-button :disabled="!room" @click="openScore">成绩</el-button>
      <el-button v-if="canNextBoard" type="primary" @click="store.nextBoard()">下一副</el-button>
      <el-button
        v-if="store.isHost && room && room.status !== 'lobby'"
        type="danger"
        plain
        @click="onEndMatch"
      >
        结束比赛
      </el-button>
      <el-button :disabled="!room" @click="store.requestState()">刷新</el-button>
      <el-button :disabled="!room" @click="copyCode">邀请</el-button>
      <el-button type="danger" text @click="leave">离开</el-button>
    </header>

    <el-alert
      v-if="store.error"
      class="error-bar"
      type="error"
      :title="store.error.message"
      :closable="true"
      @close="store.clearError()"
    />

    <el-alert
      v-if="reclaimableSeat && room"
      class="reclaim-bar"
      type="warning"
      :closable="false"
      show-icon
    >
      <template #title>
        你的 {{ reclaimableSeat }} 座因断线超时已被系统托管
        <el-button size="small" type="warning" @click="store.joinRoom(room.code, reclaimableSeat)">
          收回座位
        </el-button>
      </template>
    </el-alert>

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
      <!-- 房间不存在时牌桌不渲染，系统提示仍要能在聊天区看到 -->
      <OnlineChat
        v-if="chatMessages.length"
        inline
        readonly
        title="系统消息"
        :messages="chatMessages"
        @send="onChatSend"
      />
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
        <main class="app-body">
          <OnlineTable
            :room="room"
            :bidding-rules="biddingRules"
            :bidding-rules-by-side="biddingRulesBySide"
            :messages="chatMessages"
            @play="onPlay"
            @score="openScore"
            @chat-send="onChatSend"
            @toggle-auto-play="onToggleAutoPlay"
          />
        </main>
      </template>
    </template>

    <!-- 叫牌卡浮窗：与单机版同一套叫牌卡，只在轮到自己时出现 -->
    <BiddingBox
      v-if="showBiddingBox && board"
      :bidding-history="board.bidding"
      :current-bid="currentBid"
      :current-bidder="board.currentBidder"
      :can-bid="board.canAct"
      :title="bidderLabel"
      :hand="board.yourHand"
      :bidding-rules="biddingRules"
      @submit="onBid"
    />

    <BoardReplayDialog v-model:visible="replayVisible" :board="replayBoard" />

    <el-dialog
      v-model="scoreVisible"
      title="成绩与复盘"
      width="min(1080px, 96vw)"
      append-to-body
      draggable
    >
      <ScoreTable v-if="room" :room="room" @replay="openReplay" />
    </el-dialog>

  </div>
</template>

<style scoped>
.room-view {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.room-header h1 {
  white-space: nowrap;
}
.room-header .back {
  color: #9ef0bd;
  text-decoration: none;
  font-size: 14px;
  white-space: nowrap;
}
.room-header .code {
  letter-spacing: 2px;
  color: #ffe19a;
}
.room-header .status {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.room-header .status-main {
  margin-left: 5px;
}
.room-header .status-meta {
  margin-left: 9px;
  color: rgba(234, 245, 238, 0.62);
  font-size: 12px;
}
.room-header .connection {
  font-size: 12px;
  opacity: 0.8;
  white-space: nowrap;
}
.room-header .connection.closed {
  color: #ff9f92;
}
.error-bar {
  border-radius: 12px;
}
.reclaim-bar {
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
.card {
  background: var(--paper);
  border-radius: 14px;
  padding: 12px;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.22);
}
</style>
