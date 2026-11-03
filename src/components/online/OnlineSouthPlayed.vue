<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElDialog } from 'element-plus';
import type { Position, Trick } from '../../models/gameState';
import { getSide, ORDER } from '../../models/gameState';
import { cardLabel } from '../../models/card';
import type { RoomView } from '@shared/protocol';
import PlayingCard from '../PlayingCard.vue';
import ContractDisplay from '../ContractDisplay.vue';
import HandDiagram from '../HandDiagram.vue';

/**
 * 联网牌桌右下角：与单机版 `SouthPlayed.vue` 相同的已出牌堆与常用按钮。
 * 以观看者座位为“本人”展示牌堆；摊牌只展示当前视角可见的牌。
 */

const props = defineProps<{ room: RoomView; cardsVisible: boolean; yourSeat: Position }>();
const emit = defineEmits<{ (e: 'score'): void; (e: 'toggle-auto-play'): void }>();

/** 当前是否由 AI 托管自己的座位 */
const autoPlaying = computed(() => !!props.room.you.autoPlay);

const SEAT_LABEL: Record<Position, string> = { N: '北 N', E: '东 E', S: '南 S', W: '西 W' };
const COLUMNS: Position[] = ['N', 'E', 'S', 'W'];
const VUL_TEXT: Record<string, string> = {
  none: '无局',
  NS: '南北有局',
  EW: '东西有局',
  both: '双方有局',
};
const PHASE_TEXT: Record<string, string> = {
  bidding: '叫牌中',
  play_waiting_lead: '等待首攻',
  play: '打牌中',
  scored: '已结算',
};

const board = computed(() => props.room.board);

const hovering = ref(false);
const exposeVisible = ref(false);
const contractVisible = ref(false);

/* ---------------------------------------------------------------- *
 * 右下角：南家已出的牌（按出牌顺序：赢墩竖直、输墩平躺）
 * ---------------------------------------------------------------- */
interface PileItem {
  key: string;
  card: number;
  flat: boolean;
  won: boolean;
  left: number;
  width: number;
  trickNo: number;
  title: string;
}

const PILE_STEP = 13;

/** 真实座位 → 相对出牌区方位（自己在下、同伴在上） */
function trickSlotOf(pos: Position): 'N' | 'E' | 'S' | 'W' {
  const relative = (ORDER.indexOf(pos) - ORDER.indexOf(props.yourSeat) + 4) % 4;
  return (['S', 'W', 'N', 'E'] as const)[relative];
}

const pileItems = computed<PileItem[]>(() => {
  const items: PileItem[] = [];
  let x = 0;
  (board.value?.tricks ?? []).forEach((trick, index) => {
    const play = trick.plays.find((p) => p.position === props.yourSeat);
    if (!play) return;
    const won = getSide(trick.winner) === 'NS';
    const flat = !won;
    const width = flat ? 48 : 34;
    items.push({
      key: `${index}-${play.card}`,
      card: play.card,
      flat,
      won,
      left: x,
      width,
      trickNo: index + 1,
      title: `第 ${index + 1} 墩 · 你出 ${cardLabel(play.card)} · ${won ? '己方赢墩' : '对方赢墩'}`,
    });
    x += PILE_STEP;
  });
  return items;
});

const pileWidth = computed(() => {
  const last = pileItems.value[pileItems.value.length - 1];
  return last ? last.left + last.width : 34;
});

const lastTrick = computed<Trick | null>(() => {
  const tricks = board.value?.tricks ?? [];
  return tricks.length ? tricks[tricks.length - 1] : null;
});

const showLastTrick = computed(
  () => hovering.value && !!lastTrick.value && lastTrick.value.plays.length > 0,
);

/* ---------------------------------------------------------------- *
 * 摊牌 / 定约卡
 * ---------------------------------------------------------------- */
