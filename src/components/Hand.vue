<script setup lang="ts">
import { computed, ref } from 'vue';
import { cardLabel, getSuit, type SuitIndex } from '../models/card';
import { sortHand } from '../models/hand';
import type { Position } from '../models/gameState';
import PlayingCard from './PlayingCard.vue';
import TurnArrow from './TurnArrow.vue';
import HintVeil from './HintVeil.vue';

type DisplaySlot = 'north' | 'south' | 'west' | 'east';

const props = defineProps<{
  cards: number[];
  position: Position;
  /** 相对视角下的显示位置；缺省时与真实座位一致（单机版） */
  displaySlot?: DisplaySlot;
  /** 是否可点击（由父组件依据 controllableSeats 计算） */
  clickable?: boolean;
  /** 显示牌背（暗手） */
  faceDown?: boolean;
  /** 是否为明手区 */
  isDummy?: boolean;
  /** 高亮当前行动（叫牌或出牌轮到该座位） */
  active?: boolean;
  /** 当前被左键选中的牌（再次点击取消选择） */
  selectedCard?: number | null;
  /** 是否显示指向该手牌的“轮到你出牌”闪烁箭头 */
  showTurnArrow?: boolean;
  /** 系统推荐打出的牌（仅在该手牌内显示金色箭头） */
  recommendedCard?: number | null;
}>();

const emit = defineEmits<{
  (e: 'card-click', card: number): void;
  (e: 'card-confirm', card: number): void;
  (e: 'card-dblclick', card: number): void;
}>();

/** 展示顺序：♠ > ♥ > ♣ > ♦（方块与红桃颜色接近，隔开更易区分） */
const SUIT_ROWS: SuitIndex[] = [3, 2, 0, 1];

const rows = computed(() =>
  SUIT_ROWS.map((suit) => ({
    suit,
    cards: sortHand(props.cards).filter((card) => getSuit(card) === suit),
  })),
);

/** 按 ♠ ♥ ♣ ♦ 分组，缺门不占位 */
const groups = computed(() => rows.value.filter((row) => row.cards.length > 0));

/** 提示箭头按显示方位指向手牌，而不是按真实座位 */
const arrowPosition = computed<Position>(() => {
  if (!props.displaySlot) return props.position;
  return ({ north: 'N', south: 'S', west: 'W', east: 'E' } as const)[props.displaySlot];
});

const hoverText = ref<string | null>(null);

function hoverCard(card: number): void {
  if (props.faceDown) return;
  if (props.recommendedCard === card) {
    hoverText.value = `推荐出牌：${cardLabel(card)}（系统建议，仅辅助）`;
  } else if (props.clickable) {
    hoverText.value = `${cardLabel(card)} · 左键选中，右键或双击出牌`;
  } else if (props.isDummy) {
    hoverText.value = `${cardLabel(card)}（明手牌）`;
  } else {
    hoverText.value = null;
  }
}

function clearHint(): void {
  hoverText.value = null;
}
</script>

<template>
  <div class="hand" :class="[{ 'is-dummy': isDummy, active }, `pos-${position}`]">
    <TurnArrow v-if="showTurnArrow && recommendedCard == null" :position="arrowPosition" />
    <div class="hand-inner">
      <div v-if="faceDown" class="cards backs">
        <PlayingCard v-for="i in cards.length" :key="i" back size="xxl" />
      </div>

      <div
        v-else
        class="suits single-row"
        :class="{ clickable, 'no-events': !clickable }"
      >
        <div class="hand-row">
          <span v-for="group in groups" :key="group.suit" class="suit-group">
            <span
              v-for="card in group.cards"
              :key="card"
              class="card-slot"
              @mouseenter="hoverCard(card)"
              @mouseleave="clearHint"
            >
              <span
                v-if="recommendedCard === card"
                class="play-hint-arrow"
                role="img"
                aria-label="推荐出牌"
              >▼</span>
              <PlayingCard
                :card="card"
                size="xxl"
                :clickable="clickable"
                :active="active && clickable"
                :selected="selectedCard === card"
                @click="emit('card-click', card)"
                @dblclick="emit('card-dblclick', card)"
                @contextmenu.prevent="emit('card-confirm', card)"
              />
            </span>
          </span>
        </div>
      </div>
    </div>

    <HintVeil :text="hoverText" />
  </div>
</template>

<style scoped>
.hand {
  /* 四家使用完全相同的牌面尺寸与叠放间距 */
  --card-overlap: -66px;
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: center;
  min-width: 0;
  max-width: 100%;
}
.hand-inner {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.suits {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.hand-row {
  display: flex;
  align-items: flex-end;
  min-height: 134px;
  padding-left: 2px;
  max-width: 100%;
}
.suit-group {
  display: flex;
  align-items: flex-end;
  flex: none;
}
/* 每张牌一个定位槽：推荐箭头可以精确指向某一张牌，且不改变牌的原始位置 */
.card-slot {
  position: relative;
  display: flex;
  flex: none;
  align-items: flex-end;
}
/* 同花色与跨花色均使用完全相同的叠放距离 */
.suit-group + .suit-group,
.suit-group .card-slot + .card-slot {
  margin-left: var(--card-overlap);
}
/* 推荐出牌：牌张留在原位，只有闪烁箭头指向它 */
.play-hint-arrow {
  position: absolute;
  top: 1px;
  left: 50%;
  z-index: 30;
  color: #ff9d1f;
  font-size: 22px;
  font-weight: 900;
  line-height: 1;
  text-shadow:
    0 1px 0 #fff,
    0 0 7px rgba(255, 145, 15, 0.95);
  transform: translateX(-50%);
  animation: play-hint-blink 0.8s step-end infinite;
  pointer-events: none;
}
@keyframes play-hint-blink {
  0%,
  49.9% {
    color: #ff9d1f;
    opacity: 1;
  }
  50%,
  100% {
    color: #ffffff;
    opacity: 0.72;
  }
}
.suits.no-events {
  pointer-events: none;
  opacity: 0.88;
}

/* 暗手：横向叠放牌背 */
.cards.backs {
  display: flex;
  align-items: center;
  min-height: 134px;
  padding-left: 2px;
}
.cards.backs .playing-card + .playing-card {
  margin-left: var(--card-overlap);
}

/* 全宽牌桌下，窄屏时逐步收紧叠放，仍保持四家一致 */
@media (max-width: 1350px) {
  .hand {
    --card-overlap: -67px;
  }
}
@media (max-width: 1280px) {
  .hand {
    --card-overlap: -70px;
  }
}
@media (max-width: 1200px) {
  .hand {
    --card-overlap: -72px;
  }
}
@media (max-width: 1150px) {
  .hand {
    --card-overlap: -74px;
  }
}
@media (max-width: 1100px) {
  .hand {
    --card-overlap: -77px;
  }
}
@media (max-width: 1000px) {
  .hand {
    --card-overlap: -80px;
  }
}
@media (max-width: 960px) {
  .hand {
    --card-overlap: -82px;
  }
}
/* 单列布局后拥有整行宽度，恢复舒展牌距 */
@media (max-width: 880px) {
  .hand {
    --card-overlap: -60px;
  }
}
@media (max-width: 600px) {
  .hand {
    --card-overlap: -70px;
  }
}
@media (max-width: 480px) {
  .hand {
    --card-overlap: -76px;
  }
}
@media (max-width: 400px) {
  .hand {
    --card-overlap: -82px;
  }
}

/* 主动高亮可点击的手牌 */
.active .suits.clickable :deep(.playing-card) {
  outline: 1px solid rgba(255, 214, 102, 0.65);
}
</style>
