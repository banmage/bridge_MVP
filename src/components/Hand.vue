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
    return;
  }
  /* 有推荐时提示层只服务于推荐牌：移到其他牌上立即隐藏，避免看起来像推荐提示没有消失 */
  if (props.recommendedCard != null) {
    hoverText.value = null;
    return;
  }
  if (props.clickable) {
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
  <div
    class="hand"
    :class="[{ 'is-dummy': isDummy, active }, `pos-${position}`]"
    @mouseleave="clearHint"
  >
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
              <TurnArrow
                v-if="recommendedCard === card"
                variant="card"
                :position="arrowPosition"
                label="推荐出牌"
              />
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
  /* 四家使用完全相同的牌面尺寸与叠放间距。
     牌面尺寸随窗口宽度分级放大，叠放步进同步调整，
     保证 13 张牌始终能放进左右两侧的列宽而不压到中央区域。 */
  --hand-card-w: 108px;
  --hand-card-h: 150px;
  --hand-card-step: 32px;
  --hand-card-radius: 11px;
  --hand-label-size: 27px;
  --hand-corner-size: 21px;
  --hand-pip-size: 24px;
  --hand-court-size: 60px;
  --hand-back-spade-size: 40px;
  --card-overlap: calc(var(--hand-card-step) - var(--hand-card-w));
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: center;
  min-width: 0;
  max-width: 100%;
}
/* 手牌专用放大：中央出牌区仍使用 PlayingCard 自身的 xxl 尺寸 */
.hand :deep(.size-xxl) {
  --pc-label-size: var(--hand-label-size);
  --pc-corner-size: var(--hand-corner-size);
  --pc-pip-size: var(--hand-pip-size);
  --pc-court-size: var(--hand-court-size);
  --pc-back-spade-size: var(--hand-back-spade-size);
  width: var(--hand-card-w);
  height: var(--hand-card-h);
  border-radius: var(--hand-card-radius);
}
/* 叠牌时只露出左侧一条，角标尽量贴近边缘以放大可用字号 */
.hand :deep(.pc-label:not(.pc-label-bottom)) {
  top: 3px;
  left: 3px;
}
.hand :deep(.pc-corner-suit:not(.pc-corner-suit-bottom)) {
  top: calc(3px + var(--pc-label-size) + 1px);
  left: 3px;
}
.hand :deep(.pc-label-bottom) {
  right: 3px;
  bottom: 3px;
}
.hand :deep(.pc-corner-suit-bottom) {
  right: 3px;
  bottom: calc(3px + var(--pc-label-size) + 1px);
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
  min-height: var(--hand-card-h);
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
  /* 叠放后真正露出的牌宽（最后一张牌会覆盖为完整牌宽） */
  --card-visible-width: calc(100% + var(--card-overlap));
}
/* 最后一张牌右侧没有其他牌遮挡，箭头对准完整牌面中心 */
.suit-group:last-child .card-slot:last-child {
  --card-visible-width: 100%;
}
/* 同花色与跨花色均使用完全相同的叠放距离 */
.suit-group + .suit-group,
.suit-group .card-slot + .card-slot {
  margin-left: var(--card-overlap);
}
/* 推荐出牌的箭头由 TurnArrow 渲染在 .card-slot 内，牌张本身保持原位 */
.card-slot :deep(.turn-arrow) {
  z-index: 30;
}
.suits.no-events {
  pointer-events: none;
  opacity: 0.88;
}

/* 暗手：横向叠放牌背 */
.cards.backs {
  display: flex;
  align-items: center;
  min-height: var(--hand-card-h);
  padding-left: 2px;
}
.cards.backs .playing-card + .playing-card {
  margin-left: var(--card-overlap);
}

/* 宽屏继续放大牌面：左右两侧列宽增加后，把空间全部留给手牌 */
@media (min-width: 1600px) {
  .hand {
    --hand-card-w: 116px;
    --hand-card-h: 162px;
    --hand-card-step: 35px;
    --hand-card-radius: 12px;
    --hand-label-size: 29px;
    --hand-corner-size: 23px;
    --hand-pip-size: 26px;
    --hand-court-size: 64px;
    --hand-back-spade-size: 43px;
  }
}
@media (min-width: 1800px) {
  .hand {
    --hand-card-w: 128px;
    --hand-card-h: 178px;
    --hand-card-step: 41px;
    --hand-card-radius: 13px;
    --hand-label-size: 32px;
    --hand-corner-size: 25px;
    --hand-pip-size: 28px;
    --hand-court-size: 70px;
    --hand-back-spade-size: 47px;
  }
}
@media (min-width: 1900px) {
  .hand {
    --hand-card-w: 136px;
    --hand-card-h: 190px;
    --hand-card-step: 46px;
    --hand-card-radius: 14px;
    --hand-label-size: 34px;
    --hand-corner-size: 26px;
    --hand-pip-size: 30px;
    --hand-court-size: 74px;
    --hand-back-spade-size: 50px;
  }
}
@media (min-width: 2100px) {
  .hand {
    --hand-card-w: 148px;
    --hand-card-h: 206px;
    --hand-card-step: 52px;
    --hand-card-radius: 15px;
    --hand-label-size: 37px;
    --hand-corner-size: 28px;
    --hand-pip-size: 33px;
    --hand-court-size: 81px;
    --hand-back-spade-size: 54px;
  }
}
/* 全宽牌桌下，窄屏时逐步收紧叠放，仍保持四家一致；
   牌面尺寸同步缩小，尽量把露出的角标留给字符。 */
