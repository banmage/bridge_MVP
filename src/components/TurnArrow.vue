<script setup lang="ts">
import type { Position } from '../models/gameState';

withDefaults(
  defineProps<{
    /** 箭头指向的座位 */
    position: Position;
    /** 无障碍说明；推荐出牌时改为“推荐出牌” */
    label?: string;
    /**
     * seat：默认的座位方向箭头；
     * card：渲染在单张牌的定位槽内，从牌的上方朝下指向这张牌。
     */
    variant?: 'seat' | 'card';
  }>(),
  {
    label: '轮到该座位出牌',
    variant: 'seat',
  },
);
</script>

<template>
  <span
    class="turn-arrow"
    :class="[`pos-${position}`, { 'variant-card': variant === 'card' }]"
    role="img"
    :aria-label="label"
  >
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path d="M24 3 44 24H33v21H15V24H4Z" />
    </svg>
  </span>
</template>

<style scoped>
/* 橙色与白色交替闪烁，从内圈指向该座位的手牌 */
.turn-arrow {
  position: absolute;
  z-index: 5;
  width: 30px;
  height: 30px;
  color: #ff9d1f;
  filter: drop-shadow(0 0 7px rgba(255, 145, 15, 0.95));
  animation: turn-arrow-blink 0.8s step-end infinite;
  pointer-events: none;
}
.turn-arrow svg {
  display: block;
  width: 100%;
  height: 100%;
  fill: currentColor;
}
/* 北家：手牌下方，箭头朝上指向手牌 */
.turn-arrow.pos-N {
  top: calc(100% + 2px);
  left: 50%;
  margin-left: -15px;
}
/* 南家：手牌上方，箭头朝下指向手牌 */
.turn-arrow.pos-S {
  bottom: calc(100% + 2px);
  left: 50%;
  margin-left: -15px;
  transform: rotate(180deg);
}
/* 西家：手牌右侧，箭头朝左指向手牌 */
.turn-arrow.pos-W {
  top: 50%;
  left: calc(100% + 2px);
  margin-top: -15px;
  transform: rotate(-90deg);
}
/* 东家：手牌左侧，箭头朝右指向手牌 */
.turn-arrow.pos-E {
  top: 50%;
  right: calc(100% + 2px);
  margin-top: -15px;
  transform: rotate(90deg);
}
/* 推荐出牌：贴在牌的中央侧，指向这张牌，覆盖座位方向定位。
   --card-visible-width 由 Hand 的 .card-slot 提供：叠放后真正露出的牌宽，
   保证箭头对准可见牌面而不是整个定位槽（最后一张牌为完整牌宽）。 */
.turn-arrow.variant-card {
  width: 22px;
  height: 22px;
  top: auto;
  right: auto;
  bottom: auto;
  left: auto;
  margin: 0;
  transform: none;
}
/* 上方座位（明手/同伴）：牌的下方，箭头朝上，位于中央区域 */
.turn-arrow.variant-card.pos-N {
  top: calc(100% + 1px);
  left: calc(var(--card-visible-width, 100%) / 2);
  margin-left: -11px;
  transform: rotate(0deg);
}
/* 下方座位（自己）：牌的上方，箭头朝下 */
.turn-arrow.variant-card.pos-S {
  bottom: calc(100% + 1px);
  left: calc(var(--card-visible-width, 100%) / 2);
  margin-left: -11px;
  transform: rotate(180deg);
}
/* 左侧座位：牌的右方（中央侧），箭头朝左 */
.turn-arrow.variant-card.pos-W {
  top: 50%;
  left: calc(var(--card-visible-width, 100%) + 1px);
  margin-top: -11px;
  transform: rotate(-90deg);
}
/* 右侧座位：牌的左方（中央侧），箭头朝右 */
.turn-arrow.variant-card.pos-E {
  top: 50%;
  right: calc(100% + 1px);
  margin-top: -11px;
  transform: rotate(90deg);
}
@keyframes turn-arrow-blink {
  0%,
  49.9% {
    color: #ff9d1f;
    filter: drop-shadow(0 0 7px rgba(255, 145, 15, 0.95));
  }
  50%,
  100% {
    color: #ffffff;
    filter: drop-shadow(0 0 7px rgba(255, 255, 255, 0.95));
  }
}
</style>