function exposedCards(pos: Position): number[] {
  const b = board.value;
  if (!b) return [];
  if (b.revealedHands) return b.revealedHands[pos] ?? [];
  if (b.yourSeat === pos && b.yourHand) return b.yourHand;
  if (
    b.yourSeat !== null &&
    b.yourSeat === b.dummySeat &&
    b.contract?.declarer === pos &&
    b.partnerHand
  ) {
    return b.partnerHand;
  }
  if (b.dummySeat === pos && b.dummyOpen && b.dummyHand) return b.dummyHand;
  return [];
}

function handKnown(pos: Position): boolean {
  const b = board.value;
  if (!b) return false;
  if (b.revealedHands) return true;
  if (b.yourSeat === pos && b.yourHand) return true;
  if (
    b.yourSeat !== null &&
    b.yourSeat === b.dummySeat &&
    b.contract?.declarer === pos &&
    b.partnerHand
  ) {
    return true;
  }
  if (b.dummySeat === pos && b.dummyOpen && b.dummyHand) return true;
  return false;
}

function roleOf(pos: Position): 'declarer' | 'dummy' | '' {
  const contract = board.value?.contract;
  if (!contract) return '';
  if (contract.declarer === pos) return 'declarer';
  if (contract.dummy === pos) return 'dummy';
  return '';
}

const contractEmptyText = computed(() =>
  board.value?.phase === 'scored' && !board.value.contract ? '流局' : '—',
);
const doubleText = computed(() => {
  const c = board.value?.contract;
  if (!c) return '—';
  return c.redoubled ? '再加倍 ×4' : c.doubled ? '加倍 ×2' : '无';
});
const vulnerabilityText = computed(
  () => VUL_TEXT[board.value?.vulnerability ?? 'none'] ?? '无局',
);
const phaseText = computed(() => PHASE_TEXT[board.value?.phase ?? ''] ?? '等待开赛');
const declarerTricksWon = computed(() => {
  const contract = board.value?.contract;
  if (!contract) return 0;
  const declSide = getSide(contract.declarer);
  return (board.value?.tricks ?? []).filter((t) => getSide(t.winner) === declSide).length;
});
</script>