@media (max-width: 1419px) {
  .hand {
    --hand-card-w: 104px;
    --hand-card-h: 146px;
    --hand-card-step: 29px;
    --hand-card-radius: 10px;
    --hand-label-size: 26px;
    --hand-corner-size: 20px;
    --hand-pip-size: 23px;
    --hand-court-size: 58px;
    --hand-back-spade-size: 38px;
  }
}
@media (max-width: 1349px) {
  .hand {
    --hand-card-w: 102px;
    --hand-card-h: 143px;
    --hand-card-step: 28px;
    --hand-card-radius: 10px;
    --hand-label-size: 25px;
    --hand-corner-size: 20px;
    --hand-pip-size: 22px;
    --hand-court-size: 57px;
    --hand-back-spade-size: 37px;
  }
}
@media (max-width: 1299px) {
  .hand {
    --hand-card-w: 100px;
    --hand-card-h: 140px;
    --hand-card-step: 27px;
    --hand-card-radius: 10px;
    --hand-label-size: 24px;
    --hand-corner-size: 19px;
    --hand-pip-size: 22px;
    --hand-court-size: 56px;
    --hand-back-spade-size: 37px;
  }
}
@media (max-width: 1249px) {
  .hand {
    --hand-card-w: 96px;
    --hand-card-h: 134px;
    --hand-card-step: 24px;
    --hand-card-radius: 9px;
    --hand-label-size: 22px;
    --hand-corner-size: 18px;
    --hand-pip-size: 21px;
    --hand-court-size: 53px;
    --hand-back-spade-size: 35px;
  }
}
@media (max-width: 1199px) {
  .hand {
    --hand-card-w: 94px;
    --hand-card-h: 131px;
    --hand-card-step: 20px;
    --hand-card-radius: 9px;
    --hand-label-size: 17px;
    --hand-corner-size: 16px;
    --hand-pip-size: 21px;
    --hand-court-size: 52px;
    --hand-back-spade-size: 34px;
  }
}
@media (max-width: 1099px) {
  .hand {
    --hand-card-w: 88px;
    --hand-card-h: 123px;
    --hand-card-step: 18px;
    --hand-card-radius: 8px;
    --hand-label-size: 15px;
    --hand-corner-size: 14px;
    --hand-pip-size: 19px;
    --hand-court-size: 48px;
    --hand-back-spade-size: 31px;
  }
}
@media (max-width: 999px) {
  .hand {
    --hand-card-w: 84px;
    --hand-card-h: 117px;
    --hand-card-step: 15px;
    --hand-card-radius: 8px;
    --hand-label-size: 12px;
    --hand-corner-size: 12px;
    --hand-pip-size: 17px;
    --hand-court-size: 44px;
    --hand-back-spade-size: 28px;
  }
}
/* 单列布局后拥有整行宽度，恢复舒展牌距并放大牌面 */
@media (max-width: 880px) {
  .hand {
    --hand-card-w: 108px;
    --hand-card-h: 150px;
    --hand-card-step: 38px;
    --hand-card-radius: 11px;
    --hand-label-size: 27px;
    --hand-corner-size: 21px;
    --hand-pip-size: 24px;
    --hand-court-size: 60px;
    --hand-back-spade-size: 40px;
  }
}
@media (max-width: 700px) {
  .hand {
    --hand-card-w: 104px;
    --hand-card-h: 146px;
    --hand-card-step: 34px;
    --hand-label-size: 26px;
    --hand-corner-size: 20px;
  }
}
@media (max-width: 600px) {
  .hand {
    --hand-card-w: 100px;
    --hand-card-h: 140px;
    --hand-card-step: 30px;
    --hand-label-size: 24px;
    --hand-corner-size: 19px;
  }
}
@media (max-width: 480px) {
  .hand {
    --hand-card-w: 96px;
    --hand-card-h: 134px;
    --hand-card-step: 26px;
    --hand-label-size: 22px;
    --hand-corner-size: 18px;
  }
}
@media (max-width: 400px) {
  .hand {
    --hand-card-w: 92px;
    --hand-card-h: 128px;
    --hand-card-step: 22px;
    --hand-label-size: 20px;
    --hand-corner-size: 16px;
  }
}

/* 主动高亮可点击的手牌 */
.active .suits.clickable :deep(.playing-card) {
  outline: 1px solid rgba(255, 214, 102, 0.65);
}
</style>
