<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import type { CardPlay, Position } from '../../models/gameState';
import type { RoomView } from '@shared/protocol';
import { describeCall, describeContract, vulName } from '@shared/format';
import { getSuit } from '../../models/card';
import { isCardLegal } from '../../core/playing';
import { PLAY_DISPLAY_MS } from '../../store/game';
import Hand from '../Hand.vue';
import BidHistory from '../BidHistory.vue';
import ContractDisplay from '../ContractDisplay.vue';
import PlayingCard from '../PlayingCard.vue';
import OnlineSouthPlayed from './OnlineSouthPlayed.vue';

/**
 * 联网牌桌。
 *
 * 布局与单机版 `components/Table.vue` 保持一致：
 * - 四家固定方位、单行全尺寸手牌、轮到出牌时的手牌箭头；
 * - 中央叫牌纸 / 出牌叠放区、左上角牌局信息、出牌阶段右侧叫牌过程；
 * - 右下角已出牌堆与常用操作按钮。
 * 数据全部来自服务端 `RoomView` 快照，不在客户端推导隐藏信息。
 */

const props = defineProps<{ room: RoomView }>();
const emit = defineEmits<{
  (e: 'play', card: number): void;
  (e: 'score'): void;
  (e: 'chat'): void;
}>();

const SEAT_CN: Record<Position, string> = { N: '北', E: '东', S: '南', W: '西' };
const VUL_TEXT: Record<string, string> = {
  none: '无局',
  NS: '南北有局',
  EW: '东西有局',
  both: '双方有局',
};

const board = computed(() => props.room.board);
const isBidding = computed(() => board.value?.phase === 'bidding');
const isPlaying = computed(
  () => board.value?.phase === 'play' || board.value?.phase === 'play_waiting_lead',
);

function occupantName(pos: Position): string {
  const seat = props.room.seats[pos];
  if (seat.kind === 'human') return seat.name;
  if (seat.kind === 'bot') return seat.persona.name;
  return '空位';
}

function occupantTag(pos: Position): string {
  if (board.value?.yourSeat === pos) return '（你）';
  const seat = props.room.seats[pos];
  if (seat.kind === 'human') return '（真人）';
  if (seat.kind === 'bot') return '（AI）';
  return '';
}

function seatLabel(pos: Position): string {
  return `${SEAT_CN[pos]}${pos}_${occupantName(pos)}`;
}

/** 当前行动座位：叫牌看 currentBidder，出牌看 nextPlayer */
function isActive(pos: Position): boolean {
  const b = board.value;
  if (!b) return false;
  if (b.phase === 'bidding') return b.currentBidder === pos;
  if (b.phase === 'play' || b.phase === 'play_waiting_lead') return b.nextPlayer === pos;
  return false;
}

/** 轮到该座位出牌时显示指向手牌的闪烁箭头（机器人与真人一视同仁） */
function showTurnArrow(pos: Position): boolean {
  return isPlaying.value && board.value?.nextPlayer === pos;
}

function isDummySeat(pos: Position): boolean {
  return board.value?.dummySeat === pos;
}

/** 该座位当前可见的牌：自己 / 明手（已摊牌）；结算后不在桌面展示暗牌 */
function visibleCards(pos: Position): number[] | null {
  const b = board.value;
  if (!b || b.phase === 'scored') return null;
  if (b.yourSeat === pos && b.yourHand) return b.yourHand;
  if (b.dummySeat === pos && b.dummyOpen && b.dummyHand) return b.dummyHand;
  return null;
}

/** 暗手牌背数量 = 13 - 已出牌数 */
function hiddenCount(pos: Position): number {
  const b = board.value;
  if (!b) return 13;
  const played =
    b.tricks.reduce((sum, trick) => sum + trick.plays.filter((p) => p.position === pos).length, 0) +
    b.currentTrick.filter((p) => p.position === pos).length;
  return Math.max(0, 13 - played);
}

function faceDownCards(pos: Position): number[] {
  return Array.from({ length: hiddenCount(pos) }, () => 0);
}

/** 该座位当前是否可点击（自己的手牌，且轮到自己 / 明手由自己代打） */
function isClickable(pos: Position): boolean {
  const b = board.value;
  if (!b || !b.canAct) return false;
  if (b.phase !== 'play' && b.phase !== 'play_waiting_lead') return false;
  return b.actingForSeat === pos;
}