<template>
  <div class="south-played" aria-label="本人已出牌与常用操作">
    <div
      v-if="cardsVisible"
      class="pile-wrap"
      @mouseenter="hovering = true"
      @mouseleave="hovering = false"
    >
      <div class="pile" :style="{ width: `${pileWidth}px` }">
        <span
          v-for="item in pileItems"
          :key="item.key"
          class="pile-card"
          :class="{ flat: item.flat }"
          :style="{ left: `${item.left}px`, zIndex: item.trickNo }"
          :title="item.title"
        >
          <span class="pile-card-inner">
            <PlayingCard back size="sm" />
          </span>
        </span>
        <span v-if="pileItems.length === 0" class="pile-empty">尚未出牌</span>
      </div>

      <!-- 悬停：回放上一墩的出牌顺序（出现动画与实际出牌一致） -->
      <transition name="last-trick-fade">
        <div v-if="showLastTrick && lastTrick" class="last-trick-pop" aria-label="上一墩出牌顺序">
          <div class="pop-heading">
            <span>上一墩 · 第 {{ board?.tricks.length ?? 0 }} 墩</span>
            <span class="pop-winner">赢家 {{ lastTrick.winner }}</span>
          </div>
          <div class="pop-board">
            <span
              v-for="(play, index) in lastTrick.plays"
              :key="`${play.position}-${play.card}`"
              class="pop-card"
              :class="[`slot-${trickSlotOf(play.position)}`, { winner: lastTrick.winner === play.position }]"
              :style="{ zIndex: index + 1 }"
            >
              <span class="pop-card-inner" :style="{ animationDelay: `${index * 0.16}s` }">
                <PlayingCard :card="play.card" size="md" label-mode="suit-first" />
                <span class="pop-order" aria-hidden="true">{{ index + 1 }}</span>
              </span>
            </span>
          </div>
        </div>
      </transition>
    </div>

    <!-- 已出牌下方的四个常用按钮，与单机版一致 -->
    <div class="pile-actions">
      <button
        type="button"
        class="action-btn auto-play-btn"
        :class="{ active: autoPlaying }"
        :aria-pressed="autoPlaying"
        :title="autoPlaying ? '取消后恢复手动叫牌与出牌' : '交给 AI 代你叫牌与出牌，座位和手牌仍保留'"
        @click="emit('toggle-auto-play')"
      >
        {{ autoPlaying ? '解除托管' : '托管' }}
      </button>
      <button type="button" class="action-btn" @click="emit('score')">计分表</button>
      <button type="button" class="action-btn" @click="exposeVisible = true">摊牌</button>
      <button type="button" class="action-btn" @click="contractVisible = true">定约卡</button>
    </div>

    <ElDialog v-model="exposeVisible" title="摊牌 · 已公开持牌" width="min(760px, 94vw)" append-to-body>
      <div class="expose-grid">
        <template v-for="pos in COLUMNS" :key="pos">
          <HandDiagram
            v-if="handKnown(pos)"
            :cards="exposedCards(pos)"
            :position="pos"
            :label="SEAT_LABEL[pos]"
            :role="roleOf(pos)"
          />
          <div v-else class="hidden-hand">
            <strong>{{ SEAT_LABEL[pos] }}</strong>
            <span>未公开</span>
          </div>
        </template>
      </div>
      <p class="expose-tip">
        联网对局只展示自己的手牌、已摊开的明手；明手视角还可看到同伴（庄家）的手牌，本副结算后公开四手牌。
      </p>
    </ElDialog>

    <ElDialog v-model="contractVisible" title="定约卡" width="360px" append-to-body>
      <div class="contract-card">
        <div class="cc-hero">
          <span class="cc-hero-label">定约</span>
          <strong class="cc-hero-value">
            <ContractDisplay :contract="board?.contract ?? null" :empty-text="contractEmptyText" />
          </strong>
        </div>
        <dl class="cc-list">
          <div class="cc-row"><dt>发牌人</dt><dd>{{ board?.dealer ?? '—' }}</dd></div>
          <div class="cc-row"><dt>局况</dt><dd>{{ vulnerabilityText }}</dd></div>
          <div v-if="board?.contract" class="cc-row">
            <dt>庄家 / 明手</dt><dd>{{ board.contract.declarer }} / {{ board.contract.dummy }}</dd>
          </div>
          <div v-if="board?.contract" class="cc-row"><dt>加倍</dt><dd>{{ doubleText }}</dd></div>
          <div v-if="board?.contract" class="cc-row">
            <dt>需赢墩</dt><dd>{{ board.contract.level + 6 }}</dd>
          </div>
          <div v-if="board?.contract" class="cc-row">
            <dt>定约方已赢墩</dt><dd>{{ declarerTricksWon }}</dd>
          </div>
          <div class="cc-row"><dt>阶段</dt><dd>{{ phaseText }}</dd></div>
        </dl>
      </div>
    </ElDialog>
  </div>
</template>

<style scoped>
.south-played {
  position: absolute;
  right: calc(var(--table-pad) + 4px);
  bottom: calc(var(--table-pad) + 4px);
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}
.pile-wrap {
  position: relative;
}
.pile {
  position: relative;
  height: 48px;
  min-width: 34px;
}
.pile-card {
  position: absolute;
  bottom: 0;
  display: block;
  width: 34px;
  height: 48px;
  line-height: 0;
  filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.32));
}
.pile-card.flat {
  width: 48px;
  height: 34px;
}
.pile-card-inner {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}
.pile-card.flat .pile-card-inner {
  transform: rotate(90deg);
}
.pile-empty {
  position: absolute;
  bottom: 12px;
  left: 0;
  white-space: nowrap;
  color: rgba(234, 245, 238, 0.5);
  font-size: 11px;
}