/** 当前墩的领出花色；本轮为空时返回 null（首攻 / 领出） */
function currentLeadSuit() {
  const b = board.value;
  return b && b.currentTrick.length ? getSuit(b.currentTrick[0].card) : null;
}

/** 该牌是否允许在本轮打出（必须跟出领出花色） */
function isCardPlayable(pos: Position, card: number): boolean {
  const cards = visibleCards(pos);
  if (!cards) return false;
  return isCardLegal(card, cards, currentLeadSuit());
}

/** 左键选中的牌（再次点击取消）；轮到下一手或新一局时自动清空 */
const selectedCard = ref<number | null>(null);

watch(
  [
    () => board.value?.nextPlayer,
    () => board.value?.phase,
    () => board.value?.index,
    () => board.value?.canAct,
    () => board.value?.actingForSeat,
  ],
  () => {
    selectedCard.value = null;
  },
);

function onCardClick(pos: Position, card: number): void {
  if (!isClickable(pos) || board.value?.actingForSeat !== pos) return;
  if (!isCardPlayable(pos, card)) return;
  selectedCard.value = selectedCard.value === card ? null : card;
}

/** 右键确认：仅当该牌已用左键选中时才真正出牌 */
function onCardConfirm(pos: Position, card: number): void {
  if (!isClickable(pos) || board.value?.actingForSeat !== pos) return;
  if (!isCardPlayable(pos, card)) return;
  if (selectedCard.value !== card) {
    selectedCard.value = card;
    return;
  }
  selectedCard.value = null;
  emit('play', card);
}

/** 双击卡牌：跳过“先选中再右键”的步骤，直接出牌 */
function onCardDoubleClick(pos: Position, card: number): void {
  if (!isClickable(pos) || board.value?.actingForSeat !== pos) return;
  if (!isCardPlayable(pos, card)) return;
  selectedCard.value = null;
  emit('play', card);
}

/* ---------------------------------------------------------------- *
 * 中央出牌区：第四家出牌后完整一墩停留 1 秒再清空
 * ---------------------------------------------------------------- */
const completedTrickVisible = ref(false);
let trickTimer: ReturnType<typeof setTimeout> | null = null;

function clearTrickTimer(): void {
  if (trickTimer !== null) {
    clearTimeout(trickTimer);
    trickTimer = null;
  }
}

watch(
  () => board.value?.tricks.length ?? 0,
  (count, previous) => {
    clearTrickTimer();
    if (count > (previous ?? 0)) {
      completedTrickVisible.value = true;
      trickTimer = setTimeout(() => {
        completedTrickVisible.value = false;
        trickTimer = null;
      }, PLAY_DISPLAY_MS);
    } else {
      completedTrickVisible.value = false;
    }
  },
);

watch(
  () => board.value?.currentTrick.length ?? 0,
  (length) => {
    if (length > 0) {
      clearTrickTimer();
      completedTrickVisible.value = false;
    }
  },
);

const lastTrick = computed(() => {
  const tricks = board.value?.tricks ?? [];
  return tricks.length ? tricks[tricks.length - 1] : null;
});

const boardTrick = computed<{ plays: CardPlay[]; winner: Position | null }>(() => {
  const b = board.value;
  if (!b) return { plays: [], winner: null };
  if (b.currentTrick.length > 0) return { plays: b.currentTrick, winner: null };
  if (completedTrickVisible.value && lastTrick.value) {
    return { plays: lastTrick.value.plays, winner: lastTrick.value.winner };
  }
  return { plays: [], winner: null };
});

/** 一局结束后桌面的牌只再显示 1 秒 */
const cardsVisible = ref(true);
let scoreTimer: ReturnType<typeof setTimeout> | null = null;

function clearScoreTimer(): void {
  if (scoreTimer !== null) {
    clearTimeout(scoreTimer);
    scoreTimer = null;
  }
}

watch(
  () => board.value?.phase,
  (phase) => {
    clearScoreTimer();
    cardsVisible.value = true;
    if (phase === 'scored') {
      scoreTimer = setTimeout(() => {
        cardsVisible.value = false;
        scoreTimer = null;
      }, PLAY_DISPLAY_MS);
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  clearTrickTimer();
  clearScoreTimer();
});

/* ---------------------------------------------------------------- *
 * 左上角牌局信息 / 最近一次叫牌提醒
 * ---------------------------------------------------------------- */
const contractEmptyText = computed(() =>
  board.value?.phase === 'scored' && !board.value.contract ? '流局' : '—',
);
const vulnerabilityText = computed(
  () => VUL_TEXT[board.value?.vulnerability ?? 'none'] ?? vulName(board.value?.vulnerability ?? 'none'),
);
const tricksBySide = computed(() => {
  const counts = { NS: 0, EW: 0 };
  for (const trick of board.value?.tricks ?? []) {
    if (trick.winner === 'N' || trick.winner === 'S') counts.NS += 1;
    else counts.EW += 1;
  }
  return counts;
});

const showPlayBidHistory = computed(
  () => isPlaying.value && (board.value?.bidding.length ?? 0) > 0,
);

/** 最近一条带约定提醒的叫牌，用于在牌桌上直接解释含义 */
const latestAlert = computed(() => {
  const bidding = board.value?.bidding ?? [];
  for (let i = bidding.length - 1; i >= 0; i -= 1) {
    const record = bidding[i];
    if (!record.alerted) continue;
    return {
      position: record.position,
      call: describeCall(record.call),
      text: record.alertText?.trim() || '约定叫',
    };
  }
  return null;
});

const contractText = computed(() => describeContract(board.value?.contract ?? null));
</script>

<template>
  <div class="table online-table">
    <!-- 北家 -->
    <div class="seat north" :class="{ active: isActive('N') }">
      <div class="seat-profile">
        <span class="seat-name">{{ seatLabel('N') }}</span>
        <span v-if="occupantTag('N')" class="seat-tag">{{ occupantTag('N') }}</span>
        <span v-if="isDummySeat('N')" class="dummy-tag">明手</span>
      </div>
      <Hand
        v-if="visibleCards('N')"
        :cards="visibleCards('N')!"
        position="N"
        :is-dummy="isDummySeat('N')"
        :clickable="isClickable('N')"
        :active="isActive('N')"
        :show-turn-arrow="showTurnArrow('N')"
        :selected-card="selectedCard"
        @card-click="(c) => onCardClick('N', c)"
        @card-confirm="(c) => onCardConfirm('N', c)"
        @card-dblclick="(c) => onCardDoubleClick('N', c)"
      />
      <Hand v-else :cards="faceDownCards('N')" position="N" face-down :show-turn-arrow="showTurnArrow('N')" />
    </div>

    <!-- 左上角牌局信息：副序、局况、定约、赢墩数 -->
    <div v-if="board" class="play-info-panel" aria-label="牌局信息">
      <div class="info-row">
        <span class="info-label">副序</span>
        <span class="info-value">{{ board.index }}</span>
      </div>
      <div class="info-row">
        <span class="info-label">局况</span>
        <span class="info-value">{{ vulnerabilityText }}</span>
      </div>
      <div class="info-row">
        <span class="info-label">定约</span>
        <span class="info-value" :title="contractText">
          <ContractDisplay :contract="board.contract" :empty-text="contractEmptyText" />
        </span>
      </div>
      <div class="info-row">
        <span class="info-label">赢墩数</span>
        <span class="info-value" title="南北 / 东西">
          {{ tricksBySide.NS }} / {{ tricksBySide.EW }}
        </span>
      </div>
    </div>

    <!-- 出牌时叫牌过程停靠在北家手牌右侧，与左侧信息栏对称 -->
    <aside v-if="showPlayBidHistory" class="play-bid-history" aria-label="叫牌过程">
      <BidHistory
        variant="table"
        :bidding-history="board?.bidding ?? []"
        :phase="board?.phase ?? 'play'"
        :current-bidder="board?.currentBidder ?? null"
      />
      <div v-if="latestAlert" class="bid-alert-note" :title="latestAlert.text">
        <span class="alert-tag">提醒</span>
        <span>{{ latestAlert.position }} {{ latestAlert.call }}：{{ latestAlert.text }}</span>
      </div>
    </aside>

    <!-- 西家 -->
    <div class="seat west" :class="{ active: isActive('W') }">
      <div class="seat-profile">
        <span class="seat-name">{{ seatLabel('W') }}</span>
        <span v-if="occupantTag('W')" class="seat-tag">{{ occupantTag('W') }}</span>
        <span v-if="isDummySeat('W')" class="dummy-tag">明手</span>
      </div>
      <Hand
        v-if="visibleCards('W')"
        :cards="visibleCards('W')!"
        position="W"
        :is-dummy="isDummySeat('W')"
        :clickable="isClickable('W')"
        :active="isActive('W')"
        :show-turn-arrow="showTurnArrow('W')"
        :selected-card="selectedCard"
        @card-click="(c) => onCardClick('W', c)"
        @card-confirm="(c) => onCardConfirm('W', c)"
        @card-dblclick="(c) => onCardDoubleClick('W', c)"
      />
      <Hand v-else :cards="faceDownCards('W')" position="W" face-down :show-turn-arrow="showTurnArrow('W')" />
    </div>

    <!-- 中央：叫牌时显示叫牌过程，打牌时按出牌次序叠放本墩牌面 -->
    <div class="center">
      <BidHistory
        v-if="isBidding"
        class="center-bid-history"
        variant="table"
        :bidding-history="board?.bidding ?? []"
        :phase="board?.phase ?? 'bidding'"
        :current-bidder="board?.currentBidder ?? null"
      />

      <div v-else-if="board && cardsVisible" class="trick-board">
        <div v-if="boardTrick.plays.length" class="trick-stack">
          <div
            v-for="(play, index) in boardTrick.plays"
            :key="`${play.position}-${play.card}`"
            class="trick-play"
            :class="[`slot-${play.position}`, { winner: boardTrick.winner === play.position }]"
            :style="{ zIndex: index + 1 }"
          >
            <PlayingCard :card="play.card" size="xxl" label-mode="suit-first" />
            <span class="play-order" aria-hidden="true">{{ index + 1 }}</span>
          </div>
        </div>
      </div>

      <div v-if="isBidding && latestAlert" class="bid-alert-note center-alert" :title="latestAlert.text">
        <span class="alert-tag">提醒</span>
        <span>{{ latestAlert.position }} {{ latestAlert.call }}：{{ latestAlert.text }}</span>
      </div>
    </div>

    <!-- 南家已出牌（右下角）+ 计分表 / 摊牌 / 定约卡 / 聊天 -->
    <OnlineSouthPlayed
      :room="room"
      :cards-visible="cardsVisible"
      @score="emit('score')"
      @chat="emit('chat')"
    />

    <!-- 东家 -->
    <div class="seat east" :class="{ active: isActive('E') }">
      <div class="seat-profile">
        <span class="seat-name">{{ seatLabel('E') }}</span>
        <span v-if="occupantTag('E')" class="seat-tag">{{ occupantTag('E') }}</span>
        <span v-if="isDummySeat('E')" class="dummy-tag">明手</span>
      </div>
      <Hand
        v-if="visibleCards('E')"
        :cards="visibleCards('E')!"
        position="E"
        :is-dummy="isDummySeat('E')"
        :clickable="isClickable('E')"
        :active="isActive('E')"
        :show-turn-arrow="showTurnArrow('E')"
        :selected-card="selectedCard"
        @card-click="(c) => onCardClick('E', c)"
        @card-confirm="(c) => onCardConfirm('E', c)"
        @card-dblclick="(c) => onCardDoubleClick('E', c)"
      />
      <Hand v-else :cards="faceDownCards('E')" position="E" face-down :show-turn-arrow="showTurnArrow('E')" />
    </div>

    <!-- 南家 -->
    <div class="seat south" :class="{ active: isActive('S') }">
      <Hand
        v-if="visibleCards('S')"
        :cards="visibleCards('S')!"
        position="S"
        :is-dummy="isDummySeat('S')"
        :clickable="isClickable('S')"
        :active="isActive('S')"
        :show-turn-arrow="showTurnArrow('S')"
        :selected-card="selectedCard"
        @card-click="(c) => onCardClick('S', c)"
        @card-confirm="(c) => onCardConfirm('S', c)"
        @card-dblclick="(c) => onCardDoubleClick('S', c)"
      />
      <Hand v-else :cards="faceDownCards('S')" position="S" face-down :show-turn-arrow="showTurnArrow('S')" />
      <div class="seat-profile">
        <span class="seat-name">{{ seatLabel('S') }}</span>
        <span v-if="occupantTag('S')" class="seat-tag">{{ occupantTag('S') }}</span>
        <span v-if="isDummySeat('S')" class="dummy-tag">明手</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.table {
  --table-pad: 14px;
  position: relative;
  display: grid;
  grid-template-areas:
    'north north north'
    'west center east'
    'south south south';
  grid-template-columns: minmax(0, 1fr) clamp(320px, 26vw, 360px) minmax(0, 1fr);
  grid-template-rows: auto minmax(280px, 1fr) auto;
  gap: 8px 12px;
  min-height: clamp(620px, calc(100vh - 140px), 920px);
  overflow: hidden;
  background:
    radial-gradient(ellipse at 50% 42%, rgba(72, 167, 112, 0.36), transparent 58%),
    radial-gradient(circle at 50% 12%, #2d8a5d 0%, #1d6d49 42%, #12482f 100%);
  border-radius: 22px;
  padding: var(--table-pad);
  border: 3px solid #0b2f21;
  box-shadow:
    inset 0 0 0 2px rgba(255, 235, 180, 0.12),
    inset 0 0 90px rgba(0, 0, 0, 0.38),
    0 18px 40px rgba(0, 0, 0, 0.36);
}
.table::before {
  content: '';
  position: absolute;
  inset: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 50% / 42%;
  pointer-events: none;
}
.seat,
.center {
  position: relative;
  z-index: 1;
}
/* 轮到出牌的座位略高于中央出牌区，保证指向手牌的箭头不被牌面遮住 */
.seat.active {
  z-index: 2;
}
.north {
  grid-area: north;
  justify-self: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.south {
  grid-area: south;
  justify-self: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.west {
  grid-area: west;
  align-self: center;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
.east {
  grid-area: east;
  align-self: center;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}
.seat-profile {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 2px;
  color: #eaf5ee;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1.2;
  white-space: nowrap;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
}
.seat-name {
  color: inherit;
}
.seat-tag {
  opacity: 0.8;
  font-weight: 600;
}
.dummy-tag {
  background: #d9a300;
  color: #2c2200;
  border-radius: 3px;
  padding: 0 4px;
  font-size: 9px;
  font-weight: 700;
  text-shadow: none;
}
.seat.active .seat-profile {
  color: #ffe19a;
  text-shadow:
    0 0 10px rgba(255, 214, 102, 0.7),
    0 1px 3px rgba(0, 0, 0, 0.85);
}
.center {
  grid-area: center;
  justify-self: center;
  align-self: center;
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  max-width: 360px;
  min-height: 0;
}
/* 左右两块信息与北家手牌上沿平齐：左侧牌局信息，右侧叫牌过程 */
.play-info-panel,
.play-bid-history {
  position: absolute;
  top: calc(var(--table-pad) + 18px);
  z-index: 2;
  box-sizing: border-box;
  width: clamp(200px, 22%, 300px);
}
.play-info-panel {
  left: var(--table-pad);
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 9px 12px;
  border-radius: 4px;
  border: 1px solid rgba(80, 66, 26, 0.55);
  background: linear-gradient(180deg, rgba(255, 252, 232, 0.97), rgba(242, 232, 196, 0.96));
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.28);
  color: #2f2a1a;
  font-size: 13px;
  line-height: 1.8;
}
.info-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}
.info-label {
  flex: none;
  color: #6b5e33;
  font-weight: 600;
}
.info-label::after {
  content: '：';
}
.info-value {
  min-width: 0;
  overflow: hidden;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.play-bid-history {
  right: var(--table-pad);
  max-height: 250px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.play-bid-history :deep(.variant-table) {
  gap: 4px;
  padding: 0;
  border-radius: 0;
}
.play-bid-history :deep(.bid-header span) {
  padding: 4px 0;
  font-size: 13px;
}
.play-bid-history :deep(.bid-cell) {
  min-height: 24px;
  padding: 2px 0;
}
.play-bid-history :deep(.bid-level) {
  font-size: 15px;
}
.play-bid-history :deep(.bid-suit) {
  font-size: 20px;
}
.play-bid-history :deep(.bid-suit.nt) {
  font-size: 11px;
}
.play-bid-history :deep(.bid-label) {
  font-size: 12px;
}
.play-bid-history :deep(.bid-scroll) {
  --bid-scroll-max: 168px;
  min-height: 168px;
}
/* 叫牌过程按内容高度展示，不随中央区域一起拉高 */
.center-bid-history {
  flex: 0 1 auto;
  min-height: 0;
  max-height: 230px;
  overflow: hidden;
  --bid-scroll-max: 172px;
}
/* 中央叫牌纸采用参考界面的分色表头与较大字号，同时保持紧凑 */
.center-bid-history :deep(.variant-table) {
  gap: 6px;
  padding: 0;
  border-radius: 0;
}
.center-bid-history :deep(.bid-scroll) {
  /* 固定显示 6 轮叫牌，和参考界面的表格高度一致 */
  min-height: 172px;
}
.center-bid-history :deep(.bid-header span) {
  padding: 5px 0;
  font-size: 15px;
}
.center-bid-history :deep(.bid-cell) {
  min-height: 24px;
  padding: 2px 0;
}
.center-bid-history :deep(.bid-level) {
  font-size: 16px;
}
.center-bid-history :deep(.bid-suit) {
  font-size: 20px;
}
.center-bid-history :deep(.bid-suit.nt) {
  font-size: 12px;
}
.center-bid-history :deep(.bid-label) {
  font-size: 13px;
}
/* 最近一次约定叫的解释：牌桌中央 / 右侧叫牌过程各显示一份 */
.bid-alert-note {
  display: flex;
  align-items: flex-start;
  gap: 5px;
  padding: 4px 7px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.94);
  color: #33270a;
  font-size: 11px;
  line-height: 1.45;
  text-align: left;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
}
.center-alert {
  margin-top: 2px;
}
.alert-tag {
  flex: none;
  padding: 0 4px;
  border-radius: 3px;
  background: #ffe19a;
  color: #2c2200;
  font-size: 10px;
  font-weight: 800;
  line-height: 1.5;
}
.trick-board {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 252px;
  padding: 8px 0;
}
/* 四家牌保持固定方位，按出牌次序决定叠放层次并标出序号 */
.trick-stack {
  position: relative;
  flex: none;
  width: 240px;
  height: 244px;
}
.trick-play {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 96px;
  height: 134px;
  line-height: 0;
  transform: translate(-50%, -50%);
}
/* 西左、东右，同一水平线；北在上、南在下，同一垂直线 */
.trick-play.slot-W {
  transform: translate(calc(-50% - 64px), -50%);
}
.trick-play.slot-E {
  transform: translate(calc(-50% + 64px), -50%);
}
.trick-play.slot-N {
  transform: translate(-50%, calc(-50% - 48px));
}
.trick-play.slot-S {
  transform: translate(-50%, calc(-50% + 48px));
}
.trick-play.winner :deep(.playing-card) {
  outline: 2px solid #ffe19a;
  outline-offset: 2px;
}
.play-order {
  position: absolute;
  z-index: 2;
  min-width: 15px;
  height: 15px;
  padding: 0 3px;
  border-radius: 999px;
  background: #ffe19a;
  color: #2c2200;
  font-size: 10px;
  font-weight: 800;
  line-height: 15px;
  text-align: center;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
}
/* 序号放在各自外侧且避开牌名所在的角 */
.slot-W .play-order {
  bottom: -6px;
  left: -6px;
}
.slot-E .play-order {
  top: -6px;
  right: -6px;
}
.slot-N .play-order {
  top: -6px;
  right: -6px;
}
.slot-S .play-order {
  bottom: -6px;
  left: -6px;
}
@media (max-width: 900px) {
  .table {
    --table-pad: 10px;
    grid-template-columns: minmax(0, 1fr) 320px minmax(0, 1fr);
    grid-template-rows: auto minmax(280px, 1fr) auto;
    min-height: 600px;
    padding: var(--table-pad);
    gap: 6px;
  }
  .trick-board {
    min-height: 252px;
  }
  .center {
    max-width: 320px;
  }
  .center-bid-history {
    max-height: 210px;
    --bid-scroll-max: 172px;
  }
}
@media (max-width: 880px) {
  .table {
    grid-template-areas:
      'north'
      'west'
      'center'
      'east'
      'south';
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto;
    min-height: 0;
    border-radius: 16px;
  }
  .west,
  .east {
    align-self: auto;
    align-items: center;
  }
  .center {
    width: min(100%, 340px);
    max-width: 340px;
  }
  .play-info-panel,
  .play-bid-history {
    display: none;
  }
}
</style>