/* 悬停浮层：上一墩按出牌顺序出现 */
.last-trick-pop {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  z-index: 20;
  width: 244px;
  padding: 6px 8px 8px;
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 10px;
  background: rgba(3, 34, 22, 0.9);
  box-shadow: 0 12px 26px rgba(0, 0, 0, 0.4);
  pointer-events: none;
}
.pop-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 4px;
  font-size: 11px;
  color: rgba(234, 245, 238, 0.85);
  border-bottom: 1px solid rgba(255, 255, 255, 0.14);
}
.pop-winner {
  color: #2c2200;
  background: #ffe19a;
  border-radius: 999px;
  padding: 0 6px;
  font-weight: 700;
}
.pop-board {
  position: relative;
  width: 228px;
  height: 172px;
  margin-top: 6px;
}
.pop-card {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 54px;
  height: 76px;
  line-height: 0;
}
.pop-card.slot-W {
  transform: translate(calc(-50% - 40px), -50%);
}
.pop-card.slot-E {
  transform: translate(calc(-50% + 40px), -50%);
}
.pop-card.slot-N {
  transform: translate(-50%, calc(-50% - 30px));
}
.pop-card.slot-S {
  transform: translate(-50%, calc(-50% + 30px));
}
.pop-card.winner :deep(.playing-card) {
  outline: 2px solid #ffe19a;
  outline-offset: 2px;
}
.pop-card-inner {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  animation: pop-card-in 0.32s ease-out both;
}
@keyframes pop-card-in {
  from {
    opacity: 0;
    transform: scale(0.72) translateY(-12px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
.pop-order {
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
/* 与中央出牌区一致：序号放在各自外侧，避免被相邻牌遮住 */
.pop-card.slot-W .pop-order {
  bottom: -6px;
  left: -6px;
}
.pop-card.slot-E .pop-order {
  top: -6px;
  right: -6px;
}
.pop-card.slot-N .pop-order {
  top: -6px;
  right: -6px;
}
.pop-card.slot-S .pop-order {
  bottom: -6px;
  left: -6px;
}
.last-trick-fade-enter-active,
.last-trick-fade-leave-active {
  transition: opacity 0.14s ease;
}
.last-trick-fade-enter-from,
.last-trick-fade-leave-to {
  opacity: 0;
}

.pile-actions {
  display: flex;
  gap: 5px;
}
.action-btn {
  min-width: 54px;
  padding: 4px 9px;
  border: 1px solid #f0d9b5;
  border-radius: 3px;
  background: linear-gradient(180deg, #b5471f, #8f3414);
  color: #fff3df;
  font-family: inherit;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.2;
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}
.action-btn:hover {
  background: linear-gradient(180deg, #c9542a, #a03c18);
}
/* 托管中：按钮保持醒目的绿色，提示当前由 AI 代打 */
.action-btn.auto-play-btn.active {
  border-color: #b8f0c9;
  background: linear-gradient(180deg, #2f8f5b, #1f6b42);
  color: #f4fff8;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.25),
    0 2px 4px rgba(0, 0, 0, 0.3);
}

.expose-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.hidden-hand {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 110px;
  border: 1px dashed #d8dfd9;
  border-radius: 9px;
  background: #f7faf8;
  color: #8a978f;
  font-size: 12px;
}
.hidden-hand strong {
  color: #14563a;
}
.expose-tip {
  margin: 10px 0 0;
  font-size: 11px;
  color: #7b897f;
}
.contract-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.cc-hero {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: linear-gradient(160deg, #e8f5ec, #d7ecdf);
  border: 1px solid #b6dcc4;
}
.cc-hero-label {
  font-size: 12px;
  color: #6a7770;
}
.cc-hero-value {
  font-size: 24px;
  color: #14563a;
}
.cc-list {
  display: flex;
  flex-direction: column;
  margin: 0;
}
.cc-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 2px;
  border-bottom: 1px dashed #e2e8e4;
  font-size: 13px;
}
.cc-row:last-child {
  border-bottom: none;
}
.cc-row dt {
  color: #6a7770;
}
.cc-row dd {
  margin: 0;
  color: #24352b;
  font-weight: 600;
}

@media (max-width: 880px) {
  .south-played {
    display: none;
  }
}
</style>
